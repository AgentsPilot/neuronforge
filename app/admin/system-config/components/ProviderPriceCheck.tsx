'use client';

/**
 * "Check provider prices" (AI model price review slice 5; MP-FR-12 as amended
 * by UF-1, SA RR-1 monitoring, SC-12, SC-13).
 *
 * One button and one status block:
 *   - the button is disabled and `aria-busy` while a check runs;
 *   - per provider: OpenAI's last result (prices read, or why not, with the
 *     time), its last success and last failure; Anthropic, Google and Kimi
 *     "manual entry for now"; the LiteLLM cross-check counts; images manual;
 *   - a refusal (for example the 60 s guard) is shown in the alert box with
 *     the server's own words.
 * After a stored check, `onFinished` re-reads the price table.
 *
 * Types only from the pricing-research modules (SA SC-14); no number parsing
 * in this browser file (RC-8): counts arrive as JSON numbers and are printed.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { readFetchStatus, runPriceFetch } from '@/app/admin/system-config/priceFetchRun';
import {
  NEEDS_MANUAL_WORDS,
  PRICE_CHECK_WORDS,
  PROVIDER_NAMES,
  sourceOutcomeWords,
} from '@/app/admin/system-config/priceReviewCopy';
import type { FetchRunSummary, FetchStatus, SourceStatus } from '@/lib/ai/pricing-research/fetchOutcomes';
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

function openaiLine(status: SourceStatus): string {
  const name = PROVIDER_NAMES.openai;
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

export interface ProviderPriceCheckProps {
  /** Called after a check is stored, so the page re-reads the price table. */
  onFinished: () => void;
}

export default function ProviderPriceCheck({ onFinished }: ProviderPriceCheckProps) {
  const [status, setStatus] = useState<FetchStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [summary, setSummary] = useState<FetchRunSummary | null>(null);

  const loadStatus = useCallback(async () => {
    const result = await readFetchStatus();
    if (result.ok) {
      setStatus(result.data);
      setStatusFailed(false);
    } else {
      setStatusFailed(true);
    }
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

  const openai = summary?.providerOutcomes.openai;

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
            <p className={LINE}>{openaiLine(status.openai)}</p>
            {historyLines(status.openai).map((line) => (
              <p key={line} className={MUTED}>
                {line}
              </p>
            ))}
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
        {openai && openai.needs_manual.length > 0 && (
          <ul aria-label={PRICE_CHECK_WORDS.needsManualList} className="list-disc pl-5 text-xs text-amber-200">
            {openai.needs_manual.map((entry) => (
              <li key={`${entry.model_name}-${entry.reason}`}>
                {`${PRICE_CHECK_WORDS.needsManualList}: ${entry.model_name} (${NEEDS_MANUAL_WORDS[entry.reason] ?? entry.reason}${entry.cell ? `: "${entry.cell}"` : ''})`}
              </li>
            ))}
          </ul>
        )}
        {openai && openai.not_found.length > 0 && (
          <p className={MUTED}>{`${PRICE_CHECK_WORDS.notFoundList}: ${openai.not_found.join(', ')}`}</p>
        )}
      </div>
    </section>
  );
}
