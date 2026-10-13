import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Eye, Fingerprint, KeyRound, Lock, ShieldCheck, Timer } from 'lucide-react';
import { Button, IconButton, Spinner } from '../../design/components';
import { relativeTime } from '../../design/components/theme';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { Onboarding } from './Onboarding';
import './lock.css';

const NimbusMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 16.5a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 16.4 8.2 3.9 3.9 0 0 1 18 16.5H5Z" fill="currentColor" opacity=".92" />
    <path d="M9.6 19.4h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".65" />
  </svg>
);

export const LockScreen = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const phase = useSession((s) => s.phase);
  const profiles = useSession((s) => s.profiles);
  const connections = useSession((s) => s.connections);
  const providers = useSession((s) => s.providers);
  const selectedId = useSession((s) => s.selectedProfileId);
  const selectProfile = useSession((s) => s.selectProfile);
  const unlock = useSession((s) => s.unlock);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const lockReason = useSession((s) => s.lockReason);
  const autoLockMinutes = useSession((s) => s.autoLockMinutes);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const profile = useMemo(() => profiles.find((p) => p.profileId === selectedId) ?? profiles[0], [profiles, selectedId]);

  useEffect(() => {
    if (phase === 'locked' && profiles.length > 0) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 260);
      return () => window.clearTimeout(id);
    }
  }, [phase, profiles.length]);

  useEffect(() => setPassword(''), [selectedId]);

  const providerName = useMemo(() => {
    if (!profile) return providers.find((p) => p.id === 'local')?.name ?? 'Nimbus Cloud';
    const connection = connections.find((c) => c.id === profile.connectionId);
    const provider = providers.find((p) => p.id === (connection?.providerId ?? profile.providerId));
    return provider?.name ?? profile.providerName ?? 'Nimbus Cloud';
  }, [profile, connections, providers]);

  const glowHue = profile?.hue ?? 18;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !password || busy) return;
    setLocalError(null);
    const result = await unlock(profile.profileId, password);
    if (!result.ok) {
      setLocalError(result.error);
      setPassword('');
      inputRef.current?.focus();
    }
  };

  if (phase === 'boot') {
    return (
      <div className="lock-root">
        <div className="lock-glow" style={{ background: 'radial-gradient(900px 520px at 50% 18%, rgba(184,25,8,.10), transparent 62%)' }} />
        <div className="lock-card nb-row nb-gap-3 nb-center" style={{ width: 'min(320px,100%)', padding: '34px 28px' }}>
          <Spinner large />
          <span className="tiny">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (creating || profiles.length === 0) {
    return <Onboarding onDone={() => setCreating(false)} />;
  }

  const reasonLine =
    lockReason === 'idle'
      ? t('lock.sessionEnded')
      : lockReason === 'manual' || lockReason === 'profile-switch'
        ? t('lock.lockedManually')
        : null;

  return (
    <div className="lock-root">
      <div
        className="lock-glow"
        style={{
          background: `radial-gradient(1000px 620px at 50% 8%, hsl(${glowHue} 62% 34% / .20), transparent 60%),
                       radial-gradient(760px 480px at 88% 92%, rgba(82,57,44,.30), transparent 62%)`,
        }}
      />

      <div className="lock-card">
        <div className="lock-brand">
          <span className="lock-mark">
            <NimbusMark />
          </span>
          <span className="lock-wordmark">
            Nimbus
            <span>{t('app.tagline')}</span>
          </span>
        </div>

        <h1 className="lock-heading">
          {profiles.length > 1 ? t('lock.selectProfile') : t('lock.title')}
        </h1>
        <p className="lock-sub">{reasonLine ?? t('lock.subtitle')}</p>

        {profiles.length > 1 ? (
          <div className="lock-profiles">
            {profiles.map((p) => (
              <button
                key={p.profileId}
                type="button"
                className="lock-profile"
                data-on={p.profileId === profile?.profileId}
                onClick={() => selectProfile(p.profileId)}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 8,
                    background: `linear-gradient(150deg, hsl(${p.hue} 46% 30%), hsl(${p.hue} 58% 18%))`,
                    border: `1px solid hsl(${p.hue} 42% 36% / .6)`,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--mist-100)',
                  }}
                >
                  {p.label.slice(0, 1).toUpperCase()}
                </span>
                {p.label}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={submit}>
          {(localError || error) && (
            <div className="lock-error" role="alert">
              <KeyRound size={15} />
              <span>{localError ?? error}</span>
            </div>
          )}

          <div className="lock-password">
            <div className="nb-control nb-control--affix">
              <input
                ref={inputRef}
                className="nb-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                spellCheck={false}
                placeholder={t('lock.password')}
                aria-label={t('lock.password')}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="nb-affix">
                <IconButton label={showPassword ? t('common.hide') : t('common.reveal')} size="sm" type="button" onClick={() => setShowPassword((s) => !s)} on={showPassword}>
                  <Eye size={15} />
                </IconButton>
              </div>
            </div>
          </div>

          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password}>
            {busy ? t('lock.unlocking') : t('lock.unlock')}
          </Button>
        </form>

        <div className="lock-meta">
          <div className="lock-meta-row">
            <ShieldCheck size={14} />
            <span>{t('lock.zeroKnowledge')}</span>
          </div>
          <div className="lock-meta-row">
            <Cloud size={14} />
            <span>
              {t('lock.storedOn', { provider: providerName })}
              {profile ? <> · {t('lock.lastSync', { when: relativeTime(profile.updatedAt, locale) })}</> : null}
            </span>
          </div>
          <div className="lock-meta-row">
            <Timer size={14} />
            <span>{t('lock.autoLock', { n: autoLockMinutes })}</span>
          </div>
          {profile ? (
            <div className="lock-meta-row">
              <Fingerprint size={14} />
              <span>
                {t('lock.kdf', { iterations: profile.kdf.iterations.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB') })} · {profile.cipher}
              </span>
            </div>
          ) : null}
        </div>

        <div className="lock-alt">
          <Lock size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
          <button type="button" onClick={() => setCreating(true)}>
            {t('lock.createProfile')}
          </button>
        </div>
      </div>
    </div>
  );
};
