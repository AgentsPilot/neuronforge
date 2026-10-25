/**
 * The one confirmation email after a self-delete (data export DE-10b.2,
 * workplan §2.8; SA V-7).
 *
 * In the statement language. It names the date and the support address and
 * nothing else: no name, no business name, no email address in the body. It is
 * sent to the address the account had, which the route holds in memory only.
 * Transactional: no unsubscribe header, no `ownerUserId` (the profile is gone).
 *
 * @module lib/business-os/account-deletion/deletionEmail
 */

// TEMP-ERASURE-CONTACT: the one definition is in lib/business-os/supportContact.ts.
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import type { StatementLanguage } from './acknowledgement';

export interface DeletionEmail {
  subject: string;
  html: string;
  text: string;
}

const COPY: Readonly<Record<StatementLanguage, { subject: string; body: string; notYou: string; locale: string }>> = {
  en: {
    subject: 'Your AgentPilot account was deleted',
    body: 'Your AgentPilot account was deleted on {date}.',
    notYou: 'If this was not you, contact us at {support}.',
    locale: 'en-GB',
  },
  he: {
    subject: 'חשבון ה-AgentPilot שלך נמחק',
    body: 'חשבון ה-AgentPilot שלך נמחק בתאריך {date}.',
    notYou: 'אם לא את או אתה ביקשתם זאת, כתבו לנו לכתובת {support}.',
    locale: 'he-IL',
  },
  // Draft: needs a native check.
  es: {
    subject: 'Tu cuenta de AgentPilot fue eliminada',
    body: 'Tu cuenta de AgentPilot fue eliminada el {date}.',
    notYou: 'Si no fuiste tú, escríbenos a {support}.',
    locale: 'es-ES',
  },
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function formatDeletionDate(language: StatementLanguage, deletedAt: Date): string {
  return new Intl.DateTimeFormat(COPY[language].locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(deletedAt);
}

export function buildDeletionEmail(language: StatementLanguage, deletedAt: Date, support: string = PLACEHOLDER_ERASURE_CONTACT): DeletionEmail {
  const copy = COPY[language];
  const date = formatDeletionDate(language, deletedAt);
  const body = copy.body.replace('{date}', date);
  const notYou = copy.notYou.replace('{support}', support);
  const dir = language === 'he' ? 'rtl' : 'ltr';
  const supportLink = `<a href="mailto:${escapeHtml(support)}">${escapeHtml(support)}</a>`;
  const html =
    `<div dir="${dir}" lang="${language}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;text-align:${dir === 'rtl' ? 'right' : 'left'}">` +
    `<p>${escapeHtml(body)}</p>` +
    `<p>${escapeHtml(copy.notYou).replace('{support}', supportLink)}</p>` +
    `</div>`;
  return { subject: copy.subject, html, text: `${body}\n\n${notYou}\n` };
}
