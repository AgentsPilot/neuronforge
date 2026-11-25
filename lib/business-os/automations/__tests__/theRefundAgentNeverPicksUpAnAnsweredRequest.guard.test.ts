/**
 * A request somebody has answered is never assessed again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A GUARD AND NOT A UNIT TEST
 *
 * The protection is spread across four files that know nothing about each
 * other: a status filter in a JSON plan, two call sites in `RefundService`, a
 * repository method's `.in(...)` clause, and a database trigger. Each is
 * correct today. None of them fails loudly if another is removed — the agent
 * would simply start re-assessing requests the owner had already refunded,
 * overwrite `awaiting_owner` onto a settled row, and raise a card about money
 * that has already gone back.
 *
 * The cost of that is not an error anybody sees. It is the owner being asked a
 * second time whether to refund a client they refunded last week.
 *
 * WHAT MUST STAY TRUE
 *
 *   1. the plan claims ONLY `submitted`
 *   2. every refund settles the request — the manual path as well as Stripe
 *   3. settling can never overwrite a decision
 *   4. the database settles it too, if the application misses
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');

describe('the refund agent never picks up an answered request', () => {
  it('claims only `submitted`, and no other status', () => {
    const plan = JSON.parse(
      read('lib', 'business-os', 'automations', 'agents', 'assessRefundRequests.steps.json')
    ) as Array<Record<string, unknown>>;

    const step1 = plan.find(s => s.id === 'step1') as Record<string, unknown>;
    expect(step1.action).toBe('find_refund_requests');

    const filters = ((step1.params as Record<string, unknown>).filters ?? []) as Array<{
      field: string;
      op: string;
      value: unknown;
    }>;
    const onStatus = filters.filter(f => f.field === 'status');

    /*
     * Exactly one status clause, and it is an equality on `submitted`. An `in`
     * that quietly grew `awaiting_owner` would make the agent re-assess its own
     * output every run, overwriting the recommendation the owner is reading.
     */
    expect(onStatus).toHaveLength(1);
    expect(onStatus[0]?.op).toBe('eq');
    expect(onStatus[0]?.value).toBe('submitted');
  });

  it('every refund settles the request — by hand as well as by processor', () => {
    const service = read('lib', 'payments', 'RefundService.ts');

    /*
     * TWO call sites, deliberately. A business with no processor settles by
     * hand, and that path returns EARLY — so a single call placed after the
     * Stripe block would leave every manual refund's request open, and the
     * agent would keep asking about money that was already returned.
     */
    const calls = service.match(/^\s*settleRefundRequest\(\);$/gm) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);

    /* And it follows BOTH links to the booking. A transaction carries
       `booking_id` only for a website sale; an invoiced one carries the
       booking on the invoice. Matching one is the bug this whole feature
       tripped over once already. */
    expect(service).toContain("from('payment_invoices')");
    expect(service).toMatch(/invoice\?\.booking_id/);
  });

  it('records WHICH payment answered the request', () => {
    const service = read('lib', 'payments', 'RefundService.ts');
    const repo = read('lib', 'repositories', 'RefundRequestRepository.ts');

    /*
     * `transaction_id` was a column nothing ever wrote — worse than no column,
     * because it looks meaningful and is always null. The agent could not fill
     * it: a request names a BOOKING, and the payment behind one may sit an
     * invoice away, so asking the model for a transaction id produced a guess
     * dressed as a fact. That field was removed from its output.
     *
     * `RefundService` knows it for certain, having just refunded that row, so
     * the link is written at the instant it becomes true.
     */
    expect(service).toMatch(/decide\(open\.id, userId, 'refunded', tx\.id\)/);
    expect(repo).toMatch(/transactionId \? \{ transaction_id: transactionId \} : \{\}/);
  });

  it('the status type says everything the database allows', () => {
    const repo = read('lib', 'repositories', 'RefundRequestRepository.ts');
    const migration = read(
      'supabase',
      'migrations',
      '20261124_the_receptionist_may_answer_and_a_refund_may_be_handled.sql'
    );

    /*
     * THE TWO DRIFTED, AND NOTHING SAID SO.
     *
     * 20261124 added `handled` to the CHECK constraint. The union here was
     * never updated, so `Extract<RefundRequestStatus, 'handled'>` resolved to
     * `never` and the decide route's call site became a type error — invisible,
     * because `next.config.js` ignores type errors.
     *
     * A status the database accepts and the type denies is a write that
     * compiles, runs, and is refused by Postgres at the worst possible moment.
     */
    expect(migration).toContain("'handled'");
    expect(repo).toMatch(/\|\s*'handled'/);
  });

  it('settling cannot overwrite an answer somebody already gave', () => {
    const repo = read('lib', 'repositories', 'RefundRequestRepository.ts');

    /*
     * `decide` is scoped to the OPEN statuses, so a refund landing after the
     * owner declined — or two presses of one button — changes nothing and says
     * so by returning no row. The same clause is what lets the OWNER win a
     * race with the agent.
     */
    const decide = repo.slice(repo.indexOf('async decide('), repo.indexOf('async openForBooking('));
    expect(decide).toContain('OPEN_REFUND_REQUEST_STATUSES');
    expect(decide).toContain(".eq('user_id', userId)");

    /* And the assessment write is scoped the same way, so an agent that was
       still thinking cannot land on a request the owner has answered. */
    const assess = repo.slice(repo.indexOf('async recordAssessment('));
    expect(assess).toContain('OPEN_REFUND_REQUEST_STATUSES');
  });

  it('the database settles it too, if the application never gets the chance', () => {
    const migration = read(
      'supabase',
      'migrations',
      '20261123_the_refund_agent_can_look_at_a_request.sql'
    );

    /*
     * The backstop. `settleRefundRequest` is fire-and-forget inside a function
     * that has already returned the refund to its caller, so a serverless
     * instance frozen a millisecond later takes it with it. The trigger runs
     * inside the transaction that wrote the money.
     *
     * It must cover all three open statuses: a refund can land while the
     * request is still `submitted` (the owner was faster than the agent),
     * while it is `assessing`, or after the card appeared.
     */
    expect(migration).toMatch(/UPDATE public\.refund_requests[\s\S]{0,200}SET status = 'refunded'/);
    expect(migration).toMatch(
      /status IN \('submitted', 'assessing', 'awaiting_owner'\)/
    );
  });

  it('the card can no longer close a request without saying what happened', () => {
    const card = read('components', 'business-os', 'insight', 'NeedsYouCard.tsx');

    /*
     * `סמן כטופל` is gone from the refund row. It called the same endpoint as
     * `דחייה`, closed the same request and told the client the same nothing —
     * one word apart in the database and identical to press.
     *
     * Worse, it was the wrong home for the case it served: "I already sent the
     * money by bank transfer" closed the request while the ledger went on
     * saying the client was never refunded. That belongs in the refund dialog,
     * which records a hand-returned refund properly.
     */
    expect(card).not.toMatch(/answerRefund\(gap, item, 'handled'\)/);
    expect(card).toMatch(/answerRefund\(gap, item, 'declined'\)/);
  });
});
