import { create } from 'zustand';
import { api, ApiError, type CloudStatus, type Snapshot } from '../lib/api';
import { emit } from '../lib/bus';
import { useSession } from './session';
import { useVault } from './vault';
import { useUi } from './ui';
import type { ProviderDescriptor, PublicConnection } from '../lib/types';

interface CloudState {
  providers: ProviderDescriptor[];
  connections: PublicConnection[];
  status: CloudStatus | null;
  snapshots: Snapshot[];
  busy: boolean;
  busyAction: string | null;
  error: string | null;
  lastSyncAt: number | null;

  load: () => Promise<void>;
  loadStatus: () => Promise<void>;
  loadSnapshots: () => Promise<void>;
  connectOAuth: (providerId: string) => void;
  connectWithCredentials: (providerId: string, credentials: Record<string, string>, label?: string) => Promise<{ ok: boolean; error?: string }>;
  connectSimulated: (providerId: string, label?: string) => Promise<{ ok: boolean; error?: string }>;
  disconnect: (connectionId: string) => Promise<void>;
  moveTo: (connectionId: string) => Promise<{ ok: boolean; error?: string }>;
  restore: (path: string, revision: number) => Promise<{ ok: boolean; error?: string }>;
  providerById: (id: string) => ProviderDescriptor | undefined;
  connectionById: (id: string) => PublicConnection | undefined;
}

export const useCloud = create<CloudState>((set, get) => ({
  providers: [],
  connections: [],
  status: null,
  snapshots: [],
  busy: false,
  busyAction: null,
  error: null,
  lastSyncAt: null,

  async load() {
    try {
      const { providers, connections } = await api.providers();
      set({
        providers,
        connections: [{ id: 'local', providerId: 'local', label: 'Nimbus Cloud', connectedAt: 0 }, ...connections],
        error: null,
      });
      void useSession.getState().refresh();
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : 'Espace cloud indisponible.' });
    }
  },

  async loadStatus() {
    if (useSession.getState().phase !== 'unlocked') return;
    set({ busy: true, busyAction: 'status' });
    try {
      const [status, snaps] = await Promise.all([api.cloudStatus(), api.snapshots().catch(() => ({ snapshots: [] as Snapshot[] }))]);
      set({ status, snapshots: snaps.snapshots, busy: false, busyAction: null, lastSyncAt: Date.now(), error: null });
      useSession.setState({
        connections: get().connections.filter((c) => c.id !== 'local'),
        activeProfile: useSession.getState().activeProfile
          ? { ...useSession.getState().activeProfile!, providerId: status.providerId, connectionId: status.connectionId, revision: status.revision, updatedAt: status.updatedAt }
          : null,
      });
    } catch (err) {
      set({ busy: false, busyAction: null, error: err instanceof ApiError ? err.message : 'État cloud indisponible.' });
    }
  },

  async loadSnapshots() {
    try {
      const { snapshots } = await api.snapshots();
      set({ snapshots });
    } catch {
      /* optional */
    }
  },

  connectOAuth(providerId) {
    // Full-page navigation: the provider redirects back to the engine callback.
    window.location.href = `/api/cloud/oauth/${encodeURIComponent(providerId)}/start`;
  },

  async connectWithCredentials(providerId, credentials, label) {
    set({ busy: true, busyAction: `connect:${providerId}`, error: null });
    try {
      const { connection } = await api.connect({ providerId, credentials, label });
      await get().load();
      set({ busy: false, busyAction: null });
      useUi.getState().toast(`${connection.label} — ${useUi.getState().t('cloud.connected')}`, 'success');
      emit('cloud:changed', undefined);
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false, busyAction: null, error: message });
      return { ok: false, error: message };
    }
  },

  async connectSimulated(providerId, label) {
    set({ busy: true, busyAction: `demo:${providerId}`, error: null });
    try {
      const provider = get().providerById(providerId);
      const { connection } = await api.connect({
        providerId,
        simulated: true,
        label: label ?? provider?.name ?? providerId,
        accountLabel: 'demo@nimbus.app',
      });
      await get().load();
      set({ busy: false, busyAction: null });
      useUi.getState().toast(`${connection.label} — ${useUi.getState().t('cloud.simulated')}`, 'info');
      emit('cloud:changed', undefined);
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false, busyAction: null, error: message });
      return { ok: false, error: message };
    }
  },

  async disconnect(connectionId) {
    set({ busy: true, busyAction: `disconnect:${connectionId}` });
    try {
      await api.disconnect(connectionId);
      await get().load();
      emit('cloud:changed', undefined);
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : 'Suppression impossible.' });
    } finally {
      set({ busy: false, busyAction: null });
    }
  },

  async moveTo(connectionId) {
    const profile = useSession.getState().activeProfile;
    if (!profile) return { ok: false, error: 'Aucune session active.' };
    set({ busy: true, busyAction: `move:${connectionId}`, error: null });
    try {
      // Flush local edits first so nothing is left behind on the old storage.
      await useVault.getState().syncNow({ snapshot: true });
      const res = await api.moveVault(profile.profileId, connectionId);
      await get().loadStatus();
      await useSession.getState().refresh();
      set({ busy: false, busyAction: null });
      const provider = get().providerById(res.profile.providerId);
      useUi.getState().toast(useUi.getState().t('cloud.switched', { provider: provider?.name ?? res.profile.providerId }), 'success');
      emit('cloud:changed', undefined);
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false, busyAction: null, error: message });
      return { ok: false, error: message };
    }
  },

  async restore(path, revision) {
    set({ busy: true, busyAction: `restore:${revision}`, error: null });
    try {
      await api.restoreSnapshot(path);
      const fresh = await api.vault();
      await useVault.getState().hydrate(fresh);
      await get().loadStatus();
      set({ busy: false, busyAction: null });
      useUi.getState().toast(useUi.getState().t('cloud.restored', { rev: revision }), 'success');
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      set({ busy: false, busyAction: null, error: message });
      return { ok: false, error: message };
    }
  },

  providerById: (id) => get().providers.find((p) => p.id === id),
  connectionById: (id) => get().connections.find((c) => c.id === id),
}));
