import { readFileSync } from 'fs';
import { join } from 'path';
/**
 * The one answer four surfaces read, across every service shape that exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The shapes are not hypothetical. One account's catalogue spans all six, and
 * they differ in which layers exist at all:
 *
 *   free + scheduled      פגישת היכרות      price 0, nothing to collect
 *   invoice + scheduled   ייעוץ אישי        meeting, then billing
 *   card + unscheduled    קורס קשב          money only, no meeting
 *   instalments           תוכנית תשלומים    money arriving over months
 *   quoted + scheduled    הצעת מחיר לשיפוץ  meeting → quote → money
 *   package                                 many meetings, one agreement
 *
 * The cases that bite: a free meeting must never be chased for payment, a
 * quote sitting with the client is not a task, and a held consultation whose
 * job was cancelled asks for nothing even though its status reads `completed`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { bookingNextStep, opensItself, type NextStepInput } from '../bookingNextStep';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const PAST = new Date('2026-10-04T09:30:00.000Z');
const FUTURE = new Date('2026-10-05T09:30:00.000Z');

/** A quoted consultation, booked and not yet held. */
const quoted: NextStepInput = {
  booking: { status: 'confirmed', meeting_status: null },
  startTime: FUTURE,
  isUnscheduled: false,
  isQuoted: true,
  proposalStatus: null,
  money: 'nothing_to_collect',
  now: NOW,
};

const held: NextStepInput = {
  ...quoted,
  startTime: PAST,
  booking: { status: 'confirmed', meeting_status: 'held' },
};

