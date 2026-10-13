import { useMemo, useState } from 'react';
import { Clock, Eraser, History as HistoryIcon, Search, X } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, IconButton, Row, SectionTitle, Stack } from '../../design/components';
import { Avatar } from '../../design/components';
import { absoluteTime, dayKey, hueFromString, relativeTime } from '../../design/components/theme';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import { useNavigateTo } from '../browser/navigation';

const LIMIT = 400;

export const HistoryPanel = ({ compact }: { compact?: boolean }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const history = useVault((s) => s.vault?.history ?? []);
  const removeHistory = useVault((s) => s.removeHistory);
  const clearHistory = useVault((s) => s.clearHistory);
  const navigateTo = useNavigateTo();
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = history
      .filter((h) => (!q ? true : `${h.title} ${h.url}`.toLowerCase().includes(q)))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, LIMIT);
    const out: { key: string; rows: typeof rows }[] = [];
    for (const row of rows) {
      const key = dayKey(row.visitedAt, locale);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, rows: [row] });
    }
    return out;
  }, [history, query, locale]);

  const total = history.length;

  if (compact) {
    return (
      <div className="side-compact">
        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('history.search')} />
          </div>
          {query ? (
            <IconButton label={t('common.close')} size="sm" onClick={() => setQuery('')}>
              <X size={13} />
            </IconButton>
          ) : null}
        </div>
        {groups.length === 0 ? (
          <div className="tiny" style={{ padding: 16, color: 'var(--text-tertiary)' }}>
            {t('history.empty')}
          </div>
        ) : (
          <ul className="nb-list">
            {groups.flatMap((g) =>
              g.rows.slice(0, 8).map((h) => (
                <li key={h.id}>
                  <button className="nb-list-item" onClick={() => navigateTo(h.url)}>
                    <Avatar label={(h.title || '?').slice(0, 1).toUpperCase()} hue={hueFromString(h.url)} size={26} radius={9} />
                    <span className="nb-grow" style={{ minWidth: 0 }}>
                      <span className="nb-list-item__label truncate">{h.title || h.url}</span>
                      <span className="nb-list-item__sub truncate">{relativeTime(h.visitedAt, locale)}</span>
                    </span>
                    <IconButton
                      label={t('common.delete')}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeHistory(h.id);
                      }}
                    >
                      <X size={12} />
                    </IconButton>
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('history.title')}</h1>
            <p className="panel-head__sub">
              {t('history.subtitle')} · {t('history.visits', { n: total })}
            </p>
          </div>
          <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={total === 0}>
            <Eraser size={14} /> {t('history.clearAll')}
          </Button>
        </div>

        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('history.search')} />
          </div>
          {query ? (
            <IconButton label={t('common.close')} size="sm" onClick={() => setQuery('')}>
              <X size={13} />
            </IconButton>
          ) : null}
          <span className="nb-grow" />
          <span className="tiny">
            <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            {t('vault.encrypted')}
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState icon={<HistoryIcon size={22} />} title={t('history.empty')} sub={t('start.recentHistory')} />
        ) : (
          <Stack gap={5}>
            {groups.map((g) => (
              <section key={g.key}>
                <SectionTitle title={g.key} count={g.rows.length} />
                <ul className="nb-list">
                  {g.rows.map((h) => (
                    <li key={h.id}>
                      <button className="nb-list-item" onClick={() => navigateTo(h.url)}>
                        <Avatar label={(h.title || '?').slice(0, 1).toUpperCase()} hue={hueFromString(h.url)} size={30} radius={10} />
                        <span className="nb-grow" style={{ minWidth: 0 }}>
                          <span className="nb-list-item__label truncate">{h.title || h.url}</span>
                          <span className="nb-list-item__sub truncate">{h.url}</span>
                        </span>
                        <span className="tiny" style={{ flex: 'none', width: 62, textAlign: 'right' }}>
                          {absoluteTime(h.visitedAt, locale).slice(-5)}
                        </span>
                        {h.visits > 1 ? <span className="micro">{h.visits}×</span> : null}
                        <IconButton
                          label={t('common.delete')}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHistory(h.id);
                          }}
                        >
                          <X size={12} />
                        </IconButton>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </Stack>
        )}

        <Row gap={2} style={{ justifyContent: 'center', marginTop: 8 }}>
          <span className="micro">{t('privacy.persistentList')}</span>
        </Row>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t('history.clearAll')}
        body={t('privacy.wipe')}
        danger
        confirmLabel={t('history.clearAll')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clearHistory();
          setConfirmClear(false);
          toast(t('history.cleared'), 'success');
        }}
      />
    </div>
  );
};
