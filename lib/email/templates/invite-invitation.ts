/**
 * "<Inviter> invited you to AgentPilot" — the invitation email of invite-only
 * signup Slice 2a (requirement FR-15, FR-15a; workplan §3.5, D-3, D-4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PERSONAL INVITATION ON THE PLATFORM'S LOOK
 *
 * It comes "<Name> via AgentPilot" (the sender is decided in
 * `lib/business-os/invites/inviteSender.ts`, not here) and carries the
 * inviter's own note. The look is the platform's, not a business's: nobody has
 * a business yet.
 *
 * THE LINK IS IN THE BODY ONLY
 *
 * The transport logs the subject (50 characters on the attempt line, all of it
 * on the final "no transport delivered" warning, SA R-13), so the subject names
 * the inviter and never the link. The link appears twice in the body, as the
 * button and as plain text for clients that strip buttons, and always left to
 * right, even in a Hebrew email.
 *
 * EVERYTHING THE ADMIN TYPED IS ESCAPED
 *
 * The inviter's name and the note are HTML-escaped; the note keeps its line
 * breaks. The subject has control characters removed, so a name cannot add a
 * header line.
 *
 * DOING NOTHING IS THE SAFE DEFAULT
 *
 * Someone whose address was typed in by a stranger must be able to tell at a
 * glance that ignoring this ends the matter.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Plan names stay English in every locale (Slice 0 F-4). The expiry is a date
 * only, in UTC, in the invite's locale (SA F-7).
 *
 * @module lib/email/templates/invite-invitation
 */

import type { Locale } from '@/lib/i18n/config';
import { emailButton, formatEmailDate, wrapInBrandedTemplate, type BrandingData } from './base-template';

/** What the invitation offers, decided by the caller from the invite row. */
export type InvitationOffer =
  | { kind: 'free'; accessOpenEnded: boolean; accessMonths: number | null }
  | { kind: 'payment_required' };

export interface InviteInvitationEmailData {
  /**
   * The inviter's name as the invitee should read it, or `null` for the
   * platform fallback (BQ-9: no admin name on record). `null` changes the copy
   * to "You're invited", never "AgentPilot invited you to AgentPilot".
   */
  inviterName: string | null;
  /** The admin's note, plain text, or `null`/empty for none. */
  personalNote: string | null;
  /** The plan's display name (English in every locale). */
  planName: string;
  offer: InvitationOffer;
  /** Exactly the link the admin was shown (`buildInviteLink`). */
  linkUrl: string;
  linkExpiresAt: Date;
  locale: Locale;
}

interface Copy {
  subject: (name: string) => string;
  subjectFallback: string;
  heading: (name: string) => string;
  headingFallback: string;
  noteFrom: (name: string) => string;
  noteFromFallback: string;
  offerTitle: string;
  free: string;
  openEnded: string;
  months: (count: number) => string;
  paymentRequired: string;
  button: string;
  plainLink: string;
  validUntil: (date: string) => string;
  ignore: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subject: (name) => `${name} invited you to AgentPilot`,
    subjectFallback: "You're invited to AgentPilot",
    heading: (name) => `${name} invited you to join AgentPilot`,
    headingFallback: "You're invited to join AgentPilot",
    noteFrom: (name) => `A note from ${name}:`,
    noteFromFallback: 'A note from the AgentPilot team:',
    offerTitle: 'Your plan',
    free: 'Free',
    openEnded: 'No end date',
    months: (count) => (count === 1 ? '1 month' : `${count} months`),
    paymentRequired: 'Payment required',
    button: 'Accept your invitation',
    plainLink: 'Or paste this link into your browser:',
    validUntil: (date) => `This invitation is valid until ${date}.`,
    ignore: 'Not expecting this? You can ignore this email; nothing happens unless you sign up.',
  },
  he: {
    subject: (name) => `הזמנה מ־${name} להצטרף ל־AgentPilot`,
    subjectFallback: 'הזמנה להצטרף ל־AgentPilot',
    heading: (name) => `קיבלת הזמנה מ־${name} להצטרף ל־AgentPilot`,
    headingFallback: 'קיבלת הזמנה להצטרף ל־AgentPilot',
    noteFrom: (name) => `הודעה מ־${name}:`,
    noteFromFallback: 'הודעה מצוות AgentPilot:',
    offerTitle: 'התוכנית שלך',
    free: 'חינם',
    openEnded: 'ללא תאריך סיום',
    months: (count) => (count === 1 ? 'חודש אחד' : `${count} חודשים`),
    paymentRequired: 'נדרש תשלום',
    button: 'קבלת ההזמנה',
    plainLink: 'אפשר גם להעתיק את הקישור הזה לדפדפן:',
    validUntil: (date) => `ההזמנה בתוקף עד ${date}.`,
    ignore: 'לא ציפית להודעה הזו? אפשר פשוט להתעלם ממנה. שום דבר לא יקרה אם לא נרשמים.',
  },
  es: {
    subject: (name) => `${name} te ha invitado a AgentPilot`,
    subjectFallback: 'Te han invitado a AgentPilot',
    heading: (name) => `${name} te ha invitado a unirte a AgentPilot`,
    headingFallback: 'Te han invitado a unirte a AgentPilot',
    noteFrom: (name) => `Un mensaje de ${name}:`,
    noteFromFallback: 'Un mensaje del equipo de AgentPilot:',
    offerTitle: 'Tu plan',
    free: 'Gratis',
    openEnded: 'Sin fecha de fin',
    months: (count) => (count === 1 ? '1 mes' : `${count} meses`),
    paymentRequired: 'Requiere pago',
    button: 'Aceptar tu invitación',
    plainLink: 'O pega este enlace en tu navegador:',
    validUntil: (date) => `Esta invitación es válida hasta el ${date}.`,
    ignore: '¿No esperabas este correo? Puedes ignorarlo; no pasará nada a menos que te registres.',
  },
};

