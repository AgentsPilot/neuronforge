/**
 * The plan-cancel emails to a Business OS owner (account deletion lifecycle
 * D4a and D4b / SX-3; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §3.2, §3.4, §4; SA S-7, S-8, DR-6, DR-7, DR-9, DR-10, DR-11; user U-2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR EMAILS, ONE TEMPLATE
 *
 *   cancelled   the owner cancelled in Settings → Plan; the plan runs to
 *               `date` (the period end), then does not renew
 *   ended_now   P-7a.4: a cancel during a failed payment ended the plan at
 *               once; `date` is when it ended. "ended on {date}", never
 *               "today", because the mail may be read later (DR-7)
 *   kept        the owner pressed Keep my plan; it renews on `date`
 *   reminder    D4b: the plan is still set to end on `date`, about three days
 *               ahead; sent once by the reminder cron. "ends on {date}", never
 *               "in 3 days", so it is true whichever run sends it. No "as you
 *               asked" and no "Changed your mind?": the cron also reminds a
 *               plan set to end from the Stripe dashboard (DR-9, C-9)
 *
 * EVERY CLAIM IS ONE THE CODE MAKES TRUE (C-9)
 *
 * The dates arrive already formatted on the account's clock by the composer
 * (`formatAccountDay`, the drawer's own function, through `safeTimezone`), so
 * the day in the email is the day in the drawer. The "after that" sentences
 * are the drawer's own `settings.plan_cancel.changes.*` wording in each
 * language, and the template test pins them to the dictionaries, so the email
 * and the drawer cannot drift (DR-11). A clause whose figure is unknown is
 * left out, never guessed. "Any unpaid invoice for it was cancelled, and you
 * will not be charged again" is written only when the engine reported none
 * left open (DR-7; SA code review F-1: with an invoice left open or not read,
 * a late payment can still go through, so the ended email promises nothing
 * about further charges then; it says instead that an invoice may still be
 * unpaid and could still be charged — user decision 2026-10-29). The kept email
 * says only that the plan renews and when (DR-9).
 *
 * THE SUBJECT CARRIES NO ADDRESS, NO NAME AND NO PLAN NAME
 *
 * The transport logs subjects. The reminder's subject carries the end date
 * and nothing else (DR-9: "Your plan ends on {date}").
 *
 * THE SUPPORT LINE IS THE PLATFORM SENDER
 *
 * `supportAddress` is `platformSenderAddress()` (`RESEND_FROM_EMAIL`), which
 * BQ-3 made both the sender and the support address (DR-10). No literal.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/templates/plan-cancel
 */

import { escapeHtml } from '@/lib/email/escapeHtml';
import { platformEmailBranding } from '@/lib/email/platformBranding';
import type { Locale } from '@/lib/i18n/config';
import { emailButton, emailPalette, wrapInBrandedTemplate } from './base-template';

export type PlanCancelEmailEvent = 'cancelled' | 'ended_now' | 'kept' | 'reminder';

/**
 * What happens once the plan has ended, already formatted for the reader.
 * `null` fields drop their clause (DR-11). Built by the composer from
 * `planEndingView`; the template never decides the rule.
 */
export type PlanCancelAfter =
  | {
      kind: 'free_plan';
      /** The day the plan ends (the view's `endsAt`). */
      date: string;
      plan: string;
      until: string;
      /** The free cohort's credit total in the reader's number format, or `null` (clause dropped). */
      credits: string | null;
      /** The read-only days after `until`, or `null` (sentence dropped). */
      readOnlyDays: string | null;
    }
  | {
      kind: 'back_to_plan';
      date: string;
      plan: string;
      /** `null` = open-ended free access. */
      until: string | null;
    };

