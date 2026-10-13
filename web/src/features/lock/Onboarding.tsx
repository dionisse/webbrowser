import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Cloud, FlaskConical, Info, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Card, IconButton, Row, Stack } from '../../design/components';
import { PasswordInput, Segmented, Switch, TextInput } from '../../design/components/Fields';
import { DEFAULT_GENERATOR, generatePassword, passwordStrength } from '../../lib/crypto';
import { useSession } from '../../state/session';
import { useCloud } from '../../state/cloud';
import { useUi } from '../../state/ui';
import type { ProviderDescriptor } from '../../lib/types';
import './lock.css';

const HUES = [12, 22, 34, 96, 152, 190, 214, 262, 320];

const PROVIDER_GLYPH: Record<string, string> = {
  local: 'N',
  google: 'G',
  proton: 'P',
  yandex: 'Y',
  onedrive: 'M',
  webdav: 'W',
};

export const Onboarding = ({ onDone }: { onDone: () => void }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const createVault = useSession((s) => s.createVault);
  const busy = useSession((s) => s.busy);
  const providers = useSession((s) => s.providers);
  const connections = useSession((s) => s.connections);

  const [step, setStep] = useState(0);
  const [label, setLabel] = useState('');
  const [hue, setHue] = useState(18);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [connectionId, setConnectionId] = useState('local');
  const [error, setError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);

  const loadCloud = useCloud((s) => s.load);
  const connectSimulated = useCloud((s) => s.connectSimulated);

  useEffect(() => {
    void loadCloud();
  }, [loadCloud]);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;
  const passwordOk = password.length >= 12 && confirm === password;

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId],
  );
  const selectedProvider: ProviderDescriptor | undefined = useMemo(
    () => providers.find((p) => p.id === (selectedConnection?.providerId ?? 'local')),
    [providers, selectedConnection],
  );

  const steps = [t('onboarding.step1'), t('onboarding.step2'), t('onboarding.step3'), t('onboarding.step4')];

  const next = () => {
    setError(null);
    if (step === 0 && !label.trim()) {
      setError(t('onboarding.label'));
      return;
    }
    if (step === 1 && !passwordOk) {
      setError(tooShort ? t('onboarding.tooShort') : mismatch ? t('onboarding.mismatch') : t('onboarding.passwordHint'));
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const finish = async () => {
    if (!acknowledged) {
      setError(t('onboarding.warningBody'));
      return;
    }
    setError(null);
    const res = await createVault({ label: label.trim(), hue, password, connectionId, locale });
    if (!res.ok) {
      setError(res.error ?? t('errors.generic'));
      return;
    }
    toast(t('onboarding.created'), 'success', {
      detail: `${selectedProvider?.id === 'local' ? t('cloud.local') : selectedProvider?.name} · /Nimbus/vault.enc`,
    });
    onDone();
  };

  const attachDemoProvider = async (providerId: string) => {
    setConnectBusy(true);
    const res = await connectSimulated(providerId);
    setConnectBusy(false);
    if (!res.ok) {
      setError(res.error ?? t('errors.generic'));
      return;
    }
    await loadCloud();
    const fresh = useCloud.getState().connections.find((c) => c.providerId === providerId && c.simulated);
    if (fresh) setConnectionId(fresh.id);
  };

  const providerOptions = [
    { id: 'local', providerId: 'local', label: t('cloud.local'), accountLabel: undefined, simulated: false },
    ...connections.filter((c) => c.id !== 'local'),
  ];

  return (
    <div className="lock-root">
      <div
        className="lock-glow"
        style={{
          background: `radial-gradient(1000px 640px at 50% 6%, hsl(${hue} 60% 34% / .20), transparent 62%),
                       radial-gradient(720px 460px at 10% 96%, rgba(82,57,44,.30), transparent 64%)`,
        }}
      />

      <div className="lock-card lock-card--wide">
        <div className="lock-brand">
          <span className="lock-mark" style={{ background: `linear-gradient(148deg, hsl(${hue} 62% 46%), hsl(${hue} 58% 24%))` }}>
            <Sparkles size={17} />
          </span>
          <span className="lock-wordmark">
            Nimbus
            <span>{t('onboarding.title')}</span>
          </span>
          <span className="nb-grow" />
          {step > 0 ? (
            <IconButton label={t('common.back')} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={16} />
            </IconButton>
          ) : null}
        </div>

        <div className="steps">
          {steps.map((name, i) => (
            <div className="step" key={name} data-active={i === step} data-done={i < step} title={name}>
              <span className="step__num">{i < step ? <Check size={11} /> : i + 1}</span>
              <span className="step__bar" />
            </div>
          ))}
        </div>

        {error ? (
          <div className="lock-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* --- Step 1: profile ------------------------------------------- */}
        {step === 0 ? (
          <Stack gap={5} className="anim-fade">
            <div>
              <h1 className="lock-heading">{t('onboarding.step1')}</h1>
              <p className="lock-sub">{t('app.sub')}</p>
            </div>
            <TextInput
              label={t('onboarding.label')}
              value={label}
              autoFocus
              maxLength={40}
              placeholder={t('onboarding.labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
            <div className="nb-field">
              <span className="nb-label">{t('onboarding.hue')}</span>
              <div className="hues">
                {HUES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="hue-swatch"
                    data-on={h === hue}
                    aria-label={`hue ${h}`}
                    style={{ background: `linear-gradient(150deg, hsl(${h} 52% 42%), hsl(${h} 56% 22%))` }}
                    onClick={() => setHue(h)}
                  />
                ))}
              </div>
            </div>
            <Card raised style={{ padding: 16 }}>
              <Row gap={3}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 13,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    color: 'var(--mist-100)',
                    background: `linear-gradient(150deg, hsl(${hue} 46% 30%), hsl(${hue} 58% 17%))`,
                    border: `1px solid hsl(${hue} 42% 36% / .6)`,
                  }}
                >
                  {(label || 'N').slice(0, 1).toUpperCase()}
                </span>
                <div className="nb-grow">
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)', fontSize: 'var(--fs-md)' }}>{label || t('onboarding.labelPlaceholder')}</div>
                  <div className="tiny">AES-GCM-256 · PBKDF2-SHA256</div>
                </div>
                <span className="nb-badge nb-badge--sage">
                  <ShieldCheck size={11} /> zero-knowledge
                </span>
              </Row>
            </Card>
          </Stack>
        ) : null}

        {/* --- Step 2: master password ----------------------------------- */}
        {step === 1 ? (
          <Stack gap={4} className="anim-fade">
            <div>
              <h1 className="lock-heading">{t('onboarding.step2')}</h1>
              <p className="lock-sub">{t('onboarding.passwordHint')}</p>
            </div>
            <PasswordInput
              label={t('onboarding.password')}
              value={password}
              autoFocus
              autoComplete="new-password"
              placeholder="••••••••••••"
              onChange={(e) => setPassword(e.target.value)}
              onGenerate={() => {
                const pw = generatePassword({ ...DEFAULT_GENERATOR, length: 22 });
                setPassword(pw);
                setConfirm(pw);
              }}
              generateLabel={t('passwords.generate')}
            />
            <div className="strength">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="strength__seg"
                  style={{
                    background:
                      password && i <= strength.score - (strength.score === 4 ? 0 : 0)
                        ? strength.score <= 1
                          ? 'var(--ember-500)'
                          : strength.score === 2
                            ? 'var(--warn)'
                            : 'var(--sage-500)'
                        : undefined,
                  }}
                />
              ))}
              <span
                className="strength__label"
                style={{
                  color: strength.score <= 1 ? 'var(--ember-400)' : strength.score === 2 ? 'var(--warn-text)' : 'var(--sage-400)',
                }}
              >
                {password
                  ? t(`onboarding.strength${strength.label.charAt(0).toUpperCase()}${strength.label.slice(1)}`)
                  : ''}
              </span>
            </div>
            <div className="tiny" style={{ marginTop: -4 }}>
              {password ? `${strength.entropyBits} bits · ${password.length} ${locale === 'fr' ? 'caractères' : 'characters'}` : ''}
            </div>
            <PasswordInput
              label={t('onboarding.passwordConfirm')}
              value={confirm}
              autoComplete="new-password"
              error={mismatch ? t('onboarding.mismatch') : undefined}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && passwordOk && next()}
            />
            <Card style={{ padding: 14, background: 'var(--ember-tint)', borderColor: 'rgba(184,25,8,.24)' }}>
              <Row gap={3} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--ember-400)', marginTop: 1 }}>
                  <Lock size={15} />
                </span>
                <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ember-300)', lineHeight: 1.5 }}>{t('onboarding.warningBody')}</span>
              </Row>
            </Card>
          </Stack>
        ) : null}

        {/* --- Step 3: cloud storage ------------------------------------- */}
        {step === 2 ? (
          <Stack gap={4} className="anim-fade">
            <div>
              <h1 className="lock-heading">{t('onboarding.chooseCloud')}</h1>
              <p className="lock-sub">{t('onboarding.chooseCloudSub')}</p>
            </div>

            <div className="provider-grid">
              {providers.map((p) => {
                const existing = providerOptions.filter((o) => o.providerId === p.id);
                const selected = existing.some((o) => o.id === connectionId);
                const canHost = p.capabilities.write;
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      type="button"
                      className="provider-card"
                      data-on={selected}
                      disabled={!canHost && p.id !== 'local'}
                      onClick={() => {
                        const first = existing[0];
                        if (first) setConnectionId(first.id);
                        else if (p.id === 'local') setConnectionId('local');
                        else void attachDemoProvider(p.id);
                      }}
                    >
                      <Row gap={3}>
                        <span className="provider-logo" style={{ background: `linear-gradient(150deg, ${p.accent}, rgba(14,14,15,.9))` }}>
                          {PROVIDER_GLYPH[p.id] ?? p.name.slice(0, 1)}
                        </span>
                        <div className="nb-grow">
                          <div className="provider-card__name">{p.id === 'local' ? t('cloud.local') : p.name}</div>
                          <div className="tiny">{p.vendor}</div>
                        </div>
                        {selected ? <Check size={15} style={{ color: 'var(--ember-400)' }} /> : null}
                      </Row>
                      <div className="provider-card__blurb">{p.id === 'local' ? t('cloud.localHint') : p.blurb}</div>
                      <Row gap={2} wrap>
                        {canHost ? null : <span className="nb-badge nb-badge--warn">{t('cloud.readOnly')}</span>}
                        {p.capabilities.experimental ? <span className="nb-badge">{t('cloud.experimental')}</span> : null}
                        {p.kind === 'oauth2' && !p.configured ? (
                          <span className="nb-badge">{t('cloud.notConfigured')}</span>
                        ) : p.kind !== 'none' ? (
                          <span className="nb-badge nb-badge--sage">{t('cloud.configured')}</span>
                        ) : null}
                      </Row>
                    </button>

                    {canHost && p.id !== 'local' && !existing.length ? (
                      <Row gap={2}>
                        {p.configured && p.kind === 'oauth2' ? (
                          <Button size="sm" variant="quiet" className="nb-grow" onClick={() => useCloud.getState().connectOAuth(p.id)}>
                            <Cloud size={13} /> {t('cloud.connect')}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" className="nb-grow" disabled={connectBusy} onClick={() => void attachDemoProvider(p.id)}>
                          <FlaskConical size={13} /> {t('cloud.tryDemo')}
                        </Button>
                      </Row>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {selectedConnection?.simulated ? (
              <Card style={{ padding: 13, background: 'var(--clay-tint)', borderColor: 'rgba(82,57,44,.6)' }}>
                <Row gap={3} style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--clay-300)', marginTop: 1 }}>
                    <Info size={14} />
                  </span>
                  <span style={{ fontSize: 'var(--fs-tiny)', color: 'var(--clay-300)', lineHeight: 1.5 }}>{t('cloud.simulatedHint')}</span>
                </Row>
              </Card>
            ) : null}

            {selectedProvider?.capabilities.note ? (
              <div className="tiny" style={{ lineHeight: 1.5 }}>
                {selectedProvider.capabilities.note}
              </div>
            ) : null}
          </Stack>
        ) : null}

        {/* --- Step 4: review -------------------------------------------- */}
        {step === 3 ? (
          <Stack gap={4} className="anim-fade">
            <div>
              <h1 className="lock-heading">{t('onboarding.step4')}</h1>
              <p className="lock-sub">{t('onboarding.warningBody')}</p>
            </div>

            <Card raised>
              <Stack gap={4}>
                <Row gap={3} between>
                  <span className="micro">{t('lock.profile')}</span>
                  <span style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{label}</span>
                </Row>
                <Row gap={3} between>
                  <span className="micro">{t('onboarding.password')}</span>
                  <span className="mono tiny">{'•'.repeat(Math.min(password.length, 20))}</span>
                </Row>
                <Row gap={3} between>
                  <span className="micro">{t('onboarding.strength')}</span>
                  <span style={{ color: strength.score >= 3 ? 'var(--sage-400)' : 'var(--warn-text)', fontWeight: 600 }}>{strength.entropyBits} bits</span>
                </Row>
                <Row gap={3} between>
                  <span className="micro">{t('cloud.current')}</span>
                  <span style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{selectedProvider?.id === 'local' ? t('cloud.local') : selectedProvider?.name}</span>
                </Row>
                <Row gap={3} between>
                  <span className="micro">{t('cloud.path')}</span>
                  <span className="mono tiny">/Nimbus/vault.enc</span>
                </Row>
              </Stack>
            </Card>

            <div style={{ marginTop: 2 }}>
              <Switch checked={acknowledged} onChange={setAcknowledged} title={t('onboarding.warningTitle')} sub={t('onboarding.warningBody')} />
            </div>

            <div className="nb-field">
              <span className="nb-label">{t('settings.language')}</span>
              <Segmented
                value={locale}
                onChange={(next) => {
                  useUi.getState().setLocale(next);
                }}
                options={[
                  { value: 'fr' as const, label: 'Français' },
                  { value: 'en' as const, label: 'English' },
                ]}
                ariaLabel={t('settings.language')}
              />
            </div>
          </Stack>
        ) : null}

        <Row gap={3} style={{ marginTop: 24 }}>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              {t('common.back')}
            </Button>
          ) : null}
          <span className="nb-grow" />
          {step < 3 ? (
            <Button variant="primary" onClick={next} disabled={(step === 1 && !passwordOk) || (step === 0 && !label.trim())}>
              {t('common.next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={finish} loading={busy} disabled={!acknowledged}>
              {busy ? t('onboarding.creating') : t('onboarding.iUnderstand')}
            </Button>
          )}
        </Row>

        {useSession.getState().profiles.length > 0 ? (
          <div className="lock-alt">
            <button type="button" onClick={onDone}>
              {t('common.back')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
