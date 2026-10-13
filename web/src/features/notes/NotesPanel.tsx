import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Pin, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Row, Stack } from '../../design/components';
import { hueSoft } from '../../design/components/theme';
import { relativeTime } from '../../design/components/theme';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';
import { newId } from '../../lib/crypto';
import type { Note } from '../../lib/types';

const NOTE_HUES = [12, 22, 34, 96, 152, 190, 214, 262];

export const NotesPanel = ({ compact }: { compact?: boolean }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const notes = useVault((s) => s.vault?.notes ?? []);
  const addNote = useVault((s) => s.addNote);
  const updateNote = useVault((s) => s.updateNote);
  const deleteNote = useVault((s) => s.deleteNote);
  const togglePin = useVault((s) => s.toggleNotePin);

  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? notes.filter((n) => `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(q))
      : notes;
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, query]);

  const selected = useMemo(() => notes.find((n) => n.id === selectedId) ?? filtered[0] ?? null, [notes, selectedId, filtered]);

  useEffect(() => {
    if (!selected && filtered[0]) setSelectedId(filtered[0].id);
  }, [selected, filtered]);

  const create = () => {
    const note = addNote({ title: '', body: '', hue: NOTE_HUES[notes.length % NOTE_HUES.length]! });
    setSelectedId(note.id);
    window.setTimeout(() => bodyRef.current?.focus(), 60);
  };

  const commitTag = (note: Note) => {
    const tag = tagDraft.trim().replace(/^#/, '');
    if (!tag) return;
    if (!note.tags.includes(tag)) updateNote(note.id, { tags: [...note.tags, tag] });
    setTagDraft('');
  };

  const pinned = filtered.filter((n) => n.pinned);
  const others = filtered.filter((n) => !n.pinned);

  const renderNoteCard = (note: Note) => (
    <button
      key={note.id}
      type="button"
      className="note-card"
      data-on={note.id === selected?.id}
      style={{ ['--note-hue' as string]: `hsl(${note.hue} 58% 52%)` }}
      onClick={() => setSelectedId(note.id)}
    >
      <Row gap={2}>
        <span className="note-card__title nb-grow">{note.title || t('notes.untitled')}</span>
        {note.pinned ? (
          <span style={{ color: `hsl(${note.hue} 58% 62%)`, display: 'inline-flex' }}>
            <Pin size={12} fill="currentColor" />
          </span>
        ) : null}
      </Row>
      <span className="note-card__excerpt clamp-2">{note.body || t('notes.emptyBody')}</span>
      <span className="note-card__meta">
        <span>{relativeTime(note.updatedAt, locale)}</span>
        {note.tags.slice(0, 2).map((tag) => (
          <span key={tag} style={{ color: `hsl(${note.hue} 46% 64%)` }}>
            #{tag}
          </span>
        ))}
        <span className="nb-grow" />
        <span>{note.body.length > 0 ? t('notes.characters', { n: note.body.length }) : ''}</span>
      </span>
    </button>
  );

  return (
    <div className="panel-page">
      <div className={`panel-inner${compact ? ' panel-narrow' : ''}`}>
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('notes.title')}</h1>
            <p className="panel-head__sub">
              {t('notes.subtitle')} · {t('notes.count', { n: notes.length })}
            </p>
          </div>
          <Button variant="primary" onClick={create}>
            <Plus size={15} /> {t('notes.new')}
          </Button>
        </div>

        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('notes.searchPlaceholder')} aria-label={t('notes.searchPlaceholder')} />
            {query ? (
              <IconButton label={t('common.close')} size="sm" onClick={() => setQuery('')}>
                <X size={13} />
              </IconButton>
            ) : null}
          </div>
          <span className="nb-grow" />
          <span className="tiny">{t('vault.encrypted')} · AES-GCM-256</span>
        </div>

        {notes.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileText size={22} />}
              title={t('common.empty')}
              sub={t('notes.subtitle')}
              action={
                <Button variant="primary" size="sm" onClick={create}>
                  <Plus size={14} /> {t('notes.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="notes-layout">
            <div className="notes-list">
              {pinned.length > 0 ? (
                <>
                  <span className="micro" style={{ padding: '4px 2px' }}>
                    {t('notes.pinned')}
                  </span>
                  {pinned.map(renderNoteCard)}
                </>
              ) : null}
              {pinned.length > 0 && others.length > 0 ? (
                <span className="micro" style={{ padding: '10px 2px 4px' }}>
                  {t('notes.others')}
                </span>
              ) : null}
              {others.map(renderNoteCard)}
            </div>

            {selected ? (
              <div className="note-editor anim-fade" key={selected.id}>
                <input
                  className="note-editor__title"
                  value={selected.title}
                  placeholder={t('notes.untitled')}
                  aria-label={t('notes.untitled')}
                  onChange={(e) => updateNote(selected.id, { title: e.target.value })}
                />
                <textarea
                  ref={bodyRef}
                  className="note-editor__body"
                  value={selected.body}
                  placeholder={t('notes.emptyBody')}
                  aria-label={t('notes.title')}
                  spellCheck
                  onChange={(e) => updateNote(selected.id, { body: e.target.value })}
                />

                <div className="note-editor__foot">
                  <Row gap={2} wrap>
                    {selected.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        #{tag}
                        <button
                          type="button"
                          aria-label={`${t('common.delete')} ${tag}`}
                          onClick={() => updateNote(selected.id, { tags: selected.tags.filter((x) => x !== tag) })}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <span className="tag-input">
                      <Plus size={11} />
                      <input
                        value={tagDraft}
                        placeholder={t('notes.addTag')}
                        aria-label={t('notes.addTag')}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitTag(selected);
                          }
                        }}
                        onBlur={() => commitTag(selected)}
                      />
                    </span>
                  </Row>

                  <span className="nb-grow" />

                  <Row gap={1}>
                    {NOTE_HUES.map((h) => (
                      <button
                        key={h}
                        type="button"
                        aria-label={`${t('notes.colorNote')} ${h}`}
                        onClick={() => updateNote(selected.id, { hue: h })}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 6,
                          background: hueSoft(h, 0.75),
                          border: selected.hue === h ? '2px solid var(--mist-200)' : '1px solid rgba(255,255,255,.14)',
                          transition: 'transform var(--t-fast) var(--ease)',
                        }}
                      />
                    ))}
                  </Row>

                  <IconButton label={selected.pinned ? t('notes.pinned') : t('start.pinned')} on={selected.pinned} onClick={() => togglePin(selected.id)}>
                    <Pin size={15} />
                  </IconButton>
                  <IconButton label={t('common.delete')} onClick={() => setConfirmDelete(selected.id)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>

                <Row gap={2} style={{ marginTop: -4 }}>
                  <span style={{ color: 'var(--sage-500)', display: 'inline-flex' }}>
                    <Sparkles size={12} />
                  </span>
                  <span className="tiny">
                    {t('notes.lastEdit', { when: relativeTime(selected.updatedAt, locale) })} · {t('notes.saved')}
                  </span>
                </Row>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t('notes.deleteConfirm')}
        danger
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteNote(confirmDelete);
            setSelectedId(null);
            toast(t('common.delete'), 'success');
          }
          setConfirmDelete(null);
        }}
      />
    </div>
  );
};

export const newNoteId = newId;
