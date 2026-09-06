'use client';

/**
 * Stopping a client's payment plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO DECISIONS, PRESENTED AS TWO.
 *
 * Stopping future charges and returning what has already been collected are
 * separate, and conflating them gets money wrong in both directions: a client
 * who leaves a course halfway is usually not owed the lessons they attended,
 * and a business that cannot deliver usually owes all of it. So stopping is the
 * action, and refunding is an opt-in beneath it — never ticked by default.
 *
 * The refund half offers FULL or PARTIAL, exactly as the refund dialog does,
 * because "stop the plan and give back half" is an ordinary settlement and the
 * owner should not have to stop the plan here and then go and find the refund
 * dialog somewhere else to finish the thought.
 *
 * A partial amount is taken from the most recent period backwards — the
 * payments the client has had least benefit from. That allocation is the one
 * that can be explained to them; splitting a sum evenly across twelve periods
 * produces card-statement lines matching nothing anybody asked for.
 *
 * Deliberately shaped like `RefundModal` — same shell, same hero figure, same
 * switch control, same pinned footer — because both are dialogs an owner
 * reaches when a sale has gone wrong, and they open from the same drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { AlertTriangle, Ban, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from './SwitchRow';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The `payment_plan_subscriptions` row — the sale, not the plan offer. */
  planId: string;
  /** For the sentence that says what stopping actually stops. */
  periodsRemaining: number;
  collectedAmount: number;
  currency: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export function CancelPlanModal({
  isOpen,
  onClose,
  planId,
  periodsRemaining,
  collectedAmount,
  currency,
  onSuccess,
  onError,
}: Props) {
  const { t, language, isRTL } = useLanguage();
  const [refundCollected, setRefundCollected] = useState(false);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const formatCurrency = (amount: number) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  };

  const refundAmount = refundType === 'full' ? collectedAmount : parseFloat(partialAmount) || 0;

  /*
   * A partial refund of nothing, or of more than was collected.
   *
   * Blocked here rather than discovered by the server, which would refuse the
   * refund AFTER the plan had already been stopped — leaving the owner with
   * half of what they asked for and no obvious way to tell which half.
   */
  const amountInvalid =
    refundCollected &&
    refundType === 'partial' &&
    (refundAmount <= 0 || refundAmount > collectedAmount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountInvalid) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/payments/plans/${planId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refund_collected: refundCollected,
          // Only for a partial: omitted means everything collected, which is
          // already what the server does with no amount.
          refund_amount: refundCollected && refundType === 'partial' ? refundAmount : undefined,
          reason: reason || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to stop the plan');
      }

      /*
       * The plan is stopped even when part of the refund failed — Stripe
       * refunds are individually final, so seven of twelve is a real end state.
       * Saying so is better than a success message over money still held.
       */
      const refund = data.data?.refund;
      if (refund && refund.succeeded < refund.requested) {
        onError?.(
          t('payments.plan.partial_refund_warning')
            .replace('{succeeded}', String(refund.succeeded))
            .replace('{requested}', String(refund.requested))
        );
      }

      onSuccess?.();
      onClose();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to stop the plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex w-full sm:max-w-md h-[100vh] sm:h-auto max-h-[100vh] sm:max-h-[90vh] flex-col rounded-none sm:rounded-lg p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* ── Header ──────────────────────────────────────────────────────
            Leads with what stopping actually stops — the number of charges the
            client will not now receive — because that is the decision. */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center bg-red-500/10"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Ban className="h-4 w-4 text-red-600" />
            </span>
            <DialogTitle className="text-[15px] font-semibold text-[var(--v2-text-primary)]">
              {t('payments.plan.cancel_title')}
            </DialogTitle>
          </div>

          <div className="mt-4">
            <div className="text-[28px] font-semibold leading-none tabular-nums text-[var(--v2-text-primary)]">
              {periodsRemaining}
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--v2-text-muted)]">
              {t('payments.plan.cancel_description').replace('{count}', String(periodsRemaining))}
            </p>
          </div>
        </div>

        <form
          id="cancel-plan-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
        >
          {/* What stopping does NOT do. Shown only while the refund is off —
              once it is on, the switch below says what will happen instead, and
              a warning contradicting the control under it is just noise. */}
          {collectedAmount > 0 && !refundCollected && (
            <div
              className="flex items-start gap-2 bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t('payments.plan.cancel_keeps_collected').replace(
                  '{amount}',
                  formatCurrency(collectedAmount)
                )}
              </span>
            </div>
          )}

          {collectedAmount > 0 && (
            <div
              className="border border-[var(--v2-border)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <SwitchRow
                checked={refundCollected}
                onChange={setRefundCollected}
                isRTL={isRTL}
                danger
                label={t('payments.plan.also_refund_label')}
                description={t('payments.plan.also_refund_desc').replace(
                  '{amount}',
                  formatCurrency(collectedAmount)
                )}
              />

              {/* The same full/partial choice the refund dialog offers, in the
                  same segmented control — so "stop the plan and give back half"
                  is one action rather than two dialogs in sequence. */}
              {refundCollected && (
                <div className="space-y-3 border-t border-[var(--v2-border)] px-3 py-3">
                  <div
                    className="flex gap-1 bg-[var(--v2-surface-hover)] p-1"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    role="radiogroup"
                  >
                    {(['full', 'partial'] as const).map(option => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={refundType === option}
                        onClick={() => setRefundType(option)}
                        className={`flex-1 px-3 py-1.5 text-[12.5px] transition-colors ${
                          refundType === option
                            ? 'bg-[var(--v2-bg)] font-medium text-[var(--v2-text-primary)] shadow-sm'
                            : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                        }`}
                        style={{ borderRadius: 'calc(var(--v2-radius-button) - 2px)' }}
                      >
                        {option === 'full'
                          ? t('payments.refund.full_with_amount').replace(
                              '{amount}',
                              formatCurrency(collectedAmount)
                            )
                          : t('payments.refund.partial')}
                      </button>
                    ))}
                  </div>

                  {refundType === 'partial' && (
                    <div>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-[13px] text-[var(--v2-text-muted)]">
                          {currency}
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={collectedAmount}
                          value={partialAmount}
                          onChange={e => setPartialAmount(e.target.value)}
                          placeholder={t('payments.refund.amount_placeholder')}
                          className="ps-12 tabular-nums"
                          required
                        />
                      </div>

                      <div className="mt-2 flex gap-1.5">
                        {[0.25, 0.5, 0.75].map(fraction => (
                          <button
                            key={fraction}
                            type="button"
                            onClick={() =>
                              setPartialAmount(
                                (Math.round(collectedAmount * fraction * 100) / 100).toFixed(2)
                              )
                            }
                            className="border border-[var(--v2-border)] px-2.5 py-1 text-[11.5px] text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {Math.round(fraction * 100)}%
                          </button>
                        ))}
                      </div>

                      {/* WHICH periods the money comes off. The client will see
                          it on their statement, and the owner should not have to
                          guess which payment was reversed. */}
                      <p className="mt-2 text-[11.5px] text-[var(--v2-text-muted)]">
                        {t('payments.plan.partial_from_latest')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('payments.refund.reason_label')}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder={t('payments.refund.reason_placeholder')}
              className="w-full resize-none border border-[var(--v2-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--v2-text-primary)] outline-none transition-colors placeholder:text-[var(--v2-text-muted)] focus:border-[var(--v2-text-muted)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
        </form>

        {/* Pinned, like the refund dialog's — the action stays reachable
            without scrolling past the options on a phone. */}
        <div className="flex-shrink-0 flex items-center justify-end gap-2 border-t border-[var(--v2-border)] px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {t('payments.refund.cancel')}
          </Button>
          {/* Red, like the refund dialog's confirm — the design system has no
              `destructive` variant, and both dialogs end an arrangement the
              client is party to. The label names the money when there is any,
              because "Stop plan" over a £600 refund understates it. */}
          <Button
            type="submit"
            form="cancel-plan-form"
            disabled={loading || amountInvalid}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('payments.refund.processing')}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Ban className="h-4 w-4" />
                {refundCollected
                  ? t('payments.plan.cancel_and_refund').replace(
                      '{amount}',
                      formatCurrency(refundAmount)
                    )
                  : t('payments.plan.cancel_confirm')}
              </span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
