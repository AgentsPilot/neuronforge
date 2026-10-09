/**
 * Refunds and disputes on a boost payment (credits boost slice 4b.1;
 * requirement FR-35, FR-36, FR-37, T-9; SA C-1, C-8, Q-2, Q-3, Q-4; 2b notes
 * N-2, I-1; 4a SA C-1, N-1).
 *
 * The boost flow handler sends the four charge events here. The contract with
 * the route is 4a's: RETURN = complete the event, THROW = release it for a
 * Stripe retry (transient repository failures only).
 *
 * What it does:
 *   - finds OUR purchase by the payment intent stored on it, and nothing else
 *     (no metadata, no client reference; 4a SA N-1);
 *   - checks the Stripe mode and the currency first (SA C-1: `usd` vs `USD`);
 *   - records the fact through 2b's `business_os_transition_boost_purchase`:
 *     the CUMULATIVE refunded amount for a refund, the dispute id for a
 *     dispute (created → disputed; closed won / funds reinstated → back to
 *     paid-family; closed lost → dispute_lost);
 *   - raises the admin flag on every recorded reversal (FR-35): an `error`
 *     line with `alert: true` and a `BOS_BOOST_PAYMENT_REVERSED` audit entry
 *     (owner-visible as a neutral "Payment update", details hidden; SA Q-4).
 *
 * What it never does: touch a credit lot or its draws (T-9; a manual
 * take-back is credit deduction 11b's admin flow), take an account
 * from the event, or retry a deterministic answer.
 *
 * A refund that reaches a purchase not yet credited (`pending`,
 * `awaiting_payment`, `expired`) is alerted and audited now and completes
 * (2b N-2, SA Q-3); the reconcile pass (4b.2) applies the charge's refund
 * state once it credits the row. A refund recorded on a transition-flagged row
 * has no total bound, so it is also logged at `warn` with its amount (2b I-1).
 *
 * @module lib/business-os/boost/boostChargeHandler
 */

