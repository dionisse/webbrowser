import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
// Load `.env` from the repository root (server/../../.env) and from server/.env
loadEnv({ path: resolve(here, '../../.env') });
loadEnv({ path: resolve(here, '../.env') });

const bool = (v: string | undefined, fallback = false): boolean => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const dataDir = resolve(here, '../data');
mkdirSync(dataDir, { recursive: true });

/**
 * A server key is required to encrypt provider credentials (OAuth tokens) at
 * rest. When none is supplied we derive an ephemeral one — connections made in
 * that mode do not survive a restart, which is the safe default for a demo.
 */
const serverKey = process.env.NIMBUS_SERVER_KEY?.trim() || `ephemeral:${randomBytes(32).toString('hex')}`;

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.NIMBUS_HOST ?? '0.0.0.0',
  port: num(process.env.NIMBUS_PORT, 8787),
  publicUrl: (process.env.NIMBUS_PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  dataDir,
  serverKey,
  serverKeyIsEphemeral: serverKey.startsWith('ephemeral:'),
  sessionTtlMinutes: num(process.env.NIMBUS_SESSION_TTL_MINUTES, 15),
  trustProxy: bool(process.env.NIMBUS_TRUST_PROXY, true),

  browse: {
    userAgent:
      process.env.NIMBUS_USER_AGENT ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    maxDocumentBytes: num(process.env.NIMBUS_MAX_DOCUMENT_BYTES, 8_000_000),
    cacheTtlSeconds: num(process.env.NIMBUS_CACHE_TTL_SECONDS, 120),
    timeoutMs: num(process.env.NIMBUS_BROWSE_TIMEOUT_MS, 25_000),
    blockedHosts: (process.env.NIMBUS_BLOCKED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    yandex: {
      clientId: process.env.YANDEX_CLIENT_ID ?? '',
      clientSecret: process.env.YANDEX_CLIENT_SECRET ?? '',
    },
    onedrive: {
      clientId: process.env.ONEDRIVE_CLIENT_ID ?? '',
      clientSecret: process.env.ONEDRIVE_CLIENT_SECRET ?? '',
    },
    proton: {
      clientId: process.env.PROTON_CLIENT_ID ?? '',
      clientSecret: process.env.PROTON_CLIENT_SECRET ?? '',
      appVersion: process.env.PROTON_APP_VERSION ?? 'browser-nimbus@0.1.0',
    },
    webdav: {
      defaultUrl: process.env.WEBDAV_DEFAULT_URL ?? '',
    },
  },
} as const;

export type AppConfig = typeof config;
