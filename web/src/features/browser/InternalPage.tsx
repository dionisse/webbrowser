import { Compass } from 'lucide-react';
import { EmptyState } from '../../design/components';
import { useUi } from '../../state/ui';
import { BookmarksPanel } from '../bookmarks/BookmarksPanel';
import { CardsPanel } from '../cards/CardsPanel';
import { CloudPanel } from '../cloud/CloudPanel';
import { DownloadsPanel } from '../downloads/DownloadsPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { NotesPanel } from '../notes/NotesPanel';
import { PasswordsPanel } from '../passwords/PasswordsPanel';
import { PrivacyPanel } from '../privacy/PrivacyPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { StartPage } from './StartPage';

/**
 * Client-side router for `nimbus://` destinations. These pages are rendered by
 * the shell itself: no request ever leaves for them, and no byte touches disk.
 * Anything else under the scheme (`nimbus://news`, `nimbus://shop`…) is a demo
 * site served by the cloud engine, so it is *not* handled here.
 */
export const InternalPage = ({ id }: { id: string }) => {
  const t = useUi((s) => s.t);

  switch (id) {
    case 'start':
      return <StartPage />;
    case 'notes':
      return <NotesPanel />;
    case 'passwords':
      return <PasswordsPanel />;
    case 'cards':
      return <CardsPanel />;
    case 'cloud':
      return <CloudPanel />;
    case 'privacy':
      return <PrivacyPanel />;
    case 'settings':
      return <SettingsPanel />;
    case 'bookmarks':
      return <BookmarksPanel />;
    case 'history':
      return <HistoryPanel />;
    case 'downloads':
      return <DownloadsPanel />;
    default:
      return (
        <div className="panel-page">
          <EmptyState icon={<Compass size={22} />} title={`nimbus://${id}`} sub={t('browser.internalPage')} />
        </div>
      );
  }
};
