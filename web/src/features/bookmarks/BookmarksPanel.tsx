import { useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Folder, FolderOpen, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { Avatar, Badge, Button, Card, Chip, ConfirmDialog, EmptyState, IconButton, Row, Stack } from '../../design/components';
import { Field, TextInput } from '../../design/components/Fields';
import { Modal } from '../../design/components/Overlays';
import { hueFromString, hueSoft, shortHost } from '../../design/components/theme';
import { useBrowser } from '../../state/browser';
import { useUi } from '../../state/ui';
import { useVault, vaultSelectors } from '../../state/vault';
import { useNavigateTo } from '../browser/navigation';
import type { Bookmark as BookmarkType } from '../../lib/types';

const DEFAULT_FOLDER = 'Favoris';

export const BookmarksPanel = ({ compact }: { compact?: boolean }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const toast = useUi((s) => s.toast);
  const vault = useVault((s) => s.vault);
  const addBookmark = useVault((s) => s.addBookmark);
  const updateBookmark = useVault((s) => s.updateBookmark);
  const removeBookmark = useVault((s) => s.removeBookmark);
  const folders = vaultSelectors.folders(vault);
  const activeTab = useBrowser((s) => s.activeTab());
  const navigateTo = useNavigateTo();

  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookmarkType | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', url: '', folder: DEFAULT_FOLDER });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const items = useMemo(() => {
    const all = vault?.bookmarks ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((b) => (folder ? b.folder === folder : true))
      .filter((b) => (!q ? true : `${b.title} ${b.url} ${b.tags.join(' ')}`.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, locale));
  }, [vault?.bookmarks, query, folder, locale]);

  const openEditor = (item: BookmarkType | 'new') => {
    if (item === 'new') {
      const url = activeTab?.url ?? '';
      setForm({ title: activeTab?.title ?? url, url, folder: folder ?? DEFAULT_FOLDER });
    } else {
      setForm({ title: item.title, url: item.url, folder: item.folder || DEFAULT_FOLDER });
    }
    setEditing(item);
  };

  const save = () => {
    if (!form.url.trim()) return;
    if (editing && editing !== 'new') {
      updateBookmark(editing.id, { ...form });
      toast(t('bookmarks.saved'), 'success');
    } else {
      addBookmark({ ...form, hue: hueFromString(form.url) });
      toast(t('bookmarks.saved'), 'success');
    }
    setEditing(null);
  };

  if (compact) {
    return (
      <div className="side-compact">
        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
          </div>
          <IconButton label={t('bookmarks.add')} size="sm" onClick={() => openEditor('new')}>
            <Plus size={14} />
          </IconButton>
        </div>
        {folders.length > 1 ? (
          <div className="chip-row">
            <Chip as="button" on={folder === null} onClick={() => setFolder(null)}>
              {t('bookmarks.allFolders')}
            </Chip>
            {folders.map((f) => (
              <Chip key={f} as="button" on={folder === f} onClick={() => setFolder(f)}>
                {f}
              </Chip>
            ))}
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="tiny" style={{ padding: 16, color: 'var(--text-tertiary)' }}>
            {t('bookmarks.empty')}
          </div>
        ) : (
          <ul className="nb-list">
            {items.map((b) => (
              <li key={b.id}>
                <button className="nb-list-item" onClick={() => navigateTo(b.url)}>
                  <Avatar label={b.title.slice(0, 1).toUpperCase()} hue={b.hue} size={26} radius={9} />
                  <span className="nb-grow" style={{ minWidth: 0 }}>
                    <span className="nb-list-item__label truncate">{b.title || shortHost(b.url)}</span>
                    <span className="nb-list-item__sub truncate">{shortHost(b.url)}</span>
                  </span>
                  <IconButton
                    label={t('bookmarks.editBookmark')}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditor(b);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div className="nb-grow">
            <h1 className="panel-head__title">{t('bookmarks.title')}</h1>
            <p className="panel-head__sub">
              {t('bookmarks.subtitle')} · {t('bookmarks.count', { n: vault?.bookmarks.length ?? 0 })}
            </p>
          </div>
          <Button variant="primary" onClick={() => openEditor('new')}>
            <Plus size={14} /> {t('bookmarks.add')}
          </Button>
        </div>

        <div className="panel-toolbar">
          <div className="searchbar">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
          </div>
          {folders.length > 1 ? (
            <div className="chip-row">
              <Chip as="button" on={folder === null} onClick={() => setFolder(null)}>
                {t('bookmarks.allFolders')}
              </Chip>
              {folders.map((f) => (
                <Chip key={f} as="button" on={folder === f} onClick={() => setFolder(f)}>
                  <Folder size={11} /> {f}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        {items.length === 0 ? (
          <EmptyState icon={<Bookmark size={22} />} title={t('bookmarks.empty')} sub={t('bookmarks.emptySub')} />
        ) : (
          <div className="grid-cards">
            {items.map((b) => (
              <Card
                key={b.id}
                interactive
                onClick={() => navigateTo(b.url)}
                style={{ padding: 15, borderLeft: `3px solid ${hueSoft(b.hue, 0.9)}` }}
              >
                <Row gap={3} style={{ alignItems: 'flex-start' }}>
                  <Avatar label={b.title.slice(0, 1).toUpperCase() || 'N'} hue={b.hue} size={34} radius={11} />
                  <div className="nb-grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--mist-100)', fontSize: 'var(--fs-body)' }} className="truncate">
                      {b.title || shortHost(b.url)}
                    </div>
                    <div className="tiny truncate" style={{ marginTop: 2 }}>
                      {shortHost(b.url)}
                    </div>
                  </div>
                  <Stack gap={1}>
                    <IconButton
                      label={t('bookmarks.editBookmark')}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor(b);
                      }}
                    >
                      <Pencil size={12} />
                    </IconButton>
                    <IconButton
                      label={t('common.delete')}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmId(b.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </Stack>
                </Row>
                <Row gap={1} wrap style={{ marginTop: 12 }}>
                  <Badge>
                    <FolderOpen size={10} /> {b.folder || DEFAULT_FOLDER}
                  </Badge>
                  {b.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag}>
                      {tag}
                    </Badge>
                  ))}
                  <span className="nb-grow" />
                  <ExternalLink size={12} style={{ color: 'var(--text-tertiary)' }} />
                </Row>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('bookmarks.add') : t('bookmarks.editBookmark')}
        width="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={save}>
              <Star size={14} /> {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Field label={t('passwords.entryTitle')}>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Nimbus" />
          </Field>
          <Field label={t('passwords.url')}>
            <TextInput value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
          </Field>
          <Field label={t('bookmarks.folder')}>
            <TextInput value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} placeholder={DEFAULT_FOLDER} />
          </Field>
        </Stack>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmId)}
        title={t('bookmarks.deleteConfirm')}
        body={items.find((b) => b.id === confirmId)?.title ?? ''}
        danger
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) removeBookmark(confirmId);
          setConfirmId(null);
          toast(t('bookmarks.removed'), 'success');
        }}
      />
    </div>
  );
};
