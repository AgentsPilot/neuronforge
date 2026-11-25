/**
 * Every live session of a pay-as-you-go package is money somebody is counting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAUGHT
 *
 * `packageSessionPayment` states the rule — "one row per meeting, written once
 * when the quote is accepted" — and nothing enforced it after acceptance. Every
 * path that adds a session later decides for itself whether to write a stage.
 *
 * Run across the platform on 25 November 2026: of four `bill_per_session`
 * packages, TWO were out of step.
 *
 *   · a session on 29 Dec, upcoming and scheduled, with no stage — $111.02
 *   · a session on 19 Nov already HELD, with no stage — $74.02 of delivered
 *     work that could not be billed, because the thing that bills it did not
 *     exist
 *
 * It is the quiet kind of wrong. The drawer, the money page and the reports all
 * read stages, so all three under-reported by the same amount and agreed with
 * each other perfectly while doing it. Nothing contradicted anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A UNIT TEST, NOT A SOURCE GUARD
 *
 * Most of the scheduling rules in this repo are pinned by reading source,
 * because their failure is a rendered pixel or a row that is not there. This
 * one is a pure function over two lists, so it can simply be ASKED — and the
 * cases below are the live shapes that produced the drift.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  isLiveSession,
  nextStageLabel,
  stageDrift,
  stagesMatchSessions,
  type SessionFact,
  type StageFact,
} from '@/lib/payments/sessionStages';

const session = (id: string, meetingStatus: string | null): SessionFact => ({ id, meetingStatus });
const stage = (
  id: string,
  meetingId: string | null,
  status: string,
  invoiceId: string | null = null
): StageFact => ({ id, meetingId, status, invoiceId });

describe('what counts as a live session', () => {
  it.each([
    ['an hour still to come', null],
    ['one that happened', 'held'],
    ['one the client missed', 'no_show'],
  ])('%s is live', (_label, status) => {
    expect(isLiveSession(status)).toBe(true);
  });

  it('a missed hour stays live on purpose', () => {
    /*
     * The owner may still charge for an hour they held and the client did not
     * attend. `setMeetingOutcome` leaves that open, so voiding the stage here
     * would decide it for them — and silently.
     */
    expect(isLiveSession('no_show')).toBe(true);
  });

  it.each([
    ['called off', 'cancelled'],
    ['superseded by a later attempt', 'moved'],
  ])('%s is not', (_label, status) => {
    expect(isLiveSession(status)).toBe(false);
  });

  it('an unknown status is treated as live', () => {
    /*
     * The safe direction, and it was wrong first time: the rule enumerated the
     * live outcomes, so anything new counted as settled — dropping its money
     * from the books by omission AND making any stage against it look orphaned.
     * Stating the two SETTLED outcomes instead makes every future one open.
     */
    expect(isLiveSession('some_new_state')).toBe(true);
  });
});

describe('the drift the live data had', () => {
  it('finds a scheduled session with no stage', () => {
    /* The 29 December case. */
    const drift = stageDrift(
      [session('s1', 'held'), session('s2', null)],
      [stage('p1', 's1', 'paid')]
    );

    expect(drift.missing.map(s => s.id)).toEqual(['s2']);
    expect(drift.orphaned).toEqual([]);
  });

  it('and a HELD session with no stage, which is worse', () => {
    /*
     * The 19 November case: work delivered that nothing can bill. A missing
     * stage on an upcoming session is money not yet counted; on a held one it
     * is money the owner has already earned.
     */
    const drift = stageDrift([session('s1', 'held')], []);

    expect(drift.missing.map(s => s.id)).toEqual(['s1']);
  });

  it('a cancelled stage does not satisfy a live session', () => {
    /* A session rebooked after its first stage was voided needs a new one; the
       voided row is not money. */
    const drift = stageDrift([session('s1', null)], [stage('p1', 's1', 'cancelled')]);

    expect(drift.missing.map(s => s.id)).toEqual(['s1']);
  });

  it('and a healthy package reports nothing', () => {
    const sessions = [
      session('s1', 'held'),
      session('s2', 'no_show'),
      session('s3', null),
      session('s4', 'cancelled'),
      session('s5', 'moved'),
    ];
    const stages = [
      stage('p1', 's1', 'paid'),
      stage('p2', 's2', 'pending'),
      stage('p3', 's3', 'pending'),
      stage('p4', 's4', 'cancelled'),
    ];

    expect(stagesMatchSessions(sessions, stages)).toBe(true);
  });
});

