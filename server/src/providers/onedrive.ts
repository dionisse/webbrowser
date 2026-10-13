import { config } from '../config.js';
import { baseName, fullCapabilities, joinPath, parentPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type CredentialHooks, type ProviderDescriptor } from './types.js';
import { beginOAuth2, decodeJwtPayload, exchangeCode, refresh, takePending, type OAuth2Config } from './oauth2.js';

/**
 * Microsoft OneDrive adapter (Graph API). This is the "Bing / Microsoft
 * account" storage option: any personal Microsoft account works.
 * https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 */

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

const oauthConfig = (): OAuth2Config => ({
  providerId: 'onedrive',
  authorizeUrl: `${AUTHORITY}/authorize`,
  tokenUrl: `${AUTHORITY}/token`,
  clientId: config.providers.onedrive.clientId,
  clientSecret: config.providers.onedrive.clientSecret,
  scopes: ['Files.ReadWrite.All', 'User.Read', 'offline_access'],
  pkce: true,
});

const descriptor: ProviderDescriptor = {
  id: 'onedrive',
  name: 'Microsoft OneDrive',
  vendor: 'Microsoft',
  blurb: 'Use a Microsoft / Bing account. Items larger than 4 MB upload in resumable chunks.',
  kind: 'oauth2',
  configured: Boolean(config.providers.onedrive.clientId && config.providers.onedrive.clientSecret),
  capabilities: { ...fullCapabilities, directDownload: true },
  scopes: ['Files.ReadWrite.All', 'User.Read', 'offline_access'],
  docsUrl: 'https://entra.microsoft.com/',
  accent: '#393D43',
  freeTierBytes: 5 * 1024 * 1024 * 1024,
};

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: Record<string, unknown>;
  file?: { mimeType?: string };
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
}

/** Graph addressable path: /root:/Nimbus/vault.enc  or  /root:/Nimbus:/children */
const itemPath = (p: string): string => {
  const clean = joinPath(p);
  return clean === '/' ? '/root' : `/root:${clean}`;
};

class OneDriveClient implements CloudClient {
  private creds: Record<string, string>;

  constructor(credentials: Record<string, string>, private hooks?: CredentialHooks) {
    this.creds = credentials;
  }

