import { Ban, CloudCog, Database, ShieldCheck, X } from 'lucide-react';
import { Button, IconButton, Meter, Row, Stack } from '../../design/components';
import { formatBytes } from '../../design/components/theme';
import { internalUrl, useBrowser } from '../../state/browser';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import { BookmarksPanel } from '../bookmarks/BookmarksPanel';
import { DownloadsPanel } from '../downloads/DownloadsPanel';
import { HistoryPanel } from '../history/HistoryPanel';

const PrivacySummary = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const stats = useBrowser((s) => s.stats);
  const blocked = useBrowser((s) => s.blockedTotal);
  const proxied = useBrowser((s) => s.proxiedRequests);
  const settings = useVault((s) => s.vault?.settings ?? null);
  const navigate = useBrowser((s) => s.navigate);
  const activeId = useBrowser((s) => s.activeId);
  const ratio = stats ? Math.min(1, stats.cache.bytes / (64 * 1024 * 1024)) : 0;

  return (
    <Stack gap={3}>
      <div className="stat-card" style={{ padding: 14 }}>
        <div className="stat-card__value" style={{ color: blocked ? 'var(--sage-400)' : 'var(--mist-300)' }}>
          {stats?.blockedRequests ?? blocked}
        </div>
        <div className="stat-card__label">{t('privacy.blockedRequests')}</div>
      </div>
      <div className="stat-card" style={{ padding: 14 }}>
        <div className="stat-card__value">{proxied}</div>
        <div className="stat-card__label">{t('start.requestsProxied')}</div>
      </div>
      <div className="stat-card" style={{ padding: 14 }}>
        <Row gap={2} between>
          <span className="micro">{t('privacy.cacheBytes')}</span>
          <span className="tiny mono">{formatBytes(stats?.cache.bytes ?? 0, locale)}</span>
        </Row>
        <div style={{ marginTop: 6 }}>
          <Meter value={ratio} tone="slate" height={4} />
        </div>
      </div>
      <Stack gap={2}>
        <Row gap={2}>
          <Ban size={12} style={{ color: settings?.blockTrackers ? 'var(--sage-400)' : 'var(--text-tertiary)' }} />
          <span className="tiny">{t('privacy.blockTrackers')}</span>
        </Row>
        <Row gap={2}>
          <ShieldCheck size={12} style={{ color: 'var(--sage-400)' }} />
          <span className="tiny">{t('privacy.zeroKnowledge')}</span>
        </Row>
        <Row gap={2}>
          <CloudCog size={12} style={{ color: 'var(--ember-400)' }} />
          <span className="tiny">{t('privacy.engineSub')}</span>
        </Row>
        <Row gap={2}>
          <Database size={12} style={{ color: 'var(--text-tertiary)' }} />
          <span className="tiny">{t('privacy.ephemeral')}</span>
        </Row>
      </Stack>
      <Button
        size="sm"
        variant="quiet"
        block
        onClick={() => {
          if (activeId) navigate(activeId, internalUrl('privacy'));
        }}
      >
        {t('nav.privacy')}
      </Button>
    </Stack>
  );
};

export const Sidebar = () => {
  const t = useUi((s) => s.t);
  const sidebar = useUi((s) => s.sidebar);
  const closeSidebar = useUi((s) => s.closeSidebar);

  if (sidebar === 'none') return null;

  const titles: Record<string, string> = {
    bookmarks: t('nav.bookmarks'),
    history: t('nav.history'),
    downloads: t('nav.downloads'),
    privacy: t('nav.privacy'),
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">{titles[sidebar] ?? sidebar}</span>
        <span className="nb-grow" />
        <IconButton label={t('common.close')} size="sm" onClick={closeSidebar}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="sidebar__body">
        {sidebar === 'bookmarks' ? <BookmarksPanel compact /> : null}
        {sidebar === 'history' ? <HistoryPanel compact /> : null}
        {sidebar === 'downloads' ? <DownloadsPanel compact /> : null}
        {sidebar === 'privacy' ? <PrivacySummary /> : null}
      </div>
    </aside>
  );
};
