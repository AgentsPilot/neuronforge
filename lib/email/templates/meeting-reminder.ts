// lib/email/templates/meeting-reminder.ts
// The reminder that goes out before an appointment — one for the client, one
// for the owner. Two audiences, two jobs, two templates.

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
  emailPalette,
  formatEmailDate,
  type BrandingData,
} from './base-template';

/**
 * How near the appointment is, in the words a person would use.
 *
 * "Tomorrow" and "in about 2 hours" are read instantly; "on 24 September at
 * 14:00" has to be compared against today's date before it means anything, and
 * a reminder is read in a hurry or not at all. The full date is still shown in
 * the details, because "tomorrow" alone is no use to somebody who opens the
 * mail a day late.
 */
function proximity(startsAt: Date, now: number, locale: Locale): string {
  const hours = (startsAt.getTime() - now) / 3_600_000;

  const words: Record<Locale, { soon: (h: number) => string; today: string; tomorrow: string; days: (d: number) => string }> = {
    en: {
      soon: h => `in about ${h} hour${h === 1 ? '' : 's'}`,
      today: 'later today',
      tomorrow: 'tomorrow',
      days: d => `in ${d} days`,
    },
    es: {
      soon: h => `en unas ${h} hora${h === 1 ? '' : 's'}`,
      today: 'hoy más tarde',
      tomorrow: 'mañana',
      days: d => `en ${d} días`,
    },
    he: {
      soon: h => `בעוד כ-${h} שעות`,
      today: 'היום',
      tomorrow: 'מחר',
      days: d => `בעוד ${d} ימים`,
    },
  } as Record<Locale, { soon: (h: number) => string; today: string; tomorrow: string; days: (d: number) => string }>;

  const w = words[locale] ?? words.en;

  if (hours <= 12) return hours <= 1 ? w.soon(1) : w.soon(Math.round(hours));
  if (hours <= 24) return w.today;
  if (hours <= 48) return w.tomorrow;
  return w.days(Math.round(hours / 24));
}

export interface MeetingReminderData {
  clientName: string;
  businessName: string;
  serviceName: string;
  startsAt: Date;
  timezone: string;
  /** Where it happens, when the service records one. */
  location?: string | null;
  /** Lets them move it themselves rather than writing to ask. */
  manageUrl?: string | null;
  branding: BrandingData;
  locale?: Locale;
  /** Injectable so a test is not a function of the minute it runs. */
  now?: number;
}

/**
 * The client's reminder.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Warm, short, and useful in that order. Somebody reading this is deciding one
 * thing — am I still coming — and everything on the page serves that: when it
 * is, where it is, and a way to move it without having to compose a message.
 *
 * THE RESCHEDULE LINK IS NOT A CONCESSION
 *
 * It is the whole point. A client who cannot easily move an appointment does
 * not move it, they miss it — and a no-show costs the owner the slot AND the
 * relationship, where a reschedule costs neither. Making the easy path the
 * honest one is what turns this from a nag into a service.
 *
 * NOTHING IS ASKED FOR. No confirmation, no reply, no "please let us know".
 * A reminder that creates an obligation is another thing on somebody's list,
 * and the ones that get ignored are the ones that ask.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function generateMeetingReminderEmail(
  data: MeetingReminderData
): { subject: string; html: string } {
  const { clientName, businessName, serviceName, startsAt, timezone, location, manageUrl, branding } = data;
  const locale = data.locale ?? 'en';
  const palette = emailPalette(branding);
  const when = formatEmailDate(startsAt, timezone, { locale });
  const near = proximity(startsAt, data.now ?? Date.now(), locale);

  const copy = {
    en: {
      greeting: `Hi ${clientName},`,
      lede: `Just a note that your ${serviceName} with ${businessName} is ${near}.`,
      when: 'When',
      where: 'Where',
      what: 'What',
      manage: 'Change the time',
      closing: 'Looking forward to seeing you.',
      // No "please confirm". See the header.
      footnote: `If something has come up, you can move it using the link above — no need to write.`,
    },
    es: {
      greeting: `Hola ${clientName}:`,
      lede: `Un recordatorio de que tu ${serviceName} con ${businessName} es ${near}.`,
      when: 'Cuándo',
      where: 'Dónde',
      what: 'Qué',
      manage: 'Cambiar la hora',
      closing: 'Nos vemos pronto.',
      footnote: `Si te ha surgido algo, puedes cambiarla con el enlace de arriba, sin necesidad de escribir.`,
    },
    he: {
      greeting: `היי ${clientName},`,
      lede: `רק תזכורת ש${serviceName} שלך עם ${businessName} ${near}.`,
      when: 'מתי',
      where: 'איפה',
      what: 'מה',
      manage: 'שינוי המועד',
      closing: 'נתראה בקרוב.',
      footnote: `אם משהו צץ, אפשר להזיז את הפגישה דרך הקישור למעלה. אין צורך לכתוב.`,
    },
  }[locale] ?? null;

  const t = copy ?? {
    greeting: `Hi ${clientName},`,
    lede: `Just a note that your ${serviceName} with ${businessName} is ${near}.`,
    when: 'When', where: 'Where', what: 'What',
    manage: 'Change the time',
    closing: 'Looking forward to seeing you.',
    footnote: 'If something has come up, you can move it using the link above — no need to write.',
  };

  const details = emailDetailsTable(
    [
      emailDetailRow(t.what, serviceName, branding),
      emailDetailRow(t.when, when, branding),
      location ? emailDetailRow(t.where, location, branding) : '',
    ].filter(Boolean),
    branding
  );

  const button = manageUrl ? emailButton(t.manage, manageUrl, { branding }) : '';

  const html = wrapInBrandedTemplate(
    `
      <p style="margin:0 0 16px;font-size:16px;color:${palette.ink};">${t.greeting}</p>
      <p style="margin:0 0 20px;font-size:16px;color:${palette.ink};">${t.lede}</p>
      ${details}
      ${button}
      <p style="margin:24px 0 0;font-size:16px;color:${palette.ink};">${t.closing}</p>
      <p style="margin:16px 0 0;font-size:14px;color:${palette.inkMuted};">${t.footnote}</p>
      <p style="margin:16px 0 0;font-size:16px;color:${palette.ink};">${businessName}</p>
    `,
    // Locale rides on `branding`, which is where the wrapper reads it from —
    // passing it separately silently does nothing.
    { ...branding, locale }
  );

  return { subject: `${serviceName} ${near} — ${when}`, html };
}

export interface OwnerMeetingReminderData extends Omit<MeetingReminderData, 'clientName'> {
  /** Who is coming. The first thing the owner needs. */
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  /** Things still outstanding on this booking, so the owner can chase before. */
  outstanding?: { intakeMissing?: boolean; paymentDue?: string | null };
}

