import { Router } from 'express';
import { ok, wrap } from '../lib/http.js';
import { config } from '../config.js';
import { providerDescriptors } from '../providers/registry.js';
import { listConnections, localConnectionId } from '../providers/connections.js';
import { cache } from '../browse/engine.js';
import { sessionCount, sessionTtlMs, unlockedSessions } from '../session/store.js';
import { stats as downloadStats } from '../browse/downloads.js';
import { listAccounts } from '../vault/store.js';

/**
 * Bootstrap payload for the shell: everything the UI needs before it knows
 * whether a profile exists or a session is unlocked.
 */
export const metaRouter = Router();

metaRouter.get(
  '/',
  wrap(async (req, res) => {
    const [profiles, connections] = await Promise.all([listAccounts(), listConnections()]);
    ok(res, {
      app: {
        name: 'Nimbus',
        tagline: 'Le navigateur 100 % cloud, coffre zero-knowledge',
        version: '0.1.0',
        build: process.env.NIMBUS_BUILD ?? 'dev',
      },
      engine: {
        kind: 'cloud-proxy',
        rendersOnServer: true,
        localWrites: false,
        cacheTtlSeconds: config.browse.cacheTtlSeconds,
        maxDocumentMb: Math.round(config.browse.maxDocumentBytes / 1_000_000),
        timeoutSeconds: Math.round(config.browse.timeoutMs / 1000),
      },
      session: {
        phase: req.session.phase,
        profileId: req.session.profileId,
        ttlMinutes: Math.round(sessionTtlMs / 60_000),
        expiresAt: req.session.expiresAt,
      },
      security: {
        zeroKnowledge: true,
        kdf: 'PBKDF2-SHA256 (navigateur)',
        cipher: 'AES-GCM-256',
        serverKeyEphemeral: config.serverKeyIsEphemeral,
        autoLockMinutes: config.sessionTtlMinutes,
      },
      providers: providerDescriptors(),
      connections,
      localConnectionId,
      profiles: profiles.map((p) => ({
        profileId: p.profileId,
        label: p.label,
        hue: p.hue ?? 24,
        kdf: p.kdf,
        cipher: p.cipher,
        providerId: p.providerId,
        connectionId: p.connectionId,
        drivePath: p.drivePath,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        revision: p.revision,
      })),
      runtime: {
        node: process.version,
        env: config.env,
        sessions: sessionCount(),
        unlockedSessions: unlockedSessions(),
        cache: cache.stats(),
        downloads: downloadStats(),
      },
    });
  }),
);

metaRouter.get(
  '/health',
  wrap(async (_req, res) => {
    ok(res, { status: 'up', uptime: Math.round(process.uptime()), cache: cache.stats(), sessions: sessionCount() });
  }),
);
