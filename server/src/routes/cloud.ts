import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound, ok, upstream, wrap } from '../lib/http.js';
import { createLogger } from '../lib/log.js';
import { config } from '../config.js';
import {
  clientFor,
  createConnection,
  deleteConnection,
  listConnections,
  localConnectionId,
  touchConnection,
} from '../providers/connections.js';
import { getAccount, storageFor } from '../vault/store.js';
import { getProvider, providerDescriptors, requireProvider } from '../providers/registry.js';
import { requireUnlocked } from '../session/middleware.js';

const log = createLogger('cloud-route');

/** Origin of the running app — works behind the sandbox preview proxy. */
const appOrigin = (req: { protocol: string; get: (k: string) => string | undefined; headers: Record<string, unknown> }): string => {
  const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0]!.trim();
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? new URL(config.publicUrl).host;
  return `${proto}://${host}`;
};

export const cloudRouter = Router();

/** Public catalogue: what each Drive can do and whether this instance is ready. */
cloudRouter.get(
  '/providers',
  wrap(async (_req, res) => {
    ok(res, { providers: providerDescriptors(), connections: await listConnections() });
  }),
);

cloudRouter.get(
  '/connections',
  wrap(async (_req, res) => {
    ok(res, { connections: await listConnections(), localConnectionId });
  }),
);

/** Connect with credentials typed in the UI (token / WebDAV) — or a demo link. */
cloudRouter.post(
  '/connections',
  wrap(async (req, res) => {
    const { providerId, credentials, label, accountLabel, simulated } = z
      .object({
        providerId: z.string().min(1),
        credentials: z.record(z.string()).optional(),
        label: z.string().min(1).max(80).optional(),
        accountLabel: z.string().min(1).max(120).optional(),
        simulated: z.boolean().optional(),
      })
      .parse(req.body);

    const provider = requireProvider(providerId);
    if (providerId === 'local') throw badRequest('L’espace Nimbus local est toujours disponible, aucune connexion requise.');

    if (!simulated && provider.descriptor.kind === 'oauth2') {
      throw badRequest(`${provider.descriptor.name} se connecte par OAuth. Utilisez /api/cloud/oauth/${providerId}/start.`);
    }

    const creds = credentials ?? {};
    if (!simulated) {
      for (const field of provider.descriptor.fields ?? []) {
        if (field.type !== 'text' || !field.key.includes('root')) {
          if (!creds[field.key]) throw badRequest(`Champ requis : ${field.label}.`);
        }
      }
      // Fail fast on an unreachable server rather than storing dead credentials.
      try {
        const client = provider.client(creds);
        await client.list('/');
      } catch (err) {
        throw upstream(`Connexion refusée par le serveur : ${(err as Error).message}`);
      }
    }

    let account = accountLabel;
    let email: string | undefined;
    if (!simulated) {
      try {
        const client = provider.client(creds);
        const info = await client.accountInfo();
        account = account ?? info.label ?? info.email;
        email = info.email;
      } catch {
        /* identity is cosmetic */
      }
    }

    const connection = await createConnection({
      providerId,
      credentials: creds,
      label: label ?? provider.descriptor.name,
      accountLabel: account ?? (simulated ? 'Compte de démonstration' : undefined),
      email,
      simulated: Boolean(simulated),
    });

    const { credentials: _drop, ...pub } = connection;
    ok(res, { connection: pub });
  }),
);

cloudRouter.post(
  '/connections/:id/test',
  wrap(async (req, res) => {
    const { id } = req.params as { id: string };
    const { client, connection } = await clientFor(id);
    const [info, quota] = await Promise.all([client.accountInfo().catch(() => ({})), client.quota().catch(() => null)]);
    await touchConnection(id);
    ok(res, { connection: { id, providerId: connection.providerId, label: connection.label }, info, quota });
  }),
);

cloudRouter.delete(
  '/connections/:id',
  requireUnlocked,
  wrap(async (req, res) => {
    const { id } = req.params as { id: string };
    if (id === localConnectionId) throw badRequest('L’espace local ne peut pas être supprimé.');
    const removed = await deleteConnection(id);
    if (!removed) throw notFound('Connexion introuvable.');
    ok(res, { deleted: id });
  }),
);

// --- OAuth -----------------------------------------------------------------

cloudRouter.get('/oauth/:provider/start', (req, res, next) => {
  void (async () => {
    const { provider } = req.params as { provider: string };
    const p = getProvider(provider);
    if (!p) throw notFound('Fournisseur inconnu.');
    if (!p.descriptor.configured) {
      throw badRequest(
        `${p.descriptor.name} n'est pas configuré sur cette instance Nimbus (identifiants OAuth absents du .env).`,
      );
    }
    const redirectUri = `${appOrigin(req)}/api/cloud/oauth/${provider}/callback`;
    const started = await p.beginAuth(redirectUri);
    log.info(`oauth start ${provider} → ${started.url.slice(0, 90)}…`);
    res.redirect(302, started.url);
  })().catch(next);
});

cloudRouter.get('/oauth/:provider/callback', (req, res, next) => {
  void (async () => {
    const { provider } = req.params as { provider: string };
    const p = getProvider(provider);
    if (!p) throw notFound('Fournisseur inconnu.');
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const error = String(req.query.error ?? '');
    const home = appOrigin(req);
    if (error) {
      res.redirect(302, `${home}/?cloud=denied&provider=${provider}&reason=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      res.redirect(302, `${home}/?cloud=incomplete&provider=${provider}`);
      return;
    }
    const redirectUri = `${home}/api/cloud/oauth/${provider}/callback`;
    const result = await p.completeAuth({ code, state, redirectUri });
    const connection = await createConnection({
      providerId: provider,
      credentials: result.credentials,
      label: p.descriptor.name,
      accountLabel: result.accountLabel,
      email: result.email,
    });
    log.info(`oauth complete ${provider} → connection ${connection.id}`);
    res.redirect(302, `${home}/?cloud=connected&provider=${provider}&connection=${connection.id}`);
  })().catch((err) => {
    log.error(`oauth callback failed: ${(err as Error).message}`);
    const home = appOrigin(req);
    const provider = String((req.params as { provider: string }).provider);
    res.redirect(302, `${home}/?cloud=error&provider=${provider}&reason=${encodeURIComponent((err as Error).message)}`);
  });
});

/** Storage health for the active profile: quota, files, capabilities. */
cloudRouter.get(
  '/status',
  requireUnlocked,
  wrap(async (req, res) => {
    const record = req.session.profileId ? await getAccount(req.session.profileId) : undefined;
    if (!record) throw notFound('Profil introuvable.');
    const client = await storageFor(record);
    const [quota, info, files] = await Promise.all([
      client.quota().catch(() => ({ used: 0, total: null })),
      client.accountInfo().catch(() => ({})),
      client.list('/').catch(() => []),
    ]);
    ok(res, {
      quota,
      info,
      files,
      providerId: record.providerId,
      connectionId: record.connectionId,
      drivePath: record.drivePath,
      revision: record.revision,
      updatedAt: record.updatedAt,
      capabilities: requireProvider(record.providerId).descriptor.capabilities,
    });
  }),
);
