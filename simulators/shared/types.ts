/**
 * Shared types for all simulators.
 *
 * These base types provide a consistent interface across
 * the simulator family (enhanced-prompt-generator, future V6 simulator, etc.).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SimulatorLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Print a summary table at the end of a run */
  table(rows: SummaryRow[]): void;
}

export interface SummaryRow {
  scenario: string;
  status: 'pass' | 'fail' | 'error' | 'warning';
  duration: string;
  validation: string;
}

export interface AuthState {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  /** Serialized cookie header value for forwarding on HTTP requests */
  cookieHeader: string;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  cookieHeader?: string;
  correlationId?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Record<string, string>;
}

export interface SimulatorError {
  phase: string;
  message: string;
  statusCode?: number;
  rawResponse?: unknown;
}