export interface PlanCancelEmailData {
  event: PlanCancelEmailEvent;
  locale: Locale;
  /** The end (cancelled, reminder), the end that happened (ended_now) or the renewal (kept), formatted. */
  date: string;
  /** `null`: the "after that" paragraph is left out (unknown view, or kept). */
  after: PlanCancelAfter | null;
  /** ended_now only: true when the engine reported no open invoice left (DR-7). */
  unpaidInvoicesCancelled: boolean;
  /** Settings → Plan, absolute. */
  actionUrl: string;
  /** `platformSenderAddress()` (DR-10). */
  supportAddress: string;
}

interface Copy {
  cancelled: { subject: string; lead: string; noRefund: string; keepUntil: string; button: string };
  endedNow: { subject: string; lead: string; invoicesCancelled: string; invoiceMayBeOpen: string };
  kept: { subject: string; lead: string };
  /**
   * D4b. `keepBefore` names the button through `{button}`, so the sentence and the button cannot differ.
   * No `lead`: the heading is the subject, "ends on {date}", so a first line saying it again was dropped (user, G-5).
   */
  reminder: { subject: string; keepBefore: string };
  /** The drawer's `settings.plan_cancel.changes.*` strings, verbatim (DR-11; pinned by the test). */
  changes: {
    freePlan: string;
    freePlanNoCredits: string;
    freePlanThen: string;
    backToPlan: string;
    backToPlanOpen: string;
    dataKept: string;
  };
  settingsButton: string;
  support: string;
  footer: string;
}

/*
 * Hebrew follows the drawer's plural address ("אתם", "תחויבו"), as every
 * Settings → Plan string does. Spanish follows the drawer's "tú".
 */