describe('every action the banner can offer', () => {
  /*
   * ── A MISSING LABEL IS NOT A CRASH, WHICH IS THE PROBLEM ──────────────────
   *
   * The banner renders `t('crm.next.action.<action>') || action`. `t()` returns
   * the KEY on a miss and a key is truthy, so a label that does not exist shows
   * the owner `crm.next.action.cancel_booking`; and where the fallback does
   * fire they get the bare identifier `cancel_booking` instead. Either way
   * nothing throws, no test fails, and the button ships unreadable.
   *
   * That is exactly what happened to `cancel_booking` — added to the union and
   * wired to a handler, with no label in any of the three files.
   */
  const ACTIONS = (() => {
    const src = readFileSync(join(__dirname, '..', 'bookingNextStep.ts'), 'utf-8');
    const from = src.slice(src.indexOf('export type NextStepAction'));
    /* To the blank line that ends the declaration, not to the first `;` — a
       doc comment between members contains sentences, and sentences contain
       semicolons. */
    const union = from.slice(0, from.indexOf('\n\n'));
    return [...union.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  })();

  it('is a real list', () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(10);
    expect(ACTIONS).toContain('cancel_booking');
    expect(ACTIONS).toContain('new_meeting');
  });

  it('has a label in every language', () => {
    for (const lang of ['he', 'en', 'es']) {
      const dict = readFileSync(
        join(__dirname, '..', 'translations', `${lang}.ts`),
        'utf-8'
      );
      const missing = ACTIONS.filter(a => !dict.includes(`'crm.next.action.${a}'`));
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  it('and a handler in the card that runs it', () => {
    /* A labelled button that does nothing is the other half of the same
       failure: `runNextStepAction` falls through silently for an action it
       does not know. */
    const tab = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
      'utf-8'
    );
    const body = tab.slice(tab.indexOf('runNextStepAction'));
    const unhandled = ACTIONS.filter(a => !body.includes(`case '${a}':`));
    expect(unhandled).toEqual([]);
  });
});

describe('when the CLIENT changed the arrangement', () => {
  /*
   * The case that prompted this: a client rebooked themselves from the public
   * portal. `status` does not move, `meeting_status` does not move, and the
   * only thing that changed was the hour the owner has to be somewhere. The
   * card went on reading "the meeting is still ahead", which was true, useless,
   * and identical to what it said the day before.
   */
  it('says so, and reaches the banner', () => {
    const step = bookingNextStep({ ...quoted, lastMoveBy: 'client' });
    expect(step.labelKey).toBe('next.client_moved_meeting');
    /* The banner renders on `whoseMove === 'owner'` with at least one action;
       anything else is a line on the card and nothing more. */
    expect(step.whoseMove).toBe('owner');
    expect(step.actions).toContain('reschedule');
  });

  it('outranks an unsent intake form, which nothing else here does', () => {
    /*
     * Deliberate, and the only branch before the meeting that beats a task. A
     * form can go out tomorrow; a clash in the owner's calendar cannot wait to
     * be noticed.
     */
    const step = bookingNextStep({ ...quoted, intake: 'not_sent', lastMoveBy: 'client' });
    expect(step.labelKey).toBe('next.client_moved_meeting');
  });

  it('but the OWNER moving it says nothing at all', () => {
    /* Telling somebody what they themselves just did is how a card teaches an
       owner to stop reading it. */
    for (const by of ['owner', 'system', null] as const) {
      const step = bookingNextStep({ ...quoted, lastMoveBy: by });
      expect(step.labelKey).toBe('next.meeting_ahead');
      expect(step.whoseMove).toBe('nobody');
    }
  });

  it('a cancellation by the client is news too, and offers another time', () => {
    /*
     * `quoteGate` answers 'open' for a cancelled meeting — correct, the quote
     * can still go out — so the card jumped to "write a quote" and never said
     * the appointment had gone.
     */
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'confirmed', meeting_status: 'cancelled' },
      outcomeBy: 'client',
    });
    expect(step.labelKey).toBe('next.client_cancelled_meeting');
    expect(step.whoseMove).toBe('owner');
    expect(step.actions).toContain('new_meeting');
  });

  it('a no-show can be ended as well as continued', () => {
    /*
     * A client who did not turn up and does not answer is a real ending, and
     * the banner offered no way to reach it: both existing answers continue
     * the job, so the owner had to know the red control was further down the
     * card, under a booking the banner was still describing as live.
     *
     * The quote stays on offer beside it. Missing one meeting is not
     * withdrawal — that is the owner's call, not an inference from attendance.
     */
    const step = bookingNextStep({
      ...quoted,
      startTime: PAST,
      booking: { status: 'confirmed', meeting_status: 'no_show' },
    });
    expect(step.labelKey).toBe('next.missed');
    expect(step.actions).toContain('cancel_booking');
    expect(step.actions).toContain('create_quote');
    /* A NEW meeting, not a move of the one that was missed — the row is a
       record of what happened, and editing its time contradicts it. */
    expect(step.actions).toContain('new_meeting');
    expect(step.actions).not.toContain('reschedule');
  });

  it('and an unquoted no-show gets the ending without a quote to send', () => {
    const step = bookingNextStep({
      ...quoted,
      isQuoted: false,
      startTime: PAST,
      booking: { status: 'confirmed', meeting_status: 'no_show' },
    });
    expect(step.actions).toEqual(['new_meeting', 'cancel_booking']);
  });

  it('saying NO quote is coming leaves a booking that wants closing', () => {
    /*
     * The owner cancelled the meeting and answered that the quote is not going
     * ahead. Nothing else moved: the booking sits in the list as live work
     * that will never be quoted for, billed, or closed — and before this it
     * sat there silently, because the answer shaped an email and was then
     * thrown away.
     */
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'confirmed', meeting_status: 'cancelled' },
      outcomeBy: 'owner',
      proposalContinues: false,
    });
    expect(step.labelKey).toBe('next.close_the_booking');
    expect(step.whoseMove).toBe('owner');
    expect(step.actions).toContain('cancel_booking');
  });

  it('and NULL is not a yes', () => {
    /*
     * Nobody was asked — every booking before the column, and every one whose
     * meeting was never cancelled. Treating that as "the quote continues"
     * would be inventing an answer; treating it as "no quote" would nag every
     * old booking to close itself. It changes nothing, which is the point.
     */
    for (const answer of [null, undefined, true] as const) {
      const step = bookingNextStep({
        ...quoted,
        booking: { status: 'confirmed', meeting_status: 'cancelled' },
        outcomeBy: 'owner',
        proposalContinues: answer,
      });
      expect(step.labelKey).not.toBe('next.close_the_booking');
    }
  });

  it('and it outranks the client-cancelled notice', () => {
    /* A booking that should not exist does not need a reminder about who moved
       its meeting. */
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'confirmed', meeting_status: 'cancelled' },
      outcomeBy: 'client',
      proposalContinues: false,
    });
    expect(step.labelKey).toBe('next.close_the_booking');
  });

  it('and the notice steps aside once a quote exists', () => {
    /*
     * `meeting_status` stays `'cancelled'` for ever, so an unconditional
     * notice would outlive the thing it reports: the card would still be
     * announcing the cancellation after the quote had been written, sent and
     * accepted — and because the check sits in front of `quoteGate`, none of
     * the quote's own states could ever be reached.
     */
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'confirmed', meeting_status: 'cancelled' },
      outcomeBy: 'client',
      proposalStatus: 'sent',
    });
    expect(step.labelKey).not.toBe('next.client_cancelled_meeting');
    expect(step.stage).toBe('proposal');
  });

  it('and the owner cancelling it still flows to the quote', () => {
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'confirmed', meeting_status: 'cancelled' },
      outcomeBy: 'owner',
    });
    expect(step.labelKey).not.toBe('next.client_cancelled_meeting');
  });

  it('and a called-off JOB still beats both', () => {
    /* The ordering that was already there: a stopped job asks for nothing, and
       a notice about its meeting would be noise on top of that. */
    const step = bookingNextStep({
      ...quoted,
      booking: { status: 'cancelled', meeting_status: 'cancelled' },
      outcomeBy: 'client',
      lastMoveBy: 'client',
    });
    expect(step.labelKey).toBe('next.called_off');
  });
});

