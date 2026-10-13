import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound, ok, wrap } from '../lib/http.js';
import { createLogger } from '../lib/log.js';
import { requireProvider } from '../providers/registry.js';
import { clientFor, createConnection, getConnection, listConnections, localConnectionId } from '../providers/connections.js';
import { ACCOUNT_FILE, authVerifierFor, getAccount, listAccounts, newProfileId, putAccount, readVault, removeAccount, storageFor, writeVault, VAULT_FILE } from '../vault/store.js';
import { CreateProfileSchema } from '../vault/types.js';
import { requireUnlocked } from '../session/middleware.js';
import { lockSession, unlockSession } from '../session/store.js';
import { dropSession } from '../browse/downloads.js';
import { cache } from '../browse/engine.js';
import { config } from '../config.js';

const log = createLogger('profiles');

/** Brute-force guard: attempts are counted per profile id and per IP. */
const attempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const LOCK_WINDOW_MS = 15 * 60_000;

function guardKey(req: { ip?: string }, profileId: string): string {
  return `${req.ip ?? '?'}:${profileId}`;
}

function checkGuard(key: string): void {
  const a = attempts.get(key);
  if (!a) return;
  if (a.lockedUntil > Date.now()) {
    const secs = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    throw conflict(`Trop de tentatives. Réessayez dans ${secs}s.`);
  }
}

function registerFailure(key: string): void {
  const a = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCK_WINDOW_MS;
    a.count = 0;
    log.warn(`unlock throttled for ${key}`);
  }
  attempts.set(key, a);
}

export interface PublicProfile {
  profileId: string;
  label: string;
  hue: number;
  kdf: { alg: string; iterations: number; salt: string };
  cipher: string;
  providerId: string;
  providerName: string;
  connectionId: string;
  accountLabel?: string;
  drivePath: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  hasVault: boolean;
}

async function toPublic(rec: Awaited<ReturnType<typeof getAccount>>): Promise<PublicProfile | null> {
  if (!rec) return null;
  const provider = requireProvider(rec.providerId);
  const connection = await getConnection(rec.connectionId);
  return {
    profileId: rec.profileId,
    label: rec.label,
    hue: rec.hue ?? 24,
    kdf: rec.kdf,
    cipher: rec.cipher,
    providerId: rec.providerId,
    providerName: provider.descriptor.name,
    connectionId: rec.connectionId,
    accountLabel: connection?.accountLabel ?? connection?.email,
    drivePath: rec.drivePath,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    revision: rec.revision,
    hasVault: true,
  };
}

export const profilesRouter = Router();

/** Public catalogue of profiles stored on this instance (no secret material). */
profilesRouter.get(
  '/',
  wrap(async (_req, res) => {
    const records = await listAccounts();
    const profiles = (await Promise.all(records.map(toPublic))).filter(Boolean) as PublicProfile[];
    ok(res, { profiles });
  }),
);

/** Create a profile: the browser already encrypted the first vault payload. */
profilesRouter.post(
  '/',
  wrap(async (req, res) => {
    const input = CreateProfileSchema.parse(req.body);
    const connectionId = input.connectionId ?? localConnectionId;
    const connection = await getConnection(connectionId);
    if (connectionId !== localConnectionId && !connection) throw notFound(`Connection "${connectionId}" introuvable.`);
    const providerId = connection?.providerId ?? 'local';
    const provider = requireProvider(providerId);
    if (!provider.descriptor.capabilities.write) {
      throw badRequest(`${provider.descriptor.name} est en lecture seule : choisissez un autre espace pour héberger le coffre.`);
    }

    const profileId = newProfileId();
    const now = Date.now();
    const record = {
      v: 1 as const,
      profileId,
      label: input.label,
      hue: input.hue ?? Math.floor(Math.random() * 360),
      kdf: input.kdf,
      cipher: 'AES-GCM-256' as const,
      authVerifier: authVerifierFor(input.authHash),
      connectionId,
      providerId,
      drivePath: VAULT_FILE,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      revision: 0,
    };

    await putAccount(record);
    try {
      await writeVault(record, input.vault, { snapshot: true });
    } catch (err) {
      await removeAccount(profileId);
      log.error(`initial vault write failed: ${(err as Error).message}`);
      throw conflict(`Impossible d'écrire le coffre sur ${provider.descriptor.name}: ${(err as Error).message}`);
    }

    // Publish the public envelope header next to the vault so the profile can
    // be discovered from the Drive alone on another device.
    const client = await storageFor(record);
    await client
      .write(ACCOUNT_FILE, JSON.stringify({ ...record, authVerifier: undefined }, null, 2), 'application/json')
      .catch((e) => log.warn(`account mirror failed: ${(e as Error).message}`));

    unlockSession(req.session, profileId, providerId);
    const profile = await toPublic(await getAccount(profileId));
    // The render token lets the sandboxed frame (opaque origin, no cookies)
    // reach the browsing engine. It dies with the session on lock.
    ok(res, { profile, browseToken: req.session.browseToken });
  }),
);