export const PLAN_CANCEL_EMAIL_COPY: Readonly<Record<Locale, Copy>> = {
  en: {
    cancelled: {
      subject: 'Your plan is cancelled',
      lead: 'You cancelled your plan. It stays on until {date}, and you will not be charged again.',
      noRefund: 'No refund for the current month.',
      keepUntil: 'You can keep it any time before {date}.',
      button: 'Keep my plan',
    },
    endedNow: {
      subject: 'Your plan has ended',
      lead: 'Your plan ended on {date} at your request.',
      invoicesCancelled: 'Any unpaid invoice for it was cancelled, and you will not be charged again.',
      invoiceMayBeOpen: 'An invoice for this plan may still be unpaid, and it could still be charged.',
    },
    kept: {
      subject: 'Your plan continues',
      lead: 'Your plan continues and renews on {date}.',
    },
    reminder: {
      subject: 'Your plan ends on {date}',
      keepBefore: 'Want to keep it? Choose "{button}" before {date}.',
    },
    changes: {
      freePlan: 'On {date} your plan moves to the free plan, {plan}, with {credits} credits, until {until}.',
      freePlanNoCredits: 'On {date} your plan moves to the free plan, {plan}, until {until}.',
      freePlanThen: 'After {until}, your account is read-only for {days} days, then paused, unless you choose a plan.',
      backToPlan: 'On {date} you go back to {plan}, free, until {until}.',
      backToPlanOpen: 'On {date} you go back to {plan}, free.',
      dataKept: 'Your data is kept, and you can sign in and export it.',
    },
    settingsButton: 'Open plan settings',
    support: 'Questions? Write to us at {address}.',
    footer: "You're getting this because of a change to your plan.",
  },
  he: {
    cancelled: {
      subject: 'התוכנית שלכם בוטלה',
      lead: 'ביטלתם את התוכנית. היא נשארת פעילה עד {date}, ולא תחויבו שוב.',
      noRefund: 'אין החזר על החודש הנוכחי.',
      keepUntil: 'אפשר להשאיר אותה בכל רגע לפני {date}.',
      button: 'להשאיר את התוכנית',
    },
    endedNow: {
      subject: 'התוכנית שלכם הסתיימה',
      lead: 'התוכנית שלכם הסתיימה ב-{date} לבקשתכם.',
      invoicesCancelled: 'כל חשבונית שלא שולמה עבור התוכנית בוטלה, ולא תחויבו שוב.',
      invoiceMayBeOpen: 'ייתכן שחשבונית עבור התוכנית עדיין לא שולמה, ושהיא עוד תחויב.',
    },
    kept: {
      subject: 'התוכנית שלכם ממשיכה',
      lead: 'התוכנית שלכם ממשיכה ותתחדש ב-{date}.',
    },
    reminder: {
      subject: 'התוכנית שלכם מסתיימת ב-{date}',
      keepBefore: 'רוצים להשאיר אותה? בחרו "{button}" לפני {date}.',
    },
    changes: {
      freePlan: 'ב-{date} התוכנית שלכם עוברת לתוכנית החינמית, {plan}, עם {credits} קרדיטים, עד {until}.',
      freePlanNoCredits: 'ב-{date} התוכנית שלכם עוברת לתוכנית החינמית, {plan}, עד {until}.',
      freePlanThen: 'אחרי {until} החשבון יהיה לקריאה בלבד למשך {days} ימים, ואז יושהה, אלא אם תבחרו תוכנית.',
      backToPlan: 'ב-{date} אתם חוזרים ל-{plan}, בחינם, עד {until}.',
      backToPlanOpen: 'ב-{date} אתם חוזרים ל-{plan}, בחינם.',
      dataKept: 'הנתונים שלכם נשמרים, ואפשר להתחבר ולייצא אותם.',
    },
    settingsButton: 'להגדרות התוכנית',
    support: 'שאלות? כתבו לנו לכתובת {address}.',
    footer: 'קיבלתם את ההודעה הזו כי חל שינוי בתוכנית שלכם.',
  },
  es: {
    cancelled: {
      subject: 'Tu plan está cancelado',
      lead: 'Cancelaste tu plan. Sigue activo hasta el {date} y no se te volverá a cobrar.',
      noRefund: 'No hay reembolso del mes en curso.',
      keepUntil: 'Puedes mantenerlo en cualquier momento antes del {date}.',
      button: 'Mantener mi plan',
    },
    endedNow: {
      subject: 'Tu plan ha terminado',
      lead: 'Tu plan terminó el {date} a petición tuya.',
      invoicesCancelled: 'Se canceló cualquier factura pendiente de pago de este plan y no se te volverá a cobrar.',
      invoiceMayBeOpen: 'Es posible que una factura de este plan siga pendiente de pago y que todavía se cobre.',
    },
    kept: {
      subject: 'Tu plan continúa',
      lead: 'Tu plan continúa y se renueva el {date}.',
    },
    reminder: {
      subject: 'Tu plan termina el {date}',
      keepBefore: '¿Quieres mantenerlo? Elige «{button}» antes del {date}.',
    },
    changes: {
      freePlan: 'El {date} tu plan pasa al plan gratuito, {plan}, con {credits} créditos, hasta el {until}.',
      freePlanNoCredits: 'El {date} tu plan pasa al plan gratuito, {plan}, hasta el {until}.',
      freePlanThen: 'Después del {until}, tu cuenta queda en solo lectura durante {days} días y luego en pausa, salvo que elijas un plan.',
      backToPlan: 'El {date} vuelves a {plan}, gratis, hasta el {until}.',
      backToPlanOpen: 'El {date} vuelves a {plan}, gratis.',
      dataKept: 'Tus datos se conservan y puedes iniciar sesión y exportarlos.',
    },
    settingsButton: 'Ver la configuración del plan',
    support: '¿Preguntas? Escríbenos a {address}.',
    footer: 'Recibes este correo porque hubo un cambio en tu plan.',
  },
};