/**
 * The owner's heads-up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A different email, not the client's with the salutation swapped. The client
 * is deciding whether to come; the owner is deciding what to do in the next
 * hour — so this leads with WHO, and carries the two things that can still be
 * fixed before the appointment: an intake form that never came back, and money
 * that has not arrived.
 *
 * Nothing on the platform tells an owner anything before a booking today. This
 * is the first thing that does, which is also why it stays short: the fastest
 * way to make it unwelcome is to send a page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function generateOwnerMeetingReminderEmail(
  data: OwnerMeetingReminderData
): { subject: string; html: string } {
  const { clientName, businessName, serviceName, startsAt, timezone, location, clientEmail, clientPhone, outstanding, branding } = data;
  const locale = data.locale ?? 'en';
  const palette = emailPalette(branding);
  const when = formatEmailDate(startsAt, timezone, { locale });
  const near = proximity(startsAt, data.now ?? Date.now(), locale);

  const copy = {
    en: {
      lede: `<strong>${clientName}</strong> is booked in ${near}.`,
      what: 'What', when: 'When', where: 'Where', contact: 'Contact',
      intake: 'Their intake form has not come back yet.',
      payment: (amount: string) => `${amount} is still outstanding on this booking.`,
      nothing: 'Nothing outstanding — all set.',
    },
    es: {
      lede: `<strong>${clientName}</strong> tiene cita ${near}.`,
      what: 'Qué', when: 'Cuándo', where: 'Dónde', contact: 'Contacto',
      intake: 'Su formulario de admisión aún no ha llegado.',
      payment: (amount: string) => `Quedan ${amount} pendientes en esta reserva.`,
      nothing: 'Nada pendiente, todo listo.',
    },
    he: {
      lede: `<strong>${clientName}</strong> מגיע ${near}.`,
      what: 'מה', when: 'מתי', where: 'איפה', contact: 'יצירת קשר',
      intake: 'הטופס שלהם עדיין לא חזר.',
      payment: (amount: string) => `נותרו ${amount} לתשלום על הפגישה הזאת.`,
      nothing: 'אין שום דבר פתוח. הכול מוכן.',
    },
  }[locale] ?? null;

  const t = copy ?? {
    lede: `<strong>${clientName}</strong> is booked in ${near}.`,
    what: 'What', when: 'When', where: 'Where', contact: 'Contact',
    intake: 'Their intake form has not come back yet.',
    payment: (amount: string) => `${amount} is still outstanding on this booking.`,
    nothing: 'Nothing outstanding — all set.',
  };

  const reach = [clientEmail, clientPhone].filter(Boolean).join(' · ');

  const details = emailDetailsTable(
    [
      emailDetailRow(t.what, serviceName, branding),
      emailDetailRow(t.when, when, branding),
      location ? emailDetailRow(t.where, location, branding) : '',
      reach ? emailDetailRow(t.contact, reach, branding) : '',
    ].filter(Boolean),
    branding
  );

  /*
   * Only what can still be acted on. A list of everything that is FINE is a
   * list nobody reads, so the all-clear is one line and the exceptions are the
   * notice box.
   */
  const flags = [
    outstanding?.intakeMissing ? t.intake : '',
    outstanding?.paymentDue ? t.payment(outstanding.paymentDue) : '',
  ].filter(Boolean);

  const notice = flags.length > 0
    ? emailNoticeBox(flags.join('<br>'), 'warning', branding)
    : `<p style="margin:16px 0 0;font-size:14px;color:${palette.inkMuted};">${t.nothing}</p>`;

  const html = wrapInBrandedTemplate(
    `
      <p style="margin:0 0 20px;font-size:16px;color:${palette.ink};">${t.lede}</p>
      ${details}
      ${notice}
    `,
    { ...branding, locale }
  );

  return { subject: `${clientName} — ${serviceName} ${near}`, html };
}
