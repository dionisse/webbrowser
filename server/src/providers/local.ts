import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { config } from '../config.js';
import { baseName, fullCapabilities, joinPath, type CloudClient, type CloudFile, type CloudProvider, type CloudQuota, type ProviderDescriptor } from './types.js';

/**
 * Local provider — the zero-configuration fallback.
 *
 * Files land in `server/data/vaults/<profileId>/...`. They hold *ciphertext
 * only* (the browser encrypts everything before upload), but this storage is
 * operated by Nimbus rather than by you, so the UI labels it clearly and offers
 * a one-click migration to your own Drive.
 */

const ROOT = resolve(config.dataDir, 'vaults');

const toFs = (profileId: string, path: string): string => {
  const clean = joinPath(path).replace(/^\/+/, '');
  const full = resolve(join(ROOT, profileId, ...clean.split('/')));
  // Hard containment check: never escape the profile directory.
  const prefix = resolve(join(ROOT, profileId)) + sep;
  if (full !== resolve(join(ROOT, profileId)) && !full.startsWith(prefix)) {
    throw new Error(`Refusing to access path outside profile sandbox: ${path}`);
  }
  return full;
};

const mimeOf = (name: string): string => {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.enc')) return 'application/octet-stream';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.txt') || name.endsWith('.md')) return 'text/plain';
  return 'application/octet-stream';
};

class LocalClient implements CloudClient {
  constructor(private readonly profileId: string) {}

  async accountInfo() {
    return { label: 'Nimbus Cloud (local)', email: undefined };
  }

  async quota(): Promise<CloudQuota> {
    const walk = async (dir: string): Promise<number> => {
      let total = 0;
      let entries: Dirent[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        total += e.isDirectory() ? await walk(p) : (await stat(p)).size;
      }
      return total;
    };
    const used = await walk(join(ROOT, this.profileId));
    return { used, total: 1024 * 1024 * 1024 }; // 1 GiB reference ceiling for the meter
  }

  async list(dir: string): Promise<CloudFile[]> {
    const fsDir = toFs(this.profileId, dir);
    let entries: Dirent[] = [];
    try {
      entries = await readdir(fsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: CloudFile[] = [];
    for (const e of entries) {
      const full = join(fsDir, e.name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      out.push({
        path: joinPath(dir, e.name),
        name: e.name,
        size: s.size,
        isDir: e.isDirectory(),
        modifiedAt: s.mtimeMs,
        mimeType: e.isDirectory() ? undefined : mimeOf(e.name),
      });
    }
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(toFs(this.profileId, path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string) {
    try {
      const fsPath = toFs(this.profileId, path);
      const [data, s] = await Promise.all([readFile(fsPath), stat(fsPath)]);
      return { data, mimeType: mimeOf(baseName(path)), size: s.size, modifiedAt: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.read(path);
    return r ? r.data.toString('utf8') : null;
  }

  async write(path: string, data: Buffer | string): Promise<CloudFile> {
    const fsPath = toFs(this.profileId, path);
    await mkdir(dirname(fsPath), { recursive: true });
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    await writeFile(fsPath, buf);
    const s = await stat(fsPath);
    return {
      path: joinPath(path),
      name: baseName(path),
      size: s.size,
      isDir: false,
      modifiedAt: s.mtimeMs,
      mimeType: mimeOf(baseName(path)),
    };
  }

  async remove(path: string): Promise<void> {
    await rm(toFs(this.profileId, path), { recursive: true, force: true });
  }

  async dropRoot(): Promise<void> {
    // The per-profile directory *is* the root for this provider.
    await rm(resolve(ROOT, this.profileId), { recursive: true, force: true });
  }

  async ensureDir(path: string): Promise<void> {
    await mkdir(toFs(this.profileId, path), { recursive: true });
  }

  async downloadUrl(): Promise<string | null> {
    return null;
  }
}

const descriptor: ProviderDescriptor = {
  id: 'local',
  name: 'Nimbus Cloud',
  vendor: 'Nimbus',
  blurb: 'Zero-configuration encrypted store hosted by Nimbus. Migrate to your own Drive at any time.',
  kind: 'none',
  configured: true,
  capabilities: fullCapabilities,
  accent: '#58595A',
  freeTierBytes: 1024 * 1024 * 1024,
};

export const localProvider: CloudProvider = {
  descriptor,
  async beginAuth() {
    throw new Error('The local provider needs no authorisation.');
  },
  async completeAuth() {
    throw new Error('The local provider needs no authorisation.');
  },
  client(_credentials) {
    return new LocalClient('default');
  },
};

/** Client bound to a specific profile directory. */
export const localClientFor = (profileId: string): CloudClient => new LocalClient(profileId);
export const localRoot = ROOT;
