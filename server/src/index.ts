import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import { createLogger } from './lib/log.js';
import { HttpError } from './lib/http.js';
import { sessionMiddleware } from './session/middleware.js';
import { startSessionSweeper } from './session/store.js';
import { metaRouter } from './routes/meta.js';
import { profilesRouter } from './routes/profiles.js';
import { vaultRouter } from './routes/vault.js';
import { cloudRouter } from './routes/cloud.js';
import { browseRouter } from './routes/browse.js';

const log = createLogger('server');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// The vault is a single encrypted blob; allow generous payloads so large
// histories and note attachments fit without chunking.
app.use(express.json({ limit: '48mb' }));
app.use('/api/browse/view', express.urlencoded({ extended: false, limit: '4mb' }));
app.use(cookieParser());

// Security headers for the API surface. Note the deliberate absence of
// `frame-ancestors` on /api/browse/* — those documents are framed by our own
// shell, and are sandboxed without `allow-same-origin`.
app.use((req, res, next) => {
  const isBrowse = req.path.startsWith('/api/browse');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!isBrowse) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  next();
});

app.use(sessionMiddleware);

app.use('/api/meta', metaRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/browse', browseRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Route API inconnue.' } }));

// Serve the built shell when present (production single-process mode).
const webDist = resolve(config.dataDir, '../../web/dist');
if (existsSync(join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
  log.info(`serving built shell from ${webDist}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ ok: false, error: { code: 'bad_json', message: 'Corps de requête JSON invalide.' } });
    return;
  }
  if (err instanceof Error && err.name === 'ZodError') {
    res.status(400).json({ ok: false, error: { code: 'validation', message: 'Données invalides.', details: err.message } });
    return;
  }
  const e = err as Error;
  log.error(`unhandled: ${e?.message ?? String(err)}`);
  res.status(500).json({ ok: false, error: { code: 'internal', message: e?.message ?? 'Erreur interne.' } });
});

const server = app.listen(config.port, config.host, () => {
  log.info(`Nimbus engine listening on http://${config.host}:${config.port}`);
  log.info(`zero-knowledge vault · ${config.providers ? 'cloud providers ready' : ''}`);
  if (config.serverKeyIsEphemeral) {
    log.warn('NIMBUS_SERVER_KEY absent → clé serveur éphémère : les connexions Drive ne survivent pas au redémarrage.');
  }
  startSessionSweeper();
});

const shutdown = (signal: string) => {
  log.info(`${signal} received — wiping ephemeral state`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
