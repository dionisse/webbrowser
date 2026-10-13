import { useCallback } from 'react';
import { useBrowser } from '../../state/browser';

/**
 * Navigate the active tab (or open a new one) from anywhere in the shell —
 * start page, panels, suggestions, error pages.
 */
export function useNavigateTo() {
  const navigate = useBrowser((s) => s.navigate);
  const activeId = useBrowser((s) => s.activeId);
  return useCallback(
    (url: string, opts?: { newTab?: boolean; method?: 'GET' | 'POST'; body?: string; replace?: boolean }) => {
      if (opts?.newTab) {
        useBrowser.getState().openTab(url);
        return;
      }
      const target = activeId ?? useBrowser.getState().tabs[0]?.id;
      if (target) navigate(target, url, opts);
    },
    [navigate, activeId],
  );
}

/** Convenience for panels that always want a fresh tab. */
export function useOpenInNewTab() {
  const openTab = useBrowser((s) => s.openTab);
  return useCallback((url: string) => openTab(url), [openTab]);
}
