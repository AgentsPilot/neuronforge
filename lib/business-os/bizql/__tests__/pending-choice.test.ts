/**
 * Reading "which one?" — the other judgment call in an otherwise deterministic
 * path.
 *
 * A parked choice is mechanical once a row is named: pin it, carry on. The whole
 * decision is turning free text into ONE of the rows on screen, and it is made
 * against words the user chose, so it is exactly where a careless matcher acts
 * on the wrong person's record.
 *
 * The rule the whole file pins: never pick when the reply could mean two of
 * them. A wrong pick here is a write, and there is no undo anywhere in this
 * stack.
 */

import {
  getPendingChoiceStore,
  readChoiceReply,
  shouldGiveUp,
  type ChoiceCandidate,
} from '../mutate/PendingChoiceStore';
import { isCancelMessage } from '../mutate/PendingFillStore';
import type { MutateQuery } from '../types';

/** The one session row `command_sessions` would hold for this user. */
let session: Record<string, unknown> | null = null;

jest.mock('@/lib/repositories/CommandSessionRepository', () => ({
  commandSessionRepository: {
    create: jest.fn(async (userId: string, capabilityId: string, params: unknown) => {
      session = {
        id: 'session-1',
        user_id: userId,
        capability_id: capabilityId,
        status: 'gathering_params',
        resolved_params: params,
      };
      return { data: session, error: null };
    }),
    update: jest.fn(async (_id: string, _userId: string, patch: Record<string, unknown>) => {
      if (session) Object.assign(session, patch);
      return { data: session, error: null };
    }),
    getActiveSession: jest.fn(async () => ({ data: session, error: null })),
    terminate: jest.fn(async () => {
      session = null;
      return { data: null, error: null };
    }),
  },
}));

const candidates = (...labels: string[]): ChoiceCandidate[] =>
  labels.map((label, i) => ({ id: `id-${i + 1}`, label, index: i + 1 }));

const THREE = candidates('David Cohen', 'David Levy', 'Sarah Kaplan');

describe('reading a choice of row', () => {
  describe('by number', () => {
    it.each([
      ['2', 'id-2'],
      ['#2', 'id-2'],
      ['2.', 'id-2'],
      ['1', 'id-1'],
      ['3', 'id-3'],
    ])('%p picks %p', (message, id) => {
      expect(readChoiceReply(message, THREE)).toEqual({ kind: 'pick', id });
    });

    it('refuses a number past the end of the list', () => {
      // Someone reading "7" off a different list is not choosing from this one.
      expect(readChoiceReply('7', THREE)).toEqual({ kind: 'none' });
      expect(readChoiceReply('0', THREE)).toEqual({ kind: 'none' });
    });
  });

  describe('by ordinal word', () => {
    it.each([
      ['first', 'id-1'],
      ['the first', 'id-1'],
      ['the first one', 'id-1'],
      ['1st', 'id-1'],
      ['second', 'id-2'],
      ['the second one', 'id-2'],
      ['third', 'id-3'],
      ['last', 'id-3'],
      ['הראשון', 'id-1'],
      ['השני', 'id-2'],
      ['השנייה', 'id-2'],
      ['השלישי', 'id-3'],
      ['האחרון', 'id-3'],
      ['el primero', 'id-1'],
      ['segundo', 'id-2'],
      ['el último', 'id-3'],
    ])('%p picks %p', (message, id) => {
      expect(readChoiceReply(message, THREE)).toEqual({ kind: 'pick', id });
    });

    it('refuses an ordinal past the end of the list', () => {
      expect(readChoiceReply('fifth', THREE)).toEqual({ kind: 'none' });
    });
  });

  describe('by label', () => {
    it('picks on an exact label', () => {
      expect(readChoiceReply('Sarah Kaplan', THREE)).toEqual({ kind: 'pick', id: 'id-3' });
    });

    it('picks on part of a label', () => {
      expect(readChoiceReply('kaplan', THREE)).toEqual({ kind: 'pick', id: 'id-3' });
    });

    it('picks when the user typed more than the label', () => {
      expect(readChoiceReply('Sarah Kaplan please', candidates('Sarah Kaplan'))).toEqual({
        kind: 'pick',
        id: 'id-1',
      });
    });

    it('refuses when the reply matches more than one candidate', () => {
      /*
       * THE RULE THE WHOLE FILE EXISTS FOR.
       *
       * "David" is exactly the ambiguity being resolved. Picking the first of
       * two Davids here would re-introduce, at the last possible moment, the
       * guess that three layers of this stack refuse to make.
       */
      expect(readChoiceReply('David', THREE)).toEqual({ kind: 'none' });
    });

    it('refuses a reply that matches nothing on the list', () => {
      expect(readChoiceReply('the one from Tuesday', THREE)).toEqual({ kind: 'none' });
    });

    it('drops one leading Hebrew particle when what remains still matches', () => {
      // "לדויד" is "to David"; the record holds "דויד כהן".
      const he = candidates('דויד כהן', 'שרה קפלן');
      expect(readChoiceReply('לדויד', he)).toEqual({ kind: 'pick', id: 'id-1' });
    });

    it('does NOT bridge scripts', () => {
      /*
       * Asking in English for a contact stored as "דויד כהן" finds nothing, and
       * that is correct rather than a gap: bridging would mean deciding that
       * "David" and "דויד" are the same person, which is a guess at identity —
       * the one thing worth asking about.
       */
      const he = candidates('דויד כהן', 'שרה קפלן');
      expect(readChoiceReply('David', he)).toEqual({ kind: 'none' });
    });
  });

  describe('rule order', () => {
    it('reads an ordinal as a position, not as a label', () => {
      // A candidate literally called "Second" must not shadow position 2.
      const tricky = candidates('Acme Ltd', 'Second Chance Ltd', 'Third Rail Ltd');
      expect(readChoiceReply('second', tricky)).toEqual({ kind: 'pick', id: 'id-2' });
      // And on a list where "Second Chance" is FIRST, the word still means
      // position 2 — the number is what the user can see.
      const reversed = candidates('Second Chance Ltd', 'Acme Ltd');
      expect(readChoiceReply('second', reversed)).toEqual({ kind: 'pick', id: 'id-2' });
    });

    it('reads a digit as a position, not as a label', () => {
      const numbered = candidates('INV-00001', 'INV-00002');
      expect(readChoiceReply('2', numbered)).toEqual({ kind: 'pick', id: 'id-2' });
    });
  });

  describe('cancelling', () => {
    /*
     * Cancellation is the caller's job, using the fill's whole-message matcher —
     * and it has to be checked BEFORE the label rules, or a candidate whose name
     * begins with a negation eats it. These pin both halves of that contract.
     */
    it('recognises a bare cancel', () => {
      expect(isCancelMessage('cancel')).toBe(true);
      expect(isCancelMessage('ביטול')).toBe(true);
    });

    it('does not read a candidate label as a cancellation', () => {
      expect(isCancelMessage('cancel the Tuesday booking')).toBe(false);
      expect(isCancelMessage('לא לשכוח להתקשר')).toBe(false);
    });
  });

  describe('empty input', () => {
    it('is not a pick', () => {
      expect(readChoiceReply('   ', THREE)).toEqual({ kind: 'none' });
      expect(readChoiceReply('2', [])).toEqual({ kind: 'none' });
    });
  });
});

