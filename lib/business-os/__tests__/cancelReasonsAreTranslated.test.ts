/**
 * Every cancellation reason a human can pick has words in every language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `cancelReasonKey` builds `cancel.reason.<code>` and `t()` returns the key it
 * was handed when it finds nothing. So a code with no entry does not fall back
 * to anything readable -- it prints its own key. An owner opening a cancelled
 * booking read "cancel.reason.client_unavailable" where the reason belonged.
 *
 * Four of the six `CLIENT_CANCEL_REASONS` were in that state. Only
 * `client_cost` and `other` had keys, and only because they also appear on the
 * owner's list. The client-only four were offered to clients, chosen by them,
 * and stored on real bookings -- three of them on this account alone -- with
 * nothing to display.
 *
 * The miss is invisible to TypeScript: the codes are a `const` array and the
 * translations are a wide object literal, and nothing relates the two. This
 * test is that relation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { CLIENT_CANCEL_REASONS, OWNER_CANCEL_REASONS, cancelReasonKey } from '../cancellationReasons';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const source = dictionarySource();

/** Every `cancel.reason.*` key, and how many languages define it. */
const definitions = new Map<string, number>();
for (const match of source.matchAll(/'(cancel\.reason\.[a-z_]+)'\s*:/g)) {
  definitions.set(match[1], (definitions.get(match[1]) ?? 0) + 1);
}

const ALL_CODES = [...new Set([...CLIENT_CANCEL_REASONS, ...OWNER_CANCEL_REASONS])];

describe('a reason a human can pick has words', () => {
  it('the lists are not empty, or this test proves nothing', () => {
    expect(CLIENT_CANCEL_REASONS.length).toBeGreaterThan(0);
    expect(OWNER_CANCEL_REASONS.length).toBeGreaterThan(0);
  });

  it.each(ALL_CODES)('%s is translated', (code) => {
    expect(definitions.has(cancelReasonKey(code))).toBe(true);
  });

  it.each(ALL_CODES)('%s is translated in all three languages', (code) => {
    // en, es, he. A code defined once renders as its own key for the other two.
    expect(definitions.get(cancelReasonKey(code))).toBe(3);
  });

  it('names every missing one at once, rather than one per run', () => {
    const missing = ALL_CODES.filter((code) => !definitions.has(cancelReasonKey(code)));
    expect(missing).toEqual([]);
  });
});

describe('the four that were missing', () => {
  /*
   * Named explicitly. The `it.each` above would pass again if somebody removed
   * these from the code list instead of translating them, which would take the
   * reasons away from clients rather than fix anything.
   */
  const CLIENT_ONLY = [
    'client_unavailable',
    'client_unwell',
    'client_rescheduling',
    'client_no_longer_needed',
  ] as const;

  it.each(CLIENT_ONLY)('%s is still offered to clients', (code) => {
    expect(CLIENT_CANCEL_REASONS).toContain(code);
  });

  it.each(CLIENT_ONLY)('%s has words in all three languages', (code) => {
    expect(definitions.get(cancelReasonKey(code))).toBe(3);
  });

  it('they read as the owner describing the client, not as the client', () => {
    // The client's own first-person wording lives in `lib/i18n/public-pages.ts`
    // and belongs to the page where they chose it. This drawer is the owner's.
    const english = source.slice(source.indexOf("'cancel.reason.client_unavailable'"), source.indexOf("'cancel.reason.client_cost'"));
    expect(english).toContain('the client');
    expect(english).not.toMatch(/'I[' ]/);
  });
});

describe('the public page keeps its own first-person wording', () => {
  it('has all four, for the client who is choosing', () => {
    const publicPages = fs.readFileSync(path.join(process.cwd(), 'lib/i18n/public-pages.ts'), 'utf8');
    for (const code of ['client_unavailable', 'client_unwell', 'client_rescheduling', 'client_no_longer_needed']) {
      // Three languages there too.
      expect((publicPages.match(new RegExp(`cancelReason_${code}:`, 'g')) ?? []).length).toBe(3);
    }
  });
});
