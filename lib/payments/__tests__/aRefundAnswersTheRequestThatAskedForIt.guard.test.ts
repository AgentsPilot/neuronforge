/**
 * A refund settles the client's request, from wherever it was issued.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS REALLY GUARDING.
 *
 * The settle runs inside `refund()`, beside the CRM activity, and it must stay
 * incapable of affecting the refund. Three of its four safety properties are
 * structural rather than behavioural — they are facts about the source, and a
 * behavioural test cannot see them — so they are asserted on the source here.
 *
 * The fourth, "a failure leaves the refund standing", is the one a behavioural
 * test could reach, and it needs a live Stripe refund to get there. That is
 * integration work; what makes it safe is the shape, and the shape is checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVICE = fs.readFileSync(
  path.join(__dirname, '..', 'RefundService.ts'),
  'utf-8'
);

describe('a refund answers the request that asked for it', () => {
  it('settles at both of the points a refund is complete, and nowhere else', () => {
    /* `recordRefundActivity()` marks "a refund really happened" twice in this
       file — the settled-by-hand path and the Stripe path. The settle rides
       beside it rather than picking its own moments. */
    const activity = SERVICE.match(/^\s*recordRefundActivity\(\);$/gm) ?? [];
    const settle = SERVICE.match(/^\s*settleRefundRequest\(\);$/gm) ?? [];

    expect(activity.length).toBe(2);
    expect(settle.length).toBe(activity.length);
  });

  it('cannot throw into the refund: fire-and-forget, inside its own try', () => {
    const body = SERVICE.slice(
      SERVICE.indexOf('const settleRefundRequest'),
      SERVICE.indexOf('const recordRefundActivity')
    );

    expect(body).toContain('void (async () => {');
    expect(body).toContain('try {');
    expect(body).toContain('} catch (err) {');
    /* Never awaited at a call site: an await would put it on the path that
       answers the caller, and a slow read would delay a completed refund. */
    expect(SERVICE).not.toMatch(/await\s+settleRefundRequest\(\)/);
  });

  it('does not widen the select the refund itself depends on', () => {
    /*
     * The transaction columns are what the whole refund reads. Adding
     * `booking_id` there to save one query would change the row every guard,
     * amount check and Stripe call is computed from. The settle does its own
     * read instead.
     */
    const columns = SERVICE.match(/const TRANSACTION_COLUMNS\s*=\s*\n?\s*'([^']+)'/);
    expect(columns).not.toBeNull();
    expect(columns![1]).not.toContain('booking_id');
  });

  it('touches no money table', () => {
    const body = SERVICE.slice(
      SERVICE.indexOf('const settleRefundRequest'),
      SERVICE.indexOf('const recordRefundActivity')
    );

    /* It may READ the two tables that say which booking a payment was for. */
    for (const forbidden of ['payment_refunds', 'stripe', 'Stripe']) {
      expect(body).not.toContain(forbidden);
    }
    /* And the only write it makes goes through the repository, which has no
       method that moves money. */
    expect(body).toContain('refundRequestRepository.decide');
    expect(body).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });

  it('settles only this business\'s request, and only an open one', () => {
    const repo = fs.readFileSync(
      path.join(__dirname, '..', '..', 'repositories', 'RefundRequestRepository.ts'),
      'utf-8'
    );
    const decide = repo.slice(repo.indexOf('async decide('), repo.indexOf('async listOpen('));

    /* CLAUDE.md rule 4: an id alone is a uuid somebody could hold, and a
       service-role client has no RLS behind it. */
    expect(decide).toContain(".eq('user_id', userId)");
    /* And a decision may not overwrite a decision: a decline arriving after a
       refund has settled the row must change nothing. */
    expect(decide).toContain('.in(');
    expect(decide).toContain('OPEN_REFUND_REQUEST_STATUSES');
  });

  it('the route that says no cannot say yes', () => {
    const route = fs.readFileSync(
      path.join(
        __dirname, '..', '..', '..',
        'app', 'api', 'business-os', 'refund-requests', 'decide', 'route.ts'
      ),
      'utf-8'
    );

    /*
     * THE INTENT, NOT THE SPELLING.
     *
     * This read `toContain("z.literal('declined')")`, which failed the day a
     * second legitimate answer was added — the route grew `handled` ("I dealt
     * with it myself") and the guard called that a regression. It was pinning
     * how the schema happened to be written, not what it must never do.
     *
     * What it must never do is accept `refunded`. That word may only come
     * from a refund that actually happened: the trigger on `payment_refunds`
     * writes it, wherever the money was returned from. A route that took it
     * as input would be a second way to claim money moved when none did.
     */
    expect(route).toMatch(/decision:\s*z\.(literal|enum)\(/);
    expect(route).not.toMatch(/z\.enum\(\[[^\]]*refunded/);
    expect(route).not.toMatch(/z\.literal\('refunded'\)/);
  });
});
