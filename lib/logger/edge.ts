/**
 * Structured logging for the Edge Runtime.
 *
 * WHY PINO IS NOT USED HERE
 *
 * The platform's logging standard is Pino via `createLogger`, and `console.*`
 * is not an accepted path anywhere in `lib/`, `app/` or `components/`. Next.js
 * middleware, however, runs in the Edge Runtime, which has no `process.stdout`,
 * no worker threads and no Node stream APIs — Pino cannot initialise there, so
 * importing `createLogger` into `middleware.ts` breaks the build rather than
 * producing logs.
 *
 * So middleware got a pass and accumulated a dozen emoji-prefixed
 * `console.log`s: unparseable, unfilterable, unleveled, and impossible to
 * correlate with the request they belong to. On the one component that sees
 * *every* request.
 *
 * This is the smallest thing that closes that gap. `console` is the only sink
 * the Edge Runtime offers, so it is still what writes — but the LINE is a Pino
 * record: same keys, same numeric levels, same ISO timestamp. A log aggregator
 * cannot tell these apart from the rest of the platform's output, which is the
 * property that actually matters.
 *
 * Use this ONLY in Edge Runtime code (middleware). Everything else uses
 * `@/lib/logger`.
 *
 * @module lib/logger/edge
 */

/** Pino's numeric levels, so the two sources sort and filter together. */
const LEVELS = { debug: 20, info: 30, warn: 40, error: 50 } as const;

type Level = keyof typeof LEVELS;

type Bindings = Record<string, unknown>;

export interface EdgeLogger {
  debug(context: Bindings, message: string): void;
  debug(message: string): void;
  info(context: Bindings, message: string): void;
  info(message: string): void;
  warn(context: Bindings, message: string): void;
  warn(message: string): void;
  error(context: Bindings, message: string): void;
  error(message: string): void;
  /** A logger carrying extra bindings — a correlation id, a path. */
  child(bindings: Bindings): EdgeLogger;
}

const isDevelopment = process.env.NODE_ENV === 'development';

/** Matches the Node logger: debug in development, info in production. */
const threshold = isDevelopment ? LEVELS.debug : LEVELS.info;

/**
 * `err` as a plain object.
 *
 * Pino's standard serializer does this for the Node logger; without it an
 * `Error` passed through `JSON.stringify` renders as `{}` and the one field
 * anybody wanted is gone.
 */
function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    type: value.name,
    message: value.message,
    stack: value.stack,
  };
}

function emit(level: Level, bindings: Bindings, context: Bindings, message: string): void {
  if (LEVELS[level] < threshold) return;

  const record: Record<string, unknown> = {
    level: LEVELS[level],
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...bindings,
    ...context,
    msg: message,
  };

  if ('err' in record) record.err = serializeError(record.err);

  const line = JSON.stringify(record);

  // The only sink the Edge Runtime provides. Deliberate, and the reason this
  // module exists rather than each call site reaching for `console` itself.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function build(bindings: Bindings): EdgeLogger {
  const at =
    (level: Level) =>
    (contextOrMessage: Bindings | string, maybeMessage?: string): void => {
      if (typeof contextOrMessage === 'string') {
        emit(level, bindings, {}, contextOrMessage);
      } else {
        emit(level, bindings, contextOrMessage, maybeMessage ?? '');
      }
    };

  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (extra: Bindings) => build({ ...bindings, ...extra }),
  };
}

/** An Edge-safe logger with the same call shape as `createLogger`. */
export function createEdgeLogger(bindings: Bindings = {}): EdgeLogger {
  return build(bindings);
}
