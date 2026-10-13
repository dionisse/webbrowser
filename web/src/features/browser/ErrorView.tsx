import { AlertTriangle, BookOpen, Compass, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, Row, Stack } from '../../design/components';
import { useUi } from '../../state/ui';

export interface ErrorInfo {
  url: string;
  kind?: string;
  status?: number | null;
  message?: string;
}

export const ErrorView = ({ error, onRetry, onReader, onDemo }: { error: ErrorInfo; onRetry: () => void; onReader: () => void; onDemo: () => void }) => {
  const t = useUi((s) => s.t);
  const blocked = error.kind === 'blocked';
  const Icon = blocked ? ShieldAlert : AlertTriangle;

  return (
    <div className="error-page">
      <div className="error-card">
        <div className="error-card__icon">
          <Icon size={21} />
        </div>
        <h2>{blocked ? 'Accès refusé' : t('browser.failedTitle')}</h2>
        <p>{blocked ? t('privacy.ssrfSub') : t('browser.failedBody')}</p>
        <code className="error-card__url">{error.url}</code>
        {error.message ? <p className="tiny">{error.message}</p> : null}
        <Row gap={2} wrap>
          <Button variant="primary" size="sm" onClick={onRetry}>
            <RefreshCw size={13} /> {t('browser.reload')}
          </Button>
          <Button variant="quiet" size="sm" onClick={onReader}>
            <BookOpen size={13} /> {t('browser.tryReader')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDemo}>
            <Compass size={13} /> {t('browser.tryDemo')}
          </Button>
        </Row>
        <Stack gap={2} style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border-subtle)' }}>
          <Row gap={2}>
            <span className="nb-dot nb-dot--live" />
            <span className="tiny">{t('browser.cloudEngine')}</span>
          </Row>
          <Row gap={2}>
            <span className="nb-dot" style={{ background: 'var(--sage-500)' }} />
            <span className="tiny">{t('browser.localNone')}</span>
          </Row>
        </Stack>
      </div>
    </div>
  );
};
