import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/http.js';
import { createSession, getSession, sessionByBrowseToken, touch, type Session } from './store.js';

export const SESSION_COOKIE = 'nimbus_sid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: Session;
      sessionToken: string;
      sessionIsNew: boolean;
      /** True when the caller proved itself with `?t=<browseToken>` instead of the cookie. */
      sessionViaBrowseToken: boolean;
    }
  }
}

const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  path: '/',
  maxAge: 1000 * 60 * 60 * 12,
});

/**
 * Every request carries a session. Anonymous sessions may only reach public
 * endpoints (bootstrap, provider catalogue); unlocked sessions reach the vault
 * and browsing engine.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.cookies?.[SESSION_COOKIE] as string | undefined;
  let session = getSession(incoming);
  let token = incoming ?? '';
  let isNew = false;
  let viaBrowseToken = false;

  /*
   * The rendered page lives in a sandboxed frame with an opaque origin, so its
   * requests carry no cookie — only the render token. Adopting the owning
   * session here keeps one session per user (instead of one per subresource)
   * and lets engine counters land on the right session. It grants nothing new:
   * `requireUnlocked` still refuses token-only callers.
   */
  if (!session) {
    const presented = typeof req.query?.t === 'string' ? req.query.t : undefined;
    const adopted = presented ? sessionByBrowseToken(presented) : undefined;
    if (adopted) {
      session = adopted;
      token = presented as string;
      viaBrowseToken = true;
    }
  }

  if (!session) {
    const created = createSession({
      ip: req.ip ?? 'unknown',
      userAgent: req.get('user-agent') ?? 'unknown',
    });
    session = created.session;
    token = created.token;
    isNew = true;
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.cookie(SESSION_COOKIE, token, cookieOptions(secure));
  } else if (!viaBrowseToken) {
    touch(session);
  }

  req.session = session;
  req.sessionToken = token;
  req.sessionIsNew = isNew;
  req.sessionViaBrowseToken = viaBrowseToken;
  res.setHeader('X-Nimbus-Session', session.phase);
  next();
}

export function requireUnlocked(req: Request, _res: Response, next: NextFunction): void {
  // The render token authorises the browsing engine only: the vault, profiles
  // and cloud routes still require the session cookie, which the sandboxed
  // frame cannot read or replay.
  if (req.session.phase !== 'unlocked' || req.sessionViaBrowseToken) {
    next(unauthorized('Session is locked. Unlock with your master password.'));
    return;
  }
  next();
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
}
