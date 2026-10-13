import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { decryptJson, newId, sha256Base64 } from '../lib/crypto';
import { on } from '../lib/bus';
import { useSession } from './session';
import { useUi } from './ui';
import {
  DEFAULT_SETTINGS,
  emptyVault,
  HISTORY_LIMIT,
  VAULT_VERSION,
  type Bookmark,
  type CardEntry,
  type DownloadRecord,
  type HistoryEntry,
  type Note,
  type PasswordEntry,
  type Settings,
  type Vault,
} from '../lib/types';

const SYNC_DEBOUNCE_MS = 1400;

interface VaultState {
  vault: Vault | null;
  revision: number;
  hydrated: boolean;
  dirty: boolean;
  syncing: boolean;
  syncError: string | null;
  lastSyncedAt: number | null;
  checksum: string | null;
  sizeBytes: number;
  integrityOk: boolean | null;

  hydrate: (envelope: { vault: string; revision: number; checksum: string; sizeBytes: number } | null) => Promise<void>;
  reset: () => void;
  update: (mutator: (vault: Vault) => Vault, opts?: { sync?: boolean }) => void;
  syncNow: (opts?: { snapshot?: boolean }) => Promise<boolean>;

  // Notes
  addNote: (partial?: Partial<Note>) => Note;
  updateNote: (id: string, patch: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  toggleNotePin: (id: string) => void;

  // Passwords
  addPassword: (partial?: Partial<PasswordEntry>) => PasswordEntry;
  updatePassword: (id: string, patch: Partial<PasswordEntry>) => void;
  deletePassword: (id: string) => void;
  markPasswordUsed: (id: string) => void;

  // Cards
  addCard: (partial?: Partial<CardEntry>) => CardEntry;
  updateCard: (id: string, patch: Partial<CardEntry>) => void;
  deleteCard: (id: string) => void;

  // Bookmarks
  addBookmark: (input: { title: string; url: string; folder?: string; hue?: number }) => Bookmark;
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void;
  removeBookmark: (id: string) => void;

  // History
  recordVisit: (url: string, title: string) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;

  // Downloads
  recordDownload: (record: Omit<DownloadRecord, 'id' | 'at'>) => DownloadRecord;
  markDownload: (id: string, status: DownloadRecord['status']) => void;
  clearDownloads: () => void;

  // Settings
  updateSettings: (patch: Partial<Settings>) => void;
}

let syncTimer: number | undefined;

const scheduleSync = () => {
  if (syncTimer !== undefined) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    void useVault.getState().syncNow();
  }, SYNC_DEBOUNCE_MS);
};

