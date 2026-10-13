import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, DownloadCloud, FileArchive, FileImage, FileText, FileVideo, RefreshCw, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Row, SectionTitle, Stack } from '../../design/components';
import { absoluteTime, formatBytes, relativeTime } from '../../design/components/theme';
import { api, engineCollectUrl, type StagedDownload } from '../../lib/api';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';

const iconFor = (mime: string) => {
  if (mime.startsWith('image/')) return <FileImage size={15} />;
  if (mime.startsWith('video/')) return <FileVideo size={15} />;
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return <FileArchive size={15} />;
  return <FileText size={15} />;
};

export const DownloadsPanel = ({ compact }: { compact?: boolean }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const records = useVault((s) => s.vault?.downloads ?? []);
  const markDownload = useVault((s) => s.markDownload);
  const clearDownloads = useVault((s) => s.clearDownloads);

  const [staged, setStaged] = useState<StagedDownload[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.downloads();
      setStaged(res.downloads);
    } catch {
      /* engine stats are cosmetic */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const collect = async (item: StagedDownload) => {
    const a = document.createElement('a');
    a.href = engineCollectUrl(item.id);
    a.download = item.filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    markDownload(item.id, 'collected');
    toast(t('downloads.collectedToast', { name: item.filename }), 'success');
    void refresh();
  };

  const clearQueue = async () => {
    try {
      await api.clearDownloads();
      setStaged([]);
      toast(t('downloads.cleared'), 'success');
    } catch {
      toast(t('errors.generic'), 'danger');
    } finally {
      setConfirmClear(false);
    }
  };

  const body = (
    <>
      {staged.length === 0 ? (
        <div className="tiny" style={{ padding: 18, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          {t('downloads.empty')}
        </div>
      ) : (
        <ul className="nb-list">
          {staged.map((d) => (
            <li key={d.id}>
              <div className="nb-list-item" style={{ cursor: 'default' }}>
                <span style={{ color: 'var(--mist-400)', flex: 'none' }}>{iconFor(d.mimeType)}</span>
                <span className="nb-grow" style={{ minWidth: 0 }}>
                  <span className="nb-list-item__label truncate">{d.filename}</span>
                  <span className="nb-list-item__sub truncate">
                    {formatBytes(d.size, locale)} · {relativeTime(d.createdAt, locale)}
                  </span>
                </span>
                <Button size="sm" variant="primary" onClick={() => void collect(d)}>
                  <Download size={12} /> {t('downloads.get')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="side-compact">
        <div className="panel-toolbar">
          <span className="micro nb-grow">{t('downloads.staged')} · {staged.length}</span>
          <IconButton label={t('browser.reload')} size="sm" onClick={() => void refresh()}>
            <RefreshCw size={13} />
          </IconButton>
          {staged.length ? (
            <IconButton label={t('downloads.clear')} size="sm" onClick={() => setConfirmClear(true)}>
              <Trash2 size={13} />
            </IconButton>
          ) : null}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('downloads.title')}</h1>
            <p className="panel-head__sub">{t('downloads.subtitle')}</p>
          </div>
          <Row gap={2}>
            <Button variant="quiet" loading={loading} onClick={() => void refresh()}>
              <RefreshCw size={14} />
            </Button>
            <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={staged.length === 0}>
              <Trash2 size={14} /> {t('downloads.clear')}
            </Button>
          </Row>
        </div>

        <Card>
          <Row gap={3} style={{ alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--sage-400)', marginTop: 2 }}>
              <DownloadCloud size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--mist-200)' }}>{t('browser.localNone')}</div>
              <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                {t('downloads.emptySub')}
              </div>
            </div>
            <span className="nb-grow" />
            <Badge tone="sage">{t('downloads.staged')} · {staged.length}</Badge>
          </Row>
        </Card>

        <section>
          <SectionTitle title={t('downloads.staged')} count={staged.length} />
          {staged.length === 0 ? (
            <EmptyState icon={<Download size={22} />} title={t('downloads.empty')} sub={t('downloads.emptySub')} />
          ) : (
            <div className="grid-cards">
              {staged.map((d) => (
                <Card key={d.id} style={{ padding: 15 }}>
                  <Row gap={3} style={{ alignItems: 'flex-start' }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 11,
                        display: 'grid',
                        placeItems: 'center',
                        background: 'var(--surface-3)',
                        color: 'var(--mist-300)',
                        flex: 'none',
                      }}
                    >
                      {iconFor(d.mimeType)}
                    </span>
                    <div className="nb-grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--mist-100)' }} className="truncate">
                        {d.filename}
                      </div>
                      <div className="tiny truncate" style={{ marginTop: 2 }}>
                        {formatBytes(d.size, locale)} · {d.mimeType || 'application/octet-stream'}
                      </div>
                      <div className="micro" style={{ marginTop: 4 }}>
                        {absoluteTime(d.createdAt, locale)}
                      </div>
                    </div>
                  </Row>
                  <Row gap={2} style={{ marginTop: 12 }}>
                    <Button size="sm" variant="primary" className="nb-grow" onClick={() => void collect(d)}>
                      <Download size={13} /> {t('downloads.get')}
                    </Button>
                    <IconButton label={t('common.close')} size="sm" onClick={() => setStaged(staged.filter((x) => x.id !== d.id))}>
                      <X size={13} />
                    </IconButton>
                  </Row>
                </Card>
              ))}
            </div>
          )}
        </section>

        {records.length > 0 ? (
          <section>
            <SectionTitle
              title={t('nav.downloads')}
              count={records.length}
              action={
                <Button size="sm" variant="ghost" onClick={clearDownloads}>
                  <Trash2 size={13} />
                </Button>
              }
            />
            <Card flush>
              <table className="nb-table">
                <thead>
                  <tr>
                    <th>{t('downloads.filename')}</th>
                    <th style={{ textAlign: 'right' }}>{t('downloads.size')}</th>
                    <th>{t('downloads.status')}</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {records
                    .slice()
                    .sort((a, b) => b.at - a.at)
                    .slice(0, 40)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Row gap={2}>
                            <span style={{ color: 'var(--text-tertiary)' }}>{iconFor(r.mimeType)}</span>
                            <span className="truncate">{r.filename}</span>
                          </Row>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {formatBytes(r.size, locale)}
                        </td>
                        <td className="tiny">
                          {r.status === 'collected' ? (
                            <Badge tone="sage">
                              <CheckCircle2 size={10} /> {t('downloads.collected')}
                            </Badge>
                          ) : r.status === 'expired' ? (
                            <Badge tone="warn">{t('downloads.expired')}</Badge>
                          ) : (
                            <Badge>{t('downloads.staged')}</Badge>
                          )}{' '}
                          {relativeTime(r.at, locale)}
                        </td>
                        <td>
                          <IconButton label={t('common.delete')} size="sm" onClick={() => markDownload(r.id, 'expired')}>
                            <Trash2 size={12} />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          </section>
        ) : null}

        <Stack gap={2}>
          <span className="micro">{t('privacy.ephemeralList')}</span>
        </Stack>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t('downloads.clear')}
        body={t('privacy.wipe')}
        danger
        confirmLabel={t('downloads.clear')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void clearQueue()}
      />
    </div>
  );
};

