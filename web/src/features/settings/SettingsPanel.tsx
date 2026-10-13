import { useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpenText,
  Compass,
  Gauge,
  KeyRound,
  Languages,
  Lock,
  MonitorSmartphone,
  Palette,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Row, SectionTitle, Stack } from '../../design/components';
import { Modal } from '../../design/components/Overlays';
import { api } from '../../lib/api';
import { Field, PasswordInput, Segmented, Select, Slider, Switch, TextInput } from '../../design/components/Fields';
import { useBrowser, SEARCH_ENGINES } from '../../state/browser';
import { useSession } from '../../state/session';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import { locales } from '../../i18n';
import { passwordStrength } from '../../lib/crypto';
import type { Settings } from '../../lib/types';

const strengthLabel = (pw: string) => passwordStrength(pw).label.charAt(0).toUpperCase() + passwordStrength(pw).label.slice(1);

export const SettingsPanel = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const toast = useUi((s) => s.toast);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const vault = useVault((s) => s.vault);
  const updateSettings = useVault((s) => s.updateSettings);
  const meta = useSession((s) => s.meta);
  const profile = useSession((s) => s.activeProfile);
  const rekey = useSession((s) => s.rekey);
  const reEncrypt = useSession((s) => s.reEncrypt);
  const lock = useSession((s) => s.lock);
  const applySettings = useSession((s) => s.applySettings);
  const setOmnibox = useBrowser((s) => s.setOmnibox);

  const settings: Settings | null = vault?.settings ?? null;

  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [rekeyBusy, setRekeyBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!settings) return null;

  const patch = (p: Partial<Settings>) => {
    updateSettings(p);
    applySettings({ ...settings, ...p });
    if (p.locale) setLocale(p.locale);
    if (p.density) setDensity(p.density);
  };

  const doRekey = async () => {
    if (!vault) return;
    if (next !== again) {
      toast(t('onboarding.mismatch'), 'danger');
      return;
    }
    setRekeyBusy(true);
    const res = await rekey(cur, next, vault);
    setRekeyBusy(false);
    if (res.ok) {
      setRekeyOpen(false);
      setCur('');
      setNext('');
      setAgain('');
      toast(t('settings.rekeyDone'), 'success');
    } else {
      toast(res.error ?? t('errors.generic'), 'danger');
    }
  };

  const doExport = async () => {
    if (!vault) return;
    const ciphertext = await reEncrypt(vault);
    if (!ciphertext) {
      toast(t('errors.generic'), 'danger');
      return;
    }
    const payload = {
      kind: 'nimbus.vault',
      v: 1,
      exportedAt: Date.now(),
      profile: { label: profile?.label ?? vault.profile.label, hue: vault.profile.hue, providerId: profile?.providerId ?? 'local' },
      cipher: 'AES-GCM-256',
      kdf: profile?.kdf ?? null,
      vault: ciphertext,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nimbus-vault-${new Date().toISOString().slice(0, 10)}.nimbus`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t('settings.exportVault'), 'success');
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { vault?: string; revision?: number };
      if (!parsed.vault) throw new Error('bad file');
      await useVault.getState().hydrate({ vault: parsed.vault, revision: 0, checksum: '', sizeBytes: text.length });
      await useVault.getState().syncNow({ snapshot: true });
      toast(t('settings.importVault'), 'success');
    } catch {
      toast(t('errors.generic'), 'danger');
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-inner panel-narrow">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('settings.title')}</h1>
            <p className="panel-head__sub">{t('settings.subtitle')}</p>
          </div>
          <Badge tone="sage">
            <Lock size={11} /> {t('vault.encrypted')}
          </Badge>
        </div>

        {/* --- Appearance -------------------------------------------------- */}
        <section>
          <SectionTitle
            title={
              <Row gap={2}>
                <Palette size={13} /> {t('settings.appearance')}
              </Row>
            }
          />
          <Stack gap={3}>
            <Card>
              <Field label={t('settings.language')}>
                <Segmented
                  value={locale}
                  options={locales.map((l) => ({ value: l.id, label: `${l.flag} · ${l.label}` }))}
                  onChange={(v) => patch({ locale: v })}
                />
              </Field>
            </Card>
            <Card>
              <Field label={t('settings.density')}>
                <Segmented
                  value={density}
                  options={[
                    { value: 'cozy' as const, label: t('settings.densityCozy') },
                    { value: 'compact' as const, label: t('settings.densityCompact') },
                  ]}
                  onChange={(v) => patch({ density: v })}
                />
              </Field>
            </Card>
          </Stack>
        </section>

        {/* --- Browsing ---------------------------------------------------- */}
        <section>
          <SectionTitle
            title={
              <Row gap={2}>
                <Compass size={13} /> {t('settings.browsing')}
              </Row>
            }
          />
          <Stack gap={3}>
            <Card>
              <Stack gap={4}>
                <Field label={t('settings.searchEngine')} hint={t('browser.search', { engine: SEARCH_ENGINES[settings.searchEngine]?.label ?? settings.searchEngine })}>
                  <Select
                    value={settings.searchEngine}
                    options={Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ value: id, label: e.label }))}
                    onChange={(e) => patch({ searchEngine: e.target.value as Settings['searchEngine'] })}
                  />
                </Field>
                <Field label={t('settings.startPage')}>
                  <Segmented
                    value={settings.startPage}
                    options={[
                      { value: 'nimbus' as const, label: t('settings.startNimbus') },
                      { value: 'blank' as const, label: t('settings.startBlank') },
                      { value: 'last' as const, label: t('settings.startLast') },
                    ]}
                    onChange={(v) => patch({ startPage: v })}
                  />
                </Field>
                <Slider
                  label={t('settings.readerFontSize')}
                  min={15}
                  max={24}
                  step={1}
                  value={settings.readerFontSize}
                  display={`${settings.readerFontSize} px`}
                  onChange={(v) => patch({ readerFontSize: v })}
                />
                <Switch checked={settings.showFaviconFallback} onChange={(v) => patch({ showFaviconFallback: v })} title={t('settings.browsing')} sub={t('browser.localNone')} />
                <Switch checked={settings.confirmOnClose} onChange={(v) => patch({ confirmOnClose: v })} title={t('browser.closeTab')} sub={t('settings.browsing')} />
              </Stack>
            </Card>
            <Card>
              <Row gap={3} between>
                <Row gap={2}>
                  <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <span className="tiny">{t('browser.addressPlaceholder')}</span>
                </Row>
                <Button size="sm" variant="ghost" onClick={() => setOmnibox('nimbus://')}>
                  {t('nav.vault')}
                </Button>
              </Row>
            </Card>
          </Stack>
        </section>

        {/* --- Privacy shortcuts ------------------------------------------ */}
        <section>
          <SectionTitle
            title={
              <Row gap={2}>
                <ShieldCheck size={13} /> {t('nav.privacy')}
              </Row>
            }
          />
          <Stack gap={3}>
            <Switch checked={settings.blockTrackers} onChange={(v) => patch({ blockTrackers: v })} title={t('privacy.blockTrackers')} sub={t('privacy.blockTrackersSub')} />
            <Switch checked={settings.hideNuisance} onChange={(v) => patch({ hideNuisance: v })} title={t('privacy.hideNuisance')} sub={t('privacy.hideNuisanceSub')} />
            <Switch checked={settings.lockOnBlur} onChange={(v) => patch({ lockOnBlur: v })} title={t('privacy.lockOnBlur')} sub={t('privacy.autoLockSub')} />
            <Card>
              <Slider
                label={t('privacy.autoLock')}
                min={0}
                max={60}
                step={1}
                value={settings.autoLockMinutes}
                display={settings.autoLockMinutes === 0 ? t('privacy.off') : t('privacy.minutes', { n: settings.autoLockMinutes })}
                onChange={(v) => patch({ autoLockMinutes: v })}
              />
            </Card>
          </Stack>
        </section>

        {/* --- Danger zone ------------------------------------------------- */}
        <section>
          <SectionTitle
            title={
              <Row gap={2}>
                <KeyRound size={13} /> {t('settings.danger')}
              </Row>
            }
          />
          <Stack gap={3}>
            <Card>
              <Row gap={3} between wrap>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('settings.rekey')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('settings.rekeySub')}
                  </div>
                </div>
                <Button variant="quiet" onClick={() => setRekeyOpen(true)}>
                  <KeyRound size={14} /> {t('settings.rekey')}
                </Button>
              </Row>
            </Card>

            <Card>
              <Row gap={3} between wrap>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--mist-100)' }}>{t('settings.exportVault')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('settings.exportSub')}
                  </div>
                </div>
                <Row gap={2}>
                  <Button variant="ghost" onClick={() => void doExport()}>
                    <ArrowDownToLine size={14} /> {t('cloud.download')}
                  </Button>
                  <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                    <ArrowUpFromLine size={14} /> {t('settings.importVault')}
                  </Button>
                </Row>
              </Row>
              <input
                ref={fileRef}
                type="file"
                accept=".nimbus,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doImport(f);
                  e.target.value = '';
                }}
              />
            </Card>

            <Card style={{ borderColor: 'rgba(184,25,8,.32)' }}>
              <Row gap={3} between wrap>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ember-300)' }}>{t('settings.deleteProfile')}</div>
                  <div className="tiny" style={{ lineHeight: 1.55, marginTop: 3 }}>
                    {t('settings.deleteProfileSub')}
                  </div>
                </div>
                <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                  <Trash2 size={14} /> {t('common.delete')}
                </Button>
              </Row>
            </Card>
          </Stack>
        </section>

        {/* --- About ------------------------------------------------------- */}
        <section>
          <SectionTitle
            title={
              <Row gap={2}>
                <MonitorSmartphone size={13} /> {t('settings.about')}
              </Row>
            }
          />
          <Card flush>
            <table className="nb-table">
              <tbody>
                <tr>
                  <td>{t('settings.version')}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {meta?.app.version ?? '—'} <span className="tiny">{meta?.app.build}</span>
                  </td>
                </tr>
                <tr>
                  <td>{t('settings.engine')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Row gap={2} style={{ justifyContent: 'flex-end' }}>
                      <BookOpenText size={12} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="tiny">{meta?.engine.kind ?? 'cloud-render'}</span>
                    </Row>
                  </td>
                </tr>
                <tr>
                  <td>{t('settings.node')}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {meta?.runtime.node ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Row gap={2}>
                      <Gauge size={12} style={{ color: 'var(--text-tertiary)' }} /> {t('cloud.vaultSize')}
                    </Row>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {useVault.getState().sizeBytes} B
                  </td>
                </tr>
                <tr>
                  <td>{t('lock.kdf')}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {meta?.security.kdf ?? 'PBKDF2-SHA256'} · {profile?.kdf.iterations ?? 310000}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
          <div className="tiny" style={{ marginTop: 10, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            {t('app.name')} · {t('app.tagline')}
          </div>
        </section>
      </div>

      <Modal
        open={rekeyOpen}
        onClose={() => setRekeyOpen(false)}
        title={t('settings.rekey')}
        subtitle={t('settings.rekeySub')}
        width="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRekeyOpen(false)} disabled={rekeyBusy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={rekeyBusy} onClick={() => void doRekey()}>
              <KeyRound size={14} /> {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Field label={t('settings.currentPassword')}>
            <TextInput type="password" value={cur} autoFocus onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={t('settings.newPassword')}>
            <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          {next ? (
            <div className="tiny">
              {t('onboarding.strength')} · {t(`onboarding.strength${strengthLabel(next)}`)}
            </div>
          ) : null}
          <Field label={t('settings.confirmPassword')}>
            <TextInput type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </Field>
        </Stack>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title={t('settings.deleteProfile')}
        body={`${t('settings.deleteProfileSub')} ${t('settings.deleteConfirm')}`}
        danger
        requireText={t('settings.deleteWord')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleteOpen(false);
          if (!profile) return;
          try {
            await api.deleteProfile(profile.profileId);
            useVault.getState().reset();
            await lock('manual');
            await useSession.getState().refresh();
            toast(t('settings.deleteProfile'), 'success');
          } catch {
            toast(t('errors.generic'), 'danger');
          }
        }}
      />
    </div>
  );
};
