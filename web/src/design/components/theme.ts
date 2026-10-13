/** Shared visual helpers so every surface speaks the same language. */

export const hueGradient = (hue: number, strength = 1): string =>
  `linear-gradient(150deg, hsl(${hue} 46% ${26 * strength}%), hsl(${hue} 58% ${16 * strength}%))`;

export const hueBorder = (hue: number): string => `1px solid hsl(${hue} 42% 32% / .55)`;

export const hueSoft = (hue: number, alpha = 0.14): string => `hsl(${hue} 62% 52% / ${alpha})`;

export const hueText = (hue: number): string => `hsl(${hue} 68% 68%)`;

/** Deterministic accent for a URL, so a host keeps the same colour everywhere. */
export const hueFromString = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
};

export const brandHues: Record<string, number> = {
  visa: 214,
  mastercard: 24,
  amex: 199,
  discover: 28,
  cb: 152,
  other: 0,
};

export const formatBytes = (bytes: number, locale = 'fr'): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return locale === 'fr' ? '0 o' : '0 B';
  const units = locale === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

export const relativeTime = (ts: number, locale: 'fr' | 'en' = 'fr'): string => {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  const hour = Math.round(diff / 3_600_000);
  const day = Math.round(diff / 86_400_000);
  if (diff < 45_000) return locale === 'fr' ? 'à l’instant' : 'just now';
  if (min < 60) return locale === 'fr' ? `il y a ${min} min` : `${min} min ago`;
  if (hour < 24) return locale === 'fr' ? `il y a ${hour} h` : `${hour} h ago`;
  if (day === 1) return locale === 'fr' ? 'hier' : 'yesterday';
  if (day < 30) return locale === 'fr' ? `il y a ${day} j` : `${day} d ago`;
  return new Date(ts).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const absoluteTime = (ts: number, locale: 'fr' | 'en' = 'fr'): string =>
  new Date(ts).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const dayKey = (ts: number, locale: 'fr' | 'en' = 'fr'): string =>
  new Date(ts).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const greeting = (locale: 'fr' | 'en' = 'fr'): string => {
  const h = new Date().getHours();
  if (h < 5) return locale === 'fr' ? 'Bonne nuit' : 'Still up';
  if (h < 12) return locale === 'fr' ? 'Bonjour' : 'Good morning';
  if (h < 18) return locale === 'fr' ? 'Bon après-midi' : 'Good afternoon';
  return locale === 'fr' ? 'Bonsoir' : 'Good evening';
};

/** A readable favicon-free mark: two letters on a deterministic hue. */
export const shortHost = (url: string): string => {
  if (url.startsWith('nimbus://')) return 'nimbus';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 24);
  }
};