export const useVault = create<VaultState>((set, get) => ({
  vault: null,
  revision: 0,
  hydrated: false,
  dirty: false,
  syncing: false,
  syncError: null,
  lastSyncedAt: null,
  checksum: null,
  sizeBytes: 0,
  integrityOk: null,

  async hydrate(envelope) {
    const key = useSession.getState().masterKey;
    const profile = useSession.getState().activeProfile;
    if (!key) {
      set({ vault: null, hydrated: false });
      return;
    }
    if (!envelope) {
      const vault = emptyVault(profile?.label ?? 'Nimbus', profile?.hue ?? 20, useUi.getState().locale);
      set({ vault, hydrated: true, revision: 0, dirty: true, checksum: null, integrityOk: null });
      scheduleSync();
      return;
    }
    try {
      const digest = await sha256Base64(envelope.vault);
      const integrityOk = envelope.checksum ? digest === envelope.checksum : null;
      const parsed = await decryptJson<Vault>(key, envelope.vault, 'vault');
      // Forward-compatible merge: any collection added in a later version
      // simply starts empty rather than throwing the whole vault away.
      const vault: Vault = {
        ...emptyVault(parsed.profile?.label ?? profile?.label ?? 'Nimbus', parsed.profile?.hue ?? profile?.hue ?? 20, useUi.getState().locale),
        ...parsed,
        v: VAULT_VERSION,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        notes: parsed.notes ?? [],
        passwords: parsed.passwords ?? [],
        cards: parsed.cards ?? [],
        bookmarks: parsed.bookmarks ?? [],
        history: parsed.history ?? [],
        tabGroups: parsed.tabGroups ?? [],
        downloads: parsed.downloads ?? [],
      };
      set({
        vault,
        hydrated: true,
        revision: envelope.revision,
        dirty: false,
        checksum: envelope.checksum,
        sizeBytes: envelope.sizeBytes,
        integrityOk,
        lastSyncedAt: Date.now(),
        syncError: null,
      });
      useSession.getState().applySettings(vault.settings);
      useUi.getState().setLocale(vault.settings.locale);
      useUi.getState().setDensity(vault.settings.density);
    } catch (err) {
      console.error('[nimbus] vault decryption failed', err);
      set({ vault: null, hydrated: false, syncError: 'Déchiffrement impossible — mot de passe ou données corrompues.' });
    }
  },

  reset() {
    if (syncTimer !== undefined) window.clearTimeout(syncTimer);
    syncTimer = undefined;
    set({
      vault: null,
      revision: 0,
      hydrated: false,
      dirty: false,
      syncing: false,
      syncError: null,
      lastSyncedAt: null,
      checksum: null,
      sizeBytes: 0,
      integrityOk: null,
    });
  },

  update(mutator, opts) {
    const current = get().vault;
    if (!current) return;
    const next = mutator(current);
    set({ vault: { ...next, updatedAt: Date.now() }, dirty: true });
    if (opts?.sync !== false) scheduleSync();
  },

  async syncNow(opts) {
    const { vault, revision, syncing } = get();
    const key = useSession.getState().masterKey;
    if (!vault || !key || syncing) return false;
    set({ syncing: true, syncError: null });
    try {
      const ciphertext = await useSession.getState().reEncrypt(vault);
      if (!ciphertext) {
        set({ syncing: false });
        return false;
      }
      const res = await api.saveVault({ vault: ciphertext, baseRevision: revision, snapshot: opts?.snapshot });
      set({ revision: res.revision, dirty: false, syncing: false, lastSyncedAt: Date.now(), checksum: res.checksum, sizeBytes: res.sizeBytes, integrityOk: true });
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      const conflict = err instanceof ApiError && err.status === 409;
      set({ syncing: false, syncError: message });
      if (conflict) {
        // Someone else moved the vault forward: pull and let the user decide.
        try {
          const fresh = await api.vault();
          set({ revision: fresh.revision });
        } catch {
          /* keep local */
        }
      }
      return false;
    }
  },

  // --- Notes ---------------------------------------------------------------
  addNote(partial) {
    const now = Date.now();
    const note: Note = {
      id: newId(),
      title: '',
      body: '',
      tags: [],
      hue: 20,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    get().update((v) => ({ ...v, notes: [note, ...v.notes] }));
    return note;
  },
  updateNote(id, patch) {
    get().update((v) => ({ ...v, notes: v.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) }));
  },
  deleteNote(id) {
    get().update((v) => ({ ...v, notes: v.notes.filter((n) => n.id !== id) }));
  },
  toggleNotePin(id) {
    get().update((v) => ({ ...v, notes: v.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n)) }));
  },

  // --- Passwords -----------------------------------------------------------
  addPassword(partial) {
    const now = Date.now();
    const entry: PasswordEntry = {
      id: newId(),
      title: '',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      history: [],
      ...partial,
    };
    get().update((v) => ({ ...v, passwords: [entry, ...v.passwords] }));
    return entry;
  },
  updatePassword(id, patch) {
    get().update((v) => ({
      ...v,
      passwords: v.passwords.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch, updatedAt: Date.now() };
        // Keep a hash trail so reuse can be flagged without storing plaintext.
        if (patch.password && patch.password !== p.password) {
          void sha256Base64(patch.password).then((hash) => {
            get().update((w) => ({
              ...w,
              passwords: w.passwords.map((q) =>
                q.id === id ? { ...q, history: [...(q.history ?? []), { at: Date.now(), hash }].slice(-12) } : q,
              ),
            }));
          });
        }
        return next;
      }),
    }));
  },
  deletePassword(id) {
    get().update((v) => ({ ...v, passwords: v.passwords.filter((p) => p.id !== id) }));
  },
  markPasswordUsed(id) {
    get().update((v) => ({ ...v, passwords: v.passwords.map((p) => (p.id === id ? { ...p, lastUsedAt: Date.now() } : p)) }));
  },

  // --- Cards ---------------------------------------------------------------
  addCard(partial) {
    const now = Date.now();
    const card: CardEntry = {
      id: newId(),
      label: '',
      holder: '',
      number: '',
      expMonth: 1,
      expYear: new Date().getFullYear(),
      cvc: '',
      brand: 'other',
      billingAddress: '',
      notes: '',
      favorite: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    get().update((v) => ({ ...v, cards: [card, ...v.cards] }));
    return card;
  },
  updateCard(id, patch) {
    get().update((v) => ({ ...v, cards: v.cards.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) }));
  },
  deleteCard(id) {
    get().update((v) => ({ ...v, cards: v.cards.filter((c) => c.id !== id) }));
  },

  // --- Bookmarks -----------------------------------------------------------
  addBookmark(input) {
    const existing = get().vault?.bookmarks.find((b) => b.url === input.url);
    if (existing) return existing;
    const bookmark: Bookmark = {
      id: newId(),
      title: input.title || input.url,
      url: input.url,
      folder: input.folder ?? 'Favoris',
      tags: [],
      hue: input.hue ?? Math.floor(Math.random() * 360),
      createdAt: Date.now(),
    };
    get().update((v) => ({ ...v, bookmarks: [bookmark, ...v.bookmarks] }));
    return bookmark;
  },
  updateBookmark(id, patch) {
    get().update((v) => ({ ...v, bookmarks: v.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  },
  removeBookmark(id) {
    get().update((v) => ({ ...v, bookmarks: v.bookmarks.filter((b) => b.id !== id) }));
  },

  // --- History -------------------------------------------------------------
  recordVisit(url, title) {
    if (!url || url.startsWith('nimbus://') || url.startsWith('about:')) return;
    get().update((v) => {
      const now = Date.now();
      const existing = v.history.find((h) => h.url === url);
      if (existing) {
        return {
          ...v,
          history: [{ ...existing, title: title || existing.title, visitedAt: now, visits: existing.visits + 1 }, ...v.history.filter((h) => h.url !== url)].slice(0, HISTORY_LIMIT),
        };
      }
      const entry: HistoryEntry = { id: newId(), url, title: title || url, visitedAt: now, visits: 1 };
      return { ...v, history: [entry, ...v.history].slice(0, HISTORY_LIMIT) };
    });
  },
  removeHistory(id) {
    get().update((v) => ({ ...v, history: v.history.filter((h) => h.id !== id) }));
  },
  clearHistory() {
    get().update((v) => ({ ...v, history: [] }));
  },

  // --- Downloads -----------------------------------------------------------
  recordDownload(record) {
    const entry: DownloadRecord = { ...record, id: newId(), at: Date.now() };
    get().update((v) => ({ ...v, downloads: [entry, ...v.downloads].slice(0, 200) }));
    return entry;
  },
  markDownload(id, status) {
    get().update((v) => ({ ...v, downloads: v.downloads.map((d) => (d.id === id ? { ...d, status } : d)) }));
  },
  clearDownloads() {
    get().update((v) => ({ ...v, downloads: [] }));
  },

  // --- Settings ------------------------------------------------------------
  updateSettings(patch) {
    get().update((v) => ({ ...v, settings: { ...v.settings, ...patch } }));
    const merged = { ...get().vault?.settings, ...patch } as Settings;
    if (patch.locale) useUi.getState().setLocale(patch.locale);
    if (patch.density) useUi.getState().setDensity(patch.density);
    useSession.getState().applySettings(merged);
  },
}));

