import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Copy,
  Download,
  Home,
  Lock,
  RotateCw,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { Chip, IconButton } from '../../design/components';
import { useClickOutside } from '../../design/components';
import { hueFromString, shortHost } from '../../design/components/theme';
import { INTERNAL_SCHEME } from '../../lib/api';
import { START_URL, isInternalUrl, resolveOmnibox, useBrowser } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';

interface Suggestion {
  id: string;
  label: string;
  sub: string;
  url: string;
  group: 'bookmarks' | 'history' | 'vault' | 'search';
}

export const Toolbar = () => {
  const t = useUi((s) => s.t);
  const toast = useUi((s) => s.toast);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebar = useUi((s) => s.sidebar);
  const tab = useBrowser((s) => s.activeTab());
  const omnibox = useBrowser((s) => s.omnibox);
  const setOmnibox = useBrowser((s) => s.setOmnibox);
  const focused = useBrowser((s) => s.omniboxFocused);
  const setFocused = useBrowser((s) => s.setOmniboxFocused);
  const navigate = useBrowser((s) => s.navigate);
  const goBack = useBrowser((s) => s.goBack);
  const goForward = useBrowser((s) => s.goForward);
  const reload = useBrowser((s) => s.reload);
  const toggleReader = useBrowser((s) => s.toggleReader);
  const bookmarks = useVault((s) => s.vault?.bookmarks ?? []);
  const history = useVault((s) => s.vault?.history ?? []);
  const passwords = useVault((s) => s.vault?.passwords ?? []);
  const settings = useVault((s) => s.vault?.settings ?? null);
  const addBookmark = useVault((s) => s.addBookmark);
  const removeBookmark = useVault((s) => s.removeBookmark);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const omniboxRef = useClickOutside<HTMLDivElement>(() => setFocused(false), focused);

  const url = tab?.url ?? START_URL;
  const isNimbus = isInternalUrl(url);
  const bookmarked = bookmarks.find((b) => b.url === url);

  /* Ctrl/Cmd+L focuses the address bar from anywhere in the shell. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setFocused(true);
        window.setTimeout(() => inputRef.current?.select(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFocused]);

  useEffect(() => {
    if (focused) {
      setOmnibox(url);
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
    setCursor(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, tab?.id]);

  const query = focused ? omnibox.trim().toLowerCase() : '';

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!focused) return [];
    const out: Suggestion[] = [];
    if (query) {
      for (const b of bookmarks) {
        if (`${b.title} ${b.url}`.toLowerCase().includes(query)) out.push({ id: `b-${b.id}`, label: b.title || b.url, sub: shortHost(b.url), url: b.url, group: 'bookmarks' });
        if (out.length > 6) break;
      }
      for (const h of history) {
        if (`${h.title} ${h.url}`.toLowerCase().includes(query)) out.push({ id: `h-${h.id}`, label: h.title || h.url, sub: shortHost(h.url), url: h.url, group: 'history' });
        if (out.length > 12) break;
      }
      for (const p of passwords) {
        if (`${p.title} ${p.username} ${p.url}`.toLowerCase().includes(query))
          out.push({ id: `p-${p.id}`, label: p.title, sub: `${p.username} · ${shortHost(p.url)}`, url: p.url || '', group: 'vault' });
        if (out.length > 15) break;
      }
    } else {
      for (const b of bookmarks.slice(0, 6)) out.push({ id: `b-${b.id}`, label: b.title || b.url, sub: shortHost(b.url), url: b.url, group: 'bookmarks' });
      for (const h of history.slice(0, 6)) out.push({ id: `h-${h.id}`, label: h.title || h.url, sub: shortHost(h.url), url: h.url, group: 'history' });
    }
    const engine = settings?.searchEngine ?? 'duckduckgo';
    if (query && !query.startsWith(INTERNAL_SCHEME)) {
      out.push({
        id: 'search',
        label: t('browser.search', { engine: engine.charAt(0).toUpperCase() + engine.slice(1) }),
        sub: query,
        url: resolveOmnibox(query, engine),
        group: 'search',
      });
    }
    return out.filter((s) => s.url).slice(0, 14);
  }, [focused, query, bookmarks, history, passwords, settings?.searchEngine, t]);

  const commit = (raw?: string) => {
    const value = (raw ?? omnibox).trim();
    if (!tab) return;
    const target = resolveOmnibox(value, settings?.searchEngine ?? 'duckduckgo');
    navigate(tab.id, target);
    setFocused(false);
    setOmnibox('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = suggestions[cursor];
      commit(picked ? picked.url : omnibox);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setFocused(false);
      setOmnibox('');
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, suggestions.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    }
  };

  const pretty = useMemo(() => {
    if (isNimbus) return { host: url.replace(INTERNAL_SCHEME, ''), rest: '' };
    try {
      const parsed = new URL(url);
      return { host: parsed.hostname.replace(/^www\./, ''), rest: `${parsed.pathname}${parsed.search}`.replace(/\/$/, '') };
    } catch {
      return { host: url, rest: '' };
    }
  }, [url, isNimbus]);

  const groups: { key: Suggestion['group']; label: string }[] = [
    { key: 'bookmarks', label: t('browser.fromBookmarks') },
    { key: 'history', label: t('browser.fromHistory') },
    { key: 'vault', label: t('browser.fromVault') },
    { key: 'search', label: t('browser.suggestions') },
  ];

  return (
    <div className="toolbar">
      <IconButton label={t('browser.back')} size="sm" disabled={!tab || tab.stackIndex <= 0} onClick={() => tab && goBack(tab.id)}>
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton label={t('browser.forward')} size="sm" disabled={!tab || tab.stackIndex >= tab.stack.length - 1} onClick={() => tab && goForward(tab.id)}>
        <ArrowRight size={16} />
      </IconButton>
      <IconButton label={tab?.status === 'loading' ? t('browser.stop') : t('browser.reload')} size="sm" onClick={() => tab && reload(tab.id)}>
        {tab?.status === 'loading' ? <X size={16} /> : <RotateCw size={15} />}
      </IconButton>
      <IconButton label={t('browser.home')} size="sm" onClick={() => tab && navigate(tab.id, START_URL)}>
        <Home size={15} />
      </IconButton>

      <div className="omnibox" ref={omniboxRef}>
        {isNimbus ? (
          <span className="omnibox__lock omnibox__lock--internal" title={t('browser.internalPage')}>
            <Chip as="span" tone="ember" className="omnibox__pill">
              nimbus://
            </Chip>
          </span>
        ) : tab?.status === 'error' ? (
          <span className="omnibox__lock omnibox__lock--error" title={t('browser.failedTitle')}>
            <X size={14} />
          </span>
        ) : (
          <span className="omnibox__lock" title={t('privacy.zeroKnowledge')}>
            <ShieldCheck size={14} />
          </span>
        )}

        {focused ? (
          <input
            ref={inputRef}
            value={omnibox}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('browser.addressPlaceholder')}
            onChange={(e) => {
              setOmnibox(e.target.value);
              setCursor(0);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            aria-label={t('browser.addressPlaceholder')}
          />
        ) : (
          <button
            type="button"
            className="omnibox__display"
            onClick={() => {
              setFocused(true);
              setOmnibox(url);
            }}
          >
            {isNimbus ? (
              <span className="omnibox__rest">{pretty.host}</span>
            ) : (
              <>
                <span className="omnibox__host">{pretty.host}</span>
                <span className="omnibox__rest">{pretty.rest}</span>
              </>
            )}
          </button>
        )}

        {tab && tab.blockedCount > 0 && !isNimbus ? (
          <span className="omnibox__pill" title={t('browser.trackersBlocked', { n: tab.blockedCount })}>
            <Chip as="span" tone="sage">
              <ShieldCheck size={11} /> {tab.blockedCount}
            </Chip>
          </span>
        ) : null}

        {focused && suggestions.length > 0 ? (
          <div className="suggest">
            {groups.map((g) => {
              const rows = suggestions.filter((s) => s.group === g.key);
              if (rows.length === 0) return null;
              return (
                <div key={g.key}>
                  <div className="suggest__group">{g.label}</div>
                  {rows.map((s) => {
                    const index = suggestions.indexOf(s);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="suggest__item"
                        data-on={index === cursor}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => commit(s.url)}
                      >
                        {s.group === 'search' ? (
                          <Search size={13} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
                        ) : (
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 5,
                              flex: 'none',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 9,
                              fontWeight: 700,
                              color: '#fff',
                              background: `hsl(${hueFromString(s.url)} 44% 40%)`,
                            }}
                          >
                            {(s.label.slice(0, 1) || 'N').toUpperCase()}
                          </span>
                        )}
                        <span className="nb-grow truncate">{s.label}</span>
                        <small className="truncate" style={{ maxWidth: '38%' }}>
                          {s.sub}
                        </small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <IconButton
        label={tab?.reader ? t('browser.readerOff') : t('browser.readerOn')}
        size="sm"
        on={Boolean(tab?.reader)}
        disabled={!tab || isNimbus}
        onClick={() => tab && toggleReader(tab.id)}
      >
        <BookOpen size={15} />
      </IconButton>
      <IconButton
        label={bookmarked ? t('browser.bookmarked') : t('browser.bookmark')}
        size="sm"
        on={Boolean(bookmarked)}
        disabled={!tab || isNimbus}
        onClick={() => {
          if (!tab) return;
          if (bookmarked) {
            removeBookmark(bookmarked.id);
            toast(t('bookmarks.removed'), 'success');
          } else {
            addBookmark({ title: tab.title || tab.url, url: tab.url, hue: hueFromString(tab.url) });
            toast(t('bookmarks.saved'), 'success');
          }
        }}
      >
        <Star size={15} />
      </IconButton>
      <IconButton label={t('nav.downloads')} size="sm" on={sidebar === 'downloads'} onClick={() => toggleSidebar('downloads')}>
        <Download size={15} />
      </IconButton>
      <IconButton
        label={t('browser.copyUrl')}
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(
            () => toast(t('toast.copied'), 'success'),
            () => toast(t('errors.generic'), 'danger'),
          );
        }}
      >
        <Copy size={15} />
      </IconButton>
      <IconButton label={t('shell.lock')} size="sm" onClick={() => void useSession.getState().lock('manual')}>
        <Lock size={15} />
      </IconButton>
    </div>
  );
};
