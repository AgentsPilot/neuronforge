/**
 * "Your AgentPilot sign-up code" — the one email of invite-only signup
 * Slice 1b (requirement T-5, L-2; workplan D-7; SA F-10, R-9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PLATFORM SECURITY MESSAGE, NOT AN INVITATION
 *
 * It proves the person signing up controls the invited mailbox. So it comes
 * from the platform's system sender, not "<inviter> via AgentPilot": a code
 * from a person's name is a phishing pattern, and a Reply-To to that person
 * would invite "here is my code" replies. The personal invitation email is
 * Slice 2's.
 *
 * THE CODE IS IN THE BODY ONLY
 *
 * `sendEmail` logs the subject (50 characters on the attempt line, all of it
 * on the final "no transport delivered" warning), so the subject names the
 * purpose and never the code. The recipient is logged MASKED for
 * this email: the sender passes `redactRecipientInLogs: true` (SA MF-1), which
 * also strips any address a provider's error message echoes.
 *
 * DOING NOTHING IS THE SAFE DEFAULT
 *
 * Someone whose address was typed in by a stranger must be able to tell in two
 * seconds that ignoring this ends the matter.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/templates/invite-signup-code
 */

import type { Locale } from '@/lib/i18n/config';
import { platformEmailBranding } from '@/lib/email/platformBranding';
import { wrapInBrandedTemplate } from './base-template';

export interface InviteSignupCodeEmailData {
  /** Exactly the digits; validated by the caller. */
  code: string;
  /** Minutes the code stays valid. */
  validMinutes: number;
  locale: Locale;
}

interface Copy {
  subject: string;
  heading: string;
  lead: string;
  validFor: (minutes: number) => string;
  ignore: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subject: 'Your AgentPilot sign-up code',
    heading: 'Your sign-up code',
    lead: 'Enter this code on the AgentPilot invitation page to create your account:',
    validFor: (minutes) => `The code is valid for ${minutes} minutes and can be used once.`,
    ignore: 'If you did not ask for this code, ignore this email. Nothing happens and no account is created.',
  },
  he: {
    subject: 'קוד ההרשמה שלך ל־AgentPilot',
    heading: 'קוד ההרשמה',
    lead: 'יש להזין את הקוד הזה בעמוד ההזמנה של AgentPilot כדי ליצור את החשבון:',
    validFor: (minutes) => `הקוד תקף למשך ${minutes} דקות ולשימוש אחד בלבד.`,
    ignore: 'אם לא ביקשת את הקוד הזה, אפשר להתעלם מההודעה. שום דבר לא יקרה ולא ייווצר חשבון.',
  },
  es: {
    subject: 'Tu código de registro de AgentPilot',
    heading: 'Tu código de registro',
    lead: 'Introduce este código en la página de invitación de AgentPilot para crear tu cuenta:',
    validFor: (minutes) => `El código es válido durante ${minutes} minutos y solo se puede usar una vez.`,
    ignore: 'Si no has pedido este código, ignora este correo. No pasará nada y no se creará ninguna cuenta.',
  },
};

export function generateInviteSignupCodeEmail(data: InviteSignupCodeEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  if (!/^[0-9]{6}$/.test(data.code)) throw new Error('A sign-up code must be exactly six digits');

  const t = COPY[data.locale] ?? COPY.en;
  const isRTL = data.locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  // The code is always read left to right, and spaced for reading aloud.
  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">${t.heading}</h1>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">${t.lead}</p>
      <p dir="ltr" style="margin: 0 0 16px; font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; font-family: monospace;">${data.code}</p>
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">${t.validFor(data.validMinutes)}</p>
      <p style="margin: 20px 0 0; font-size: 13px; opacity: 0.7; line-height: 1.6;">${t.ignore}</p>
    </div>
  `;

  const text = [t.heading, '', t.lead, '', data.code, '', t.validFor(data.validMinutes), '', t.ignore].join('\n');

  return {
    subject: t.subject,
    // The platform's own look, with the AgentPilot wordmark: this is not a
    // business-to-client email (Slice 3a, E-2).
    html: wrapInBrandedTemplate(content, platformEmailBranding(data.locale)),
    text,
  };
}
