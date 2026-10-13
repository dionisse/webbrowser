/** Domain model. Everything here lives inside the encrypted vault. */

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  hue: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  totp?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  history?: { at: number; hash: string }[];
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'cb' | 'other';

export interface CardEntry {
  id: string;
  label: string;
  holder: string;
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  brand: CardBrand;
  billingAddress: string;
  notes: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folder: string;
  tags: string[];
  hue: number;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  visits: number;
}

export interface TabGroup {
  id: string;
  name: string;
  hue: number;
  tabIds: string[];
  createdAt: number;
}

export interface DownloadRecord {
  id: string;
  filename: string;
  url: string;
  size: number;
  mimeType: string;
  at: number;
  origin: 'page' | 'vault' | 'cloud';
  status: 'available' | 'collected' | 'expired';
}

export interface Settings {
  locale: 'fr' | 'en';
  blockTrackers: boolean;
  hideNuisance: boolean;
  autoLockMinutes: number;
  lockOnBlur: boolean;
  searchEngine: 'duckduckgo' | 'google' | 'bing' | 'brave' | 'startpage' | 'qwant';
  startPage: 'nimbus' | 'blank' | 'last';
  density: 'cozy' | 'compact';
  showFaviconFallback: boolean;
  confirmOnClose: boolean;
  readerFontSize: number;
}

export interface Vault {
  v: 1;
  profile: { label: string; hue: number };
  notes: Note[];
  passwords: PasswordEntry[];
  cards: CardEntry[];
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  tabGroups: TabGroup[];
  downloads: DownloadRecord[];
  settings: Settings;
  updatedAt: number;
}

export const VAULT_VERSION = 1;

export const HISTORY_LIMIT = 1500;

export const DEFAULT_SETTINGS: Settings = {
  locale: 'fr',
  blockTrackers: true,
  hideNuisance: true,
  autoLockMinutes: 10,
  lockOnBlur: false,
  searchEngine: 'duckduckgo',
  startPage: 'nimbus',
  density: 'cozy',
  showFaviconFallback: true,
  confirmOnClose: false,
  readerFontSize: 16,
};

export const emptyVault = (label: string, hue: number, locale: 'fr' | 'en' = 'fr'): Vault => ({
  v: VAULT_VERSION,
  profile: { label, hue },
  notes: [],
  passwords: [],
  cards: [],
  bookmarks: [],
  history: [],
  tabGroups: [],
  downloads: [],
  settings: { ...DEFAULT_SETTINGS, locale },
  updatedAt: Date.now(),
});

/** Provider descriptor as published by the API. */
export interface ProviderDescriptor {
  id: string;
  name: string;
  vendor: string;
  blurb: string;
  kind: 'none' | 'oauth2' | 'token' | 'basic';
  configured: boolean;
  capabilities: {
    list: boolean;
    read: boolean;
    write: boolean;
    delete: boolean;
    quota: boolean;
    directDownload: boolean;
    experimental?: boolean;
    note?: string;
  };
  fields?: { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string; hint?: string }[];
  scopes?: string[];
  docsUrl?: string;
  accent: string;
  freeTierBytes?: number;
}

export interface PublicConnection {
  id: string;
  providerId: string;
  label: string;
  accountLabel?: string;
  email?: string;
  connectedAt: number;
  lastUsedAt?: number;
  simulated?: boolean;
}

export interface PublicProfile {
  profileId: string;
  label: string;
  hue: number;
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: string;
  providerId: string;
  providerName: string;
  connectionId: string;
  accountLabel?: string;
  drivePath: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  hasVault?: boolean;
}

export interface Tab {
  id: string;
  url: string;
  title: string;
  status: 'idle' | 'loading' | 'error' | 'internal';
  error?: string;
  blockedCount: number;
  reader: boolean;
  pinned: boolean;
  groupId?: string;
  openedAt: number;
  lastAccessedAt: number;
  /** Nimbus-internal destinations that never touch the network. */
  internal?: 'start' | 'bookmarks' | 'history' | 'downloads' | 'notes' | 'passwords' | 'cards' | 'cloud' | 'settings' | 'privacy';
  faviconHue?: number;
}
