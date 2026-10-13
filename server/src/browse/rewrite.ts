import { parse, type HTMLElement } from 'node-html-parser';
import { isTracker, nuisanceCss } from './blocklist.js';

/**
 * Document rewriting.
 *
 * Nimbus renders pages *from the cloud*: the server fetches the document,
 * rewrites every URL to route back through the engine, and hands the result to
 * the client inside a sandboxed frame. Consequences that matter for the product
 * promise:
 *
 *   • the user's machine never contacts the destination site directly;
 *   • blocked trackers are never even fetched (their URLs point at a dead end);
 *   • no cookies, cache or storage are written on the user's device — the frame
 *     is sandboxed and the origin is Nimbus, not the site;
 *   • link clicks and form posts bubble up to the shell through postMessage, so
 *     tabs, history and bookmarks behave like a real browser.
 */

export const PROXY_BASE = '/api/browse';

export type AssetKind = 'raw' | 'css' | 'js';

const withToken = (qs: string, token?: string): string => (token ? `${qs}&t=${encodeURIComponent(token)}` : qs);

export const viewUrl = (target: string | URL, token?: string): string =>
  withToken(`${PROXY_BASE}/view?u=${encodeURIComponent(String(target))}`, token);
export const assetUrl = (target: string | URL, kind: AssetKind, token?: string): string =>
  withToken(`${PROXY_BASE}/asset?u=${encodeURIComponent(String(target))}&k=${kind}`, token);
export const blockedUrl = (target: string | URL, token?: string): string =>
  withToken(`${PROXY_BASE}/blocked?u=${encodeURIComponent(String(target))}`, token);

export interface RewriteContext {
  /** Final URL of the document after redirects — the base for resolution. */
  pageUrl: URL;
  blockTrackers: boolean;
  hideNuisance: boolean;
  injectRuntime: boolean;
  /**
   * Per-session token carried by every generated proxy URL. The rendered frame
   * is sandboxed *without* `allow-same-origin`, so it has no access to the
   * Nimbus cookies, storage or API — the token is what lets its subresources
   * reach the engine, and it dies with the session.
   */
  token?: string;
}

export interface RewriteStats {
  urlsRewritten: number;
  trackersBlocked: number;
  blockedHosts: string[];
}

const SKIP_SCHEMES = /^(data:|blob:|javascript:|mailto:|tel:|sms:|callto:|about:|nimbus:|chrome-extension:|moz-extension:|#)/i;

const ATTR_BY_MODE: Record<string, AssetKind | 'view'> = {
  src: 'view',
  href: 'view',
  action: 'view',
  poster: 'raw',
  'data-src': 'raw',
  'data-original': 'raw',
  'data-lazy-src': 'raw',
  'data-bg': 'raw',
  'xlink:href': 'view',
};

const RAW_ASSET_TAGS = new Set(['IMG', 'SOURCE', 'VIDEO', 'AUDIO', 'EMBED', 'OBJECT', 'TRACK', 'INPUT']);

function resolve(value: string, ctx: RewriteContext): URL | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (SKIP_SCHEMES.test(trimmed)) return null;
  if (trimmed.startsWith(PROXY_BASE)) return null;
  try {
    const u = new URL(trimmed, ctx.pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

function toProxy(u: URL, kind: AssetKind | 'view', ctx: RewriteContext): string {
  if (ctx.blockTrackers && isTracker(u)) return blockedUrl(u, ctx.token);
  return kind === 'view' ? viewUrl(u, ctx.token) : assetUrl(u, kind, ctx.token);
}

function kindFor(el: HTMLElement, attr: string, ctx: RewriteContext): AssetKind | 'view' | null {
  const tag = el.rawTagName?.toUpperCase();
  if (attr === 'href') {
    if (tag === 'LINK') {
      const rel = (el.getAttribute('rel') ?? '').toLowerCase();
      if (rel.includes('stylesheet')) return 'css';
      if (rel.includes('icon') || rel.includes('image') || rel.includes('preload') || rel.includes('manifest')) return 'raw';
      return null; // canonical/alternate/dns-prefetch: leave alone
    }
    if (tag === 'A' || tag === 'AREA') return 'view';
    return null;
  }
  if (attr === 'src') {
    if (tag === 'SCRIPT') return 'js';
    if (tag === 'IFRAME' || tag === 'FRAME') return 'view';
    if (RAW_ASSET_TAGS.has(tag ?? '')) return 'raw';
    return 'raw';
  }
  if (attr === 'action') return 'view';
  return ATTR_BY_MODE[attr] ?? null;
}

function rewriteSrcset(value: string, ctx: RewriteContext, stats: RewriteStats): string {
  return value
    .split(',')
    .map((part) => {
      const bits = part.trim().split(/\s+/);
      const head = bits.shift();
      if (!head) return part;
      const u = resolve(head, ctx);
      if (!u) return part;
      stats.urlsRewritten++;
      if (ctx.blockTrackers && isTracker(u)) {
        stats.trackersBlocked++;
        stats.blockedHosts.push(u.hostname);
        return [blockedUrl(u, ctx.token), ...bits].join(' ');
      }
      return [assetUrl(u, 'raw', ctx.token), ...bits].join(' ');
    })
    .join(', ');
}

export function rewriteInlineStyle(value: string, ctx: RewriteContext, stats: RewriteStats): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, raw: string) => {
    const u = resolve(String(raw), ctx);
    if (!u) return _m;
    stats.urlsRewritten++;
    return `url(${assetUrl(u, 'raw', ctx.token)})`;
  });
}

