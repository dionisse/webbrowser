import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Cloud,
  Compass,
  CreditCard,
  Download,
  History,
  KeyRound,
  Lock,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  StickyNote,
  X,
} from 'lucide-react';
import { Avatar, Badge, IconButton, Row, Stack } from '../../design/components';
import { Sheet } from '../../design/components/Overlays';
import { Field, TextInput } from '../../design/components/Fields';
import { formatBytes, greeting, relativeTime, shortHost } from '../../design/components/theme';
import { START_URL, isInternalUrl, resolveOmnibox, useBrowser } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import { PageView } from '../browser/PageView';
import { BookmarksPanel } from '../bookmarks/BookmarksPanel';
import { CardsPanel } from '../cards/CardsPanel';
import { CloudPanel } from '../cloud/CloudPanel';
import { DownloadsPanel } from '../downloads/DownloadsPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { NotesPanel } from '../notes/NotesPanel';
import { PasswordsPanel } from '../passwords/PasswordsPanel';
import { SettingsPanel } from '../settings/SettingsPanel';

type VaultView = 'notes' | 'passwords' | 'cards' | 'bookmarks' | 'history' | 'downloads' | null;

export const MobileShell = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const mobileTab = useUi((s) => s.mobileTab);
  const setMobileTab = useUi((s) => s.setMobileTab);
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const activate = useBrowser((s) => s.activate);
  const closeTab = useBrowser((s) => s.closeTab);
  const openTab = useBrowser((s) => s.openTab);
  const navigate = useBrowser((s) => s.navigate);
  const reload = useBrowser((s) => s.reload);
  const vault = useVault((s) => s.vault);
  const lastSyncedAt = useVault((s) => s.lastSyncedAt);
  const sizeBytes = useVault((s) => s.sizeBytes);
  const blocked = useBrowser((s) => s.blockedTotal);
  const profile = useSession((s) => s.activeProfile);
  const lock = useSession((s) => s.lock);

  const [view, setView] = useState<VaultView>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];
  const hue = profile?.hue ?? 12;

  const submitAddressWith = (raw: string) => {
    const target = resolveOmnibox(raw, vault?.settings.searchEngine ?? 'duckduckgo');
    if (active) navigate(active.id, target);
    else openTab(target);
    setAddressOpen(false);
    setDraft('');
    setMobileTab('browse');
  };
  const submitAddress = () => submitAddressWith(draft);

  const tiles: { id: Exclude<VaultView, null>; label: string; value: string; sub: string; icon: ReactNode }[] = [
    { id: 'notes', label: t('nav.notes'), value: String(vault?.notes.length ?? 0), sub: t('notes.subtitle'), icon: <StickyNote size={15} /> },
    { id: 'passwords', label: t('nav.passwords'), value: String(vault?.passwords.length ?? 0), sub: t('passwords.subtitle'), icon: <KeyRound size={15} /> },
    { id: 'cards', label: t('nav.cards'), value: String(vault?.cards.length ?? 0), sub: t('cards.subtitle'), icon: <CreditCard size={15} /> },
    { id: 'bookmarks', label: t('nav.bookmarks'), value: String(vault?.bookmarks.length ?? 0), sub: t('bookmarks.subtitle'), icon: <Bookmark size={15} /> },
    { id: 'history', label: t('nav.history'), value: String(vault?.history.length ?? 0), sub: t('history.subtitle'), icon: <History size={15} /> },
    { id: 'downloads', label: t('nav.downloads'), value: String(vault?.downloads.filter((d) => d.status === 'available').length ?? 0), sub: t('downloads.subtitle'), icon: <Download size={15} /> },
  ];

  const vaultCount = (vault?.notes.length ?? 0) + (vault?.passwords.length ?? 0) + (vault?.cards.length ?? 0);
  const barItems: { id: 'browse' | 'vault' | 'cloud' | 'settings'; label: string; icon: ReactNode; badge?: number }[] = [
    { id: 'browse', label: t('nav.browse'), icon: <Compass size={19} />, badge: tabs.length > 1 ? tabs.length : undefined },
    { id: 'vault', label: t('nav.vault'), icon: <Lock size={19} />, badge: vaultCount || undefined },
    { id: 'cloud', label: t('nav.cloud'), icon: <Cloud size={19} /> },
    { id: 'settings', label: t('nav.settings'), icon: <Settings size={19} /> },
  ];

  const viewTitle: Record<string, string> = {
    notes: t('nav.notes'),
    passwords: t('nav.passwords'),
    cards: t('nav.cards'),
    bookmarks: t('nav.bookmarks'),
    history: t('nav.history'),
    downloads: t('nav.downloads'),
  };

  return (
    <div className="m-shell">
      {/* --- Top bar ------------------------------------------------------ */}
      <div className="m-topbar">
        {view ? (
          <IconButton label={t('common.back')} size="sm" onClick={() => setView(null)}>
            <ArrowLeft size={17} />
          </IconButton>
        ) : (
          <IconButton label={profile?.label ?? t('lock.profile')} size="sm" onClick={() => setProfileOpen(true)}>
            <Avatar label={(profile?.label ?? 'N').slice(0, 1).toUpperCase()} hue={hue} size={24} radius={8} />
          </IconButton>
        )}

        <button
          type="button"
          className="m-omnibox"
          onClick={() => {
            setDraft(active && !isInternalUrl(active.url) ? active.url : '');
            setAddressOpen(true);
          }}
        >
          {view ? (
            <span className="truncate nb-grow">{viewTitle[view]}</span>
          ) : mobileTab === 'browse' ? (
            <>
              {isInternalUrl(active?.url ?? '') ? <ShieldCheck size={13} style={{ color: 'var(--ember-400)', flex: 'none' }} /> : <Search size={13} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />}
              <span className="truncate nb-grow" style={{ color: 'var(--mist-400)' }}>
                {active ? (isInternalUrl(active.url) ? active.url.replace('nimbus://', '') : shortHost(active.url)) : t('browser.addressPlaceholder')}
              </span>
            </>
          ) : (
            <span className="truncate nb-grow">{t(`nav.${mobileTab}`)}</span>
          )}
        </button>

        {mobileTab === 'browse' && !view ? (
          <>
            <IconButton label={t('browser.newTab')} size="sm" onClick={() => openTab(START_URL)}>
              <Plus size={17} />
            </IconButton>
            <IconButton label={t('browser.reload')} size="sm" onClick={() => active && reload(active.id)}>
              <RotateCw size={16} />
            </IconButton>
          </>
        ) : (
          <IconButton label={t('shell.lock')} size="sm" onClick={() => void lock('manual')}>
            <Lock size={16} />
          </IconButton>
        )}
      </div>

      {/* --- Content ------------------------------------------------------ */}
      {mobileTab === 'browse' && !view ? (
        <>
          {tabs.length > 1 ? (
            <div className="m-tabs">
              {tabs.map((tab) => (
                <button key={tab.id} type="button" className="m-tab" data-on={tab.id === activeId} onClick={() => activate(tab.id)}>
                  <span className="truncate">{tab.title || shortHost(tab.url)}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    style={{ display: 'grid', placeItems: 'center', flex: 'none', color: 'var(--text-tertiary)' }}
                  >
                    <X size={12} />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="m-content">{active ? <PageView tab={active} /> : null}</div>
        </>
      ) : null}

      {mobileTab === 'vault' && !view ? (
        <div className="m-content">
          <div className="m-panel">
            <Stack gap={4}>
              <div className="m-hero" style={{ ['--hero-glow' as string]: `hsl(${hue} 62% 40% / .3)` }}>
                <Row gap={2} style={{ marginBottom: 10, position: 'relative', zIndex: 1 }}>
                  <span className="nb-dot nb-dot--live" />
                  <span className="micro">{t('vault.unlocked')}</span>
                  <span className="nb-grow" />
                  <Badge tone="sage">zero-knowledge</Badge>
                </Row>
                <div className="m-hero__title">{greeting(locale)}</div>
                <div className="m-hero__sub">
                  {t('start.vaultAt', { provider: profile?.providerName ?? 'Nimbus Cloud' })}
                  {lastSyncedAt ? ` · ${relativeTime(lastSyncedAt, locale)}` : ''}
                </div>
              </div>

              <div className="m-grid">
                {tiles.map((tile) => (
                  <button key={tile.id} type="button" className="m-tile" onClick={() => setView(tile.id)}>
                    <Row gap={2}>
                      <span style={{ color: 'var(--ember-400)' }}>{tile.icon}</span>
                      <span className="m-tile__title">{tile.label}</span>
                    </Row>
                    <span className="m-tile__value">{tile.value}</span>
                    <span className="m-tile__sub truncate">{tile.sub}</span>
                  </button>
                ))}
              </div>

              <Row gap={2} wrap>
                <Badge>
                  <ShieldCheck size={11} /> {blocked > 0 ? t('browser.trackersBlocked', { n: blocked }) : t('browser.trackersNone')}
                </Badge>
                <Badge>{formatBytes(sizeBytes, locale)}</Badge>
                <Badge tone="sage">{t('browser.localNone')}</Badge>
              </Row>
            </Stack>
          </div>
        </div>
      ) : null}

      {view ? (
        <div className="m-content">
          {view === 'notes' ? <NotesPanel /> : null}
          {view === 'passwords' ? <PasswordsPanel /> : null}
          {view === 'cards' ? <CardsPanel /> : null}
          {view === 'bookmarks' ? <BookmarksPanel /> : null}
          {view === 'history' ? <HistoryPanel /> : null}
          {view === 'downloads' ? <DownloadsPanel /> : null}
        </div>
      ) : null}

      {mobileTab === 'cloud' && !view ? (
        <div className="m-content">
          <CloudPanel />
        </div>
      ) : null}

      {mobileTab === 'settings' && !view ? (
        <div className="m-content">
          <SettingsPanel />
        </div>
      ) : null}

      {/* --- Tab bar ------------------------------------------------------ */}
      <div className="m-tabbar">
        {barItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="m-tabbar__btn"
            data-on={mobileTab === item.id}
            onClick={() => {
              setView(null);
              setMobileTab(item.id);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge ? <span className="m-tabbar__badge">{item.badge > 99 ? '99+' : item.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* --- Address sheet ------------------------------------------------ */}
      <Sheet open={addressOpen} onClose={() => setAddressOpen(false)} title={t('browser.addressPlaceholder')}>
        <Stack gap={3}>
          <Field label={t('browser.addressPlaceholder')}>
            <TextInput
              autoFocus
              value={draft}
              placeholder="nimbus://start · github.com"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAddress();
              }}
            />
          </Field>
          <div className="chip-row">
            {['nimbus://start', 'nimbus://news', 'nimbus://index', 'nimbus://shop', 'nimbus://docs'].map((id) => (
              <button
                key={id}
                type="button"
                className="nb-chip"
                onClick={() => {
                  setDraft(id);
                  submitAddressWith(id);
                }}
              >
                {id.replace('nimbus://', '')}
              </button>
            ))}
          </div>
          {(vault?.history ?? []).slice(0, 6).map((h) => (
            <button
              key={h.id}
              type="button"
              className="m-list-item"
              onClick={() => {
                setDraft(h.url);
                submitAddressWith(h.url);
              }}
            >
              <History size={14} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
              <span className="nb-grow" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: 'block', color: 'var(--mist-200)', fontSize: 'var(--fs-small)' }}>
                  {h.title || shortHost(h.url)}
                </span>
                <span className="micro">{shortHost(h.url)}</span>
              </span>
            </button>
          ))}
        </Stack>
      </Sheet>

      {/* --- Profile sheet ------------------------------------------------ */}
      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title={profile?.label ?? t('lock.profile')}>
        <Stack gap={3}>
          <Row gap={3}>
            <Avatar label={(profile?.label ?? 'N').slice(0, 1).toUpperCase()} hue={hue} size={44} radius={15} />
            <Stack gap={1}>
              <span style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{profile?.label}</span>
              <span className="tiny">
                {t('start.vaultAt', { provider: profile?.providerName ?? 'Nimbus Cloud' })}
              </span>
              <span className="micro">
                {t('cloud.revision')} {profile?.revision ?? 0} · {formatBytes(sizeBytes, locale)}
              </span>
            </Stack>
          </Row>
          <button type="button" className="m-list-item" onClick={() => { setProfileOpen(false); setMobileTab('cloud'); }}>
            <Cloud size={15} style={{ color: 'var(--ember-400)' }} />
            <span className="nb-grow">{t('nav.cloud')}</span>
          </button>
          <button type="button" className="m-list-item" onClick={() => { setProfileOpen(false); setMobileTab('settings'); }}>
            <Settings size={15} style={{ color: 'var(--mist-400)' }} />
            <span className="nb-grow">{t('nav.settings')}</span>
          </button>
          <button
            type="button"
            className="m-list-item"
            onClick={() => {
              setProfileOpen(false);
              void lock('manual');
            }}
          >
            <Lock size={15} style={{ color: 'var(--ember-400)' }} />
            <span className="nb-grow">{t('shell.lock')}</span>
          </button>
        </Stack>
      </Sheet>
    </div>
  );
}
