import { create } from 'zustand';
import { api, INTERNAL_SCHEME, type BrowseStats } from '../lib/api';
import { newId } from '../lib/crypto';
import { emit } from '../lib/bus';
import { useVault } from './vault';
import type { Tab } from '../lib/types';

export interface BrowserTab extends Tab {
  stack: string[];
  stackIndex: number;
  reloadKey: number;
  method?: 'GET' | 'POST';
  postBody?: string;
}

export const SEARCH_ENGINES: Record<string, { label: string; template: string }> = {
  duckduckgo: { label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q={q}' },
  google: { label: 'Google', template: 'https://www.google.com/search?q={q}' },
  bing: { label: 'Bing', template: 'https://www.bing.com/search?q={q}' },
  brave: { label: 'Brave', template: 'https://search.brave.com/search?q={q}' },
  startpage: { label: 'Startpage', template: 'https://www.startpage.com/sp/search?query={q}' },
  qwant: { label: 'Qwant', template: 'https://www.qwant.com/?q={q}' },
};

/** Build a client-side `nimbus://` destination. */
export const internalUrl = (id: string): string => `${INTERNAL_SCHEME}${id}`;

export const START_URL = internalUrl('start');

const internalId = (url: string): string => url.replace(INTERNAL_SCHEME, '').split(/[/?#]/)[0] ?? '';

const makeTab = (url: string, extra: Partial<BrowserTab> = {}): BrowserTab => {
  const now = Date.now();
  const internal = url.startsWith(INTERNAL_SCHEME) ? (internalId(url) as Tab['internal']) : undefined;
  return {
    id: newId(),
    url,
    title: internal ? internalId(url) : url,
    status: internal ? 'internal' : 'loading',
    reader: false,
    pinned: false,
    blockedCount: 0,
    openedAt: now,
    lastAccessedAt: now,
    internal,
    stack: [url],
    stackIndex: 0,
    reloadKey: 0,
    ...extra,
  };
};

interface BrowserState {
  tabs: BrowserTab[];
  activeId: string | null;
  splitId: string | null;
  omnibox: string;
  omniboxFocused: boolean;
  stats: BrowseStats | null;
  proxiedRequests: number;
  blockedTotal: number;

  openTab: (url?: string) => string;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  activate: (id: string) => void;
  navigate: (id: string, url: string, opts?: { newTab?: boolean; method?: 'GET' | 'POST'; body?: string; replace?: boolean }) => void;
  patchTab: (id: string, patch: Partial<BrowserTab>) => void;
  goBack: (id: string) => void;
  goForward: (id: string) => void;
  reload: (id: string) => void;
  togglePin: (id: string) => void;
  toggleReader: (id: string) => void;
  duplicate: (id: string) => void;
  moveTab: (from: number, to: number) => void;

  setSplit: (id: string | null) => void;
  toggleSplit: () => void;

  setOmnibox: (v: string) => void;
  setOmniboxFocused: (v: boolean) => void;

  countProxied: (n?: number) => void;
  countBlocked: (tabId: string, n: number) => void;
  refreshStats: () => Promise<void>;

  restoreTabs: (urls: string[]) => void;
  activeTab: () => BrowserTab | undefined;
  splitTab: () => BrowserTab | undefined;
}

/** Resolve whatever the user typed into a navigable target. */
export function resolveOmnibox(input: string, searchEngine: string): string {
  const raw = input.trim();
  if (!raw) return START_URL;
  if (raw.startsWith(INTERNAL_SCHEME)) return raw;
  if (/^(https?|ftp):\/\//i.test(raw)) return raw;
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(raw) && !raw.includes(' ');
  if (looksLikeHost) return `https://${raw}`;
  const engine = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES.duckduckgo!;
  return engine.template.replace('{q}', encodeURIComponent(raw));
}

export const hostOf = (url: string): string => {
  if (url.startsWith(INTERNAL_SCHEME)) return 'nimbus';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 32);
  }
};

export const isInternalUrl = (url: string): boolean => url.startsWith(INTERNAL_SCHEME);

export const useBrowser = create<BrowserState>((set, get) => {
  const initial = makeTab(START_URL);
  return {
    tabs: [initial],
    activeId: initial.id,
    splitId: null,
    omnibox: '',
    omniboxFocused: false,
    stats: null,
    proxiedRequests: 0,
    blockedTotal: 0,

    openTab(url = START_URL) {
      const tab = makeTab(url);
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      void get().refreshStats();
      return tab.id;
    },

    closeTab(id) {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx < 0) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        if (tabs.length === 0) {
          const fresh = makeTab(START_URL);
          return { tabs: [fresh], activeId: fresh.id, splitId: null };
        }
        const activeId = s.activeId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? tabs[0]!.id) : s.activeId;
        return { tabs, activeId, splitId: s.splitId === id ? null : s.splitId };
      });
    },

    closeOthers(id) {
      set((s) => {
        const keep = s.tabs.filter((t) => t.id === id || t.pinned);
        return { tabs: keep, activeId: id, splitId: keep.some((t) => t.id === s.splitId) ? s.splitId : null };
      });
    },

    activate(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastAccessedAt: Date.now() } : t)), activeId: id }));
    },

    navigate(id, url, opts) {
      const target = opts?.newTab ? get().openTab(url) : id;
      if (opts?.newTab) return;

      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== target) return t;
          const internal = url.startsWith(INTERNAL_SCHEME) ? (internalId(url) as Tab['internal']) : undefined;
          if (opts?.replace) {
            const stack = [...t.stack.slice(0, t.stackIndex + 1)];
            stack[stack.length - 1] = url;
            return { ...t, url, title: internal ? internalId(url) : t.title, status: internal ? 'internal' : 'loading', internal, error: undefined, stack, stackIndex: stack.length - 1, method: opts.method, postBody: opts.body, lastAccessedAt: Date.now() };
          }
          const stack = [...t.stack.slice(0, t.stackIndex + 1), url];
          return {
            ...t,
            url,
            title: internal ? internalId(url) : t.title,
            status: internal ? 'internal' : 'loading',
            internal,
            error: undefined,
            reader: false,
            stack,
            stackIndex: stack.length - 1,
            method: opts?.method ?? 'GET',
            postBody: opts?.body,
            lastAccessedAt: Date.now(),
          };
        }),
      }));

      if (!internal0(url)) {
        get().countProxied(1);
        // History lives in the encrypted vault, so it follows the user's Drive.
        useVault.getState().recordVisit(url, '');
      }
      emit('browser:navigate', { tabId: target, url, newTab: false });
    },

    patchTab(id, patch) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    },

    goBack(id) {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id || t.stackIndex <= 0) return t;
          const stackIndex = t.stackIndex - 1;
          const url = t.stack[stackIndex]!;
          return { ...t, stackIndex, url, internal: internal0(url) ? (internalId(url) as Tab['internal']) : undefined, status: internal0(url) ? 'internal' : 'loading', reloadKey: t.reloadKey + 1 };
        }),
      }));
    },

    goForward(id) {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id || t.stackIndex >= t.stack.length - 1) return t;
          const stackIndex = t.stackIndex + 1;
          const url = t.stack[stackIndex]!;
          return { ...t, stackIndex, url, internal: internal0(url) ? (internalId(url) as Tab['internal']) : undefined, status: internal0(url) ? 'internal' : 'loading', reloadKey: t.reloadKey + 1 };
        }),
      }));
    },

    reload(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, reloadKey: t.reloadKey + 1, status: internal0(t.url) ? 'internal' : 'loading', error: undefined } : t)) }));
    },

    togglePin(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) }));
    },

    toggleReader(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, reader: !t.reader, reloadKey: t.reloadKey + 1 } : t)) }));
    },

    duplicate(id) {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return;
      get().openTab(tab.url);
    },

    moveTab(from, to) {
      set((s) => {
        const tabs = [...s.tabs];
        const [moved] = tabs.splice(from, 1);
        if (!moved) return s;
        tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, moved);
        return { tabs };
      });
    },

    setSplit(id) {
      set({ splitId: id });
    },

    toggleSplit() {
      const { splitId, activeId, tabs } = get();
      if (splitId) {
        set({ splitId: null });
        return;
      }
      const other = tabs.find((t) => t.id !== activeId);
      set({ splitId: other?.id ?? get().openTab(START_URL) });
    },

    setOmnibox(omnibox) {
      set({ omnibox });
    },
    setOmniboxFocused(omniboxFocused) {
      set({ omniboxFocused });
    },

    countProxied(n = 1) {
      set((s) => ({ proxiedRequests: s.proxiedRequests + n }));
    },

    countBlocked(tabId, n) {
      set((s) => ({
        blockedTotal: s.blockedTotal + n,
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, blockedCount: t.blockedCount + n } : t)),
      }));
    },

    async refreshStats() {
      try {
        const stats = await api.browseStats();
        set({ stats, blockedTotal: Math.max(get().blockedTotal, stats.blockedRequests) });
      } catch {
        /* engine stats are cosmetic */
      }
    },

    restoreTabs(urls) {
      const tabs = (urls.length ? urls : [START_URL]).map((u) => makeTab(u));
      set({ tabs, activeId: tabs[0]!.id, splitId: null });
    },

    activeTab: () => get().tabs.find((t) => t.id === get().activeId),
    splitTab: () => get().tabs.find((t) => t.id === get().splitId),
  };
});

const internal0 = (url: string): boolean => url.startsWith(INTERNAL_SCHEME);
