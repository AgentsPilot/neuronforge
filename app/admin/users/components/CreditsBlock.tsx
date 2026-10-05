'use client';

/**
 * The Credits block of the Businesses panel (credit deduction slice 11c,
 * workplan §11c.3.5; requirement S11-AC-6 as corrected by S11-CR-3, S11-D-8 B).
 *
 * Reads `GET /api/admin/business-os/credits/accounts/<id>` on its own, so the
 * panel's other reads and their tests are untouched, and shows, as SEPARATE
 * figures, in credits:
 *   - the plan allowance and the resolver layer that set it, in plain words,
 *     with the raw layer (the vocabulary of the Plan & entitlements table, SA
 *     OP-31) on hover;
 *   - used this period, by the owner and automatic;
 *   - plan left, and over the plan this period (only when above zero);
 *   - extra credits, and every gift with its take-backs.
 *
 * Never a total of plan left and extra credits (S11-CR-3: that figure belongs
 * to slice 9), and no share, band or "running low" line (SA W11c-14). A block
 * the server could not read says so; it never shows zeros.
 *
 * The Give / Take back buttons open `CreditFormDialog`. They are hidden on the
 * admin's own account (the server refuses it regardless, 403 `own_account`).
 * A success closes the dialog and shows the server's result as a status line
 * here, while the figures are read again.
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

import {
  CREDIT_COPY,
  allowanceLayerLabel,
  creditErrorSentence,
  exactCredits,
  formatCredits,
  formatUtc,
  shortId,
} from '../creditCopy';
import type { AccountCreditPositionPayload, CreditLotView, CreditUsageBlockView } from '../types';
import { CreditFormDialog, type CreditFormMode } from './CreditFormDialog';

type Load = { state: 'loading' } | { state: 'ok'; data: AccountCreditPositionPayload } | { state: 'error'; code: string };

/** GET and read JSON; never throws. A non-JSON answer is an unknown failure. */
async function readPosition(url: string): Promise<Load> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!response.ok || record?.success !== true || !record.data) {
      return { state: 'error', code: typeof record?.error === 'string' ? record.error : 'unknown' };
    }
    return { state: 'ok', data: record.data as AccountCreditPositionPayload };
  } catch {
    return { state: 'error', code: 'unknown' };
  }
}

/** A figure with its exact value on hover. */
function Credits({ value, testId }: { value: number; testId?: string }) {
  return (
    <span data-testid={testId} title={exactCredits(value)} className="font-semibold text-white">
      {formatCredits(value)}
    </span>
  );
}

function periodLabel(usage: Extract<CreditUsageBlockView, { status: 'ok' }>): string {
  switch (usage.period.kind) {
    case 'trial_total':
      return `Used in the trial so far (since ${formatUtc(usage.period.key)})`;
    case 'calendar_month':
      return 'Used this calendar month (no plan period)';
    default:
      return 'Used this billing period';
  }
}