describe('before the meeting', () => {
  it('asks for nothing and names the wait', () => {
    const step = bookingNextStep(quoted);

    expect(step).toMatchObject({ stage: 'session', whoseMove: 'nobody', actions: [] });
    expect(opensItself(step)).toBe(false);
  });

  it('asks for the intake form, the only thing owed before a meeting', () => {
    /*
     * A form answered after the meeting is worth nothing, so this is the one
     * task that can exist while the meeting is still ahead. Without it the card
     * says "nothing to do" at the only moment sending it still helps.
     */
    expect(bookingNextStep({ ...quoted, intake: 'not_sent' })).toMatchObject({
      stage: 'intake',
      whoseMove: 'owner',
      actions: ['send_intake'],
    });
  });

  it('stops asking once the form is out', () => {
    expect(bookingNextStep({ ...quoted, intake: 'sent_unanswered' }).whoseMove).toBe('client');
    expect(bookingNextStep({ ...quoted, intake: 'answered' }).stage).toBe('session');
  });
});

describe('the meeting has passed and nobody has said what happened', () => {
  it('is the one moment the card interrupts', () => {
    const step = bookingNextStep({ ...quoted, startTime: PAST });

    expect(step).toMatchObject({
      stage: 'session',
      whoseMove: 'owner',
      labelKey: 'next.mark_meeting',
      actions: ['mark_held', 'mark_no_show', 'reschedule'],
    });
    expect(opensItself(step)).toBe(true);
  });

  it('offers a new time as a THIRD answer, not only after a no-show', () => {
    /*
     * A meeting that did not happen because it MOVED is ordinary. Without
     * this the owner had to first record something untrue — a no-show against
     * a client who did nothing wrong, on that client's own timeline — before
     * being offered the thing they actually wanted.
     *
     * The meeting stage already offered all three, so leaving it out here also
     * made one moment ask two different questions in two places.
     */
    expect(bookingNextStep({ ...quoted, startTime: PAST }).actions).toContain('reschedule');
  });

  it('keeps "it happened" first, because that is the common answer', () => {
    // The banner renders the first action as the primary one.
    expect(bookingNextStep({ ...quoted, startTime: PAST }).actions[0]).toBe('mark_held');
  });

  it('does not claim the meeting happened just because the clock passed', () => {
    // The journey used to flip to "your move" on the clock alone and name a
    // price the owner might owe for a site visit nobody attended.
    expect(bookingNextStep({ ...quoted, startTime: PAST }).stage).not.toBe('proposal');
  });

  it('outranks an unanswered intake form', () => {
    // The form is moot now. What is owed is the outcome.
    expect(
      bookingNextStep({ ...quoted, startTime: PAST, intake: 'not_sent' }).stage
    ).toBe('session');
  });
});

