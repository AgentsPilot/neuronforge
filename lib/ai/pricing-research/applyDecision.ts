/**
 * The route-side checks of Apply (AI model price review slice 8; SA RC-6,
 * RC-7, the slice 7 note F-1, user decisions B-1..B-3). Pure: the snapshot and
 * the lines are passed in, nothing is read or written here.
 *
 * TWO LAYERS, ANDed. The database function `ai_price_apply_lines` is the
 * authority for everything stored in the price tables; this file covers what
 * SQL cannot see, the in-code fallback prices, by recomputing the line's
 * snapshot with `lineContextFor` (the same code that recorded it) and refusing
 * on any difference. Either layer refusing is a 409 "record the price again":
 * a false refusal is possible, a wrong price is not.
 *
 * EXACT (RC-6): every value is a decimal string compared by value with
 * `decimal.ts`, never through a JS number. The cached-input rule is the one
 * slice 7 charges with (F-1): OpenAI only, the stored rate when above 0, else
 * half the input; other providers none.
 */

import 'server-only';

import { modelKey } from './areaTags';
import { lineContextFor, type PricingSnapshot } from './comparisonModel';
import { formatGapPercent } from './coverageColour';
import {
  compareDecimals,
  formatDecimal,
  gapBasisPoints,
  halveDecimal,
  parseDecimal,
  perTokenToPerMillion,
  signOfDecimal,
} from './decimal';
import { BLOCKING_FLAGS, evaluatePendingLine, type PendingLineFlag } from './lineFlags';
import type { PendingLineInput } from './pendingLineSchema';
import type { AiPriceDecisionLine } from '@/lib/repositories/types';

/** The words every stale answer uses (SA 2.2): the admin records the price again. */
export const STALE_WORDS = 'The price we charge changed since this was recorded. Record the provider price again.';

/** What the drawer and the response say about timing (SA slice 7 note 3, O-12): nothing more precise. */
export const EFFECTIVE_WORDS = 'In effect on all servers within 1 hour.';

/** The stored line as the shared pending-line input, so the recorded snapshot can be recomputed. */
export function pendingInputOf(line: AiPriceDecisionLine): PendingLineInput {
  const common = {
    provider: line.provider as PendingLineInput['provider'],
    model_name: line.model_name,
    source_url: line.source_url,
    checked_on: line.checked_on,
  };
  if (line.kind === 'image') {
    return {
      kind: 'image',
      ...common,
      image_size: line.image_size ?? '',
      image_quality: line.image_quality ?? '',
      price_per_image: line.price_per_image ?? '',
    };
  }
  return {
    kind: 'token',
    ...common,
    input_per_1m: line.input_per_1m ?? '',
    output_per_1m: line.output_per_1m ?? '',
    ...(line.cached_input_per_1m === null ? {} : { cached_input_per_1m: line.cached_input_per_1m }),
  };
}

/** Two optional decimal strings are the same value (both absent counts as the same). */
function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  return compareDecimals(parseDecimal(left), parseDecimal(right)) === 0;
}

/**
 * True when what we charge today, recomputed now, differs from the snapshot the
 * line was recorded with. Basis `image_setting` is always stale (slice 7 no
 * longer produces it; user decision BQ-7b).
 */
export function isLineStale(snapshot: PricingSnapshot, line: AiPriceDecisionLine): boolean {
  if (line.current_basis === 'image_setting') return true;
  const now = lineContextFor(snapshot, pendingInputOf(line)).snapshotFields;
  if (now.current_basis !== line.current_basis) return true;
  if ((now.current_row_id ?? null) !== (line.current_row_id ?? null)) return true;
  if (line.kind === 'image') return !sameValue(now.current_cost_per_image, line.current_cost_per_image);
  return (
    !sameValue(now.current_input_cost_per_token, line.current_input_cost_per_token) ||
    !sameValue(now.current_output_cost_per_token, line.current_output_cost_per_token) ||
    !sameValue(now.current_cached_input_cost_per_token, line.current_cached_input_cost_per_token)
  );
}

/**
 * The cached-input rate charged today for a live token row, as slice 7 charges
 * it (F-1). Exported for the parity test that pins it equal to the SQL CASE in
 * `ai_price_apply_lines` and to the comparison's rule.
 */
export function chargedCachedInput(provider: string, row: { input: string; cachedColumn: string | null }): string | null {
  if (provider !== 'openai') return null;
  if (row.cachedColumn !== null && signOfDecimal(parseDecimal(row.cachedColumn)) > 0) return formatDecimal(parseDecimal(row.cachedColumn));
  return formatDecimal(halveDecimal(parseDecimal(row.input)));
}

/** The blocking flags the server itself can compute today (cross-check flags come only from a fetch round). */
const RECOMPUTABLE_BLOCKING: readonly PendingLineFlag[] = BLOCKING_FLAGS.filter((flag) => flag === 'large_move');

export interface ApplyLineReview {
  /** Hard refusals from the RR-1 bounds, re-run against today's context (422). */
  refusals: string[];
  /** A recomputable blocking flag differs from the stored one (RC-7: 409 stale). */
  blockingChanged: boolean;
  /** The stored blocking flags: the override requirement uses these, as the function does. */
  blockingFlags: string[];
}

