'use client';

/**
 * The rates table (Admin Exchange Rates slice 1a, FR-1 to FR-4, FR-8, FR-9).
 *
 * Every currency with its rate as stored (a decimal string, never re-formatted
 * through a JS number), Enabled / Disabled and Stale in words (A-7: colour is
 * never the only signal), last updated in UTC with its age. An admin edits a
 * rate in a named text input or switches a currency on or off; the view's
 * handlers call the admin route and answer with an error message or null. On
 * failure the message shows beside the row and the stored rate stays as it was
 * (FR-9). USD has no edit and no switch-off (FR-4, SA-R8).
 *
 * `decimalPlaces` is a display hint only and does not shape the rate (SA §10
 * ruling 3). No fetch here.
 *
 * Slice 1e (§5.7.5, SA §13.7 SA-1e-1 / SA-1e-2, §13.8): one optional prop,
 * `sync`. Null (or absent) renders today's table exactly. After the first
 * successful sync of the visit it adds "Suggested rate" and "Gap" after "Rate
 * to USD", and the row's Actions gain "Accept suggestion" (or "Confirm (no
 * change)"). Each row's state is chosen by string comparison through
 * `sameRate`, never by parsing a number:
 *   USD "Base, always 1" · disabled "Not synced (disabled)" · enabled after
 *   the sync "Sync again to get a rate" · "No public rate" · "No usable rate" ·
 *   then (1) "Accepted" (in the accepted set, or the row now holds the
 *   suggestion where that differs from the sync's base) · (2) the gap as
 *   served, with Accept / Confirm, while the row still holds the sync's base ·
 *   (3) "Rate changed since the sync. Sync again.", no colour, no button.
 * The gap's colour always comes with its words and, for red and green, an icon
 * (A-7). The page prints the server's strings; nothing here is arithmetic, and
 * no amount is shown (D-5).
 */

import { useState } from 'react';

