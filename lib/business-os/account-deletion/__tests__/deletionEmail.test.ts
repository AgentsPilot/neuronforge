/**
 * The confirmation email after a self-delete (data export DE-10b.2, workplan
 * §2.8, §4.1).
 */

import { STATEMENT_LANGUAGES } from '../acknowledgement';
import { buildDeletionEmail } from '../deletionEmail';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

const AT = new Date('2026-10-21T09:30:00Z');

describe('buildDeletionEmail', () => {
  it.each(STATEMENT_LANGUAGES)('%s: no placeholder is left, and the support address is named', (language) => {
    const email = buildDeletionEmail(language, AT);
    for (const part of [email.subject, email.html, email.text]) expect(part).not.toMatch(/\{[a-z]+\}/);
    expect(email.text).toContain(PLACEHOLDER_ERASURE_CONTACT);
    expect(email.html).toContain(`mailto:${PLACEHOLDER_ERASURE_CONTACT}`);
    expect(email.text).toMatch(/2026/);
  });

  it('the Hebrew body is right-to-left, the others left-to-right', () => {
    expect(buildDeletionEmail('he', AT).html).toContain('dir="rtl"');
    expect(buildDeletionEmail('en', AT).html).toContain('dir="ltr"');
    expect(buildDeletionEmail('es', AT).html).toContain('dir="ltr"');
  });

  it('interpolates nothing personal: only the date and the support address change the text', () => {
    const a = buildDeletionEmail('en', AT, 'help@example.org');
    const b = buildDeletionEmail('en', new Date('2027-01-02T00:00:00Z'), 'help@example.org');
    expect(a.subject).toBe(b.subject);
    expect(a.text.replace(/on .*?\./, '')).toBe(b.text.replace(/on .*?\./, ''));
    expect(buildDeletionEmail.length).toBeLessThanOrEqual(3);
  });

  it('escapes the support address in HTML', () => {
    expect(buildDeletionEmail('en', AT, 'a"<b>@x.io').html).not.toContain('<b>');
  });
});
