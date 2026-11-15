'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A REFUND CAME TO HAPPEN, which the ledger cannot say.
 *
 * `payment_refunds` records that ₪37.50 went back. It cannot record that the
 * client asked for ₪300, that they said they were ill and never came, that an
 * agent read the booking and recommended returning everything, or that the
 * owner disagreed and returned half.
 *
 * The card that carried all of that disappears the moment the request is
 * settled — correctly, because a settled request is not work — and the asking
 * disappeared with it. So a partial refund read as a decision nobody explained,
 * to the person who made it, three weeks later.
 *
 * THREE BEATS, IN THE ORDER THEY HAPPENED:
 *
 *   1. the client asked, and why, in their words
 *   2. THE AGENT LOOKED AND SAID WHY  ← the beat that makes this more than a label
 *   3. the owner answered
 *
 * Beat 2 is absent where no agent ever ran — it was paused, or the owner was
 * quicker. Showing nothing there is the honest record; inventing a step is not.
 *
 * It is READ ONLY. Nothing here can be pressed and nothing here moves money:
 * the refund dialog remains the only place that happens.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { RotateCcw, Bot } from 'lucide-react';

/** The shape `/api/business-os/refund-requests` returns, narrowed to what shows. */
export interface RefundAsk {
  id: string;
  booking_id: string | null;
  amount_requested: number;
  currency: string;
  reason: string | null;
  note: string | null;
  status: string;
  created_at: string;
  recommendation: string | null;
  recommended_amount: number | null;
  reasoning: string | null;
  assessed_at: string | null;
  decided_at: string | null;
  source: string | null;
}

interface Props {
  ask: RefundAsk;
  t: (key: string) => string;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string) => string;
  /** Tighter spacing, for a row in a list rather than a panel in a drawer. */
  dense?: boolean;
}

export function RefundStory({ ask, t, formatCurrency, formatDate, dense }: Props) {
  const settled =
    ask.status === 'refunded'
      ? t('payments.refund_request.state.refunded')
      : ask.status === 'declined'
        ? t('payments.refund_request.state.declined')
        : t('payments.refund_request.state.open');

  return (
    <div
      className={`rounded-lg ${dense ? 'px-2.5 py-2 text-[11.5px]' : 'px-3 py-2.5 text-[12.5px]'} leading-relaxed`}
      style={{
        background: 'var(--v2-surface-hover)',
        borderInlineStart: '2px solid var(--v2-border)',
        color: 'var(--v2-text-secondary)',
      }}
    >
      <p className="m-0 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide opacity-70">
        <RotateCcw className="h-3 w-3 shrink-0" aria-hidden="true" />
        {t('payments.refund_request.story')}
      </p>

      {/* ── 1. the ask ─────────────────────────────────────────────── */}
      <p className="m-0 mt-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span className="opacity-60">{formatDate(ask.created_at)} · </span>
        {t('payments.refund_request.asked').replace(
          '{amount}',
          formatCurrency(ask.amount_requested, ask.currency)
        )}
        {ask.source && (
          <span className="opacity-60"> {t(`payments.refund_request.via.${ask.source}`)}</span>
        )}
      </p>
      {ask.reason && (
        <p className="m-0 ps-1" style={{ unicodeBidi: 'plaintext' }}>
          {t(`payments.refund.reason.${ask.reason}`)}
        </p>
      )}
      {ask.note && (
        <p className="m-0 ps-1 italic opacity-85" style={{ unicodeBidi: 'plaintext' }}>
          “{ask.note}”
        </p>
      )}

      {/* ── 2. what the agent made of it ───────────────────────────── */}
      {ask.recommendation && (
        <div className="mt-1.5">
          <p className="m-0 flex items-center gap-1.5 flex-wrap">
            <Bot
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--v2-primary)' }}
              aria-hidden="true"
            />
            <span className="opacity-60">
              {ask.assessed_at ? `${formatDate(ask.assessed_at)} · ` : ''}
            </span>
            <span style={{ color: 'var(--v2-primary)' }}>
              {t('payments.refund_request.agent_said')}{' '}
              {t(`gaps.refund.rec.${ask.recommendation}`)}
              {typeof ask.recommended_amount === 'number' && (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {' '}
                  {formatCurrency(ask.recommended_amount, ask.currency)}
                </span>
              )}
            </span>
          </p>
          {ask.reasoning && (
            <p className="m-0 ps-1 opacity-85" style={{ unicodeBidi: 'plaintext' }}>
              {ask.reasoning}
            </p>
          )}
        </div>
      )}

      {/* ── 3. what the owner did ──────────────────────────────────── */}
      <p className="m-0 mt-1.5 font-semibold">
        <span className="font-normal opacity-60">
          {ask.decided_at ? `${formatDate(ask.decided_at)} · ` : ''}
        </span>
        {ask.decided_at ? settled : t('payments.refund_request.still_open')}
      </p>
    </div>
  );
}
