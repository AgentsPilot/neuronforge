'use client';

/**
 * Give credits / Take back, for ONE account (credit deduction slice 11c,
 * workplan §11c.3.5; requirement S11-D-2 C, S11-D-5, S11-D-6 A, S11-D-7 A,
 * S11-D-8 B, S11-SQ-1 (e); SA W11c-7, W11c-8, W11c-10).
 *
 * Both modes POST to the EXISTING admin entitlements route (slice 11b's
 * `grant_credits` / `reduce_credit_lot`); the server is the authority for every
 * rule, and these checks only stop an obvious mistake early.
 *
 *   - Request id: minted when the dialog opens, kept across every failed
 *     attempt (network error, 5xx, any refusal: a refusal wrote nothing, and a
 *     retry after a lost answer either replays or is refused as a conflict, so
 *     it can never record twice). A success closes the dialog, so the next
 *     opening mints a new one (SA OP-32).
 *   - A first step ("Continue"), then a confirm step that names the business
 *     and restates the change ("Confirm").
 *   - On success the result sentences are handed to the block, which closes
 *     the dialog and shows them as its status line. They are built from what
 *     the SERVER returned, never what was typed: on a replay those can differ
 *     (QA11b-N2); after a take-back, "N left on this gift" is the response's
 *     `lotRemainingAfter` (CR11c-2).
 *   - One POST at a time: submit is disabled while one is in flight, and the
 *     dialog cannot be closed (Esc, overlay, X, Close, Back) until it answers.
 *     Closing mid-POST and reopening would mint a new request id, so a second
 *     Confirm could record the same change twice (CR11c-1 / QA11c-1).
 *
 * The shared Dialog primitive falls back to light colours on the admin shell,
 * which does not load the `--v2-*` tokens; the `!` classes override that
 * (the `ArchiveConfirmDialog` precedent). Free text (the reason) is rendered
 * as text only.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { CREDIT_COPY, creditErrorSentence, formatCredits, formatUtc } from '../creditCopy';
import type { AccountCreditPositionPayload, CreditLotView } from '../types';

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';
const DARK_INPUT = '!border-slate-600 !bg-slate-800 !text-white';

type Limits = AccountCreditPositionPayload['limits'];

type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; details: Record<string, unknown> | null };

/** POST and read JSON; never throws. A non-JSON answer (a proxy 502 page) is an unknown failure. */
async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    if (response.ok && record?.success === true && record.data && typeof record.data === 'object') {
      return { ok: true, data: record.data as Record<string, unknown> };
    }
    const details = record?.details && typeof record.details === 'object' ? (record.details as Record<string, unknown>) : null;
    return { ok: false, code: typeof record?.error === 'string' ? record.error : 'unknown', details };
  } catch {
    return { ok: false, code: 'unknown', details: null };
  }
}

