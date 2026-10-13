import type { ProviderDescriptor, PublicConnection, PublicProfile, Vault } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fired when the engine reports a locked/expired session so the UI can react. */
export const onUnauthorized = new Set<() => void>();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'network', 'Le moteur cloud est injoignable.');
  }

  if (res.status === 401) {
    for (const fn of onUnauthorized) fn();
  }

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Erreur ${res.status}`, err?.details);
  }

  const envelope = parsed as { ok?: boolean; data?: T } | T;
  if (envelope && typeof envelope === 'object' && 'ok' in (envelope as object)) {
    return (envelope as { data: T }).data;
  }
  return envelope as T;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface MetaResponse {
  app: { name: string; tagline: string; version: string; build: string };
  engine: { kind: string; rendersOnServer: boolean; localWrites: boolean; cacheTtlSeconds: number; maxDocumentMb: number; timeoutSeconds: number };
  session: { phase: 'anonymous' | 'unlocked'; profileId: string | null; ttlMinutes: number; expiresAt: number };
  security: { zeroKnowledge: boolean; kdf: string; cipher: string; serverKeyEphemeral: boolean; autoLockMinutes: number };
  providers: ProviderDescriptor[];
  connections: PublicConnection[];
  localConnectionId: string;
  profiles: PublicProfile[];
  runtime: { node: string; env: string; sessions: number; unlockedSessions: number; cache: { entries: number; bytes: number }; downloads: { staged: number; bytes: number } };
}

export interface VaultEnvelope {
  revision: number;
  updatedAt: number;
  sizeBytes: number;
  checksum: string;
  vault: string;
  storage?: { providerId: string; connectionId: string; drivePath: string; quota: { used: number; total: number | null } };
}

export interface BrowseStats {
  cache: { entries: number; bytes: number };
  downloads: { staged: number; bytes: number };
  blockedRequests: number;
  blockedHosts: { host: string; count: number }[];
  ttlSeconds: number;
}

export interface StagedDownload {
  id: string;
  filename: string;
  url: string;
  size: number;
  mimeType: string;
  createdAt: number;
  origin: 'page' | 'vault' | 'cloud';
}

export interface CloudStatus {
  quota: { used: number; total: number | null };
  info: { label?: string; email?: string };
  files: { path: string; name: string; size: number; isDir: boolean; modifiedAt: number }[];
  providerId: string;
  connectionId: string;
  drivePath: string;
  revision: number;
  updatedAt: number;
  capabilities: ProviderDescriptor['capabilities'];
}

export interface Snapshot {
  revision: number;
  size: number;
  at: number;
  path: string;
}

export const api = {
  meta: () => request<MetaResponse>('/meta'),

  // -- profiles & session --------------------------------------------------
  profiles: () => request<{ profiles: PublicProfile[] }>('/profiles'),
  createProfile: (body: {
    label: string;
    hue?: number;
    kdf: { alg: 'PBKDF2-SHA256'; iterations: number; salt: string };
    authHash: string;
    vault: string;
    connectionId?: string;
  }) => request<{ profile: PublicProfile; browseToken?: string | null }>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  unlock: (body: { profileId: string; authHash: string }) =>
    request<{ profile: PublicProfile; vault: VaultEnvelope | null; session: { ttlMinutes: number; browseToken?: string | null } }>('/profiles/unlock', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  lock: () => request<{ locked: true }>('/profiles/lock', { method: 'POST' }),
  rekey: (profileId: string, body: { authHash: string; vault: string; label?: string; hue?: number }) =>
    request<{ profile: PublicProfile }>(`/profiles/${profileId}/rekey`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProfile: (profileId: string) => request<{ deleted: true }>(`/profiles/${profileId}`, { method: 'DELETE' }),

  // -- vault ---------------------------------------------------------------
  vault: () => request<VaultEnvelope>('/vault'),
  saveVault: (body: { vault: string; baseRevision?: number; snapshot?: boolean }) =>
    request<{ revision: number; updatedAt: number; sizeBytes: number; checksum: string }>('/vault', { method: 'PUT', body: JSON.stringify(body) }),
  snapshots: () => request<{ snapshots: Snapshot[] }>('/vault/snapshots'),
  restoreSnapshot: (path: string) => request<{ revision: number; checksum: string }>('/vault/restore', { method: 'POST', body: JSON.stringify({ path }) }),
  vaultFiles: () => request<{ providerId: string; drivePath: string; files: { path: string; name: string; size: number; isDir: boolean; modifiedAt: number }[]; quota: { used: number; total: number | null } }>('/vault/files'),

  // -- cloud ---------------------------------------------------------------
  providers: () => request<{ providers: ProviderDescriptor[]; connections: PublicConnection[] }>('/cloud/providers'),
  connections: () => request<{ connections: PublicConnection[]; localConnectionId: string }>('/cloud/connections'),
  connect: (body: { providerId: string; credentials?: Record<string, string>; label?: string; accountLabel?: string; simulated?: boolean }) =>
    request<{ connection: PublicConnection }>('/cloud/connections', { method: 'POST', body: JSON.stringify(body) }),
  testConnection: (id: string) => request<{ info: { label?: string; email?: string }; quota: { used: number; total: number | null } | null }>(`/cloud/connections/${id}/test`, { method: 'POST' }),
  disconnect: (id: string) => request<{ deleted: string }>(`/cloud/connections/${id}`, { method: 'DELETE' }),
  cloudStatus: () => request<CloudStatus>('/cloud/status'),
  moveVault: (profileId: string, connectionId: string) =>
    request<{ profile: PublicProfile; movedBytes: number }>(`/profiles/${profileId}/move`, { method: 'POST', body: JSON.stringify({ connectionId }) }),

  // -- browsing ------------------------------------------------------------
  browseStats: () => request<BrowseStats>('/browse/stats'),
  probe: (url: string) => request<{ url: string; title: string; excerpt: string; siteName: string; blockedHosts: string[] }>(`/browse/probe?u=${encodeURIComponent(url)}`),
  reader: (url: string, opts: { block?: boolean; nuisance?: boolean } = {}) =>
    request<{ url: string; reader: ReaderArticle }>(
      `/browse/reader?u=${encodeURIComponent(url)}${opts.block === false ? '&block=0' : ''}${opts.nuisance === false ? '&nuisance=0' : ''}`,
    ),
  stageDownload: (url: string, filename?: string) =>
    request<StagedDownload>('/browse/download', { method: 'POST', body: JSON.stringify({ url, filename }) }),
  downloads: () => request<{ downloads: StagedDownload[]; stats: { staged: number; bytes: number } }>('/browse/downloads'),
  clearDownloads: () => request<{ cleared: true }>('/browse/downloads', { method: 'DELETE' }),
};

export interface ReaderArticle {
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  lang?: string;
  publishedAt?: string;
  blocks: { kind: string; text?: string; href?: string; src?: string; alt?: string }[];
  wordCount: number;
  readingMinutes: number;
}

/** URLs the shell renders itself — never sent to the engine. */
export const INTERNAL_SCHEME = 'nimbus://';

export const internalPages = ['start', 'bookmarks', 'history', 'downloads', 'notes', 'passwords', 'cards', 'cloud', 'privacy', 'settings'] as const;
export type InternalPage = (typeof internalPages)[number];

export const isInternal = (url: string): url is `${typeof INTERNAL_SCHEME}${InternalPage}` =>
  internalPages.includes(url.replace(INTERNAL_SCHEME, '').replace(/^\/+/, '').split(/[/?#]/)[0] as InternalPage);

/**
 * Absolute URL of a document rendered by the cloud engine.
 *
 * The frame is sandboxed without `allow-same-origin`, so it has an opaque
 * origin and its requests may not carry the session cookie: the render token
 * is passed explicitly instead. It is session-scoped and wiped on lock.
 */
export const engineViewUrl = (target: string, opts: { block?: boolean; nuisance?: boolean; token?: string | null } = {}): string =>
  `/api/browse/view?u=${encodeURIComponent(target)}${opts.block === false ? '&block=0' : ''}${opts.nuisance === false ? '&nuisance=0' : ''}${
    opts.token ? `&t=${encodeURIComponent(opts.token)}` : ''
  }`;

/**
 * Recover the real target from an engine URL. The in-page shim proxies links
 * before bubbling them up, and the shell must show (and re-request) the
 * canonical address rather than a proxy wrapper around a proxy wrapper.
 */
export const unwrapEngineUrl = (url: string): string => {
  if (!url) return url;
  const marker = '/api/browse/view?';
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  const target = new URLSearchParams(url.slice(idx + marker.length)).get('u');
  return target ? target : url;
};

export const engineCollectUrl = (downloadId: string): string => `/api/browse/downloads/${encodeURIComponent(downloadId)}`;

export const driveStreamUrl = (path: string): string => `/api/vault/files/stream?path=${encodeURIComponent(path)}`;

export type { Vault, ProviderDescriptor, PublicConnection, PublicProfile };
