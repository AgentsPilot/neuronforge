/**
 * Pino-based structured logging
 */

import pino from 'pino';

export type Logger = pino.Logger;

interface LoggerOptions {
  module?: string;
  service?: string;
  route?: string;
}

const baseLogger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
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