import type Stripe from 'stripe';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import {
  isAnomalousRepositoryError,
  isDeterministicRepositoryError,
  type BusinessOsBoostPurchase,
  type BusinessOsBoostPurchaseRepository,
  type BusinessOsBoostTransitionInput,
  type BusinessOsBoostTransitionResult,
  type BusinessOsBoostTransitionTarget,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import {
  isBoostChargeEventType,
  parseBoostChargeEvent,
  paymentIntentOfChargeEvent,
  sameCurrency,
  type BoostChargeEvent,
  type BoostChargeEventType,
} from '@/lib/business-os/boost/boostChargeEvents';
import { BoostWebhookTransientError, type BoostWebhookLogger } from '@/lib/business-os/boost/boostWebhookHandler';

export interface BoostChargeDeps {
  purchases: Pick<BusinessOsBoostPurchaseRepository, 'findByPaymentIntentIdForWebhook' | 'transition'>;
  /** Writes and flushes one audit entry, bounded; never throws (`logAndFlush`). */
  audit: (entry: AuditLogInput, log: BoostWebhookLogger) => Promise<void>;
}

const ENTITY_TYPE = 'business_os_boost_purchase' as const;

/** A refund or dispute on a row not yet credited: money moved before we credited (2b N-2). */
const NOT_YET_CREDITED: ReadonlySet<string> = new Set(['pending', 'awaiting_payment', 'expired']);

/** Statuses a won dispute returns a purchase to (2b `dispute_won`). */
const DISPUTE_CONCLUDED_BACK_TO: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded']);

export function createBoostChargeHandler(deps: BoostChargeDeps) {
  return async function handleBoostChargeEvent(event: Stripe.Event, log: BoostWebhookLogger): Promise<void> {
    if (!isBoostChargeEventType(event.type)) {
      log.error({ alert: true, eventType: event.type }, 'bos_boost_unexpected_event: not a boost charge event');
      return;
    }
    const eventType: BoostChargeEventType = event.type;

    const paymentIntentId = paymentIntentOfChargeEvent(event.data.object);
    if (!paymentIntentId) {
      // The resolver routes only events with a payment intent; a wiring defect.
      log.error({ alert: true, eventType }, 'bos_boost_unexpected_event: the charge event names no payment intent');
      return;
    }

    const found = await deps.purchases.findByPaymentIntentIdForWebhook(paymentIntentId);
    if (found.error) return failure(found.error, null, 'lookup');
    if (!found.data) {
      log.warn({ eventType }, 'bos_boost_row_missing: the purchase was not found again');
      return;
    }
    const row = found.data;
    const base = { purchaseId: row.id, eventType, livemode: event.livemode };

    // ── Audit helpers (the account is the row's, always) ─────────────────────
    async function audit(action: string, details: Record<string, unknown>): Promise<void> {
      await deps.audit(
        { action, entityType: ENTITY_TYPE, entityId: row.id, userId: row.accountId, resourceName: row.packageId, details },
        log
      );
    }
    async function flagged(reason: string, extra: Record<string, unknown> = {}): Promise<void> {
      await audit(AUDIT_EVENTS.BOS_BOOST_FLAGGED, { reason, row_status: row.status, event_type: eventType, livemode: event.livemode, ...extra });
    }

    async function failure(error: Error, current: BusinessOsBoostPurchase | null, step: string): Promise<void> {
      const facts = { eventType, step, sqlstate: (error as { sqlstate?: unknown }).sqlstate ?? null, errorName: error.name, ...(current ? { purchaseId: current.id } : {}) };
      if (isDeterministicRepositoryError(error)) {
        log.error({ ...facts, alert: true }, 'bos_boost_deterministic_failure: completing the event');
        if (current) await flagged('deterministic_failure', { step });
        return;
      }
      if (isAnomalousRepositoryError(error)) log.error({ ...facts, alert: true }, 'bos_boost_internal_error: releasing for retry');
      else log.error(facts, 'bos_boost_transient_failure: releasing for retry');
      throw new BoostWebhookTransientError(`Boost ${step} failed transiently`, error);
    }

    // ── Narrow, then cross-check before any write ────────────────────────────
    const parsed = parseBoostChargeEvent(eventType, event.data.object);
    if (!parsed.ok) {
      log.error({ ...base, alert: true, issues: parsed.issues.slice(0, 10) }, 'bos_boost_reversal_unreadable: the event could not be read');
      await flagged('reversal_unreadable');
      return;
    }
    const charge = parsed.event;
    if (event.livemode !== row.livemode) {
      log.error({ ...base, alert: true }, 'bos_boost_reversal_mismatch: livemode differs from the purchase');
      await flagged('livemode_mismatch');
      return;
    }
    if (!sameCurrency(charge.currency, row.currency)) {
      log.error({ ...base, alert: true }, 'bos_boost_reversal_mismatch: currency differs from the purchase');
      await flagged('currency_mismatch');
      return;
    }

    // QA4b-M1: a re-delivered `created` (an admin Resend, or a retry) for a
    // dispute this purchase has already concluded must not reopen it. A won
    // dispute leaves the row paid-family with the SAME stored dispute id, so
    // that pair means "already over": stale, no call, no audit. A NEW dispute id
    // on a paid row still opens a dispute.
    if (
      eventType === 'charge.dispute.created' &&
      charge.kind === 'dispute' &&
      DISPUTE_CONCLUDED_BACK_TO.has(row.status) &&
      row.stripeDisputeId !== null &&
      row.stripeDisputeId === charge.disputeId
    ) {
      log.info({ ...base, rowStatus: row.status }, 'bos_boost_dispute_already_concluded: a repeated dispute.created is ignored');
      return;
    }

    // ── The move ─────────────────────────────────────────────────────────────
    const move = plan(eventType, charge, row);
    if (move.kind === 'ignore') {
      log.info({ ...base, reason: move.reason }, 'bos_boost_reversal_ignored');
      return;
    }
    const result = await deps.purchases.transition(move.input);
    if (result.error || !result.data) return failure(result.error ?? new Error('transition returned nothing'), row, `transition:${move.input.toStatus}`);
    await outcome(result.data, move.input, charge);

    async function outcome(answer: BusinessOsBoostTransitionResult, input: BusinessOsBoostTransitionInput, fact: BoostChargeEvent): Promise<void> {
      const target = input.toStatus;
      const details = {
        kind: fact.kind,
        phase: eventType,
        to_status: target,
        from_status: answer.fromStatus,
        amount_refunded_minor: fact.kind === 'refund' ? fact.amountRefundedMinor : null,
        livemode: event.livemode,
      };
      switch (answer.status) {
        case 'transitioned':
        case 'recorded':
          // FR-35: the admin-visible flag on every recorded reversal.
          log.error({ ...base, alert: true, toStatus: target, fromStatus: answer.fromStatus, status: answer.status }, 'bos_boost_payment_reversed');
          if (answer.status === 'recorded' && answer.fromStatus === 'flagged_mismatch' && fact.kind === 'refund') {
            // 2b I-1: a refund on a transition-flagged row has no total bound.
            log.warn({ ...base, amountRefundedMinor: fact.amountRefundedMinor }, 'bos_boost_refund_on_flagged_purchase');
          }
          await audit(AUDIT_EVENTS.BOS_BOOST_PAYMENT_REVERSED, details);
          return;
        case 'already':
        case 'stale':
          // A repeat, or an older refund event arriving after a newer one.
          log.info({ ...base, toStatus: target, status: answer.status }, 'bos_boost_reversal_already_recorded');
          return;
        case 'not_allowed':
          if (answer.fromStatus !== null && NOT_YET_CREDITED.has(answer.fromStatus)) {
            // 2b N-2 / SA Q-3: alert and audit now; the reconcile pass applies it after crediting.
            log.error({ ...base, alert: true, toStatus: target, fromStatus: answer.fromStatus }, 'bos_boost_reversal_before_credit');
            await flagged('reversal_before_credit', { to_status: target });
            return;
          }
          log.error({ ...base, alert: true, toStatus: target, fromStatus: answer.fromStatus }, 'bos_boost_transition_not_allowed');
          await flagged(`transition_not_allowed:${target}`, { from_status: answer.fromStatus });
          return;
        default:
          log.error({ ...base, alert: true, toStatus: target, status: answer.status }, 'bos_boost_reversal_unexpected');
          await flagged('reversal_unexpected', { status: answer.status });
          return;
      }
    }
  };
}

type Move = { kind: 'transition'; input: BusinessOsBoostTransitionInput } | { kind: 'ignore'; reason: string };

/** Which 2b transition a refund or dispute event asks for. Pure. */
export function plan(eventType: BoostChargeEventType, charge: BoostChargeEvent, row: Pick<BusinessOsBoostPurchase, 'id' | 'amountTotalMinor'>): Move {
  if (charge.kind === 'refund') {
    if (charge.amountRefundedMinor === 0) return { kind: 'ignore', reason: 'nothing_refunded' };
    // The cumulative amount decides; Stripe's own `refunded` flag when our total is not known yet.
    const full = row.amountTotalMinor !== null ? charge.amountRefundedMinor >= row.amountTotalMinor : charge.fullyRefunded === true;
    const toStatus: BusinessOsBoostTransitionTarget = full ? 'refunded' : 'partially_refunded';
    return {
      kind: 'transition',
      input: { purchaseId: row.id, toStatus, paymentIntentId: charge.paymentIntentId, amountRefundedMinor: charge.amountRefundedMinor },
    };
  }
  const dispute = (toStatus: BusinessOsBoostTransitionTarget): Move => ({
    kind: 'transition',
    input: { purchaseId: row.id, toStatus, paymentIntentId: charge.paymentIntentId, disputeId: charge.disputeId },
  });
  if (eventType === 'charge.dispute.created') return dispute('disputed');
  if (eventType === 'charge.dispute.funds_reinstated') return dispute('dispute_won');
  if (charge.status === 'won') return dispute('dispute_won');
  if (charge.status === 'lost') return dispute('dispute_lost');
  // e.g. `warning_closed`: an inquiry closed without becoming a chargeback.
  return { kind: 'ignore', reason: `dispute_closed_${charge.status}` };
}
