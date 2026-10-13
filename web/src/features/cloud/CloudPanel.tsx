import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Cloud,
  CloudOff,
  Download,
  FileText,
  FlaskConical,
  FolderOpen,
  HardDrive,
  History as HistoryIcon,
  Info,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Dot, IconButton, Meter, Row, SectionTitle, Stack } from '../../design/components';
import { Modal } from '../../design/components/Overlays';
import { Field, TextInput } from '../../design/components/Fields';
import { absoluteTime, formatBytes, relativeTime } from '../../design/components/theme';
import { driveStreamUrl } from '../../lib/api';
import { useCloud } from '../../state/cloud';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import type { ProviderDescriptor } from '../../lib/types';

const GLYPH: Record<string, string> = { local: 'N', google: 'G', proton: 'P', yandex: 'Y', onedrive: 'M', webdav: 'W' };

export const CloudPanel = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const profile = useSession((s) => s.activeProfile);
  const providers = useCloud((s) => s.providers);
  const connections = useCloud((s) => s.connections);
  const status = useCloud((s) => s.status);
  const snapshots = useCloud((s) => s.snapshots);
  const busy = useCloud((s) => s.busy);
  const busyAction = useCloud((s) => s.busyAction);
  const load = useCloud((s) => s.load);
  const loadStatus = useCloud((s) => s.loadStatus);
  const connectSimulated = useCloud((s) => s.connectSimulated);
  const connectWithCredentials = useCloud((s) => s.connectWithCredentials);
  const disconnect = useCloud((s) => s.disconnect);
  const moveTo = useCloud((s) => s.moveTo);
  const restore = useCloud((s) => s.restore);
  const connectOAuth = useCloud((s) => s.connectOAuth);
  const sizeBytes = useVault((s) => s.sizeBytes);
  const revision = useVault((s) => s.revision);
  const lastSyncedAt = useVault((s) => s.lastSyncedAt);
  const dirty = useVault((s) => s.dirty);
  const syncing = useVault((s) => s.syncing);
  const syncNow = useVault((s) => s.syncNow);
  const syncError = useVault((s) => s.syncError);

  const [formProvider, setFormProvider] = useState<ProviderDescriptor | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [confirmMove, setConfirmMove] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ path: string; rev: number } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === (status?.providerId ?? profile?.providerId ?? 'local')),
    [providers, status?.providerId, profile?.providerId],
  );
  const activeConnection = useMemo(
    () => connections.find((c) => c.id === (status?.connectionId ?? profile?.connectionId)),
    [connections, status?.connectionId, profile?.connectionId],
  );

  const quota = status?.quota ?? { used: 0, total: activeProvider?.freeTierBytes ?? null };
  const quotaRatio = quota.total ? Math.min(1, quota.used / quota.total) : 0;

  const submitCreds = async () => {
    if (!formProvider) return;
    const res = await connectWithCredentials(formProvider.id, creds, formProvider.name);
    if (res.ok) {
      setFormProvider(null);
      setCreds({});
      void loadStatus();
    } else {
      toast(t('cloud.connectFailed', { reason: res.error ?? '' }), 'danger');
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('cloud.title')}</h1>
            <p className="panel-head__sub">{t('cloud.subtitle')}</p>
          </div>
          <Button variant="quiet" onClick={() => void loadStatus()} loading={busy && busyAction === 'status'}>
            <RefreshCw size={14} /> {t('cloud.syncNow')}
          </Button>
        </div>

        {/* --- Active storage ------------------------------------------- */}
        <Card raised style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '22px 24px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                display: 'grid',
                placeItems: 'center',
                fontSize: 20,
                fontWeight: 700,
                color: '#fff',
                flex: 'none',
                background: `linear-gradient(150deg, ${activeProvider?.accent ?? '#58595A'}, rgba(14,14,15,.92))`,
                border: '1px solid rgba(255,255,255,.1)',
              }}
            >
              {GLYPH[activeProvider?.id ?? 'local'] ?? 'N'}
            </span>
            <div className="nb-grow" style={{ minWidth: 200 }}>
              <Row gap={2}>
                <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--mist-100)', letterSpacing: 'var(--tracking-tight)' }}>
                  {activeProvider?.id === 'local' ? t('cloud.local') : activeProvider?.name ?? '—'}
                </span>
                {activeConnection?.simulated ? <Badge tone="warn">{t('cloud.simulated')}</Badge> : null}
                {activeProvider?.capabilities.write ? <Badge tone="sage">{t('cloud.connected')}</Badge> : <Badge tone="warn">{t('cloud.readOnly')}</Badge>}
              </Row>
              <div className="tiny" style={{ marginTop: 5 }}>
                {status?.info?.email ?? activeConnection?.accountLabel ?? t('cloud.account')} ·{' '}
                <span className="mono">{status?.drivePath ?? '/Nimbus/vault.enc'}</span>
              </div>
            </div>
            <Stack gap={1} style={{ minWidth: 190 }}>
              <Row gap={2} between>
                <span className="micro">{t('cloud.quota')}</span>
                <span className="tiny mono">
                  {quota.total ? t('cloud.used', { used: formatBytes(quota.used, locale), total: formatBytes(quota.total, locale) }) : t('cloud.unlimited', { used: formatBytes(quota.used, locale) })}
                </span>
              </Row>
              <Meter value={quotaRatio} tone={quotaRatio > 0.85 ? 'warn' : 'sage'} />
            </Stack>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '14px 24px', display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
            <Row gap={2}>
              <Dot live={!dirty && !syncing} />
              <span className="tiny">
                {syncing ? t('cloud.syncing') : dirty ? t('cloud.syncNow') : `${t('cloud.lastSync')} ${lastSyncedAt ? relativeTime(lastSyncedAt, locale) : '—'}`}
              </span>
            </Row>
            <Row gap={2}>
              <HardDrive size={12} style={{ color: 'var(--text-tertiary)' }} />
              <span className="tiny">
                {t('cloud.vaultSize')} · <strong style={{ color: 'var(--mist-300)' }}>{formatBytes(sizeBytes, locale)}</strong>
              </span>
            </Row>
            <Row gap={2}>
              <HistoryIcon size={12} style={{ color: 'var(--text-tertiary)' }} />
              <span className="tiny">
                {t('cloud.revision')} · <strong style={{ color: 'var(--mist-300)' }}>{revision}</strong>
              </span>
            </Row>
            <span className="nb-grow" />
            <Button size="sm" variant="primary" loading={syncing} onClick={() => void syncNow({ snapshot: true })}>
              <Cloud size={13} /> {t('cloud.syncNow')}
            </Button>
          </div>

          {syncError ? (
            <div style={{ padding: '10px 24px', background: 'var(--ember-tint)', color: 'var(--ember-300)', fontSize: 'var(--fs-tiny)' }}>{syncError}</div>
          ) : null}
        </Card>

        {/* --- Providers -------------------------------------------------- */}
        <section>
          <SectionTitle title={t('cloud.providers')} count={providers.length} />
          <div className="grid-cards">
            {providers.map((p) => {
              const linked = connections.filter((c) => c.providerId === p.id);
              const isActive = linked.some((c) => c.id === activeConnection?.id) || (p.id === 'local' && activeConnection?.id === 'local');
              return (
                <Card key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 12, borderColor: isActive ? 'var(--ember-600)' : undefined }}>
                  <Row gap={3}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 11,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#fff',
                        flex: 'none',
                        background: `linear-gradient(150deg, ${p.accent}, rgba(14,14,15,.9))`,
                      }}
                    >
                      {GLYPH[p.id] ?? p.name.slice(0, 1)}
                    </span>
                    <div className="nb-grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--mist-100)', fontSize: 'var(--fs-md)' }}>{p.id === 'local' ? t('cloud.local') : p.name}</div>
                      <div className="tiny truncate">{p.vendor}</div>
                    </div>
                    {isActive ? <Check size={16} style={{ color: 'var(--ember-400)' }} /> : null}
                  </Row>

                  <p className="tiny" style={{ lineHeight: 1.55, minHeight: 34 }}>
                    {p.id === 'local' ? t('cloud.localHint') : p.blurb}
                  </p>

                  <Row gap={1} wrap>
                    {p.capabilities.write ? <Badge tone="sage">{t('cloud.connected')}</Badge> : <Badge tone="warn">{t('cloud.readOnly')}</Badge>}
                    {p.capabilities.experimental ? <Badge>{t('cloud.experimental')}</Badge> : null}
                    {p.capabilities.directDownload ? <Badge>{t('cloud.download')}</Badge> : null}
                    {p.kind === 'oauth2' && !p.configured ? <Badge tone="warn">{t('cloud.notConfigured')}</Badge> : null}
                  </Row>

                  {p.capabilities.note ? (
                    <Row gap={2} style={{ alignItems: 'flex-start' }}>
                      <Info size={12} style={{ color: 'var(--text-tertiary)', marginTop: 2, flex: 'none' }} />
                      <span className="tiny" style={{ lineHeight: 1.5 }}>
                        {p.capabilities.note}
                      </span>
                    </Row>
                  ) : null}

                  {linked.length > 0 ? (
                    <Stack gap={1} style={{ marginTop: 'auto' }}>
                      {linked.map((c) => (
                        <Row key={c.id} gap={2} style={{ padding: '8px 10px', borderRadius: 'var(--r-sm)', background: 'var(--ink-880)', border: '1px solid var(--border)' }}>
                          <Link2 size={12} style={{ color: c.simulated ? 'var(--warn-text)' : 'var(--sage-400)' }} />
                          <span className="tiny nb-grow truncate">{c.accountLabel ?? c.email ?? c.label}</span>
                          {c.simulated ? <Badge tone="warn">démo</Badge> : null}
                          {!isActive && p.capabilities.write ? (
                            <IconButton label={t('cloud.switch')} size="sm" onClick={() => setConfirmMove(c.id)}>
                              <ArrowRightLeft size={12} />
                            </IconButton>
                          ) : null}
                          {c.id !== 'local' ? (
                            <IconButton label={t('cloud.disconnect')} size="sm" onClick={() => setConfirmDisconnect(c.id)}>
                              <Trash2 size={12} />
                            </IconButton>
                          ) : null}
                        </Row>
                      ))}
                    </Stack>
                  ) : (
                    <Row gap={2} style={{ marginTop: 'auto' }}>
                      {p.id !== 'local' && p.kind === 'oauth2' && p.configured ? (
                        <Button size="sm" variant="primary" className="nb-grow" onClick={() => connectOAuth(p.id)}>
                          <Cloud size={13} /> {t('cloud.connect')}
                        </Button>
                      ) : null}
                      {p.id !== 'local' && (p.kind === 'token' || p.kind === 'basic') ? (
                        <Button
                          size="sm"
                          variant="quiet"
                          className="nb-grow"
                          onClick={() => {
                            setFormProvider(p);
                            setCreds(Object.fromEntries((p.fields ?? []).map((f) => [f.key, ''])));
                          }}
                        >
                          <Link2 size={13} /> {t('cloud.connect')}
                        </Button>
                      ) : null}
                      {p.id !== 'local' ? (
                        <Button size="sm" variant="ghost" loading={busy && busyAction === `demo:${p.id}`} onClick={() => void connectSimulated(p.id)}>
                          <FlaskConical size={13} /> {t('cloud.tryDemo')}
                        </Button>
                      ) : null}
                      {p.id === 'local' && activeConnection?.id !== 'local' ? (
                        <Button size="sm" variant="quiet" className="nb-grow" onClick={() => setConfirmMove('local')}>
                          <ArrowRightLeft size={13} /> {t('cloud.switch')}
                        </Button>
                      ) : null}
                    </Row>
                  )}

                  {p.kind === 'oauth2' && !p.configured && p.id !== 'local' ? (
                    <span className="tiny" style={{ lineHeight: 1.5 }}>
                      {t('cloud.notConfiguredHint', { vars: envVarsFor(p.id) })}
                    </span>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>

        {/* --- Files on the Drive ----------------------------------------- */}
        <section>
          <SectionTitle
            title={t('cloud.files')}
            count={status?.files.length ?? 0}
            action={
              <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>
                <RefreshCw size={13} />
              </Button>
            }
          />
          <p className="tiny" style={{ marginBottom: 12, lineHeight: 1.55 }}>
            {t('cloud.filesSub')}
          </p>
          <Card flush style={{ overflow: 'hidden' }}>
            {status && status.files.length > 0 ? (
              <table className="nb-table">
                <thead>
                  <tr>
                    <th>{t('cloud.path')}</th>
                    <th style={{ textAlign: 'right' }}>{t('cloud.vaultSize')}</th>
                    <th>{t('cloud.lastSync')}</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {status.files.map((f) => (
                    <tr key={f.path}>
                      <td>
                        <Row gap={2}>
                          {f.isDir ? <FolderOpen size={13} style={{ color: 'var(--text-tertiary)' }} /> : <FileText size={13} style={{ color: 'var(--text-tertiary)' }} />}
                          <span className="mono" style={{ fontSize: 'var(--fs-small)' }}>
                            {f.path}
                          </span>
                        </Row>
                      </td>
                      <td style={{ textAlign: 'right' }} className="mono">
                        {f.isDir ? '—' : formatBytes(f.size, locale)}
                      </td>
                      <td className="tiny">{absoluteTime(f.modifiedAt, locale)}</td>
                      <td>
                        {f.isDir ? null : (
                          <IconButton label={t('cloud.download')} size="sm" onClick={() => window.open(driveStreamUrl(f.path), '_blank', 'noopener')}>
                            <Download size={13} />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Row gap={3} style={{ padding: 20 }}>
                <CloudOff size={16} style={{ color: 'var(--text-tertiary)' }} />
                <span className="tiny">{t('cloud.noConnections')}</span>
              </Row>
            )}
          </Card>
        </section>

        {/* --- Snapshots --------------------------------------------------- */}
        <section>
          <SectionTitle title={t('cloud.snapshots')} count={snapshots.length} />
          <p className="tiny" style={{ marginBottom: 12, lineHeight: 1.55 }}>
            {t('cloud.snapshotsSub')}
          </p>
          {snapshots.length === 0 ? (
            <Card>
              <Row gap={3}>
                <HistoryIcon size={15} style={{ color: 'var(--text-tertiary)' }} />
                <span className="tiny">{t('common.empty')}</span>
              </Row>
            </Card>
          ) : (
            <div className="grid-cards">
              {snapshots.slice(0, 12).map((s) => (
                <Card key={s.path} style={{ padding: 15 }}>
                  <Row gap={3} between>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>
                        {t('cloud.revision')} {s.revision}
                      </div>
                      <div className="tiny">
                        {absoluteTime(s.at, locale)} · {formatBytes(s.size, locale)}
                      </div>
                    </div>
                    <Button size="sm" variant="quiet" loading={busy && busyAction === `restore:${s.revision}`} onClick={() => setConfirmRestore({ path: s.path, rev: s.revision })}>
                      {t('cloud.restore')}
                    </Button>
                  </Row>
                </Card>
              ))}
            </div>
          )}
        </section>

        <Card style={{ padding: 16 }}>
          <Row gap={3} style={{ alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--sage-400)', marginTop: 1 }}>
              <ShieldCheck size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--mist-200)', fontSize: 'var(--fs-body)' }}>{t('privacy.zeroKnowledge')}</div>
              <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                {t('privacy.zeroKnowledgeSub')}
              </div>
            </div>
          </Row>
        </Card>
      </div>

      {/* --- Credentials form ------------------------------------------- */}
      <Modal
        open={Boolean(formProvider)}
        onClose={() => setFormProvider(null)}
        title={formProvider ? `${t('cloud.connect')} · ${formProvider.name}` : ''}
        subtitle={formProvider?.blurb}
        width="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormProvider(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void submitCreds()} loading={busy}>
              <Link2 size={14} /> {t('cloud.connect')}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          {(formProvider?.fields ?? []).map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <TextInput
                type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                placeholder={f.placeholder}
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          {formProvider?.docsUrl ? (
            <a className="tiny" href={formProvider.docsUrl} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--ember-400)' }}>
              {formProvider.docsUrl}
            </a>
          ) : null}
        </Stack>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmMove)}
        title={t('cloud.migrate')}
        body={t('cloud.migrateConfirm', { provider: providers.find((p) => p.id === connections.find((c) => c.id === confirmMove)?.providerId)?.name ?? 'Nimbus Cloud' })}
        confirmLabel={t('cloud.migrate')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => setConfirmMove(null)}
        onConfirm={async () => {
          const id = confirmMove;
          setConfirmMove(null);
          if (!id) return;
          const res = await moveTo(id);
          if (!res.ok) toast(t('cloud.connectFailed', { reason: res.error ?? '' }), 'danger');
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmRestore)}
        title={t('cloud.restore')}
        body={t('cloud.restoreConfirm', { rev: confirmRestore?.rev ?? 0 })}
        danger
        confirmLabel={t('cloud.restore')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => setConfirmRestore(null)}
        onConfirm={async () => {
          const target = confirmRestore;
          setConfirmRestore(null);
          if (!target) return;
          const res = await restore(target.path, target.rev);
          if (!res.ok) toast(res.error ?? t('errors.generic'), 'danger');
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDisconnect)}
        title={t('cloud.disconnect')}
        body={t('cloud.disconnectConfirm', { label: connections.find((c) => c.id === confirmDisconnect)?.label ?? '' })}
        danger
        confirmLabel={t('cloud.disconnect')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={async () => {
          const id = confirmDisconnect;
          setConfirmDisconnect(null);
          if (!id) return;
          await disconnect(id);
        }}
      />
    </div>
  );
};

const envVarsFor = (providerId: string): string =>
  ({
    google: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
    yandex: 'YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET',
    onedrive: 'ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET',
    proton: 'PROTON_CLIENT_ID / PROTON_CLIENT_SECRET',
    webdav: '—',
    local: '—',
  })[providerId] ?? '—';
