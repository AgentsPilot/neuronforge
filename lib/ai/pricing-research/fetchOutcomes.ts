/**
 * The shape of one "Check provider prices" round's outcomes (AI model price
 * review slice 5; SA RR-1, SC-12, SC-14).
 *
 * A strict schema guards what is WRITTEN to `ai_price_proposals.provider_outcomes`
 * and a second one what is READ back for the per-provider status line, so the
 * stored record can never hold an unbounded list, a page body or a free-text
 * reason:
 *   - model ids pass `MODEL_ID_REGEX`;
 *   - reasons are enums;
 *   - a cell snippet is at most 80 characters;
 *   - every list holds at most 50 items.
 *
 * Slice 10 (SA SC10-2): Anthropic is read by an adapter. The WRITE schema
 * (`ProviderOutcomesSchema`) accepts only the adapter shape for it, so a
 * regression can never store `manual_only` again; the READ schema
 * (`StoredProviderOutcomesSchema`) also accepts `manual_only`, because every
 * round stored before slice 10 holds it. An old round reads as "Anthropic not
 * checked yet", never as a failure (SC10-3).
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

/** How each provider's prices arrive today (BQ-4; Anthropic since slice 10). */
export const PROVIDER_FETCH_MODE = {
  openai: 'adapter',
  anthropic: 'adapter',
  google: 'manual',
  kimi: 'manual',
} as const satisfies Record<PriceProvider, 'adapter' | 'manual'>;

/** The providers whose official page is read automatically (derived, so it cannot drift from the mode table). */
export type AdapterProvider = {
  [P in PriceProvider]: (typeof PROVIDER_FETCH_MODE)[P] extends 'adapter' ? P : never;
}[PriceProvider];

export const ADAPTER_PROVIDERS = (Object.keys(PROVIDER_FETCH_MODE) as PriceProvider[]).filter(
  (provider): provider is AdapterProvider => PROVIDER_FETCH_MODE[provider] === 'adapter'
);

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

/** WRITE schema: what a new round stores (SC10-2: Anthropic is always the adapter shape). */
export const ProviderOutcomesSchema = z
  .object({
    openai: AdapterOutcomeSchema,
    anthropic: AdapterOutcomeSchema,
    google: ManualOnlySchema,
    kimi: ManualOnlySchema,
    litellm: CrossCheckOutcomeSchema,
  })
  .strict();

/** READ schema: also accepts a round stored before slice 10 (Anthropic `manual_only`). */
export const StoredProviderOutcomesSchema = z
  .object({
    openai: AdapterOutcomeSchema,
    anthropic: z.union([AdapterOutcomeSchema, ManualOnlySchema]),
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
export type StoredProviderOutcomes = z.infer<typeof StoredProviderOutcomesSchema>;

/** The sources whose runs are monitored (SC-12): every adapter provider and the cross-check list. */
export type MonitoredSource = AdapterProvider | 'litellm';

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
  /** Adapter providers only: counts from the last run. */
  lastRunCounts: { linesStored: number; needsManual: number; notFound: number; refused: number } | null;
  /** LiteLLM only: verdict counts from the last run. */
  lastRunVerdicts: { agrees: number; differs: number; notListed: number; unavailable: number } | null;
}

/** GET /api/admin/model-pricing/fetch-runs `data`. */
export interface FetchStatus {
  lastRunAt: string | null;
  openai: SourceStatus;
  anthropic: SourceStatus;
  litellm: SourceStatus;
  manualProviders: PriceProvider[];
}

/** POST /api/admin/model-pricing/fetch-runs `data`. */
export interface FetchRunSummary {
  roundId: string;
  providerOutcomes: ProviderOutcomes;
  /** `provider` since slice 10 (SC10-8): an older response has none, and still renders. */
  problems: Array<{ provider?: AdapterProvider; model_name: string; messages: string[] }>;
}

export function manualProviders(): PriceProvider[] {
  return (Object.keys(PROVIDER_FETCH_MODE) as PriceProvider[]).filter((provider) => PROVIDER_FETCH_MODE[provider] === 'manual');
}

function outcomesOf(row: FetchRoundRow | null): StoredProviderOutcomes | null {
  if (!row) return null;
  const parsed = StoredProviderOutcomesSchema.safeParse(row.provider_outcomes);
  return parsed.success ? parsed.data : null;
}

/** The adapter outcome a source stored, or null when it has none (a round from before the adapter). */
function adapterOutcomeOf(outcomes: StoredProviderOutcomes, source: AdapterProvider): AdapterOutcome | null {
  const stored = outcomes[source];
  return 'needs_manual' in stored ? stored : null;
}

function runOf(row: FetchRoundRow | null, source: MonitoredSource): SourceRun | null {
  if (!row) return null;
  const outcomes = outcomesOf(row);
  if (!outcomes) return { outcome: 'unknown', at: row.created_at };
  // SC10-3: a round from before the adapter is "not checked yet", never a failure.
  if (source !== 'litellm' && !adapterOutcomeOf(outcomes, source)) return null;
  return { outcome: outcomes[source].outcome, at: row.created_at };
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
  const adapter = source !== 'litellm' && latestOutcomes ? adapterOutcomeOf(latestOutcomes, source) : null;
  return {
    lastRun: runOf(latest, source),
    lastOkAt: lastOk ? lastOk.created_at : null,
    lastFailure: runOf(lastFailure, source),
    lastRunCounts: adapter
      ? {
          linesStored: adapter.lines_stored,
          needsManual: adapter.needs_manual.length,
          notFound: adapter.not_found.length,
          refused: adapter.refused.length,
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
