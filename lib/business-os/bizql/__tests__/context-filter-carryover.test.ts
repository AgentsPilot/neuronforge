/**
 * Which filters survive into the next turn, and which must not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE USER.
 *
 *   "do I have a customer named Yael?"  -> I found 0 customer(s) named Yael.
 *                                          (contacts, first_name=yael, stage=Customer)
 *   "find a contact"                    -> Please give me more details.
 *   "yael"                              -> You have 0 customer named Yael.
 *                                          (contacts, first_name=yael, stage=Customer)
 *
 * The second attempt says nothing about customers. It was filtered by stage
 * anyway, and reported another confident zero, because the remembered-rows block
 * ended with "copy the where VERBATIM ... never drop a filter" — stated
 * absolutely, so it beat its own qualifier about follow-ups WITH NO SUBJECT OF
 * THEIR OWN. Nothing on screen said a filter the user never asked for was still
 * applied.
 *
 * Carrying filters into a real follow-up is still right — "and their total"
 * means THOSE rows, and dropping the filter there produced its own family of
 * wrong answers. And a third case sits between them: "who is the client" after a
 * total is neither a fresh request nor a repeat of the aggregate, but the same
 * rows seen from another angle.
 *
 * So these tests pin all four readings at once, because every one of them was
 * getting the same instruction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderContextForPrompt } from '../memory/ConversationMemory';
import type { ConversationContext } from '../memory/ConversationMemory';

const at = '2026-09-24T10:00:00.000Z';

/** The turn that found no customers called Yael. */
const customerSearch: ConversationContext = {
  turns: [{ utterance: 'do I have a customer named Yael?', summary: 'find contacts', at }],
  lastPlan: {
    steps: [
      {
        id: 's1',
        op: 'find',
        entity: 'contacts',
        where: [
          { field: 'first_name', op: 'eq', value: 'yael' },
          { field: 'stage', op: 'eq', value: 'Customer' },
        ],
      },
    ],
    at,
  } as ConversationContext['lastPlan'],
};

describe('a genuine follow-up', () => {
  it('is still handed the previous filters to copy', () => {
    const rendered = renderContextForPrompt(customerSearch);

    expect(rendered).toContain('Your last answer was about these rows');
    expect(rendered).toContain('"value":"Customer"');
    expect(rendered).toMatch(/copy the entity and the where VERBATIM/i);
  });
});

describe('a request the user is completing for us', () => {
  const midClarification = renderContextForPrompt({
    ...customerSearch,
    pendingQuestion: 'Please provide more details to identify the contact you want to find.',
  });

  it('is told NOT to copy the previous filters into it', () => {
    /*
     * The reported bug. Mid-clarification the message answers a question about a
     * DIFFERENT request ("find a contact"), so the previous answer's where is
     * not part of it.
     */
    expect(midClarification).toMatch(/do NOT copy this entity or these filters/i);
    expect(midClarification).not.toMatch(/copy the entity and the where VERBATIM/i);
  });

  it('still SHOWS them, so a reference back can still be resolved', () => {
    /*
     * The opposite failure, one scenario over: "who is the client" -> "which
     * client?" -> "the client with that booking". Deleting the rows outright
     * would throw away the only record of what "that" refers to.
     */
    expect(midClarification).toContain('Your last answer was about these rows');
    expect(midClarification).toContain('"value":"Customer"');
    expect(midClarification).toMatch(/resolve a reference back/i);
  });

  it('still says the message is the answer to what we asked', () => {
    // Suppressing the rows must not cost the clarification its own instruction,
    // or "yael" goes back to being read as a brand new request.
    const rendered = renderContextForPrompt({
      ...customerSearch,
      pendingQuestion: 'Which contact?',
    });

    expect(rendered).toContain('You asked the user: "Which contact?"');
    expect(rendered).toMatch(/almost certainly the ANSWER/i);
  });
});

