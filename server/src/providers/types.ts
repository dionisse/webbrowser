/**
 * Cloud storage provider abstraction.
 *
 * Nimbus never owns your data: the encrypted vault is written to *your* Drive.
 * A provider is a thin adapter that turns "read/write a path" into the REST
 * dialect of Google Drive, Yandex Disk, OneDrive, Proton Drive or any WebDAV
 * server. Adding a provider means implementing this interface and registering
 * it in providers/registry.ts.
 */

export interface CloudFile {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  modifiedAt: number;
  mimeType?: string;
  /** Provider-native identifier, kept for efficient follow-up calls. */
  nativeId?: string;
}

export interface CloudQuota {
  used: number;
  total: number | null;
}

export interface CloudReadResult {
  data: Buffer;
  mimeType: string;
  size: number;
  modifiedAt: number;
}

export interface CloudClient {
  /** Human-readable account identity, e.g. "marie@gmail.com". */
  accountInfo(): Promise<{ label?: string; email?: string }>;
  quota(): Promise<CloudQuota>;
  list(dir: string): Promise<CloudFile[]>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<CloudReadResult | null>;
  readText(path: string): Promise<string | null>;
  write(path: string, data: Buffer | string, mimeType?: string): Promise<CloudFile>;
  remove(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  /**
   * A short-lived direct link so the user can pull a file down to their own
   * machine on demand. Returns null when the provider cannot issue one, in
   * which case the API streams the bytes instead.
   */
  downloadUrl(path: string): Promise<string | null>;
}

export type AuthKind = 'none' | 'oauth2' | 'token' | 'basic';

/** What an adapter can actually do. Surfaced in the UI so nothing is over-promised. */
export interface ProviderCapabilities {
  list: boolean;
  read: boolean;
  /** Required to host the vault. Providers without it are read-only mirrors. */
  write: boolean;
  delete: boolean;
  quota: boolean;
  /** Can hand out a pre-authenticated URL for "download to my computer". */
  directDownload: boolean;
  /** True when the adapter is still missing pieces; the UI shows a beta badge. */
  experimental?: boolean;
  note?: string;
}

export const fullCapabilities: ProviderCapabilities = {
  list: true,
  read: true,
  write: true,
  delete: true,
  quota: true,
  directDownload: false,
};

export interface ProviderDescriptor {
  id: string;
  name: string;
  vendor: string;
  blurb: string;
  kind: AuthKind;
  capabilities: ProviderCapabilities;
  /** True when the server has the credentials needed for a real connection. */
  configured: boolean;
  /** What the user must supply in the UI when `kind` is token/basic. */
  fields?: { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string; hint?: string }[];
  scopes?: string[];
  docsUrl?: string;
  accent: string;
  /** Free storage tier, in bytes, used for the storage meter when quota is unknown. */
  freeTierBytes?: number;
}

export interface OAuthStart {
  url: string;
  state: string;
}

export interface OAuthResult {
  credentials: Record<string, string>;
  accountLabel?: string;
  email?: string;
}

/** Lets a client persist rotated OAuth tokens back into the connection store. */
export interface CredentialHooks {
  onCredentials?(next: Record<string, string>): Promise<void> | void;
}

export interface CloudProvider {
  readonly descriptor: ProviderDescriptor;
  beginAuth(redirectUri: string): Promise<OAuthStart>;
  completeAuth(params: { code: string; state: string; redirectUri: string }): Promise<OAuthResult>;
  client(credentials: Record<string, string>, hooks?: CredentialHooks): CloudClient;
}

/** Join path segments the way every object store expects: single slashes. */
export const joinPath = (...parts: string[]): string =>
  '/' +
  parts
    .join('/')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.')
    .join('/');

export const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

export const parentPath = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
};
