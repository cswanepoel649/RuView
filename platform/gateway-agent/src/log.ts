/** Structured JSON-lines logger (journald/docker friendly). Never log secrets. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.RUVIEW_LOG_LEVEL as Level) || 'info';
let sink: (line: string) => void = (l) => process.stdout.write(l + '\n');

export function setLogSink(fn: (line: string) => void, level: Level = 'debug') {
  sink = fn;
  threshold = level;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[threshold]) return;
  sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
