'use client';

/**
 * Set limit / Back to default, for ONE account's credit top-ups (credits boost
 * slice 6b; requirement FR-22, R-12; SA C-2, C-3; workplan §3.4).
 *
 * Both modes POST to the EXISTING admin entitlements route (`set_boost_cap` /
 * `end_boost_cap`); the server is the authority for every rule (own account,
 * platform account, tenant, plan row, bounds, reason), and these checks only
 * stop an obvious mistake early. The pattern is 11c's `CreditFormDialog`:
 *   - a first step ("Continue"), then a confirm step that names the business
 *     and restates the CURRENT limit, the NEW one and the window (SA C-3);
 *   - one POST at a time: Confirm is disabled while one is in flight, and the
 *     dialog cannot be closed until it answers (CR11c-1). A repeated identical
 *     set is also a no-op on the server (SA C-2);
 *   - the result sentence is built from the SERVER's answer.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AdminBoostLimits } from '@/lib/business-os/boost/boostAdminViewTypes';

import { BOOST_ACTION_COPY, boostActionErrorSentence, money, perWindow } from '../boostCopy';

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';
const DARK_INPUT = '!border-slate-600 !bg-slate-800 !text-white';

export type BoostCapDialogMode = 'set' | 'end';

/** The limit in force now, as the block read it. */
export interface CurrentLimit {
  amountMinor: number;
  currency: string;
  source: 'default' | 'override';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BoostCapDialogMode;
  accountId: string;
  businessLabel: string;
  limits: AdminBoostLimits;
  current: CurrentLimit;
  defaultLimit: { amountMinor: number; currency: string };
  onSuccess: (lines: string[]) => void;
}

type PostResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: string };

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
    return { ok: false, code: typeof record?.error === 'string' ? record.error : 'unknown' };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

/** Whole dollars within the bounds, as minor units; anything else is null. */
export function parseWholeDollars(text: string, limits: AdminBoostLimits): number | null {
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const minor = Number(trimmed) * 100;
  if (!Number.isSafeInteger(minor) || minor < limits.minMinor || minor > limits.maxMinor || minor % limits.stepMinor !== 0) return null;
  return minor;
}

function describeCurrent(current: CurrentLimit, windowDays: number): string {
  return `${perWindow(current.amountMinor, current.currency, windowDays)} (${current.source === 'default' ? 'the default' : 'set by an admin'})`;
}

export function BoostCapDialog({ open, onOpenChange, mode, accountId, businessLabel, limits, current, defaultLimit, onSuccess }: Props) {
  const ids = useId();
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setAmountText('');
    setReason('');
    setError(null);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  }

  const isSet = mode === 'set';
  const amountMinor = isSet ? parseWholeDollars(amountText, limits) : null;
  const trimmedReason = reason.trim();
  // QA6b-L1: code points, as the server and the SQL count them (two emoji are 2, not 4).
  const reasonCodePoints = [...trimmedReason].length;
  const reasonValid = reasonCodePoints >= limits.reasonMin && reasonCodePoints <= limits.reasonMax;
  const formValid = reasonValid && (!isSet || amountMinor !== null);
  const windowDays = limits.windowDays;

  async function submit() {
    if (inFlight.current || !formValid) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = isSet ? { op: 'set_boost_cap', amountMinor, reason: trimmedReason } : { op: 'end_boost_cap', reason: trimmedReason };
    const result = await postJson(`/api/admin/business-os/entitlements/accounts/${encodeURIComponent(accountId)}`, body);
    inFlight.current = false;
    setBusy(false);

    if (!result.ok) {
      setError(boostActionErrorSentence(result.code));
      setStep('form');
      return;
    }

    // From the RESPONSE, never from the form.
    const data = result.data;
    const savedMinor = typeof data.amountMinor === 'number' ? data.amountMinor : null;
    let line: string;
    if (!isSet) {
      line = `${businessLabel} is back on the default limit of ${perWindow(defaultLimit.amountMinor, defaultLimit.currency, windowDays)}.`;
    } else if (savedMinor === null) {
      line = `The limit of ${businessLabel} was saved.`;
    } else if (data.unchanged === true) {
      line = `The limit of ${businessLabel} was already ${perWindow(savedMinor, limits.currency, windowDays)}; nothing changed.`;
    } else {
      line = `Set the limit of ${businessLabel} to ${perWindow(savedMinor, limits.currency, windowDays)}.`;
    }
    onSuccess([line]);
  }

  const title = isSet ? `Set the top-up spending limit for ${businessLabel}` : `Return ${businessLabel} to the default limit`;
  const description = isSet
    ? `Whole dollars, from ${money(limits.minMinor, limits.currency)} to ${money(limits.maxMinor, limits.currency)}, per ${windowDays} days. ${BOOST_ACTION_COPY.reasonInternal}`
    : `The default is ${perWindow(defaultLimit.amountMinor, defaultLimit.currency, windowDays)}. ${BOOST_ACTION_COPY.reasonInternal}`;
  const summary = isSet
    ? `Set the limit of ${businessLabel} to ${amountMinor === null ? '' : perWindow(amountMinor, limits.currency, windowDays)}`
    : `Return the limit of ${businessLabel} to the default: ${perWindow(defaultLimit.amountMinor, defaultLimit.currency, windowDays)}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="boost-cap-dialog" className={DARK_DIALOG}>
        <DialogHeader>
          <DialogTitle className="!text-white">{title}</DialogTitle>
          <DialogDescription className="!text-slate-400">{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p data-testid="boost-cap-dialog-error" role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}

        {step === 'form' ? (
          <div className="space-y-4 text-sm">
            <p data-testid="boost-cap-dialog-current" className="text-slate-300">
              Now: {describeCurrent(current, windowDays)}
            </p>
            {isSet && (
              <div className="space-y-1">
                <Label htmlFor={`${ids}-amount`} className="text-slate-300">
                  Limit in dollars (per {windowDays} days)
                </Label>
                <Input
                  id={`${ids}-amount`}
                  data-testid="boost-cap-amount"
                  inputMode="numeric"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  className={DARK_INPUT}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`${ids}-reason`} className="text-slate-300">
                Reason (internal, {limits.reasonMin} to {limits.reasonMax} characters)
              </Label>
              <textarea
                id={`${ids}-reason`}
                data-testid="boost-cap-reason-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className={`w-full rounded-md border px-3 py-2 text-sm ${DARK_INPUT}`}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" data-testid="boost-cap-close" disabled={busy} onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              <Button
                type="button"
                data-testid="boost-cap-continue"
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
            <p data-testid="boost-cap-confirm-summary" className="text-base font-semibold text-white">
              {summary}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-slate-400">Now</dt>
              <dd data-testid="boost-cap-confirm-now">{describeCurrent(current, windowDays)}</dd>
              <dt className="text-slate-400">After</dt>
              <dd data-testid="boost-cap-confirm-after">
                {isSet && amountMinor !== null
                  ? `${perWindow(amountMinor, limits.currency, windowDays)} (set by an admin)`
                  : `${perWindow(defaultLimit.amountMinor, defaultLimit.currency, windowDays)} (the default)`}
              </dd>
              <dt className="text-slate-400">Reason</dt>
              <dd data-testid="boost-cap-confirm-reason" className="whitespace-pre-wrap break-words">
                {trimmedReason}
              </dd>
            </dl>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" data-testid="boost-cap-back" disabled={busy} onClick={() => setStep('form')}>
                Back
              </Button>
              <Button type="button" data-testid="boost-cap-confirm" disabled={busy || !formValid} onClick={() => void submit()}>
                {busy ? 'Saving…' : 'Confirm'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
