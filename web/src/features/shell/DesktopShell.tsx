import { useState, type ReactNode } from 'react';
import {
  Bookmark,
  Cloud,
  Compass,
  CreditCard,
  Download,
  History,
  KeyRound,
  Languages,
  Lock,
  Rows2,
  Settings,
  ShieldCheck,
  StickyNote,
  X,
} from 'lucide-react';
import { Avatar, IconButton } from '../../design/components';
import { Menu, type MenuItem } from '../../design/components/Overlays';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault, vaultSelectors } from '../../state/vault';
import { START_URL, internalUrl, useBrowser } from '../../state/browser';
import { StatusBar } from '../browser/StatusBar';
import { TabStrip } from '../browser/TabStrip';
import { Toolbar } from '../browser/Toolbar';
import { PageView } from '../browser/PageView';
import { Sidebar } from './Sidebar';

type RailItem = { id: string; label: string; icon: ReactNode; to?: string; panel?: 'bookmarks' | 'history' | 'downloads' | 'privacy'; badge?: number };

export const DesktopShell = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const sidebar = useUi((s) => s.sidebar);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const splitId = useBrowser((s) => s.splitId);
  const activate = useBrowser((s) => s.activate);
  const navigate = useBrowser((s) => s.navigate);
  const openTab = useBrowser((s) => s.openTab);
  const toggleSplit = useBrowser((s) => s.toggleSplit);
  const setSplit = useBrowser((s) => s.setSplit);
  const vault = useVault((s) => s.vault);
  const profile = useSession((s) => s.activeProfile);
  const lock = useSession((s) => s.lock);

  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null);

  const active = tabs.find((x) => x.id === activeId);
  const split = tabs.find((x) => x.id === splitId);
  const weak = vaultSelectors.weakPasswords(vault);

  const go = (to: string) => {
    if (activeId) navigate(activeId, to);
    else openTab(to);
  };

  const items: RailItem[][] = [
    [
      { id: 'start', label: t('nav.start'), icon: <Compass size={18} />, to: START_URL },
      { id: 'bookmarks', label: t('nav.bookmarks'), icon: <Bookmark size={17} />, panel: 'bookmarks', badge: vault?.bookmarks.length },
      { id: 'history', label: t('nav.history'), icon: <History size={17} />, panel: 'history' },
      { id: 'downloads', label: t('nav.downloads'), icon: <Download size={17} />, panel: 'downloads', badge: vault?.downloads.filter((d) => d.status === 'available').length },
    ],
    [
      { id: 'notes', label: t('nav.notes'), icon: <StickyNote size={17} />, to: internalUrl('notes'), badge: vault?.notes.length },
      { id: 'passwords', label: t('nav.passwords'), icon: <KeyRound size={17} />, to: internalUrl('passwords'), badge: weak || vault?.passwords.length },
      { id: 'cards', label: t('nav.cards'), icon: <CreditCard size={17} />, to: internalUrl('cards'), badge: vault?.cards.length },
      { id: 'cloud', label: t('nav.cloud'), icon: <Cloud size={17} />, to: internalUrl('cloud') },
    ],
    [
      { id: 'privacy', label: t('nav.privacy'), icon: <ShieldCheck size={17} />, panel: 'privacy' },
      { id: 'settings', label: t('nav.settings'), icon: <Settings size={17} />, to: internalUrl('settings') },
    ],
  ];

  const profileItems: MenuItem[] = [
    {
      id: 'lang',
      label: `${t('settings.language')} · ${locale.toUpperCase()}`,
      icon: <Languages size={13} />,
      onSelect: () => {
        const next = locale === 'fr' ? 'en' : 'fr';
        setLocale(next);
        useVault.getState().updateSettings({ locale: next });
      },
    },
    {
      id: 'density',
      label: `${t('settings.density')} · ${density === 'cozy' ? t('settings.densityCozy') : t('settings.densityCompact')}`,
      icon: <Rows2 size={13} />,
      onSelect: () => {
        const next = density === 'cozy' ? 'compact' : 'cozy';
        setDensity(next);
        useVault.getState().updateSettings({ density: next });
      },
    },
    { id: 'split', label: t('shell.splitView'), icon: <Rows2 size={13} />, separatorBefore: true, onSelect: () => toggleSplit() },
    { id: 'settings', label: t('nav.settings'), icon: <Settings size={13} />, onSelect: () => go(internalUrl('settings')) },
    { id: 'switch', label: t('shell.switchProfile'), icon: <Compass size={13} />, separatorBefore: true, onSelect: () => void lock('manual') },
    { id: 'lock', label: t('shell.lock'), icon: <Lock size={13} />, danger: true, onSelect: () => void lock('manual') },
  ];

  return (
    <div className="shell" data-density={density}>
      <nav className="rail" aria-label={t('shell.menu')}>
        <button type="button" className="rail__mark" onClick={() => go(START_URL)} title={t('nav.start')} aria-label={t('app.name')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2.6c3.4 2.3 5.4 5.4 5.4 8.6 0 3.6-2.4 6.2-5.4 6.2S6.6 14.8 6.6 11.2c0-3.2 2-6.3 5.4-8.6Z" fill="currentColor" opacity=".92" />
            <path d="M4.4 18.6c2.1 1.7 4.7 2.6 7.6 2.6s5.5-.9 7.6-2.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".6" />
          </svg>
        </button>

        {items.map((group, gi) => (
          <div key={gi} style={{ display: 'contents' }}>
            {gi > 0 ? <span className="rail-sep" /> : null}
            {group.map((item) => {
              const on = item.to ? active?.url === item.to : sidebar === item.panel;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="rail-btn"
                  data-on={on}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={on ? 'page' : undefined}
                  onClick={(e) => {
                    if (item.panel) {
                      toggleSidebar(item.panel);
                      return;
                    }
                    if (!item.to) return;
                    if (e.altKey || e.ctrlKey || e.metaKey) openTab(item.to);
                    else go(item.to);
                  }}
                >
                  {item.icon}
                  {item.badge ? <span className="rail-btn__badge">{item.badge > 99 ? '99+' : item.badge}</span> : null}
                </button>
              );
            })}
          </div>
        ))}

        <span className="rail-spacer" />

        <button
          type="button"
          className="rail-btn"
          data-on={Boolean(profileMenu)}
          title={profile?.label ?? t('lock.profile')}
          aria-label={t('shell.switchProfile')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setProfileMenu(profileMenu ? null : { x: r.right + 10, y: Math.max(12, r.top - 190) });
          }}
        >
          <Avatar label={(profile?.label ?? 'N').slice(0, 1).toUpperCase()} hue={profile?.hue ?? 12} size={26} radius={9} />
        </button>
        <button type="button" className="rail-btn" title={t('shell.lock')} aria-label={t('shell.lock')} onClick={() => void lock('manual')}>
          <Lock size={17} />
        </button>
      </nav>

      <div className="main">
        <TabStrip />
        <Toolbar />

        <div className="content">
          <div className="content__pane">{active ? <PageView tab={active} /> : null}</div>

          {split ? (
            <div className="content__pane">
              <div className="pane-head">
                <IconButton label={t('shell.splitOff')} size="sm" onClick={() => (splitId ? setSplit(null) : toggleSplit())}>
                  <X size={13} />
                </IconButton>
                <span className="pane-head__title truncate">{split.title || split.url}</span>
                <span className="nb-grow" />
                <IconButton label={t('browser.tabs', { n: tabs.length })} size="sm" onClick={() => activate(split.id)}>
                  <Compass size={13} />
                </IconButton>
              </div>
              <PageView tab={split} />
            </div>
          ) : null}

          <Sidebar />
        </div>

        <StatusBar />
      </div>

      {profileMenu ? <Menu items={profileItems} onClose={() => setProfileMenu(null)} style={{ position: 'fixed', left: profileMenu.x, top: profileMenu.y, width: 236 }} /> : null}
    </div>
  );
};
