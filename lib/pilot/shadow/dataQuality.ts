/**
 * Shared data-quality signal (Calibration — Item 6/Finding 4 + Item 10).
 *
 * ONE generic definition of "does this delivered/produced set carry MEANINGFUL
 * data?", reused by BOTH the coverage-floor (CalibrationVerdict, Finding 4) and
 * the all-failed/all-empty step detector (Item 10) — per the requirement's
 * "Items 6 and 10 use one definition" ruling. A positive row COUNT is not enough:
 * a 13-row all-blank / all-fallback report must not count as "real path
 * exercised" and must never pass (G1c, tightened by Finding 4).
 *
 * Fully generic — it inspects value shapes only. No plugin-specific field names,
 * no hardcoded report columns.
 */

/**
 * Human-readable fallback / placeholder markers (Principle 2 / Anti-pattern C):
 * values downstream code substitutes when real extraction failed. These are NOT
 * meaningful data even though they are non-empty strings. Generic, plugin-agnostic.
 */
export const FALLBACK_MARKERS: ReadonlySet<string> = new Set([
  'unknown',
  'n/a',
  'na',
  'tbd',
  'none',
  'null',
  'undefined',
  '__missing__',
  '__extraction_failed__',
  'not available',
  'no data',
]);

/** A single value counts as meaningful when it is present, non-empty, non-fallback. */
export function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    if (FALLBACK_MARKERS.has(trimmed.toLowerCase())) return false;
    return true;
  }
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(isMeaningfulValue);
  if (typeof value === 'object') {
    // Ignore internal/meta keys (e.g. flatten's `_parentData`) when judging meaning.
    return Object.entries(value as Record<string, unknown>)
      .some(([k, v]) => !k.startsWith('_') && isMeaningfulValue(v));
  }
  return false;
}

/** An item is meaningful when at least one of its (non-meta) fields is meaningful. */
export function isMeaningfulItem(item: unknown): boolean {
  if (item === null || item === undefined) return false;
  if (typeof item !== 'object') return isMeaningfulValue(item);
  if (Array.isArray(item)) return item.some(isMeaningfulItem);
  return Object.entries(item as Record<string, unknown>)
    .some(([k, v]) => !k.startsWith('_') && isMeaningfulValue(v));
}

export interface DataQualityAssessment {
  /** Whether the input was an inspectable non-empty array of items. */
  assessed: boolean;
  itemCount: number;
  meaningfulItemCount: number;
  /** meaningfulItemCount / itemCount (0 when itemCount is 0). */
  meaningfulRatio: number;
  /** True when we assessed a non-empty set and 0% of items carry meaningful data. */
  allBlank: boolean;
}

const EMPTY_ASSESSMENT: DataQualityAssessment = {
  assessed: false,
  itemCount: 0,
  meaningfulItemCount: 0,
  meaningfulRatio: 0,
  allBlank: false,
};

/**
 * Coerce common delivered-data shapes to an array of items:
 *  - an array → itself
 *  - `{ items: [...] }` / `{ rows: [...] }` / `{ data: [...] }` → the inner array
 * Returns null when no array-of-items can be located (not assessable).
 */
