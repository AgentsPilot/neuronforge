/**
 * Two rules the add-session route had no guard for, pinned at the source.
 *
 * Reported on a live account on 2026-11-08:
 *
 *   · the owner cancelled a whole package and a session row went on offering
 *     "Book a replacement", proposing 29 December
 *   · the add-a-meeting control went on working on that cancelled package
 *
 * Both reached the same route. Its refusals covered the SHAPE of a package —
 * is it a purchase, has it meetings, is the block full, is the day closed, is
 * the hour taken — and never whether the package still existed. The drawer's
 * own gates were right and were reading state from before the cancel, which is
 * exactly why the rule has to live on the server: the cancel dialog, the
 * no-show dialog and the client's portal all write through here.
 *
 * A source guard rather than a request test: the handler reaches auth, four
 * repositories, the calendar and the mailer, and a test that mocked all of
 * those would be pinned to the mocks rather than to the rule.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE = join(
  process.cwd(),
  'app',
  'api',
  'scheduling',
  'bookings',
  '[id]',
  'meetings',
  'route.ts'
);

const source = readFileSync(ROUTE, 'utf8').replace(/\r\n/g, '\n');

/** The source with its block and line comments removed. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const GET = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'));
const POST = code.slice(code.indexOf('export async function POST'));

describe('the offer', () => {
  it('reads the package’s status, not only its timezone', () => {
    expect(GET).toContain("select('timezone, status, meeting_status')");
  });

  it('makes no offer for a cancelled package', () => {
    expect(GET).toMatch(/status === 'cancelled'[\s\S]{0,120}meeting_status === 'cancelled'/);
    /* NONE is this handler's "no replacement" answer, already used for every
       other reason it declines. */
    expect(GET).toMatch(/meeting_status === 'cancelled'\s*\)\s*\{[\s\S]{0,400}return NONE;/);
  });

  it('still answers for a live package, so the guard cannot be a blanket refusal', () => {
    expect(GET).toContain('canAdd: Boolean(proposedStart)');
  });
});

describe('the write', () => {
  it('refuses a cancelled package with its own code, before anything is created', () => {
    expect(POST).toContain("code: 'package_cancelled'");
    expect(POST).toMatch(/container\.status === 'cancelled'[\s\S]{0,120}container\.meeting_status === 'cancelled'/);
  });

  it('refuses with 409, the status this route already uses for a state that moved on', () => {
    const refusal = POST.slice(POST.indexOf("code: 'package_cancelled'"));
    expect(refusal.slice(0, 400)).toContain('{ status: 409 }');
  });

  it('refuses BEFORE the session is written', () => {
    expect(POST.indexOf("code: 'package_cancelled'")).toBeLessThan(
      POST.indexOf('createMeeting(')
    );
  });
});

describe('one payment per hour the client actually gets', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE RULE MOVED; THE GUARANTEE DID NOT.
   *
   * These three used to read the decision inline in POST:
   * `replacedHourAlreadyPaid({...})`, a `chargeRefusedAsAlreadyPaid` flag, and
   * a four-term `if` gating the stage write on it.
   *
   * It now lives in `lib/scheduling/replacementStage.ts`, because the GET the
   * cancel dialog opens with has to STATE this answer before the owner
   * commits. Two copies of the rule would eventually promise one thing and
   * write another — which is the same class of defect as the incident that
   * caused the rule: package 83e8460c, where a replacement billed 400.02 for
   * an hour already paid at 399.99.
   *
   * So the assertions follow it, and are stronger for it: the refusal is
   * pinned in the module (one rule) AND the route is pinned to obey it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const OUTLOOK = readFileSync(
    join(process.cwd(), 'lib/scheduling/replacementStage.ts'),
    'utf8'
  ).replace(/\r\n/g, '\n');

  it('asks the chain, not the caller, before a replacement carries a stage', () => {
    /* The chain is walked inside the module, and the route asks the module. */
    expect(OUTLOOK).toContain('replacedHourAlreadyPaid({');
    expect(POST).toContain('replacementStageOutlook({');
  });

  it('refuses to bill an hour already paid for, before the plan is consulted', () => {
    /*
     * `bills: false` is the whole protection. Ordering matters as much: an
     * already-paid hour must be answered BEFORE the plan is looked at, or a
     * plan with an amount would bill it anyway.
     */
    expect(OUTLOOK).toMatch(/if \(verdict\.alreadyPaid\) return none\('already_paid'/);
    /* Anchored on the plan QUERY, not the words `created_plan_id`, which also
       appear in a doc comment near the top and made this compare positions of
       a comment rather than of the read. */
    const refusal = OUTLOOK.indexOf("return none('already_paid'");
    const planQuery = OUTLOOK.indexOf(".from('payment_plan_installments')");
    expect(refusal).toBeGreaterThan(-1);
    expect(planQuery).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(planQuery);
  });

  it('gates the stage creation on that answer', () => {
    /* The route writes a stage only when the module says it bills. */
    expect(POST).toMatch(/if \(outlook\?\.bills && proposal\?\.created_plan_id\)/);
    expect(POST).not.toMatch(/if \(input\.charge && perSession && proposal\?\.created_plan_id\)/);
  });

  it('asks only when this session replaces another, so a plain add is untouched', () => {
    /* `replacedMeetingId: replacedId ?? null` — a plain add passes null and the
       module answers without walking any chain. */
    expect(POST).toMatch(/replacedMeetingId: replacedId \?\? null/);
  });
});