/** RC-7: re-run the bounds and the recomputable blocking flags against today's context. */
export function reviewLineForApply(snapshot: PricingSnapshot, line: AiPriceDecisionLine): ApplyLineReview {
  const { context } = lineContextFor(snapshot, pendingInputOf(line));
  const evaluation = evaluatePendingLine(pendingInputOf(line), context);
  const stored = new Set(line.flags);
  const now = new Set<string>(evaluation.flags);
  const blockingChanged =
    evaluation.refusals.length === 0 && RECOMPUTABLE_BLOCKING.some((flag) => stored.has(flag) !== now.has(flag));
  return {
    refusals: evaluation.refusals,
    blockingChanged,
    blockingFlags: line.flags.filter((flag) => (BLOCKING_FLAGS as readonly string[]).includes(flag)),
  };
}

export interface MarginChange {
  unit: string;
  old: string | null;
  new: string;
  change: string | null;
}

export interface MarginItem {
  provider: string;
  model: string;
  kind: 'token' | 'image';
  areas: string[];
  changes: MarginChange[];
  fallbackDiffers: boolean;
}

function perMillion(perToken: string | null): string | null {
  return perToken === null ? null : perTokenToPerMillion(perToken);
}

function change(oldValue: string | null, newValue: string): string | null {
  if (oldValue === null) return null;
  const basisPoints = gapBasisPoints(parseDecimal(newValue), parseDecimal(oldValue));
  return basisPoints === null ? null : formatGapPercent(basisPoints);
}

/**
 * SA CR8-4: the cached-input rate charged after the apply, per 1M. The line's own
 * cached price when it has one; for OpenAI without one, half the new input (the
 * default rule, F-1); other providers charge none, so there is no change to show.
 */
function newChargedCachedPer1m(line: AiPriceDecisionLine): string | null {
  if (line.cached_input_per_1m !== null) return line.cached_input_per_1m;
  if (line.provider !== 'openai' || line.input_per_1m === null) return null;
  return formatDecimal(halveDecimal(parseDecimal(line.input_per_1m)));
}

/**
 * The MP-FR-14 margin prompt for one Apply, computed by the server (never the
 * client). B-1: every applied change, rise or drop, to a model a Business OS
 * area uses today needs it. B-3: a model no area uses ("not used yet") adds no
 * item. B-2: the change is shown as % per price unit, no cost per action.
 */
export function marginItemsFor(snapshot: PricingSnapshot, lines: readonly AiPriceDecisionLine[]): { needed: boolean; items: MarginItem[] } {
  const items: MarginItem[] = [];
  const byModel = new Map<string, MarginItem>();
  for (const line of lines) {
    const tags = snapshot.areas.tagsByModel.get(modelKey(line.provider, line.model_name)) ?? [];
    if (tags.length === 0) continue;
    const key = `${line.kind}|${modelKey(line.provider, line.model_name)}`;
    let item = byModel.get(key);
    if (!item) {
      item = {
        provider: line.provider,
        model: line.model_name,
        kind: line.kind,
        areas: tags.map((tag) => tag.label),
        changes: [],
        fallbackDiffers: false,
      };
      byModel.set(key, item);
      items.push(item);
    }
    if (line.flags.includes('fallback_differs')) item.fallbackDiffers = true;
    if (line.kind === 'image') {
      const newPrice = line.price_per_image ?? '0';
      item.changes.push({
        unit: `image ${line.image_size ?? ''} ${line.image_quality ?? ''}`.trim(),
        old: line.current_cost_per_image,
        new: newPrice,
        change: change(line.current_cost_per_image, newPrice),
      });
      continue;
    }
    const units: Array<[string, string | null, string | null]> = [
      ['input', perMillion(line.current_input_cost_per_token), line.input_per_1m],
      ['output', perMillion(line.current_output_cost_per_token), line.output_per_1m],
      ['cached input', perMillion(line.current_cached_input_cost_per_token), newChargedCachedPer1m(line)],
    ];
    for (const [unit, oldValue, newValue] of units) {
      if (newValue === null) continue;
      item.changes.push({ unit: `${unit} per 1M`, old: oldValue, new: newValue, change: change(oldValue, newValue) });
    }
  }
  return { needed: items.length > 0, items };
}

/** Old and new price per unit, as exact text, for the AI_PRICING_APPLIED_LINE audit entry (MP-FR-9). */
export function auditPricesOf(line: AiPriceDecisionLine): Record<string, string | null> {
  if (line.kind === 'image') {
    return { old_per_image: line.current_cost_per_image, new_per_image: line.price_per_image };
  }
  return {
    old_input_per_token: line.current_input_cost_per_token,
    old_output_per_token: line.current_output_cost_per_token,
    old_cached_input_per_token: line.current_cached_input_cost_per_token,
    new_input_per_1m: line.input_per_1m,
    new_output_per_1m: line.output_per_1m,
    new_cached_input_per_1m: line.cached_input_per_1m,
  };
}
