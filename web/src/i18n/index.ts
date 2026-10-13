import { fr, type Dict } from './fr';
import { en } from './en';

export type Locale = 'fr' | 'en';

export const locales: { id: Locale; label: string; flag: string }[] = [
  { id: 'fr', label: 'Français', flag: 'FR' },
  { id: 'en', label: 'English', flag: 'EN' },
];

const dicts: Record<Locale, Dict> = { fr, en };

type Params = Record<string, string | number | undefined>;

const lookup = (dict: unknown, path: string[]): unknown =>
  path.reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined), dict);

/**
 * Dot-path lookup with parameter interpolation and an English fallback, so a
 * missing key degrades to readable text instead of a raw path.
 */
export function translate(locale: Locale, key: string, params?: Params): string {
  const path = key.split('.');
  const raw = lookup(dicts[locale], path) ?? lookup(dicts.en, path) ?? lookup(dicts.fr, path);
  let out = typeof raw === 'string' ? raw : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v ?? ''));
    }
  }
  return out;
}

export type Translate = (key: string, params?: Params) => string;

export const makeT = (locale: Locale): Translate => (key, params) => translate(locale, key, params);

export type { Dict };
