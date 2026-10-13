import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { createHmac } from 'node:crypto';
import { createLogger } from '../lib/log.js';
import { clientFor, clientForLocal, localConnectionId } from '../providers/connections.js';
import type { CloudClient } from '../providers/types.js';
import type { AccountRecord } from './types.js';

const log = createLogger('vault');

/**
 * Vault storage.
 *
 * The payload Nimbus moves around is a base64 AES-GCM ciphertext produced in
 * the browser. The server never sees plaintext and never holds the key: it only
 * decides *where* the blob lives (your Drive) and enforces revisions so two
 * devices cannot silently overwrite each other.
 *
 * Layout on the Drive:
 *   /Nimbus/account.json          public envelope header (kdf params, revision)
 *   /Nimbus/vault.enc             the encrypted vault
 *   /Nimbus/attachments/<id>      encrypted attachments
 *   /Nimbus/snapshots/<rev>.enc   rolling history, optional
 */

const DIR = 'Nimbus';
export const VAULT_FILE = `${DIR}/vault.enc`;
export const ACCOUNT_FILE = `${DIR}/account.json`;
export const ATTACHMENT_DIR = `${DIR}/attachments`;
export const SNAPSHOT_DIR = `${DIR}/snapshots`;
const MAX_SNAPSHOTS = 25;

const REGISTRY_FILE = join(config.dataDir, 'accounts.json');

/**
 * Pepper used so that a leak of the server's account index does not hand over
 * usable credentials: what is stored is SHA-256(authHash ‖ pepper), never the
 * authHash itself.
 */
const pepper = createHmac('sha256', config.serverKey).update('nimbus.auth.pepper.v1').digest();

export const authVerifierFor = (authHash: string): string =>
  createHash('sha256').update(Buffer.concat([Buffer.from(authHash, 'utf8'), pepper])).digest('base64');

// ---------------------------------------------------------------------------
// Account index
// ---------------------------------------------------------------------------

const index = new Map<string, AccountRecord>();
let indexLoaded = false;

async function loadIndex(): Promise<void> {
  if (indexLoaded) return;
  indexLoaded = true;
  try {
    const raw = await readFile(REGISTRY_FILE, 'utf8');
    for (const rec of JSON.parse(raw) as AccountRecord[]) index.set(rec.profileId, rec);
    log.info(`account index loaded (${index.size} profile(s))`);
  } catch {
    /* first run */
  }
}

async function saveIndex(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(REGISTRY_FILE, JSON.stringify([...index.values()], null, 2), 'utf8');
}

