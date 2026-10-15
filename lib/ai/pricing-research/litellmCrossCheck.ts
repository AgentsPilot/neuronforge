/**
 * The LiteLLM cross-check (AI model price review slice 5; MP-FR-6a, SA RR-1,
 * SC-11). A second, independent reading of each official price. It NEVER
 * blocks the fetch and a LiteLLM number is NEVER stored as a price: only the
 * verdict, a text rendering, the largest gap and flags.
 *
 * ── Exactness (C-8) ───────────────────────────────────────────────────────
 * LiteLLM stores per-token JSON numbers. Each is read from its shortest
 * round-trip form (`decimalFromNumberLiteral`) and shifted to per 1M, then
 * compared EXACTLY with `movesBeyondBasisPoints` against the official price:
 *   - `agrees` iff no compared unit moves beyond 1 basis point;
 *   - `cross_check_differs` iff any unit moves beyond 500 basis points (5%).
 * Known limit: a literal with more than 15 significant digits does not
 * round-trip; the 1 bp tolerance absorbs it, and none exists today (SA).
 * The rounded `gapBasisPoints` is used only for the displayed percentage.
 *
 * ── Lookup ────────────────────────────────────────────────────────────────
 * Only the bare key equal to the model id, with `litellm_provider` equal to
 * our provider. Prefixed keys (`azure/…`) and other providers are ignored.
 * A `deprecation_date` (any date, past or future) adds `retiring` (O-11).
 */

import { z } from 'zod';

import {
  decimalFromNumberLiteral,
  formatDecimal,
  gapBasisPoints,
  isZeroDecimal,
  movesBeyondBasisPoints,
  parseDecimal,
  shiftDecimal,
  type Decimal,
} from './decimal';
import type { PendingLineFlag } from './lineFlags';

/** A real price list has thousands of keys; fewer than this is not the list (layout changed). */
export const LITELLM_MIN_KEYS = 100;
const AGREE_BASIS_POINTS = 1;
const DIFFERS_BASIS_POINTS = 500;

export type CrossCheckVerdict = 'agrees' | 'differs' | 'not_listed' | 'unavailable';

const cost = z.number().finite().nonnegative().optional();
const EntrySchema = z
  .object({
    litellm_provider: z.string(),
    input_cost_per_token: cost,
    output_cost_per_token: cost,
    cache_read_input_token_cost: cost,
    deprecation_date: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
      .optional(),
  })
  .passthrough();

export interface LiteLlmList {
  readonly entries: Readonly<Record<string, unknown>>;
}

/** The list, or null when the text is not the expected JSON object (→ `layout_changed`). */
export function parseLiteLlmList(text: string): LiteLlmList | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).length < LITELLM_MIN_KEYS) return null;
  return { entries: parsed as Record<string, unknown> };
}

export interface OfficialTokenPrice {
  model_name: string;
  input_per_1m: string;
  output_per_1m: string;
  cached_input_per_1m?: string;
}

export interface CrossCheckResult {
  verdict: CrossCheckVerdict;
  flags: PendingLineFlag[];
  /** Text only, from `formatDecimal` (never a float form). Null when nothing was read. */
  value: string | null;
  /** Largest absolute gap in percent, two decimals, display only. */
  diffPct: string | null;
}

function percentText(basisPoints: number): string {
  const magnitude = Math.abs(basisPoints);
  return `${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}

function perMillion(value: number): Decimal {
  return shiftDecimal(decimalFromNumberLiteral(value), 6);
}

const UNITS: Array<{ name: string; official: keyof OfficialTokenPrice; theirs: 'input_cost_per_token' | 'cache_read_input_token_cost' | 'output_cost_per_token' }> = [
  { name: 'input', official: 'input_per_1m', theirs: 'input_cost_per_token' },
  { name: 'cached input', official: 'cached_input_per_1m', theirs: 'cache_read_input_token_cost' },
  { name: 'output', official: 'output_per_1m', theirs: 'output_cost_per_token' },
];

export function crossCheckLine(list: LiteLlmList | null, provider: string, line: OfficialTokenPrice): CrossCheckResult {
  if (!list) return { verdict: 'unavailable', flags: ['cross_check_unavailable'], value: null, diffPct: null };

  const notListed: CrossCheckResult = { verdict: 'not_listed', flags: ['cross_check_not_listed'], value: null, diffPct: null };
  if (!Object.prototype.hasOwnProperty.call(list.entries, line.model_name)) return notListed;
  const parsed = EntrySchema.safeParse(list.entries[line.model_name]);
  if (!parsed.success) return { verdict: 'unavailable', flags: ['cross_check_unavailable'], value: null, diffPct: null };
  const entry = parsed.data;
  if (entry.litellm_provider !== provider) return notListed;

  const parts: string[] = [];
  let compared = 0;
  let agrees = true;
  let beyondFive = false;
  let largest: number | null = null;

  for (const unit of UNITS) {
    const theirs = entry[unit.theirs];
    if (theirs === undefined) continue;
    const theirsPerMillion = perMillion(theirs);
    parts.push(`${unit.name} ${formatDecimal(theirsPerMillion)}`);
    const officialText = line[unit.official];
    if (officialText === undefined) continue;
    const official = parseDecimal(officialText);
    compared += 1;
    if (movesBeyondBasisPoints(theirsPerMillion, official, AGREE_BASIS_POINTS)) agrees = false;
    if (movesBeyondBasisPoints(theirsPerMillion, official, DIFFERS_BASIS_POINTS)) beyondFive = true;
    if (!isZeroDecimal(official)) {
      const gap = gapBasisPoints(theirsPerMillion, official);
      if (gap !== null && (largest === null || Math.abs(gap) > Math.abs(largest))) largest = gap;
    }
  }

  const retiring = entry.deprecation_date !== undefined;
  let value = parts.length > 0 ? `${parts.join(', ')} per 1M` : '';
  if (retiring) value = `${value}${value ? '; ' : ''}retirement date ${entry.deprecation_date}`;

  if (compared === 0) {
    return { verdict: 'not_listed', flags: retiring ? ['cross_check_not_listed', 'retiring'] : ['cross_check_not_listed'], value: value || null, diffPct: null };
  }

  const flags: PendingLineFlag[] = [];
  if (beyondFive) flags.push('cross_check_differs');
  if (retiring) flags.push('retiring');
  return {
    verdict: agrees ? 'agrees' : 'differs',
    flags,
    value: value || null,
    diffPct: largest === null ? null : percentText(largest),
  };
}
