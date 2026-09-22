// lib/email/templates/insight-actions.ts
//
// The three messages the platform sends on a business's behalf when an insight
// automation fires. Queued and drained by /api/cron/insight-actions.
//
// ---------------------------------------------------------------------------
// THESE ARE WRITTEN AS THE OWNER, NOT AS THE PLATFORM
//
// The client has a relationship with a person, not with software. Nothing here
// says "automatically", "our system" or "this is a reminder from AgentPilot" —
// the owner's name is on it, and a message that announces itself as automated
// invites being treated as automated. The owner chose to send it; the platform
// only typed it.
//
// SHORT, AND NOT CHATTY
//
// Every one of these interrupts somebody who did not ask to be written to. A
// chase that opens with three lines of warmth before the number reads worse
// than one that says what it is about. The tone setting adjusts the wording,
// never the length.
//
// WHAT THEY NEVER DO
//
//  - threaten, escalate, or mention consequences. An overdue invoice is
//    usually an oversight, and a business that sounds like a debt collector
//    over a forgotten £200 loses the client and the £200.
//  - state a total the caller did not supply. Every figure is passed in.
//  - guess at why. "You may have missed this" is an assumption about someone
//    the platform knows nothing about.
// ---------------------------------------------------------------------------

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailPalette,
  formatCurrency,
  formatEmailDate,
  type BrandingData,
} from './base-template';

/**
 * How the owner wants to sound. Chosen once in the automation's settings.
 *
 * Not a spectrum of politeness: all three are polite. It is how much scaffolding
 * sits around the ask.
 */
export type EmailTone = 'friendly' | 'neutral' | 'firm';

interface CommonData {
  clientName: string;
  businessName: string;
  branding: BrandingData;
  locale?: Locale;
  tone?: EmailTone;
}

export interface ChaseInvoiceData extends CommonData {
  /** The business's timezone, so a due DATE is not shifted across midnight. */
  timezone?: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate?: Date | null;
  daysOverdue: number;
  payUrl?: string | null;
}

/**
 * Why this person is being written to.
 *
 * Seven detectors share this one message, and "you have gone quiet" is not the
 * same sentence for somebody who enquired and never replied as for a client of
 * two years who has not booked since spring. Addressing them identically is how
 * an automation starts sounding like a mailing list.
 *
 * The reason changes the OPENING only. The offer and the button are the same,
 * because the useful part of the message is identical in all five cases: here
 * is how to book the next thing.
 */
export type NudgeReason =
  /** Enquired, never became a client. */
  | 'new_enquiry'
  /** In the pipeline and not moving. */
  | 'stalled'
  /** An existing client who has not been back. */
  | 'past_client'
  /** Took the intro offer and did not continue. */
  | 'after_intro'
  /** Nothing more specific is known. */
  | 'unspecified';

export interface FollowupNudgeData extends CommonData {
  /** What the owner offers, so the message has a reason to exist. */
  serviceName?: string | null;
  bookingUrl?: string | null;
  /** Roughly how long since they were last in touch. Omitted when unknown. */
  daysSinceContact?: number | null;
  reason?: NudgeReason;
}

export interface BookingReminderData extends CommonData {
  serviceName: string;
  startsAt: Date;
  timezone: string;
  manageUrl?: string | null;
}

/* ------------------------------------------------------------------ chase */

/**
 * A reminder that an invoice is outstanding.
 *
 * Deliberately does NOT lead with how late it is. The number of days is a fact
 * about the business's records, not about the client's intentions, and opening
 * with it turns a reminder into an accusation. It appears once, plainly, after
 * the amount.
 */
export function generateChaseInvoiceEmail(data: ChaseInvoiceData): { subject: string; html: string } {
  const { clientName, businessName, invoiceNumber, amount, currency, dueDate, daysOverdue, payUrl, branding } = data;
  const timezone = data.timezone ?? 'UTC';
  const locale = data.locale ?? 'en';
  const tone = data.tone ?? 'friendly';
  const palette = emailPalette(branding);
  const money = formatCurrency(amount, currency);

  const opening =
    tone === 'friendly'
      ? `Hi ${clientName}, I hope you're well.`
      : tone === 'firm'
        ? `Hi ${clientName},`
        : `Hi ${clientName},`;

  const ask =
    tone === 'firm'
      ? `Invoice ${invoiceNumber} for ${money} is still outstanding and I'd be grateful if you could settle it.`
      : `I wanted to check in about invoice ${invoiceNumber} for ${money}, which is still showing as unpaid.`;

  // Stated once, as a fact, with no adjective attached to it.
  const timing = dueDate
    ? `<p style="margin:0 0 16px;color:${palette.inkMuted};font-size:14px;">It was due on ${formatEmailDate(dueDate, timezone, { locale, includeTime: false })}${daysOverdue > 0 ? `, ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} ago` : ''}.</p>`
    : '';

  const button = payUrl ? emailButton('Pay invoice', payUrl, { branding }) : '';

  const html = wrapInBrandedTemplate(
    `
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">${opening}</p>
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">${ask}</p>
      ${timing}
      ${button}
      <p style="margin:24px 0 0;font-size:14px;color:${palette.inkMuted};">
        If you've already paid, please ignore this. Thank you.
      </p>
      <p style="margin:16px 0 0;font-size:16px;color:${palette.ink};">${businessName}</p>
    `,
    // Locale rides on `branding`, which is where the wrapper reads it from —
    // passing it separately silently did nothing.
    { ...branding, locale }
  );

  return { subject: `Invoice ${invoiceNumber} from ${businessName}`, html };
}

