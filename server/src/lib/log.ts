type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.NIMBUS_LOG_LEVEL as Level) ?? 'info'] ?? 20;

const stamp = () => new Date().toISOString().slice(11, 23);

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  if (order[level] < threshold) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra);
  else fn(line);
}

export const createLogger = (scope: string) => ({
  debug: (m: string, e?: unknown) => emit('debug', scope, m, e),
  info: (m: string, e?: unknown) => emit('info', scope, m, e),
  warn: (m: string, e?: unknown) => emit('warn', scope, m, e),
  error: (m: string, e?: unknown) => emit('error', scope, m, e),
});

export type Logger = ReturnType<typeof createLogger>;
