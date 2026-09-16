/**
 * What the footer says about a business, taken from the business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS RESOLVED AT READ TIME, NOT WRITTEN AT GENERATION
 *
 * Opening hours are a CLAIM. Bake them into block content when a page is
 * generated and the page keeps making that claim after the owner changes their
 * availability — quietly, on a page nobody thinks to revisit, telling clients to
 * turn up on a day the business is now closed. A wrong answer about opening
 * hours is worse than no answer, so these are read on every render from the one
 * row that also drives the booking calendar. Change availability once, and the
 * footer, the booking page and the reminders all move together.
 *
 * The same argument applies to a registered number and a phone number, which is
 * why the contact form works this way too (`contactBlockContent.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PROFILE WINS RATHER THAN THE BLOCK
 *
 * Contact details have exactly one true value per business, and a page can show
 * them twice — the contact form and the footer now sit on the same page. If a
 * block could override, those two could disagree, and a visitor has no way to
 * tell which number to ring. Worse, the owner changing their number in Settings
 * would watch the footer update and never learn that a block further up was
 * still handing out the old one.
 *
 * So a typed value is a fallback for a business that has not filled the profile
 * in yet, not an override. Headings and copy are still the block's own — those
 * are page-level decisions with no single correct answer.
 *
 * @module lib/branding/footerBlockContent
 */

import { cleanPublicContact } from '@/lib/branding/placeholderContact';
import { openingHoursRows } from '@/lib/branding/openingHours';

/** Headings, in the three languages the public pages speak. */
const COPY: Record<
  string,
  { hours: string; contact: string; rights: string; poweredBy: string }
> = {
  en: { hours: 'Opening hours', contact: 'Contact', rights: 'All rights reserved.', poweredBy: 'Powered by' },
  es: { hours: 'Horario', contact: 'Contacto', rights: 'Todos los derechos reservados.', poweredBy: 'Desarrollado por' },
  he: { hours: 'שעות פעילות', contact: 'יצירת קשר', rights: 'כל הזכויות שמורות.', poweredBy: 'מופעל על ידי' },
};

export function withProfileFooter(
  content: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined,
  locale: string = 'en'
): Record<string, unknown> {
  const copy = COPY[locale] ?? COPY.en;

  const own = (key: string) => {
    const value = content?.[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };

  const fromProfile = (key: string, kind: 'email' | 'phone' | 'address') => {
    const value = profile?.[key];
    return typeof value === 'string' ? cleanPublicContact(value, kind) ?? undefined : undefined;
  };

  const text = (key: string) => {
    const value = profile?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };

  /*
   * OPENING HOURS COME FROM AVAILABILITY. NOWHERE ELSE.
   *
   * Not from the block, not from a typed fallback, not from a plausible default
   * for the trade. There is exactly one place this business says when it works
   * — the availability the booking calendar runs on — and if that is empty the
   * honest answer is to say nothing at all.
   *
   * The alternative is a page that tells a client to come on a Tuesday because
   * a string typed months ago said so, while the calendar has refused Tuesdays
   * ever since. Hours are the one claim on a small business's site that a
   * visitor acts on physically, by turning up.
   */
  const hours = openingHoursRows(profile?.scheduling_availability, locale);

  return {
    ...(content ?? {}),

    /*
     * ONE SOURCE OF TRUTH FOR HOW TO REACH THIS BUSINESS.
     *
     * The profile wins outright; a value typed onto the block is a last resort
     * for a business that has not filled the profile in yet, never an override.
     *
     * The other way round — block first — is how two contact details end up on
     * one page: a phone number typed into the contact form months ago and the
     * current one in the footer beneath it, with nothing to tell a visitor
     * which is real. The same trap catches the owner, who changes their number
     * in Settings, sees the footer update, and never learns that a block three
     * sections up is still handing out the old one.
     */
    /*
     * The business's name, from the business.
     *
     * Stored on the block, it was a copy taken at generation: renaming the
     * business in Settings left every footer still signing the old name, and
     * two pages generated months apart could sign different ones. There is one
     * name, it lives on the profile, and the copyright line is the most visible
     * place it appears.
     */
    company_name: text('company_name') ?? own('company_name'),

    email: fromProfile('email', 'email') ?? own('email'),
    phone: fromProfile('phone', 'phone') ?? own('phone'),
    address: fromProfile('address', 'address') ?? own('address'),
    contact_title: own('contact_title') ?? copy.contact,

    hours,
    hours_title: own('hours_title') ?? copy.hours,

    /*
     * The registered name, which is not always the trading name.
     *
     * Rendered only when the two DIFFER, so a sole trader whose business is
     * their own name does not see it printed twice.
     *
     * The registered number that used to sit beside it has been removed at the
     * owner's request. It is still collected for invoicing, where it belongs —
     * an invoice is a document naming one client, and a website is a shop
     * window.
     */
    legal_name: own('legal_name') ?? text('invoice_company_name'),

    /*
     * The line every business site ends with, in the page's own language.
     *
     * It read "© 2026" and stopped — a year on its own, which is not a
     * copyright notice and does not look like one. What a reader expects is
     * "© 2026 David KPMG. All rights reserved.", and a Hebrew site expects it
     * in Hebrew. Written here because this is where the page's language is
     * known; the shape only places it.
     */
    rights_text: own('rights_text') ?? copy.rights,

    // Only the wording. Whether it appears at all stays the block's own switch.
    powered_by_text: own('powered_by_text') ?? copy.poweredBy,
  };
}