function newRequestId(): string {
  return crypto.randomUUID();
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Whole credits from 1 to the ceiling; anything else is null. */
function parseWholeCredits(text: string, ceiling: number): number | null {
  if (!/^[0-9]+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value >= 1 && value <= ceiling ? value : null;
}

/** A `datetime-local` value read as the admin's local time, as an ISO instant with `Z`; null when unreadable. */
function localToInstant(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type CreditFormMode = { kind: 'give' } | { kind: 'take_back'; lot: CreditLotView };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CreditFormMode;
  accountId: string;
  /** What the confirm step names: the business, or the account id. Never "Business OS". */
  businessLabel: string;
  limits: Limits;
  /**
   * Called after a success with the result sentences (from the response). The
   * block closes the dialog, shows them, and reads its figures again.
   */
  onSuccess: (lines: string[]) => void;
}

export function CreditFormDialog({ open, onOpenChange, mode, accountId, businessLabel, limits, onSuccess }: Props) {
  const ids = useId();
  const [requestId, setRequestId] = useState<string>('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [amountText, setAmountText] = useState('');
  const [takeEverything, setTakeEverything] = useState(false);
  const [endChoice, setEndChoice] = useState<'date' | 'none' | null>(null);
  const [endLocal, setEndLocal] = useState('');
  const [reason, setReason] = useState('');
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // A new request id and a clean form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setRequestId(newRequestId());
    setStep('form');
    setAmountText('');
    setTakeEverything(false);
    setEndChoice(null);
    setEndLocal('');
    setReason('');
    setPaidConfirmed(false);
    setError(null);
  }, [open]);

  const isGive = mode.kind === 'give';
  const lot = mode.kind === 'take_back' ? mode.lot : null;
  const needsPaidConfirm = lot?.source === 'boost_purchase';

  /** Every close path goes through here; a close while a POST is in flight is ignored (CR11c-1). */
  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  }

  const amount = parseWholeCredits(amountText, limits.grantCeiling);
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= limits.reasonMin && trimmedReason.length <= limits.reasonMax;
  const endInstant = endChoice === 'date' ? localToInstant(endLocal) : null;
  const endInPast = endInstant !== null && Date.parse(endInstant) <= Date.now();
  const endValid = endChoice === 'none' || (endChoice === 'date' && endInstant !== null && !endInPast);

  const formValid = isGive
    ? amount !== null && endValid && reasonValid
    : (takeEverything || amount !== null) && reasonValid && (!needsPaidConfirm || paidConfirmed);

  const postUrl = `/api/admin/business-os/entitlements/accounts/${encodeURIComponent(accountId)}`;

  function requestBody(): Record<string, unknown> {
    if (isGive) {
      return { op: 'grant_credits', amount, expiresAt: endChoice === 'none' ? null : endInstant, requestId, reason: trimmedReason };
    }
    const body: Record<string, unknown> = {
      op: 'reduce_credit_lot',
      lotId: lot!.id,
      amount: takeEverything ? 'rest' : amount,
      requestId,
      reason: trimmedReason,
    };
    if (needsPaidConfirm) body.confirmPaidCredits = true;
    return body;
  }

  async function submit() {
    if (inFlight.current || !formValid) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await postJson(postUrl, requestBody());
    inFlight.current = false;
    setBusy(false);

    if (!result.ok) {
      // The same request id stays for the next attempt (OP-32).
      const remaining = asNumber(result.details?.remaining);
      setError(
        result.code === 'exceeds_remaining' && remaining !== null
          ? `Only ${formatCredits(remaining)} are left on this gift.`
          : creditErrorSentence(result.code)
      );
      setStep('form');
      return;
    }

    // From the RESPONSE, never from the form (QA11b-N2).
    const data = result.data;
    const credits = asNumber(data.credits);
    const replayed = data.replayed === true;
    const lines: string[] = [];
    if (isGive) {
      const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : null;
      lines.push(
        `Gave ${credits === null ? 'an unreadable number of' : formatCredits(credits)} credits to ${businessLabel}, ${
          expiresAt ? `ending ${formatUtc(expiresAt)}` : 'with no end date'
        }.`
      );
      if (replayed) lines.push(CREDIT_COPY.replayGive);
    } else {
      const left = asNumber(data.lotRemainingAfter);
      lines.push(
        `Took back ${credits === null ? 'an unreadable number of' : formatCredits(credits)} credits from ${businessLabel}${
          left === null ? '' : `; ${formatCredits(left)} left on this gift`
        }.`
      );
      if (replayed) lines.push(CREDIT_COPY.replayTakeBack);
    }
    // The block closes the dialog; the next opening mints a new request id.
    onSuccess(lines);
  }

  const title = isGive ? `Give credits to ${businessLabel}` : `Take back credits from ${businessLabel}`;
  const amountLabel = amount === null ? '' : formatCredits(amount);
  const takeBackSummary = takeEverything
    ? `Take back everything left on this gift from ${businessLabel}`
    : `Take back ${amountLabel} credits from ${businessLabel}`;
  const lotLeftSentence = lot === null ? '' : `${formatCredits(lot.remaining)} left on this gift.`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="credit-form-dialog" className={DARK_DIALOG}>
        <DialogHeader>
          <DialogTitle className="!text-white">{title}</DialogTitle>
          <DialogDescription className="!text-slate-400">
            {isGive
              ? `Whole credits, from 1 to ${formatCredits(limits.grantCeiling)}. The reason is internal: the business never sees it.`
              : `${lotLeftSentence} The reason is internal: the business never sees it.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p data-testid="credit-form-error" role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}

        {step === 'form' ? (
          <div className="space-y-4 text-sm">
            {!isGive && (
              <fieldset className="space-y-2">
                <legend className="text-slate-300">How much</legend>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="radio"
                    name={`${ids}-how-much`}
                    data-testid="take-amount-choice"
                    checked={!takeEverything}
                    onChange={() => setTakeEverything(false)}
                  />
                  A number of credits
                </label>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="radio"
                    name={`${ids}-how-much`}
                    data-testid="take-everything-choice"
                    checked={takeEverything}
                    onChange={() => setTakeEverything(true)}
                  />
                  Everything left
                </label>
              </fieldset>
            )}

            {(isGive || !takeEverything) && (
              <div className="space-y-1">
                <Label htmlFor={`${ids}-amount`} className="text-slate-300">
                  Credits
                </Label>
                <Input
                  id={`${ids}-amount`}
                  data-testid="credit-amount"
                  inputMode="numeric"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  className={DARK_INPUT}
                />
              </div>
            )}

            {isGive && (
              <fieldset className="space-y-2">
                <legend className="text-slate-300">When the credits end</legend>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="radio"
                    name={`${ids}-end`}
                    data-testid="end-date-choice"
                    checked={endChoice === 'date'}
                    onChange={() => setEndChoice('date')}
                  />
                  End date (your local time)
                </label>
                {endChoice === 'date' && (
                  <Input
                    type="datetime-local"
                    data-testid="end-date-input"
                    aria-label="End date and time, your local time"
                    value={endLocal}
                    onChange={(event) => setEndLocal(event.target.value)}
                    className={DARK_INPUT}
                  />
                )}
                {endInPast && <p className="text-xs text-amber-300">That end date is already in the past.</p>}
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="radio"
                    name={`${ids}-end`}
                    data-testid="no-end-date-choice"
                    checked={endChoice === 'none'}
                    onChange={() => setEndChoice('none')}
                  />
                  {CREDIT_COPY.noEndDate}
                </label>
              </fieldset>
            )}

            <div className="space-y-1">
              <Label htmlFor={`${ids}-reason`} className="text-slate-300">
                Reason (internal, {limits.reasonMin} to {limits.reasonMax} characters)
              </Label>
              <textarea
                id={`${ids}-reason`}
                data-testid="credit-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className={`w-full rounded-md border px-3 py-2 text-sm ${DARK_INPUT}`}
              />
            </div>

            {needsPaidConfirm && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`${ids}-paid`}
                  data-testid="paid-credits-confirm"
                  checked={paidConfirmed}
                  onCheckedChange={(value) => setPaidConfirmed(value === true)}
                  className="mt-0.5 !border-slate-500"
                />
                <Label htmlFor={`${ids}-paid`} className="text-amber-200">
                  {CREDIT_COPY.paidCreditsConfirm}
                </Label>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" data-testid="credit-form-close" disabled={busy} onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              <Button
                type="button"
                data-testid="credit-form-continue"
                disabled={!formValid}
                onClick={() => {
                  setError(null);
                  setStep('confirm');
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p data-testid="credit-confirm-summary" className="text-base font-semibold text-white">
              {isGive ? `Give ${amountLabel} credits to ${businessLabel}` : takeBackSummary}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {isGive && (
                <>
                  <dt className="text-slate-400">Ends</dt>
                  <dd data-testid="credit-confirm-end">
                    {endChoice === 'none' || endInstant === null
                      ? CREDIT_COPY.noEndDate
                      : `${new Date(endInstant).toLocaleString()} your time (sent as ${endInstant})`}
                  </dd>
                </>
              )}
              {!isGive && lot && (
                <>
                  <dt className="text-slate-400">From the gift of</dt>
                  <dd>
                    {formatCredits(lot.credits)} credits, given {formatUtc(lot.createdAt)}
                  </dd>
                </>
              )}
              <dt className="text-slate-400">Reason</dt>
              <dd data-testid="credit-confirm-reason" className="whitespace-pre-wrap break-words">
                {trimmedReason}
              </dd>
            </dl>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" data-testid="credit-form-back" disabled={busy} onClick={() => setStep('form')}>
                Back
              </Button>
              <Button type="button" data-testid="credit-form-confirm" disabled={busy || !formValid} onClick={() => void submit()}>
                {busy ? 'Saving…' : 'Confirm'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
