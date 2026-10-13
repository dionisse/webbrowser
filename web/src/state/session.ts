import { create } from 'zustand';
import { api, ApiError, type MetaResponse } from '../lib/api';
import {
  PBKDF2_ITERATIONS,
  deriveAuthHash,
  deriveMasterKey,
  encryptJson,
  forgetKey,
  randomSalt,
  type KdfParams,
} from '../lib/crypto';
import { emit, type LockReason } from '../lib/bus';
import { emptyVault, type PublicConnection, type PublicProfile, type Settings, type Vault } from '../lib/types';

export type Phase = 'boot' | 'locked' | 'unlocked';

interface SessionState {
  phase: Phase;
  meta: MetaResponse | null;
  profiles: PublicProfile[];
  connections: PublicConnection[];
  providers: MetaResponse['providers'];
  activeProfile: PublicProfile | null;

  /** Lives in memory only. Destroyed on lock, never serialised, never sent. */
  masterKey: CryptoKey | null;
  kdf: KdfParams | null;
  /** Session-scoped render token: lets the sandboxed frame reach the engine. */
  browseToken: string | null;

  selectedProfileId: string | null;
  busy: boolean;
  error: string | null;
  lockReason: LockReason | null;
  autoLockMinutes: number;
  lastActivity: number;
  unlockedAt: number | null;

  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  selectProfile: (id: string) => void;
  unlock: (profileId: string, password: string) => Promise<{ ok: true; envelope: unknown } | { ok: false; error: string }>;
  createVault: (input: { label: string; hue: number; password: string; connectionId: string; locale: 'fr' | 'en'; seed?: Partial<Vault> }) => Promise<{ ok: boolean; error?: string }>;
  lock: (reason?: LockReason) => Promise<void>;
  rekey: (currentPassword: string, newPassword: string, vault: Vault) => Promise<{ ok: boolean; error?: string }>;
  reEncrypt: (vault: Vault) => Promise<string | null>;
  touch: () => void;
  setAutoLock: (minutes: number) => void;
  applySettings: (settings: Settings) => void;
}

let idleTimer: number | undefined;
let blurHandler: (() => void) | undefined;

const clearIdle = () => {
  if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  idleTimer = undefined;
};

const armIdle = (minutes: number, fire: () => void) => {
  clearIdle();
  if (minutes <= 0) return;
  idleTimer = window.setTimeout(fire, minutes * 60_000);
};

