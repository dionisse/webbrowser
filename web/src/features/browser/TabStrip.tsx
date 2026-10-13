import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Columns2,
  Copy,
  Layers,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  ShieldOff,
  X,
  XCircle,
} from 'lucide-react';
import { Button, Chip, IconButton } from '../../design/components';
import { Menu, Modal, type MenuItem } from '../../design/components/Overlays';
import { Field, TextInput } from '../../design/components/Fields';
import { hueFromString } from '../../design/components/theme';
import { START_URL, isInternalUrl, useBrowser, type BrowserTab } from '../../state/browser';
import { useUi } from '../../state/ui';
import { useTabGroups } from './tabGroups';

const glyphFor = (tab: BrowserTab): string => {
  if (tab.internal) return tab.internal.slice(0, 1).toUpperCase();
  const host = tab.url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return (host.slice(0, 1) || 'N').toUpperCase();
};

export const TabStrip = () => {
  const t = useUi((s) => s.t);
  const toast = useUi((s) => s.toast);
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const splitId = useBrowser((s) => s.splitId);
  const activate = useBrowser((s) => s.activate);
  const openTab = useBrowser((s) => s.openTab);
  const closeTab = useBrowser((s) => s.closeTab);
  const closeOthers = useBrowser((s) => s.closeOthers);
  const duplicate = useBrowser((s) => s.duplicate);
  const moveTab = useBrowser((s) => s.moveTab);
  const togglePin = useBrowser((s) => s.togglePin);
  const toggleReader = useBrowser((s) => s.toggleReader);
  const toggleSplit = useBrowser((s) => s.toggleSplit);
  const setSplit = useBrowser((s) => s.setSplit);
  const groups = useTabGroups();

  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [listAnchor, setListAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [groupTab, setGroupTab] = useState<BrowserTab | null>(null);
  const [groupName, setGroupName] = useState('');
  const dragIndex = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  /* Keep the active tab visible without fighting the user's own scrolling. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const node = el.querySelector<HTMLElement>(`[data-tab='${activeId ?? ''}']`);
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, tabs.length]);

  /* Only touch the vault when a group really lost a tab — otherwise every
     status change would mark the vault dirty and trigger a Drive write. */
  useEffect(() => {
    const live = new Set(tabs.map((x) => x.id));
    if (groups.groups.some((g) => g.tabIds.some((id) => !live.has(id)))) groups.prune([...live]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const tabMenuItems = (tab: BrowserTab): MenuItem[] => {
    const group = groups.groupById(tab.groupId);
    return [
      {
        id: 'pin',
        label: tab.pinned ? t('browser.unpin') : t('browser.pin'),
        icon: tab.pinned ? <PinOff size={13} /> : <Pin size={13} />,
        onSelect: () => togglePin(tab.id),
      },
      { id: 'duplicate', label: t('browser.duplicate'), icon: <Copy size={13} />, onSelect: () => duplicate(tab.id) },
      {
        id: 'reader',
        label: t('browser.reader'),
        icon: <BookOpen size={13} />,
        disabled: isInternalUrl(tab.url),
        onSelect: () => toggleReader(tab.id),
      },
      {
        id: 'split',
        label: t('shell.splitView'),
        icon: <Columns2 size={13} />,
        onSelect: () => (splitId === tab.id ? toggleSplit() : setSplit(tab.id)),
      },
      {
        id: 'group',
        label: group ? `${t('browser.removeFromGroup')} · ${group.name}` : t('browser.addToGroup'),
        icon: <Layers size={13} />,
        separatorBefore: true,
        onSelect: () => {
          if (group) groups.unassign(tab.id, group.id);
          else {
            setGroupTab(tab);
            setGroupName('');
          }
        },
      },
      ...(group
        ? groups.groups
            .filter((g) => g.id !== group.id)
            .map((g) => ({
              id: `to-${g.id}`,
              label: `${t('browser.addToGroup')} · ${g.name}`,
              icon: <span style={{ width: 8, height: 8, borderRadius: 3, background: `hsl(${g.hue} 60% 55%)`, display: 'inline-block' }} />,
              onSelect: () => groups.assign(g.id, tab.id),
            }))
        : groups.groups.map((g) => ({
            id: `to-${g.id}`,
            label: `${t('browser.addToGroup')} · ${g.name}`,
            icon: <span style={{ width: 8, height: 8, borderRadius: 3, background: `hsl(${g.hue} 60% 55%)`, display: 'inline-block' }} />,
            onSelect: () => groups.assign(g.id, tab.id),
          }))),
      {
        id: 'closeOthers',
        label: t('browser.closeOthers'),
        icon: <XCircle size={13} />,
        separatorBefore: true,
        onSelect: () => closeOthers(tab.id),
      },
      { id: 'close', label: t('browser.closeTab'), icon: <X size={13} />, danger: true, onSelect: () => closeTab(tab.id) },
    ];
  };

  const createGroup = () => {
    if (!groupTab) return;
    const g = groups.create(groupName || t('browser.newGroup'), [groupTab.id]);
    setGroupTab(null);
    toast(`${t('browser.newGroup')} · ${g.name}`, 'success');
  };

  return (
    <div className="tabstrip">
      <div className="tabstrip__scroll" ref={scroller}>
        {tabs.map((tab, index) => {
          const group = groups.groupById(tab.groupId);
          const showGroupLabel = Boolean(group) && tabs[index - 1]?.groupId !== tab.groupId;
          return (
            <div key={tab.id} style={{ display: 'contents' }}>
              {showGroupLabel && group ? (
                <span
                  className="tab-group-chip"
                  style={{ ['--group-hue' as string]: group.hue }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    groups.dissolve(group.id);
                  }}
                  title={group.name}
                >
                  {group.name}
                </span>
              ) : null}
              <div
                data-tab={tab.id}
                data-on={tab.id === activeId}
                className={`tab${tab.pinned ? ' tab--pinned' : ''}`}
                style={group ? { boxShadow: `inset 2px 0 0 hsl(${group.hue} 58% 52% / .8)` } : undefined}
                onClick={() => activate(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
                draggable={!tab.pinned}
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex.current !== null && dragIndex.current !== index) moveTab(dragIndex.current, index);
                  dragIndex.current = null;
                }}
                title={tab.title || tab.url}
              >
                {tab.status === 'loading' ? (
                  <span className="tab__spin" />
                ) : (
                  <span
                    className="tab__glyph"
                    style={{
                      background: tab.internal
                        ? 'linear-gradient(150deg, var(--ember-600), var(--clay-600))'
                        : `linear-gradient(150deg, hsl(${tab.faviconHue ?? hueFromString(tab.url)} 48% 42%), hsl(${tab.faviconHue ?? hueFromString(tab.url)} 30% 22%))`,
                    }}
                  >
                    {glyphFor(tab)}
                  </span>
                )}
                {!tab.pinned ? <span className="tab__title">{tab.title || tab.url}</span> : null}
                {!tab.pinned && tab.blockedCount > 0 ? (
                  <ShieldOff size={11} style={{ color: 'var(--sage-400)', flex: 'none' }} />
                ) : null}
                {!tab.pinned && tab.id === splitId ? <Columns2 size={11} style={{ color: 'var(--ember-400)', flex: 'none' }} /> : null}
                {!tab.pinned ? (
                  <button
                    type="button"
                    className="tab__close"
                    aria-label={t('browser.closeTab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X size={11} />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="tabstrip__actions">
        <IconButton label={t('browser.newTab')} size="sm" onClick={() => openTab(START_URL)}>
          <Plus size={15} />
        </IconButton>
        <IconButton label={t('shell.splitView')} size="sm" on={Boolean(splitId)} onClick={() => toggleSplit()}>
          <Columns2 size={14} />
        </IconButton>
        <IconButton
          label={t('browser.tabs', { n: tabs.length })}
          size="sm"
          on={listOpen}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setListAnchor({ x: r.right - 232, y: r.bottom + 8 });
            setListOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      </div>

      {menu ? (
        <Menu
          items={tabMenuItems(tabs.find((x) => x.id === menu.tabId) ?? tabs[0]!)}
          onClose={() => setMenu(null)}
          style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 320) }}
        />
      ) : null}

      {listOpen ? (
        <Menu
          items={[
            ...tabs.map((tab) => ({
              id: `t-${tab.id}`,
              label: (
                <span className="truncate" style={{ maxWidth: 200 }}>
                  {tab.title || tab.url}
                </span>
              ),
              icon: <span className="tab__glyph" style={{ background: `hsl(${hueFromString(tab.url)} 42% 38%)` }}>{glyphFor(tab)}</span>,
              onSelect: () => activate(tab.id),
            })),
            { id: 'new', label: t('browser.newTab'), icon: <Plus size={13} />, separatorBefore: true, onSelect: () => openTab(START_URL) },
            {
              id: 'group',
              label: t('browser.newGroup'),
              icon: <Layers size={13} />,
              onSelect: () => {
                const active = tabs.find((x) => x.id === activeId);
                if (active) {
                  setGroupTab(active);
                  setGroupName('');
                }
              },
            },
            {
              id: 'closeAll',
              label: t('browser.closeAll'),
              icon: <XCircle size={13} />,
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                for (const tab of tabs.filter((x) => !x.pinned)) closeTab(tab.id);
              },
            },
          ]}
          onClose={() => setListOpen(false)}
          style={{ position: 'fixed', left: listAnchor.x, top: listAnchor.y, width: 232 }}
        />
      ) : null}

      <Modal
        open={Boolean(groupTab)}
        onClose={() => setGroupTab(null)}
        title={t('browser.newGroup')}
        subtitle={t('browser.tabGroups')}
        width="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupTab(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={createGroup}>
              <Layers size={14} /> {t('common.create')}
            </Button>
          </>
        }
      >
        <Field label={t('browser.groupName')}>
          <TextInput
            autoFocus
            value={groupName}
            placeholder={t('browser.newGroup')}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createGroup();
            }}
          />
        </Field>
        {groups.groups.length > 0 ? (
          <>
            <div className="micro" style={{ marginTop: 16, marginBottom: 6 }}>
              {t('browser.addToGroup')}
            </div>
            <div className="chip-row">
              {groups.groups.map((g) => (
                <Chip
                  key={g.id}
                  as="button"
                  onClick={() => {
                    if (groupTab) groups.assign(g.id, groupTab.id);
                    setGroupTab(null);
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: `hsl(${g.hue} 60% 55%)` }} /> {g.name}
                </Chip>
              ))}
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
};
