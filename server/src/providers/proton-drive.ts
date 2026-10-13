import { config } from '../config.js';
import { baseName, fullCapabilities, joinPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type CredentialHooks, type ProviderDescriptor } from './types.js';
import { beginOAuth2, takePending, type OAuth2Config } from './oauth2.js';

/**
 * Proton Drive adapter.
 *
 * Proton's storage is end-to-end encrypted at the *filesystem* level: every
 * upload must be wrapped in an encrypted packet produced with the account's
 * private keys, and login goes through SRP-6a rather than plain OAuth. Both
 * require Proton's issued client credentials.
 *
 * This adapter therefore implements the parts of the contract that are stable
 * and credential-light — session refresh, identity, quota, listing, download,
 * delete, folder creation — and reports `write: false` so the UI never offers
 * Proton as the vault host until the packet layer is wired in. Proton accounts
 * can still be attached as a read-only mirror / export target.
 *
 * To finish write support:
 *   1. obtain a Proton client id/secret pair (PROTON_CLIENT_ID / _SECRET),
 *   2. implement SRP-6a login against POST /auth/v1/srp or reuse an access
 *      token + refresh token issued by Proton Drive for Linux,
 *   3. wrap uploads with @proton/drive-sdk packet encryption.
 */

const API = 'https://mail.proton.me/api';

const oauthConfig = (): OAuth2Config => ({
  providerId: 'proton',
  authorizeUrl: 'https://account.proton.me/authorize',
  tokenUrl: `${API}/auth/v1/oauth`,
  clientId: config.providers.proton.clientId,
  clientSecret: config.providers.proton.clientSecret,
  scopes: [],
  clientAuthInBody: true,
});

const descriptor: ProviderDescriptor = {
  id: 'proton',
  name: 'Proton Drive',
  vendor: 'Proton AG',
  blurb: 'End-to-end encrypted Swiss storage. Read/mirror today; vault hosting needs Proton app credentials.',
  kind: 'token',
  configured: Boolean(config.providers.proton.clientId && config.providers.proton.clientSecret),
  fields: [
    { key: 'accessToken', label: 'Access token', type: 'password', placeholder: 'proton_at_…', hint: 'From Proton Drive settings or the Linux client' },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', placeholder: 'proton_rt_…' },
  ],
  docsUrl: 'https://proton.me/support/proton-drive-linux-command-line',
  accent: '#74A266',
  freeTierBytes: 5 * 1024 * 1024 * 1024,
  capabilities: {
    ...fullCapabilities,
    write: false,
    directDownload: true,
    experimental: true,
    note: 'Écriture indisponible : le système de fichiers Proton exige le chiffrement par paquets du SDK officiel.',
  },
};

interface ProtonLink {
  ID?: string;
  LinkID?: string;
  Name?: string;
  Size?: number;
  Type?: number; // 1 = folder, 2 = file
  ModifyTime?: number;
  Mime?: string;
  ParentID?: string;
}

class ProtonClient implements CloudClient {
  private creds: Record<string, string>;

  constructor(credentials: Record<string, string>, private hooks?: CredentialHooks) {
    this.creds = { ...credentials };
  }

