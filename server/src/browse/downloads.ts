import { randomUUID } from 'node:crypto';
import { createLogger } from '../lib/log.js';

const log = createLogger('downloads');

/**
 * Ephemeral download staging.
 *
 * A file fetched inside a cloud browsing session is held in memory only. It
 * reaches the user's computer exclusively when they press "download" — and it
 * is dropped as soon as it has been collected, when the session locks, or after
 * a short TTL. Nothing is ever written to disk on either side.
 */

export interface StagedDownload {
  id: string;
  sessionId: string;
  profileId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
  createdAt: number;
  collectedAt?: number;
  origin: 'page' | 'vault' | 'cloud';
}

const TTL_MS = 10 * 60_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 96 * 1024 * 1024;

const staged = new Map<string, StagedDownload>();

const totalBytes = () => [...staged.values()].reduce((n, d) => n + d.size, 0);

export function stage(input: Omit<StagedDownload, 'id' | 'createdAt'>): StagedDownload {
  gc();
  if (input.size > MAX_FILE_BYTES) {
    throw Object.assign(new Error(`Fichier trop volumineux pour la session cloud (${input.size} octets)`), { code: 'too_large' });
  }
  if (totalBytes() + input.size > MAX_TOTAL_BYTES) {
    // Evict oldest first rather than refusing outright.
    const oldest = [...staged.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const d of oldest) {
      if (totalBytes() + input.size <= MAX_TOTAL_BYTES) break;
      staged.delete(d.id);
    }
  }
  const download: StagedDownload = { ...input, id: randomUUID(), createdAt: Date.now() };
  staged.set(download.id, download);
  log.info(`staged download ${download.id} ${download.filename} (${download.size} bytes)`);
  return download;
}

export function peek(id: string, sessionId: string): StagedDownload | undefined {
  const d = staged.get(id);
  if (!d || d.sessionId !== sessionId) return undefined;
  return d;
}

/** Hand the bytes over once, then forget them. */
export function collect(id: string, sessionId: string): StagedDownload | undefined {
  const d = peek(id, sessionId);
  if (!d) return undefined;
  d.collectedAt = Date.now();
  staged.delete(id);
  log.info(`download ${id} collected and dropped from the cloud session`);
  return d;
}

export function drop(id: string): void {
  staged.delete(id);
}

/** Wipe everything belonging to a session — called on lock and on logout. */
export function dropSession(sessionId: string): void {
  let n = 0;
  for (const [id, d] of staged) {
    if (d.sessionId === sessionId) {
      staged.delete(id);
      n++;
    }
  }
  if (n) log.info(`dropped ${n} staged download(s) for session ${sessionId.slice(0, 8)}`);
}

export function listSession(sessionId: string): Omit<StagedDownload, 'data'>[] {
  gc();
  return [...staged.values()]
    .filter((d) => d.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ data: _data, ...rest }) => rest);
}

export function stats(): { staged: number; bytes: number } {
  gc();
  return { staged: staged.size, bytes: totalBytes() };
}

function gc(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, d] of staged) if (d.createdAt < cutoff) staged.delete(id);
}

export const safeFilename = (raw: string, fallback = 'download'): string => {
  const base = (raw || fallback).split(/[\\/]/).pop() ?? fallback;
  return base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '_').slice(0, 180) || fallback;
};

export const filenameFromDisposition = (disposition: string | undefined): string | undefined => {
  if (!disposition) return undefined;
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.replace(/^"|"$/g, ''));
    } catch {
      /* ignore */
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  return plain ? plain.trim() : undefined;
};

export const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return 'download';
  }
};