function UsageSection({ usage }: { usage: CreditUsageBlockView }) {
  if (usage.status === 'error') {
    return (
      <p data-testid="credits-usage-error" className="text-sm text-rose-300">
        {CREDIT_COPY.usageError}
      </p>
    );
  }
  return (
    <dl data-testid="credits-usage" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-300">
      <dt className="text-slate-400">Plan allowance</dt>
      <dd data-testid="credits-allowance">
        {usage.allowanceStatus === 'unavailable' ? (
          <span className="text-amber-300">{CREDIT_COPY.allowanceUnavailable}</span>
        ) : usage.allowance === null ? (
          CREDIT_COPY.noAllowance
        ) : (
          <>
            <Credits value={usage.allowance.amount} /> {usage.allowance.per === 'month' ? 'per month' : 'in total (trial)'}
            {usage.allowanceLayer && (
              <span className="ml-2 text-slate-400">
                {CREDIT_COPY.setBy}:{' '}
                {/* The raw layer on hover, to match the Plan & entitlements table. */}
                <span data-testid="credits-allowance-layer" title={usage.allowanceLayer}>
                  {allowanceLayerLabel(usage.allowanceLayer)}
                </span>
              </span>
            )}
          </>
        )}
      </dd>

      <dt className="text-slate-400">{periodLabel(usage)}</dt>
      <dd data-testid="credits-used">
        <Credits value={usage.used} />
        <span className="ml-2 text-slate-400">
          by the owner <Credits value={usage.usedByOwner} /> · automatic <Credits value={usage.usedAutomatic} />
        </span>
        {usage.period.resetsOn && <span className="ml-2 text-slate-400">· resets on {formatUtc(usage.period.resetsOn)}</span>}
      </dd>

      {usage.planLeft !== null && (
        <>
          <dt className="text-slate-400">Plan left</dt>
          <dd data-testid="credits-plan-left">
            <Credits value={usage.planLeft} />
          </dd>
        </>
      )}

      {usage.overPlan !== null && usage.overPlan > 0 && (
        <>
          <dt className="text-slate-400">Over the plan this period</dt>
          <dd data-testid="credits-over-plan">
            <Credits value={usage.overPlan} />
            <span className="ml-2 text-slate-400">{CREDIT_COPY.overPlanNote}</span>
          </dd>
        </>
      )}
    </dl>
  );
}

