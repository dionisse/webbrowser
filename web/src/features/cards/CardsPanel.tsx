import { useMemo, useState } from 'react';
import { Check, Copy, CreditCard, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Modal, Row, Stack } from '../../design/components';
import { Field, Select, Switch, TextInput } from '../../design/components/Fields';
import { brandHues, relativeTime } from '../../design/components/theme';
import { cardBrand, digitsOnly, formatCard, luhnValid, maskCard } from '../../lib/crypto';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import type { CardBrand, CardEntry } from '../../lib/types';

const BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'VISA',
  mastercard: 'Mastercard',
  amex: 'AMEX',
  discover: 'DISCOVER',
  cb: 'CB',
  other: 'CARTE',
};

const YEARS = Array.from({ length: 14 }, (_, i) => String(new Date().getFullYear() + i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

const blankDraft = (): Partial<CardEntry> => ({
  label: '',
  holder: '',
  number: '',
  expMonth: new Date().getMonth() + 1,
  expYear: new Date().getFullYear() + 2,
  cvc: '',
  billingAddress: '',
  notes: '',
  favorite: false,
});

export const CardsPanel = () => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const cards = useVault((s) => s.vault?.cards ?? []);
  const addCard = useVault((s) => s.addCard);
  const updateCard = useVault((s) => s.updateCard);
  const deleteCard = useVault((s) => s.deleteCard);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: Partial<CardEntry> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? cards.filter((c) => `${c.label} ${c.holder} ${c.number} ${c.notes}`.toLowerCase().includes(q)) : cards;
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }, [cards, query]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(label, 'success', { ttl: 2200 });
    } catch {
      toast(t('errors.generic'), 'danger');
    }
  };

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    const number = digitsOnly(d.number ?? '');
    if (number.length < 12) {
      toast(t('cards.invalid'), 'danger');
      return;
    }
    const payload: Partial<CardEntry> = {
      ...d,
      number,
      brand: cardBrand(number),
      label: d.label?.trim() || BRAND_LABEL[cardBrand(number)],
    };
    if (editing.id) updateCard(editing.id, payload);
    else addCard(payload);
    toast(t('cards.saved'), 'success');
    setEditing(null);
  };

  const draftBrand = editing ? cardBrand(digitsOnly(editing.draft.number ?? '')) : 'other';
  const draftValid = editing ? luhnValid(digitsOnly(editing.draft.number ?? '')) : false;

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('cards.title')}</h1>
            <p className="panel-head__sub">
              {t('cards.subtitle')} · {t('cards.count', { n: cards.length })}
            </p>
          </div>
          <Button variant="primary" onClick={() => setEditing({ id: null, draft: blankDraft() })}>
            <Plus size={15} /> {t('cards.new')}
          </Button>
        </div>

        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('cards.searchPlaceholder')} aria-label={t('cards.searchPlaceholder')} />
            {query ? (
              <IconButton label={t('common.close')} size="sm" onClick={() => setQuery('')}>
                <X size={13} />
              </IconButton>
            ) : null}
          </div>
          <span className="nb-grow" />
          <span className="tiny">{t('vault.encrypted')} · {t('cloud.path')} /Nimbus/vault.enc</span>
        </div>

        {cards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CreditCard size={22} />}
              title={t('common.empty')}
              sub={t('cards.subtitle')}
              action={
                <Button variant="primary" size="sm" onClick={() => setEditing({ id: null, draft: blankDraft() })}>
                  <Plus size={14} /> {t('cards.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="cc-grid">
            {filtered.map((card) => {
              const hue = brandHues[card.brand] ?? 18;
              const isRevealed = revealed.has(card.id);
              return (
                <div key={card.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <button
                    type="button"
                    className="cc-visual"
                    style={{ ['--cc-hue' as string]: String(hue) }}
                    onClick={() => setEditing({ id: card.id, draft: { ...card } })}
                    aria-label={`${t('common.edit')} ${card.label}`}
                  >
                    <span className="cc-visual__grain" aria-hidden />
                    <span className="cc-visual__top">
                      <span className="cc-chip" aria-hidden />
                      <span className="nb-grow" />
                      <span className="cc-brand">{BRAND_LABEL[card.brand] ?? BRAND_LABEL.other}</span>
                    </span>
                    {card.favorite ? (
                      <span className="cc-flag">
                        <Star size={14} fill="rgba(255,255,255,.85)" color="rgba(255,255,255,.85)" />
                      </span>
                    ) : null}
                    <span className="cc-number">{isRevealed ? formatCard(card.number) : maskCard(card.number)}</span>
                    <span className="cc-visual__bottom">
                      <span className="cc-field nb-grow">
                        <span className="cc-field__label">{t('cards.holder')}</span>
                        <span className="cc-field__value">{card.holder || '—'}</span>
                      </span>
                      <span className="cc-field">
                        <span className="cc-field__label">{t('cards.expiry')}</span>
                        <span className="cc-field__value">
                          {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                        </span>
                      </span>
                      <span className="cc-field">
                        <span className="cc-field__label">{t('cards.cvc')}</span>
                        <span className="cc-field__value">{isRevealed ? card.cvc : '•••'}</span>
                      </span>
                    </span>
                  </button>

                  <Row gap={2} wrap>
                    <span className="tiny nb-grow truncate">{card.label || BRAND_LABEL[card.brand]}</span>
                    <IconButton
                      label={isRevealed ? t('common.hide') : t('common.reveal')}
                      size="sm"
                      on={isRevealed}
                      onClick={() =>
                        setRevealed((prev) => {
                          const next = new Set(prev);
                          if (next.has(card.id)) next.delete(card.id);
                          else next.add(card.id);
                          return next;
                        })
                      }
                    >
                      <Check size={13} />
                    </IconButton>
                    <IconButton label={t('cards.copyNumber')} size="sm" onClick={() => void copy(card.number, t('cards.copyNumber'))}>
                      <Copy size={13} />
                    </IconButton>
                    <IconButton label={t('cards.copyCvc')} size="sm" onClick={() => void copy(card.cvc, t('cards.copyCvc'))}>
                      <span className="mono" style={{ fontSize: 9, fontWeight: 700 }}>
                        CVC
                      </span>
                    </IconButton>
                    <IconButton label={t('common.delete')} size="sm" onClick={() => setConfirmDelete(card.id)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </Row>
                  <span className="tiny" style={{ marginTop: -4 }}>
                    {relativeTime(card.updatedAt, locale)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('common.edit') : t('cards.new')}
        subtitle={t('cards.subtitle')}
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
            <Button variant="primary" onClick={save}>
              <Check size={14} /> {t('common.save')}
            </Button>
          </>
        }
      >
        {editing ? (
          <Stack gap={4}>
            {/* Live preview */}
            <div className="cc-visual" style={{ ['--cc-hue' as string]: String(brandHues[draftBrand] ?? 18), cursor: 'default', aspectRatio: '1.72' }}>
              <span className="cc-visual__grain" aria-hidden />
              <span className="cc-visual__top">
                <span className="cc-chip" aria-hidden />
                <span className="nb-grow" />
                <span className="cc-brand">{BRAND_LABEL[draftBrand]}</span>
              </span>
              <span className="cc-number">{editing.draft.number ? formatCard(editing.draft.number) : '•••• •••• •••• ••••'}</span>
              <span className="cc-visual__bottom">
                <span className="cc-field nb-grow">
                  <span className="cc-field__label">{t('cards.holder')}</span>
                  <span className="cc-field__value">{editing.draft.holder || '—'}</span>
                </span>
                <span className="cc-field">
                  <span className="cc-field__label">{t('cards.expiry')}</span>
                  <span className="cc-field__value">
                    {String(editing.draft.expMonth ?? 1).padStart(2, '0')}/{String(editing.draft.expYear ?? 0).slice(-2)}
                  </span>
                </span>
              </span>
            </div>

            {editing.draft.number && digitsOnly(editing.draft.number).length >= 12 ? (
              <Row gap={2}>
                <span className={`nb-badge ${draftValid ? 'nb-badge--sage' : 'nb-badge--ember'}`}>
                  {draftValid ? <Check size={11} /> : <X size={11} />} Luhn
                </span>
                <span className="tiny">{t('cards.detected', { brand: BRAND_LABEL[draftBrand] })}</span>
              </Row>
            ) : null}

            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <TextInput
                label={t('cards.label')}
                value={editing.draft.label ?? ''}
                autoFocus
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, label: e.target.value } })}
              />
              <TextInput
                label={t('cards.holder')}
                value={editing.draft.holder ?? ''}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, holder: e.target.value } })}
              />
            </div>

            <TextInput
              label={t('cards.number')}
              mono
              inputMode="numeric"
              value={editing.draft.number ? formatCard(editing.draft.number) : ''}
              placeholder="4242 4242 4242 4242"
              error={editing.draft.number && digitsOnly(editing.draft.number).length >= 12 && !draftValid ? t('cards.invalid') : undefined}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, number: digitsOnly(e.target.value).slice(0, 19) } })}
            />

            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
              <Field label={t('cards.month')}>
                <Select
                  options={MONTHS.map((m) => ({ value: m, label: m }))}
                  value={String(editing.draft.expMonth ?? 1).padStart(2, '0')}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, expMonth: Number(e.target.value) } })}
                />
              </Field>
              <Field label={t('cards.year')}>
                <Select
                  options={YEARS.map((y) => ({ value: y, label: y }))}
                  value={String(editing.draft.expYear ?? new Date().getFullYear())}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, expYear: Number(e.target.value) } })}
                />
              </Field>
              <TextInput
                label={t('cards.cvc')}
                mono
                inputMode="numeric"
                maxLength={4}
                value={editing.draft.cvc ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, cvc: digitsOnly(e.target.value).slice(0, 4) } })}
              />
            </div>

            <TextInput
              label={t('cards.billing')}
              hint={t('common.optional')}
              value={editing.draft.billingAddress ?? ''}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, billingAddress: e.target.value } })}
            />
            <Field label={t('cards.notesField')}>
              <textarea
                className="nb-textarea"
                rows={2}
                value={editing.draft.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })}
              />
            </Field>
            <Switch
              checked={Boolean(editing.draft.favorite)}
              onChange={(favorite) => setEditing({ ...editing, draft: { ...editing.draft, favorite } })}
              title={t('cards.favorite')}
            />
          </Stack>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t('cards.deleteConfirm')}
        danger
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deleteCard(confirmDelete);
          setConfirmDelete(null);
          setEditing(null);
        }}
      />
    </div>
  );
};
