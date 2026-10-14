/**
 * "Your invitation was accepted" — the inviter's notification (invite-only
 * signup N-1; requirement FR-39 to FR-41 as recorded by T-0; workplan §2.4,
 * §2.5; SA Q-5, C-3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TO THE PERSON WHO ISSUED THE INVITE
 *
 * A champion (a friend invite) or the individual admin who issued an admin
 * invite. It is a platform message to a customer, not an invitation, so it is
 * sent from the platform's system sender with no Reply-To (the caller,
 * `lib/business-os/invites/inviterNotification.ts`, decides that, not here).
 *
 * ONLY WHAT THE INVITER ALREADY KNOWS (N3)
 *
 * The address the inviter typed, exactly as stored on the invite, and a
 * status. Never the invitee's name, Google display name, business, plan or
 * account id. The address is HTML-escaped everywhere it appears in the HTML.
 *
 * THE STATUS WORDS ARE THE LIST'S (SA Q-5)
 *
 * A held friend is "Signed up — not subscribed yet", the FR-31 label of the
 * champion's own invite list, read from `INVITE_FRIENDS_COPY` rather than
 * re-translated, so the email and the list can never disagree.
 *
 * THE SUBJECT CARRIES NO ADDRESS
 *
 * The transport logs subjects, so the subject names the event only.
 *
 * N-2: "YOUR FRIEND SUBSCRIBED" (plan payments P-5b.1, FR-43, SA P5-C8, C-1)
 *
 * `event: 'subscribed'` is the champion's one email when a friend they invited
 * pays their first invoice. Its own subject, heading and lead; the status row
 * reads the list's `subscribed` word (`INVITE_FRIENDS_COPY[l].status.subscribed`),
 * never a second translation; no "held" note. Champions only: the caller
 * (`inviterNotification.ts`) refuses an admin recipient for it at the type level.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/templates/invite-accepted
 */

import { INVITE_FRIENDS_COPY } from '@/components/business-os/settings/inviteFriendsCopy';
import { escapeHtml } from '@/lib/email/escapeHtml';
import { platformEmailBranding } from '@/lib/email/platformBranding';
import type { Locale } from '@/lib/i18n/config';
import {
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  emailPalette,
  wrapInBrandedTemplate,
} from './base-template';

/** What happened: the invite was accepted (N-1), or the friend paid (N-2). */
export type InviterNotificationEvent = 'accepted' | 'subscribed';

/**
 * `joined`: the account is created and usable. `not_subscribed_yet`: a held
 * friend (the account waits for payment), worded with the FR-31 list label.
 * `subscribed` (N-2): the friend paid, worded with the list's `subscribed` label.
 */
export type InviteAcceptedStatus = 'joined' | 'not_subscribed_yet' | 'subscribed';

/** Who is being told: the champion (a friend invite) or the issuing admin. */
export type InviterRecipientKind = 'champion' | 'admin';

export interface InviteAcceptedEmailData {
  event: InviterNotificationEvent;
  /** The address the inviter typed, as stored on the invite. Escaped here. */
  inviteeEmail: string;
  status: InviteAcceptedStatus;
  recipientKind: InviterRecipientKind;
  /** The champion's invite list, or the admin invites page. Built by the caller. */
  actionUrl: string;
  locale: Locale;
}

interface Copy {
  subject: string;
  heading: string;
  /** Receives the address already escaped (HTML) or raw (text). */
  lead: (email: string) => string;
  invitedLabel: string;
  statusLabel: string;
  joined: string;
  heldNote: string;
  actionChampion: string;
  actionAdmin: string;
  footer: string;
  /** N-2 (`event: 'subscribed'`): its own subject, heading and lead. Button and footer are shared. */
  subscribed: {
    subject: string;
    heading: string;
    lead: (email: string) => string;
  };
}

/*
 * Hebrew is written so that no verb agrees with the invitee's gender (the
 * page and the list do the same where they can). "Joined" follows the list's
 * own generic form, "נרשם — עדיין ללא מנוי", for the same reader.
 */