function LotRow({
  lot,
  canChange,
  onTakeBack,
}: {
  lot: CreditLotView;
  canChange: boolean;
  onTakeBack: (lot: CreditLotView) => void;
}) {
  const takeBackable = canChange && lot.counted && !lot.expired && lot.remaining > 0;
  return (
    <li data-testid="credits-lot" className="rounded border border-slate-700/60 bg-slate-900/40 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
        <span className="text-white">{lot.source === 'boost_purchase' ? CREDIT_COPY.sourceBoost : CREDIT_COPY.sourceAdmin}</span>
        <span>
          <Credits value={lot.credits} /> given · <Credits value={lot.remaining} /> left
        </span>
        <span data-testid="credits-lot-end">
          {lot.expiresAt === null ? CREDIT_COPY.noEndDate : `ends ${formatUtc(lot.expiresAt)}`}
        </span>
        {lot.expired && (
          <span data-testid="credits-lot-expired" className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200">
            {CREDIT_COPY.expired}
          </span>
        )}
        {!lot.counted && <span className="text-xs text-amber-300">{CREDIT_COPY.notCountedYet}</span>}
        <span className="text-slate-400">
          by{' '}
          {lot.actorKind === 'stripe_webhook' ? (
            'a payment'
          ) : lot.actorAdminId ? (
            <span className="font-mono" title={lot.actorAdminId}>
              admin {shortId(lot.actorAdminId)}
            </span>
          ) : (
            'an admin'
          )}{' '}
          on {formatUtc(lot.createdAt)}
        </span>
        {takeBackable && (
          <button
            type="button"
            data-testid="credits-take-back"
            onClick={() => onTakeBack(lot)}
            className="ml-auto rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50"
          >
            {CREDIT_COPY.takeBackButton}
          </button>
        )}
      </div>
      {lot.reason && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-400">Reason: {lot.reason}</p>}
      {lot.takeBacks.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-l border-slate-700 pl-3 text-xs text-slate-400">
          {lot.takeBacks.map((takeBack) => (
            <li key={takeBack.id} data-testid="credits-take-back-row">
              Took back <Credits value={takeBack.credits} /> on {formatUtc(takeBack.createdAt)}
              {takeBack.actorAdminId && (
                <span className="font-mono" title={takeBack.actorAdminId}>
                  {' '}
                  by admin {shortId(takeBack.actorAdminId)}
                </span>
              )}
              {takeBack.reason && <span className="whitespace-pre-wrap break-words">: {takeBack.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface Props {
  accountId: string;
  /** The business name when the summary named one, otherwise the account id. */
  businessLabel: string;
}

export function CreditsBlock({ accountId, businessLabel }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<CreditFormMode | null>(null);
  // The last success's sentences, built by the dialog from the response. Shown
  // outside the `ok` branch so a failed re-read cannot hide them (QA11c-2);
  // cleared when dismissed or when a dialog opens again.
  const [notice, setNotice] = useState<string[] | null>(null);
  // The limits from the last good read, so a dialog can open from them.
  const [limits, setLimits] = useState<AccountCreditPositionPayload['limits'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPosition(`/api/admin/business-os/credits/accounts/${encodeURIComponent(accountId)}`).then((result) => {
      if (cancelled) return;
      setLoad(result);
      if (result.state === 'ok') setLimits(result.data.limits);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  function openDialog(mode: CreditFormMode) {
    setNotice(null);
    setDialog(mode);
  }

  /** A success closes the dialog, shows the server's figures, and reads the block again. */
  function handleSuccess(lines: string[]) {
    setDialog(null);
    setNotice(lines);
    reload();
  }

  return (
    <div data-testid="credits-block">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <Coins className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {CREDIT_COPY.heading}
      </h4>

      {notice && (
        <div
          data-testid="credits-success"
          role="status"
          className="mt-2 flex items-start gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-200"
        >
          <div className="flex-1">
            {notice.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <button
            type="button"
            data-testid="credits-success-dismiss"
            aria-label={CREDIT_COPY.dismiss}
            onClick={() => setNotice(null)}
            className="rounded px-1 text-emerald-300 hover:bg-emerald-500/20"
          >
            ×
          </button>
        </div>
      )}

      {load.state === 'loading' && <p className="mt-2 text-sm text-slate-400">{CREDIT_COPY.loading}</p>}

      {load.state === 'error' && (
        <p data-testid="credits-error" className="mt-2 text-sm text-rose-300">
          {creditErrorSentence(load.code)}
        </p>
      )}

      {load.state === 'ok' && (
        <div className="mt-2 space-y-3">
          <UsageSection usage={load.data.usage} />

          {load.data.extra.status === 'error' ? (
            <p data-testid="credits-extra-error" className="text-sm text-rose-300">
              {CREDIT_COPY.extraError}
            </p>
          ) : (
            <div data-testid="credits-extra" className="space-y-2">
              <p className="text-sm text-slate-300">
                <span className="text-slate-400">Extra credits</span>{' '}
                <Credits value={load.data.extra.extraCredits} testId="credits-extra-figure" />
                <span className="ml-2 text-xs text-slate-400">{CREDIT_COPY.extraNote}</span>
              </p>
              {load.data.extra.hasInconsistentLot && (
                <p data-testid="credits-inconsistent" className="text-xs text-amber-300">
                  {CREDIT_COPY.inconsistentLot}
                </p>
              )}
              {load.data.extra.lots.length === 0 ? (
                <p data-testid="credits-no-lots" className="text-sm text-slate-400">
                  {CREDIT_COPY.noLots}
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {load.data.extra.lots.map((lot) => (
                      <LotRow
                        key={lot.id}
                        lot={lot}
                        canChange={!load.data.isOwnAccount}
                        onTakeBack={(chosen) => openDialog({ kind: 'take_back', lot: chosen })}
                      />
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500">{CREDIT_COPY.datesNote}</p>
                </>
              )}
            </div>
          )}

          {load.data.isOwnAccount ? (
            <p data-testid="credits-own-account" className="text-sm text-slate-400">
              {creditErrorSentence('own_account')}
            </p>
          ) : (
            <button
              type="button"
              data-testid="credits-give"
              onClick={() => openDialog({ kind: 'give' })}
              className="rounded border border-emerald-500/50 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10"
            >
              {CREDIT_COPY.giveButton}
            </button>
          )}
        </div>
      )}

      {dialog && limits && (
        <CreditFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          mode={dialog}
          accountId={accountId}
          businessLabel={businessLabel}
          limits={limits}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