function toItemArray(delivered: unknown): unknown[] | null {
  if (Array.isArray(delivered)) return delivered;
  if (delivered && typeof delivered === 'object') {
    for (const key of ['items', 'rows', 'data', 'results', 'records']) {
      const inner = (delivered as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

/**
 * Assess whether a delivered/produced set carries meaningful data.
 * When the input is not an inspectable array of items, returns an un-assessed
 * result (`assessed:false`, `allBlank:false`) so callers do not treat
 * "couldn't inspect" as "all blank".
 */
export function assessItemsDataQuality(delivered: unknown): DataQualityAssessment {
  const items = toItemArray(delivered);
  if (!items || items.length === 0) return EMPTY_ASSESSMENT;

  let meaningful = 0;
  for (const item of items) {
    if (isMeaningfulItem(item)) meaningful++;
  }
  return {
    assessed: true,
    itemCount: items.length,
    meaningfulItemCount: meaningful,
    meaningfulRatio: meaningful / items.length,
    allBlank: meaningful === 0,
  };
}

export interface ColumnFillReport {
  /** Whether the input was an inspectable non-empty array of object items. */
  assessed: boolean;
  /** Per-column (non-meta key) meaningful fill ratio, 0..1. */
  columns: Record<string, number>;
  /** Columns present on ≥1 item but meaningful on 0% of items. */
  allBlankColumns: string[];
  /**
   * True when the set is PARTIALLY blank: at least one column is entirely blank
   * AND at least one column carries meaningful data. A FULLY-blank set is not
   * "partial" (that is the all-blank / false-green case handled elsewhere).
   */
  partiallyBlank: boolean;
}

/**
 * Per-column data-quality: which report columns are populated vs blank across all
 * delivered rows. Generic — keys are discovered from the items themselves; no
 * plugin-specific or report-specific column names. Meta (`_`-prefixed) keys are
 * ignored. Used to surface a partially-blank report (real amount/vendor but blank
 * source_email/filename columns) as a `needs_review` data-quality issue rather
 * than passing it or over-strictly failing it.
 */
export function assessColumnFillRates(delivered: unknown): ColumnFillReport {
  const items = toItemArray(delivered);
  if (!items || items.length === 0) {
    return { assessed: false, columns: {}, allBlankColumns: [], partiallyBlank: false };
  }

  const keys = new Set<string>();
  for (const it of items) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      for (const k of Object.keys(it as Record<string, unknown>)) {
        if (!k.startsWith('_')) keys.add(k);
      }
    }
  }

  const columns: Record<string, number> = {};
  for (const k of keys) {
    let meaningful = 0;
    for (const it of items) {
      if (it && typeof it === 'object' && isMeaningfulValue((it as Record<string, unknown>)[k])) meaningful++;
    }
    columns[k] = meaningful / items.length;
  }

  const allBlankColumns = Object.entries(columns).filter(([, r]) => r === 0).map(([k]) => k);
  const anyPopulated = Object.values(columns).some(r => r > 0);
  const partiallyBlank = allBlankColumns.length > 0 && anyPopulated;

  return { assessed: true, columns, allBlankColumns, partiallyBlank };
}

/**
 * Generic delivery-confirmation field markers — the scalar payload a send/notify
 * action returns when it actually executed (email/messaging/etc.). Not
 * plugin-specific: these are common confirmation field names across senders.
 */
export const SEND_CONFIRMATION_MARKERS: readonly string[] = [
  'message_id',
  'messageId',
  'sent_at',
  'sentAt',
  'thread_id',
  'threadId',
  'recipient_count',
  'recipients',
];

/**
 * True when a value looks like the confirmation of an EXECUTED terminal
 * send/notify (a scalar object carrying a delivery-confirmation marker such as
 * `message_id`/`sent_at`). Used so a send-terminating agent counts as
 * "delivery-exercised" even though a scalar send emits no counted item array —
 * without requiring a positive `items_delivered` count.
 */
export function looksLikeExecutedSend(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return SEND_CONFIRMATION_MARKERS.some(m => keys.includes(m));
}

export interface CoverageDerivation {
  /**
   * Whether the real path RAN and carried MEANINGFUL data — based on the last
   * pre-delivery collection's field values (or an executed terminal send when
   * there is no inspectable collection), NOT on a delivery/row count.
   */
  exercisedRealPath: boolean;
  /** The false-green guard: the delivered set is all-blank / all-fallback. */
  deliveredAllBlank: boolean;
  /** Columns blank in every row while the set is otherwise populated (partial report). */
  partialBlankColumns: string[];
  /** Human-readable reason when the path was not meaningfully exercised. */
  reason?: string;
}

/**
 * Unified coverage signal (Phase 1.6) — one derivation that fixes BOTH directions
 * of the coverage floor:
 *  - too LENIENT (Re-run #1): a positive row count let an all-blank report nearly
 *    pass → still caught here via `deliveredAllBlank` (false-green guard).
 *  - too STRICT (Re-run #2): a send/notify-terminating agent shows delivered=0 (a
 *    scalar send emits no counted array) → here an executed send, or a meaningful
 *    pre-delivery collection, counts as exercised.
 *
 * Rules (generic; no plugin-specific logic):
 *  - `preDelivery` = the last step output that is an inspectable non-empty array
 *    of items (the collection feeding the report/send). Scalar send confirmations
 *    are never arrays, so they are not picked.
 *  - If a pre-delivery collection exists: `exercisedRealPath` = ≥1 row carries
 *    meaningful values; `deliveredAllBlank` = 0% of rows are meaningful; and a
 *    per-column check reports columns blank in every row (partial report).
 *  - Else: an executed terminal send counts as exercised; otherwise fall back to
 *    the row-count signal so non-send flows do not regress.
 */
export function deriveCoverageSignal(input: {
  stepOutputs: Record<string, unknown> | null | undefined;
  finalOutput?: unknown;
  itemsProcessed?: number;
  itemsDelivered?: number;
}): CoverageDerivation {
  const stepOutputs = input.stepOutputs && typeof input.stepOutputs === 'object' ? input.stepOutputs : {};

  // Last inspectable array-of-items among the step outputs = pre-delivery payload.
  let preDelivery: unknown = null;
  for (const out of Object.values(stepOutputs)) {
    if (assessItemsDataQuality(out).assessed) preDelivery = out;
  }
  const deliveredPayload = preDelivery ?? input.finalOutput;
  const quality = assessItemsDataQuality(deliveredPayload);
  const sendExecuted = Object.values(stepOutputs).some(looksLikeExecutedSend);

  if (quality.assessed) {
    const exercisedRealPath = quality.meaningfulItemCount > 0;
    const deliveredAllBlank = quality.allBlank;
    const fill = assessColumnFillRates(deliveredPayload);
    const partialBlankColumns = fill.partiallyBlank ? fill.allBlankColumns : [];
    let reason: string | undefined;
    if (deliveredAllBlank) reason = 'the report was produced but every row is blank / placeholder';
    else if (!exercisedRealPath) reason = 'the real path produced no meaningful data';
    return { exercisedRealPath, deliveredAllBlank, partialBlankColumns, reason };
  }

  // No inspectable collection → an executed send counts as exercised; else fall
  // back to the row-count signal.
  const processed = input.itemsProcessed ?? 0;
  const delivered = input.itemsDelivered ?? 0;
  const exercisedRealPath = sendExecuted || !(processed > 0 && delivered === 0);
  return {
    exercisedRealPath,
    deliveredAllBlank: false,
    partialBlankColumns: [],
    reason: exercisedRealPath ? undefined : `processed ${processed} item(s), delivered 0`,
  };
}

/**
 * True when the unified coverage signal CONFIRMS the real path produced no
 * meaningful output — i.e. it was not meaningfully exercised, OR the delivered
 * set is all-blank/all-fallback (false-green guard).
 *
 * Used to guard the route's legacy count-based "no output → needs_review" gate so
 * it only fires when this signal agrees. A clean send/notify-terminating agent
 * (meaningful pre-delivery data and/or an executed send, delivered count 0) yields
 * `false` here, so it is NOT capped and can reach `passed`. Single source of truth
 * shared by the route and its regression test — no divergent emptiness check.
 */
export function coverageConfirmsNoMeaningfulOutput(coverage: CoverageDerivation): boolean {
  return !coverage.exercisedRealPath || coverage.deliveredAllBlank;
}
