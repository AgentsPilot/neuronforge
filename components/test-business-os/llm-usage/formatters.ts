/**
 * Display helpers for the LLM Usage tab. Pure; no server imports.
 */

import type { CheckStatus } from '@/lib/business-os/usage/llmUsageReportTypes';

export type DisplayStatus = CheckStatus | 'not_checked';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  incomplete: 'Incomplete',
  info: 'Info',
  not_checked: 'Not checked',
};

/** Colour always travels with the text label (NFR Usability). */
export const STATUS_COLOR: Record<DisplayStatus, { background: string; color: string }> = {
  pass: { background: '#d4edda', color: '#155724' },
  fail: { background: '#f8d7da', color: '#721c24' },
  incomplete: { background: '#fff3cd', color: '#856404' },
  info: { background: '#e2e3e5', color: '#383d41' },
  not_checked: { background: '#f8f9fa', color: '#6c757d' },
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function localTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** ISO → `YYYY-MM-DDTHH:mm:ss` in the browser's zone, for a `datetime-local` input. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A `datetime-local` value (browser zone) → UTC ISO 8601, or null when empty/invalid. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A timestamp in the admin's local zone, e.g. `2026-09-17 14:03:05`. */
export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function formatCostUsd(value: number): string {
  if (!value) return '$0';
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`;
}

export function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}
