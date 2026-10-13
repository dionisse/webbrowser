import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('session');

export type SessionPhase = 'anonymous' | 'unlocked';

export interface SessionScratch {
  /** Ephemeral browse-cache entries created by this session. Wiped on lock. */
  cacheKeys: string[];
  /** Pending download ids staged in memory. Wiped on lock. */
  downloadIds: string[];
}

export interface Session {
  id: string;
  tokenHash: string;
  phase: SessionPhase;
  profileId: string | null;
  providerId: string | null;
  /**
   * Short-lived token stamped into rewritten proxy URLs. The rendered frame is
   * sandboxed without `allow-same-origin`, so it cannot read Nimbus cookies or
   * call the vault API — this token is the only thing that lets its
   * subresources reach the browsing engine, and it dies with the session.
   */
  browseToken: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
  scratch: SessionScratch;
}

const TTL_MS = config.sessionTtlMinutes * 60_000;
const sessions = new Map<string, Session>();

export const newToken = (): string => randomBytes(32).toString('base64url');

export function createSession(meta: { ip: string; userAgent: string }): { session: Session; token: string } {
  const token = newToken();
  const now = Date.now();
  const session: Session = {
    id: randomUUID(),
    tokenHash: hashToken(token),
    phase: 'anonymous',
    profileId: null,
    providerId: null,
    browseToken: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + TTL_MS,
    ip: meta.ip,
    userAgent: meta.userAgent,
    scratch: { cacheKeys: [], downloadIds: [] },
  };
  sessions.set(session.id, session);
  return { session, token };
}

export function getSession(token: string | undefined | null): Session | undefined {
  if (!token) return undefined;
  const hash = hashToken(token);
  for (const s of sessions.values()) {
    if (s.tokenHash === hash) {
      if (s.expiresAt < Date.now()) {
        destroySession(s.id);
        return undefined;
      }
      return s;
    }
  }
  return undefined;
}

export function touch(session: Session): void {
  const now = Date.now();
  session.lastSeenAt = now;
  session.expiresAt = now + TTL_MS;
}

export function unlockSession(session: Session, profileId: string, providerId: string): void {
  session.phase = 'unlocked';
  session.profileId = profileId;
  session.providerId = providerId;
  session.browseToken = `${session.id.slice(0, 8)}.${randomBytes(12).toString('base64url')}`;
  touch(session);
  log.info(`session unlocked profile=${profileId} provider=${providerId}`);
}

/** Constant-time-ish lookup used by the browsing engine. */
export function sessionByBrowseToken(token: string | undefined | null): Session | undefined {
  if (!token) return undefined;
  for (const s of sessions.values()) {
    if (s.browseToken === token && s.phase === 'unlocked') {
      if (s.expiresAt < Date.now()) {
        destroySession(s.id);
        return undefined;
      }
      touch(s);
      return s;
    }
  }
  return undefined;
}

/**
 * Locking is destructive by design: every ephemeral artifact tied to the
 * session (rendered page cache, staged downloads) is dropped so nothing about
 * the browsing session survives the lock.
 */
export function lockSession(session: Session): void {
  session.phase = 'anonymous';
  session.profileId = null;
  session.browseToken = null;
  session.scratch = { cacheKeys: [], downloadIds: [] };
  touch(session);
  log.info('session locked and scratch wiped');
}

export function destroySession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.scratch = { cacheKeys: [], downloadIds: [] };
  sessions.delete(id);
}

export function sessionCount(): number {
  return sessions.size;
}

export function unlockedSessions(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.phase === 'unlocked') n++;
  return n;
}

/**
 * Tokens are only ever compared through their digest; the raw value lives in
 * the httpOnly cookie and nowhere on disk.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

let sweep: NodeJS.Timeout | undefined;
export function startSessionSweeper(): void {
  if (sweep) return;
  sweep = setInterval(() => {
    const now = Date.now();
    let dropped = 0;
    for (const [id, s] of sessions) {
      if (s.expiresAt < now) {
        destroySession(id);
        dropped++;
      }
    }
    if (dropped) log.info(`swept ${dropped} expired session(s), ${sessions.size} remaining`);
  }, 60_000);
  sweep.unref();
}

export function stopSessionSweeper(): void {
  if (sweep) clearInterval(sweep);
  sweep = undefined;
}

export const sessionTtlMs = TTL_MS;
