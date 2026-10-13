import { useEffect, useState } from 'react';
import {
  Ban,
  CloudCog,
  Database,
  DownloadCloud,
  Eraser,
  EyeOff,
  HardDrive,
  KeyRound,
  Radar,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Meter, Row, SectionTitle, Stack } from '../../design/components';
import { Slider, Switch } from '../../design/components/Fields';
import { formatBytes, relativeTime } from '../../design/components/theme';
import { api } from '../../lib/api';
import { useBrowser } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';

export const PrivacyPanel = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const density = useUi((s) => s.density);
  const vault = useVault((s) => s.vault);
  const updateSettings = useVault((s) => s.updateSettings);
  const stats = useBrowser((s) => s.stats);
  const proxiedRequests = useBrowser((s) => s.proxiedRequests);
  const blockedTotal = useBrowser((s) => s.blockedTotal);
  const refreshStats = useBrowser((s) => s.refreshStats);
  const meta = useSession((s) => s.meta);
  const applySettings = useSession((s) => s.applySettings);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    void refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = vault?.settings;
  const set = (patch: Partial<typeof settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch } as typeof settings;
    updateSettings(patch as never);
    applySettings(next);
  };

  const wipe = async () => {
    setWiping(true);
    try {
      await api.clearDownloads();
      await refreshStats();
      toast(t('privacy.wiped'), 'success');
    } catch {
      toast(t('errors.generic'), 'danger');
    } finally {
      setWiping(false);
      setConfirmWipe(false);
    }
  };

  const cacheMax = 64 * 1024 * 1024;
  const cacheRatio = stats ? Math.min(1, stats.cache.bytes / cacheMax) : 0;

  return (
    <div className="panel-page">
      <div className="panel-inner panel-narrow">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('privacy.title')}</h1>
            <p className="panel-head__sub">{t('privacy.subtitle')}</p>
          </div>
          <Button variant="danger" onClick={() => setConfirmWipe(true)}>
            <Eraser size={14} /> {t('privacy.wipe')}
          </Button>
        </div>

        {/* --- Live session counters -------------------------------------- */}
        <div className="grid-stats">
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value" style={{ color: blockedTotal ? 'var(--sage-400)' : 'var(--mist-300)' }}>
              {stats?.blockedRequests ?? blockedTotal}
            </div>
            <div className="stat-card__label">{t('privacy.blockedRequests')}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value">{proxiedRequests}</div>
            <div className="stat-card__label">{t('start.requestsProxied')}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value">{stats?.cache.entries ?? 0}</div>
            <div className="stat-card__label">{t('privacy.cacheEntries')}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value">{formatBytes(stats?.cache.bytes ?? 0, locale)}</div>
            <div className="stat-card__label">{t('privacy.cacheBytes')}</div>
          </Card>
        </div>

        <Card>
          <Row gap={3} between>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('privacy.cacheBytes')}</div>
              <div className="tiny">
                {t('start.bytesWrittenLocal')} · {formatBytes(stats?.downloads.bytes ?? 0, locale)} · TTL {stats?.ttlSeconds ?? meta?.engine.cacheTtlSeconds ?? 0}s
              </div>
            </div>
            <div style={{ width: 130 }}>
              <Meter value={cacheRatio} tone={cacheRatio > 0.8 ? 'warn' : 'slate'} />
            </div>
          </Row>
        </Card>

        {/* --- Blocking --------------------------------------------------- */}
        <section>
          <SectionTitle title={t('privacy.blocking')} />
          <Stack gap={3}>
            <Switch
              checked={Boolean(settings?.blockTrackers)}
              onChange={(v) => set({ blockTrackers: v })}
              title={t('privacy.blockTrackers')}
              sub={t('privacy.blockTrackersSub')}
            />
            <Switch
              checked={Boolean(settings?.hideNuisance)}
              onChange={(v) => set({ hideNuisance: v })}
              title={t('privacy.hideNuisance')}
              sub={t('privacy.hideNuisanceSub')}
            />
          </Stack>
        </section>

        {stats && stats.blockedHosts.length > 0 ? (
          <section>
            <SectionTitle title={t('privacy.topBlocked')} count={stats.blockedHosts.length} />
            <Card flush>
              <table className="nb-table">
                <tbody>
                  {stats.blockedHosts.map((h) => (
                    <tr key={h.host}>
                      <td>
                        <Row gap={2}>
                          <Ban size={12} style={{ color: 'var(--ember-400)' }} />
                          <span className="mono" style={{ fontSize: 'var(--fs-small)' }}>
                            {h.host}
                          </span>
                        </Row>
                      </td>
                      <td style={{ textAlign: 'right' }} className="mono">
                        {h.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        ) : null}

        {/* --- Session ---------------------------------------------------- */}
        <section>
          <SectionTitle title={t('privacy.session')} />
          <Stack gap={3}>
            <Card>
              <Slider
                label={t('privacy.autoLock')}
                min={0}
                max={60}
                step={1}
                value={settings?.autoLockMinutes ?? 10}
                display={settings?.autoLockMinutes === 0 ? t('privacy.off') : t('privacy.minutes', { n: settings?.autoLockMinutes ?? 10 })}
                onChange={(v) => set({ autoLockMinutes: v })}
              />
              <div className="tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {t('privacy.autoLockSub')}
              </div>
            </Card>
            <Switch
              checked={Boolean(settings?.lockOnBlur)}
              onChange={(v) => set({ lockOnBlur: v })}
              title={t('privacy.lockOnBlur')}
              sub={t('privacy.autoLockSub')}
            />
          </Stack>
        </section>

        {/* --- Data classification ---------------------------------------- */}
        <section>
          <SectionTitle title={t('privacy.data')} />
          <div className="grid-cards">
            <Card>
              <Row gap={3}>
                <Timer size={15} style={{ color: 'var(--warn-text)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('privacy.ephemeral')}</div>
                  <div className="tiny" style={{ lineHeight: 1.6, marginTop: 4 }}>
                    {t('privacy.ephemeralList')}
                  </div>
                </div>
              </Row>
            </Card>
            <Card>
              <Row gap={3}>
                <Database size={15} style={{ color: 'var(--sage-400)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('privacy.persistent')}</div>
                  <div className="tiny" style={{ lineHeight: 1.6, marginTop: 4 }}>
                    {t('privacy.persistentList')}
                  </div>
                </div>
              </Row>
            </Card>
            <Card>
              <Row gap={3}>
                <KeyRound size={15} style={{ color: 'var(--ember-400)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('privacy.never')}</div>
                  <div className="tiny" style={{ lineHeight: 1.6, marginTop: 4 }}>
                    {t('privacy.neverList')}
                  </div>
                </div>
              </Row>
            </Card>
          </div>
        </section>

        {/* --- Engine ----------------------------------------------------- */}
        <section>
          <SectionTitle title={t('privacy.engine')} />
          <Stack gap={3}>
            <Card>
              <Row gap={3} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--ember-400)', marginTop: 2 }}>
                  <CloudCog size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-200)' }}>{t('privacy.engine')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('privacy.engineSub')}
                  </div>
                </div>
                <Badge tone="sage">
                  <EyeOff size={11} /> sandbox
                </Badge>
              </Row>
            </Card>
            <Card>
              <Row gap={3} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--sage-400)', marginTop: 2 }}>
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-200)' }}>{t('privacy.zeroKnowledge')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('privacy.zeroKnowledgeSub')}
                  </div>
                </div>
              </Row>
            </Card>
            <Card>
              <Row gap={3} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--warn-text)', marginTop: 2 }}>
                  <Radar size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-200)' }}>{t('privacy.ssrf')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('privacy.ssrfSub')}
                  </div>
                </div>
              </Row>
            </Card>
            <Card>
              <Row gap={3} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--mist-400)', marginTop: 2 }}>
                  <DownloadCloud size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-200)' }}>
                    <HardDrive size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
                    {t('browser.localNone')}
                  </div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('downloads.subtitle')}
                  </div>
                </div>
              </Row>
            </Card>
          </Stack>
        </section>

        <div className="tiny" style={{ color: 'var(--text-tertiary)' }}>
          {t('vault.lastUpdate', { when: vault ? relativeTime(vault.updatedAt, locale) : '—' })} · {density === 'compact' ? t('settings.densityCompact') : t('settings.densityCozy')}
        </div>
      </div>

      <ConfirmDialog
        open={confirmWipe}
        title={t('privacy.wipe')}
        body={t('privacy.ephemeralList')}
        danger
        confirmLabel={t('privacy.wipe')}
        cancelLabel={t('common.cancel')}
        busy={wiping}
        onCancel={() => setConfirmWipe(false)}
        onConfirm={() => void wipe()}
      />
    </div>
  );
};
