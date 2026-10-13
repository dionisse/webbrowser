import { useEffect, useMemo, useRef, useState } from 'react';
import { engineViewUrl, internalPages, unwrapEngineUrl } from '../../lib/api';
import { AutofillPrompt } from '../../design/components/Overlays';
import { isInternalUrl, useBrowser, type BrowserTab } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import type { PasswordEntry } from '../../lib/types';
import { ErrorView, type ErrorInfo } from './ErrorView';
import { InternalPage } from './InternalPage';
import { ReaderView } from './ReaderView';

/** Protocol spoken by the in-page shim and by the engine's error card. */
type FrameMessage =
  | { __nimbus: 'navigate'; url?: string; newTab?: boolean; reload?: boolean; method?: 'GET' | 'POST'; body?: string; source?: string }
  | { __nimbus: 'reader'; url?: string; source?: string }
  | { __nimbus: 'ready'; url?: string; title?: string; pageUrl?: string }
  | { __nimbus: 'failed'; url?: string; kind?: string; status?: number | null }
  | { __nimbus: 'autofill'; url?: string };

/**
 * Renders one tab.
 *
 * Proxied documents live in a sandboxed frame *without* `allow-same-origin`:
 * the page therefore runs in an opaque origin, cannot reach the shell's DOM,
 * storage or cookies, and can only talk to Nimbus through `postMessage`. Every
 * message is checked against `event.source === frame.contentWindow`, so a
 * nested frame or another window cannot impersonate the page.
 */
export const PageView = ({ tab }: { tab: BrowserTab }) => {
  const t = useUi((s) => s.t);
  const toast = useUi((s) => s.toast);
  const settings = useVault((s) => s.vault?.settings ?? null);
  const browseToken = useSession((s) => s.browseToken);
  const navigate = useBrowser((s) => s.navigate);
  const patchTab = useBrowser((s) => s.patchTab);
  const reload = useBrowser((s) => s.reload);
  const toggleReader = useBrowser((s) => s.toggleReader);
  const countProxied = useBrowser((s) => s.countProxied);
  const recordVisit = useVault((s) => s.recordVisit);
  const markPasswordUsed = useVault((s) => s.markPasswordUsed);

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [failure, setFailure] = useState<ErrorInfo | null>(null);
  const [autofill, setAutofill] = useState<PasswordEntry | null>(null);

  const clientPage = tab.internal && (internalPages as readonly string[]).includes(tab.internal) ? tab.internal : null;
  const isInternal = isInternalUrl(tab.url);

  const src = useMemo(
    () =>
      engineViewUrl(tab.url, {
        block: settings?.blockTrackers ?? true,
        nuisance: settings?.hideNuisance ?? true,
        token: browseToken,
      }),
    [tab.url, settings?.blockTrackers, settings?.hideNuisance, browseToken],
  );

  /* A new address or a forced reload starts from a clean slate. */
  useEffect(() => {
    setFailure(null);
  }, [tab.url, tab.reloadKey, tab.reader]);

  /* One listener for the whole app would leak between tabs: scope it here. */
  useEffect(() => {
    if (clientPage || tab.reader) return;

    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as FrameMessage | null;
      if (!data || typeof data !== 'object' || typeof (data as { __nimbus?: unknown }).__nimbus !== 'string') return;

      switch (data.__nimbus) {
        case 'navigate': {
          const target = unwrapEngineUrl(String(data.url ?? ''));
          if (!target) return;
          if (data.reload) {
            reload(tab.id);
            return;
          }
          navigate(tab.id, target, {
            newTab: Boolean(data.newTab),
            method: data.method === 'POST' ? 'POST' : undefined,
            body: data.body,
          });
          if (!data.newTab) countProxied(1);
          return;
        }
        case 'reader': {
          const target = unwrapEngineUrl(String(data.url ?? tab.url));
          if (target !== tab.url) navigate(tab.id, target);
          if (!tab.reader) toggleReader(tab.id);
          return;
        }
        case 'ready': {
          const finalUrl = data.pageUrl ? String(data.pageUrl) : unwrapEngineUrl(String(data.url ?? ''));
          const title = (data.title ?? '').trim();
          patchTab(tab.id, { status: 'idle', ...(title ? { title } : {}) });
          if (title && finalUrl) recordVisit(finalUrl, title);
          // Followed redirects: keep the address bar honest without growing
          // the back-stack (the entry is replaced, not appended).
          if (finalUrl && finalUrl !== tab.url && !isInternalUrl(finalUrl)) navigate(tab.id, finalUrl, { replace: true });
          return;
        }
        case 'failed': {
          setFailure({
            url: String(data.url ?? tab.url),
            kind: data.kind,
            status: data.status ?? null,
          });
          patchTab(tab.id, { status: 'error' });
          return;
        }
        case 'autofill': {
          const host = hostKey(tab.url);
          const entry = bestMatch(host);
          if (entry) setAutofill(entry);
          else toast(t('passwords.autofillCancel'), 'warn');
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.url, tab.reader, clientPage]);

  const bestMatch = (host: string): PasswordEntry | null => {
    const entries = useVault.getState().vault?.passwords ?? [];
    if (entries.length === 0) return null;
    const exact = entries.filter((e) => hostKey(e.url) === host);
    if (exact.length > 0) return exact.sort((a, b) => Number(b.favorite) - Number(a.favorite))[0] ?? null;
    const partial = entries.find((e) => (host ? hostKey(e.url).endsWith(host) || host.endsWith(hostKey(e.url)) : false));
    return partial ?? null;
  };

  const confirmAutofill = () => {
    if (!autofill) return;
    markPasswordUsed(autofill.id);
    void navigator.clipboard?.writeText(autofill.password).then(
      () => toast(t('passwords.copiedPassword', { user: autofill.username }), 'success'),
      () => toast(t('errors.generic'), 'danger'),
    );
    setAutofill(null);
  };

  /* --- Client-rendered Nimbus pages ------------------------------------- */
  if (clientPage) return <InternalPage id={clientPage} />;

  /* --- Reader mode ------------------------------------------------------- */
  if (tab.reader && !isInternal) {
    return <ReaderView url={tab.url} fontSize={settings?.readerFontSize ?? 17} onOpenFull={() => toggleReader(tab.id)} />;
  }

  /* --- Engine failure ---------------------------------------------------- */
  if (failure) {
    return (
      <ErrorView
        error={failure}
        onRetry={() => reload(tab.id)}
        onReader={() => {
          setFailure(null);
          if (!tab.reader) toggleReader(tab.id);
        }}
        onDemo={() => navigate(tab.id, 'nimbus://index')}
      />
    );
  }

  /* --- Proxied document --------------------------------------------------- */
  return (
    <>
      <iframe
        ref={frameRef}
        key={`${tab.id}:${tab.reloadKey}:${src}`}
        className="page-frame"
        src={src}
        title={tab.title || tab.url}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={() => {
          if (tab.status === 'loading') patchTab(tab.id, { status: 'idle' });
        }}
      />
      <AutofillPrompt
        open={Boolean(autofill)}
        site={hostKey(tab.url)}
        username={autofill?.username ?? ''}
        onConfirm={confirmAutofill}
        onCancel={() => setAutofill(null)}
      />
    </>
  );
};

/** Registered-ish host used to match vault entries to the current page. */
export const hostKey = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]!.toLowerCase();
  }
};