describe('the other direction, which over-reports', () => {
  it('a standing stage on a called-off session is reported', () => {
    const drift = stageDrift([session('s1', 'cancelled')], [stage('p1', 's1', 'pending')]);

    expect(drift.orphaned.map(s => s.id)).toEqual(['p1']);
  });

  it('but a BILLED stage is left alone', () => {
    /*
     * Once an invoice exists the debt is the invoice; this row is its schedule.
     * Reporting it as orphaned would invite voiding something a client may
     * already have been asked to pay.
     */
    const drift = stageDrift(
      [session('s1', 'cancelled')],
      [stage('p1', 's1', 'pending', 'inv-1')]
    );

    expect(drift.orphaned).toEqual([]);
  });

  it('and a stage whose session is absent is never guessed at', () => {
    /*
     * The caller may have loaded a window of sessions rather than all of them.
     * Treating "not in this list" as "called off" would void live money.
     */
    const drift = stageDrift([session('s1', null)], [stage('p9', 's-elsewhere', 'pending')]);

    expect(drift.orphaned).toEqual([]);
    expect(drift.missing.map(s => s.id)).toEqual(['s1']);
  });

  it('a stage tied to no session at all is ignored', () => {
    /* An upfront or milestone stage is not per-session money. */
    const drift = stageDrift([session('s1', 'held')], [stage('p1', null, 'pending')]);

    expect(drift.orphaned).toEqual([]);
    expect(drift.missing.map(s => s.id)).toEqual(['s1']);
  });
});

describe('naming the stage that bills a session', () => {
  it('numbers a label that carries a number', () => {
    expect(nextStageLabel('Meeting 3', 4, 'Deep clean')).toBe('Meeting 4');
  });

  it('keeps whatever sits after the number', () => {
    /*
     * The subtlety the duplicated copies were one edit from losing: a label
     * ending in a bracket has the digits in the MIDDLE, and a pattern anchored
     * on digits alone matches nothing — handing back the previous label and
     * putting one name on two stages.
     */
    expect(nextStageLabel('Package (13)', 14, 'Package')).toBe('Package (14)');
  });

  it('invents a name from the quote when there is no previous one', () => {
    expect(nextStageLabel(null, 1, 'CleanUp office quotation')).toBe('CleanUp office quotation (1)');
  });

  it('and leaves an unnumbered label exactly as it is', () => {
    /* "On completion" has no sequence; numbering it would invent one. */
    expect(nextStageLabel('On completion', 2, 'Deep clean')).toBe('On completion');
  });
});

/**
 * And the rule is actually asked, after the places a session can change.
 *
 * The pure function above is only worth having if something runs it. These read
 * source because "is this called" is not a question a unit test of a pure
 * module can answer.
 */
describe('the invariant is checked at runtime', () => {
  const read = (relative: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('fs') as typeof import('fs')).readFileSync(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('path') as typeof import('path')).join(process.cwd(), relative),
      'utf8'
    );

  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('after a session is added to a package', () => {
    expect(code(read('app/api/scheduling/bookings/[id]/meetings/route.ts'))).toContain(
      'reconcileSessionStages({ userId: user.id, containerId })'
    );
  });

  it('and after a make-up session is booked', () => {
    expect(code(read('lib/scheduling/makeUpSession.ts'))).toContain(
      'reconcileSessionStages({ userId: request.userId, containerId: request.containerId })'
    );
  });

  it('never fatally, because the client already has their hour', () => {
    /*
     * Both call sites have already created the session and emailed the client
     * by this point. A stage that failed to write is money not yet billed,
     * which an owner can see and raise; refusing the booking over it would
     * leave the client with no appointment at all.
     */
    const route = code(read('app/api/scheduling/bookings/[id]/meetings/route.ts'));
    const makeUp = code(read('lib/scheduling/makeUpSession.ts'));

    expect(route).toMatch(/reconcileSessionStages\([\s\S]{0,400}\.catch\(/);
    expect(makeUp).toMatch(/reconcileSessionStages\([\s\S]{0,160}\.catch\(/);
  });

  it('and the reconciler creates but never voids', () => {
    /*
     * Creating a missing stage is additive and is the agreement the client
     * already made. Voiding an orphan is how money disappears — the client may
     * have been asked for it, and the cancel paths void deliberately with rules
     * of their own. Orphans are reported.
     */
    const reconciler = code(read('lib/payments/reconcileSessionStages.ts'));

    expect(reconciler).toContain("from('payment_plan_installments').insert(rows)");
    expect(reconciler).not.toMatch(/\.update\(\{\s*status: 'cancelled'/);
    expect(reconciler).not.toContain('.delete()');
    expect(reconciler).toContain('Stages still standing against a settled session');
  });

  it('modelling the new stage on the plan rather than inventing a price', () => {
    /* What a session costs belongs to the quote. A reconciler that guessed
       would be a second place deciding the price of an hour. */
    const reconciler = code(read('lib/payments/reconcileSessionStages.ts'));

    expect(reconciler).toContain('Sessions have no stage and the plan has none to model one on');
  });
});
