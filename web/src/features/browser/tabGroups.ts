import { useCallback } from 'react';
import { newId } from '../../lib/crypto';
import { brandHues } from '../../design/components/theme';
import { useBrowser } from '../../state/browser';
import { useVault } from '../../state/vault';
import type { TabGroup } from '../../lib/types';

const PALETTE = [12, 28, 96, 148, 200, 262, 320];

/**
 * Tab groups are persisted in the encrypted vault (so they follow the user's
 * Drive) while the per-tab `groupId` lives in ephemeral browser state.
 */
export function useTabGroups() {
  const groups = useVault((s) => s.vault?.tabGroups ?? []);
  const update = useVault((s) => s.update);
  const patchTab = useBrowser((s) => s.patchTab);

  const groupById = useCallback((id?: string) => groups.find((g) => g.id === id), [groups]);

  const create = useCallback(
    (name: string, tabIds: string[]) => {
      const group: TabGroup = {
        id: newId(),
        name: name.trim() || 'Groupe',
        hue: PALETTE[groups.length % PALETTE.length] ?? brandHues.nimbus ?? 12,
        tabIds,
        createdAt: Date.now(),
      };
      update((v) => ({ ...v, tabGroups: [...v.tabGroups, group] }));
      for (const id of tabIds) patchTab(id, { groupId: group.id });
      return group;
    },
    [groups.length, update, patchTab],
  );

  const assign = useCallback(
    (groupId: string, tabId: string) => {
      update((v) => ({
        ...v,
        tabGroups: v.tabGroups.map((g) => (g.id === groupId ? { ...g, tabIds: [...new Set([...g.tabIds, tabId])] } : g)),
      }));
      patchTab(tabId, { groupId });
    },
    [update, patchTab],
  );

  const unassign = useCallback(
    (tabId: string, groupId?: string) => {
      update((v) => ({
        ...v,
        tabGroups: v.tabGroups
          .map((g) => (g.id === groupId || !groupId ? { ...g, tabIds: g.tabIds.filter((x) => x !== tabId) } : g))
          .filter((g) => g.tabIds.length > 0),
      }));
      patchTab(tabId, { groupId: undefined });
    },
    [update, patchTab],
  );

  const rename = useCallback(
    (groupId: string, name: string) => {
      update((v) => ({ ...v, tabGroups: v.tabGroups.map((g) => (g.id === groupId ? { ...g, name } : g)) }));
    },
    [update],
  );

  const dissolve = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      update((v) => ({ ...v, tabGroups: v.tabGroups.filter((g) => g.id !== groupId) }));
      for (const id of group?.tabIds ?? []) patchTab(id, { groupId: undefined });
    },
    [groups, update, patchTab],
  );

  /** Drop closed tabs from every group so the vault never accumulates ghosts. */
  const prune = useCallback(
    (liveIds: string[]) => {
      update((v) => ({
        ...v,
        tabGroups: v.tabGroups.map((g) => ({ ...g, tabIds: g.tabIds.filter((id) => liveIds.includes(id)) })).filter((g) => g.tabIds.length > 0),
      }));
    },
    [update],
  );

  return { groups, groupById, create, assign, unassign, rename, dissolve, prune };
}
