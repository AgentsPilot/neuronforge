/**
 * What the chat may do to a quote, and what it must ask for first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A quote is a price leaving the building. The guards that matter are the ones
 * BEFORE anything happens: the fields it refuses to invent, the confirmation it
 * insists on, and the preview the owner reads back.
 *
 * Every case here is a dry run, which stops before the handler — so these touch
 * no database and send no email, while still exercising the real writable-field
 * mapping, the real grounding check and the real preview text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { executeMutate, requiresConfirmation } from '../mutate/MutateExecutor';
import { validatePlan } from '../planner/validatePlan';
import { MissingFieldsError, type MutateQuery } from '../types';

const CTX = { userId: '11111111-1111-1111-1111-111111111111', consumer: 'test' as const };

const draft = (data: Record<string, unknown>): MutateQuery =>
  ({ op: 'mutate', entity: 'proposals', action: 'create', data }) as MutateQuery;

describe('drafting a quote', () => {
  it('asks for the price rather than inventing one', async () => {
    // The one number that cannot be guessed. A quote with a made-up total is
    // the worst possible output of this feature.
    await expect(
      executeMutate(draft({ contact_id: 'c1', title: 'Kitchen refit' }), CTX, {
        dryRun: true,
        utterance: 'draft a quote for the kitchen refit',
      })
    ).rejects.toBeInstanceOf(MissingFieldsError);
  });

  it('asks what the quote is FOR', async () => {
    await expect(
      executeMutate(draft({ contact_id: 'c1', total: 12000 }), CTX, {
        dryRun: true,
        utterance: 'draft a quote for 12000',
      })
    ).rejects.toBeInstanceOf(MissingFieldsError);
  });

  it('refuses a title the user never said', async () => {
    /*
     * The grounding check, which is what stops a model naming a job something
     * plausible. "Kitchen refit" appears nowhere in the request, so it is the
     * model's invention and the executor asks instead.
     */
    await expect(
      executeMutate(draft({ contact_id: 'c1', title: 'Kitchen refit', total: 12000 }), CTX, {
        dryRun: true,
        utterance: 'send David a quote for 12000',
      })
    ).rejects.toBeInstanceOf(MissingFieldsError);
  });

  it('refuses to write a column nobody marked writable', async () => {
    // `status` is the handler's to set: a quote that starts life as `accepted`
    // would be money agreed by nobody.
    await expect(
      executeMutate(
        draft({ contact_id: 'c1', title: 'Kitchen refit', total: 12000, status: 'accepted' }),
        CTX,
        { dryRun: true, utterance: 'draft a kitchen refit quote for 12000' }
      )
    ).rejects.toThrow(/status/);
  });
});

describe('what needs approving', () => {
  it('all three actions do', async () => {
    // Drafting is included on purpose. A draft is one tap from being sent, and
    // the owner should see the number before it exists at all.
    for (const action of ['create', 'send', 'withdraw']) {
      expect(
        requiresConfirmation({ op: 'mutate', entity: 'proposals', action } as MutateQuery)
      ).toBe(true);
    }
  });
});

describe('sending and withdrawing', () => {
  it('both need to be pointed at a specific quote', () => {
    /*
     * "Send the quote" with nothing to identify it must ask, not pick.
     *
     * Asserted at the PLAN layer, which is where the guard lives: a mutate with
     * no target never reaches the executor, and checking it further down would
     * be testing a lock on a door the plan validator already refuses to open.
     */
    for (const action of ['send', 'withdraw']) {
      const problems = validatePlan(
        { steps: [{ id: 's1', op: 'mutate', entity: 'proposals', action }] } as never,
        'send the quote'
      );

      expect(problems.some((p) => /needs a target/.test(p))).toBe(true);
    }
  });

  it('and a described row must be resolved before anything runs', async () => {
    /*
     * The second lock. `target.find` is how the planner says "the kitchen
     * quote"; the server resolves it to exactly one row and shows the user
     * WHICH before they approve. Reaching the executor unresolved would mean
     * acting on a row nobody was shown.
     */
    await expect(
      executeMutate(
        {
          op: 'mutate',
          entity: 'proposals',
          action: 'send',
          target: { find: { where: [{ field: 'title', op: 'eq', value: 'Kitchen refit' }] } },
        } as MutateQuery,
        CTX
      )
    ).rejects.toThrow(/unresolved target/i);
  });

  it('describe themselves before anything happens', async () => {
    const result = await executeMutate(
      { op: 'mutate', entity: 'proposals', action: 'send', target: { id: 'p1' } } as MutateQuery,
      CTX,
      { dryRun: true, language: 'en', targetName: 'Kitchen refit' }
    );

    expect(result.applied).toBe(false);
    expect(result.preview).toContain('Kitchen refit');
  });
});

/**
 * The nudge, and the one thing it must not be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `send` and `remind` both put a quote in front of a client, and that is where
 * the resemblance ends. `send` CLAIMS the quote out of draft: it retires the
 * version it replaces, freezes the terms and attaches the document. Called on a
 * quote the client already has, `sendProposal` answers `alreadySent` and does
 * nothing — so an automation built on it would chase nobody while reporting
 * success, which is the exact failure this work keeps turning up.
 *
 * `remind` is the other act: same quote, same price, same link, a short note
 * asking whether they need more time. The handler is two lines, so what is
 * worth guarding is that those two lines call the RIGHT service and that a
 * refusal from it travels back as a failure rather than a cheerful no-op.
 *
 * `ProposalSendService` is mocked, so nothing is read and no email leaves —
 * these are about the wiring, and the live account proved the refusal path for
 * real (a withdrawn quote came back `already_answered`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/services/ProposalSendService', () => ({
  sendQuoteReminder: jest.fn(),
  sendProposal: jest.fn(),
}));

describe('nudging a quote', () => {
  const QUOTE = '22222222-2222-2222-2222-222222222222';

  const nudge = () =>
    executeMutate(
      { op: 'mutate', entity: 'proposals', action: 'remind', target: { id: QUOTE } } as MutateQuery,
      CTX
    );

  beforeEach(() => jest.clearAllMocks());

  it('asks the reminder service, not the sender', async () => {
    /* The whole point of the action existing. A `remind` that reached
       `sendProposal` would retire the version the client is reading. */
    const svc = require('@/lib/services/ProposalSendService');
    svc.sendQuoteReminder.mockResolvedValue({ ok: true });

    const result = await nudge();

    expect(svc.sendQuoteReminder).toHaveBeenCalledWith(QUOTE, CTX.userId);
    expect(svc.sendProposal).not.toHaveBeenCalled();
    expect(result.applied).toBe(true);
  });

  it('reports a refusal as a failure', async () => {
    /*
     * `already_answered` is what a quote accepted between the agent's find and
     * its send comes back with. Swallowed, the run would report a nudge that
     * never happened — and the owner was told their quotes were being chased.
     */
    const svc = require('@/lib/services/ProposalSendService');
    svc.sendQuoteReminder.mockResolvedValue({ ok: false, reason: 'already_answered' });

    await expect(nudge()).rejects.toThrow(/already_answered/);
  });

  it('needs a specific quote, never a described set', async () => {
    /* One row per call, so a fan-out stays the scatter's business and inherits
       its cap rather than hiding inside one write. */
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'proposals', action: 'remind' } as MutateQuery,
        CTX
      )
    ).rejects.toThrow(/target id/);
  });
});
