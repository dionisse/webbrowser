import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { badRequest, ok, unauthorized, wrap } from '../lib/http.js';
import { createLogger } from '../lib/log.js';
import { browse, cache, normaliseInput, unwrapProxyUrl, type BrowseFailure } from '../browse/engine.js';
import {
  collect,
  dropSession,
  filenameFromDisposition,
  filenameFromUrl,
  listSession,
  safeFilename,
  stage,
  stats as downloadStats,
} from '../browse/downloads.js';
import { sessionByBrowseToken } from '../session/store.js';
import { config } from '../config.js';

const log = createLogger('browse-route');

/**
 * Browsing endpoints are reachable either with an unlocked session cookie (the
 * shell itself) or with the per-session token stamped into rewritten URLs (the
 * sandboxed frame, which has no cookie access).
 */
function authorizeBrowse(req: Request, _res: Response, next: NextFunction): void {
  const token = typeof req.query.t === 'string' ? req.query.t : undefined;
  const byToken = sessionByBrowseToken(token);
  if (byToken) {
    req.session = byToken;
    req.sessionViaBrowseToken = true;
    next();
    return;
  }
  if (req.session.phase === 'unlocked') {
    next();
    return;
  }
  next(unauthorized('Session verrouillée.'));
}

/** Token-bucket rate limit so the engine cannot be used as an open relay. */
const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.session.id;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: 240, at: now };
  bucket.tokens = Math.min(240, bucket.tokens + ((now - bucket.at) / 1000) * 20);
  bucket.at = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    res.status(429).type('text/plain').send('Trop de requêtes — ralentissez.');
    return;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  next();
}

const parsePrefs = (req: Request) => {
  const q = req.query as Record<string, string | undefined>;
  return {
    blockTrackers: q.block !== '0',
    hideNuisance: q.nuisance !== '0',
    noCache: q.nocache === '1',
  };
};

