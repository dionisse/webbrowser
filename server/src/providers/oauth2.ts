import { createHash, randomBytes } from 'node:crypto';

export interface OAuth2Config {
  providerId: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /** Some providers (Google) accept/require PKCE; others reject unknown params. */
  pkce?: boolean;
  /** Extra params appended to the authorize URL. */
  extraAuthorizeParams?: Record<string, string>;
  /** Send client credentials in the body instead of a Basic header. */
  clientAuthInBody?: boolean;
}

export interface PendingAuth {
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  createdAt: number;
}

/** Short-lived in-memory store of CSRF state → PKCE verifier. */
const pending = new Map<string, PendingAuth>();

export function beginOAuth2(cfg: OAuth2Config, redirectUri: string): { url: string; state: string } {
  const state = randomBytes(18).toString('base64url');
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state,
    ...(cfg.extraAuthorizeParams ?? {}),
  });

  let codeVerifier: string | undefined;
  if (cfg.pkce) {
    codeVerifier = randomBytes(48).toString('base64url');
    params.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'));
    params.set('code_challenge_method', 'S256');
  }

  pending.set(state, { state, codeVerifier, redirectUri, createdAt: Date.now() });
  sweepPending();

  return { url: `${cfg.authorizeUrl}?${params.toString()}`, state };
}

export function takePending(state: string): PendingAuth | undefined {
  const p = pending.get(state);
  if (p) pending.delete(state);
  return p;
}

export async function exchangeCode(cfg: OAuth2Config, code: string, p: PendingAuth): Promise<Record<string, string>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: p.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (cfg.pkce && p.codeVerifier) body.set('code_verifier', p.codeVerifier);

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  return normaliseToken(json);
}

export async function refresh(cfg: OAuth2Config, refreshToken: string): Promise<Record<string, string>> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${text.slice(0, 400)}`);
  return normaliseToken({ ...(JSON.parse(text) as Record<string, unknown>), refresh_token: refreshToken });
}

function normaliseToken(json: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(json)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  if (out.expires_in && !out.expires_at) {
    out.expires_at = String(Date.now() + Number(out.expires_in) * 1000);
  }
  return out;
}

function sweepPending(): void {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of pending) if (v.createdAt < cutoff) pending.delete(k);
}

export const decodeJwtPayload = (token: string): Record<string, unknown> => {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};