export const useSession = create<SessionState>((set, get) => ({
  phase: 'boot',
  meta: null,
  profiles: [],
  connections: [],
  providers: [],
  activeProfile: null,
  masterKey: null,
  kdf: null,
  browseToken: null,
  selectedProfileId: null,
  busy: false,
  error: null,
  lockReason: null,
  autoLockMinutes: 10,
  lastActivity: Date.now(),
  unlockedAt: null,

  async boot() {
    set({ busy: true, error: null });
    try {
      const meta = await api.meta();
      set({
        meta,
        providers: meta.providers,
        connections: meta.connections,
        profiles: meta.profiles,
        phase: 'locked',
        busy: false,
        autoLockMinutes: meta.security.autoLockMinutes,
        selectedProfileId: meta.profiles[0]?.profileId ?? null,
        lockReason: meta.session.phase === 'unlocked' ? null : get().lockReason,
      });
      // The engine may already consider this cookie unlocked (page reload
      // inside the TTL). We still require the master password: the key is
      // derived in the browser and cannot be recovered from a cookie.
    } catch (err) {
      set({ busy: false, phase: 'locked', error: err instanceof ApiError ? err.message : 'Moteur injoignable.' });
    }
  },

  async refresh() {
    try {
      const meta = await api.meta();
      set({ meta, providers: meta.providers, connections: meta.connections, profiles: meta.profiles });
    } catch {
      /* non-fatal */
    }
  },

  selectProfile(profileId) {
    set({ selectedProfileId: profileId, error: null });
  },

  async unlock(profileId, password) {
    const profile = get().profiles.find((p) => p.profileId === profileId) ?? get().meta?.profiles.find((p) => p.profileId === profileId);
    if (!profile) return { ok: false as const, error: 'Profil introuvable.' };

    set({ busy: true, error: null });
    try {
      const kdf: KdfParams = { alg: 'PBKDF2-SHA256', iterations: profile.kdf.iterations, salt: profile.kdf.salt };
      const masterKey = await deriveMasterKey(password, kdf);
      const authHash = await deriveAuthHash(masterKey);
      const result = await api.unlock({ profileId, authHash });

      set({
        phase: 'unlocked',
        masterKey,
        kdf,
        browseToken: result.session?.browseToken ?? null,
        activeProfile: result.profile,
        selectedProfileId: profileId,
        busy: false,
        error: null,
        lockReason: null,
        unlockedAt: Date.now(),
        lastActivity: Date.now(),
      });

      armIdle(get().autoLockMinutes, () => void get().lock('idle'));
      emit('session:unlocked', { profileId, envelope: result.vault });
      return { ok: true as const, envelope: result.vault };
    } catch (err) {
      set({ busy: false, phase: 'locked', masterKey: null });
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ error: message });
      return { ok: false as const, error: message };
    }
  },

  async createVault({ label, hue, password, connectionId, locale, seed }) {
    set({ busy: true, error: null });
    try {
      const kdf: KdfParams = { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: randomSalt() };
      const masterKey = await deriveMasterKey(password, kdf);
      const authHash = await deriveAuthHash(masterKey);
      const vault: Vault = { ...emptyVault(label, hue, locale), ...(seed ?? {}) };
      const ciphertext = await encryptJson(masterKey, vault, 'vault');

      const created = await api.createProfile({ label, hue, kdf, authHash, vault: ciphertext, connectionId });
      const profile = created.profile;

      const meta = await api.meta().catch(() => null);
      set({
        phase: 'unlocked',
        masterKey,
        kdf,
        browseToken: created.browseToken ?? null,
        activeProfile: profile,
        selectedProfileId: profile.profileId,
        profiles: meta?.profiles ?? [profile],
        connections: meta?.connections ?? get().connections,
        providers: meta?.providers ?? get().providers,
        meta: meta ?? get().meta,
        busy: false,
        lockReason: null,
        unlockedAt: Date.now(),
        lastActivity: Date.now(),
      });

      armIdle(get().autoLockMinutes, () => void get().lock('idle'));
      emit('session:created', { profileId: profile.profileId });
      emit('session:unlocked', {
        profileId: profile.profileId,
        envelope: { revision: profile.revision, updatedAt: profile.updatedAt, sizeBytes: ciphertext.length, checksum: '', vault: ciphertext },
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false, error: message, phase: 'locked' });
      return { ok: false, error: message };
    }
  },

  async lock(reason: LockReason = 'manual') {
    const { masterKey } = get();
    forgetKey(masterKey);
    clearIdle();
    blurHandler?.();
    blurHandler = undefined;
    set({
      phase: 'locked',
      masterKey: null,
      kdf: null,
      browseToken: null,
      activeProfile: null,
      error: null,
      lockReason: reason,
      unlockedAt: null,
    });
    emit('session:locked', { reason });
    try {
      await api.lock();
    } catch {
      /* best effort — the client side is already wiped */
    }
  },

  async rekey(currentPassword, newPassword, vault) {
    const { activeProfile, kdf } = get();
    if (!activeProfile || !kdf) return { ok: false, error: 'Aucune session active.' };
    set({ busy: true });
    try {
      const oldKey = await deriveMasterKey(currentPassword, kdf);
      const oldHash = await deriveAuthHash(oldKey);
      const newKdf: KdfParams = { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: randomSalt() };
      const newKey = await deriveMasterKey(newPassword, newKdf);
      const newHash = await deriveAuthHash(newKey);
      const ciphertext = await encryptJson(newKey, { ...vault, updatedAt: Date.now() }, 'vault');

      // The server checks the current hash before accepting the new one.
      await api.unlock({ profileId: activeProfile.profileId, authHash: oldHash });
      const { profile } = await api.rekey(activeProfile.profileId, { authHash: newHash, vault: ciphertext });

      forgetKey(get().masterKey);
      forgetKey(oldKey);
      set({ masterKey: newKey, kdf: newKdf, activeProfile: profile, busy: false });
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false });
      return { ok: false, error: message };
    }
  },

  /** Re-seal the vault with the live key — used before every sync. */
  async reEncrypt(vault) {
    const key = get().masterKey;
    if (!key) return null;
    return encryptJson(key, { ...vault, updatedAt: Date.now() }, 'vault');
  },

  touch() {
    const { phase, autoLockMinutes } = get();
    if (phase !== 'unlocked') return;
    set({ lastActivity: Date.now() });
    armIdle(autoLockMinutes, () => void get().lock('idle'));
  },

  setAutoLock(minutes) {
    set({ autoLockMinutes: minutes });
    if (get().phase === 'unlocked') armIdle(minutes, () => void get().lock('idle'));
  },

  applySettings(settings) {
    get().setAutoLock(settings.autoLockMinutes);
    blurHandler?.();
    blurHandler = undefined;
    if (settings.lockOnBlur) {
      blurHandler = () => {
        const handler = () => {
          if (document.hidden) void get().lock('idle');
        };
        document.addEventListener('visibilitychange', handler);
        window.addEventListener('beforeunload', () => {
          forgetKey(get().masterKey);
          void fetch('/api/profiles/lock', { method: 'POST', keepalive: true, credentials: 'same-origin' });
        });
      };
      blurHandler();
    }
  },
}));

/** Any interaction pushes the auto-lock deadline out. */
export function watchActivity(): () => void {
  const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  let last = 0;
  const handler = () => {
    const now = Date.now();
    if (now - last < 15_000) return; // throttle store writes
    last = now;
    useSession.getState().touch();
  };
  for (const e of events) window.addEventListener(e, handler, { passive: true });
  return () => {
    for (const e of events) window.removeEventListener(e, handler);
  };
}

/** Losing the tab or unloading the page must never leave a usable key behind. */
export function watchUnload(): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      // The session cookie survives; the in-memory key does not need to.
    }
  };
  const onUnload = () => {
    forgetKey(useSession.getState().masterKey);
    void fetch('/api/profiles/lock', { method: 'POST', keepalive: true, credentials: 'same-origin' });
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onUnload);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onUnload);
  };
}
