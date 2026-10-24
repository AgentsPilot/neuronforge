/**
 * The copy and language rule of the public "account deleted" page (data
 * export DE-10b.2, SA O2-6). Kept out of `page.tsx`, which may export only the
 * page and Next's own fields.
 *
 * @module app/account-deleted/accountDeletedCopy
 */

import { isStatementLanguage, type StatementLanguage } from '@/lib/business-os/account-deletion/acknowledgement';

export const ACCOUNT_DELETED_COPY: Readonly<Record<StatementLanguage, { title: string; body: string; home: string }>> = {
  en: {
    title: 'Your account has been deleted',
    body: 'Your account and your business data have been deleted, and you are signed out. A confirmation is on its way to the email address the account had.',
    home: 'Go to the AgentPilot home page',
  },
  he: {
    title: 'החשבון שלכם נמחק',
    body: 'החשבון ונתוני העסק שלכם נמחקו, ויצאתם מהמערכת. אישור נשלח לכתובת האימייל שהייתה בחשבון.',
    home: 'לדף הבית של AgentPilot',
  },
  // Draft: needs a native check.
  es: {
    title: 'Tu cuenta ha sido eliminada',
    body: 'Tu cuenta y los datos de tu negocio han sido eliminados y has cerrado sesión. Enviamos una confirmación a la dirección de correo que tenía la cuenta.',
    home: 'Ir a la página de inicio de AgentPilot',
  },
};

/** `?lang=` validated against en / he / es; anything else is English. Never echoed raw. */
export function accountDeletedLanguage(raw: string | string[] | undefined): StatementLanguage {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isStatementLanguage(value) ? value : 'en';
}
