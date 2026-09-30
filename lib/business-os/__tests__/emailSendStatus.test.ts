/**
 * The email status roster, and the two invariants that were already broken.
 *
 * 1. `complained` existed in the database and in no type or locale. The badge
 *    that renders it uses `t(key) || email.status`, which cannot fall back —
 *    `t` returns the KEY on a miss and a key is truthy — so the first spam
 *    complaint showed the user a raw translation key. The locale-parity test at
 *    the bottom is the guard that would have caught it.
 *
 * 2. "Emails sent" was counted as `status = 'sent'` exactly, so a bounce
 *    silently removed a row from a historical total days after the send.
 */

import {
  EMAIL_SEND_STATUSES,
  DISPATCHED_EMAIL_STATUSES,
  UNDELIVERABLE_EMAIL_STATUSES,
  isEmailSendStatus,
  wasDispatched,
  isUndeliverable,
} from '../emailSendStatus';
import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * Read from source rather than imported: `LanguageContext` is a `'use client'`
 * module holding a React context, and `translations` is not exported. Same
 * approach as `verdictChannelPrefix.test.ts`.
 */
const languageSource = readFileSync(join(__dirname, '..', 'LanguageContext.tsx'), 'utf8');

/** How many times a key is defined — one per locale block when complete. */
function localeCount(key: string): number {
  return languageSource.split(`'${key}':`).length - 1;
}

describe('the roster', () => {
  it('declares complained — the value the webhook writes', () => {
    expect(EMAIL_SEND_STATUSES).toContain('complained');
  });

  it('recognises a value off the wire, and rejects anything else', () => {
    expect(isEmailSendStatus('complained')).toBe(true);
    expect(isEmailSendStatus('opened')).toBe(true);
    expect(isEmailSendStatus('spam')).toBe(false);
    expect(isEmailSendStatus(undefined)).toBe(false);
  });
});

describe('what counts as dispatched', () => {
  /*
   * The assertion that pins the stats fix. A later tidy-up that "simplifies"
   * this back to ['sent'] reintroduces a dashboard number that shrinks.
   */
  it('counts bounced and complained mail as sent, because it was', () => {
    expect(wasDispatched('bounced')).toBe(true);
    expect(wasDispatched('complained')).toBe(true);
  });

  it('does not count mail that never left', () => {
    expect(wasDispatched('failed')).toBe(false);
    expect(wasDispatched('pending')).toBe(false);
  });

  it('is a subset of the roster', () => {
    for (const status of DISPATCHED_EMAIL_STATUSES) {
      expect(EMAIL_SEND_STATUSES).toContain(status);
    }
  });
});

describe('what counts as undeliverable', () => {
  it('covers the three terminal failures', () => {
    expect(isUndeliverable('bounced')).toBe(true);
    expect(isUndeliverable('complained')).toBe(true);
    expect(isUndeliverable('failed')).toBe(true);
  });

  it('does not include a successful send', () => {
    expect(isUndeliverable('sent')).toBe(false);
    expect(isUndeliverable('delivered')).toBe(false);
  });

  it('never claims a status is both dispatched-only and failed-only', () => {
    // `bounced`/`complained` are deliberately in BOTH: they left the platform
    // AND did not arrive. `failed` is only undeliverable. This pins that shape.
    expect(UNDELIVERABLE_EMAIL_STATUSES).toContain('failed');
    expect(DISPATCHED_EMAIL_STATUSES).not.toContain('failed');
  });
});

/**
 * A raw key reaching a user is the failure this guards.
 *
 * `t()` returns the key on a miss, so nothing throws and nothing logs — the
 * badge simply reads `crm.email.status.complained` in production.
 */
describe('every status is translated in every language', () => {
  /*
   * Three: en, es, he. Asserted against a key known to be complete, so this
   * test cannot pass by finding zero of everything.
   */
  it('finds three locale blocks, so the count below means something', () => {
    expect(localeCount('crm.email.status.bounced')).toBe(3);
  });

  it.each(EMAIL_SEND_STATUSES)('crm.email.status.%s is defined in all 3 locales', status => {
    expect(localeCount(`crm.email.status.${status}`)).toBe(3);
  });
});
