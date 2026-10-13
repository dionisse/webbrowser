import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Server-side envelope encryption.
 *
 * IMPORTANT — scope of this module: it protects *provider credentials* (OAuth
 * refresh tokens, WebDAV passwords) that the server must be able to use on the
 * user's behalf to reach their Drive. It is NOT used for vault content.
 *
 * Vault content (notes, passwords, cards, history, bookmarks) is encrypted in
 * the browser with a key derived from the master password and never leaves the
 * client in clear form. See web/src/lib/crypto.ts. This asymmetry is deliberate
 * and documented in docs/SECURITY.md.
 */

const KEY_LEN = 32;
const ITERATIONS = 210_000;
const SALT_LEN = 16;
const IV_LEN = 12;

const deriveKey = (salt: Buffer): Buffer =>
  pbkdf2Sync(Buffer.from(config.serverKey, 'utf8'), salt, ITERATIONS, KEY_LEN, 'sha256');

export interface SealedBox {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function seal(plaintext: string): SealedBox {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

export function open(box: SealedBox): string {
  const salt = Buffer.from(box.salt, 'base64');
  const iv = Buffer.from(box.iv, 'base64');
  const tag = Buffer.from(box.tag, 'base64');
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const out = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
    return out.toString('utf8');
  } finally {
    key.fill(0);
  }
}

export const sealJson = <T>(value: T): SealedBox => seal(JSON.stringify(value));
export const openJson = <T>(box: SealedBox): T => JSON.parse(open(box)) as T;

/** Constant-time string comparison, used for session tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function hmac(value: string): string {
  return createHmac('sha256', config.serverKey).update(value).digest('hex');
}
