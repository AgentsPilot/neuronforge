/**
 * Lightweight console-based logger for simulator CLI tools.
 *
 * Not Pino -- this is a developer-facing CLI tool, not a production API route.
 * Supports --verbose via log level control and prints colored output.
 */

import type { LogLevel, SimulatorLogger, SummaryRow } from './types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: '\x1b[90m[DEBUG]\x1b[0m',
  info: '\x1b[36m[INFO]\x1b[0m',
  warn: '\x1b[33m[WARN]\x1b[0m',
  error: '\x1b[31m[ERROR]\x1b[0m',
};

const STATUS_COLOR: Record<string, string> = {
  pass: '\x1b[32m',   // green
  fail: '\x1b[31m',   // red
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
};

export function createSimulatorLogger(minLevel: LogLevel = 'info'): SimulatorLogger {
  const minPriority = LEVEL_PRIORITY[minLevel];

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < minPriority) return;

    const timestamp = new Date().toISOString().substring(11, 23);
    const prefix = LEVEL_PREFIX[level];
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';

    // Use stderr for warn/error, stdout for info/debug
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${timestamp} ${prefix} ${message}${dataStr}\n`);
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),

    table(rows: SummaryRow[]): void {
      // Print a formatted summary table
      const divider = '+' + '-'.repeat(30) + '+' + '-'.repeat(10) + '+' + '-'.repeat(12) + '+' + '-'.repeat(20) + '+';
      const header = '| ' + 'Scenario'.padEnd(28) + ' | '
        + 'Status'.padEnd(8) + ' | '
        + 'Duration'.padEnd(10) + ' | '
        + 'Validation'.padEnd(18) + ' |';

      process.stdout.write('\n' + divider + '\n' + header + '\n' + divider + '\n');

      for (const row of rows) {
        const color = STATUS_COLOR[row.status] || '';
        const reset = STATUS_COLOR.reset;
        const statusStr = `${color}${row.status.toUpperCase()}${reset}`;

        // Pad based on visible length (color codes are invisible)
        const statusPadded = statusStr + ' '.repeat(Math.max(0, 8 - row.status.length));
        const line = '| ' + row.scenario.padEnd(28).substring(0, 28) + ' | '
          + statusPadded + ' | '
          + row.duration.padEnd(10) + ' | '
          + row.validation.padEnd(18).substring(0, 18) + ' |';

        process.stdout.write(line + '\n');
      }

      process.stdout.write(divider + '\n');
    },
  };
}
