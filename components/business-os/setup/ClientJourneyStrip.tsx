'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { ServiceCollection } from '@/lib/repositories/SchedulingRepository';

/**
 * What your client sees.
 *
 * A setting and its consequence were never on screen together. Someone set a
 * price, a duration, a way of collecting and a set of hours, and the only place
 * those added up to anything was the public page — which they never opened. So
 * they found out from a client, or from a dashboard that had already told them
 * everything was fine.
 *
 * This renders the journey from exactly the facts the public page runs on, so
 * the same four pills appear next to the service being edited, on the plan
 * before anything is built, on the last mile as it resolves, and in the publish
 * dialog where a step that cannot happen says why.
 *
 * Two facts decide it, both belonging to the service rather than the business:
 *
 *   scheduled   does the client pick a time?   → the booking step
 *   collection  how does the money arrive?     → the payment step
 *
 * And one belonging to the business: an intake form, if it collects one, which
 * comes after everything else.
 *
 * A service billed against an invoice has no payment step at all: the client
 * finishes at their details and the invoice follows. Drawing "payment" there
 * would describe a screen nobody is ever shown.
 */

export interface JourneyService {
  /** Does booking this involve picking a time? */
  scheduled: boolean;
  /** Null while the service is free. */
  collection: ServiceCollection | null;
  /** Null means the fee is agreed per client; zero means free. */
  price: number | null | undefined;
}

interface ClientJourneyStripProps {
  service: JourneyService;
  /**
   * Whether the business has working hours yet. False draws the booking step
   * as unfulfilled rather than hiding it — the step is real, it just cannot
   * run. It is the act of booking, not a date field: the client is choosing a
   * time with you, and "תאריך" described the widget rather than the step.
   */
  hoursReady?: boolean;
  /** Whether a card can actually be charged today. */
  processorReady?: boolean;
  /**
   * The business collects an intake form after a booking.
   *
   * Business-wide rather than per service, because that is how the platform
   * stores it — one form, switched on or off. It comes last: the client has
   * already committed, and the form is what the business needs before the
   * appointment rather than a hurdle in front of it.
   */
  intakeEnabled?: boolean;
  /** Names what an unfulfilled step is waiting for, under the strip. */
  showReasons?: boolean;
  /** Tighter type, for a table row rather than a card. */
  compact?: boolean;
  /**
   * Turns the two decidable steps into controls.
   *
   * Off everywhere by default, so the plan, the last mile and the publish
   * dialog keep showing a picture rather than a form. On in the services
   * table, where the journey sits directly beneath the settings that produce
   * it — and where the shortest way to say "no, they should not pay online"
   * is to press the step that says they will.
   *
   * Only booking and payment can be pressed. `service` and `details` are not
   * decisions, and `intake` belongs to the business rather than this service.
   */
  editable?: boolean;
  /** Called with just the fact that changed. Required for `editable`. */
  onChange?: (patch: { scheduled?: boolean; collection?: ServiceCollection }) => void;
  /** Disables the controls while a change is in flight. */
  saving?: boolean;
}

type StepKind = 'service' | 'booking' | 'details' | 'payment' | 'intake';

const STEP_COLOR: Record<StepKind, string> = {
  service: '#D14E97',
  booking: '#14B8A6',
  details: '#4F6EF7',
  payment: '#22C58B',
  intake: '#8B5CF6',
};

