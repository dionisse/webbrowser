import { config } from '../config.js';
import { baseName, fullCapabilities, joinPath, parentPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type CredentialHooks, type ProviderDescriptor } from './types.js';
import { beginOAuth2, decodeJwtPayload, exchangeCode, refresh, takePending, type OAuth2Config } from './oauth2.js';

/**
 * Google Drive adapter (Drive API v3).
 *
 * Uses the least-privilege `drive.file` scope: Nimbus can only see the folder
 * and files it created itself, never the rest of your Drive.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const oauthConfig = (): OAuth2Config => ({
  providerId: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: config.providers.google.clientId,
  clientSecret: config.providers.google.clientSecret,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  pkce: true,
  extraAuthorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
});

const descriptor: ProviderDescriptor = {
  id: 'google',
  name: 'Google Drive',
  vendor: 'Google',
  blurb: 'Store your encrypted vault in your own Drive. Nimbus only ever sees the folder it creates.',
  kind: 'oauth2',
  configured: Boolean(config.providers.google.clientId && config.providers.google.clientSecret),
  capabilities: fullCapabilities,
  scopes: ['drive.file'],
  docsUrl: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  accent: '#74A266',
  freeTierBytes: 15 * 1024 * 1024 * 1024,
};

interface GFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
}

class GoogleDriveClient implements CloudClient {
  private pathCache = new Map<string, string>();

  constructor(
    private creds: Record<string, string>,
    private hooks?: CredentialHooks,
  ) {}

  private async token(): Promise<string> {
    const expiresAt = Number(this.creds.expires_at ?? 0);
    if (this.creds.access_token && (!expiresAt || expiresAt - 60_000 > Date.now())) {
      return this.creds.access_token;
    }
    if (!this.creds.refresh_token) throw new Error('Google Drive session expired — reconnect the provider.');
    const next = await refresh(oauthConfig(), this.creds.refresh_token);
    this.creds = { ...this.creds, ...next };
    await this.hooks?.onCredentials?.(this.creds);
    return this.creds.access_token!;
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const access = await this.token();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access}`, accept: 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401 && this.creds.refresh_token) {
      const next = await refresh(oauthConfig(), this.creds.refresh_token);
      this.creds = { ...this.creds, ...next };
      await this.hooks?.onCredentials?.(this.creds);
      return this.req(path, init);
    }
    return res;
  }

  async accountInfo() {
    const res = await this.req('/about?fields=user,storageQuota');
    if (!res.ok) return {};
    const j = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } };
    return { label: j.user?.displayName, email: j.user?.emailAddress };
  }

  async quota(): Promise<CloudQuota> {
    const res = await this.req('/about?fields=storageQuota');
    if (!res.ok) return { used: 0, total: descriptor.freeTierBytes ?? null };
    const j = (await res.json()) as { storageQuota?: { usage?: string; limit?: string } };
    return {
      used: Number(j.storageQuota?.usage ?? 0),
      total: j.storageQuota?.limit ? Number(j.storageQuota.limit) : (descriptor.freeTierBytes ?? null),
    };
  }

  /** Resolve a Nimbus path to a Google file id, creating folders as needed. */
  private async resolve(path: string, create: boolean): Promise<GFile | null> {
    const p = joinPath(path);
    const cached = this.pathCache.get(p);
    if (cached) {
      const meta = await this.meta(cached);
      if (meta) return meta;
      this.pathCache.delete(p);
    }

    const segments = p.split('/').filter(Boolean);
    let parentId = 'root';
    let current: GFile | null = null;

    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]!;
      const isLast = i === segments.length - 1;
      const found = await this.findChild(parentId, name);
      if (found) {
        current = found;
        parentId = found.id;
        continue;
      }
      if (!create || !isLast) {
        if (!create) return null;
        // Intermediate folders are always safe to create.
        if (!isLast) {
          const dir = await this.createFolder(parentId, name);
          current = dir;
          parentId = dir.id;
          continue;
        }
        return null;
      }
      return null;
    }

    if (current) this.pathCache.set(p, current.id);
    return current;
  }

  private async meta(id: string): Promise<GFile | null> {
    const res = await this.req(`/files/${id}?fields=id,name,mimeType,size,modifiedTime,parents`);
    if (!res.ok) return null;
    return (await res.json()) as GFile;
  }

  private async findChild(parentId: string, name: string): Promise<GFile | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const res = await this.req(`/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (!res.ok) throw new Error(`Google Drive search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { files?: GFile[] };
    return j.files?.[0] ?? null;
  }

  private async createFolder(parentId: string, name: string): Promise<GFile> {
    const res = await fetch(`${API}/files`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) throw new Error(`Google Drive mkdir failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as GFile;
  }

  async list(dir: string): Promise<CloudFile[]> {
    const target = await this.resolve(dir, false);
    if (!target) return [];
    const q = `'${target.id}' in parents and trashed = false`;
    const res = await this.req(`/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (!res.ok) return [];
    const j = (await res.json()) as { files?: GFile[] };
    return (j.files ?? []).map((f) => ({
      path: joinPath(dir, f.name),
      name: f.name,
      size: Number(f.size ?? 0),
      isDir: f.mimeType === FOLDER_MIME,
      modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
      mimeType: f.mimeType === FOLDER_MIME ? undefined : f.mimeType,
      nativeId: f.id,
    }));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.resolve(path, false)) !== null;
  }

  async read(path: string) {
    const target = await this.resolve(path, false);
    if (!target) return null;
    const res = await this.req(`/files/${target.id}?alt=media`);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return {
      data,
      mimeType: target.mimeType ?? 'application/octet-stream',
      size: data.length,
      modifiedAt: target.modifiedTime ? Date.parse(target.modifiedTime) : Date.now(),
    };
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(path: string, data: Buffer | string, mimeType = 'application/octet-stream'): Promise<CloudFile> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const name = baseName(path);
    await this.ensureDir(parentPath(path));
    const existing = await this.resolve(path, false);

    if (existing) {
      const res = await fetch(`${UPLOAD}/${existing.id}?uploadType=media&supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${await this.token()}`, 'content-type': mimeType },
        body: buf,
      });
      if (!res.ok) throw new Error(`Google Drive update failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as GFile;
      this.pathCache.set(joinPath(path), j.id);
      return toCloudFile(path, j);
    }

    const parentId = (await this.resolve(parentPath(path), true))?.id ?? 'root';
    const boundary = `nimbus_${Date.now().toString(36)}`;
    const head = Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n` +
        `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const res = await fetch(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, buf, tail]),
    });
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as GFile;
    this.pathCache.set(joinPath(path), j.id);
    return toCloudFile(path, j);
  }

  async remove(path: string): Promise<void> {
    const target = await this.resolve(path, false);
    if (!target) return;
    await this.req(`/files/${target.id}?supportsAllDrives=true`, { method: 'DELETE' });
    this.pathCache.delete(joinPath(path));
  }

  async ensureDir(path: string): Promise<void> {
    const p = joinPath(path);
    if (!p || p === '/') return;
    const segments = p.split('/').filter(Boolean);
    let parentId = 'root';
    for (const name of segments) {
      const found = await this.findChild(parentId, name);
      if (found) {
        parentId = found.id;
        continue;
      }
      const created = await this.createFolder(parentId, name);
      parentId = created.id;
    }
    this.pathCache.set(p, parentId);
  }

  async downloadUrl(): Promise<string | null> {
    // Google media links require a bearer token; Nimbus streams through
    // /api/files/stream instead so the token never reaches the browser.
    return null;
  }
}

const toCloudFile = (path: string, f: GFile): CloudFile => ({
  path: joinPath(path),
  name: f.name,
  size: Number(f.size ?? 0),
  isDir: f.mimeType === FOLDER_MIME,
  modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
  mimeType: f.mimeType === FOLDER_MIME ? undefined : f.mimeType,
  nativeId: f.id,
});

export const googleDriveProvider: CloudProvider = {
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
    return new GoogleDriveClient(credentials, hooks);
  },
};

function assertConfigured() {
  if (!descriptor.configured) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on this Nimbus instance.');
  }
}

function pickEmail(creds: Record<string, string>): string | undefined {
  if (creds.id_token) {
    const p = decodeJwtPayload(creds.id_token);
    if (typeof p.email === 'string') return p.email;
  }
  return undefined;
}
