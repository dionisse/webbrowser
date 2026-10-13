import { useMemo } from 'react';
import { BookMarked, Cloud, CreditCard, Download, FileText, Globe, History, KeyRound, Newspaper, ShieldCheck, ShoppingBag, Mail, BookText, Server } from 'lucide-react';
import { INTERNAL_SCHEME } from '../../lib/api';
import { Card, Row, Stack } from '../../design/components';
import { formatBytes, hueFromString, relativeTime } from '../../design/components/theme';
import { useUi } from '../../state/ui';
import { useSession } from '../../state/session';
import { useVault } from '../../state/vault';
import { useBrowser } from '../../state/browser';
import { useNavigateTo } from './navigation';

const DEMO_SITES = [
  { id: 'news', title: 'Le Fil', blurb: 'Presse · article long', hue: 12, icon: Newspaper },
  { id: 'shop', title: 'Maison Objet', blurb: 'Catalogue · formulaire POST', hue: 96, icon: ShoppingBag },
  { id: 'mail', title: 'Courriel', blurb: 'Boîte · remplissage auto', hue: 28, icon: Mail },
  { id: 'docs', title: 'Nimbus Docs', blurb: 'Référence du moteur', hue: 210, icon: BookText },
];

const QUICK = [
  { id: 'notes', icon: FileText, hue: 22 },
  { id: 'passwords', icon: KeyRound, hue: 96 },
  { id: 'cards', icon: CreditCard, hue: 214 },
  { id: 'cloud', icon: Cloud, hue: 190 },
  { id: 'bookmarks', icon: BookMarked, hue: 34 },
  { id: 'history', icon: History, hue: 262 },
  { id: 'downloads', icon: Download, hue: 152 },
  { id: 'privacy', icon: ShieldCheck, hue: 12 },
] as const;