describe('once the meeting is marked', () => {
  it('held with no quote is the owner’s move', () => {
    expect(bookingNextStep(held)).toMatchObject({
      stage: 'proposal',
      whoseMove: 'owner',
      actions: ['create_quote'],
    });
  });

  const missed: NextStepInput = {
    ...quoted,
    startTime: PAST,
    booking: { status: 'confirmed', meeting_status: 'no_show' },
  };

  it('a no-show keeps the job alive and asks for a new time first', () => {
    // Folding `no_show` in with `cancelled` once took the quote route away
    // from a client who had simply missed a site visit.
    expect(bookingNextStep(missed)).toMatchObject({
      stage: 'session',
      whoseMove: 'owner',
      /* `cancel_booking` joins them: a client who did not turn up and does
         not answer is a real ending, and both other answers continue the
         job. Order is the recommendation, cheapest first. */
      actions: ['new_meeting', 'create_quote', 'cancel_booking'],
    });
  });

  it('still lets a quoted job be PRICED after a missed meeting', () => {
    /*
     * The owner may have spoken to the client by phone, or seen the job
     * already. A missed site visit does not stop them pricing it, and the
     * proposal stage has always allowed this — `quoteWaitingOn('missed')`
     * returns `noshow`, which keeps Send a quote reachable. Only the banner
     * was narrower, so one moment offered two different sets of choices
     * depending on where the owner looked.
     */
    expect(bookingNextStep(missed).actions).toContain('create_quote');
  });

  it('offers a direct-price service only the new time', () => {
    // There is no quote to write, so the moves are another date or an end to
    // it. Nothing here can price anything.
    expect(
      bookingNextStep({ ...missed, isQuoted: false, money: 'needs_invoice' }).actions
    ).toEqual(['new_meeting', 'cancel_booking']);
  });
});

describe('the quote', () => {
  it('sitting with the client is NOT a task', () => {
    const step = bookingNextStep({ ...held, proposalStatus: 'sent' });

    expect(step).toMatchObject({ stage: 'proposal', whoseMove: 'client' });
    expect(opensItself(step)).toBe(false);
  });

  it('viewed is still the client’s move', () => {
    expect(bookingNextStep({ ...held, proposalStatus: 'viewed' }).whoseMove).toBe('client');
  });

  it('refused is the owner’s move again, not the end of the job', () => {
    for (const status of ['declined', 'expired']) {
      expect(bookingNextStep({ ...held, proposalStatus: status })).toMatchObject({
        whoseMove: 'owner',
        actions: ['create_quote'],
      });
    }
  });

  it('claims nothing for a status nobody has decided the meaning of', () => {
    /*
     * `stopped` was added to the proposal set without a branch once, fell
     * through a catch-all, and told an owner to quote a job they had just
     * stopped. An unknown status gets silence, never an invented instruction.
     */
    expect(bookingNextStep({ ...held, proposalStatus: 'something_new' })).toMatchObject({
      whoseMove: 'nobody',
      actions: [],
    });
  });
});

