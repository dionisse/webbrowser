import { create } from 'zustand';
import type { Translate } from '../i18n';
import { makeT, type Locale } from '../i18n';
import { onUnauthorized } from '../lib/api';

export type SidebarPanel = 'none' | 'bookmarks' | 'history' | 'downloads' | 'privacy';
export type ToastKind = 'info' | 'success' | 'warn' | 'danger';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
  at: number;
}

interface UiState {
  locale: Locale;
  t: Translate;
  setLocale: (l: Locale) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind, opts?: { detail?: string; action?: Toast['action']; ttl?: number }) => string;
  dismissToast: (id: string) => void;

  sidebar: SidebarPanel;
  toggleSidebar: (panel?: SidebarPanel) => void;
  closeSidebar: () => void;

  splitView: boolean;
  toggleSplit: () => void;

  mobileView: boolean;
  setMobileView: (v: boolean) => void;
  mobileTab: 'browse' | 'vault' | 'cloud' | 'settings';
  setMobileTab: (t: UiState['mobileTab']) => void;

  modal: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;

  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;

  density: 'cozy' | 'compact';
  setDensity: (d: 'cozy' | 'compact') => void;

  bootError: string | null;
  setBootError: (e: string | null) => void;
}

const timers = new Map<string, number>();

export const useUi = create<UiState>((set, get) => ({
  locale: 'fr',
  t: makeT('fr'),
  setLocale: (locale) => set({ locale, t: makeT(locale) }),

  toasts: [],
  toast: (message, kind = 'info', opts) => {
    const id = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = { id, kind, message, detail: opts?.detail, action: opts?.action, at: Date.now() };
    set({ toasts: [...get().toasts, toast].slice(-4) });
    const ttl = opts?.ttl ?? (kind === 'danger' ? 7000 : 3800);
    timers.set(id, window.setTimeout(() => get().dismissToast(id), ttl));
    return id;
  },
  dismissToast: (id) => {
    const timer = timers.get(id);
    if (timer) window.clearTimeout(timer);
    timers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  sidebar: 'none',
  toggleSidebar: (panel) => set((s) => ({ sidebar: panel && s.sidebar !== panel ? panel : s.sidebar === 'none' ? (panel ?? 'bookmarks') : 'none' })),
  closeSidebar: () => set({ sidebar: 'none' }),

  splitView: false,
  toggleSplit: () => set((s) => ({ splitView: !s.splitView })),

  mobileView: typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  setMobileView: (mobileView) => set({ mobileView }),
  mobileTab: 'browse',
  setMobileTab: (mobileTab) => set({ mobileTab }),

  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),

  density: 'cozy',
  setDensity: (density) => set({ density }),

  bootError: null,
  setBootError: (bootError) => set({ bootError }),
}));

/** Keep the shell in sync with the viewport so desktop/mobile share one tree. */
export function watchViewport(): () => void {
  const mq = window.matchMedia('(max-width: 899px)');
  const apply = () => useUi.setState({ mobileView: mq.matches });
  apply();
  mq.addEventListener('change', apply);
  return () => mq.removeEventListener('change', apply);
}

/** The session store registers its lock handler here on boot. */
export function wireUnauthorized(lock: () => void): () => void {
  onUnauthorized.add(lock);
  return () => onUnauthorized.delete(lock);
}

export const useT = (): Translate => useUi((s) => s.t);
