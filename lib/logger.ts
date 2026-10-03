/**
 * Pino-based structured logging
 *
 * This is the module `@/lib/logger` resolves to: a file wins over a directory,
 * so `lib/logger.ts` is loaded and never `lib/logger/index.ts`. That shadowing
 * is how the redaction list in `lib/logger/config.ts` went unapplied by every
 * server logger (OI-9). `lib/logger/__tests__/redaction.liveLogger.test.ts`
 * writes through THIS logger so it cannot happen again.
 */

import pino from 'pino';

import { loggerConfig } from './logger/config';

export type Logger = pino.Logger;

interface LoggerOptions {
  module?: string;
  service?: string;
  route?: string;
}

const baseLogger = pino({
  // Deliberately not `loggerConfig.level`: production must stay at `info`,
  // which keeps model-derived owner text (logged at `debug`) out of it (D-OI8).
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Only the redaction list is taken from the shared config. Its timestamp,
  // base and serializers would change the shape of every line operators read.
  // Server-side only: Pino's browser build ignores `redact`.
  redact: loggerConfig.redact,
  browser: {
    asObject: true
  }
});

export function createLogger(options: LoggerOptions = {}): Logger {
  return baseLogger.child({
    module: options.module,
    service: options.service,
    route: options.route
  });
}

export const clientLogger = createLogger({ service: 'client' });
