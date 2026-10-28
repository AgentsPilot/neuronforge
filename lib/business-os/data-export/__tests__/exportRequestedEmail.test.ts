/**
 * The "Export requested" email (module export MX-1b, workplan §7, T-6).
 * Real Intl, so a format that throws or a zone that is ignored fails here.
 */

import { buildExportRequestedEmail, EXPORT_REQUESTED_EMAIL_COPY, formatRequestedAt } from '../exportRequestedEmail';
import { EXPORT_MODULES } from '../exportModules';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

const AT = new Date('2026-10-27T10:05:00.000Z');
const base = { modules: ['clients', 'quotes', 'website'] as const, requestedAt: AT, timezone: 'Asia/Jerusalem', isTimezoneSet: true };
const nameOf = (id: string, language: 'en' | 'he' | 'es') => EXPORT_MODULES.find((m) => m.id === id)!.name[language];

describe('buildExportRequestedEmail', () => {
  it.each(['en', 'he', 'es'] as const)('%s: subject, the module names in order, the files sentence, the support address', (language) => {
    const copy = EXPORT_REQUESTED_EMAIL_COPY[language];
    const email = buildExportRequestedEmail({ ...base, language });
    expect(email.subject).toBe(copy.subject);
    const names = base.modules.map((id) => nameOf(id, language));
    const positions = names.map((name) => email.text.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(email.text).toContain(copy.filesNotIncluded);
    expect(email.text).toContain(copy.arrives);
    expect(email.html).toContain(`mailto:${PLACEHOLDER_ERASURE_CONTACT}`);
    for (const name of names) expect(email.html).toContain(`<li>${name}</li>`);
  });

  it('the English files sentence is the requirement §3.2 sentence (BQ-35 answered: final)', () => {
    expect(EXPORT_REQUESTED_EMAIL_COPY.en.filesNotIncluded).toBe(
      "Files (client documents, website pictures) are not included. Download client documents from each client's record."
    );
  });

  it('Hebrew is dir="rtl" and lang="he"; English is ltr', () => {
    expect(buildExportRequestedEmail({ ...base, language: 'he' }).html).toMatch(/^<div dir="rtl" lang="he"/);
    expect(buildExportRequestedEmail({ ...base, language: 'en' }).html).toMatch(/^<div dir="ltr" lang="en"/);
  });

  it('the time is in the owner zone when set (Asia/Jerusalem: 12:05 on 27 Oct, after the DST change)', () => {
    expect(formatRequestedAt({ ...base, language: 'en' })).toEqual({ date: '27 October 2026', time: '12:05' });
    // Before the Israeli DST end (25 Oct 2026) the offset is +3.
    expect(formatRequestedAt({ ...base, language: 'en', requestedAt: new Date('2026-10-20T10:05:00.000Z') }).time).toBe('13:05');
  });

  it('with no zone set the time is UTC and labelled so', () => {
    expect(formatRequestedAt({ ...base, language: 'en', isTimezoneSet: false })).toEqual({ date: '27 October 2026', time: '10:05 (UTC)' });
    expect(buildExportRequestedEmail({ ...base, language: 'en', isTimezoneSet: false }).text).toContain('10:05 (UTC)');
  });

  it('Hebrew isolates the date and "time (UTC)": <bdi> in the HTML, FSI/PDI in the text (SA CR-4)', () => {
    const email = buildExportRequestedEmail({ ...base, language: 'he', isTimezoneSet: false });
    const { date, time } = formatRequestedAt({ ...base, language: 'he', isTimezoneSet: false });
    expect(time).toMatch(/\(UTC\)$/);
    expect(email.html).toContain(`<bdi>${date}</bdi>`);
    expect(email.html).toContain(`<bdi>${time}</bdi>`);
    expect(email.text).toContain(`⁨${date}⁩`);
    expect(email.text).toContain(`⁨${time}⁩`);
    // English needs neither and is unchanged.
    const english = buildExportRequestedEmail({ ...base, language: 'en' });
    expect(english.html).not.toContain('<bdi>');
    expect(english.text).not.toMatch(/[⁨⁩]/);
  });

  it('carries no address but the support contact, and escapes HTML', () => {
    const email = buildExportRequestedEmail({ ...base, language: 'en' });
    // A sentence-final full stop is not part of the address.
    const addresses = (`${email.html} ${email.text}`.match(/[\w.+-]+@[\w.-]+/g) ?? []).map((a) => a.replace(/\.$/, ''));
    expect(new Set(addresses)).toEqual(new Set([PLACEHOLDER_ERASURE_CONTACT]));
    expect(email.html).toContain('client&#39;s record');
    expect(email.html).not.toMatch(/<script/i);
  });

  it('every language holds the same placeholders in each sentence', () => {
    const keys = Object.keys(EXPORT_REQUESTED_EMAIL_COPY.en) as Array<keyof typeof EXPORT_REQUESTED_EMAIL_COPY.en>;
    const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const language of ['he', 'es'] as const) {
      expect(Object.keys(EXPORT_REQUESTED_EMAIL_COPY[language]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(EXPORT_REQUESTED_EMAIL_COPY[language][key].length).toBeGreaterThan(0);
        expect(holes(EXPORT_REQUESTED_EMAIL_COPY[language][key])).toEqual(holes(EXPORT_REQUESTED_EMAIL_COPY.en[key]));
      }
    }
  });

  it('never says "delivered" in any language (XC-9)', () => {
    expect(JSON.stringify(EXPORT_REQUESTED_EMAIL_COPY)).not.toMatch(/deliver|נמסר|entregad/i);
  });
});
