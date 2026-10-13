import { createLogger } from '../lib/log.js';

const log = createLogger('cache');

/**
 * Ephemeral, in-memory page cache.
 *
 * Deliberately NOT persisted: this is the closest thing Nimbus has to a browser
 * cache and it lives only in RAM, scoped to the running process, and is wiped
 * when a session locks. Nothing about a browsing session touches disk.
 */

interface Entry {
  body: Buffer;
  mimeType: string;
  status: number;
  etag?: string;
  createdAt: number;
  ttlMs: number;
  hits: number;
}

export class EphemeralCache {
  private map = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxBytes = 96 * 1024 * 1024,
    private readonly maxEntries = 512,
  ) {}

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.createdAt > e.ttlMs) {
      this.delete(key);
      return undefined;
    }
    e.hits++;
    return e;
  }

  set(key: string, body: Buffer, mimeType: string, status = 200, ttlMs = this.defaultTtlMs, etag?: string): void {
    if (ttlMs <= 0) return;
    this.delete(key);
    this.map.set(key, { body, mimeType, status, etag, createdAt: Date.now(), ttlMs, hits: 0 });
    this.bytes += body.length;
    this.evict();
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (e) {
      this.bytes -= e.body.length;
      this.map.delete(key);
    }
  }

  private evict(): void {
    if (this.bytes <= this.maxBytes && this.map.size <= this.maxEntries) return;
    const entries = [...this.map.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [k] of entries) {
      if (this.bytes <= this.maxBytes && this.map.size <= this.maxEntries) break;
      this.delete(k);
    }
  }

  clear(): void {
    const n = this.map.size;
    this.map.clear();
    this.bytes = 0;
    if (n) log.info(`cache cleared (${n} entries dropped)`);
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.map.size, bytes: this.bytes };
  }
}