function tint(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/** Whether this service asks for money on the way through. */
export function journeyTakesPayment(service: JourneyService, processorReady: boolean): boolean {
  return (service.price || 0) > 0 && service.collection === 'online' && processorReady;
}

export function ClientJourneyStrip({
  service,
  hoursReady = true,
  processorReady = true,
  intakeEnabled = false,
  showReasons = false,
  compact = false,
  editable = false,
  onChange,
  saving = false,
}: ClientJourneyStripProps) {
  const { t, isRTL } = useLanguage();
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  const priced = (service.price || 0) > 0;
  const online = priced && service.collection === 'online';
  const invoiced = priced && service.collection === 'invoice';

  /**
   * `on` is whether the step happens; `ready` is whether it can.
   *
   * They were the same thing while this was read-only — a step that does not
   * happen was simply absent. Editing needs somewhere to press to bring a step
   * back, so in editable mode the two decidable steps are always drawn, and an
   * "off" one is what you press to turn on. Read-only keeps the old behaviour
   * exactly: absent means absent.
   */
  const steps: Array<{ kind: StepKind; ready: boolean; on: boolean }> = [
    { kind: 'service', ready: true, on: true },
  ];
  if (service.scheduled || editable) {
    steps.push({ kind: 'booking', ready: hoursReady, on: service.scheduled });
  }
  steps.push({ kind: 'details', ready: true, on: true });
  // Only an online service has a payment step. An invoiced one is billed after,
  // which is not something the client does here — but while editing, the step
  // is still the place to say so, as long as there is money involved at all.
  if (online || (editable && priced)) {
    steps.push({ kind: 'payment', ready: processorReady, on: online });
  }
  // After the money, because a form asked before the client has committed is a
  // reason to leave.
  if (intakeEnabled) steps.push({ kind: 'intake', ready: true, on: true });

  /** Booking and payment are decisions; the rest are consequences. */
  const canPress = (kind: StepKind) =>
    editable && !saving && (kind === 'booking' || kind === 'payment');

  const press = (kind: StepKind, on: boolean) => {
    if (kind === 'booking') onChange?.({ scheduled: !on });
    if (kind === 'payment') onChange?.({ collection: on ? 'invoice' : 'online' });
  };

  const reasons = showReasons
    ? steps
      .filter(step => step.on && !step.ready)
      .map(step => t(`journey.blocked.${step.kind}`))
    : [];

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {steps.map((step, index) => {
          const color = STEP_COLOR[step.kind];
          const pressable = canPress(step.kind);
          // Three appearances, in order of precedence: off (not part of this
          // journey), unfulfilled (part of it, cannot run yet), and on.
          const solid = step.on && step.ready;
          const pillStyle: React.CSSProperties = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
            fontFamily: bodyFont,
            fontSize: compact ? '10.5px' : '11.5px',
            fontWeight: 500,
            padding: compact ? '3px 8px' : '5px 10px',
            borderRadius: '999px',
            // An unfulfilled or switched-off step is dashed and grey: it is
            // part of the picture, and it is not going to happen.
            border: `1px ${solid ? 'solid' : 'dashed'} ${solid ? tint(color, 0.55) : 'var(--v2-border)'}`,
            background: solid ? 'var(--v2-surface)' : 'transparent',
            color: solid ? color : 'var(--v2-text-muted)',
            opacity: step.on ? 1 : 0.75,
            cursor: pressable ? 'pointer' : 'default',
            transition: 'border-color 120ms, color 120ms, opacity 120ms',
          };

          const content = (
            <>
              <i
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'currentColor',
                  opacity: 0.55,
                  flexShrink: 0,
                }}
              />
              {t(`journey.step.${step.kind}`)}
            </>
          );

          return (
            <span key={step.kind} style={{ display: 'contents' }}>
              {index > 0 && (
                <span style={{ color: 'var(--v2-text-muted)', fontSize: '13px', flexShrink: 0 }}>
                  {isRTL ? '←' : '→'}
                </span>
              )}
              {pressable ? (
                <button
                  type="button"
                  onClick={() => press(step.kind, step.on)}
                  disabled={saving}
                  aria-pressed={step.on}
                  title={t(step.on ? 'journey.edit.remove' : 'journey.edit.add')}
                  style={{ ...pillStyle, appearance: 'none' }}
                >
                  {content}
                </button>
              ) : (
                <span style={pillStyle}>{content}</span>
              )}
            </span>
          );
        })}

        {/* Said after the steps, not as one of them. While editing, the
            switched-off payment step already says it. */}
        {invoiced && !editable && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              marginInlineStart: '4px',
              fontFamily: bodyFont,
              fontSize: compact ? '10px' : '11px',
              color: 'var(--v2-text-muted)',
            }}
          >
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: STEP_COLOR.payment, opacity: 0.6 }} />
            {t('journey.invoiceAfter')}
          </span>
        )}
      </div>

      {reasons.length > 0 && (
        <p
          style={{
            margin: '9px 0 0',
            fontFamily: bodyFont,
            fontSize: '11.5px',
            lineHeight: 1.4,
            color: '#C2410C',
          }}
        >
          {reasons.join(' · ')}
        </p>
      )}
    </div>
  );
}

/** The label under a service row, in the words the platform uses elsewhere. */
export function useCollectionLabel() {
  const { t } = useLanguage();
  return (service: JourneyService): string => {
    if ((service.price || 0) <= 0) return t('journey.pay.free');
    return service.collection === 'online' ? t('journey.pay.online') : t('journey.pay.invoice');
  };
}