/** Rewrite `url(...)` and `@import` inside a fetched stylesheet. */
export function rewriteCss(css: string, ctx: RewriteContext, stats: RewriteStats): string {
  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, raw: string) => {
    const u = resolve(String(raw), ctx);
    if (!u) return _m;
    stats.urlsRewritten++;
    if (ctx.blockTrackers && isTracker(u)) {
      stats.trackersBlocked++;
      stats.blockedHosts.push(u.hostname);
      return `url(${blockedUrl(u, ctx.token)})`;
    }
    return `url(${assetUrl(u, 'raw', ctx.token)})`;
  });

  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q: string, raw: string) => {
    const u = resolve(String(raw), ctx);
    if (!u) return _m;
    stats.urlsRewritten++;
    return `@import ${q}${assetUrl(u, 'css', ctx.token)}${q}`;
  });

  return out;
}

/** Runtime shim injected into every proxied document. */
function runtimeShim(pageUrl: string, ctx: RewriteContext): string {
  return `<script data-nimbus="runtime">(function(){
  var PAGE = ${JSON.stringify(pageUrl)};
  var BASE = ${JSON.stringify(PROXY_BASE)};
  var TOKEN = ${JSON.stringify(ctx.token ?? '')};
  try { window.__nimbus = { pageUrl: PAGE, base: BASE }; } catch(e){}
  function abs(u){ try { return new URL(u, PAGE).href; } catch(e){ return null; } }
  function prox(u){
    if(!u) return u;
    if(${SKIP_SCHEMES.toString()}.test(u)) return u;
    if(u.indexOf(BASE+'/') === 0) return u;
    var a = abs(u);
    return a ? BASE+'/view?u='+encodeURIComponent(a)+(TOKEN?'&t='+encodeURIComponent(TOKEN):'') : u;
  }
  function send(msg){ try { window.parent.postMessage(msg, '*'); } catch(e){} }
  try {
    var _open = window.open;
    window.open = function(u,n,f){ var p = prox(u); send({ __nimbus:'navigate', url:p, newTab:true, source:'window.open' }); return null; };
  } catch(e){}
  document.addEventListener('click', function(ev){
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href], area[href]') : null;
    if(!a) return;
    var href = a.getAttribute('href') || '';
    if(!href || /^(javascript:|mailto:|tel:|sms:|#)/i.test(href)) return;
    ev.preventDefault(); ev.stopPropagation();
    send({ __nimbus:'navigate', url: prox(href), newTab: a.target === '_blank' || ev.metaKey || ev.ctrlKey || ev.button === 1, source:'link' });
  }, true);
  document.addEventListener('submit', function(ev){
    var f = ev.target; if(!f || f.tagName !== 'FORM') return;
    ev.preventDefault(); ev.stopPropagation();
    var action = prox(f.getAttribute('action') || PAGE);
    var method = (f.getAttribute('method') || 'GET').toUpperCase();
    var body = '';
    try {
      var qs = new URLSearchParams(new FormData(f));
      body = qs.toString();
      if (method === 'GET') { action += (action.indexOf('?') > -1 ? '&' : '?') + body; body = ''; }
    } catch(e){}
    send({ __nimbus:'navigate', url: action, method: method, body: body || undefined, source:'form' });
  }, true);
  ${
    ctx.hideNuisance
      ? `
  // Second pass for banners injected later by the page itself.
  var SEL = ${JSON.stringify(nuisanceSelectorList().join(','))};
  function sweep(){ try { document.querySelectorAll(SEL).forEach(function(n){ n.style.setProperty('display','none','important'); }); } catch(e){} }
  sweep();
  try { new MutationObserver(function(){ sweep(); }).observe(document.documentElement, { childList:true, subtree:true }); } catch(e){}
  `
      : ''
  }
  function ready(){ send({ __nimbus:'ready', url: location.href, title: document.title, pageUrl: PAGE }); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') ready();
  else document.addEventListener('DOMContentLoaded', ready);
  window.addEventListener('load', ready);
})();</script>`;
}

