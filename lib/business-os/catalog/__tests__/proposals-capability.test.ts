/**
 * Quotes, as the chat sees them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE WORTH PINNING
 *
 * A quote is not an invoice and must never be counted as one — an unaccepted
 * offer is not revenue and not a debt. The catalog is the only place that
 * distinction is expressed to the planner, so the tests below hold the parts of
 * it that would fail SILENTLY if they rotted: a semantic term that quietly
 * matches nothing returns zero, and zero looks exactly like an honest answer to
 * "how much is out in quotes".
 *
 * They run with no database and no model.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG, resolveSemanticTerm } from '../index';

const proposals = CATALOG.entities.proposals;

describe('the quotes entity', () => {
  it('is exposed and readable', () => {
    expect(proposals).toBeDefined();
    expect(proposals.queryable).not.toBe(false);
  });

  it('is scoped to the owner, like everything else', () => {
    // The service-role client bypasses RLS, so this is the tenant boundary.
    expect(proposals.userScope).toEqual({ kind: 'column', column: 'user_id' });
  });

  it('says what it is, in words a business owner uses', () => {
    // The meaning sentence is what makes "how much is out in quotes" pick this
    // entity rather than invoices — the closest wrong answer.
    expect(proposals.meaning).toMatch(/quote/i);
    expect(proposals.meaning?.toLowerCase()).toContain('before anyone owes');
  });

  it('answers to the words people actually say', () => {
    const vocabulary = [
      ...Object.values(proposals.labels.one),
      ...Object.values(proposals.labels.many),
      ...(proposals.aliases ?? []),
    ].map((w) => w.toLowerCase());

    for (const word of ['quotes', 'proposals', 'estimates', 'הצעות', 'presupuestos']) {
      expect(vocabulary).toContain(word);
    }
  });
});

describe('the two status rules', () => {
  /*
   * Kept on evidence: removing them and re-running the same twenty Hebrew
   * questions scored 12/18 against 14/18 with them. See the catalog note.
   */
  it('open covers everything still live, including a draft', () => {
    expect(resolveSemanticTerm('proposals', 'status', 'open')).toEqual([
      'draft',
      'sent',
      'viewed',
    ]);
  });

  it('awaiting_reply covers only what is with the CLIENT', () => {
    const awaiting = resolveSemanticTerm('proposals', 'status', 'awaiting_reply');

    expect(awaiting).toEqual(['sent', 'viewed']);
    // A draft is with the owner. "Who hasn't answered me" must not count them.
    expect(awaiting).not.toContain('draft');
  });

  it('declares every status the database allows', () => {
    expect(proposals.fields.status.enumValues).toEqual([
      'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded',
    ]);
  });

  it('labels each one, which is what the planner now matches on', () => {
    // Rendered into the prompt as `accepted=אושרה`, so a Hebrew question meets
    // a value instead of being translated onto one.
    for (const value of proposals.fields.status.enumValues ?? []) {
      expect(proposals.fields.status.enumLabels?.[value]?.en).toBeTruthy();
      expect(proposals.fields.status.enumLabels?.[value]?.he).toBeTruthy();
    }
  });
});

describe('why clients say no', () => {
  it('is a closed list, so the question has a real answer', () => {
    // Chosen from five options on the accept page rather than typed, which is
    // what makes "why do people say no" answerable by a group-by instead of a
    // folder of free text.
    expect(proposals.fields.decline_reason.enumValues).toEqual([
      'too_expensive', 'timing', 'scope', 'chose_other', 'other',
    ]);
  });

  it('is labelled in every language the chat speaks', () => {
    for (const value of proposals.fields.decline_reason.enumValues ?? []) {
      const labels = proposals.fields.decline_reason.enumLabels?.[value];
      expect([labels?.en, labels?.he, labels?.es].every(Boolean)).toBe(true);
    }
  });
});

describe('what a quote is connected to', () => {
  it('reaches the client, the service and the request it answers', () => {
    expect(proposals.relations?.contact?.target).toBe('contacts');
    expect(proposals.relations?.service?.target).toBe('services');
    expect(proposals.relations?.booking?.target).toBe('bookings');
  });

  it('reaches what acceptance PRODUCED', () => {
    // "Which quotes turned into money" is one hop, not a guess.
    expect(proposals.relations?.invoice?.target).toBe('invoices');
    expect(proposals.relations?.plan?.target).toBe('plans');
    expect(proposals.relations?.milestones?.target).toBe('installments');
  });
});

describe('what the chat may do with one', () => {
  it('drafts, sends and withdraws — three separate decisions', () => {
    // `create_and_send` is the fourth: drafting and sending in one decision,
    // for the common case where the owner has already decided to quote.
    expect(Object.keys(proposals.actions ?? {}).sort()).toEqual([
      'create',
      'create_and_send',
      'send',
      'withdraw',
    ]);
  });

  it('confirms every one of them before anything happens', () => {
    // A price leaving the building, and a price being retracted, both deserve
    // the moment where the owner reads back what they dictated.
    for (const action of Object.values(proposals.actions ?? {})) {
      expect(action.requiresConfirmation).toBe(true);
    }
  });

  it('never sends in bulk', () => {
    // Quotes are individually priced by definition. A fan-out here would mean
    // one number mailed to a list of people it was not written for.
    for (const action of Object.values(proposals.actions ?? {})) {
      expect(action.allowBulk ?? false).toBe(false);
    }
  });

  it('asks for the three things a quote cannot exist without', () => {
    expect(proposals.actions?.create.requiredFields).toEqual(['contact_id', 'title', 'total']);
  });

  it('never asks for the three the handler settles itself', () => {
    // Status, currency and payment shape. Asking would turn one dictated
    // sentence into three questions.
    expect(proposals.actions?.create.handlerSupplies).toEqual(['status', 'currency', 'payment_shape']);
  });

  it('only offers fields that can actually be written', () => {
    const create = proposals.actions!.create;

    for (const key of [...(create.requiredFields ?? []), ...(create.optionalFields ?? [])]) {
      expect(proposals.fields[key]?.writable).toBe(true);
    }
  });
});

describe('milestones', () => {
  const installments = CATALOG.entities.installments;

  it('are visible as a kind of instalment, not a table of their own', () => {
    expect(installments.fields.trigger.enumValues).toEqual(['date', 'manual']);
    expect(installments.fields.label).toBeDefined();
    expect(installments.fields.completed_at).toBeDefined();
  });

  it('carry the word "milestone" in the label rather than in a semantic term', () => {
    /*
     * Deliberate: a term mapping `milestone -> manual` would be a synonym with
     * extra steps. Saying what the value MEANS lets the model map the word
     * itself, and it reads correctly on a result card too.
     */
    expect(installments.fields.trigger.enumLabels?.manual?.en).toMatch(/milestone/i);
    expect(installments.fields.trigger.semanticTerms).toBeUndefined();
  });

  it('point back at the quote they were split out of', () => {
    expect(installments.relations?.proposal?.target).toBe('proposals');
  });
});

describe('the quote events in the activity log', () => {
  it('are declared, so "what happened this week" includes them', () => {
    // Written by the send service and by the client's own accept page. An
    // undeclared value is invisible to every filter and returns zero.
    const types = CATALOG.entities.activities.fields.activity_type.enumValues ?? [];

    for (const event of ['proposal_sent', 'proposal_accepted', 'proposal_declined']) {
      expect(types).toContain(event);
    }
  });
});