describe('the money, once everything above it is settled', () => {
  const accepted: NextStepInput = { ...held, proposalStatus: 'accepted' };

  it('a free service is FINISHED, never chased', () => {
    /*
     * פגישת היכרות is priced at zero. A task list that chases free intro
     * meetings for payment is a task list an owner stops reading.
     */
    expect(bookingNextStep({ ...accepted, money: 'nothing_to_collect' }).stage).toBe('done');
    expect(bookingNextStep({ ...accepted, money: 'paid' }).stage).toBe('done');
  });

  it('an unraised invoice is the owner’s move', () => {
    // Work done and nobody asked for the money: the most recoverable thing
    // on the dashboard, and invisible unless the card says it.
    expect(bookingNextStep({ ...accepted, money: 'needs_invoice' })).toMatchObject({
      stage: 'payment',
      whoseMove: 'owner',
      actions: ['send_invoice'],
    });
  });

  it('a sent invoice or payment link is the client’s', () => {
    const step = bookingNextStep({ ...accepted, money: 'with_client' });

    expect(step.whoseMove).toBe('client');
    expect(opensItself(step)).toBe(false);
  });

  it('a plan collecting itself asks for nothing', () => {
    expect(bookingNextStep({ ...accepted, money: 'plan_auto' })).toMatchObject({
      whoseMove: 'client',
      actions: [],
    });
  });

  it('a plan whose next stage is manual and due is the owner’s', () => {
    expect(bookingNextStep({ ...accepted, money: 'plan_needs_billing' })).toMatchObject({
      stage: 'payment',
      whoseMove: 'owner',
      actions: ['bill_next_stage'],
    });
  });
});

describe('a job that was called off', () => {
  it('asks for nothing even though its status still reads completed', () => {
    /*
     * THE SHAPE THAT BROKE EVERYTHING ELSE. Cancelling a held consultation
     * preserves `completed`, because overwriting it would erase that the
     * meeting happened. Three production rows look exactly like this.
     */
    const step = bookingNextStep({
      ...held,
      booking: {
        status: 'completed',
        meeting_status: 'held',
        cancel_reason: 'client_unresponsive',
        cancelled_by: 'owner',
      },
      proposalStatus: 'sent',
    });

    expect(step).toMatchObject({ stage: 'done', whoseMove: 'nobody', actions: [] });
    expect(step.labelKey).toBe('next.called_off');
  });

  it('beats money still outstanding', () => {
    // A stopped job does not chase its own invoice; that is a refund decision.
    expect(
      bookingNextStep({
        ...held,
        booking: { status: 'confirmed', meeting_status: 'held', cancelled_by: 'owner' },
        proposalStatus: 'accepted',
        money: 'needs_invoice',
      }).whoseMove
    ).toBe('nobody');
  });

  it('is NOT finished by a stopped quote — it is left for the owner to close', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * This asserted `done`, and `done` is what the card reads as "הכול הושלם".
     *
     * Stopping a quote deliberately touches no booking — that separation is
     * the point — so the booking stays `confirmed` and sits in the list as
     * live work that will never proceed. Reporting success over work the owner
     * had just abandoned is the fault the current branch records, seen on a
     * 9,500 quote with a deposit collected.
     *
     * So the stage stays `proposal`, the move is the owner's, and the card
     * offers the one thing that is actually left to do.
     * ───────────────────────────────────────────────────────────────────────
     */
    const step = bookingNextStep({ ...held, proposalStatus: 'stopped' });

    expect(step.stage).toBe('proposal');
    expect(step.whoseMove).toBe('owner');
    expect(step.actions).toContain('cancel_booking');
  });
});

describe('a package', () => {
  const pkg: NextStepInput = {
    ...held,
    proposalStatus: 'accepted',
    money: 'paid',
    packageProgress: { total: 6, settled: 1 },
  };

  it('is not finished because its first meeting was', () => {
    // Reported as a package reading like two jobs. The parent describes the
    // block, not the session just held.
    expect(bookingNextStep(pkg)).toMatchObject({
      stage: 'session',
      whoseMove: 'nobody',
      labelKey: 'next.package_running',
    });
  });

  it('falls through to the money once every meeting is settled', () => {
    expect(
      bookingNextStep({ ...pkg, packageProgress: { total: 6, settled: 6 }, money: 'needs_invoice' })
    ).toMatchObject({ stage: 'payment', whoseMove: 'owner' });
  });

  it('does not re-ask about the quote that sold it', () => {
    // A package exists only because its quote was accepted.
    expect(bookingNextStep(pkg).stage).not.toBe('proposal');
  });
});

