import pino from 'pino';
import { loggerConfig } from './config';

// Create base logger
export const logger = pino(loggerConfig);

// Create child logger with context
export function createLogger(context: {
  module?: string;
  service?: string;
  [key: string]: any;
}) {
  return logger.child(context);
}

// Export types
export type Logger = pino.Logger;
