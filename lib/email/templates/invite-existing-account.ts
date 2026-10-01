/**
 * "You already have an AgentPilot account" — invite-only signup Slice 5b
 * (requirement F5b-3; workplan D-3; SA Q-3, R-5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SENT INSTEAD OF A SIGN-UP CODE
 *
 * When someone asks for a sign-up code on a champion's friend invite and the
 * invited address already has an account, the page still says "code sent"
 * (the champion holds the link and must not learn whether that address has an
 * account). The code is stored but never sent. This goes to the mailbox
 * instead, so only its owner learns it: sign in with the account you have.
 *
 * NOTHING FROM THE CHAMPION (SA R-5)
 *
 * Whoever holds the link can trigger it, so it is a platform security message
 * from the system sender: no inviter name, no Reply-To, no invite link, token
 * or code, no plan. The only link is to the normal sign-in page. It says to
 * ignore it if the reader did not ask.
 *
 * The subject names the purpose only (the transport logs subjects), and the
 * sender passes `redactRecipientInLogs: true`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/templates/invite-existing-account
 */

import type { Locale } from '@/lib/i18n/config';
import { platformEmailBranding } from '@/lib/email/platformBranding';
import { wrapInBrandedTemplate } from './base-template';

export interface InviteExistingAccountEmailData {
  /** The normal sign-in page (`marketingUrl('/login')`), built by the caller. */
  signInUrl: string;
  locale: Locale;
}

interface Copy {
  subject: string;
  heading: string;
  lead: string;
  action: string;
  ignore: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subject: 'You already have an AgentPilot account',
    heading: 'You already have an account',
    lead: 'Someone asked for a sign-up code for this address on an AgentPilot invitation. This address already has an AgentPilot account, so no new account was created and no code was sent. Sign in with the account you have.',
    action: 'Sign in',
    ignore: 'If you did not ask for this, you can ignore this email. Nothing has changed on your account.',
  },
  he: {
    subject: 'כבר יש לך חשבון ב־AgentPilot',
    heading: 'כבר יש לך חשבון',
    lead: 'מישהו ביקש קוד הרשמה לכתובת הזו בהזמנה ל־AgentPilot. לכתובת הזו כבר יש חשבון ב־AgentPilot, ולכן לא נוצר חשבון חדש ולא נשלח קוד. אפשר להתחבר עם החשבון הקיים.',
    action: 'התחברות',
    ignore: 'אם לא ביקשת זאת, אפשר להתעלם מההודעה. שום דבר לא השתנה בחשבון שלך.',
  },
  es: {
    subject: 'Ya tienes una cuenta de AgentPilot',
    heading: 'Ya tienes una cuenta',
    lead: 'Alguien pidió un código de registro para esta dirección en una invitación de AgentPilot. Esta dirección ya tiene una cuenta de AgentPilot, así que no se creó ninguna cuenta nueva ni se envió ningún código. Inicia sesión con la cuenta que ya tienes.',
    action: 'Iniciar sesión',
    ignore: 'Si no has pedido esto, puedes ignorar este correo. No ha cambiado nada en tu cuenta.',
  },
};

/**
 * Only an http(s) URL with no quote or angle bracket may become an href.
 * QA-1: validated once, and NEVER throws. Anything else is `null`, and the
 * email is rendered without a link ("sign in" as text), so a misconfigured
 * marketing URL can neither break the send nor inject markup.
 */
function safeHref(url: string): string | null {
  return /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

export function generateInviteExistingAccountEmail(data: InviteExistingAccountEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const href = safeHref(data.signInUrl);
  const t = COPY[data.locale] ?? COPY.en;
  const isRTL = data.locale === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';
  const align = isRTL ? 'right' : 'left';

  const content = `
    <div dir="${dir}" style="text-align: ${align};">
      <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">${t.heading}</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6;">${t.lead}</p>
      ${href ? `<p style="margin: 0 0 20px;"><a href="${href}" style="display: inline-block; padding: 10px 20px; border-radius: 6px; background: #111827; color: #ffffff; text-decoration: none; font-weight: 600;">${t.action}</a></p>` : ''}
      <p style="margin: 20px 0 0; font-size: 13px; opacity: 0.7; line-height: 1.6;">${t.ignore}</p>
    </div>
  `;

  const text = [t.heading, '', t.lead, '', ...(href ? [`${t.action}: ${href}`, ''] : []), t.ignore].join('\n');

  return {
    subject: t.subject,
    html: wrapInBrandedTemplate(content, platformEmailBranding(data.locale)),
    text,
  };
}
