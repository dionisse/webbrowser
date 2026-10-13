import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound, ok, wrap } from '../lib/http.js';
import { createLogger } from '../lib/log.js';
import { requireUnlocked } from '../session/middleware.js';
import { clientFor, clientForLocal, localConnectionId } from '../providers/connections.js';
import { requireProvider } from '../providers/registry.js';
import {
  deleteVaultFile,
  getAccount,
  listSnapshots,
  listVaultFiles,
  readSnapshot,
  readVault,
  readVaultFile,
  storageFor,
  writeVault,
  writeVaultFile,
} from '../vault/store.js';
import { SaveVaultSchema } from '../vault/types.js';
import { collect, stage } from '../browse/downloads.js';

const log = createLogger('vault-route');

/** Every vault route acts on the profile bound to the unlocked session. */
async function activeRecord(req: { session: { profileId: string | null } }) {
  if (!req.session.profileId) throw notFound('Aucun profil actif.');
  const record = await getAccount(req.session.profileId);
  if (!record) throw notFound('Profil introuvable.');
  return record;
}

export const vaultRouter = Router();
vaultRouter.use(requireUnlocked);

/** Pull the encrypted vault. The server cannot read any of it. */
vaultRouter.get(
  '/',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const envelope = await readVault(record);
    if (!envelope) throw notFound('Coffre vide sur cet espace cloud.');
    const client = await storageFor(record);
    const quota = await client.quota().catch(() => ({ used: 0, total: null }));
    ok(res, {
      revision: envelope.revision,
      updatedAt: envelope.updatedAt,
      sizeBytes: envelope.sizeBytes,
      checksum: envelope.checksum,
      vault: envelope.vault,
      storage: { providerId: record.providerId, connectionId: record.connectionId, drivePath: record.drivePath, quota },
    });
  }),
);

/** Push a new encrypted vault. Revision-guarded against multi-device clobbering. */
vaultRouter.put(
  '/',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const input = SaveVaultSchema.parse(req.body);
    try {
      const envelope = await writeVault(record, input.vault, { baseRevision: input.baseRevision, snapshot: input.snapshot });
      ok(res, { revision: envelope.revision, updatedAt: envelope.updatedAt, sizeBytes: envelope.sizeBytes, checksum: envelope.checksum });
    } catch (err) {
      const e = err as Error & { code?: string; serverRevision?: number };
      if (e.code === 'revision_conflict') {
        throw conflict(`Conflit de révision : le coffre a été modifié ailleurs (révision ${e.serverRevision}).`);
      }
      throw conflict(`Échec de l'écriture sur ${requireProvider(record.providerId).descriptor.name}: ${e.message}`);
    }
  }),
);

vaultRouter.get(
  '/snapshots',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    ok(res, { snapshots: await listSnapshots(record) });
  }),
);

vaultRouter.post(
  '/restore',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const { path } = z.object({ path: z.string().min(1) }).parse(req.body);
    const ciphertext = await readSnapshot(record, path);
    if (!ciphertext) throw notFound('Instantané introuvable.');
    const envelope = await writeVault(record, ciphertext, { snapshot: true });
    log.info(`profile ${record.profileId} restored from ${path}`);
    ok(res, { revision: envelope.revision, checksum: envelope.checksum });
  }),
);

// --- Files on your Drive ---------------------------------------------------

/** Browse the Nimbus folder as it actually exists on your Drive. */
vaultRouter.get(
  '/files',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const client = await storageFor(record);
    const [files, quota, info] = await Promise.all([
      listVaultFiles(record),
      client.quota().catch(() => ({ used: 0, total: null })),
      client.accountInfo().catch(() => ({})),
    ]);
    ok(res, {
      providerId: record.providerId,
      connectionId: record.connectionId,
      drivePath: record.drivePath,
      files,
      quota,
      account: info,
      capabilities: requireProvider(record.providerId).descriptor.capabilities,
    });
  }),
);

/**
 * Pull one file from your Drive down to your computer. Nothing is cached: the
 * bytes are staged in memory for this session and dropped the moment they are
 * collected.
 */
vaultRouter.get(
  '/files/stream',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const path = String(req.query.path ?? '');
    if (!path) throw badRequest('Chemin manquant.');
    const file = await readVaultFile(record, path);
    if (!file) throw notFound('Fichier introuvable sur votre espace cloud.');
    const stagedItem = stage({
      sessionId: req.session.id,
      profileId: record.profileId,
      url: `${requireProvider(record.providerId).descriptor.name}:${path}`,
      filename: path.split('/').pop() ?? 'fichier',
      mimeType: file.mimeType,
      size: file.data.length,
      data: file.data,
      origin: 'cloud',
    });
    const handed = collect(stagedItem.id, req.session.id);
    if (!handed) throw notFound('Fichier expiré.');
    res.set({
      'content-type': handed.mimeType || 'application/octet-stream',
      'content-disposition': `attachment; filename="${handed.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(handed.filename)}`,
      'content-length': String(handed.size),
      'cache-control': 'no-store',
    });
    res.status(200).send(handed.data);
  }),
);

vaultRouter.delete(
  '/files',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const path = String(req.query.path ?? '');
    if (!path) throw badRequest('Chemin manquant.');
    await deleteVaultFile(record, path);
    ok(res, { deleted: path });
  }),
);

/** Push an extra encrypted file (note attachment, exported backup…). */
vaultRouter.post(
  '/files',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const { path, data, mimeType } = z
      .object({ path: z.string().min(1), data: z.string().min(1), mimeType: z.string().optional() })
      .parse(req.body);
    await writeVaultFile(record, path, data, mimeType ?? 'application/octet-stream');
    ok(res, { path });
  }),
);

/** Move the whole vault to another connected Drive. */
vaultRouter.post(
  '/move',
  wrap(async (req, res) => {
    const record = await activeRecord(req);
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(req.body);
    const target = connectionId === localConnectionId ? null : await clientFor(connectionId);
    if (connectionId !== localConnectionId && !target) throw notFound('Connexion introuvable.');
    const providerId = target ? target.connection.providerId : 'local';
    if (!requireProvider(providerId).descriptor.capabilities.write) throw badRequest('Cet espace est en lecture seule.');

    const envelope = await readVault(record);
    if (!envelope) throw notFound('Coffre introuvable.');

    record.connectionId = connectionId;
    record.providerId = providerId;
    record.updatedAt = Date.now();
    const { putAccount } = await import('../vault/store.js');
    await putAccount(record);
    await writeVault(record, envelope.vault, { snapshot: true });

    const client = connectionId === localConnectionId ? await clientForLocal(record.profileId) : target!.client;
    await client.write('Nimbus/account.json', JSON.stringify({ ...record, authVerifier: undefined }, null, 2), 'application/json');

    ok(res, { connectionId, providerId, movedBytes: envelope.sizeBytes });
  }),
);