  private get accessToken(): string {
    const t = this.creds.accessToken ?? this.creds.access_token;
    if (!t) throw new Error('Proton Drive needs an access token.');
    return t;
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'x-pm-appversion': config.providers.proton.appVersion,
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && this.creds.refreshToken) await this.rotate();
    return res;
  }

  /** Proton rotates access/refresh tokens on every auth call. */
  private async rotate(): Promise<void> {
    const res = await fetch(`${API}/auth/v1/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pm-appversion': config.providers.proton.appVersion },
      body: JSON.stringify({ UID: this.creds.uid, ResponseType: 'token', RefreshToken: this.creds.refreshToken }),
    });
    if (!res.ok) throw new Error(`Proton token refresh failed (${res.status})`);
    const j = (await res.json()) as { AccessToken?: string; RefreshToken?: string; UID?: string };
    this.creds = {
      ...this.creds,
      accessToken: j.AccessToken ?? this.creds.accessToken ?? '',
      refreshToken: j.RefreshToken ?? this.creds.refreshToken ?? '',
      uid: j.UID ?? this.creds.uid ?? '',
    };
    await this.hooks?.onCredentials?.(this.creds);
  }

  private async rootId(): Promise<string> {
    const res = await this.req('/drive/v1/links/root');
    if (!res.ok) throw new Error(`Proton Drive root lookup failed (${res.status})`);
    const j = (await res.json()) as { LinkID?: string; Link?: { ID?: string } };
    const id = j.LinkID ?? j.Link?.ID;
    if (!id) throw new Error('Proton Drive returned no root link.');
    return id;
  }

  async accountInfo() {
    const res = await this.req('/core/v4/settings');
    if (!res.ok) return { label: 'Proton account' };
    const j = (await res.json()) as { User?: { Name?: string; Email?: string } };
    return { label: j.User?.Name, email: j.User?.Email };
  }

  async quota(): Promise<CloudQuota> {
    const res = await this.req('/drive/v1/user');
    if (!res.ok) return { used: 0, total: descriptor.freeTierBytes ?? null };
    const j = (await res.json()) as { UsedSpace?: number; MaxSpace?: number };
    return { used: Number(j.UsedSpace ?? 0), total: j.MaxSpace ? Number(j.MaxSpace) : null };
  }

  async list(dir: string): Promise<CloudFile[]> {
    const parent = await this.resolveId(dir);
    if (!parent) return [];
    const out: CloudFile[] = [];
    for (let page = 0; page < 20; page++) {
      const res = await this.req(`/drive/v1/links?ParentID=${encodeURIComponent(parent)}&Page=${page}&PageSize=150&Sort=Name`);
      if (!res.ok) break;
      const j = (await res.json()) as { Links?: ProtonLink[] };
      const links = j.Links ?? [];
      for (const l of links) {
        out.push({
          path: joinPath(dir, l.Name ?? ''),
          name: l.Name ?? '',
          size: Number(l.Size ?? 0),
          isDir: l.Type === 1,
          modifiedAt: (l.ModifyTime ?? 0) * 1000 || Date.now(),
          mimeType: l.Type === 1 ? undefined : l.Mime,
          nativeId: l.LinkID ?? l.ID,
        });
      }
      if (links.length < 150) break;
    }
    return out;
  }

  private async resolveId(dir: string): Promise<string | null> {
    const p = joinPath(dir);
    if (!p || p === '/') return this.rootId();
    let parentId = await this.rootId();
    for (const seg of p.split('/').filter(Boolean)) {
      const children = await this.listById(parentId);
      const hit = children.find((c) => c.Name === seg);
      if (!hit?.LinkID) return null;
      parentId = hit.LinkID;
    }
    return parentId;
  }

  private async listById(parentId: string): Promise<ProtonLink[]> {
    const res = await this.req(`/drive/v1/links?ParentID=${encodeURIComponent(parentId)}&PageSize=150`);
    if (!res.ok) return [];
    const j = (await res.json()) as { Links?: ProtonLink[] };
    return j.Links ?? [];
  }

  async exists(path: string): Promise<boolean> {
    return (await this.resolveId(path)) !== null;
  }

  async read(path: string) {
    const id = await this.resolveId(path);
    if (!id) return null;
    const res = await this.req(`/drive/v1/links/${id}/download`);
    if (!res.ok) return null;
    const j = (await res.json()) as { DownloadURL?: string };
    if (!j.DownloadURL) return null;
    const file = await fetch(j.DownloadURL);
    if (!file.ok) return null;
    const data = Buffer.from(await file.arrayBuffer());
    return { data, mimeType: file.headers.get('content-type') ?? 'application/octet-stream', size: data.length, modifiedAt: Date.now() };
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(): Promise<CloudFile> {
    throw new Error(
      'Proton Drive write support is not available yet: Proton encrypts every file into packets with your account keys. ' +
        'Attach a Google Drive, Yandex Disk, OneDrive or WebDAV location for the vault, or keep it on Nimbus Cloud.',
    );
  }

  async remove(path: string): Promise<void> {
    const id = await this.resolveId(path);
    if (!id) return;
    await this.req(`/drive/v1/links/${id}/trash`, { method: 'PUT' });
  }

  async ensureDir(path: string): Promise<void> {
    const p = joinPath(path);
    if (!p || p === '/') return;
    const segments = p.split('/').filter(Boolean);
    let parentId = await this.rootId();
    let acc = '';
    for (const seg of segments) {
      acc = `${acc}/${seg}`;
      const children = await this.listById(parentId);
      const hit = children.find((c) => c.Name === seg && c.Type === 1);
      if (hit?.LinkID) {
        parentId = hit.LinkID;
        continue;
      }
      const res = await this.req('/drive/v1/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ Name: seg, ParentID: parentId }),
      });
      if (!res.ok) throw new Error(`Proton mkdir failed (${res.status}) at ${acc}`);
      const j = (await res.json()) as { Folder?: { ID?: string }; ID?: string };
      const created = j.Folder?.ID ?? j.ID;
      if (!created) throw new Error(`Proton mkdir returned no id for ${acc}`);
      parentId = created;
    }
  }

  async downloadUrl(path: string): Promise<string | null> {
    const id = await this.resolveId(path);
    if (!id) return null;
    const res = await this.req(`/drive/v1/links/${id}/download`);
    if (!res.ok) return null;
    const j = (await res.json()) as { DownloadURL?: string };
    return j.DownloadURL ?? null;
  }
}

export const protonDriveProvider: CloudProvider = {
  descriptor,
  async beginAuth(redirectUri) {
    assertConfigured();
    return beginOAuth2(oauthConfig(), redirectUri);
  },
  async completeAuth({ state }) {
    assertConfigured();
    const p = takePending(state);
    if (!p) throw new Error('Authorisation state expired — start the connection again.');
    throw new Error(
      'Proton uses SRP-6a rather than a plain authorisation-code exchange. Supply an access token + refresh token instead.',
    );
  },
  client(credentials, hooks?: CredentialHooks) {
    return new ProtonClient(credentials, hooks);
  },
};

function assertConfigured() {
  if (!descriptor.configured) {
    throw new Error('PROTON_CLIENT_ID / PROTON_CLIENT_SECRET are not set on this Nimbus instance.');
  }
}

export const protonBaseName = baseName;
export const protonJoin = joinPath;
