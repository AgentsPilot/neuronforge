/**
 * The module export emails (MX-3a, workplan §8, D-20, §13.2 T-M1…T-M8; SA
 * Q-1 "not available" copy variant). Real Intl, so a zone that is ignored
 * fails here.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildModuleNoticeEmail,
  buildModulePartEmail,
  businessDate,
  MODULE_EXPORT_EMAIL_COPY,
  moduleDisplayName,
  noticeKindFor,
  partFileName,
} from '../moduleExportEmails';
import { EXPORT_REQUESTED_EMAIL_COPY, formatRequestedAt } from '../exportRequestedEmail';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

const LANGUAGES = ['en', 'he', 'es'] as const;
const REQUESTED = new Date('2026-10-28T09:00:00.000Z');
const PRODUCED = new Date('2026-10-28T21:30:00.000Z'); // 23:30 in Jerusalem: still the 28th; see T-M4 for a day change
const clock = { timezone: 'Asia/Jerusalem', isTimezoneSet: true };
const part = (overrides: Partial<Parameters<typeof buildModulePartEmail>[0]> = {}) =>
  buildModulePartEmail({ language: 'en', moduleId: 'clients', n: 2, total: 3, requestedAt: REQUESTED, producedAt: PRODUCED, ...clock, ...overrides });
const notice = (failureCode: string, overrides: Partial<Parameters<typeof buildModuleNoticeEmail>[0]> = {}) =>
  buildModuleNoticeEmail({ language: 'en', moduleId: 'clients', failureCode, requestedAt: REQUESTED, ...clock, ...overrides });

describe('copy', () => {
  it('T-M1 en / he / es have the same keys and the same placeholders in each sentence; no string holds a backslash', () => {
    const keys = Object.keys(MODULE_EXPORT_EMAIL_COPY.en).sort();
    const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const language of LANGUAGES) {
      const copy = MODULE_EXPORT_EMAIL_COPY[language];
      expect(Object.keys(copy).sort()).toEqual(keys);
      for (const key of keys as Array<keyof typeof copy>) {
        expect(copy[key].length).toBeGreaterThan(0);
        expect(holes(copy[key])).toEqual(holes(MODULE_EXPORT_EMAIL_COPY.en[key]));
        expect(copy[key]).not.toContain(String.fromCharCode(92));
      }
    }
  });

  it('the source file holds no backslash followed by a hex digit (Tailwind scans lib/, PR #180)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'moduleExportEmails.ts'), 'utf8');
    expect(source).not.toMatch(new RegExp(String.fromCharCode(92, 92) + '[0-9a-fA-F]'));
  });

  it('the English sentences are the requirement §3 / §4.3 sentences', () => {
    const en = MODULE_EXPORT_EMAIL_COPY.en;
    expect(`${en.failed} ${en.tryAgain}`).toBe('This part of your export failed. Please try again.');
    expect(en.interrupted).toBe('This part was interrupted. Please export it again.');
    expect(en.notAvailable).toBe('This part is not available for export right now.');
    expect(en.tooLarge.startsWith('This part is too large to email. Please contact support')).toBe(true);
  });
});

describe('the part email', () => {
  it.each(LANGUAGES)('T-M2 %s: subject and body say "email n of X"; the split sentence only when X > 1', (language) => {
    const copy = MODULE_EXPORT_EMAIL_COPY[language];
    const name = moduleDisplayName('clients', language);
    const email = part({ language });
    expect(email.subject).toBe(copy.partSubject.replace('{module}', name).replace('{n}', '2').replace('{total}', '3'));
    expect(email.text).toContain(copy.partAttached.replace('{module}', name).replace('{n}', '2').replace('{total}', '3'));
    expect(email.text).toContain(copy.partSplit.replace('{total}', '3'));
    expect(email.text).toContain(copy.filesNotIncluded);
    const single = part({ language, n: 1, total: 1 });
    expect(single.text).not.toContain(copy.partSplit.replace('{total}', '1'));
    expect(single.html).not.toContain(copy.partSplit.split('{total}')[0].trim());
  });

  it('T-M3 requested-at and produced-at in the owner zone; "(UTC)" when none is set', () => {
    const email = part();
    expect(email.text).toContain('Requested on 28 October 2026 at 11:00. Produced on 28 October 2026 at 23:30.');
    const utc = part({ isTimezoneSet: false });
    expect(utc.text).toContain('Requested on 28 October 2026 at 09:00 (UTC). Produced on 28 October 2026 at 21:30 (UTC).');
  });

  it('T-M3 Hebrew is rtl and isolates each date and time: <bdi> in HTML, FSI / PDI in text', () => {
    const email = part({ language: 'he', isTimezoneSet: false });
    const requested = formatRequestedAt({ language: 'he', requestedAt: REQUESTED, timezone: 'UTC', isTimezoneSet: false });
    const FSI = String.fromCodePoint(0x2068);
    const PDI = String.fromCodePoint(0x2069);
    expect(email.html).toMatch(/^<div dir="rtl" lang="he"/);
    expect(email.html).toContain(`<bdi>${requested.time}</bdi>`);
    expect(email.text).toContain(`${FSI}${requested.date}${PDI}`);
    expect(email.text).toContain(`${FSI}${requested.time}${PDI}`);
    const english = part();
    expect(english.html).toMatch(/^<div dir="ltr" lang="en"/);
    expect(english.html).not.toContain('<bdi>');
    expect(english.text).not.toContain(FSI);
  });

  it('the not-you sentence is MX-1b\'s, with the support link', () => {
    const email = part({ language: 'es' });
    expect(email.text).toContain(EXPORT_REQUESTED_EMAIL_COPY.es.notYou.replace('{support}', PLACEHOLDER_ERASURE_CONTACT));
    expect(email.html).toContain(`mailto:${PLACEHOLDER_ERASURE_CONTACT}`);
  });
});

describe('the file name (D-20)', () => {
  it('T-M4 clients_YYYY-MM-DD_part-n-of-X.csv, with the owner business date (a UTC evening that is the next day in Jerusalem)', () => {
    const lateUtc = new Date('2026-10-28T22:30:00.000Z'); // 00:30 on the 29th in Asia/Jerusalem (UTC+2 after 25 Oct)
    expect(partFileName({ moduleId: 'clients', producedAt: lateUtc, n: 2, total: 3, ...clock })).toBe('clients_2026-10-29_part-2-of-3.csv');
    expect(partFileName({ moduleId: 'clients', producedAt: lateUtc, n: 2, total: 3, timezone: 'Asia/Jerusalem', isTimezoneSet: false })).toBe(
      'clients_2026-10-28_part-2-of-3.csv'
    );
    expect(businessDate(new Date('2026-01-05T12:00:00.000Z'), { timezone: 'UTC', isTimezoneSet: true })).toBe('2026-01-05');
  });
});

describe('the notices', () => {
  it('T-M5 the kind follows the code: interrupted; too_large and over_ceiling; switched off and unknown are "not available"; anything else failed', () => {
    expect(noticeKindFor('interrupted')).toBe('interrupted');
    expect(noticeKindFor('too_large')).toBe('too_large');
    expect(noticeKindFor('over_ceiling')).toBe('too_large');
    expect(noticeKindFor('module_switched_off')).toBe('not_available');
    expect(noticeKindFor('module_unknown')).toBe('not_available');
    for (const other of ['attempts_exhausted', 'recipient_unavailable', 'request_mismatch', 'anything_new']) expect(noticeKindFor(other)).toBe('failed');
  });

  it.each(LANGUAGES)('T-M5 %s: each notice carries its sentences and the requested-at line', (language) => {
    const copy = MODULE_EXPORT_EMAIL_COPY[language];
    const name = moduleDisplayName('clients', language);

    const failed = notice('attempts_exhausted', { language });
    expect(failed.kind).toBe('failed');
    expect(failed.subject).toBe(copy.failedSubject.replace('{module}', name));
    expect(failed.text).toContain(`${copy.failed} ${copy.tryAgain}`);
    expect(failed.text).not.toContain(copy.notAvailable);

    const off = notice('module_switched_off', { language });
    expect(off.kind).toBe('not_available');
    expect(off.subject).toBe(failed.subject); // a copy variant of the failed email, not a fourth kind
    expect(off.text).toContain(`${copy.failed} ${copy.notAvailable}`);
    expect(off.text).not.toContain(copy.tryAgain);

    const interrupted = notice('interrupted', { language });
    expect(interrupted.subject).toBe(copy.interruptedSubject.replace('{module}', name));
    expect(interrupted.text).toContain(copy.interrupted);
    expect(interrupted.text).toContain(copy.interruptedMayHaveArrived);

    const tooLarge = notice('over_ceiling', { language });
    expect(tooLarge.subject).toBe(copy.tooLargeSubject.replace('{module}', name));
    expect(tooLarge.text).toContain(copy.tooLarge.replace('{support}', PLACEHOLDER_ERASURE_CONTACT));
    expect(tooLarge.html).toContain(`mailto:${PLACEHOLDER_ERASURE_CONTACT}`);

    for (const email of [failed, off, interrupted, tooLarge]) {
      expect(email.text.endsWith('\n')).toBe(true);
      expect(email.text).toContain(copy.requestedOn.split('{')[0].trim());
    }
  });

  it('an unknown module id shows as itself (a renamed module still gets its notice)', () => {
    expect(notice('module_unknown', { moduleId: 'renamed_module' }).subject).toBe('Your data export: renamed_module failed');
  });
});

describe('safety', () => {
  it('T-M6 every interpolated value is HTML-escaped', () => {
    const email = notice('module_unknown', { moduleId: '<script>x' as string });
    expect(email.html).not.toContain('<script>');
    const html = buildModulePartEmail({ language: 'en', moduleId: 'a&b"<i>', n: 1, total: 2, requestedAt: REQUESTED, producedAt: PRODUCED, ...clock }).html;
    expect(html).toContain('a&amp;b&quot;&lt;i&gt;');
    expect(html).not.toContain('<i>');
  });

  it('T-M7 no address but the support contact, no row count, no file name in any template', () => {
    const all = [part(), part({ language: 'he' }), notice('too_large'), notice('interrupted'), notice('attempts_exhausted'), notice('module_switched_off')];
    for (const email of all) {
      const body = `${email.subject} ${email.html} ${email.text}`;
      const addresses = (body.match(/[\w.+-]+@[\w.-]+/g) ?? []).map((a) => a.replace(/\.$/, ''));
      for (const address of addresses) expect(address).toBe(PLACEHOLDER_ERASURE_CONTACT);
      expect(body).not.toMatch(/\.csv/);
      expect(body).not.toMatch(/ rows?[ .,]/i);
    }
  });

  it('T-M8 the same input gives the same bytes (a re-sent notice under one key is identical)', () => {
    for (const language of LANGUAGES) {
      expect(notice('interrupted', { language })).toEqual(notice('interrupted', { language }));
      expect(part({ language })).toEqual(part({ language }));
    }
  });
});