  private async token(): Promise<string> {
    const expiresAt = Number(this.creds.expires_at ?? 0);
    if (this.creds.access_token && (!expiresAt || expiresAt - 60_000 > Date.now())) return this.creds.access_token;
    if (!this.creds.refresh_token) throw new Error('OneDrive session expired — reconnect the provider.');
    const next = await refresh(oauthConfig(), this.creds.refresh_token);
    this.creds = { ...this.creds, ...next };
    await this.hooks?.onCredentials?.(this.creds);
    return this.creds.access_token!;
  }

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.token()}`, accept: 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401 && this.creds.refresh_token) {
      const next = await refresh(oauthConfig(), this.creds.refresh_token);
      this.creds = { ...this.creds, ...next };
      await this.hooks?.onCredentials?.(this.creds);
      return this.req(url, init);
    }
    return res;
  }

  async accountInfo() {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { authorization: `Bearer ${await this.token()}` },
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
    return { label: j.displayName, email: j.mail ?? j.userPrincipalName };
  }

  async quota(): Promise<CloudQuota> {
    const res = await this.req('/?fields=quota');
    if (!res.ok) return { used: 0, total: descriptor.freeTierBytes ?? null };
    const j = (await res.json()) as { quota?: { used?: number; total?: number } };
    return { used: Number(j.quota?.used ?? 0), total: j.quota?.total ? Number(j.quota.total) : null };
  }

  async list(dir: string): Promise<CloudFile[]> {
    const res = await this.req(`${itemPath(dir)}:/children?$top=200`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
    const j = (await res.json()) as { value?: DriveItem[] };
    return (j.value ?? []).map((i) => ({
      path: joinPath(dir, i.name),
      name: i.name,
      size: Number(i.size ?? 0),
      isDir: Boolean(i.folder),
      modifiedAt: i.lastModifiedDateTime ? Date.parse(i.lastModifiedDateTime) : Date.now(),
      mimeType: i.folder ? undefined : i.file?.mimeType,
      nativeId: i.id,
    }));
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.req(`${itemPath(path)}?$select=id,name`);
    return res.ok;
  }

  private async meta(path: string): Promise<DriveItem | null> {
    const res = await this.req(itemPath(path));
    if (!res.ok) return null;
    return (await res.json()) as DriveItem;
  }

  async read(path: string) {
    const res = await this.req(`${itemPath(path)}:/content`);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return {
      data,
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: data.length,
      modifiedAt: Date.now(),
    };
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(path: string, data: Buffer | string, mimeType = 'application/octet-stream'): Promise<CloudFile> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const SIMPLE_LIMIT = 4 * 1024 * 1024;

    if (buf.length <= SIMPLE_LIMIT) {
      const res = await this.req(`${itemPath(path)}:/content?@microsoft.graph.conflictBehavior=replace`, {
        method: 'PUT',
        headers: { 'content-type': mimeType },
        body: buf,
      });
      if (!res.ok) throw new Error(`OneDrive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as DriveItem;
      return toItem(path, j);
    }

    // Resumable upload session for larger payloads.
    const name = baseName(path);
    const session = await this.req(`${itemPath(parentPath(path))}:/children/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace', name, file: { mimeType } },
      }),
    });
    if (!session.ok) throw new Error(`OneDrive upload session failed (${session.status})`);
    const { uploadUrl } = (await session.json()) as { uploadUrl: string };
    const CHUNK = 5 * 1024 * 1024;
    let finalItem: DriveItem | undefined;
    for (let start = 0; start < buf.length; start += CHUNK) {
      const slice = buf.subarray(start, Math.min(start + CHUNK, buf.length));
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(slice.length),
          'content-range': `bytes ${start}-${start + slice.length - 1}/${buf.length}`,
        },
        body: slice,
      });
      if (!res.ok && res.status !== 202) throw new Error(`OneDrive chunk upload failed (${res.status})`);
      if (res.status === 200 || res.status === 201) finalItem = (await res.json()) as DriveItem;
    }
    return toItem(path, finalItem ?? { id: '', name, size: buf.length, file: { mimeType } });
  }

  async remove(path: string): Promise<void> {
    await this.req(itemPath(path), { method: 'DELETE' });
  }

  async ensureDir(path: string): Promise<void> {
    const p = joinPath(path);
    if (!p || p === '/') return;
    const segments = p.split('/').filter(Boolean);
    let acc = '';
    for (const seg of segments) {
      const parent = acc || '';
      acc = `${acc}/${seg}`;
      if (await this.exists(acc)) continue;
      const res = await this.req(`${itemPath(parent)}:/children`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: seg, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      });
      if (!res.ok && res.status !== 409) throw new Error(`OneDrive mkdir failed (${res.status}) at ${acc}`);
    }
  }

  async downloadUrl(path: string): Promise<string | null> {
    // Graph hands back a pre-authenticated URL — ideal for "download to my
    // computer" without exposing the token.
    const item = await this.meta(path);
    return item?.['@microsoft.graph.downloadUrl'] ?? null;
  }
}

const toItem = (path: string, i: DriveItem): CloudFile => ({
  path: joinPath(path),
  name: i.name || baseName(path),
  size: Number(i.size ?? 0),
  isDir: Boolean(i.folder),
  modifiedAt: i.lastModifiedDateTime ? Date.parse(i.lastModifiedDateTime) : Date.now(),
  mimeType: i.folder ? undefined : i.file?.mimeType,
  nativeId: i.id,
});

export const oneDriveProvider: CloudProvider = {
  descriptor,
  async beginAuth(redirectUri) {
    assertConfigured();
    return beginOAuth2(oauthConfig(), redirectUri);
  },
  async completeAuth({ code, state }) {
    assertConfigured();
    const p = takePending(state);
    if (!p) throw new Error('Authorisation state expired — start the connection again.');
    const credentials = await exchangeCode(oauthConfig(), code, p);
    const email = pickEmail(credentials);
    return { credentials, email, accountLabel: email };
  },
  client(credentials, hooks?: CredentialHooks) {
    return new OneDriveClient(credentials, hooks);
  },
};

function assertConfigured() {
  if (!descriptor.configured) {
    throw new Error('ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET are not set on this Nimbus instance.');
  }
}

function pickEmail(creds: Record<string, string>): string | undefined {
  if (creds.id_token) {
    const p = decodeJwtPayload(creds.id_token);
    const email = p.email ?? p.preferred_username;
    if (typeof email === 'string') return email;
  }
  return undefined;
}