const COPY: Record<Locale, Copy> = {
  en: {
    subject: 'Your invitation was accepted',
    heading: 'Your invitation was accepted',
    lead: (email) => `${email} accepted your invitation.`,
    invitedLabel: 'Invited',
    statusLabel: 'Status',
    joined: 'Joined',
    heldNote: 'They can start once they finish their payment.',
    actionChampion: 'See your invitations',
    actionAdmin: 'Open invites',
    footer: "You're getting this because you sent this invitation.",
    // FR-43's wording.
    subscribed: {
      subject: 'Your invitation turned into a subscription',
      heading: 'Your friend subscribed',
      lead: (email) => `${email} has subscribed.`,
    },
  },
  he: {
    subject: 'ההזמנה שלך התקבלה',
    heading: 'ההזמנה שלך התקבלה',
    lead: (email) => `ההזמנה שלך אל ${email} התקבלה.`,
    invitedLabel: 'נשלחה אל',
    statusLabel: 'סטטוס',
    joined: 'הצטרף',
    heldNote: 'אפשר יהיה להתחיל להשתמש אחרי השלמת התשלום.',
    actionChampion: 'להזמנות שלך',
    actionAdmin: 'לרשימת ההזמנות',
    footer: 'קיבלת את ההודעה הזו כי שלחת את ההזמנה הזו.',
    // Approved by the user 2026-10-14 (P-5b G-3). No verb agrees with the friend's gender.
    subscribed: {
      subject: 'ההזמנה שלך הפכה למנוי',
      heading: 'יש מנוי חדש מההזמנה שלך',
      lead: (email) => `התשלום עבור ${email} הושלם והמנוי פעיל.`,
    },
  },
  es: {
    subject: 'Tu invitación fue aceptada',
    heading: 'Tu invitación fue aceptada',
    lead: (email) => `${email} aceptó tu invitación.`,
    invitedLabel: 'Invitación a',
    statusLabel: 'Estado',
    joined: 'Se unió',
    heldNote: 'Podrá empezar en cuanto complete el pago.',
    actionChampion: 'Ver tus invitaciones',
    actionAdmin: 'Abrir invitaciones',
    footer: 'Recibes este correo porque enviaste esta invitación.',
    // Approved by the user 2026-10-14 (P-5b G-3).
    subscribed: {
      subject: 'Tu invitación se convirtió en una suscripción',
      heading: 'Nueva suscripción desde tu invitación',
      lead: (email) => `${email} se suscribió.`,
    },
  },
};

/**
 * The status words: the FR-31 list labels for a held friend (SA Q-5) and for
 * a friend who paid (N-2, SA C-1), never re-translated.
 */
function statusWords(t: Copy, status: InviteAcceptedStatus, locale: Locale): string {
  if (status === 'joined') return t.joined;
  const listLocale = locale === 'he' || locale === 'es' ? locale : 'en';
  return status === 'subscribed' ? INVITE_FRIENDS_COPY[listLocale].status.subscribed : INVITE_FRIENDS_COPY[listLocale].status.joined;
}

export function generateInviteAcceptedEmail(data: InviteAcceptedEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const t = COPY[data.locale] ?? COPY.en;
  const locale: Locale = COPY[data.locale] ? data.locale : 'en';
  const isRTL = locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  const branding = platformEmailBranding(locale);
  const palette = emailPalette(branding);

  const email = data.inviteeEmail.trim();
  // An address is always read left to right, even inside a Hebrew sentence.
  const emailHtml = `<span dir="ltr"><strong>${escapeHtml(email)}</strong></span>`;
  const status = statusWords(t, data.status, locale);
  const action = data.recipientKind === 'admin' ? t.actionAdmin : t.actionChampion;
  const isHeld = data.status === 'not_subscribed_yet';
  // N-2 has its own subject, heading and lead; everything else is shared.
  const words = data.event === 'subscribed' ? t.subscribed : { subject: t.subject, heading: t.heading, lead: t.lead };

  const details = emailDetailsTable(
    [
      emailDetailRow(escapeHtml(t.invitedLabel), `<span dir="ltr">${escapeHtml(email)}</span>`, branding),
      emailDetailRow(escapeHtml(t.statusLabel), escapeHtml(status), branding),
    ],
    branding
  );

  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 24px; line-height: 1.3; font-weight: 700; color: ${palette.ink};">${escapeHtml(words.heading)}</h1>
      <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: ${palette.inkMuted};">${words.lead(emailHtml)}</p>
      ${details}
      ${isHeld ? `<p style="margin: 0 0 8px; font-size: 14px; line-height: 1.6; color: ${palette.inkMuted};">${escapeHtml(t.heldNote)}</p>` : ''}
      ${emailButton(escapeHtml(action), data.actionUrl, { branding })}
      <p style="margin: 20px 0 0; padding-top: 16px; border-top: 1px solid ${palette.line}; font-size: 13px; line-height: 1.6; color: ${palette.inkFaint};">${escapeHtml(t.footer)}</p>
    </div>
  `;

  const text = [
    words.heading,
    '',
    words.lead(email),
    '',
    `${t.invitedLabel}: ${email}`,
    `${t.statusLabel}: ${status}`,
    ...(isHeld ? ['', t.heldNote] : []),
    '',
    `${action}: ${data.actionUrl}`,
    '',
    t.footer,
  ].join('\n');

  return {
    subject: words.subject,
    html: wrapInBrandedTemplate(content, branding),
    text,
  };
}