describe('a service that is bought rather than booked', () => {
  /** קורס קשב: card-collected, no appointment. */
  const course: NextStepInput = {
    booking: { status: 'confirmed', meeting_status: null },
    startTime: null,
    isUnscheduled: true,
    isQuoted: false,
    proposalStatus: null,
    money: 'with_client',
    now: NOW,
  };

  it('has no meeting to wait for, so the money is the whole journey', () => {
    expect(bookingNextStep(course)).toMatchObject({ stage: 'payment', whoseMove: 'client' });
  });

  it('is not finished merely because it is paid', () => {
    /*
     * PAID IS NOT DELIVERED, and this used to say it was.
     *
     * The journey has always drawn a `fulfillment` step for a dateless
     * service, and owners had ticked it; what was missing is that nothing
     * ASKED. `moneyStep` returned `done` the moment the money landed, so the
     * badge read "all done" directly above a step that was still open. A
     * course is given on a different day from the one it is bought on.
     */
    expect(bookingNextStep({ ...course, money: 'paid' }).stage).toBe('fulfillment');
  });

  it('is finished once it has been handed over', () => {
    expect(
      bookingNextStep({
        ...course,
        money: 'paid',
        booking: { status: 'confirmed', meeting_status: 'held' },
      }).stage
    ).toBe('done');
  });

  it('is never asked to mark a meeting it does not have', () => {
    expect(bookingNextStep(course).actions).not.toContain('mark_held');
  });
});

describe('a direct-price service that IS booked', () => {
  /** ייעוץ אישי: a meeting, then an invoice. */
  const consult: NextStepInput = {
    booking: { status: 'confirmed', meeting_status: null },
    startTime: PAST,
    isUnscheduled: false,
    isQuoted: false,
    proposalStatus: null,
    money: 'needs_invoice',
    now: NOW,
  };

  it('shares the meeting states with the quoted journey', () => {
    // One rule for "has the meeting happened", not two — the same three
    // answers a quoted consultation gets.
    expect(bookingNextStep(consult)).toMatchObject({
      stage: 'session',
      whoseMove: 'owner',
      actions: ['mark_held', 'mark_no_show', 'reschedule'],
    });
  });

  it('goes to the money once held, never to a quote', () => {
    const step = bookingNextStep({
      ...consult,
      booking: { status: 'confirmed', meeting_status: 'held' },
    });

    expect(step).toMatchObject({ stage: 'payment', whoseMove: 'owner', actions: ['send_invoice'] });
    expect(step.stage).not.toBe('proposal');
  });

  it('a free booked meeting ends when it is held', () => {
    // פגישת היכרות: held, nothing owed, nothing more to do.
    expect(
      bookingNextStep({
        ...consult,
        booking: { status: 'confirmed', meeting_status: 'held' },
        money: 'nothing_to_collect',
      }).stage
    ).toBe('done');
  });
});

