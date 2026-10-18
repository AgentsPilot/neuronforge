'use client';

/**
 * "Check provider prices" (AI model price review slice 5; MP-FR-12 as amended
 * by UF-1, SA RR-1 monitoring, SC-12, SC-13).
 *
 * One button and one status block:
 *   - the button is disabled and `aria-busy` while a check runs;
 *   - per provider: OpenAI's and Anthropic's last result (prices read, or why
 *     not, with the time), each with its last success and last failure
 *     (slice 10); Google and Kimi "manual entry for now"; the LiteLLM
 *     cross-check counts; images manual;
 *   - after a check: the models needing manual entry and those not on the
 *     page, grouped by provider, and Anthropic's page notes (shown, never
 *     interpreted: SA O-6);
 *   - a refusal (for example the 60 s guard) is shown in the alert box with
 *     the server's own words.
 * After a stored check, `onFinished` re-reads the price table.
 *
 * Types only from the pricing-research modules (SA SC-14); no number parsing
 * in this browser file (RC-8): counts arrive as JSON numbers and are printed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { readFetchStatus, runPriceFetch } from '@/app/admin/system-config/priceFetchRun';
import {
  NEEDS_MANUAL_WORDS,
  PRICE_CHECK_WORDS,
  PROVIDER_NAMES,
  sourceOutcomeWords,
} from '@/app/admin/system-config/priceReviewCopy';
// One line on purpose: the RC-1 source rule reads the `import type {` on the line naming the module.
import type { AdapterOutcome, AdapterProvider, FetchRunSummary, FetchStatus, SourceStatus } from '@/lib/ai/pricing-research/fetchOutcomes';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AdminProviderPriceCheck' });

const LINE = 'text-sm text-slate-200';
const MUTED = 'text-xs text-slate-400';

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function historyLines(status: SourceStatus): string[] {
  const lines: string[] = [];
  if (status.lastOkAt) lines.push(`${PRICE_CHECK_WORDS.lastSuccess} ${formatUtc(status.lastOkAt)}`);
  if (status.lastFailure) {
    lines.push(
      `${PRICE_CHECK_WORDS.lastFailure} ${sourceOutcomeWords(status.lastFailure.outcome)} ${PRICE_CHECK_WORDS.at} ${formatUtc(status.lastFailure.at)}`
    );
  }
  return lines;
}

/** The automatically checked providers, in display order (names only; the server owns the list). */
const ADAPTER_ORDER: readonly AdapterProvider[] = ['openai', 'anthropic'];
/** Providers whose page notes carry status worth showing (Anthropic's "retired, except on …"). */
const NOTE_PROVIDERS: readonly AdapterProvider[] = ['anthropic'];

function providerLine(provider: AdapterProvider, status: SourceStatus): string {
  const name = PROVIDER_NAMES[provider] ?? provider;
  const run = status.lastRun;
  if (!run) return `${name}: ${PRICE_CHECK_WORDS.notChecked}`;
  if (run.outcome !== 'ok') {
    return `${name}: ${sourceOutcomeWords(run.outcome)} ${PRICE_CHECK_WORDS.at} ${formatUtc(run.at)}. ${PRICE_CHECK_WORDS.enterByHand}`;
  }
  const counts = status.lastRunCounts;
  const parts = [`${name}: ${counts ? counts.linesStored : 0} ${PRICE_CHECK_WORDS.pricesRead} ${formatUtc(run.at)}`];
  if (counts && counts.needsManual > 0) parts.push(`${counts.needsManual} ${PRICE_CHECK_WORDS.needManual}`);
  if (counts && counts.notFound > 0) parts.push(`${counts.notFound} ${PRICE_CHECK_WORDS.notOnPage}`);
  if (counts && counts.refused > 0) parts.push(`${counts.refused} ${PRICE_CHECK_WORDS.refused}`);
  return parts.join('; ');
}

function crossCheckLine(status: SourceStatus): string | null {
  const run = status.lastRun;
  if (!run) return null;
  if (run.outcome !== 'ok') {
    return `${PRICE_CHECK_WORDS.crossCheckName} ${PRICE_CHECK_WORDS.crossCheckUnavailable} (${sourceOutcomeWords(run.outcome)}).`;
  }
  const verdicts = status.lastRunVerdicts;
  if (!verdicts) return null;
  return `${PRICE_CHECK_WORDS.crossCheckName} ${verdicts.agrees} ${PRICE_CHECK_WORDS.agree}, ${verdicts.differs} ${PRICE_CHECK_WORDS.differ}, ${verdicts.notListed} ${PRICE_CHECK_WORDS.notListed}.`;
}

/**
 * A provider's adapter outcome from a check summary, or null when it has none
 * (SC10-8: a response from before slice 10 holds Anthropic `manual_only`).
 */
function adapterOutcomeOf(summary: FetchRunSummary | null, provider: AdapterProvider): AdapterOutcome | null {
  const outcome: unknown = summary?.providerOutcomes[provider];
  if (typeof outcome !== 'object' || outcome === null) return null;
  const candidate = outcome as Partial<AdapterOutcome>;
  return Array.isArray(candidate.needs_manual) && Array.isArray(candidate.not_found) ? (outcome as AdapterOutcome) : null;
}

