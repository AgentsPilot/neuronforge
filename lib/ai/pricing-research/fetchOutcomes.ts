/**
 * The shape of one "Check provider prices" round's outcomes (AI model price
 * review slice 5; SA RR-1, SC-12, SC-14).
 *
 * The same strict schema is used to WRITE `ai_price_proposals.provider_outcomes`
 * and to READ it back for the per-provider status line, so the stored record
 * can never hold an unbounded list, a page body or a free-text reason:
 *   - model ids pass `MODEL_ID_REGEX`;
 *   - reasons are enums;
 *   - a cell snippet is at most 80 characters;
 *   - every list holds at most 50 items.
 *
 * Pure: no I/O, no `server-only`, so browser files may import TYPES from here
 * (`import type`, SA SC-14).
 */

import { z } from 'zod';

import type { PriceProvider } from './officialSources';
import { MODEL_ID_REGEX } from './pendingLineSchema';

/** `ok`, a named failure, or `http_<status>` (RR-1, SC-9). */
export const SOURCE_OUTCOME_REGEX = /^(ok|timeout|network_error|blocked|layout_changed|too_large|http_[0-9]{3})$/;

export type SourceOutcome =
  | 'ok'
  | 'timeout'
  | 'network_error'
  | 'blocked'
  | 'layout_changed'
  | 'too_large'
  | `http_${number}`;

/** Why a model the page lists could not be read automatically. */
export const NEEDS_MANUAL_REASONS = [
  'cell_not_single_price',
  'missing_price',
  'listed_twice',
  'wrong_cell_count',
  'ambiguous_match',
] as const;
export type NeedsManualReason = (typeof NEEDS_MANUAL_REASONS)[number];

export const REFUSED_REASONS = ['refused_by_bounds', 'invalid_line'] as const;
export type RefusedReason = (typeof REFUSED_REASONS)[number];

/** How each provider's prices arrive today (BQ-4; Anthropic is slice 10). */
export const PROVIDER_FETCH_MODE = {
  openai: 'adapter',
  anthropic: 'manual',
  google: 'manual',
  kimi: 'manual',
} as const satisfies Record<PriceProvider, 'adapter' | 'manual'>;

export const MAX_LIST_ITEMS = 50;
export const MAX_CELL_TEXT = 80;

const modelId = z.string().max(100).regex(MODEL_ID_REGEX);
const outcome = z.string().regex(SOURCE_OUTCOME_REGEX);
const count = z.number().int().nonnegative();
const isoTime = z.string().datetime({ offset: true });

const NeedsManualSchema = z
  .object({
    model_name: modelId,
    reason: z.enum(NEEDS_MANUAL_REASONS),
    cell: z.string().max(MAX_CELL_TEXT).optional(),
  })
  .strict();

const RefusedSchema = z.object({ model_name: modelId, reason: z.enum(REFUSED_REASONS) }).strict();

/** SA optimisation 2: the note dropped from a model cell, e.g. "<272K context length". */
const NameNoteSchema = z.object({ model_name: modelId, note: z.string().max(MAX_CELL_TEXT) }).strict();

export const AdapterOutcomeSchema = z
  .object({
    outcome,
    fetched_at: isoTime,
    duration_ms: count,
    bytes: count,
    lines_stored: count,
    needs_manual: z.array(NeedsManualSchema).max(MAX_LIST_ITEMS),
    not_found: z.array(modelId).max(MAX_LIST_ITEMS),
    refused: z.array(RefusedSchema).max(MAX_LIST_ITEMS),
    name_notes: z.array(NameNoteSchema).max(MAX_LIST_ITEMS),
  })
  .strict();

export const ManualOnlySchema = z.object({ outcome: z.literal('manual_only') }).strict();

export const CrossCheckOutcomeSchema = z
  .object({
    outcome,
    fetched_at: isoTime,
    duration_ms: count,
    bytes: count,
    agrees: count,
    differs: count,
    not_listed: count,
    unavailable: count,
  })
  .strict();