describe('a new request that picks its own rows', () => {
  it('is told in as many words to carry nothing', () => {
    /*
     * The qualifier was there — "a follow-up with no subject of its own" — and
     * was ignored, because the rule that followed it was absolute. The
     * counter-case now gets its own sentence rather than being implied.
     */
    const rendered = renderContextForPrompt(customerSearch);

    expect(rendered).toMatch(/supplies its OWN way of picking rows/i);
    expect(rendered).toMatch(/carry NOTHING from the rows above/i);
  });

  it('separates naming a noun from identifying rows', () => {
    /*
     * The distinction the whole rule turns on, and the reason it is spelled out
     * rather than left to judgement: "yael" picks rows, "the client" does not.
     * Stated as "names its own subject" it would have sent "who is the client"
     * off to start a fresh contacts lookup — which is the OTHER reported bug.
     */
    const rendered = renderContextForPrompt(customerSearch);

    expect(rendered).toMatch(/Mentioning an entity is not picking rows/i);
  });
});

describe('a question about the figure just given', () => {
  /*
   * REPORTED BY THE USER.
   *
   *   "what is my revenue"  -> Your revenue is $1,000.00.
   *   "who is the client"   -> Please provide more details to identify the client.
   *
   * An ungrouped aggregate identifies no rows, so there was nothing to point at
   * and "the client" was read as a fresh contacts lookup with no name in it. But
   * the rows were never lost: the entity and the where that produced the $1,000
   * are printed directly above.
   */
  const revenue: ConversationContext = {
    turns: [{ utterance: 'what is my revenue', summary: 'compute payments', at }],
    lastPlan: {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'payments',
          agg: { fn: 'sum', field: 'amount_net' },
          where: [{ field: 'status', op: 'eq', value: 'succeeded' }],
        },
      ],
      at,
    } as ConversationContext['lastPlan'],
  };

  it('is answered by re-running the same filter as a find', () => {
    const rendered = renderContextForPrompt(revenue);

    expect(rendered).toContain('"entity":"payments"');
    expect(rendered).toMatch(/change the operation from compute to find/i);
    expect(rendered).toMatch(/Do not start a fresh lookup/i);
  });
});

describe('a figure quoted back from the last answer', () => {
  /*
   * REPORTED BY THE USER, and the worse half of the pair — this one does not
   * fail, it answers.
   *
   *   "what is my revenue"                       -> $1,000.00
   *   "which booking we have the $1000 revenue?" -> bookings: 0
   *                                                 (list bookings where amount is 1000)
   *
   * $1,000 is a total over payments. No single booking need hold that figure,
   * and none did. The user was naming the previous answer by its number; it was
   * read as data.
   */
  const withFigure: ConversationContext = {
    turns: [{ utterance: 'what is my revenue', summary: 'compute payments', at }],
    lastAnswer: 'Your revenue is $1,000.00 and refunds total $0.00.',
    lastPlan: {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'payments',
          agg: { fn: 'sum', field: 'amount_net' },
          where: [{ field: 'status', op: 'eq', value: 'succeeded' }],
        },
      ],
      at,
    } as ConversationContext['lastPlan'],
  };

  it('is named as a reference, never as a filter value', () => {
    const rendered = renderContextForPrompt(withFigure);

    expect(rendered).toContain('Your revenue is $1,000.00');
    expect(rendered).toMatch(/none of them is a value stored on any single row/i);
    expect(rendered).toMatch(/Never put a figure from your own answer into a where clause/i);
  });

  it('says nothing when the answer carried no figure', () => {
    // A sentence with no number in it cannot be quoted back as one, so the rule
    // would be noise on every turn that pays for it.
    const rendered = renderContextForPrompt({
      ...withFigure,
      lastAnswer: 'No payments match that.',
    });

    expect(rendered).not.toMatch(/Never put a figure from your own answer/i);
  });
});

describe('with nothing remembered', () => {
  it('says nothing about rows at all', () => {
    const rendered = renderContextForPrompt({ turns: [] });

    expect(rendered).not.toContain('Your last answer was about these rows');
  });
});
