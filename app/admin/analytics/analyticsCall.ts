/**
 * AI cost & usage: typed reads of a row's metadata and the words the table,
 * the call drawer and the run card show for it (Admin Layout Standard L-2b,
 * workplan §3.2). Pure: no React, no fetch.
 *
 * The route sends `metadata` as `Record<string, unknown>`. Every key the page
 * shows is narrowed here once, by `typeof`, so no component needs a type cast
 * and no `unknown` reaches JSX (the 19 type errors L-2a left in the page).
 */

import type { StatusTone } from '@/app/admin/components/layout/StatusChip';

import { drillPatch, type AnalyticsFilters } from './analyticsFilters';
import type { DrillDownItem } from './analyticsTypes';

/** The metadata keys the page shows, each narrowed; `null` when absent or of the wrong type. */
export interface CallMeta {
  model: string | null;
  provider: string | null;
  latencyMs: number | null;
  success: boolean | null;
  timestamp: string | null;
  requestType: string | null;
  dbCategory: string | null;
  category: string | null;
  activityType: string | null;
  activityName: string | null;
  activityStep: string | null;
  workflowStep: string | null;
  feature: string | null;
  component: string | null;
  endpoint: string | null;
  callId: string | null;
  userCount: number | null;
  agentCount: number | null;
  executionCount: number | null;
}

/** A non-empty string, else null (an empty string shows nothing, as the old truthiness checks did). */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A finite number, else null (never NaN or Infinity on screen). */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** The row's metadata as typed values. A missing `metadata` gives every key `null`. */
export function readMeta(item: Pick<DrillDownItem, 'metadata'>): CallMeta {
  const meta: Record<string, unknown> = item.metadata ?? {};
  return {
    model: text(meta.model),
    provider: text(meta.provider),
    latencyMs: finite(meta.latencyMs),
    success: flag(meta.success),
    timestamp: text(meta.timestamp),
    requestType: text(meta.requestType),
    dbCategory: text(meta.dbCategory),
    category: text(meta.category),
    activityType: text(meta.activityType),
    activityName: text(meta.activityName),
    activityStep: text(meta.activityStep),
    workflowStep: text(meta.workflowStep),
    feature: text(meta.feature),
    component: text(meta.component),
    endpoint: text(meta.endpoint),
    callId: text(meta.callId),
    userCount: finite(meta.userCount),
    agentCount: finite(meta.agentCount),
    executionCount: finite(meta.executionCount),
  };
}

/**
 * A call's outcome as a chip (§5.9, A-7). A call with no stored outcome reads
 * "Unknown": the old glyph showed the failure mark for it, which was never a
 * recorded failure (L-2b SA Q-6, M-3).
 */
export function callStatus(success: boolean | null): { tone: StatusTone; word: string } {
  if (success === true) return { tone: 'ok', word: 'Succeeded' };
  if (success === false) return { tone: 'danger', word: 'Failed' };
  return { tone: 'unknown', word: 'Unknown' };
}

/**
 * A run's stored status as a chip tone. Running, pending and any other value
 * are `info` (§5.9 "Running / informational"): not success, not failure, and
 * no page-invented "needs a look" (SA Q-6).
 */
export function executionStatusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'unknown';
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'danger';
  return 'info';
}

/**
 * Latency as the table cell ("1234ms", rounded) or the drawer ("1.23s" at one
 * second and above) shows it. Em dash for null and for 0, which the old
 * truthiness check also showed as missing (SA S-3).
 */
export function formatLatency(ms: number | null, style: 'cell' | 'detail'): string {
  if (ms === null || ms === 0) return '—';
  if (style === 'cell') return `${Math.round(ms)}ms`;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/**
 * Whether the view is narrowed by any drill, business or category filter: the
 * eleven fields a breadcrumb resets (`drillPatch({})` is every one at its
 * default). The footer then reads "Subtotal" (F-49, label only).
 */
export function isDrilled(filters: AnalyticsFilters): boolean {
  const defaults = drillPatch({});
  return (Object.keys(defaults) as Array<keyof typeof defaults>).some((key) => filters[key] !== defaults[key]);
}
