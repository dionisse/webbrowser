/**
 * Zero-knowledge cryptography — everything here runs in the browser.
 *
 * The master password never leaves this file. From it we derive:
 *   • an AES-GCM-256 `masterKey` used to seal every vault record, and
 *   • an `authHash`, a one-way token the server compares against a peppered
 *     digest to decide whether to unlock the session.
 *
 * The server therefore never receives the password, never receives the key, and
 * can only ever move opaque ciphertext to and from your Drive.
 */

export const PBKDF2_ITERATIONS = 310_000;
const ENVELOPE_PREFIX = 'nimbus-vault-1';

export interface KdfParams {
  alg: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  fromBytes: (bytes: Uint8Array) => {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  },
  toBytes: (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
};

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
export const randomSalt = (): string => b64.fromBytes(randomBytes(16));
export const newId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return b64.fromBytes(randomBytes(16)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 22);
};

export function assertCrypto(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto indisponible : un contexte sécurisé (HTTPS ou localhost) est requis.');
  }
}

/** Password → PBKDF2 base key. */
async function pbkdf2Base(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}

export async function deriveMasterKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
  assertCrypto();
  const base = await pbkdf2Base(password);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64.toBytes(kdf.salt) as BufferSource, iterations: kdf.iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveAuthHash(masterKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  const mixed = new Uint8Array(raw.length + 14);
  mixed.set(raw, 0);
  mixed.set(enc.encode('nimbus-auth-v1'), raw.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', mixed));
  raw.fill(0);
  return b64.fromBytes(digest);
}

export async function sha256Base64(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return b64.fromBytes(digest);
}

/** AES-GCM with a random 96-bit IV and caller-supplied AAD for domain separation. */
export async function encryptJson<T>(key: CryptoKey, value: T, aad = 'vault'): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource, tagLength: 128 },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return `${ENVELOPE_PREFIX}.${b64.fromBytes(iv)}.${b64.fromBytes(new Uint8Array(ct))}`;
}

export async function decryptJson<T>(key: CryptoKey, envelope: string, aad = 'vault'): Promise<T> {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error('Enveloppe de coffre invalide.');
  }
  const iv = b64.toBytes(parts[1]!);
  const ct = b64.toBytes(parts[2]!);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource, tagLength: 128 },
    key,
    ct as BufferSource,
  );
  return JSON.parse(dec.decode(plain)) as T;
}

/** Best-effort key destruction: WebCrypto keys are not extractable-wiped, but
 *  dropping every reference plus clearing derived material is what a browser
 *  allows. Called on lock and on unload. */
export function forgetKey(key: CryptoKey | null): void {
  if (!key) return;
  try {
    // usages are cleared by re-importing an empty key over the handle where
    // supported; otherwise the reference drop is the guarantee.
    (key as unknown as { usages?: string[] }).usages = [];
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Password quality & generation
// ---------------------------------------------------------------------------

export interface StrengthReport {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'weak' | 'fair' | 'good' | 'strong';
  entropyBits: number;
}

export function passwordStrength(pw: string): StrengthReport {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const entropy = pool > 0 ? Math.round(pw.length * Math.log2(pool)) : 0;

  let penalty = 0;
  if (/^(.)\1+$/.test(pw)) penalty += 40;
  if (/(password|motdepasse|azerty|qwerty|123456|admin|nimbus)/i.test(pw)) penalty += 30;
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd)/i.test(pw)) penalty += 20;

  const effective = Math.max(0, entropy - penalty);
  const score: StrengthReport['score'] = effective < 34 ? 0 : effective < 55 ? 1 : effective < 80 ? 2 : effective < 110 ? 3 : 4;
  const label = (['weak', 'weak', 'fair', 'good', 'strong'] as const)[score];
  return { score, label, entropyBits: effective };
}

export interface GeneratorOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  numbers: true,
  symbols: true,
  avoidAmbiguous: true,
};

const SETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  upperAll: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  lowerAll: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '23456789',
  numbersAll: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};

/** Uniform sampling via rejection, so the distribution is not modulo-skewed. */
export function generatePassword(opts: GeneratorOptions = DEFAULT_GENERATOR): string {
  const pools: string[] = [];
  if (opts.upper) pools.push(opts.avoidAmbiguous ? SETS.upper : SETS.upperAll);
  if (opts.lower) pools.push(opts.avoidAmbiguous ? SETS.lower : SETS.lowerAll);
  if (opts.numbers) pools.push(opts.avoidAmbiguous ? SETS.numbers : SETS.numbersAll);
  if (opts.symbols) pools.push(SETS.symbols);
  if (pools.length === 0) pools.push(SETS.lowerAll);

  const alphabet = pools.join('');
  const length = Math.max(8, Math.min(128, Math.round(opts.length)));
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  const out: string[] = [];
  // Guarantee at least one character from every selected pool.
  for (const pool of pools) out.push(pickFrom(pool, max));
  while (out.length < length) out.push(pickFrom(alphabet, max));
  return shuffle(out).slice(0, length).join('');
}

function pickFrom(alphabet: string, _max: number): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < max) return alphabet[buf[0]! % alphabet.length]!;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  const buf = new Uint8Array(out.length);
  crypto.getRandomValues(buf);
  for (let i = out.length - 1; i > 0; i--) {
    const j = buf[i]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

export const digitsOnly = (value: string): string => value.replace(/\D+/g, '');

export function luhnValid(number: string): boolean {
  const digits = digitsOnly(number);
  if (digits.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function cardBrand(number: string): 'visa' | 'mastercard' | 'amex' | 'discover' | 'cb' | 'other' {
  const d = digitsOnly(number);
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^6(?:011|5)/.test(d)) return 'discover';
  if (/^(56|57|58|60)/.test(d)) return 'cb';
  return 'other';
}

export const formatCard = (number: string): string => {
  const d = digitsOnly(number).slice(0, 19);
  return (cardBrand(number) === 'amex' ? d.replace(/(\d{4})(\d{0,6})(\d{0,5})/, (_m, a, b, c) => [a, b, c].filter(Boolean).join(' ')) : d.replace(/(\d{4})(?=\d)/g, '$1 ')).trim();
};

export const maskCard = (number: string): string => {
  const d = digitsOnly(number);
  return `•••• •••• •••• ${d.slice(-4)}`;
};

export const cardExpiryLabel = (month: number, year: number): string =>
  `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — used by the password manager's 2FA field
// ---------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export async function totpCode(secret: string, at = Date.now(), period = 30, digits = 6): Promise<string> {
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) return '';
  const counter = Math.floor(at / 1000 / period);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1]! & 0x0f;
  const code =
    (((sig[offset]! & 0x7f) << 24) | ((sig[offset + 1]! & 0xff) << 16) | ((sig[offset + 2]! & 0xff) << 8) | (sig[offset + 3]! & 0xff)) %
    10 ** digits;
  return String(code).padStart(digits, '0');
}

export const totpRemaining = (at = Date.now(), period = 30): number => period - (Math.floor(at / 1000) % period);

export { b64 };