/** A status from before slice 10 has no `anthropic` key: that provider is simply not drawn. */
function statusOfProvider(status: FetchStatus, provider: AdapterProvider): SourceStatus | null {
  const source: SourceStatus | undefined = status[provider];
  return source ?? null;
}

export interface ProviderPriceCheckProps {
  /** Called after a check is stored, so the page re-reads the price table. */
  onFinished: () => void;
  /**
   * Page layout slice (UF-7): hands the page every status read, so its "Last
   * provider check" KPI uses this same read and no second request. `null`
   * when the read failed.
   */
  onStatus?: (status: FetchStatus | null) => void;
}

export default function ProviderPriceCheck({ onFinished, onStatus }: ProviderPriceCheckProps) {
  const [status, setStatus] = useState<FetchStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [summary, setSummary] = useState<FetchRunSummary | null>(null);

  // A ref, so a new `onStatus` function on every page render never re-runs the mount read.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const loadStatus = useCallback(async () => {
    const result = await readFetchStatus();
    if (result.ok) {
      setStatus(result.data);
      setStatusFailed(false);
    } else {
      setStatusFailed(true);
    }
    onStatusRef.current?.(result.ok ? result.data : null);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCheck = async () => {
    setRunning(true);
    setRefusal(null);
    try {
      const result = await runPriceFetch();
      if (!result.ok) {
        logger.warn({ status: result.status }, 'Provider price check refused');
        setRefusal(result.message);
        return;
      }
      setSummary(result.data);
      await loadStatus();
      onFinished();
    } finally {
      setRunning(false);
    }
  };

  const ran = ADAPTER_ORDER.flatMap((provider) => {
    const outcome = adapterOutcomeOf(summary, provider);
    return outcome ? [{ provider, name: PROVIDER_NAMES[provider] ?? provider, outcome }] : [];
  });

  return (
    <section aria-labelledby="price-check-heading" className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="price-check-heading" className="text-sm font-medium text-white">
          {PRICE_CHECK_WORDS.heading}
        </h3>
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={running}
          aria-busy={running || undefined}
          className={ADMIN_BUTTON}
          data-testid="price-check-button"
        >
          {running ? PRICE_CHECK_WORDS.busy : PRICE_CHECK_WORDS.button}
        </button>
      </div>

      {refusal && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {refusal}
        </div>
      )}

      {/* Always mounted, so a screen reader announces new text. */}
      <div role="status" data-testid="price-check-status" className="space-y-1">
        {statusFailed && <p className={MUTED}>{PRICE_CHECK_WORDS.statusUnavailable}</p>}
        {status && (
          <>
            {ADAPTER_ORDER.map((provider) => {
              const source = statusOfProvider(status, provider);
              if (!source) return null;
              return (
                <div key={provider} data-testid={`price-check-${provider}`}>
                  <p className={LINE}>{providerLine(provider, source)}</p>
                  {historyLines(source).map((line) => (
                    <p key={line} className={MUTED}>
                      {line}
                    </p>
                  ))}
                </div>
              );
            })}
            {status.manualProviders.length > 0 && (
              <p className={LINE}>
                {`${listNames(status.manualProviders.map((provider) => PROVIDER_NAMES[provider] ?? provider))}: ${PRICE_CHECK_WORDS.manualForNow}`}
              </p>
            )}
            {crossCheckLine(status.litellm) && <p className={LINE}>{crossCheckLine(status.litellm)}</p>}
            {/* SA F-6: the second list's last success and last failure too (RR-1 monitoring). */}
            {historyLines(status.litellm).map((line) => (
              <p key={`litellm-${line}`} className={MUTED} data-testid="litellm-history">
                {line}
              </p>
            ))}
            <p className={MUTED}>{PRICE_CHECK_WORDS.images}</p>
          </>
        )}
        {summary && <p className={MUTED}>{PRICE_CHECK_WORDS.stored}</p>}
        {ran.map(({ provider, name, outcome }) => (
          <div key={provider} data-testid={`price-check-run-${provider}`} className="space-y-1">
            {outcome.needs_manual.length > 0 && (
              <ul aria-label={`${name}: ${PRICE_CHECK_WORDS.needsManualList}`} className="list-disc pl-5 text-xs text-amber-200">
                {outcome.needs_manual.map((entry) => (
                  <li key={`${entry.model_name}-${entry.reason}`}>
                    {`${name}: ${PRICE_CHECK_WORDS.needsManualList}: ${entry.model_name} (${NEEDS_MANUAL_WORDS[entry.reason] ?? entry.reason}${entry.cell ? `: "${entry.cell}"` : ''})`}
                  </li>
                ))}
              </ul>
            )}
            {outcome.not_found.length > 0 && (
              <p className={MUTED}>{`${name}: ${PRICE_CHECK_WORDS.notFoundList}: ${outcome.not_found.join(', ')}`}</p>
            )}
            {NOTE_PROVIDERS.includes(provider) && outcome.name_notes.length > 0 && (
              <ul aria-label={`${name} ${PRICE_CHECK_WORDS.pageNotes}`} className="list-none text-xs text-slate-400">
                {outcome.name_notes.map((entry) => (
                  <li key={entry.model_name}>{`${name} ${PRICE_CHECK_WORDS.pageNotes}: ${entry.model_name}: ${entry.note}`}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
