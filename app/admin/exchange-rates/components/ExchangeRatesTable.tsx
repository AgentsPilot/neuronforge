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
  type ExchangeRateWire,
} from '@/lib/admin/exchangeRates/exchangeRateRules';

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

  return (
    <div id="exchange-rates-table" className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} aria-label="Exchange rates">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Currency</th>
            <th scope="col" className={ADMIN_TH}>Symbol</th>
            <th scope="col" className={ADMIN_TH_NUM}>Rate to USD</th>
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
