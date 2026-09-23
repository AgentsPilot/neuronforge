// lib/business-os/entitlements/config/lifecycle.ts
//
// THE LIFECYCLE OVERLAY — what an account may still do once it stops paying.
//
// Requirement §9 / §10.3 / B-9 / B-11, workplan §4.6.
//
// The resolver decides what an account is ENTITLED to. This table decides what
// its STATE allows on top of that, and it can only ever take away. Two business
// decisions live here, and both are about the business's own clients rather than
// the owner:
//
//   B-9  (grace)  — transactional messages keep going, marketing stops.
//   B-11 (paused) — clients can still pay an invoice they already received and
//                   cancel or reschedule a booking they already made. New
//                   bookings, the public website and reminder messages stop.
//                   Suppressed messages are NOT sent later on reactivation:
//                   a reminder about last Tuesday helps nobody.
//
// That is why a send is classified by (message class × who triggered it). A
// receipt and a reminder are both transactional, but one is the client's own
// action coming back to them and the other is the system deciding to speak.

import type { LifecycleConfigShape, HistoryEntry, SendDefinition, LifecycleState, SurfaceKind, OverlayOutcome } from '../types';

const SHIPPED = '2026-09-22T00:00:00.000Z';

/** Grace after a paid tier ends. Cohorts carry their own (see cohorts.ts). */
const subscriptionGraceHistory: readonly HistoryEntry[] = [{ effectiveFrom: SHIPPED, days: 7 }];

/**
 * A live account: everything its entitlements allow.
 *
 * Written once and reused, so "what does a normal account do?" is one object
 * rather than four copies that could drift apart.
 */
const LIVE: Record<SurfaceKind, OverlayOutcome> = {
  owner_read: 'allow',
  owner_write: 'allow',
  owner_ai: 'allow',
  public_business: 'allow',
  public_self_service: 'allow',
  'send:transactional:client': 'allow',
  'send:transactional:system': 'allow',
  'send:marketing': 'allow',
};

export const LIFECYCLE_CONFIG = {
  subscriptionGraceHistory,

  overlay: {
    trial: LIVE,
    champion: LIVE,
    active: LIVE,
    // Payment failed, dunning in progress (Slice 4). Nothing changes except the
    // banner: cutting a customer off while their card retries loses the recovery.
    past_due: LIVE,

    // GRACE (B-9): the owner can look but not touch. Everything facing the
    // business's own clients keeps working, with a warning on the public pages,
    // because those clients did nothing wrong.
    grace: {
      owner_read: 'allow',
      owner_write: 'read_only',
      owner_ai: 'read_only',
      public_business: 'allow_with_warning',
      public_self_service: 'allow_with_warning',
      'send:transactional:client': 'allow',
      'send:transactional:system': 'allow',
      'send:marketing': 'suppress',
    },

    // PAUSED (B-11): the shop front closes, the till stays open.
    paused: {
      owner_read: 'allow',
      owner_write: 'read_only',
      owner_ai: 'read_only',
      // No new bookings, no website: the business is not taking on work.
      public_business: 'paused_public',
      // But an invoice already sent can still be paid, and a booking already
      // made can still be cancelled or moved. Closing these would stop the
      // business collecting money it is owed and leave clients stranded.
      public_self_service: 'allow',
      // A receipt for a payment that just arrived, or the confirmation of a
      // cancellation the client just made: the client acted, they get an answer.
      'send:transactional:client': 'allow',
      // Reminders and other system-initiated nudges stop.
      'send:transactional:system': 'suppress',
      'send:marketing': 'suppress',
    },

    // The anomaly state: no plan row, or a tier/cohort the config does not know.
    // Read-only for the owner, and everything client-facing keeps working — a
    // bookkeeping failure of ours must never take down a customer's booking page
    // or stop their clients paying (T-3 fail-open for client surfaces).
    unknown: {
      owner_read: 'allow',
      owner_write: 'read_only',
      owner_ai: 'read_only',
      public_business: 'allow',
      public_self_service: 'allow',
      'send:transactional:client': 'allow',
      'send:transactional:system': 'allow',
      'send:marketing': 'suppress',
    },
  } satisfies Record<LifecycleState, Record<SurfaceKind, OverlayOutcome>>,

  /**
   * The seed of the Slice 2 send registry.
   *
   * Slice 2 declares every automated client-facing send here, and the surface
   * kind is derived from (messageClass, initiator) so no call site picks its own.
   * Component 2 seeds the sends the Slice 1 tests need (SA R2-4) — in particular
   * the intake request, which is how AC-37 is proved against the PRODUCTION
   * config rather than a fixture.
   */
  sends: {
    'intake.request': {
      id: 'intake.request',
      labels: { en: 'Intake questionnaire request', he: 'בקשת שאלון קליטה', es: 'Solicitud de cuestionario' },
      messageClass: 'transactional',
      initiator: 'system',
      capability: 'intake.reminders',
      note: 'Q-B4: the system decides to ask, so it is suppressed when paused. Flip it with an entry in sendPolicyOverrides.',
    },
    'payments.receipt': {
      id: 'payments.receipt',
      labels: { en: 'Payment receipt', he: 'קבלה', es: 'Recibo de pago' },
      messageClass: 'transactional',
      initiator: 'client',
      note: 'B-11: the client just paid. They get a receipt even while the account is paused.',
    },
    'payments.reminder': {
      id: 'payments.reminder',
      labels: { en: 'Payment reminder', he: 'תזכורת תשלום', es: 'Recordatorio de pago' },
      messageClass: 'transactional',
      initiator: 'system',
      capability: 'payments.reminders',
      note: 'B-9 keeps it running in grace; B-11 stops it when paused.',
    },
    'booking.cancel_confirmation': {
      id: 'booking.cancel_confirmation',
      labels: { en: 'Cancellation confirmation', he: 'אישור ביטול', es: 'Confirmación de cancelación' },
      messageClass: 'transactional',
      initiator: 'client',
      note: 'B-11: the client cancelled; the answer to their own action still goes out.',
    },
    'leads.auto_reply': {
      id: 'leads.auto_reply',
      labels: { en: 'Lead auto-reply', he: 'מענה אוטומטי לפנייה', es: 'Respuesta automática' },
      messageClass: 'marketing',
      initiator: 'system',
      capability: 'marketing.lead_response',
      note: 'B-9 classes lead chasing as marketing, so it stops in grace.',
    },
  } satisfies Record<string, SendDefinition>,

  /**
   * Per-send exceptions, keyed by send id.
   *
   * Empty: the defaults above express the decisions as taken. This is the seam
   * that makes "should intake questionnaires still go out when paused?" a config
   * edit rather than a code change (Q-B4) — one entry here overrides the
   * (class, initiator) default for one send in one state.
   */
  sendPolicyOverrides: {},
} as const satisfies LifecycleConfigShape;

/**
 * The surface kind an automated send is subject to.
 *
 * Derived, never chosen: a call site that could pick its own would eventually
 * pick the wrong one, and B-11's distinction would quietly stop holding.
 */
export function surfaceKindForSend(send: Pick<SendDefinition, 'messageClass' | 'initiator'>): SurfaceKind {
  if (send.messageClass === 'marketing') return 'send:marketing';
  return send.initiator === 'client' ? 'send:transactional:client' : 'send:transactional:system';
}
