import { useEffect, useState } from 'react';
import { Activity, CloudCog, Database, ShieldCheck, Timer } from 'lucide-react';
import { Dot } from '../../design/components';
import { formatBytes, relativeTime } from '../../design/components/theme';
import { useBrowser } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';

/** Thin strip of living facts: engine, protection, vault, session clock. */
export const StatusBar = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const stats = useBrowser((s) => s.stats);
  const proxied = useBrowser((s) => s.proxiedRequests);
  const blocked = useBrowser((s) => s.blockedTotal);
  const syncing = useVault((s) => s.syncing);
  const dirty = useVault((s) => s.dirty);
  const lastSyncedAt = useVault((s) => s.lastSyncedAt);
  const sizeBytes = useVault((s) => s.sizeBytes);
  const integrityOk = useVault((s) => s.integrityOk);
  const profile = useSession((s) => s.activeProfile);
  const lastActivity = useSession((s) => s.lastActivity);
  const autoLockMinutes = useSession((s) => s.autoLockMinutes);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = autoLockMinutes > 0 ? Math.max(0, autoLockMinutes * 60_000 - (now - lastActivity)) : null;
  const mmss = remaining === null ? null : `${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0')}`;

  return (
    <div className="statusbar">
      <span className="statusbar__item statusbar__item--ok">
        <CloudCog size={11} /> {t('browser.cloudEngine')}
      </span>
      <span className="statusbar__item">
        <Activity size={11} /> {proxied} {t('start.requestsProxied')}
      </span>
      <span className={`statusbar__item ${blocked > 0 ? 'statusbar__item--ok' : ''}`}>
        <ShieldCheck size={11} /> {blocked > 0 ? t('browser.trackersBlocked', { n: blocked }) : t('browser.trackersNone')}
      </span>
      <span className="statusbar__item">
        <Database size={11} /> {formatBytes(stats?.cache.bytes ?? 0, locale)}
      </span>

      <span className="nb-grow" />

      <span className={`statusbar__item ${integrityOk === false ? 'statusbar__item--ember' : dirty || syncing ? 'statusbar__item--warn' : 'statusbar__item--ok'}`}>
        <Dot tone={integrityOk === false ? 'ember' : dirty || syncing ? 'ember' : 'live'} live={!dirty && !syncing} />
        {syncing ? t('cloud.syncing') : dirty ? t('cloud.syncNow') : lastSyncedAt ? `${t('cloud.lastSync')} ${relativeTime(lastSyncedAt, locale)}` : t('vault.encrypted')}
        {sizeBytes ? ` · ${formatBytes(sizeBytes, locale)}` : ''}
      </span>
      {mmss ? (
        <span className={`statusbar__item ${remaining !== null && remaining < 60_000 ? 'statusbar__item--warn' : ''}`}>
          <Timer size={11} /> {mmss}
        </span>
      ) : null}
      {profile ? (
        <span className="statusbar__item">
          <span className="nb-dot nb-dot--ember" /> {profile.label} · {profile.providerName}
        </span>
      ) : null}
    </div>
  );
};
