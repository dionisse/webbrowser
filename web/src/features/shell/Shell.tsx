import { useEffect } from 'react';
import { START_URL, useBrowser } from '../../state/browser';
import { useUi } from '../../state/ui';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';

/**
 * One shell, two form factors. The desktop build gets a rail, a tab strip and
 * optional split view; the mobile companion collapses the same stores into a
 * top bar, a scrollable tab row and a four-slot tab bar.
 */
export const Shell = () => {
  const mobileView = useUi((s) => s.mobileView);
  const refreshStats = useBrowser((s) => s.refreshStats);

  /* Engine counters feed the status bar and the start page. */
  useEffect(() => {
    const id = window.setInterval(() => void refreshStats(), 20_000);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  /* Browser-grade shortcuts, without stealing keys from the page frame. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const state = useBrowser.getState();
      const activeId = state.activeId;
      if (!activeId) return;

      if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        state.openTab(START_URL);
        return;
      }
      if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        state.closeTab(activeId);
        return;
      }
      if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
        state.reload(activeId);
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        state.goBack(activeId);
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        state.goForward(activeId);
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUi.getState().toggleSidebar('bookmarks');
        return;
      }
      if (mod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        useUi.getState().toggleSidebar('history');
        return;
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        useUi.getState().toggleSidebar('downloads');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return mobileView ? <MobileShell /> : <DesktopShell />;
};