/** `{name}` → value. Values are plain text here; HTML escaping happens on the whole sentence. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole));
}

/** The "after that" sentences, in order. Empty when there is no view. */
function afterSentences(t: Copy, after: PlanCancelAfter | null): string[] {
  if (!after) return [];
  if (after.kind === 'free_plan') {
    const values = { date: after.date, plan: after.plan, until: after.until };
    const main =
      after.credits !== null
        ? fill(t.changes.freePlan, { ...values, credits: after.credits })
        : fill(t.changes.freePlanNoCredits, values);
    const then = after.readOnlyDays !== null ? fill(t.changes.freePlanThen, { until: after.until, days: after.readOnlyDays }) : null;
    return then ? [main, then] : [main];
  }
  return [
    after.until !== null
      ? fill(t.changes.backToPlan, { date: after.date, plan: after.plan, until: after.until })
      : fill(t.changes.backToPlanOpen, { date: after.date, plan: after.plan }),
  ];
}

export function generatePlanCancelEmail(data: PlanCancelEmailData): { subject: string; html: string; text: string } {
  const locale: Locale = PLAN_CANCEL_EMAIL_COPY[data.locale] ? data.locale : 'en';
  const t = PLAN_CANCEL_EMAIL_COPY[locale];
  const isRTL = locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  const branding = platformEmailBranding(locale);
  const palette = emailPalette(branding);
  const date = { date: data.date };

  let subject: string;
  let lead: string[];
  let after: string[] = [];
  let button: string;
  if (data.event === 'cancelled') {
    subject = t.cancelled.subject;
    lead = [fill(t.cancelled.lead, date), t.cancelled.noRefund];
    after = [...afterSentences(t, data.after), t.changes.dataKept, fill(t.cancelled.keepUntil, date)];
    button = t.cancelled.button;
  } else if (data.event === 'ended_now') {
    subject = t.endedNow.subject;
    lead = [fill(t.endedNow.lead, date), data.unpaidInvoicesCancelled ? t.endedNow.invoicesCancelled : t.endedNow.invoiceMayBeOpen];
    after = [...afterSentences(t, data.after), t.changes.dataKept];
    button = t.settingsButton;
  } else if (data.event === 'reminder') {
    // D4b (DR-9): the same "after that" paragraph as the cancelled email, from the view.
    subject = fill(t.reminder.subject, date);
    lead = [];
    after = [...afterSentences(t, data.after), t.changes.dataKept, fill(t.reminder.keepBefore, { ...date, button: t.cancelled.button })];
    button = t.cancelled.button;
  } else {
    subject = t.kept.subject;
    lead = [fill(t.kept.lead, date)];
    button = t.settingsButton;
  }
  const support = fill(t.support, { address: data.supportAddress });

  const paragraph = (text: string, size = 15) =>
    `<p style="margin: 0 0 10px; font-size: ${size}px; line-height: 1.6; color: ${palette.inkMuted};">${escapeHtml(text)}</p>`;
  // An address is always read left to right, even inside a Hebrew sentence.
  const supportHtml = escapeHtml(t.support).replace(
    '{address}',
    `<span dir="ltr">${escapeHtml(data.supportAddress)}</span>`
  );

  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 24px; line-height: 1.3; font-weight: 700; color: ${palette.ink};">${escapeHtml(subject)}</h1>
      ${lead.map((line) => paragraph(line)).join('\n      ')}
      ${after.map((line) => paragraph(line, 14)).join('\n      ')}
      ${emailButton(escapeHtml(button), data.actionUrl, { branding })}
      <p style="margin: 20px 0 0; padding-top: 16px; border-top: 1px solid ${palette.line}; font-size: 13px; line-height: 1.6; color: ${palette.inkFaint};">${supportHtml}<br />${escapeHtml(t.footer)}</p>
    </div>
  `;

  // A blank line between the lead and the "after that" paragraph, and none for a part that is empty (the reminder has no lead).
  const body = [lead, after].filter((part) => part.length > 0).flatMap((part, i) => (i > 0 ? ['', ...part] : part));
  const text = [subject, '', ...body, '', `${button}: ${data.actionUrl}`, '', support, t.footer].join('\n');

  return { subject, html: wrapInBrandedTemplate(content, branding), text };
}
