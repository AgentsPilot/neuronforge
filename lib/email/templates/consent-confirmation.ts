/**
 * "Did you sign up?" — the second half of a double opt-in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS EMAIL IS TRANSACTIONAL, AND THE DISTINCTION MATTERS
 *
 * It is sent because somebody typed this address into a form seconds earlier,
 * it contains no offer and no sales content, and its only purpose is to ask
 * whether that was really them. Sending it needs no prior consent — which is
 * what lets it work while marketing sending is switched off entirely.
 *
 * So it must not read like marketing. No hero, no styling flourish, no "we're
 * excited to have you". A person who did NOT sign up should be able to tell in
 * two seconds that this is a question, not a newsletter, and that ignoring it
 * ends the matter.
 *
 * DOING NOTHING IS THE SAFE DEFAULT, AND THE COPY SAYS SO
 *
 * The one line that has to be in here: if this wasn't you, ignore it and
 * nothing happens. Without it, somebody whose address was typed in by a
 * stranger is left wondering whether they have to act to get out of something.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/templates/consent-confirmation
 */

import type { Locale } from '@/lib/i18n/config';
import { wrapInBrandedTemplate, emailButton, type BrandingData } from './base-template';

export interface ConsentConfirmationEmailData {
  businessName: string;
  /** The exact sentence they were shown on the form. Restated, not summarised. */
  statementText: string;
  confirmUrl: string;
  branding: BrandingData;
  locale?: Locale;
}

interface Copy {
  subject: (business: string) => string;
  heading: string;
  lead: (business: string) => string;
  agreed: string;
  button: string;
  ignore: string;
  expiry: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subject: (b) => `Confirm your subscription to ${b}`,
    heading: 'One more step',
    lead: (b) => `This address was used to sign up for emails from ${b}. Please confirm it was you.`,
    agreed: 'What you were asked:',
    button: 'Yes, confirm subscription',
    ignore:
      'If this was not you, ignore this email. Nothing will be sent and no subscription is created.',
    expiry: 'This link works for 7 days.',
  },
  he: {
    subject: (b) => `אישור הרשמה לדיוור של ${b}`,
    heading: 'נשאר שלב אחד',
    lead: (b) => `הכתובת הזו שימשה להרשמה לדיוור מ${b}. נא לאשר שזה היה אתם.`,
    agreed: 'זה מה שהוצג בטופס:',
    button: 'כן, אני מאשר/ת את ההרשמה',
    ignore: 'אם זה לא הייתם, אפשר להתעלם מההודעה. לא יישלח דבר ולא תיווצר הרשמה.',
    expiry: 'הקישור תקף למשך 7 ימים.',
  },
  es: {
    subject: (b) => `Confirma tu suscripción a ${b}`,
    heading: 'Un paso más',
    lead: (b) =>
      `Esta dirección se usó para suscribirse a los correos de ${b}. Confirma que fuiste tú.`,
    agreed: 'Lo que se te pidió aceptar:',
    button: 'Sí, confirmar suscripción',
    ignore:
      'Si no fuiste tú, ignora este correo. No se enviará nada y no se creará ninguna suscripción.',
    expiry: 'Este enlace es válido durante 7 días.',
  },
};

export function generateConsentConfirmationEmail(data: ConsentConfirmationEmailData): {
  subject: string;
  html: string;
} {
  const locale = (data.locale ?? data.branding.locale ?? 'en') as Locale;
  const t = COPY[locale] ?? COPY.en;
  const isRTL = locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">${t.heading}</h1>

      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">
        ${t.lead(data.businessName)}
      </p>

      <!--
        The wording restated verbatim. They are confirming something specific,
        and a confirmation page that says only "click to confirm" gives them
        nothing to confirm.
      -->
      <p style="margin: 0 0 6px; font-size: 13px; opacity: 0.7;">${t.agreed}</p>
      <blockquote style="margin: 0 0 20px; padding: 12px 16px; border-${align === 'right' ? 'right' : 'left'}: 3px solid rgba(127,127,127,0.3); font-size: 14px; line-height: 1.6;">
        ${escapeHtml(data.statementText)}
      </blockquote>

      ${emailButton(t.button, data.confirmUrl, { branding: data.branding })}

      <p style="margin: 20px 0 0; font-size: 13px; opacity: 0.7; line-height: 1.6;">
        ${t.ignore}
      </p>
      <p style="margin: 8px 0 0; font-size: 12px; opacity: 0.55;">
        ${t.expiry}
      </p>
    </div>
  `;

  return {
    subject: t.subject(data.businessName),
    html: wrapInBrandedTemplate(content, data.branding),
  };
}

/** The statement is tenant-authored text going into markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
