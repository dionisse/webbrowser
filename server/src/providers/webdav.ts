import { baseName, fullCapabilities, joinPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type ProviderDescriptor } from './types.js';
import { config } from '../config.js';

/**
 * Generic WebDAV adapter — the "or something else" escape hatch.
 *
 * Works out of the box with pCloud, Nextcloud, ownCloud, Infomaniak kDrive,
 * Baikal, Zimbra, Fastmail Files and any other RFC 4918 server. Credentials are
 * HTTP Basic, sealed at rest by the server and never sent to the browser.
 */

const descriptor: ProviderDescriptor = {
  id: 'webdav',
  name: 'WebDAV',
  vendor: 'pCloud · Nextcloud · kDrive · …',
  blurb: 'Any RFC 4918 server: pCloud, Nextcloud, ownCloud, Infomaniak kDrive, Baikal, Fastmail Files.',
  kind: 'basic',
  configured: true,
  fields: [
    { key: 'url', label: 'Server URL', type: 'url', placeholder: 'https://webdav.pcloud.com', hint: 'Nextcloud: https://cloud.example.com/remote.php/dav/files/USERNAME' },
    { key: 'username', label: 'Username', type: 'text', placeholder: 'you@example.com' },
    { key: 'password', label: 'Password / app token', type: 'password', placeholder: '••••••••', hint: 'Prefer an app-specific token over your main password' },
    { key: 'root', label: 'Base folder (optional)', type: 'text', placeholder: 'nimbus' },
  ],
  accent: '#52392C',
  capabilities: { ...fullCapabilities, directDownload: false },
};

interface DavItem {
  href: string;
  isCollection: boolean;
  length: number;
  modified: number;
  contentType?: string;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Minimal multistatus parser — enough for RFC 4918 servers, no XML dependency. */
function parseMultiStatus(xml: string): DavItem[] {
  const items: DavItem[] = [];
  const blocks = xml.split(/<\w*:?response[\s>]/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/\w*:?response>/i)[0] ?? '';
    const href = block.match(/<\w*:?href[^>]*>([\s\S]*?)<\/\w*:?href>/i)?.[1]?.trim();
    if (!href) continue;
    const propstat = block;
    const isCollection = /<\w*:?collection\s*\/?>/i.test(propstat);
    const length = Number(propstat.match(/<\w*:?getcontentlength[^>]*>([\s\S]*?)<\/\w*:?getcontentlength>/i)?.[1] ?? 0);
    const modifiedRaw = propstat.match(/<\w*:?getlastmodified[^>]*>([\s\S]*?)<\/\w*:?getlastmodified>/i)?.[1];
    const contentType = propstat.match(/<\w*:?getcontenttype[^>]*>([\s\S]*?)<\/\w*:?getcontenttype>/i)?.[1];
    items.push({
      href: decodeEntities(href),
      isCollection,
      length: Number.isFinite(length) ? length : 0,
      modified: modifiedRaw ? Date.parse(decodeEntities(modifiedRaw)) || Date.now() : Date.now(),
      contentType: contentType ? decodeEntities(contentType).trim() : undefined,
    });
  }
  return items;
}

