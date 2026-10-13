import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { api, type ReaderArticle } from '../../lib/api';
import { Button, EmptyState, Row, Skeleton, Stack } from '../../design/components';
import { relativeTime } from '../../design/components/theme';
import { useUi } from '../../state/ui';
import { useVault } from '../../state/vault';

/**
 * Reader mode.
 *
 * The engine strips the page down to its typographic bones server-side; this
 * renders the result with Nimbus's own type scale, so reading is consistent no
 * matter how hostile the original layout was.
 */
export const ReaderView = ({ url, onOpenFull, fontSize }: { url: string; onOpenFull: () => void; fontSize: number }) => {
  const t = useUi((s) => s.t);
  const locale = useUi((s) => s.locale);
  const recordVisit = useVault((s) => s.recordVisit);
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    api
      .reader(url)
      .then((res) => {
        if (!alive) return;
        setArticle(res.reader);
        if (res.reader?.title) recordVisit(res.url || url, res.reader.title);
      })
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce]);

  if (busy) {
    return (
      <div className="reader">
        <Skeleton w="62%" h={34} r={10} />
        <div style={{ height: 16 }} />
        <Skeleton w="40%" h={13} />
        <div style={{ height: 28 }} />
        {[100, 96, 88, 99, 72].map((w, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <Skeleton w={`${w}%`} h={13} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="error-page">
        <EmptyState
          icon={<BookOpen size={22} />}
          title={t('browser.failedTitle')}
          sub={error ?? undefined}
          action={
            <Row gap={2}>
              <Button size="sm" variant="primary" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw size={13} /> {t('browser.reload')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onOpenFull}>
                {t('browser.readerOff')}
              </Button>
            </Row>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <article className="reader" style={{ ['--reader-size' as string]: `${fontSize}px` }}>
        <h1>{article.title}</h1>
        <div className="reader__meta">
          {article.siteName ? <span>{article.siteName}</span> : null}
          {article.byline ? <span>· {article.byline}</span> : null}
          {article.publishedAt ? <span>· {relativeTime(Date.parse(article.publishedAt) || Date.now(), locale)}</span> : null}
          <span>· {article.readingMinutes} min</span>
          <span>· {article.wordCount} {locale === 'fr' ? 'mots' : 'words'}</span>
        </div>

        {article.excerpt ? <p className="reader__lede">{article.excerpt}</p> : null}

        <Stack gap={0}>
          {article.blocks.map((block, i) => {
            switch (block.kind) {
              case 'h1':
                return <h2 key={i}>{block.text}</h2>;
              case 'h2':
                return <h2 key={i}>{block.text}</h2>;
              case 'h3':
                return <h3 key={i}>{block.text}</h3>;
              case 'quote':
                return <blockquote key={i}>{block.text}</blockquote>;
              case 'pre':
                return <pre key={i}>{block.text}</pre>;
              case 'li':
                return (
                  <ul key={i}>
                    <li>{block.text}</li>
                  </ul>
                );
              case 'img':
                return block.src ? (
                  // Images are pulled through the engine too, so the site never
                  // sees the reader's address.
                  <img key={i} src={`/api/browse/asset?u=${encodeURIComponent(block.src)}&k=raw`} alt={block.alt ?? ''} loading="lazy" />
                ) : null;
              default:
                return <p key={i}>{block.text}</p>;
            }
          })}
        </Stack>

        <Row gap={2} style={{ marginTop: 34, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
          <Button size="sm" variant="quiet" onClick={onOpenFull}>
            <ExternalLink size={13} /> {t('browser.readerOff')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={13} /> {t('browser.reload')}
          </Button>
        </Row>
      </article>
    </div>
  );
};
