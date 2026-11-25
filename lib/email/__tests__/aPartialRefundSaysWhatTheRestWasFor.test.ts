/**
 * A partial refund accounts for the money that did not come back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CLIENT USED TO READ
 *
 * Asked for $40, received $20, and the email said:
 *
 *     Amount Refunded   $20.00
 *     Original Payment  $40.00
 *     Refund Type       Partial Refund
 *     Reason            The service was not provided
 *
 * Both figures, no account of the difference, and a "Reason" line that is
 * THEIR stated reason for asking — written for a full refund and contradictory
 * on a partial: if the service was not provided, why is half of it kept? The
 * worst of the five is `duplicate_payment`, "You were charged twice", which
 * cannot describe a partial refund at all.
 *
 * The owner's sentence existed the whole time. The dialog has always required
 * it (`reason_note`, min 1 char) and every surface kept it internal — right
 * for a full refund, where there is no difference to explain, and wrong for
 * the one case that leaves one.
 *
 * So on a partial the owner's sentence replaces that line. Pinned here because
 * every part of it is a quiet failure: the explanation silently absent, or the
 * misleading reason silently back beside it, and in both cases the email still
 * sends and still looks finished.
 */

import { generateRefundConfirmationEmail } from '../templates/refund-confirmation';

const branding = {
  businessName: 'Studio Nine',
  primaryColor: '#f97316',
  secondaryColor: '#6b7280',
} as never;

const EXPLANATION = 'Of the two sessions booked, one was held — the other is refunded.';

const email = (overrides: Record<string, unknown> = {}) =>
  generateRefundConfirmationEmail({
    clientName: 'Tal Omer',
    refundAmount: 20,
    originalAmount: 40,
    currency: 'USD',
    refundType: 'partial',
    refundDate: new Date('2026-11-23T19:30:00Z'),
    serviceName: 'CleanOffice',
    reason: 'service_not_delivered',
    partialExplanation: EXPLANATION,
    branding,
    locale: 'en',
    ...overrides,
  } as never);

describe('a partial refund', () => {
  it("carries the owner's account of the part that was kept", () => {
    const { html } = email();

    expect(html).toContain('Of the two sessions booked');
    /* Under its own question. "Reason" asks why money came back, which the
       client can already see; this asks what happened to the rest. */
    expect(html).toContain('Why part of it');
  });

  it('drops the full-refund reason line that contradicts it', () => {
    const { html } = email();

    /* The client's own stated reason, rendered for a FULL refund. Beside an
       explanation of why only part came back it is a second, contradictory
       answer to the same question. */
    expect(html).not.toContain('The service was not provided');
  });

  it('keeps both figures, so the difference is visible, not implied', () => {
    const { html } = email();

    expect(html).toContain('$20.00');
    expect(html).toContain('$40.00');
    expect(html).toContain('Partial Refund');
  });

  it('falls back to the stored reason when nothing explains the part', () => {
    /*
     * Not every caller has a sentence — a refund recorded by an older client,
     * or a path that never collected one. Those keep exactly what they showed
     * before rather than losing a line: worse than the explanation, better
     * than nothing, and never a blank where a reason used to be.
     */
    const { html } = email({ partialExplanation: undefined });

    expect(html).toContain('The service was not provided');
    expect(html).not.toContain('Why part of it');
  });

  it('ignores an explanation that is only whitespace', () => {
    const { html } = email({ partialExplanation: '   \n  ' });

    expect(html).toContain('The service was not provided');
    expect(html).not.toContain('Why part of it');
  });
});

describe('a full refund', () => {
  /*
   * Untouched, deliberately. There is no difference to account for, and the
   * note the owner typed is their own justification — internal everywhere
   * else in the platform and not forwarded to the person it is about.
   */
  it('never shows the explanation, even when one is passed', () => {
    const { html } = email({
      refundType: 'full',
      refundAmount: 40,
      partialExplanation: 'kept half back, client has complained before',
    });

    expect(html).not.toContain('client has complained before');
    expect(html).not.toContain('Why part of it');
    /* And it still says why the money came back, as it always did. */
    expect(html).toContain('The service was not provided');
  });
});

describe('the label travels', () => {
  it.each([
    ['es', 'Por qué solo una parte'],
    ['he', 'למה רק חלק'],
  ])('reads in %s', (locale, expected) => {
    const { html } = email({ locale });
    expect(html).toContain(expected);
    expect(html).toContain('Of the two sessions booked');
  });
});