const errorPage = (failure: BrowseFailure, prefs: { blockTrackers: boolean }): string => {
  const reason: Record<BrowseFailure['kind'], { title: string; body: string }> = {
    blocked: { title: 'Accès refusé', body: "La politique du moteur cloud bloque cet hôte (réseau privé, métadonnées ou liste interne)." },
    unreachable: { title: 'Site injoignable', body: "Le moteur cloud n'a pas pu établir de connexion avec ce serveur." },
    unsupported: { title: 'Adresse invalide', body: "Cette entrée n'est pas une URL valide et ne correspond à aucun moteur de recherche." },
    too_large: { title: 'Document trop volumineux', body: `La limite du moteur est de ${(config.browse.maxDocumentBytes / 1_000_000).toFixed(1)} Mo par document.` },
    timeout: { title: 'Délai dépassé', body: `Le serveur n'a pas répondu en ${Math.round(config.browse.timeoutMs / 1000)}s.` },
    http: { title: `Erreur ${failure.status ?? ''}`.trim(), body: 'Le serveur distant a renvoyé une erreur.' },
  };
  const r = reason[failure.kind];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${r.title}</title><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0E0F;color:#D3D3D3;
font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px}
.card{max-width:520px;width:100%;background:#17181B;border:1px solid #26282D;border-radius:28px;padding:32px}
.badge{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(184,25,8,.14);
color:#F0644F;font-size:12px;font-weight:600;letter-spacing:.02em;margin-bottom:18px}
h1{font-size:24px;line-height:1.2;margin:0 0 10px;color:#F2F2F2;font-weight:600;letter-spacing:-.01em}
p{margin:0 0 18px;font-size:14px;line-height:1.6;color:#9A9CA0}
code{display:block;background:#0E0E0F;border:1px solid #26282D;border-radius:14px;padding:12px 14px;font-size:12px;
color:#B9BBBF;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.row{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}
button{font:inherit;font-weight:600;font-size:13px;padding:11px 18px;border-radius:999px;border:0;cursor:pointer;transition:.16s}
.primary{background:#B81908;color:#fff}.primary:hover{background:#D42A15}
.ghost{background:#22242A;color:#D3D3D3}.ghost:hover{background:#2C2F36}
.meta{margin-top:20px;font-size:11px;color:#58595A;display:flex;gap:14px;flex-wrap:wrap}
</style></head><body>
<div class="card">
  <span class="badge">● Moteur cloud Nimbus</span>
  <h1>${r.title}</h1>
  <p>${r.body}</p>
  <code>${escapeHtml(failure.url)}</code>
  ${failure.hint ? `<p style="margin-top:14px;font-size:12px">${escapeHtml(failure.hint)}</p>` : ''}
  <div class="row">
    <button class="primary" id="retry">Réessayer</button>
    <button class="ghost" id="reader">Mode lecture</button>
    <button class="ghost" id="report">Signaler à l’onglet</button>
  </div>
  <div class="meta">
    <span>Aucune donnée écrite sur votre appareil</span>
    <span>${prefs.blockTrackers ? 'Traqueurs bloqués' : 'Traqueurs autorisés'}</span>
  </div>
</div>
<script>
var TARGET=${JSON.stringify(failure.url)};
function send(m){try{window.parent.postMessage(m,'*')}catch(e){}}
document.getElementById('retry').onclick=function(){send({__nimbus:'navigate',url:TARGET,reload:true,source:'error'})};
document.getElementById('reader').onclick=function(){send({__nimbus:'reader',url:TARGET,source:'error'})};
document.getElementById('report').onclick=function(){send({__nimbus:'navigate',url:TARGET,source:'error'})};
send({__nimbus:'failed',url:TARGET,kind:${JSON.stringify(failure.kind)},status:${JSON.stringify(failure.status ?? null)}});
</script>
</body></html>`;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export const browseRouter = Router();
browseRouter.use(authorizeBrowse, rateLimit);

/** Render a document through the cloud engine. */
browseRouter.get('/view', (req, res) => {
  const target = String(req.query.u ?? '');
  const prefs = parsePrefs(req);
  void (async () => {
    const result = await browse(target, {
      mode: 'document',
      reader: false,
      token: req.session.browseToken ?? undefined,
      method: req.method === 'POST' ? 'POST' : 'GET',
      ...prefs,
    });
    if (!result.ok) {
      res
        .status(200)
        .set({
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        })
        .send(errorPage(result.error, prefs));
      return;
    }
    const v = result.value;
    res.set({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-nimbus-final-url': encodeURIComponent(v.finalUrl),
      'x-nimbus-blocked': String(v.blockedHosts?.length ?? 0),
    });
    res.status(200).send(v.body ?? v.html ?? '');
  })().catch((e) => {
    log.error(`view failed: ${(e as Error).message}`);
    res.status(500).type('html').send(errorPage({ kind: 'unreachable', message: (e as Error).message, url: target }, prefs));
  });
});

/** Form POST navigation (the shim turns submissions into this). */
browseRouter.post('/view', (req, res, next) => {
  // Body is forwarded by the client shim as text; re-dispatch as GET/POST.
  const target = String(req.query.u ?? '');
  const prefs = parsePrefs(req);
  void (async () => {
    const body = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body as Record<string, string>).toString();
    const result = await browse(target, {
      mode: 'document',
      reader: false,
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
      token: req.session.browseToken ?? undefined,
      ...prefs,
    });
    if (!result.ok) {
      res.type('html').status(200).send(errorPage(result.error, prefs));
      return;
    }
    res.type('html').status(200).send(result.value.body ?? result.value.html ?? '');
  })().catch(next);
});

/** Sub-resources: images, stylesheets, scripts, fonts, media. */
browseRouter.get('/asset', (req, res, next) => {
  const target = String(req.query.u ?? '');
  const kind = String(req.query.k ?? 'raw') as 'raw' | 'css' | 'js';
  const prefs = parsePrefs(req);
  void (async () => {
    const result = await browse(target, { mode: kind, reader: false, token: req.session.browseToken ?? undefined, ...prefs });
    if (!result.ok) {
      res.status(result.error.status ?? 404).end();
      return;
    }
    const v = result.value;
    res.set({
      'content-type': v.contentType,
      'cache-control': 'private, max-age=120',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.status(200).send(v.body ?? Buffer.alloc(0));
  })().catch(next);
});

/** Dead end for blocked trackers: 1×1 transparent GIF, counted, never fetched. */
browseRouter.get('/blocked', (req, res) => {
  const target = String(req.query.u ?? '');
  try {
    const u = normaliseInput(unwrapProxyUrl(target));
    if (u) {
      const list = req.session.scratch.cacheKeys;
      list.push(`blocked:${u.hostname}`);
      if (list.length > 4000) list.splice(0, list.length - 4000);
    }
  } catch {
    /* ignore */
  }
  res.set({ 'content-type': 'image/gif', 'cache-control': 'private, max-age=3600', 'content-length': '43' });
  res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
});

/** Reader-mode extraction as JSON, consumed by the shell's own renderer. */
browseRouter.get(
  '/reader',
  wrap(async (req, res) => {
    const target = String(req.query.u ?? '');
    const prefs = parsePrefs(req);
    const result = await browse(target, { mode: 'document', reader: true, token: req.session.browseToken ?? undefined, ...prefs });
    if (!result.ok) throw badRequest(result.error.message);
    ok(res, { url: result.value.finalUrl, reader: result.value.reader });
  }),
);

/** Lightweight metadata probe used by the omnibox and by history titles. */
browseRouter.get(
  '/probe',
  wrap(async (req, res) => {
    const target = String(req.query.u ?? '');
    const prefs = parsePrefs(req);
    const result = await browse(target, { mode: 'document', reader: true, token: req.session.browseToken ?? undefined, ...prefs });
    if (!result.ok) throw badRequest(result.error.message);
    const r = result.value.reader;
    ok(res, {
      url: result.value.finalUrl,
      title: r?.title ?? '',
      excerpt: r?.excerpt ?? '',
      siteName: r?.siteName ?? '',
      blockedHosts: result.value.blockedHosts ?? [],
    });
  }),
);

// --- Downloads -------------------------------------------------------------

/** Fetch a file inside the cloud session and stage it in memory. */
browseRouter.post(
  '/download',
  wrap(async (req, res) => {
    const { url, filename } = z.object({ url: z.string().min(1), filename: z.string().optional() }).parse(req.body);
    const prefs = parsePrefs(req);
    const result = await browse(url, { mode: 'raw', reader: false, blockTrackers: prefs.blockTrackers, hideNuisance: false, token: req.session.browseToken ?? undefined });
    if (!result.ok) throw badRequest(result.error.message);
    const v = result.value;
    const body = v.body ?? Buffer.alloc(0);
    const name = safeFilename(filename || filenameFromDisposition(v.disposition) || filenameFromUrl(v.finalUrl));
    const stagedItem = stage({
      sessionId: req.session.id,
      profileId: req.session.profileId ?? 'anonymous',
      url: v.finalUrl,
      filename: name,
      mimeType: v.contentType,
      size: body.length,
      data: body,
      origin: 'page',
    });
    req.session.scratch.downloadIds.push(stagedItem.id);
    ok(res, { id: stagedItem.id, filename: stagedItem.filename, size: stagedItem.size, mimeType: stagedItem.mimeType, createdAt: stagedItem.createdAt });
  }),
);

browseRouter.get(
  '/downloads',
  wrap(async (req, res) => {
    ok(res, { downloads: listSession(req.session.id), stats: downloadStats() });
  }),
);

/** Hand the bytes to the user's computer exactly once, then forget them. */
browseRouter.get('/downloads/:id', (req, res) => {
  const { id } = req.params as { id: string };
  const item = collect(id, req.session.id);
  if (!item) {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Téléchargement expiré ou déjà récupéré.' } });
    return;
  }
  res.set({
    'content-type': item.mimeType || 'application/octet-stream',
    'content-disposition': `attachment; filename="${item.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
    'content-length': String(item.size),
    'cache-control': 'no-store',
  });
  res.status(200).send(item.data);
});

browseRouter.delete(
  '/downloads',
  wrap(async (req, res) => {
    dropSession(req.session.id);
    ok(res, { cleared: true });
  }),
);

browseRouter.get(
  '/stats',
  wrap(async (req, res) => {
    const blocked = req.session.scratch.cacheKeys.filter((k) => k.startsWith('blocked:'));
    const hosts = new Map<string, number>();
    for (const b of blocked) {
      const h = b.slice('blocked:'.length);
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    }
    ok(res, {
      cache: cache.stats(),
      downloads: downloadStats(),
      blockedRequests: blocked.length,
      blockedHosts: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([host, count]) => ({ host, count })),
      ttlSeconds: config.browse.cacheTtlSeconds,
    });
  }),
);
