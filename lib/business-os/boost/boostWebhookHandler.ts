/**
 * The boost flow handler of the Stripe webhook (credits boost slice 4a;
 * requirement FR-13 to FR-18, HP-1, HP-3, T-6, T-7, R-6, R-10; SA C-1, C-3,
 * C-8 b, Q-3, Q-7; 2b notes N-1, I-3).
 *
 * The route calls it for an event the boost resolver recognised, then completes
 * the claim and answers 200. Its contract with the route is binary:
 *
 *   - RETURN  → the event is done (complete the claim). Every deterministic
 *     outcome returns: credited, already credited, a flagged mismatch, a paid
 *     session that cannot be credited, a disallowed move, a deterministic
 *     repository error (class 22, 23514, 23502, 23503, 42xxx, validation).
 *   - THROW   → the claim is released and Stripe retries (HP-1). Only a
 *     transient failure throws: a network or timeout error, 23505, 40xxx,
 *     08xxx, 53xxx, 57xxx, XX000 (also alerted), a plain error.
 *
 * The account is ALWAYS the purchase row's (`row.accountId`), never anything
 * in the event: not `client_reference_id`, not metadata (R-6, SR-8). The row
 * id passed to `credit` is the one the lookup returned.
 *
 * Order: the money write first, then the audit (bounded, never throws), then
 * the receipt (bounded, never throws). A failure after the money write never
 * changes the outcome, and a killed run leaves the row creditable or credited,
 * never in between (F-1 is recoverable; 4b reconciles).
 *
 * C-3: a row found only by `client_reference_id` (a session-id miss) is never
 * moved by a status transition, and is credited only when it holds NO session
 * (the credit then flags `no_session`). A row that holds a DIFFERENT session is
 * never touched: `bos_boost_orphan_session_paid` is alerted and audited, so a
 * payment on a crafted session can neither credit nor flag someone else's
 * purchase, and the owner's real session still credits.
 *
 * @module lib/business-os/boost/boostWebhookHandler
 */

import type Stripe from 'stripe';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type {
  BusinessOsBoostPurchase,
  BusinessOsBoostPurchaseRepository,
  BusinessOsBoostTransitionTarget,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { isAnomalousRepositoryError, isDeterministicRepositoryError } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import {
  boostMetadataDisagrees,
  findBoostPurchaseForSession,
  isBoostSessionEventType,
  parseBoostSession,
  sessionKeysOf,
  type BoostPurchaseLookupPort,
  type BoostSession,
  type BoostSessionEventType,
} from '@/lib/business-os/boost/boostWebhookSession';
import type { BoostReceiptOutcome } from '@/lib/business-os/boost/boostReceipt';

export interface BoostWebhookLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface BoostWebhookDeps {
  purchases: BoostPurchaseLookupPort & Pick<BusinessOsBoostPurchaseRepository, 'credit' | 'transition'>;
  /** Writes and flushes one audit entry, bounded; never throws (`logAndFlush`). */
  audit: (entry: AuditLogInput, log: BoostWebhookLogger) => Promise<void>;
  /** Best-effort receipt fill (`recordBoostReceipt`); never throws. */
  receipt: (
    input: { purchaseId: string; paymentIntentId: string; eventLivemode: boolean },
    log: BoostWebhookLogger
  ) => Promise<BoostReceiptOutcome>;
}

/** Thrown to release the claim so Stripe retries (HP-1). */
export class BoostWebhookTransientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'BoostWebhookTransientError';
  }
}

const ENTITY_TYPE = 'business_os_boost_purchase' as const;

/** Statuses that mean "the money arrived" (QA4a-D1): an awaiting-payment event after them is stale. */
const PAID_FAMILY: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost']);

