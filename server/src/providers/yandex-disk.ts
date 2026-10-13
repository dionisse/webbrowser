import { config } from '../config.js';
import { baseName, fullCapabilities, joinPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type CredentialHooks, type ProviderDescriptor } from './types.js';
import { beginOAuth2, exchangeCode, refresh, takePending, type OAuth2Config } from './oauth2.js';

/** Yandex Disk REST API adapter — https://yandex.com/dev/disk/api/reference/ */

const API = 'https://cloud-api.yandex.net/v1/disk';

const oauthConfig = (): OAuth2Config => ({
  providerId: 'yandex',
  authorizeUrl: 'https://oauth.yandex.com/authorize',
  tokenUrl: 'https://oauth.yandex.com/token',
  clientId: config.providers.yandex.clientId,
  clientSecret: config.providers.yandex.clientSecret,
  scopes: ['disk:all', 'login:email'],
  clientAuthInBody: true,
});

const descriptor: ProviderDescriptor = {
  id: 'yandex',
  name: 'Yandex Disk',
  vendor: 'Yandex',
  blurb: 'Keep the encrypted vault on your Yandex Disk. Folder-based, no hidden app storage.',
  kind: 'oauth2',
  configured: Boolean(config.providers.yandex.clientId && config.providers.yandex.clientSecret),
  capabilities: fullCapabilities,
  scopes: ['disk:all', 'login:email'],
  docsUrl: 'https://oauth.yandex.com/',
  accent: '#B81908',
  freeTierBytes: 10 * 1024 * 1024 * 1024,
};

interface YResource {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modified?: string;
  media_type?: string;
}

const diskPath = (p: string): string => `disk:${joinPath(p)}`;

class YandexClient implements CloudClient {
  private creds: Record<string, string>;

  constructor(credentials: Record<string, string>, private hooks?: CredentialHooks) {
    this.creds = credentials;
  }

  private async token(): Promise<string> {
    const expiresAt = Number(this.creds.expires_at ?? 0);
    if (this.creds.access_token && (!expiresAt || expiresAt - 60_000 > Date.now())) return this.creds.access_token;
    if (!this.creds.refresh_token) throw new Error('Yandex Disk session expired — reconnect the provider.');
    const next = await refresh(oauthConfig(), this.creds.refresh_token);
    this.creds = { ...this.creds, ...next };
    await this.hooks?.onCredentials?.(this.creds);
    return this.creds.access_token!;
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `OAuth ${await this.token()}`, accept: 'application/json', ...(init.headers ?? {}) },
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
    const res = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { authorization: `OAuth ${await this.token()}` },
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { real_name?: string; default_email?: string; display_name?: string };
    return { label: j.display_name ?? j.real_name, email: j.default_email };
  }

  async quota(): Promise<CloudQuota> {
    const res = await this.req('/?fields=total_space,used_space');
    if (!res.ok) return { used: 0, total: descriptor.freeTierBytes ?? null };
    const j = (await res.json()) as { total_space?: number; used_space?: number };
    return { used: Number(j.used_space ?? 0), total: j.total_space ? Number(j.total_space) : null };
  }

  async list(dir: string): Promise<CloudFile[]> {
    const res = await this.req(`/resources?path=${encodeURIComponent(diskPath(dir))}&limit=500&fields=_embedded.items(name,path,type,size,modified,media_type)`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Yandex list failed (${res.status})`);
    const j = (await res.json()) as { _embedded?: { items?: YResource[] } };
    return (j._embedded?.items ?? []).map((i) => ({
      path: joinPath(dir, i.name),
      name: i.name,
      size: Number(i.size ?? 0),
      isDir: i.type === 'dir',
      modifiedAt: i.modified ? Date.parse(i.modified) : Date.now(),
      mimeType: i.type === 'dir' ? undefined : (i.media_type ?? 'application/octet-stream'),
    }));
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.req(`/resources?path=${encodeURIComponent(diskPath(path))}&fields=name`);
    return res.ok;
  }

  async read(path: string) {
    const href = await this.req(`/resources/download?path=${encodeURIComponent(diskPath(path))}`);
    if (!href.ok) return null;
    const j = (await href.json()) as { href?: string };
    if (!j.href) return null;
    const res = await fetch(j.href);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return { data, mimeType: res.headers.get('content-type') ?? 'application/octet-stream', size: data.length, modifiedAt: Date.now() };
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(path: string, data: Buffer | string, mimeType = 'application/octet-stream'): Promise<CloudFile> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const res = await this.req(
      `/resources/upload?path=${encodeURIComponent(diskPath(path))}&overwrite=true&fields=href,method`,
    );
    if (!res.ok) throw new Error(`Yandex upload handshake failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { href: string; method?: string };
    const put = await fetch(j.href, {
      method: j.method ?? 'PUT',
      headers: { 'content-type': mimeType, authorization: `OAuth ${await this.token()}` },
      body: buf,
    });
    if (!put.ok && put.status !== 201 && put.status !== 202) {
      throw new Error(`Yandex upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
    }
    return {
      path: joinPath(path),
      name: baseName(path),
      size: buf.length,
      isDir: false,
      modifiedAt: Date.now(),
      mimeType,
    };
  }

  async remove(path: string): Promise<void> {
    await this.req(`/resources?path=${encodeURIComponent(diskPath(path))}&permanently=false`, { method: 'DELETE' });
  }

  async ensureDir(path: string): Promise<void> {
    const p = joinPath(path);
    if (!p || p === '/') return;
    const segments = p.split('/').filter(Boolean);
    let acc = '';
    for (const seg of segments) {
      acc = `${acc}/${seg}`;
      const res = await this.req(`/resources?path=${encodeURIComponent(diskPath(acc))}`, { method: 'PUT' });
      // 409 = already exists, which is the outcome we want.
      if (!res.ok && res.status !== 409) throw new Error(`Yandex mkdir failed (${res.status}) at ${acc}`);
    }
  }

  async downloadUrl(): Promise<string | null> {
    return null; // Nimbus streams via /api/files/stream to keep the OAuth token server-side.
  }
}

export const yandexDiskProvider: CloudProvider = {
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
    const email = credentials.default_email || undefined;
    return { credentials, email, accountLabel: email };
  },
  client(credentials, hooks?: CredentialHooks) {
    return new YandexClient(credentials, hooks);
  },
};

function assertConfigured() {
  if (!descriptor.configured) {
    throw new Error('YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET are not set on this Nimbus instance.');
  }
}