class WebDavClient implements CloudClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(credentials: Record<string, string>) {
    const raw = (credentials.url ?? config.providers.webdav.defaultUrl ?? '').replace(/\/+$/, '');
    if (!raw) throw new Error('A WebDAV server URL is required.');
    const root = (credentials.root ?? '').replace(/^\/+|\/+$/g, '');
    this.baseUrl = root ? `${raw}/${root}` : raw;
    this.authHeader = `Basic ${Buffer.from(`${credentials.username ?? ''}:${credentials.password ?? ''}`, 'utf8').toString('base64')}`;
  }

  private urlFor(path: string): string {
    const p = joinPath(path);
    return p === '/' ? `${this.baseUrl}/` : `${this.baseUrl}${p}`;
  }

  private async dav(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(this.urlFor(path), {
      ...init,
      headers: { authorization: this.authHeader, ...(init.headers ?? {}) },
      redirect: 'follow',
    });
  }

  async accountInfo() {
    const res = await this.dav('/', {
      method: 'PROPFIND',
      headers: { depth: '0', 'content-type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/><d:current-user-principal/></d:prop></d:propfind>',
    });
    if (!res.ok) return { label: new URL(this.baseUrl).host };
    return { label: new URL(this.baseUrl).host };
  }

  async quota(): Promise<CloudQuota> {
    const res = await this.dav('/', {
      method: 'PROPFIND',
      headers: { depth: '0', 'content-type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>',
    });
    if (!res.ok) return { used: 0, total: null };
    const xml = await res.text();
    const used = Number(xml.match(/<\w*:?quota-used-bytes[^>]*>(\d+)/i)?.[1] ?? 0);
    const available = Number(xml.match(/<\w*:?quota-available-bytes[^>]*>(\d+)/i)?.[1] ?? NaN);
    return {
      used,
      total: Number.isFinite(available) && available >= 0 ? used + available : null,
    };
  }

  async list(dir: string): Promise<CloudFile[]> {
    const res = await this.dav(dir, {
      method: 'PROPFIND',
      headers: { depth: '1', 'content-type': 'application/xml' },
      body:
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>' +
        '<d:getlastmodified/><d:getcontentlength/><d:getcontenttype/><d:resourcetype/>' +
        '</d:prop></d:propfind>',
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`WebDAV PROPFIND failed (${res.status}) on ${dir}`);
    const items = parseMultiStatus(await res.text());
    const selfHref = decodeURIComponent(new URL(this.urlFor(dir)).pathname).replace(/\/$/, '');
    return items
      .filter((i) => {
        const p = decodeURIComponent(new URL(i.href, this.baseUrl).pathname).replace(/\/$/, '');
        return p !== selfHref;
      })
      .map((i) => {
        const name = decodeURIComponent(i.href.split('/').filter(Boolean).pop() ?? '');
        return {
          path: joinPath(dir, name),
          name,
          size: i.length,
          isDir: i.isCollection,
          modifiedAt: i.modified,
          mimeType: i.isCollection ? undefined : i.contentType,
        };
      })
      .filter((f) => f.name);
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.dav(path, {
      method: 'PROPFIND',
      headers: { depth: '0', 'content-type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    });
    return res.ok;
  }

  async read(path: string) {
    const res = await this.dav(path, { method: 'GET' });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    const modified = res.headers.get('last-modified');
    return {
      data,
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: data.length,
      modifiedAt: modified ? Date.parse(modified) : Date.now(),
    };
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(path: string, data: Buffer | string, mimeType = 'application/octet-stream'): Promise<CloudFile> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const res = await this.dav(path, { method: 'PUT', headers: { 'content-type': mimeType }, body: buf });
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`WebDAV PUT failed (${res.status}) on ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    return { path: joinPath(path), name: baseName(path), size: buf.length, isDir: false, modifiedAt: Date.now(), mimeType };
  }

  async remove(path: string): Promise<void> {
    const res = await this.dav(path, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`WebDAV DELETE failed (${res.status}) on ${path}`);
  }

  async ensureDir(path: string): Promise<void> {
    const p = joinPath(path);
    if (!p || p === '/') return;
    const segments = p.split('/').filter(Boolean);
    let acc = '';
    for (const seg of segments) {
      acc = `${acc}/${seg}`;
      const res = await this.dav(acc, { method: 'MKCOL' });
      // 405 = already exists on most servers, 409 on some.
      if (!res.ok && res.status !== 405 && res.status !== 409) {
        throw new Error(`WebDAV MKCOL failed (${res.status}) at ${acc}`);
      }
    }
  }

  async downloadUrl(): Promise<string | null> {
    return null;
  }
}

export const webDavProvider: CloudProvider = {
  descriptor,
  async beginAuth() {
    throw new Error('WebDAV uses HTTP Basic credentials entered in the Nimbus UI.');
  },
  async completeAuth() {
    throw new Error('WebDAV uses HTTP Basic credentials entered in the Nimbus UI.');
  },
  client(credentials) {
    return new WebDavClient(credentials);
  },
};