describe('every state the banner can show', () => {
  /*
   * ── THE SAME HOLE AS THE ACTIONS, ONE LEVEL UP ────────────────────────────
   *
   * The card renders a state twice: a short BADGE above, and the full sentence
   * as the prompt beneath. The badge reads `crm.next.badge.<state>` and falls
   * back to `crm.<labelKey>` where no short form exists — deliberately, for the
   * states the banner never shows, whose wording is already a statement of
   * fact.
   *
   * An OWNER state with no short form is not that case. It renders the same
   * instruction twice, stacked: "למסור ללקוח ולסמן שסופק" as the badge and
   * again directly below it. Nothing throws and no test fails, which is how
   * `deliver` shipped that way.
   */
  const src = readFileSync(join(__dirname, '..', 'bookingNextStep.ts'), 'utf-8');

  const LABEL_KEYS = [...new Set([...src.matchAll(/labelKey:\s*'next\.([a-z_]+)'/g)].map(m => m[1]))];

  /* Steps the owner has to act on — the ones that reach the banner. */
  const OWNER_STATES = (() => {
    const found = new Set<string>();
    const forward = /whoseMove:\s*'owner'[\s\S]{0,200}?labelKey:\s*'next\.([a-z_]+)'/g;
    const backward = /labelKey:\s*'next\.([a-z_]+)'[\s\S]{0,200}?whoseMove:\s*'owner'/g;
    for (const re of [forward, backward]) {
      let m;
      while ((m = re.exec(src))) found.add(m[1]);
    }
    return [...found];
  })();

  const dict = (lang: string) =>
    readFileSync(join(__dirname, '..', 'translations', `${lang}.ts`), 'utf-8');

  it('found the real states', () => {
    expect(LABEL_KEYS.length).toBeGreaterThanOrEqual(12);
    expect(OWNER_STATES.length).toBeGreaterThanOrEqual(10);
    expect(OWNER_STATES).toContain('deliver');
    expect(OWNER_STATES).toContain('plan_stopped_undelivered');
  });

  it('every state has its sentence in every language', () => {
    for (const lang of ['he', 'en', 'es']) {
      const text = dict(lang);
      for (const key of LABEL_KEYS) {
        expect(`${lang}:${key}:${text.includes(`'crm.next.${key}'`)}`).toBe(`${lang}:${key}:true`);
      }
    }
  });

  it('every OWNER state has a short badge, so the banner cannot say it twice', () => {
    for (const lang of ['he', 'en', 'es']) {
      const text = dict(lang);
      for (const state of OWNER_STATES) {
        expect(`${lang}:${state}:${text.includes(`'crm.next.badge.${state}'`)}`).toBe(
          `${lang}:${state}:true`
        );
      }
    }
  });
});

describe('a plan stopped before the service was handed over', () => {
  /*
   * Stopping the billing does not say what happens to the work, and the data
   * cannot tell the two endings apart: an owner who kept part of the money may
   * still mean to deliver, or may have ended the engagement.
   *
   * It used to presume the first. `moneyState` reports a cancelled period as
   * settled — correctly, nothing more will be collected — so a stopped plan
   * arrived as `'paid'` and the only button offered was "mark as provided":
   * recording a delivery that never happened, which then counts as fulfilled
   * revenue everywhere downstream.
   */
  const product: NextStepInput = {
    booking: { id: 'b1', status: 'confirmed', meeting_status: null } as never,
    startTime: null,
    isUnscheduled: true,
    isQuoted: false,
    proposalStatus: null,
    money: 'paid',
  };

  it('offers both endings instead of presuming delivery', () => {
    const step = bookingNextStep({ ...product, planStopped: true });

    expect(step.labelKey).toBe('next.plan_stopped_undelivered');
    expect(step.actions).toEqual(['mark_delivered', 'cancel_booking']);
    expect(step.whoseMove).toBe('owner');
  });

  it('leaves a plan that simply finished alone', () => {
    const step = bookingNextStep({ ...product, planStopped: false });

    expect(step.labelKey).toBe('next.deliver');
    expect(step.actions).toEqual(['mark_delivered']);
  });

  it('says nothing once the service has been handed over', () => {
    const step = bookingNextStep({
      ...product,
      planStopped: true,
      booking: { id: 'b1', status: 'confirmed', meeting_status: 'held' } as never,
    });

    expect(step.stage).toBe('done');
    expect(step.actions).toEqual([]);
  });

  it('still asks for the money first when a period is actually owed', () => {
    /* A stop that left something billable is a billing question, not an
       ending: the owner has not finished deciding anything yet. */
    const step = bookingNextStep({
      ...product,
      planStopped: true,
      money: 'plan_needs_billing',
    });

    expect(step.labelKey).toBe('next.bill_next_stage');
  });
});