/* ----------------------------------------------------------------- nudge */

/**
 * A note to somebody who went quiet.
 *
 * The hardest of the three to write, because the honest content is "we noticed
 * you stopped replying" and nobody wants to receive that. So it does not
 * mention the silence at all: it offers the next thing, which is the only part
 * the recipient can act on. `daysSinceContact` is accepted and deliberately
 * never rendered — it belongs in the owner's dashboard, not in the client's
 * inbox.
 */
export function generateFollowupNudgeEmail(data: FollowupNudgeData): { subject: string; html: string } {
  const { clientName, businessName, serviceName, bookingUrl, branding } = data;
  const locale = data.locale ?? 'en';
  const tone = data.tone ?? 'friendly';
  const palette = emailPalette(branding);

  const greeting =
    tone === 'friendly'
      ? `Hi ${clientName}, I hope you're keeping well.`
      : `Hi ${clientName},`;

  /*
   * The opening carries the reason; nothing else in the message does.
   *
   * None of these states the silence back to the recipient. "We noticed you
   * stopped replying" is the honest content and nobody wants to receive it, so
   * each one instead picks up where the relationship actually left off.
   */
  const reason = data.reason ?? 'unspecified';
  const opening =
    reason === 'new_enquiry'
      ? `${greeting} You got in touch about working together, and I wanted to follow up.`
      : reason === 'past_client'
        ? `${greeting} It has been a little while since your last visit.`
        : reason === 'after_intro'
          ? `${greeting} I hope you enjoyed your first session.`
          : greeting;

  const next = serviceName ? `your next ${serviceName}` : 'your next session';
  const body =
    reason === 'new_enquiry'
      ? `If you'd still like to go ahead, you can pick a time that suits you.`
      : `I wanted to check whether you'd like to arrange ${next}.`;

  const button = bookingUrl ? emailButton('Book a time', bookingUrl, { branding }) : '';

  const html = wrapInBrandedTemplate(
    `
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">${opening}</p>
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">${body}</p>
      ${button}
      <p style="margin:24px 0 0;font-size:14px;color:${palette.inkMuted};">
        If now isn't the right time, just let me know and I'll leave it with you.
      </p>
      <p style="margin:16px 0 0;font-size:16px;color:${palette.ink};">${businessName}</p>
    `,
    // Locale rides on `branding`, which is where the wrapper reads it from —
    // passing it separately silently did nothing.
    { ...branding, locale }
  );

  return { subject: `Booking your next session with ${businessName}`, html };
}

/* -------------------------------------------------------------- reminder */

/** The appointment, when it is, and how to change it. */
export function generateBookingReminderEmail(data: BookingReminderData): { subject: string; html: string } {
  const { clientName, businessName, serviceName, startsAt, timezone, manageUrl, branding } = data;
  const locale = data.locale ?? 'en';
  const palette = emailPalette(branding);
  const when = formatEmailDate(startsAt, timezone, { locale });

  const button = manageUrl ? emailButton('Reschedule or cancel', manageUrl, { branding }) : '';

  const html = wrapInBrandedTemplate(
    `
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">Hi ${clientName},</p>
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">
        A reminder about your ${serviceName} on ${when}.
      </p>
      ${button}
      <p style="margin:24px 0 0;font-size:14px;color:${palette.inkMuted};">
        Looking forward to seeing you.
      </p>
      <p style="margin:16px 0 0;font-size:16px;color:${palette.ink};">${businessName}</p>
    `,
    // Locale rides on `branding`, which is where the wrapper reads it from —
    // passing it separately silently did nothing.
    { ...branding, locale }
  );

  return { subject: `Reminder: ${serviceName} on ${when}`, html };
}