/** The platform's own look: no business branding (the invitee has no business yet). */
const PLATFORM_BRANDING: Omit<BrandingData, 'locale'> = {
  businessName: 'AgentPilot',
  primaryColor: '#0f172a',
  secondaryColor: '#334155',
};

/** HTML-escape text the admin typed. Each template keeps its own (no shared helper exists). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A subject line with no control character, so no text can start a new header. */
function subjectSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function offerLines(t: Copy, offer: InvitationOffer): string[] {
  if (offer.kind === 'payment_required') return [t.paymentRequired];
  const duration = offer.accessOpenEnded || offer.accessMonths === null ? t.openEnded : t.months(offer.accessMonths);
  return [t.free, duration];
}

export function generateInviteInvitationEmail(data: InviteInvitationEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const t = COPY[data.locale] ?? COPY.en;
  const isRTL = data.locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  const name = data.inviterName?.trim() ? data.inviterName.trim() : null;
  const note = data.personalNote?.trim() ? data.personalNote.trim() : null;
  const expiry = formatEmailDate(data.linkExpiresAt, 'UTC', { includeTime: false, locale: data.locale });
  const offer = offerLines(t, data.offer);

  const heading = name ? t.heading(name) : t.headingFallback;
  const noteFrom = name ? t.noteFrom(name) : t.noteFromFallback;
  const link = escapeHtml(data.linkUrl);

  const noteHtml = note
    ? `
      <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600;">${escapeHtml(noteFrom)}</p>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; white-space: normal;">${escapeHtml(note).replace(/\r?\n/g, '<br>')}</p>`
    : '';

  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">${escapeHtml(heading)}</h1>
      ${noteHtml}
      <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600;">${escapeHtml(t.offerTitle)}</p>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;"><span dir="ltr">${escapeHtml(data.planName)}</span> · ${offer
        .map(escapeHtml)
        .join(' · ')}</p>
      ${emailButton(escapeHtml(t.button), link, { branding: { ...PLATFORM_BRANDING, locale: data.locale } })}
      <p style="margin: 16px 0 4px; font-size: 13px;">${escapeHtml(t.plainLink)}</p>
      <p dir="ltr" style="margin: 0 0 16px; font-size: 13px; text-align: left; word-break: break-all; font-family: monospace;">${link}</p>
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">${escapeHtml(t.validUntil(expiry))}</p>
      <p style="margin: 20px 0 0; font-size: 13px; opacity: 0.7; line-height: 1.6;">${escapeHtml(t.ignore)}</p>
    </div>
  `;

  const text = [
    heading,
    '',
    ...(note ? [noteFrom, note, ''] : []),
    `${t.offerTitle}: ${data.planName} · ${offer.join(' · ')}`,
    '',
    `${t.button}:`,
    data.linkUrl,
    '',
    t.validUntil(expiry),
    '',
    t.ignore,
  ].join('\n');

  return {
    subject: subjectSafe(name ? t.subject(name) : t.subjectFallback),
    html: wrapInBrandedTemplate(content, { ...PLATFORM_BRANDING, locale: data.locale }),
    text,
  };
}
