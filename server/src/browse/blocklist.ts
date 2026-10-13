/**
 * Blocking rules for the built-in privacy engine.
 *
 * Because every request is issued from the Nimbus cloud session, a blocked
 * resource is never even fetched: the rewriter points it at a dead endpoint and
 * the tracker never learns your visit. Counters are per-session and wiped on
 * lock.
 */

export const TRACKER_HOST_SUFFIXES = [
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'googleoptimize.com',
  'facebook.net',
  'connect.facebook.net',
  'hotjar.com',
  'clarity.ms',
  'mouseflow.com',
  'crazyegg.com',
  'fullstory.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'heap.io',
  'scorecardresearch.com',
  'quantserve.com',
  'adnxs.com',
  'adsrvr.org',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'yieldmo.com',
  'amazon-adsystem.com',
  'moatads.com',
  'adsafeprotected.com',
  'doubleverify.com',
  'branch.io',
  'appsflyer.com',
  'adjust.com',
  'matomo.cloud',
  'piwik.pro',
  'newrelic.com',
  'nr-data.net',
  'sentry-cdn.com',
  'bugsnag.com',
  'rollbar.com',
  'ads-twitter.com',
];

/**
 * Tracking endpoints hosted on a first-party domain: the host is legitimate
 * (facebook.com, linkedin.com, pinterest.com…) but the path is a beacon.
 * Matching on host alone would break those sites entirely.
 */
export const TRACKER_HOST_PATHS: [hostSuffix: string, pathPrefix: RegExp][] = [
  ['facebook.com', /^\/tr(\?|$|\/)/i],
  ['facebook.com', /^\/.+\/plugins\/(like|share|send)\.php/i],
  ['twitter.com', /^\/i\/adsct/i],
  ['x.com', /^\/i\/adsct/i],
  ['linkedin.com', /^\/(px|px\/li|collect)/i],
  ['licdn.com', /^\/px\/li/i],
  ['pinterest.com', /^\/ct\/|\/.+\/ct$/i],
  ['pinimg.com', /^\/ct\//i],
  ['tiktok.com', /^\/pixel|\/events\.js/i],
  ['instagram.com', /^\/logging\/fbi\/pixel/i],
  ['reddit.com', /^\/static\/ads|\/pixel/i],
  ['snapchat.com', /^\/scevent|\/pixel/i],
  ['youtube.com', /^\/ptracking/i],
  ['amazon.', /^\/gp\/.*\/uedata|\/1\/batch/i],
];

export const TRACKER_PATH_PATTERNS = [
  /\/gtag\/js/i,
  /\/gtm\.js/i,
  /\/analytics\.js/i,
  /\/fbevents\.js/i,
  /\/collect(\?|$)/i,
  /\/__utm\.gif/i,
  /\/pixel(\.|\?|$)/i,
  /\/track(ing)?(\.|\?|$)/i,
  /\/beacon(\.|\?|$)/i,
  /\/ad(s|server)?(\.|\?|$)/i,
  /\/matomo\.php/i,
];

/** Consent / cookie banners and newsletter interstitials. */
export const NUISANCE_SELECTORS = [
  '[id*="cookie" i][class*="banner" i]',
  '[id*="cookie" i][class*="consent" i]',
  '[id*="cookie" i][class*="notice" i]',
  '[class*="cookie-banner" i]',
  '[class*="cookiebar" i]',
  '[class*="cookie-consent" i]',
  '[class*="cookieconsent" i]',
  '[class*="cookie-notice" i]',
  '[class*="cookienotice" i]',
  '[class*="consent-banner" i]',
  '[class*="gdpr" i]',
  '[id*="onetrust" i]',
  '[class*="onetrust" i]',
  '[id*="qc-cmp" i]',
  '[class*="cmp-container" i]',
  '[id*="didomi" i]',
  '[class*="didomi" i]',
  '[id*="trustarc" i]',
  '[class*="newsletter-popup" i]',
  '[class*="newsletter-modal" i]',
  '[class*="subscribe-popup" i]',
  '[class*="paywall-modal" i]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
];

export function isTracker(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (TRACKER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  const full = `${url.pathname}${url.search}`;
  if (TRACKER_HOST_PATHS.some(([suffix, re]) => (host === suffix || host.endsWith(`.${suffix}`) || host.endsWith(suffix)) && re.test(full))) {
    return true;
  }
  return TRACKER_PATH_PATTERNS.some((re) => re.test(full));
}

export const nuisanceCss = (): string =>
  `<style data-nimbus="nuisance">${NUISANCE_SELECTORS.map((s) => `${s}{display:none !important;visibility:hidden !important;pointer-events:none !important;height:0 !important;overflow:hidden !important}`).join(',')}</style>`;