describe('parking the write while the question is open', () => {
  const USER = '11111111-1111-1111-1111-111111111111';
  const store = getPendingChoiceStore();

  const step = {
    id: 's1',
    op: 'mutate',
    entity: 'bookings',
    action: 'cancel',
    target: { find: { where: [{ field: 'contact_name', op: 'eq', value: 'David' }] } },
  } as MutateQuery;

  const park = (over: Partial<Parameters<typeof store.park>[0]> = {}) =>
    store.park({
      userId: USER,
      entity: 'bookings',
      kind: 'ambiguous',
      total: 2,
      candidates: THREE.slice(0, 2),
      slot: { kind: 'target', stepIndex: 0 },
      steps: [step],
      names: [{}],
      sources: [],
      utterance: "cancel David's booking",
      language: 'en',
      ...over,
    });

  beforeEach(() => {
    session = null;
  });

  it('parks and takes back the same frozen write', async () => {
    const parked = await park();
    const taken = await store.take(USER);

    expect(taken?.choiceId).toBe(parked.choiceId);
    expect(taken?.steps).toEqual([step]);
    expect(taken?.slot).toEqual({ kind: 'target', stepIndex: 0 });
    expect(taken?.candidates).toHaveLength(2);
    expect(taken?.attempts).toBe(0);
  });

  it('refuses to park a question with nothing to pick from', async () => {
    // A parked state the user cannot leave except by cancelling is worse than no
    // state at all — which is also why `kind: 'none'` is never parked.
    await expect(park({ candidates: [] })).rejects.toThrow(/no candidates/i);
  });

  it('is invisible to a take of the wrong kind', async () => {
    await park();
    // A confirmation's `take()` checks capability AND status for this reason: a
    // bare "yes" must never reach a write whose row is still undecided.
    expect(session?.capability_id).toBe('bizql.pending_choice');
    expect(session?.status).toBe('awaiting_choice');
  });

  it('drops a parked choice whose stored write was altered', async () => {
    await park();

    // Something mutated the plan between turns. The user picked from a list that
    // described a different write, so the pick must not be honoured.
    (session!.resolved_params as Record<string, unknown>).steps = [
      { ...step, action: 'delete' },
    ];

    expect(await store.take(USER)).toBeNull();
    // And it is cleared rather than left to be re-read.
    expect(session).toBeNull();
  });

  it('drops a parked choice whose candidate list was altered', async () => {
    await park();

    // The ids are fingerprinted too: swapping in a row the user never saw is the
    // same attack as rewriting the write itself.
    (session!.resolved_params as Record<string, unknown>).candidates = [
      { id: 'id-99', label: 'Someone Else', index: 1 },
    ];

    expect(await store.take(USER)).toBeNull();
  });

  it('carries the retry count across a re-ask', async () => {
    await park({ attempts: 1 });
    expect((await store.take(USER))?.attempts).toBe(1);
  });
});

describe('giving up on a choice', () => {
  /*
   * Re-ask once, then let go. Staying parked forever traps a user who changed
   * the subject; dropping out on the first unparsed reply discards the write the
   * whole mechanism exists to keep.
   */
  it('re-asks the first time', () => {
    expect(shouldGiveUp(0)).toBe(false);
  });

  it('gives up the second time', () => {
    expect(shouldGiveUp(1)).toBe(true);
    expect(shouldGiveUp(2)).toBe(true);
  });
});