function nuisanceSelectorList(): string[] {
  // Kept in sync with blocklist.nuisanceCss without exporting the raw array.
  const css = nuisanceCss();
  const inner = css.slice(css.indexOf('>') + 1, css.lastIndexOf('<'));
  return inner
    .split('}')
    .map((chunk) => chunk.split('{')[0]?.trim())
    .filter((s): s is string => Boolean(s));
}

export interface RewriteResult {
  html: string;
  title: string;
  stats: RewriteStats;
}

export function rewriteHtml(rawHtml: string, ctx: RewriteContext): RewriteResult {
  const stats: RewriteStats = { urlsRewritten: 0, trackersBlocked: 0, blockedHosts: [] };
  const root = parse(rawHtml, {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true, textarea: true },
  });

  // <base href> wins over the document URL when present.
  const baseEl = root.querySelector('base[href]');
  if (baseEl) {
    const href = baseEl.getAttribute('href');
    if (href) {
      try {
        ctx = { ...ctx, pageUrl: new URL(href, ctx.pageUrl) };
      } catch {
        /* keep document URL */
      }
    }
    baseEl.remove();
  }

  // Drop site CSP: it would block the shim and the rewritten origins.
  for (const meta of root.querySelectorAll('meta[http-equiv]')) {
    const he = (meta.getAttribute('http-equiv') ?? '').toLowerCase();
    if (he === 'content-security-policy' || he === 'content-security-policy-report-only') {
      meta.remove();
      continue;
    }
    if (he === 'refresh') {
      const content = meta.getAttribute('content') ?? '';
      const m = content.match(/url\s*=\s*(.+)$/i);
      if (m?.[1]) {
        const u = resolve(m[1].replace(/^['"]|['"]$/g, ''), ctx);
        if (u) {
          stats.urlsRewritten++;
          meta.setAttribute('content', content.slice(0, m.index) + `url=${viewUrl(u, ctx.token)}`);
        }
      }
    }
  }

  for (const el of root.querySelectorAll('*')) {
    const attrs = { ...(el.attributes as Record<string, string>) };
    for (const [attr, value] of Object.entries(attrs)) {
      if (attr === 'srcset' || attr === 'data-srcset') {
        const next = rewriteSrcset(value, ctx, stats);
        if (next !== value) el.setAttribute(attr, next);
        continue;
      }
      if (attr === 'style' && value.includes('url(')) {
        const next = rewriteInlineStyle(value, ctx, stats);
        if (next !== value) el.setAttribute(attr, next);
        continue;
      }
      const kind = kindFor(el, attr, ctx);
      if (!kind) continue;
      const u = resolve(value, ctx);
      if (!u) continue;
      stats.urlsRewritten++;
      const next = toProxy(u, kind, ctx);
      if (next.startsWith(`${PROXY_BASE}/blocked`)) {
        stats.trackersBlocked++;
        stats.blockedHosts.push(u.hostname);
      }
      el.setAttribute(attr, next);
    }

    // iframes must not escape the proxy
    if (el.rawTagName?.toUpperCase() === 'IFRAME') {
      el.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin');
      el.setAttribute('loading', 'lazy');
    }
    // external scripts that would phone home
    if (el.rawTagName?.toUpperCase() === 'SCRIPT') {
      const src = el.getAttribute('src') ?? '';
      if (src.startsWith(`${PROXY_BASE}/blocked`)) el.remove();
    }

    // Rewrite url() inside <style> blocks
    if (el.rawTagName?.toUpperCase() === 'STYLE') {
      const css = el.innerHTML;
      if (css) {
        const next = rewriteCss(css, ctx, stats);
        if (next !== css) el.innerHTML = next;
      }
    }
  }

  if (ctx.hideNuisance) {
    const head = root.querySelector('head') ?? root;
    head.appendChild(parse(nuisanceCss()).childNodes[0]!);
  }

  if (ctx.injectRuntime) {
    const shim = parse(runtimeShim(ctx.pageUrl.href, ctx)).childNodes[0]!;
    const head = root.querySelector('head');
    if (head) head.appendChild(shim);
    else root.appendChild(shim);
  }

  const title = root.querySelector('title')?.innerText.trim() || '';
  return { html: root.toString(), title, stats };
}

// ---------------------------------------------------------------------------
// Reader mode
// ---------------------------------------------------------------------------

export interface ReaderArticle {
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  lang?: string;
  publishedAt?: string;
  blocks: { kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'pre' | 'img' | 'a'; text?: string; href?: string; src?: string; alt?: string }[];
  wordCount: number;
  readingMinutes: number;
}

const TEXT_LIMIT = 400_000;

/** Distil a page into clean, typographic blocks — no scripts, no chrome. */
export function extractReadable(rawHtml: string, pageUrl: URL): ReaderArticle {
  const root = parse(rawHtml.slice(0, TEXT_LIMIT), {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true },
  });

  for (const sel of ['script', 'style', 'noscript', 'svg', 'iframe', 'form', 'nav', 'footer', 'header', 'aside']) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }

  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    root.querySelector('title')?.innerText.trim() ||
    pageUrl.hostname;

  const excerpt =
    root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    undefined;

  const byline =
    root.querySelector('meta[name="author"]')?.getAttribute('content')?.trim() ||
    root.querySelector('[rel="author"]')?.innerText.trim() ||
    undefined;

  const siteName = root.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || pageUrl.hostname;
  const lang = root.querySelector('html')?.getAttribute('lang') || undefined;
  const publishedAt =
    root.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.trim() ||
    root.querySelector('time[datetime]')?.getAttribute('datetime') ||
    undefined;

  // Score candidate containers by text density, the way readability does.
  const candidates: HTMLElement[] = [];
  for (const sel of ['article', 'main', '[role="main"]', '#content', '.content', '.post', '.article', '.entry-content', 'section']) {
    for (const el of root.querySelectorAll(sel)) candidates.push(el);
  }
  const scored = candidates
    .map((el) => ({ el, score: textScore(el) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const container = best && best.score > 120 ? best.el : (root.querySelector('body') ?? root);

  const blocks: ReaderArticle['blocks'] = [];
  let words = 0;

  const push = (b: ReaderArticle['blocks'][number]) => {
    blocks.push(b);
    if (b.text) words += b.text.split(/\s+/).filter(Boolean).length;
  };

  const walk = (node: HTMLElement) => {
    for (const child of node.childNodes as HTMLElement[]) {
      const tag = child.rawTagName?.toUpperCase();
      if (!tag) {
        const t = (child as unknown as { text?: string }).text?.trim();
        if (t && t.length > 40) push({ kind: 'p', text: collapse(t) });
        continue;
      }
      if (tag === 'H1') push({ kind: 'h1', text: collapse(child.innerText) });
      else if (tag === 'H2') push({ kind: 'h2', text: collapse(child.innerText) });
      else if (tag === 'H3' || tag === 'H4') push({ kind: 'h3', text: collapse(child.innerText) });
      else if (tag === 'P') {
        const img = child.querySelector('img[src]');
        if (img) push({ kind: 'img', src: absolutise(img.getAttribute('src')!, pageUrl), alt: img.getAttribute('alt') ?? '' });
        const t = collapse(child.innerText);
        if (t.length > 1) push({ kind: 'p', text: t });
      } else if (tag === 'BLOCKQUOTE') push({ kind: 'quote', text: collapse(child.innerText) });
      else if (tag === 'PRE') push({ kind: 'pre', text: child.innerText.slice(0, 8000) });
      else if (tag === 'LI') push({ kind: 'li', text: collapse(child.innerText) });
      else if (tag === 'UL' || tag === 'OL' || tag === 'FIGURE' || tag === 'DIV' || tag === 'SECTION' || tag === 'TD') {
        if (child.querySelectorAll('p,li,h1,h2,h3,blockquote,pre,img').length > 0) walk(child);
        else {
          const t = collapse(child.text ?? '');
          if (t.length > 40) push({ kind: 'p', text: t });
        }
      } else if (tag === 'IMG') {
        const src = child.getAttribute('src') ?? child.getAttribute('data-src');
        if (src) push({ kind: 'img', src: absolutise(src, pageUrl), alt: child.getAttribute('alt') ?? '' });
      }
    }
  };

  walk(container);

  const seen = new Set<string>();
  const deduped = blocks.filter((b) => {
    const key = `${b.kind}:${(b.text ?? b.src ?? '').slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(b.text?.trim().length || b.src);
  });

  return {
    title,
    byline,
    siteName,
    excerpt,
    lang,
    publishedAt,
    blocks: deduped.slice(0, 800),
    wordCount: words,
    readingMinutes: Math.max(1, Math.round(words / 220)),
  };
}

function textScore(el: HTMLElement): number {
  const text = el.text ?? '';
  const paras = el.querySelectorAll('p').length;
  const linkLen = el.querySelectorAll('a').reduce((n, a) => n + (a.text?.length ?? 0), 0);
  return text.length / 100 + paras * 12 - linkLen / 120;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

const absolutise = (value: string, base: URL): string => {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
};
