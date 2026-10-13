import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Plus, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Modal, Row, Stack } from '../../design/components';
import { Field, PasswordInput, Slider, Switch, TextInput } from '../../design/components/Fields';
import { hueFromString, relativeTime } from '../../design/components/theme';
import { DEFAULT_GENERATOR, generatePassword, passwordStrength, totpCode, type GeneratorOptions } from '../../lib/crypto';
import { useUi } from '../../state/ui';
import { useVault, vaultSelectors } from '../../state/vault';
import { useNavigateTo } from '../browser/navigation';
import type { PasswordEntry } from '../../lib/types';

const blank = (): Partial<PasswordEntry> => ({
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  tags: [],
  favorite: false,
});

const strengthColor = (score: number) => (score <= 1 ? 'var(--ember-500)' : score === 2 ? 'var(--warn)' : 'var(--sage-500)');

export const PasswordsPanel = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const vault = useVault((s) => s.vault);
  const entries = useVault((s) => s.vault?.passwords ?? []);
  const addPassword = useVault((s) => s.addPassword);
  const updatePassword = useVault((s) => s.updatePassword);
  const deletePassword = useVault((s) => s.deletePassword);
  const markUsed = useVault((s) => s.markPasswordUsed);
  const navigate = useNavigateTo();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: Partial<PasswordEntry> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [gen, setGen] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const [tots, setTots] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter((e) => `${e.title} ${e.username} ${e.url} ${e.tags.join(' ')}`.toLowerCase().includes(q)) : entries;
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }, [entries, query]);

  const health = useMemo(
    () => ({
      weak: vaultSelectors.weakPasswords(vault),
      reused: vaultSelectors.reusedPasswords(vault),
      stale: vaultSelectors.stalePasswords(vault),
    }),
    [vault],
  );

  // Live TOTP for entries that carry a 2FA secret.
  useEffect(() => {
    const secrets = entries.filter((e) => e.totp && e.totp.length > 8);
    if (secrets.length === 0) return;
    let alive = true;
    const tick = async () => {
      const next: Record<string, string> = {};
      for (const e of secrets) {
        try {
          next[e.id] = await totpCode(e.totp!);
        } catch {
          next[e.id] = '';
        }
      }
      if (alive) setTots(next);
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [entries]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(label, 'success', { detail: t('passwords.copiedPassword'), ttl: 2600 });
    } catch {
      toast(label, 'danger', { detail: t('errors.generic') });
    }
  };

  const openNew = () => setEditing({ id: null, draft: { ...blank(), password: generatePassword(gen) } });
  const openEdit = (entry: PasswordEntry) => setEditing({ id: entry.id, draft: { ...entry } });

  const save = () => {
    if (!editing) return;
    const draft = editing.draft;
    if (!draft.title?.trim() && !draft.url?.trim()) return;
    const title = draft.title?.trim() || hostFromUrl(draft.url ?? '') || t('notes.untitled');
    if (editing.id) {
      updatePassword(editing.id, { ...draft, title });
    } else {
      addPassword({ ...draft, title });
    }
    toast(t('passwords.saved'), 'success');
    setEditing(null);
  };

  const strength = editing?.draft.password ? passwordStrength(editing.draft.password) : null;

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('passwords.title')}</h1>
            <p className="panel-head__sub">
              {t('passwords.subtitle')} · {t('passwords.count', { n: entries.length })}
            </p>
          </div>
          <Button variant="primary" onClick={openNew}>
            <Plus size={15} /> {t('passwords.new')}
          </Button>
        </div>

        <div className="grid-stats">
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value">{entries.length}</div>
            <div className="stat-card__label">{t('passwords.count', { n: entries.length })}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value" style={{ color: health.weak ? 'var(--ember-400)' : 'var(--sage-400)' }}>
              {health.weak}
            </div>
            <div className="stat-card__label">{t('passwords.weak', { n: health.weak })}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value" style={{ color: health.reused ? 'var(--warn-text)' : 'var(--sage-400)' }}>
              {health.reused}
            </div>
            <div className="stat-card__label">{t('passwords.reused', { n: health.reused })}</div>
          </Card>
          <Card className="stat-card" style={{ padding: '16px 18px' }}>
            <div className="stat-card__value" style={{ color: health.stale ? 'var(--warn-text)' : 'var(--sage-400)' }}>
              {health.stale}
            </div>
            <div className="stat-card__label">{t('passwords.old', { n: health.stale })}</div>
          </Card>
        </div>

        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('passwords.searchPlaceholder')} aria-label={t('passwords.searchPlaceholder')} />
            {query ? (
              <IconButton label={t('common.close')} size="sm" onClick={() => setQuery('')}>
                <X size={13} />
              </IconButton>
            ) : null}
          </div>
          <span className="nb-grow" />
          <span className="tiny">{t('passwords.health')}</span>
        </div>

        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<KeyRound size={22} />}
              title={t('common.empty')}
              sub={t('passwords.subtitle')}
              action={
                <Button variant="primary" size="sm" onClick={openNew}>
                  <Plus size={14} /> {t('passwords.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="pw-grid">
            {filtered.map((entry) => {
              const hue = hueFromString(entry.url || entry.title);
              const s = passwordStrength(entry.password);
              const isRevealed = revealed.has(entry.id);
              return (
                <div
                  key={entry.id}
                  className="pw-item"
                  role="button"
                  tabIndex={0}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 11 }}
                  onClick={() => openEdit(entry)}
                  onKeyDown={(e) => e.key === 'Enter' && openEdit(entry)}
                >
                  <Row gap={3}>
                    <span className="pw-item__logo" style={{ background: `linear-gradient(150deg, hsl(${hue} 44% 34%), hsl(${hue} 50% 19%))` }}>
                      {(entry.title || entry.url || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div className="nb-grow" style={{ minWidth: 0 }}>
                      <Row gap={2}>
                        <span className="pw-item__title nb-grow">{entry.title}</span>
                        {entry.favorite ? <Star size={12} fill="var(--warn)" color="var(--warn)" /> : null}
                      </Row>
                      <div className="pw-item__sub">{entry.username || '—'}</div>
                      <div className="pw-item__strength">
                        <span style={{ width: `${(s.score + 1) * 20}%`, background: strengthColor(s.score) }} />
                      </div>
                    </div>
                    <Row gap={1}>
                      {entry.totp && tots[entry.id] ? (
                        <button
                          type="button"
                          className="nb-chip nb-chip--sage"
                          title={t('passwords.totp')}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copy(tots[entry.id]!, t('passwords.totp'));
                          }}
                        >
                          {tots[entry.id]}
                        </button>
                      ) : null}
                      <IconButton
                        label={isRevealed ? t('common.hide') : t('common.reveal')}
                        size="sm"
                        on={isRevealed}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRevealed((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          });
                        }}
                      >
                        <KeyRound size={13} />
                      </IconButton>
                      <IconButton
                        label={t('common.copy')}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copy(entry.password, t('passwords.password'));
                        }}
                      >
                        <Copy size={13} />
                      </IconButton>
                    </Row>
                  </Row>

                  {isRevealed ? (
                    <div className="secret-row" onClick={(e) => e.stopPropagation()}>
                      <span className="secret-row__value">{entry.password}</span>
                      <IconButton label={t('common.copy')} size="sm" onClick={() => void copy(entry.password, t('passwords.password'))}>
                        <Copy size={13} />
                      </IconButton>
                    </div>
                  ) : null}

                  <Row gap={2}>
                    <span className="tiny">{relativeTime(entry.updatedAt, locale)}</span>
                    {entry.lastUsedAt ? (
                      <span className="tiny">· {t('passwords.lastUsed', { when: relativeTime(entry.lastUsedAt, locale) })}</span>
                    ) : (
                      <span className="tiny">· {t('passwords.neverUsed')}</span>
                    )}
                    <span className="nb-grow" />
                    <span className="tiny" style={{ color: strengthColor(s.score), fontWeight: 600 }}>
                      {s.entropyBits} bits
                    </span>
                  </Row>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('common.edit') : t('passwords.new')}
        subtitle={t('passwords.subtitle')}
        width="normal"
        footer={
          <>
            {editing?.id ? (
              <Button variant="danger" onClick={() => setConfirmDelete(editing.id)}>
                <Trash2 size={14} /> {t('common.delete')}
              </Button>
            ) : null}
            <span className="nb-grow" />
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={save} disabled={!editing?.draft.password && !editing?.draft.title}>
              <Check size={14} /> {t('common.save')}
            </Button>
          </>
        }
      >
        {editing ? (
          <Stack gap={4}>
            <TextInput
              label={t('passwords.entryTitle')}
              value={editing.draft.title ?? ''}
              autoFocus
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
            />
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <TextInput
                label={t('passwords.username')}
                value={editing.draft.username ?? ''}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, username: e.target.value } })}
              />
              <TextInput
                label={t('passwords.url')}
                hint={t('passwords.urlHint')}
                value={editing.draft.url ?? ''}
                placeholder="https://exemple.fr"
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, url: e.target.value } })}
              />
            </div>

            <PasswordInput
              label={t('passwords.password')}
              value={editing.draft.password ?? ''}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, password: e.target.value } })}
              onGenerate={() => setEditing({ ...editing, draft: { ...editing.draft, password: generatePassword(gen) } })}
              generateLabel={t('passwords.regenerate')}
            />
            {strength ? (
              <Row gap={3}>
                <div className="strength nb-grow">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="strength__seg" style={{ background: i <= strength.score ? strengthColor(strength.score) : undefined }} />
                  ))}
                </div>
                <span className="tiny" style={{ color: strengthColor(strength.score), fontWeight: 600 }}>
                  {strength.entropyBits} bits
                </span>
              </Row>
            ) : null}

            <Card style={{ padding: 15 }}>
              <Row gap={2} style={{ marginBottom: 12 }}>
                <RefreshCw size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span className="micro">{t('passwords.generator')}</span>
              </Row>
              <Slider
                label={t('passwords.genLength')}
                min={12}
                max={48}
                value={gen.length}
                onChange={(length) => setGen({ ...gen, length })}
                display={gen.length}
              />
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', marginTop: 12 }}>
                <Switch checked={gen.upper} onChange={(upper) => setGen({ ...gen, upper })} title={t('passwords.genUpper')} />
                <Switch checked={gen.lower} onChange={(lower) => setGen({ ...gen, lower })} title={t('passwords.genLower')} />
                <Switch checked={gen.numbers} onChange={(numbers) => setGen({ ...gen, numbers })} title={t('passwords.genNumbers')} />
                <Switch checked={gen.symbols} onChange={(symbols) => setGen({ ...gen, symbols })} title={t('passwords.genSymbols')} />
                <Switch checked={gen.avoidAmbiguous} onChange={(avoidAmbiguous) => setGen({ ...gen, avoidAmbiguous })} title={t('passwords.genAmbiguous')} />
              </div>
            </Card>

            <Field label={t('passwords.totp')} hint={t('common.optional')}>
              <TextInput
                value={editing.draft.totp ?? ''}
                placeholder="JBSWY3DPEHPK3PXP"
                mono
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, totp: e.target.value } })}
              />
            </Field>

            <Field label={t('passwords.notesField')}>
              <textarea
                className="nb-textarea"
                rows={3}
                value={editing.draft.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })}
              />
            </Field>

            <Row gap={3} wrap>
              <Switch
                checked={Boolean(editing.draft.favorite)}
                onChange={(favorite) => setEditing({ ...editing, draft: { ...editing.draft, favorite } })}
                title={t('passwords.favorite')}
              />
              <span className="nb-grow" />
              {editing.draft.url ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    const url = normaliseUrl(editing.draft.url!);
                    setEditing(null);
                    navigate(url);
                    if (editing.id) markUsed(editing.id);
                  }}
                >
                  <ExternalLink size={13} /> {t('passwords.openSite')}
                </Button>
              ) : null}
            </Row>
          </Stack>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t('passwords.deleteConfirm')}
        danger
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deletePassword(confirmDelete);
          setConfirmDelete(null);
          setEditing(null);
        }}
      />
    </div>
  );
};

const hostFromUrl = (url: string): string => {
  try {
    return new URL(normaliseUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export const normaliseUrl = (url: string): string => (/^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`);
