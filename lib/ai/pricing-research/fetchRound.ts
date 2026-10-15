/**
 * Assemble one "Check provider prices" round from the fetched texts
 * (AI model price review slice 5; SA RR-1, O-5, SC-14). Pure: the snapshot
 * reads are passed in as functions, so this file does no I/O.
 *
 * Every fetched line goes through THE SAME schema and bounds as a manual
 * entry (`PendingLineSchema`, `evaluatePendingLine`). A line the bounds refuse
 * is NOT stored and supersedes nothing: it is listed as a problem, and the
 * other lines still load (RR-1 "line not stored, shown as a problem"). The
 * cross-check adds its verdict and flags; it never removes a line.
 */

import type { AiPriceSubmitLine } from '@/lib/repositories/types';

import {
  MAX_LIST_ITEMS,
  ProviderOutcomesSchema,
  type ProviderOutcomes,
  type RefusedEntry,
} from './fetchOutcomes';
import type { FetchResult } from './fetchSources';
import { crossCheckLine, parseLiteLlmList, type CrossCheckVerdict } from './litellmCrossCheck';
import { evaluatePendingLine, PENDING_LINE_FLAGS, type LineFlagContext, type PendingLineFlag } from './lineFlags';
import { parseOpenAiPricing, type AnchorId } from './openaiPricingAdapter';
import { PendingLineSchema, type PendingLineInput } from './pendingLineSchema';

type SnapshotFields = Omit<AiPriceSubmitLine, 'kind' | 'provider' | 'model_name' | 'source_url' | 'checked_on' | 'flags'>;

export interface FetchRoundInput {
  openai: FetchResult;
  litellm: FetchResult;
  /** OpenAI model ids in the coverage set. */
  coverage: ReadonlySet<string>;
  isInputOnly: (model: string) => boolean;
  contextFor: (line: PendingLineInput) => { context: LineFlagContext; snapshotFields: SnapshotFields };
  /** The human pricing page stored as each line's source (MP-FR-3). */
  sourceUrl: string;
  /** The cross-check list's URL, stored as `cross_check_source`. */
  crossCheckSource: string;
  /** UTC date, YYYY-MM-DD. */
  checkedOn: string;
  /** ISO time the round started (the fetches ran in parallel from it). */
  fetchedAt: string;
}

export interface FetchRoundResult {
  submitLines: AiPriceSubmitLine[];
  providerOutcomes: ProviderOutcomes;
  problems: Array<{ model_name: string; messages: string[] }>;
  /** For the log line only: the first anchor that failed. */
  failedAnchor: AnchorId | null;
}

function orderedFlags(flags: readonly PendingLineFlag[]): PendingLineFlag[] {
  const set = new Set(flags);
  return PENDING_LINE_FLAGS.filter((flag) => set.has(flag));
}

/** Anthropic (slice 10), Google and Kimi (BQ-4): manual entry for now, see `PROVIDER_FETCH_MODE`. */
const MANUAL_ONLY = { outcome: 'manual_only' as const };

export function buildFetchRound(input: FetchRoundInput): FetchRoundResult {
  const list = input.litellm.outcome === 'ok' && input.litellm.text !== undefined ? parseLiteLlmList(input.litellm.text) : null;
  const litellmOutcome = input.litellm.outcome === 'ok' && !list ? 'layout_changed' : input.litellm.outcome;

  const parsed =
    input.openai.outcome === 'ok' && input.openai.text !== undefined
      ? parseOpenAiPricing(input.openai.text, { coverage: input.coverage, isInputOnly: input.isInputOnly })
      : null;
  const openaiOutcome = parsed && parsed.outcome === 'layout_changed' ? 'layout_changed' : input.openai.outcome;

  const submitLines: AiPriceSubmitLine[] = [];
  const refused: RefusedEntry[] = [];
  const problems: Array<{ model_name: string; messages: string[] }> = [];
  const verdicts: Record<CrossCheckVerdict, number> = { agrees: 0, differs: 0, not_listed: 0, unavailable: 0 };

  for (const price of parsed?.outcome === 'ok' ? parsed.lines : []) {
    const candidate = {
      kind: 'token' as const,
      provider: 'openai' as const,
      model_name: price.model_name,
      input_per_1m: price.input_per_1m,
      output_per_1m: price.output_per_1m,
      ...(price.cached_input_per_1m !== undefined ? { cached_input_per_1m: price.cached_input_per_1m } : {}),
      source_url: input.sourceUrl,
      checked_on: input.checkedOn,
    };
    const valid = PendingLineSchema.safeParse(candidate);
    if (!valid.success) {
      refused.push({ model_name: price.model_name, reason: 'invalid_line' });
      problems.push({ model_name: price.model_name, messages: valid.error.issues.map((issue) => issue.message) });
      continue;
    }
    const line = valid.data;
    const { context, snapshotFields } = input.contextFor(line);
    const evaluation = evaluatePendingLine(line, context);
    if (evaluation.refusals.length > 0) {
      refused.push({ model_name: price.model_name, reason: 'refused_by_bounds' });
      problems.push({ model_name: price.model_name, messages: evaluation.refusals });
      continue;
    }

    const cross = crossCheckLine(list, 'openai', price);
    verdicts[cross.verdict] += 1;
    submitLines.push({
      ...snapshotFields,
      kind: line.kind,
      provider: line.provider,
      model_name: line.model_name,
      // The prices go in from the validated line itself, as written on the page (never from LiteLLM).
      input_per_1m: price.input_per_1m,
      output_per_1m: price.output_per_1m,
      ...(price.cached_input_per_1m !== undefined ? { cached_input_per_1m: price.cached_input_per_1m } : {}),
      source_url: line.source_url,
      checked_on: line.checked_on,
      flags: orderedFlags([...evaluation.flags, ...cross.flags]),
      cross_check_verdict: cross.verdict,
      cross_check_value: cross.value,
      cross_check_source: input.crossCheckSource,
      cross_check_fetched_at: input.fetchedAt,
      cross_check_diff_pct: cross.diffPct,
    });
  }

  const providerOutcomes = ProviderOutcomesSchema.parse({
    openai: {
      outcome: openaiOutcome,
      fetched_at: input.fetchedAt,
      duration_ms: input.openai.durationMs,
      bytes: input.openai.bytes,
      lines_stored: submitLines.length,
      needs_manual: (parsed?.needsManual ?? []).slice(0, MAX_LIST_ITEMS),
      not_found: (parsed?.notFound ?? []).slice(0, MAX_LIST_ITEMS),
      refused: refused.slice(0, MAX_LIST_ITEMS),
      name_notes: (parsed?.nameNotes ?? []).slice(0, MAX_LIST_ITEMS),
    },
    anthropic: MANUAL_ONLY,
    google: MANUAL_ONLY,
    kimi: MANUAL_ONLY,
    litellm: {
      outcome: litellmOutcome,
      fetched_at: input.fetchedAt,
      duration_ms: input.litellm.durationMs,
      bytes: input.litellm.bytes,
      agrees: verdicts.agrees,
      differs: verdicts.differs,
      not_listed: verdicts.not_listed,
      unavailable: verdicts.unavailable,
    },
  });

  return { submitLines, providerOutcomes, problems, failedAnchor: parsed?.failedAnchor ?? null };
}
