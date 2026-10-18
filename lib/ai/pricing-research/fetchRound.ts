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
 *
 * Slice 10 (SA O-4, SC10-6): provider-generic. One round reads every adapter
 * provider (`PRICE_ADAPTERS`: OpenAI and Anthropic) and holds every line of
 * every provider that succeeded. Each provider keeps its own outcome, lines,
 * refused list and failed anchor, so one provider failing never stops the
 * other's lines. Google and Kimi stay manual entry (BQ-4).
 */

import type { AiPriceSubmitLine } from '@/lib/repositories/types';

import {
  ADAPTER_PROVIDERS,
  MAX_LIST_ITEMS,
  ProviderOutcomesSchema,
  type AdapterOutcome,
  type AdapterProvider,
  type ProviderOutcomes,
  type RefusedEntry,
} from './fetchOutcomes';
import type { FetchResult } from './fetchSources';
import { crossCheckLine, parseLiteLlmList, type CrossCheckVerdict, type LiteLlmList } from './litellmCrossCheck';
import { evaluatePendingLine, PENDING_LINE_FLAGS, type LineFlagContext, type PendingLineFlag } from './lineFlags';
import { PendingLineSchema, type PendingLineInput } from './pendingLineSchema';
import { PRICE_ADAPTERS, type AdapterParseResult } from './priceAdapters';

type SnapshotFields = Omit<AiPriceSubmitLine, 'kind' | 'provider' | 'model_name' | 'source_url' | 'checked_on' | 'flags'>;

/** One adapter provider's part of the round. */
export interface ProviderFetchInput {
  result: FetchResult;
  /** This provider's model ids in the coverage set. */
  coverage: ReadonlySet<string>;
  isInputOnly: (model: string) => boolean;
  /** The human pricing page stored as each line's source (MP-FR-3). */
  sourceUrl: string;
}

export interface FetchRoundInput {
  providers: { readonly [P in AdapterProvider]: ProviderFetchInput };
  litellm: FetchResult;
  contextFor: (line: PendingLineInput) => { context: LineFlagContext; snapshotFields: SnapshotFields };
  /** The cross-check list's URL, stored as `cross_check_source`. */
  crossCheckSource: string;
  /** UTC date, YYYY-MM-DD. */
  checkedOn: string;
  /** ISO time the round started (the fetches ran in parallel from it). */
  fetchedAt: string;
}

export interface FetchRoundProblem {
  provider: AdapterProvider;
  model_name: string;
  messages: string[];
}

export interface FetchRoundResult {
  submitLines: AiPriceSubmitLine[];
  providerOutcomes: ProviderOutcomes;
  problems: FetchRoundProblem[];
  /** For the log lines only: each provider whose page failed an anchor (SC10-6). */
  failedAnchors: Array<{ provider: AdapterProvider; anchor: string }>;
}

function orderedFlags(flags: readonly PendingLineFlag[]): PendingLineFlag[] {
  const set = new Set(flags);
  return PENDING_LINE_FLAGS.filter((flag) => set.has(flag));
}

/** Google and Kimi (BQ-4): manual entry for now, see `PROVIDER_FETCH_MODE`. */
const MANUAL_ONLY = { outcome: 'manual_only' as const };

interface ProviderPart {
  lines: AiPriceSubmitLine[];
  outcome: AdapterOutcome;
  problems: FetchRoundProblem[];
  failedAnchor: string | null;
}

