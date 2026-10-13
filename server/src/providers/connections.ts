import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { openJson, sealJson, type SealedBox } from '../crypto/envelope.js';
import { createLogger } from '../lib/log.js';
import { requireProvider } from './registry.js';
import type { CloudClient } from './types.js';

const log = createLogger('connections');

export interface Connection {
  id: string;
  providerId: string;
  label: string;
  accountLabel?: string;
  email?: string;
  connectedAt: number;
  lastUsedAt?: number;
  /**
   * True when the connection was created without real provider credentials, so
   * the whole UX can be exercised offline. Data then lands in the local store.
   */
  simulated?: boolean;
  credentials: SealedBox;
}

export type PublicConnection = Omit<Connection, 'credentials'>;

const FILE = join(config.dataDir, 'connections.json');
const cache = new Map<string, Connection>();
let loaded = false;

const toPublic = (c: Connection): PublicConnection => {
  const { credentials: _drop, ...rest } = c;
  return rest;
};

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(FILE, 'utf8');
    const list = JSON.parse(raw) as Connection[];
    for (const c of list) {
      // Credentials sealed with an ephemeral server key cannot be reopened
      // after a restart; drop them rather than pretending the link is live.
      try {
        openJson(c.credentials);
        cache.set(c.id, c);
      } catch {
        log.warn(`dropping connection ${c.id} (${c.providerId}) — sealed with a previous server key`);
      }
    }
  } catch {
    /* first run */
  }
}

async function persist(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  // Credentials are stored sealed; the file is still 0600 and never served.
  await writeFile(FILE, JSON.stringify([...cache.values()], null, 2), 'utf8');
}

export async function listConnections(): Promise<PublicConnection[]> {
  await load();
  return [...cache.values()].sort((a, b) => b.connectedAt - a.connectedAt).map(toPublic);
}

export async function getConnection(id: string): Promise<Connection | undefined> {
  await load();
  return cache.get(id);
}

export async function createConnection(input: {
  providerId: string;
  credentials: Record<string, string>;
  label?: string;
  accountLabel?: string;
  email?: string;
  simulated?: boolean;
}): Promise<Connection> {
  await load();
  requireProvider(input.providerId);
  const connection: Connection = {
    id: randomUUID(),
    providerId: input.providerId,
    label: input.label ?? requireProvider(input.providerId).descriptor.name,
    accountLabel: input.accountLabel,
    email: input.email,
    connectedAt: Date.now(),
    simulated: input.simulated ?? false,
    credentials: sealJson(input.credentials),
  };
  cache.set(connection.id, connection);
  await persist();
  log.info(`connection created ${connection.id} provider=${connection.providerId} simulated=${connection.simulated}`);
  return connection;
}

export async function updateConnectionCredentials(id: string, credentials: Record<string, string>): Promise<void> {
  await load();
  const c = cache.get(id);
  if (!c) return;
  c.credentials = sealJson(credentials);
  await persist();
}

export async function touchConnection(id: string): Promise<void> {
  await load();
  const c = cache.get(id);
  if (!c) return;
  c.lastUsedAt = Date.now();
  await persist();
}

export async function deleteConnection(id: string): Promise<boolean> {
  await load();
  const existed = cache.delete(id);
  if (existed) await persist();
  return existed;
}

/** Build a live client, persisting any token rotation the provider performs. */
export async function clientFor(connectionId: string): Promise<{ client: CloudClient; connection: Connection }> {
  const connection = await getConnection(connectionId);
  if (!connection) throw new Error(`Connection "${connectionId}" no longer exists.`);
  const provider = requireProvider(connection.providerId);

  // A simulated connection has no real credentials: fall back to the local
  // encrypted store so the product remains fully usable offline.
  if (connection.simulated) {
    const { localClientFor } = await import('./local.js');
    return { client: localClientFor(connection.id), connection };
  }

  const credentials = openJson<Record<string, string>>(connection.credentials);
  const client = provider.client(credentials, {
    onCredentials: (next) => updateConnectionCredentials(connection.id, next),
  });
  return { client, connection };
}

export const localConnectionId = 'local';

/**
 * The always-present local connection. It is synthesised rather than persisted
 * so that a fresh install works with no configuration at all.
 */
export function ensureLocalConnection(): Connection {
  return {
    id: localConnectionId,
    providerId: 'local',
    label: 'Nimbus Cloud (local)',
    connectedAt: 0,
    credentials: sealJson({}),
  };
}

export async function clientForLocal(profileId: string): Promise<CloudClient> {
  const { localClientFor } = await import('./local.js');
  return localClientFor(profileId);
}