// Lifecycle wiring — the session store stays unaware of the vault store.
on('session:unlocked', ({ envelope }) => {
  void get0().hydrate(envelope as never);
});
on('session:locked', () => {
  get0().reset();
});
on('session:created', () => {
  /* hydration follows via session:unlocked */
});

function get0(): VaultState {
  return useVault.getState();
}

export const vaultSelectors = {
  weakPasswords: (v: Vault | null) => (v ? v.passwords.filter((p) => p.password.length < 10).length : 0),
  reusedPasswords: (v: Vault | null) => {
    if (!v) return 0;
    const seen = new Map<string, number>();
    for (const p of v.passwords) seen.set(p.password, (seen.get(p.password) ?? 0) + 1);
    return [...seen.values()].filter((n) => n > 1).reduce((n, c) => n + c, 0);
  },
  stalePasswords: (v: Vault | null) => {
    if (!v) return 0;
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 182;
    return v.passwords.filter((p) => p.updatedAt < cutoff).length;
  },
  folders: (v: Vault | null) => (v ? [...new Set(v.bookmarks.map((b) => b.folder || 'Favoris'))].sort() : []),
  tags: (v: Vault | null) => (v ? [...new Set([...v.notes, ...v.passwords].flatMap((x) => x.tags))].sort() : []),
};
