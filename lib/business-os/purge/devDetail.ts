// lib/business-os/purge/devDetail.ts
//
// The CLAUDE.md error-format guard for the purge engine (SA F-1, G-3): raw
// internal text (PostgREST, storage or read errors) may reach the client only
// in development. Everywhere else the client gets the plain message, and the
// raw text goes to Pino and the audit row.

/** True only in development. Read per call, so tests can switch it. */
export const isDevelopment = (): boolean => process.env.NODE_ENV === 'development';

/** Append raw internal text to a client message only in development. */
export function withDevDetail(message: string, raw: string | undefined | null): string {
  return isDevelopment() && raw ? `${message} (${raw})` : message;
}