import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_BUTTON,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import {
  BASE_CURRENCY,
  RATE_MAX,
  STALE_DESCRIPTION,
  STALE_LABEL,
  ageInDays,
  isPositiveRate,
  isRateStale,
  sameRate,
  type ExchangeRateWire,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import {
  GAP_DIRECTION_WORDS,
  type ExchangeRateSyncPayload,
  type RateSuggestionWire,
} from '@/lib/admin/exchangeRates/rateSyncRules';

/** The visit's last successful sync and the codes accepted since it (SA-1e-1, SA-1e-2). */
export interface RateSyncView {
  answer: ExchangeRateSyncPayload;
  /** Codes accepted or confirmed on this page since that sync; the next sync clears them. */
  accepted: ReadonlySet<string>;
}

/** The words each non-gap state shows (§5.7.5, SA-1e-1). */
export const SUGGESTION_WORDS = {
  base: 'Base, always 1',
  disabled: 'Not synced (disabled)',
  notSynced: 'Sync again to get a rate',
  notInFeed: 'No public rate',
  noUsableRate: 'No usable rate',
  accepted: 'Accepted',
  rateChanged: 'Rate changed since the sync. Sync again.',
} as const;

type SuggestionState =
  | { kind: 'words'; words: string }
  | { kind: 'gap' | 'accepted' | 'changed'; suggestion: RateSuggestionWire & { suggestedRate: string } };

/** One row's state after a sync (§5.7.5 and SA-1e-1), by string comparison only. */
function suggestionState(rate: ExchangeRateWire, view: RateSyncView): SuggestionState {
  if (rate.currencyCode === BASE_CURRENCY) return { kind: 'words', words: SUGGESTION_WORDS.base };
  if (!rate.isEnabled) return { kind: 'words', words: SUGGESTION_WORDS.disabled };
  const found = view.answer.suggestions.find((entry) => entry.currencyCode === rate.currencyCode);
  if (!found) return { kind: 'words', words: SUGGESTION_WORDS.notSynced };
  if (found.status === 'not_in_feed') return { kind: 'words', words: SUGGESTION_WORDS.notInFeed };
  if (found.status !== 'suggested' || found.suggestedRate === null) {
    return { kind: 'words', words: SUGGESTION_WORDS.noUsableRate };
  }
  const suggestion = { ...found, suggestedRate: found.suggestedRate };
  const holdsSuggestion =
    !sameRate(suggestion.currentRate, suggestion.suggestedRate) && sameRate(rate.rateToUsd, suggestion.suggestedRate);
  if (view.accepted.has(rate.currencyCode) || holdsSuggestion) return { kind: 'accepted', suggestion };
  if (sameRate(rate.rateToUsd, suggestion.currentRate)) return { kind: 'gap', suggestion };
  return { kind: 'changed', suggestion };
}

/** "ECB · rates of 2026-10-23 · fetched 09:14 UTC": the time sliced from the ISO string (SA-1e-5). */
export function syncSourceLine(answer: ExchangeRateSyncPayload): string {
  return `${answer.source} · rates of ${answer.rateDate ?? '—'} · fetched ${answer.fetchedAt.slice(11, 16)} UTC`;
}

const GAP_TONE = { up: 'danger', down: 'ok', none: 'neutral' } as const;

export interface ExchangeRatesTableProps {
  rates: ExchangeRateWire[];
  readAt: string;
  /** Saves a rate; resolves to an error message, or null on success. */
  onSaveRate: (currencyCode: string, rate: string) => Promise<string | null>;
  /** Switches a currency on or off; resolves to an error message, or null on success. */
  onSetEnabled: (currencyCode: string, isEnabled: boolean) => Promise<string | null>;
  /** Filters the history panel to one currency (null: all). */
  onShowHistory: (currencyCode: string | null) => void;
  historyFor: string | null;
  /** Slice 1e: the visit's last successful sync; null or absent renders today's table. */
  sync?: RateSyncView | null;
  /** Slice 1e.2: accepts the row's suggestion; resolves to an error message, or null on success. */
  onAcceptSuggestion?: (currencyCode: string) => Promise<string | null>;
}

const RATE_HINT = `Up to 6 digits, a point and up to 6 decimals; above 0 and at most ${RATE_MAX}.`;

const INPUT =
  'w-36 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

function ageLine(lastUpdatedAt: string | null, readAt: string): string {
  const days = ageInDays(lastUpdatedAt, readAt);
  if (days === null) return 'never updated';
  if (days === 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function ExchangeRatesTable({
  rates,
  readAt,
  onSaveRate,
  onSetEnabled,
  onShowHistory,
  historyFor,
  sync = null,
  onAcceptSuggestion,
}: ExchangeRatesTableProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ code: string; message: string } | null>(null);

  const startEdit = (rate: ExchangeRateWire) => {
    setEditing(rate.currencyCode);
    setDraft(rate.rateToUsd);
    setRowError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
    setRowError(null);
  };

  const save = async (code: string) => {
    setBusy(code);
    setRowError(null);
    const message = await onSaveRate(code, draft.trim());
    setBusy(null);
    if (message) {
      // FR-9: the stored rate keeps showing; the typed value stays in the input.
      setRowError({ code, message });
      return;
    }
    setEditing(null);
    setDraft('');
  };

  const toggle = async (rate: ExchangeRateWire) => {
    setBusy(rate.currencyCode);
    setRowError(null);
    const message = await onSetEnabled(rate.currencyCode, !rate.isEnabled);
    setBusy(null);
    if (message) setRowError({ code: rate.currencyCode, message });
  };

  // Slice 1e.2: the row's own busy flag and error slot, as a save (FR-9).
  const accept = async (code: string) => {
    if (!onAcceptSuggestion) return;
    setBusy(code);
    setRowError(null);
    const message = await onAcceptSuggestion(code);
    setBusy(null);
    if (message) setRowError({ code, message });
  };

  return (
    <div id="exchange-rates-table" className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} aria-label="Exchange rates">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Currency</th>
            <th scope="col" className={ADMIN_TH}>Symbol</th>
            <th scope="col" className={ADMIN_TH_NUM}>Rate to USD</th>
            {sync && (
              <>
                <th scope="col" className={ADMIN_TH_NUM}>Suggested rate</th>
                <th scope="col" className={ADMIN_TH}>Gap</th>
              </>
            )}
            <th scope="col" className={ADMIN_TH}>Enabled</th>
            <th scope="col" className={ADMIN_TH}>Last updated</th>
            <th scope="col" className={ADMIN_TH}>Status</th>
            <th scope="col" className={ADMIN_TH}>Actions</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rates.map((rate) => {
            const code = rate.currencyCode;
            const isBase = code === BASE_CURRENCY;
            const isEditing = editing === code;
            const isBusy = busy === code;
            const stale = isRateStale(rate, readAt);
            const draftLooksValid = isPositiveRate(draft.trim());
            const error = rowError?.code === code ? rowError.message : null;
            const state = sync ? suggestionState(rate, sync) : null;

            return (
              <tr key={code} data-testid={`rate-row-${code}`}>
                <td className={ADMIN_TD}>
                  <div className="font-semibold text-white">{code}</div>
                  <div className="text-xs text-slate-400">{rate.currencyName}</div>
                </td>
                <td className={ADMIN_TD}>
                  <span className="font-mono">{rate.currencySymbol}</span>
                </td>
                <td className={ADMIN_TD_NUM}>
                  {isEditing ? (
                    <div className="flex flex-col items-end gap-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Rate to USD for ${code}`}
                        aria-describedby={`rate-hint-${code}`}
                        aria-invalid={error !== null || !draftLooksValid}
                        className={INPUT}
                        value={draft}
                        disabled={isBusy}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && draftLooksValid && !isBusy) void save(code);
                          if (event.key === 'Escape') cancelEdit();
                        }}
                      />
                      <span id={`rate-hint-${code}`} className="text-[11px] text-slate-400">
                        {RATE_HINT}
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono" data-testid={`rate-value-${code}`}>
                      {rate.rateToUsd}
                    </span>
                  )}
                </td>
                {sync && state && (
                  <>
                    <td className={ADMIN_TD_NUM} data-testid={`suggested-${code}`}>
                      {state.kind === 'words' ? (
                        <span className="text-xs text-slate-400">{state.words}</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono" data-testid={`suggested-rate-${code}`}>
                            {state.suggestion.suggestedRate}
                          </span>
                          <span className="text-[11px] text-slate-400">{syncSourceLine(sync.answer)}</span>
                        </div>
                      )}
                    </td>
                    <td className={ADMIN_TD} data-testid={`gap-${code}`}>
                      {state.kind === 'gap' && state.suggestion.direction ? (
                        <div className="flex flex-col items-start gap-1">
                          <StatusChip tone={GAP_TONE[state.suggestion.direction]} testId={`gap-chip-${code}`}>
                            {GAP_DIRECTION_WORDS[state.suggestion.direction]}
                          </StatusChip>
                          {state.suggestion.direction !== 'none' && (
                            <span className="whitespace-nowrap font-mono text-xs text-slate-300">
                              {state.suggestion.gapAbsolute} ({state.suggestion.gapPercent})
                            </span>
                          )}
                        </div>
                      ) : state.kind === 'accepted' ? (
                        <StatusChip tone="info" testId={`gap-chip-${code}`}>
                          {SUGGESTION_WORDS.accepted}
                        </StatusChip>
                      ) : state.kind === 'changed' ? (
                        <span className="text-xs text-slate-300" data-testid={`gap-changed-${code}`}>
                          {SUGGESTION_WORDS.rateChanged}
                        </span>
                      ) : (
                        <span className="text-slate-500" aria-label="No gap">
                          —
                        </span>
                      )}
                    </td>
                  </>
                )}
                <td className={ADMIN_TD}>
                  <StatusChip tone={rate.isEnabled ? 'ok' : 'neutral'} testId={`enabled-${code}`}>
                    {rate.isEnabled ? 'Enabled' : 'Disabled'}
                  </StatusChip>
                </td>
                <td className={ADMIN_TD}>
                  <div className="whitespace-nowrap">{formatUtc(rate.lastUpdatedAt)}</div>
                  <div className="text-xs text-slate-400">{ageLine(rate.lastUpdatedAt, readAt)}</div>
                </td>
                <td className={ADMIN_TD}>
                  {stale && (
                    <span title={STALE_DESCRIPTION} aria-label={`${STALE_LABEL}: ${STALE_DESCRIPTION}`}>
                      <StatusChip tone="warn" testId={`stale-${code}`}>
                        {STALE_LABEL}
                      </StatusChip>
                    </span>
                  )}
                </td>
                <td className={ADMIN_TD}>
                  <div className="flex flex-wrap items-center gap-2">
                    {isBase ? (
                      <span className="text-xs text-slate-400" data-testid="base-currency-note">
                        Base currency, fixed at 1
                      </span>
                    ) : isEditing ? (
                      <>
                        <button
                          type="button"
                          className={ADMIN_BUTTON}
                          disabled={isBusy || !draftLooksValid}
                          onClick={() => void save(code)}
                        >
                          {isBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className={ADMIN_BUTTON} disabled={isBusy} onClick={cancelEdit}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={ADMIN_BUTTON}
                          disabled={busy !== null}
                          aria-label={`Edit rate for ${code}`}
                          onClick={() => startEdit(rate)}
                        >
                          Edit rate
                        </button>
                        <button
                          type="button"
                          className={ADMIN_BUTTON}
                          disabled={busy !== null}
                          aria-label={`${rate.isEnabled ? 'Switch off' : 'Switch on'} ${code}`}
                          onClick={() => void toggle(rate)}
                        >
                          {isBusy ? 'Saving…' : rate.isEnabled ? 'Switch off' : 'Switch on'}
                        </button>
                      </>
                    )}
                    {/* Slice 1e.2: only in SA-1e-1 state (2), never while the row is being edited. */}
                    {state?.kind === 'gap' && onAcceptSuggestion && !isEditing && (
                      <button
                        type="button"
                        className={ADMIN_BUTTON}
                        disabled={busy !== null}
                        data-testid={`accept-${code}`}
                        aria-label={
                          state.suggestion.direction === 'none'
                            ? `Confirm (no change) for ${code} rate ${state.suggestion.suggestedRate}`
                            : `Accept suggested ${code} rate ${state.suggestion.suggestedRate}`
                        }
                        onClick={() => void accept(code)}
                      >
                        {isBusy ? 'Saving…' : state.suggestion.direction === 'none' ? 'Confirm (no change)' : 'Accept suggestion'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={ADMIN_BUTTON}
                      aria-pressed={historyFor === code}
                      aria-label={`History for ${code}`}
                      onClick={() => onShowHistory(historyFor === code ? null : code)}
                    >
                      History
                    </button>
                  </div>
                  {error && (
                    <p role="alert" className="mt-1 text-xs text-red-300" data-testid={`row-error-${code}`}>
                      {error}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
