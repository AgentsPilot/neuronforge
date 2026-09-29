/**
 * What a client is told a cancellation was for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GUARANTEE THIS PROTECTS
 *
 * The owner picks from their own vocabulary — `client_not_paying`,
 * `client_no_show`, `client_unresponsive`. Those are accurate records and
 * accusations to receive. "You did not turn up" in an inbox reads as a charge to
 * answer, and an owner choosing a code for their own books did not choose to
 * send that sentence.
 *
 * So the rendered email must never contain a raw code, and must never contain
 * the owner's private note when they chose to keep it. Everything else here is
 * in service of those two.
 *
 * Tested against the RENDERED HTML rather than the inputs, because that is where
 * the guarantee either holds or does not. Asserting on what was passed to the
 * template would pass happily while the template printed the code anyway.
 */
import { clientFacingCancelReason } from '../templates/translations';
import { generateQuoteStoppedEmail } from '../templates/proposal';
import { OWNER_CANCEL_REASONS, STOP_REASONS } from '@/lib/business-os/cancellationReasons';
import { translations } from '@/lib/business-os/LanguageContext';

const branding = {
  businessName: 'Test Co',
  primaryColor: '#000000',
  logoUrl: null,
} as unknown as Parameters<typeof generateQuoteStoppedEmail>[0]['branding'];

const render = (over: Partial<Parameters<typeof generateQuoteStoppedEmail>[0]> = {}) =>
  generateQuoteStoppedEmail({
    title: 'Renovation',
    total: 2000,
    currency: 'ILS',
    paidAmount: 600,
    refundedAmount: 0,
    invoicesVoided: 1,
    stagesClosed: 2,
    branding,
    locale: 'en',
    ...over,
  });

describe('no raw reason code ever reaches a client', () => {
  /*
   * Only the snake_case codes, and that is not a loophole.
   *
   * `refunded` and `duplicate` are ordinary English words that appear in the
   * email's own copy — "has been refunded", "A duplicate booking" — so asserting
   * their absence would fail on correct output and teach the next person to
   * delete the test. An underscore is what makes a string unmistakably an
   * identifier rather than a word, and every accusing code has one:
   * `client_not_paying`, `client_no_show`, `client_unresponsive`.
   */
  const IDENTIFIER_SHAPED = [...OWNER_CANCEL_REASONS, ...STOP_REASONS].filter(c =>
    c.includes('_')
  );

  it.each(IDENTIFIER_SHAPED)('never prints %s verbatim', code => {
    const { html } = render({ reasonCode: code });
    expect(html).not.toContain(code);
  });

  it('covers the codes that would actually sting', () => {
    // A guard on the guard: if the filter above ever stopped matching these, the
    // suite would go quietly green while the worst codes went unchecked.
    expect(IDENTIFIER_SHAPED).toEqual(
      expect.arrayContaining(['client_not_paying', 'client_no_show', 'client_unresponsive'])
    );
  });

  it('prints a neutral sentence instead of the accusing one', () => {
    const { html } = render({ reasonCode: 'client_no_show' });
    // Not "the client did not turn up" — the owner's phrasing — but a statement
    // of fact with nobody blamed in it.
    expect(html).toContain('The appointment was missed');
  });

  it('says nothing at all for codes with no client-safe phrasing', () => {
    /*
     * `test_booking` would tell a real client their appointment was practice,
     * and `other` is a line that says nothing while looking like it should.
     * Silence is the honest result for both.
     */
    expect(clientFacingCancelReason('test_booking', 'en')).toBeUndefined();
    expect(clientFacingCancelReason('other', 'en')).toBeUndefined();

    const { html } = render({ reasonCode: 'other' });
    expect(html).not.toContain('Reason:');
  });

  it('says nothing when there is no code at all', () => {
    expect(clientFacingCancelReason(null, 'en')).toBeUndefined();
    expect(clientFacingCancelReason(undefined, 'en')).toBeUndefined();
  });
});

describe("the owner's private note", () => {
  it('appears when it was shared', () => {
    const { html } = render({ note: 'we could not source the materials' });
    expect(html).toContain('we could not source the materials');
  });

  it('is absent when the caller withheld it — and the reason still shows', () => {
    /*
     * Withholding happens at the caller, so the template simply receives null.
     * What matters here is that a withheld note leaves the client INFORMED rather
     * than silent: they still get the reason, in its safe phrasing.
     */
    const { html } = render({ note: null, reasonCode: 'client_not_paying' });

    expect(html).not.toContain('chased four times');
    expect(html).toContain('Payment was still outstanding');
  });
});

describe('every language is covered', () => {
  it.each(['en', 'es', 'he'] as const)('has a phrasing in %s for every listed code', locale => {
    /*
     * Not every code needs one — two deliberately have none — but a code that has
     * a phrasing in one language and not another would send an English sentence
     * to a Hebrew client, which is worse than sending none.
     */
    for (const code of OWNER_CANCEL_REASONS) {
      const en = clientFacingCancelReason(code, 'en');
      const here = clientFacingCancelReason(code, locale);
      expect(Boolean(here)).toBe(Boolean(en));
    }
  });
});

describe('the owner and the client read the same words, unless there is a reason not to', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUG THIS EXISTS FOR
   *
   * The owner's drawer said `כפל הזמנות` and the client's email said
   * `התנגשות ביומן אצלנו` — the same reason, two different sentences, for no
   * reason at all. Two texts that mean the same thing and are not the same text
   * are indistinguishable from a bug, and were reported as one.
   *
   * Six codes were like that. They are aligned now, and this is what stops them
   * drifting apart again: the two sets live in different modules — one is React,
   * the other runs on the server — so nothing but an assertion can pair them.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const SOFTENED = new Set([
    // Third person about the reader: "the client asked to cancel" is a strange
    // thing to read about yourself.
    'client_cancelled',
    'client_stopped',
    // The fact without the finger.
    'client_no_show',
    'client_unresponsive',
    'client_not_paying',
  ]);

  const LOCALES = ['en', 'es', 'he'] as const;

  it.each(LOCALES)('matches the owner label for every unsoftened code in %s', locale => {
    const owner = translations[locale] as Record<string, string>;

    for (const code of OWNER_CANCEL_REASONS) {
      if (SOFTENED.has(code)) continue;

      const forClient = clientFacingCancelReason(code, locale);
      // `test_booking` and `other` deliberately have no client phrasing.
      if (!forClient) continue;

      expect(forClient).toBe(owner[`cancel.reason.${code}`]);
    }
  });

  it('keeps the softened five genuinely different', () => {
    /*
     * The other half of the guard. Without it, "make them consistent" could be
     * satisfied by copying the accusing wording into the client's email, which
     * is the failure this whole set was built to prevent.
     */
    const owner = translations.he as Record<string, string>;

    for (const code of SOFTENED) {
      expect(clientFacingCancelReason(code, 'he')).not.toBe(owner[`cancel.reason.${code}`]);
    }
  });
});