/** Unlock: exchange the client-derived auth hash for an unlocked session. */
profilesRouter.post(
  '/unlock',
  wrap(async (req, res) => {
    const { profileId, authHash } = z.object({ profileId: z.string(), authHash: z.string().min(32) }).parse(req.body);
    const key = guardKey(req, profileId);
    checkGuard(key);

    const record = await getAccount(profileId);
    if (!record) throw notFound('Profil introuvable.');
    if (record.authVerifier !== authVerifierFor(authHash)) {
      registerFailure(key);
      throw badRequest('Mot de passe maître incorrect.');
    }

    attempts.delete(key);
    unlockSession(req.session, record.profileId, record.providerId);
    record.lastSeenAt = Date.now();
    await putAccount(record);

    const envelope = await readVault(record).catch(() => null);
    ok(res, {
      profile: await toPublic(record),
      vault: envelope
        ? { revision: envelope.revision, updatedAt: envelope.updatedAt, sizeBytes: envelope.sizeBytes, checksum: envelope.checksum, vault: envelope.vault }
        : null,
      session: { ttlMinutes: config.sessionTtlMinutes, browseToken: req.session.browseToken },
    });
  }),
);

/** Discover a profile that already exists on a connected Drive. */
profilesRouter.post(
  '/discover',
  wrap(async (req, res) => {
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(req.body);
    const connection = await getConnection(connectionId);
    if (!connection) throw notFound('Connexion introuvable.');
    const { client } = await clientFor(connectionId);
    const text = await client.readText(ACCOUNT_FILE);
    ok(res, { found: Boolean(text), account: text ? JSON.parse(text) : null });
  }),
);

/** Lock immediately and wipe every ephemeral trace of the session. */
profilesRouter.post(
  '/lock',
  requireUnlocked,
  wrap(async (req, res) => {
    dropSession(req.session.id);
    cache.clear();
    lockSession(req.session);
    ok(res, { locked: true });
  }),
);

/** Re-key: the client re-encrypts with a new master password. */
profilesRouter.put(
  '/:profileId/rekey',
  requireUnlocked,
  wrap(async (req, res) => {
    const { profileId } = req.params as { profileId: string };
    if (req.session.profileId !== profileId) throw badRequest('Profil différent de la session active.');
    const { authHash, vault, label, hue } = z
      .object({ authHash: z.string().min(32), vault: z.string().min(1), label: z.string().min(1).max(80).optional(), hue: z.number().min(0).max(360).optional() })
      .parse(req.body);
    const record = await getAccount(profileId);
    if (!record) throw notFound('Profil introuvable.');
    record.authVerifier = authVerifierFor(authHash);
    if (label) record.label = label;
    if (hue !== undefined) record.hue = hue;
    record.updatedAt = Date.now();
    await putAccount(record);
    await writeVault(record, vault, { snapshot: true });
    ok(res, { profile: await toPublic(record) });
  }),
);

/** Move the vault to a different Drive (Google → Yandex, local → Drive, …). */
profilesRouter.post(
  '/:profileId/move',
  requireUnlocked,
  wrap(async (req, res) => {
    const { profileId } = req.params as { profileId: string };
    if (req.session.profileId !== profileId) throw badRequest('Profil différent de la session active.');
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(req.body);
    const record = await getAccount(profileId);
    if (!record) throw notFound('Profil introuvable.');

    const connection = connectionId === localConnectionId ? null : await getConnection(connectionId);
    if (connectionId !== localConnectionId && !connection) throw notFound('Connexion introuvable.');
    const providerId = connection?.providerId ?? 'local';
    if (!requireProvider(providerId).descriptor.capabilities.write) {
      throw badRequest('Cet espace est en lecture seule.');
    }

    const envelope = await readVault(record);
    if (!envelope) throw notFound('Coffre introuvable sur l’espace actuel.');

    record.connectionId = connectionId;
    record.providerId = providerId;
    record.updatedAt = Date.now();
    await putAccount(record);
    await writeVault(record, envelope.vault, { snapshot: true });
    const client = await storageFor(record);
    await client.write(ACCOUNT_FILE, JSON.stringify({ ...record, authVerifier: undefined }, null, 2), 'application/json');

    log.info(`profile ${profileId} moved to ${providerId}`);
    ok(res, { profile: await toPublic(record), movedBytes: envelope.sizeBytes });
  }),
);

profilesRouter.delete(
  '/:profileId',
  requireUnlocked,
  wrap(async (req, res) => {
    const { profileId } = req.params as { profileId: string };
    if (req.session.profileId !== profileId) throw badRequest('Profil différent de la session active.');
    const record = await getAccount(profileId);
    if (!record) throw notFound('Profil introuvable.');
    const client = await storageFor(record);
    await client.remove(VAULT_FILE).catch(() => undefined);
    await client.remove(ACCOUNT_FILE).catch(() => undefined);
    await removeAccount(profileId);
    dropSession(req.session.id);
    cache.clear();
    lockSession(req.session);
    ok(res, { deleted: true });
  }),
);

export { listConnections };