export function createBoostWebhookHandler(deps: BoostWebhookDeps) {
  return async function handleBoostWebhookEvent(event: Stripe.Event, log: BoostWebhookLogger): Promise<void> {
    if (!isBoostSessionEventType(event.type)) {
      // The resolver routes only the four types here; anything else is a wiring defect.
      log.error({ alert: true, eventType: event.type }, 'bos_boost_unexpected_event: not a boost session event');
      return;
    }
    const eventType: BoostSessionEventType = event.type;
    const keys = sessionKeysOf(event.data.object);
    if (!keys) {
      log.error({ alert: true, eventType }, 'bos_boost_unexpected_event: the event carries no session');
      return;
    }

    const found = await findBoostPurchaseForSession(keys, deps.purchases);
    if (found.kind === 'error') {
      await repositoryFailure(found.error, null, 'lookup');
      return;
    }
    if (found.kind === 'none') {
      // The resolver found it a moment ago: a race (e.g. an admin purge). Nothing to do.
      log.warn({ eventType, sessionId: keys.id }, 'bos_boost_row_missing: the purchase was not found again');
      return;
    }

    const row = found.row;
    const base = { purchaseId: row.id, eventType, livemode: event.livemode };

    // ── Audit and alert helpers (the account is the row's, always) ──────────
    // Severity comes from the event registration (lib/audit/events.ts), not the writer.
    async function audit(action: string, details: Record<string, unknown>): Promise<void> {
      await deps.audit(
        { action, entityType: ENTITY_TYPE, entityId: row.id, userId: row.accountId, resourceName: row.packageId, details },
        log
      );
    }

    async function flagged(reason: string, extra: Record<string, unknown> = {}): Promise<void> {
      await audit(AUDIT_EVENTS.BOS_BOOST_FLAGGED, { reason, row_status: row.status, event_type: eventType, livemode: event.livemode, ...extra });
    }

    async function repositoryFailure(error: Error, current: BusinessOsBoostPurchase | null, step: string): Promise<void> {
      const facts = {
        ...(current ? { purchaseId: current.id } : { sessionId: keys!.id }),
        eventType,
        step,
        sqlstate: (error as { sqlstate?: unknown }).sqlstate ?? null,
        errorName: error.name,
      };
      if (isDeterministicRepositoryError(error)) {
        // N-1 / I-3: a retry cannot change this answer, and throwing would make
        // Stripe retry for days. Complete with an alert and an audit entry.
        log.error({ ...facts, alert: true }, 'bos_boost_deterministic_failure: completing the event');
        if (current) await flagged('deterministic_failure', { step });
        return;
      }
      if (isAnomalousRepositoryError(error)) {
        log.error({ ...facts, alert: true }, 'bos_boost_internal_error: releasing for retry');
      } else {
        log.error(facts, 'bos_boost_transient_failure: releasing for retry');
      }
      throw new BoostWebhookTransientError(`Boost ${step} failed transiently`, error);
    }

    // ── C-3: a row found by client_reference_id only ─────────────────────────
    if (found.kind === 'by_reference') {
      const stored = row.stripeCheckoutSessionId;
      const paid = (event.data.object as { payment_status?: unknown }).payment_status === 'paid';
      if (stored !== null && stored !== keys.id) {
        if (paid) {
          log.error(
            { ...base, alert: true, sessionId: keys.id, storedSessionId: stored },
            'bos_boost_orphan_session_paid: a paid session names a purchase that holds another session'
          );
          await flagged('orphan_session_paid');
        } else {
          log.warn({ ...base, sessionId: keys.id, storedSessionId: stored }, 'bos_boost_orphan_session: ignored, the purchase holds another session');
        }
        return;
      }
      if (!paid || (eventType !== 'checkout.session.completed' && eventType !== 'checkout.session.async_payment_succeeded')) {
        // Never move a row we did not match by session (C-3); only a paid credit may proceed.
        log.warn({ ...base, sessionId: keys.id }, 'bos_boost_orphan_session: no status change for a purchase matched by reference');
        return;
      }
      // C-3 (a): stored session NULL → credit, which flags `no_session` (visible, refundable).
    }

    // ── Narrow the session (I-3: repository refusals become unreachable) ─────
    const parsed = parseBoostSession(event.data.object);
    if (!parsed.ok) {
      await flagRow('session_unreadable', { issues: parsed.issues.slice(0, 10) });
      return;
    }
    const session = parsed.session;

    // ── Cross-checks before any write (R-10, HP-3, SA Q-3) ───────────────────
    if (event.livemode !== row.livemode) {
      await flagRow('livemode_mismatch');
      return;
    }
    if (boostMetadataDisagrees(session.metadata)) {
      await flagRow('metadata_mismatch');
      return;
    }

    switch (eventType) {
      case 'checkout.session.completed':
        if (session.paymentStatus === 'paid') return creditRow(session);
        if (session.paymentStatus === 'unpaid') {
          if (!session.paymentIntentId) return flagRow('no_payment_intent');
          return moveRow('awaiting_payment', session.paymentIntentId);
        }
        // Promotion codes are off (slice 3), so a free session is never expected (T-7).
        return flagRow('no_payment_required');
      case 'checkout.session.async_payment_succeeded':
        if (session.paymentStatus === 'paid') return creditRow(session);
        log.error({ ...base, alert: true, paymentStatus: session.paymentStatus }, 'bos_boost_unexpected_status: async success that is not paid');
        await flagged('async_succeeded_not_paid');
        return;
      case 'checkout.session.async_payment_failed':
        return moveRow('failed', session.paymentIntentId);
      case 'checkout.session.expired':
        return moveRow('expired', null);
    }

    // ── The writes ───────────────────────────────────────────────────────────
    async function creditRow(paidSession: BoostSession): Promise<void> {
      const { paymentIntentId, amountSubtotalMinor, amountTotalMinor, currency } = paidSession;
      if (!paymentIntentId) return flagRow('no_payment_intent');
      if (amountSubtotalMinor === null || amountTotalMinor === null || currency === null) return flagRow('session_amounts_missing');

      const result = await deps.purchases.credit({
        purchaseId: row.id,
        sessionId: paidSession.id,
        paymentIntentId,
        amountSubtotalMinor,
        amountTaxMinor: paidSession.amountTaxMinor,
        amountTotalMinor,
        currency,
        livemode: event.livemode,
      });
      if (result.error || !result.data) return repositoryFailure(result.error ?? new Error('credit returned nothing'), row, 'credit');

      const outcome = result.data;
      switch (outcome.outcome) {
        case 'credited':
          log.info({ ...base, lotId: outcome.lotId, creditsTotal: row.creditsTotal }, 'bos_boost_credited');
          await audit(AUDIT_EVENTS.BOS_BOOST_CREDITED, {
            package_id: row.packageId,
            package_version: row.packageVersion,
            credits_total: row.creditsTotal,
            price_minor: row.priceMinor,
            currency: row.currency,
            lot_id: outcome.lotId,
            stripe_payment_intent_id: paymentIntentId,
            livemode: event.livemode,
          });
          await deps.receipt({ purchaseId: row.id, paymentIntentId, eventLivemode: event.livemode }, log);
          return;
        case 'already_credited':
          // FR-15: a replay adds nothing, and is not audited twice.
          log.info({ ...base, lotId: outcome.lotId }, 'bos_boost_already_credited');
          if (row.receiptUrl === null) await deps.receipt({ purchaseId: row.id, paymentIntentId, eventLivemode: event.livemode }, log);
          return;
        case 'mismatch':
          log.error({ ...base, alert: true, flagReason: outcome.flagReason }, 'bos_boost_mismatch: the purchase was flagged, not credited');
          await flagged(outcome.flagReason);
          return;
        case 'not_creditable':
          // C-8 (b): Stripe says paid, our row cannot take it (failed, abandoned,
          // flagged). Money taken, nothing credited: a person must look. 4b lists these.
          log.error({ ...base, alert: true, rowStatus: row.status }, 'bos_boost_paid_not_creditable');
          await flagged('paid_not_creditable');
          return;
        case 'not_found':
          log.warn(base, 'bos_boost_row_missing: the purchase disappeared before crediting');
          return;
      }
    }

    async function moveRow(target: BusinessOsBoostTransitionTarget, paymentIntentId: string | null): Promise<void> {
      const result = await deps.purchases.transition({ purchaseId: row.id, toStatus: target, paymentIntentId });
      if (result.error || !result.data) return repositoryFailure(result.error ?? new Error('transition returned nothing'), row, `transition:${target}`);
      const { status, fromStatus } = result.data;
      switch (status) {
        case 'transitioned':
        case 'already':
          log.info({ ...base, target, status, fromStatus }, 'bos_boost_status_moved');
          if (target === 'failed' && status === 'transitioned') {
            await audit(AUDIT_EVENTS.BOS_BOOST_PAYMENT_FAILED, { package_id: row.packageId, livemode: event.livemode });
          }
          return;
        case 'mismatch':
          log.error({ ...base, alert: true, target, flagReason: 'payment_intent_reused' }, 'bos_boost_mismatch: the purchase was flagged');
          await flagged('payment_intent_reused');
          return;
        case 'not_allowed':
          // QA4a-D1: Stripe does not order events. A `completed(unpaid)` arriving
          // after the purchase was already paid (or later refunded / disputed) is
          // stale, not a disagreement: complete quietly, no alert, no owner entry.
          if (target === 'awaiting_payment' && fromStatus !== null && PAID_FAMILY.has(fromStatus)) {
            log.info({ ...base, target, fromStatus }, 'bos_boost_stale_event: awaiting payment for a purchase already paid');
            return;
          }
          // SA Q-7: Stripe and our row disagree about money (e.g. expired or
          // failed after paid, awaiting payment on a failed or flagged row).
          log.error({ ...base, alert: true, target, fromStatus }, 'bos_boost_transition_not_allowed');
          await flagged(`transition_not_allowed:${target}`, { from_status: fromStatus });
          return;
        default:
          log.warn({ ...base, target, status }, 'bos_boost_status_unexpected');
          return;
      }
    }

    /** Flag the row and alert. A row matched only by reference is never moved (C-3): alert and audit only. */
    async function flagRow(reason: string, extra: Record<string, unknown> = {}): Promise<void> {
      if (found.kind === 'by_reference') {
        log.error({ ...base, alert: true, flagReason: reason, matchedBy: 'reference', ...extra }, 'bos_boost_mismatch: not credited (purchase matched by reference, left unchanged)');
        await flagged(reason, { matched_by: 'reference', ...extra });
        return;
      }
      const result = await deps.purchases.transition({ purchaseId: row.id, toStatus: 'flagged_mismatch', flagReason: reason });
      if (result.error || !result.data) return repositoryFailure(result.error ?? new Error('transition returned nothing'), row, 'flag');
      const { status, fromStatus } = result.data;
      const applied = status === 'transitioned' || status === 'already';
      if (applied) {
        log.error({ ...base, alert: true, flagReason: reason, status, fromStatus, ...extra }, 'bos_boost_mismatch: the purchase was flagged, not credited');
      } else {
        // QA I-3: the row's state does not allow a flag (e.g. already paid or
        // expired). Say so accurately; the alert and the audit entry still stand.
        log.error({ ...base, alert: true, flagReason: reason, status, fromStatus, ...extra }, 'bos_boost_mismatch_unflagged: not credited; the purchase could not be flagged in its current state');
      }
      await flagged(reason, applied ? extra : { ...extra, flag_applied: false });
    }
  };
}