function buildProviderPart(
  provider: AdapterProvider,
  part: ProviderFetchInput,
  list: LiteLlmList | null,
  verdicts: Record<CrossCheckVerdict, number>,
  input: FetchRoundInput
): ProviderPart {
  const parsed: AdapterParseResult | null =
    part.result.outcome === 'ok' && part.result.text !== undefined
      ? PRICE_ADAPTERS[provider].parse(part.result.text, { coverage: part.coverage, isInputOnly: part.isInputOnly })
      : null;
  const outcome = parsed && parsed.outcome === 'layout_changed' ? 'layout_changed' : part.result.outcome;
  const cacheListed = new Set(parsed?.cacheListed ?? []);

  const lines: AiPriceSubmitLine[] = [];
  const refused: RefusedEntry[] = [];
  const problems: FetchRoundProblem[] = [];

  for (const price of parsed?.outcome === 'ok' ? parsed.lines : []) {
    const candidate = {
      kind: 'token' as const,
      provider,
      model_name: price.model_name,
      input_per_1m: price.input_per_1m,
      output_per_1m: price.output_per_1m,
      ...(price.cached_input_per_1m !== undefined ? { cached_input_per_1m: price.cached_input_per_1m } : {}),
      source_url: part.sourceUrl,
      checked_on: input.checkedOn,
    };
    const valid = PendingLineSchema.safeParse(candidate);
    if (!valid.success) {
      refused.push({ model_name: price.model_name, reason: 'invalid_line' });
      problems.push({ provider, model_name: price.model_name, messages: valid.error.issues.map((issue) => issue.message) });
      continue;
    }
    const line = valid.data;
    const { context, snapshotFields } = input.contextFor(line);
    const evaluation = evaluatePendingLine(line, context);
    if (evaluation.refusals.length > 0) {
      refused.push({ model_name: price.model_name, reason: 'refused_by_bounds' });
      problems.push({ provider, model_name: price.model_name, messages: evaluation.refusals });
      continue;
    }

    const cross = crossCheckLine(list, provider, price);
    verdicts[cross.verdict] += 1;
    // SA O-3: the page lists a cache price we deliberately do not propose; the flag records that it exists.
    const listedOnly: PendingLineFlag[] = cacheListed.has(price.model_name) ? ['cached_input_listed'] : [];
    lines.push({
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
      flags: orderedFlags([...evaluation.flags, ...listedOnly, ...cross.flags]),
      cross_check_verdict: cross.verdict,
      cross_check_value: cross.value,
      cross_check_source: input.crossCheckSource,
      cross_check_fetched_at: input.fetchedAt,
      cross_check_diff_pct: cross.diffPct,
    });
  }

  return {
    lines,
    problems,
    failedAnchor: parsed?.failedAnchor ?? null,
    outcome: {
      outcome,
      fetched_at: input.fetchedAt,
      duration_ms: part.result.durationMs,
      bytes: part.result.bytes,
      lines_stored: lines.length,
      needs_manual: (parsed?.needsManual ?? []).slice(0, MAX_LIST_ITEMS),
      not_found: (parsed?.notFound ?? []).slice(0, MAX_LIST_ITEMS),
      refused: refused.slice(0, MAX_LIST_ITEMS),
      name_notes: (parsed?.nameNotes ?? []).slice(0, MAX_LIST_ITEMS),
    },
  };
}

export function buildFetchRound(input: FetchRoundInput): FetchRoundResult {
  const list = input.litellm.outcome === 'ok' && input.litellm.text !== undefined ? parseLiteLlmList(input.litellm.text) : null;
  const litellmOutcome = input.litellm.outcome === 'ok' && !list ? 'layout_changed' : input.litellm.outcome;
  const verdicts: Record<CrossCheckVerdict, number> = { agrees: 0, differs: 0, not_listed: 0, unavailable: 0 };

  const parts = {} as Record<AdapterProvider, ProviderPart>;
  for (const provider of ADAPTER_PROVIDERS) {
    parts[provider] = buildProviderPart(provider, input.providers[provider], list, verdicts, input);
  }

  const providerOutcomes = ProviderOutcomesSchema.parse({
    openai: parts.openai.outcome,
    anthropic: parts.anthropic.outcome,
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

  return {
    submitLines: ADAPTER_PROVIDERS.flatMap((provider) => parts[provider].lines),
    providerOutcomes,
    problems: ADAPTER_PROVIDERS.flatMap((provider) => parts[provider].problems),
    failedAnchors: ADAPTER_PROVIDERS.flatMap((provider) => {
      const anchor = parts[provider].failedAnchor;
      return anchor ? [{ provider, anchor }] : [];
    }),
  };
}