export const StartPage = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const profile = useSession((s) => s.activeProfile);
  const vault = useVault((s) => s.vault);
  const revision = useVault((s) => s.revision);
  const sizeBytes = useVault((s) => s.sizeBytes);
  const stats = useBrowser((s) => s.stats);
  const proxied = useBrowser((s) => s.proxiedRequests);
  const blocked = useBrowser((s) => s.blockedTotal);
  const navigate = useNavigateTo();

  const hue = profile?.hue ?? 18;
  const hour = new Date().getHours();

  const history = useMemo(() => (vault?.history ?? []).slice(0, 6), [vault?.history]);
  const pinned = useMemo(() => (vault?.bookmarks ?? []).slice(0, 8), [vault?.bookmarks]);

  const openInternal = (id: string) => navigate(`${INTERNAL_SCHEME}${id}`);
  const openDemoSite = (id: string) => navigate(`nimbus://${id}`);

  const providerName = vault ? (useSession.getState().providers.find((p) => p.id === profile?.providerId)?.name ?? 'Nimbus Cloud') : 'Nimbus Cloud';

  return (
    <div className="page-scroll">
      <div className="panel-page">
        <div className="panel-inner">
          {/* Hero */}
          <section className="start-hero" style={{ ['--hero-glow' as string]: `hsl(${hue} 62% 40% / .26)` }}>
            <Row gap={2} style={{ marginBottom: 14 }}>
              <span className="nb-dot nb-dot--live" />
              <span className="micro">{t('browser.cloudEngine')}</span>
              <span className="nb-grow" />
              <span className="nb-badge nb-badge--sage">
                <ShieldCheck size={11} /> zero-knowledge
              </span>
            </Row>
            <h1 className="start-hero__title">
              {hour >= 18 ? t('start.greetingEvening') : t('start.greeting')}
              {profile?.label ? `, ${profile.label}` : ''}.
            </h1>
            <p className="start-hero__sub">{t('start.subtitle')}</p>

            <div className="grid-stats" style={{ marginTop: 26, position: 'relative', zIndex: 1 }}>
              <div className="stat-card" style={{ background: 'rgba(14,14,15,.55)', borderColor: 'var(--ink-700)' }}>
                <div className="stat-card__value">{blocked}</div>
                <div className="stat-card__label">{t('start.trackersCut')}</div>
              </div>
              <div className="stat-card" style={{ background: 'rgba(14,14,15,.55)', borderColor: 'var(--ink-700)' }}>
                <div className="stat-card__value">{proxied}</div>
                <div className="stat-card__label">{t('start.requestsProxied')}</div>
              </div>
              <div className="stat-card" style={{ background: 'rgba(14,14,15,.55)', borderColor: 'var(--ink-700)' }}>
                <div className="stat-card__value" style={{ color: 'var(--sage-400)' }}>
                  0
                </div>
                <div className="stat-card__label">{t('start.bytesWrittenLocal')}</div>
              </div>
              <div className="stat-card" style={{ background: 'rgba(14,14,15,.55)', borderColor: 'var(--ink-700)' }}>
                <div className="stat-card__value">{formatBytes(sizeBytes, locale)}</div>
                <div className="stat-card__label">
                  {t('start.vaultAt', { provider: providerName })} · r{revision}
                </div>
              </div>
            </div>
          </section>

          {/* Quick access */}
          <section>
            <div className="nb-section-title">
              <h2>{t('start.quickAccess')}</h2>
              <span className="count">{vault ? t('vault.entries', { n: vault.notes.length + vault.passwords.length + vault.cards.length + vault.bookmarks.length }) : ''}</span>
            </div>
            <div className="start-quick">
              {QUICK.map((item) => {
                const Icon = item.icon;
                const count =
                  item.id === 'notes'
                    ? vault?.notes.length
                    : item.id === 'passwords'
                      ? vault?.passwords.length
                      : item.id === 'cards'
                        ? vault?.cards.length
                        : item.id === 'bookmarks'
                          ? vault?.bookmarks.length
                          : item.id === 'history'
                            ? vault?.history.length
                            : item.id === 'downloads'
                              ? vault?.downloads.length
                              : undefined;
                return (
                  <button key={item.id} type="button" className="start-quick__item" onClick={() => openInternal(item.id)}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        flex: 'none',
                        color: `hsl(${item.hue} 62% 70%)`,
                        background: `hsl(${item.hue} 48% 22% / .55)`,
                        border: `1px solid hsl(${item.hue} 42% 32% / .5)`,
                      }}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="nb-grow" style={{ minWidth: 0 }}>
                      <span className="start-quick__label truncate" style={{ display: 'block' }}>
                        {t(`nav.${item.id}`)}
                      </span>
                      {count !== undefined ? <span className="start-quick__sub">{count}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
            {/* Demo sites */}
            <section>
              <div className="nb-section-title">
                <h2>{t('start.demoSites')}</h2>
              </div>
              <p className="tiny" style={{ marginBottom: 12, lineHeight: 1.55 }}>
                {t('start.demoSitesSub')}
              </p>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {DEMO_SITES.map((site) => {
                  const Icon = site.icon;
                  return (
                    <button key={site.id} type="button" className="site-tile" onClick={() => openDemoSite(site.id)}>
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 9,
                          display: 'grid',
                          placeItems: 'center',
                          color: `hsl(${site.hue} 60% 72%)`,
                          background: `hsl(${site.hue} 46% 20% / .6)`,
                          border: `1px solid hsl(${site.hue} 40% 30% / .55)`,
                        }}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="site-tile__title">{site.title}</span>
                      <span className="site-tile__blurb">{site.blurb}</span>
                    </button>
                  );
                })}
              </div>
              <Card style={{ marginTop: 10, padding: 13 }}>
                <Row gap={3}>
                  <span style={{ color: 'var(--sage-400)' }}>
                    <Globe size={15} />
                  </span>
                  <div className="nb-grow">
                    <div style={{ fontSize: 'var(--fs-small)', color: 'var(--mist-300)', fontWeight: 500 }}>github.com · pypi.org</div>
                    <div className="tiny">{t('browser.cloudEngine')}</div>
                  </div>
                  <button type="button" className="nb-chip" onClick={() => navigate('https://github.com/')}>
                    {t('common.open')}
                  </button>
                </Row>
              </Card>
            </section>

            {/* Recent */}
            <section>
              <div className="nb-section-title">
                <h2>{t('start.recentHistory')}</h2>
                <span className="nb-grow" />
                <button type="button" className="nb-chip" onClick={() => openInternal('history')}>
                  {t('nav.history')}
                </button>
              </div>
              <Stack gap={1}>
                {history.length === 0 ? (
                  <Card style={{ padding: 18 }}>
                    <Row gap={3}>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        <History size={16} />
                      </span>
                      <span className="tiny">{t('history.empty')}</span>
                    </Row>
                  </Card>
                ) : (
                  history.map((h) => {
                    const site = hueFromString(h.url);
                    return (
                      <button key={h.id} type="button" className="nb-list-item" onClick={() => navigate(h.url)}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 9,
                            flex: 'none',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#fff',
                            background: `linear-gradient(150deg, hsl(${site} 44% 34%), hsl(${site} 50% 20%))`,
                          }}
                        >
                          {h.title.slice(0, 1).toUpperCase() || '·'}
                        </span>
                        <span className="nb-grow" style={{ minWidth: 0 }}>
                          <span className="nb-list-item__label truncate" style={{ display: 'block' }}>
                            {h.title}
                          </span>
                          <span className="nb-list-item__sub truncate mono" style={{ display: 'block' }}>
                            {h.url}
                          </span>
                        </span>
                        <span className="tiny" style={{ flex: 'none' }}>
                          {relativeTime(h.visitedAt, locale)}
                        </span>
                      </button>
                    );
                  })
                )}
              </Stack>

              {pinned.length > 0 ? (
                <>
                  <div className="nb-section-title" style={{ marginTop: 20 }}>
                    <h2 style={{ fontSize: 'var(--fs-md)' }}>{t('start.pinned')}</h2>
                  </div>
                  <Row gap={2} wrap>
                    {pinned.map((b) => (
                      <button key={b.id} type="button" className="nb-chip" onClick={() => navigate(b.url)} title={b.url}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: `hsl(${b.hue} 58% 56%)`, flex: 'none' }} />
                        <span className="truncate" style={{ maxWidth: 150 }}>
                          {b.title}
                        </span>
                      </button>
                    ))}
                  </Row>
                </>
              ) : null}

              {stats ? (
                <Card style={{ marginTop: 20, padding: 14 }}>
                  <Row gap={3} between>
                    <span className="micro">{t('privacy.stats')}</span>
                    <span className="tiny mono">
                      {stats.cache.entries} · {formatBytes(stats.cache.bytes, locale)}
                    </span>
                  </Row>
                  <Row gap={3} style={{ marginTop: 10 }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      <Server size={14} />
                    </span>
                    <span className="tiny">
                      TTL {stats.ttlSeconds}s · {t('privacy.ephemeral')}
                    </span>
                  </Row>
                </Card>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