export async function listAccounts(): Promise<AccountRecord[]> {
  await loadIndex();
  return [...index.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAccount(profileId: string): Promise<AccountRecord | undefined> {
  await loadIndex();
  return index.get(profileId);
}

export async function putAccount(record: AccountRecord): Promise<void> {
  await loadIndex();
  index.set(record.profileId, record);
  await saveIndex();
}

export async function removeAccount(profileId: string): Promise<boolean> {
  await loadIndex();
  const existed = index.delete(profileId);
  if (existed) await saveIndex();
  return existed;
}

// ---------------------------------------------------------------------------
// Storage client resolution
// ---------------------------------------------------------------------------

export async function storageFor(record: AccountRecord): Promise<CloudClient> {
  return record.connectionId === localConnectionId
    ? clientForLocal(record.profileId)
    : (await clientFor(record.connectionId)).client;
}

export const newProfileId = (): string => randomUUID();

// ---------------------------------------------------------------------------
// Vault I/O
// ---------------------------------------------------------------------------

export interface VaultEnvelope {
  profileId: string;
  revision: number;
  updatedAt: number;
  sizeBytes: number;
  /** SHA-256 of the ciphertext — lets the client verify integrity after sync. */
  checksum: string;
  vault: string;
}

export const checksumOf = (payload: string): string => createHash('sha256').update(payload).digest('base64');

export async function readVault(record: AccountRecord): Promise<VaultEnvelope | null> {
  const client = await storageFor(record);
  const text = await client.readText(record.drivePath);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as VaultEnvelope;
    return { ...parsed, profileId: record.profileId };
  } catch {
    // Legacy / raw ciphertext stored without an envelope.
    return {
      profileId: record.profileId,
      revision: record.revision,
      updatedAt: record.updatedAt,
      sizeBytes: Math.ceil((text.length * 3) / 4),
      checksum: checksumOf(text),
      vault: text,
    };
  }
}

export interface WriteVaultOptions {
  baseRevision?: number;
  snapshot?: boolean;
}

export async function writeVault(record: AccountRecord, ciphertext: string, opts: WriteVaultOptions = {}): Promise<VaultEnvelope> {
  const client = await storageFor(record);

  if (opts.baseRevision !== undefined && opts.baseRevision !== record.revision) {
    throw Object.assign(new Error('revision_conflict'), { code: 'revision_conflict', serverRevision: record.revision });
  }

  await client.ensureDir(record.drivePath.split('/').slice(0, -1).join('/') || DIR);

  const revision = record.revision + 1;
  const now = Date.now();
  const envelope: VaultEnvelope = {
    profileId: record.profileId,
    revision,
    updatedAt: now,
    sizeBytes: Buffer.byteLength(ciphertext, 'utf8'),
    checksum: checksumOf(ciphertext),
    vault: ciphertext,
  };

  await client.write(record.drivePath, JSON.stringify(envelope), 'application/json');

  if (opts.snapshot) {
    await client
      .write(joinPath(SNAPSHOT_DIR, `${revision}.enc`), JSON.stringify(envelope), 'application/json')
      .catch((e) => log.warn(`snapshot write failed: ${(e as Error).message}`));
    await pruneSnapshots(client, record.drivePath);
  }

  // Mirror the public envelope header next to the vault so a fresh Nimbus
  // instance can discover the profile from your Drive alone.
  await client
    .write(
      joinPath(record.drivePath.split('/').slice(0, -1).join('/') || DIR, 'account.json'),
      JSON.stringify({ ...record, revision, updatedAt: now, authVerifier: undefined }, null, 2),
      'application/json',
    )
    .catch((e) => log.warn(`account mirror write failed: ${(e as Error).message}`));

  record.revision = revision;
  record.updatedAt = now;
  record.lastSeenAt = now;
  await putAccount(record);

  log.info(`vault written profile=${record.profileId} rev=${revision} bytes=${envelope.sizeBytes}`);
  return envelope;
}

async function pruneSnapshots(client: CloudClient, _drivePath: string): Promise<void> {
  try {
    const items = await client.list(SNAPSHOT_DIR);
    const snaps = items.filter((i) => !i.isDir).sort((a, b) => b.modifiedAt - a.modifiedAt);
    for (const extra of snaps.slice(MAX_SNAPSHOTS)) {
      await client.remove(extra.path).catch(() => undefined);
    }
  } catch {
    /* non-fatal */
  }
}

export async function listSnapshots(record: AccountRecord): Promise<{ revision: number; size: number; at: number; path: string }[]> {
  const client = await storageFor(record);
  const items = await client.list(SNAPSHOT_DIR).catch(() => []);
  return items
    .filter((i) => !i.isDir)
    .map((i) => ({
      revision: Number(i.name.replace(/\.enc$/, '')) || 0,
      size: i.size,
      at: i.modifiedAt,
      path: i.path,
    }))
    .sort((a, b) => b.revision - a.revision);
}

export async function readSnapshot(record: AccountRecord, path: string): Promise<string | null> {
  const client = await storageFor(record);
  const text = await client.readText(path);
  if (!text) return null;
  try {
    return (JSON.parse(text) as VaultEnvelope).vault;
  } catch {
    return text;
  }
}

export async function listVaultFiles(record: AccountRecord): Promise<{ path: string; name: string; size: number; isDir: boolean; modifiedAt: number }[]> {
  const client = await storageFor(record);
  const dir = record.drivePath.split('/').slice(0, -1).join('/') || DIR;
  const walk = async (p: string, depth: number): Promise<{ path: string; name: string; size: number; isDir: boolean; modifiedAt: number }[]> => {
    const items = await client.list(p).catch(() => []);
    const out: { path: string; name: string; size: number; isDir: boolean; modifiedAt: number }[] = [];
    for (const i of items) {
      out.push({ path: i.path, name: i.name, size: i.size, isDir: i.isDir, modifiedAt: i.modifiedAt });
      if (i.isDir && depth < 3) out.push(...(await walk(i.path, depth + 1)));
    }
    return out;
  };
  return walk(dir, 0);
}

export async function readVaultFile(record: AccountRecord, path: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const client = await storageFor(record);
  const res = await client.read(path);
  return res ? { data: res.data, mimeType: res.mimeType } : null;
}

export async function deleteVaultFile(record: AccountRecord, path: string): Promise<void> {
  const client = await storageFor(record);
  await client.remove(path);
}

export async function writeVaultFile(record: AccountRecord, path: string, data: Buffer | string, mimeType?: string): Promise<void> {
  const client = await storageFor(record);
  await client.ensureDir(path.split('/').slice(0, -1).join('/'));
  await client.write(path, data, mimeType);
}

const joinPath = (...parts: string[]): string =>
  '/' + parts.join('/').split('/').filter((s) => s && s !== '.').join('/');