export const ProviderOutcomesSchema = z
  .object({
    openai: AdapterOutcomeSchema,
    anthropic: ManualOnlySchema,
    google: ManualOnlySchema,
    kimi: ManualOnlySchema,
    litellm: CrossCheckOutcomeSchema,
  })
  .strict();

export type NeedsManualEntry = z.infer<typeof NeedsManualSchema>;
export type RefusedEntry = z.infer<typeof RefusedSchema>;
export type NameNote = z.infer<typeof NameNoteSchema>;
export type AdapterOutcome = z.infer<typeof AdapterOutcomeSchema>;
export type CrossCheckOutcome = z.infer<typeof CrossCheckOutcomeSchema>;
export type ProviderOutcomes = z.infer<typeof ProviderOutcomesSchema>;

/** The sources whose runs are monitored (SC-12). */
export type MonitoredSource = 'openai' | 'litellm';

/** One stored fetch round, as the repository returns it. */
export interface FetchRoundRow {
  id: string;
  created_at: string;
  provider_outcomes: unknown;
}

export interface SourceRun {
  /** The stored outcome, or "unknown" when the record cannot be read. */
  outcome: string;
  at: string;
}

export interface SourceStatus {
  lastRun: SourceRun | null;
  lastOkAt: string | null;
  lastFailure: SourceRun | null;
  /** OpenAI only: counts from the last run. */
  lastRunCounts: { linesStored: number; needsManual: number; notFound: number; refused: number } | null;
  /** LiteLLM only: verdict counts from the last run. */
  lastRunVerdicts: { agrees: number; differs: number; notListed: number; unavailable: number } | null;
}

/** GET /api/admin/model-pricing/fetch-runs `data`. */
export interface FetchStatus {
  lastRunAt: string | null;
  openai: SourceStatus;
  litellm: SourceStatus;
  manualProviders: PriceProvider[];
}

/** POST /api/admin/model-pricing/fetch-runs `data`. */
export interface FetchRunSummary {
  roundId: string;
  providerOutcomes: ProviderOutcomes;
  problems: Array<{ model_name: string; messages: string[] }>;
}

export function manualProviders(): PriceProvider[] {
  return (Object.keys(PROVIDER_FETCH_MODE) as PriceProvider[]).filter((provider) => PROVIDER_FETCH_MODE[provider] === 'manual');
}

function outcomesOf(row: FetchRoundRow | null): ProviderOutcomes | null {
  if (!row) return null;
  const parsed = ProviderOutcomesSchema.safeParse(row.provider_outcomes);
  return parsed.success ? parsed.data : null;
}

function runOf(row: FetchRoundRow | null, source: MonitoredSource): SourceRun | null {
  if (!row) return null;
  const outcomes = outcomesOf(row);
  return { outcome: outcomes ? outcomes[source].outcome : 'unknown', at: row.created_at };
}

/**
 * Per-source status from the three reads (SC-12): the latest round, the latest
 * round where the source was `ok`, and the latest where it was not.
 */
export function sourceStatus(
  source: MonitoredSource,
  latest: FetchRoundRow | null,
  lastOk: FetchRoundRow | null,
  lastFailure: FetchRoundRow | null
): SourceStatus {
  const latestOutcomes = outcomesOf(latest);
  return {
    lastRun: runOf(latest, source),
    lastOkAt: lastOk ? lastOk.created_at : null,
    lastFailure: runOf(lastFailure, source),
    lastRunCounts:
      source === 'openai' && latestOutcomes
        ? {
            linesStored: latestOutcomes.openai.lines_stored,
            needsManual: latestOutcomes.openai.needs_manual.length,
            notFound: latestOutcomes.openai.not_found.length,
            refused: latestOutcomes.openai.refused.length,
          }
        : null,
    lastRunVerdicts:
      source === 'litellm' && latestOutcomes
        ? {
            agrees: latestOutcomes.litellm.agrees,
            differs: latestOutcomes.litellm.differs,
            notListed: latestOutcomes.litellm.not_listed,
            unavailable: latestOutcomes.litellm.unavailable,
          }
        : null,
  };
}
