/**
 * Teaching the receptionist to send did not change what it refuses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A COMMENT.
 *
 * The receptionist is the one agent in this repo that reads a real mailbox and
 * writes to a real client's timeline, and until 2026-11-13 its value was
 * entirely in what it REFUSED to do: it could send nothing at all. On that day
 * it gained a fifth outcome, `send_link`, and with it the first ability to
 * reach a client without the owner pressing send.
 *
 * Two properties make that safe, and this file pins both.
 *
 * FIRST, the other four cannot be reached by it. The three branches below are
 * equality checks on 'draft', 'needs_owner' and 'already_handled', so a new
 * enum value cannot satisfy them. The obvious tidy-up — a not-equals, a
 * default branch, an `in` list — would quietly route messages somewhere new.
 *
 * SECOND, the send cannot carry words. It takes a door from a closed list and
 * the sentence comes from a table. A `message` param appearing on that step is
 * the moment "send a door, never an answer" stops being true, and it would
 * look like a small convenience in a diff.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

type Step = Record<string, unknown>;

/**
 * BOTH VARIANTS, because they are one job on two mailboxes.
 *
 * They are separate files and they drift: the send branch was added to Gmail
 * on 2026-11-13 and Outlook went a day without it, so an owner on Outlook got
 * the old behaviour while one on Gmail got doors. A test that reads one file
 * would have said everything was fine.
 *
 * Where they legitimately differ — Gmail excludes handled threads by label,
 * Outlook has no labels in its plan — the assertion is scoped to the variant
 * that has the mechanism, and says why.
 */
const VARIANTS = ['draftClientReplies', 'draftClientRepliesOutlook'] as const;
type Variant = (typeof VARIANTS)[number];

const PLANS: Record<Variant, Step[]> = Object.fromEntries(
  VARIANTS.map(name => {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'agents', `${name}.steps.json`), 'utf-8')
    ) as Step[] | { steps: Step[] };
    return [name, Array.isArray(parsed) ? parsed : (parsed.steps as Step[])];
  })
) as Record<Variant, Step[]>;

/** Defaults to Gmail so the single-variant assertions below read unchanged. */
function allSteps(variant: Variant = 'draftClientReplies'): Step[] {
  return PLANS[variant];
}

/** The branch steps that live inside the scatter's "nothing is waiting" gate. */
function decisionSteps(variant: Variant = 'draftClientReplies'): Step[] {
  const scatter = allSteps(variant).find(s => s.type === 'scatter_gather') as Step;
  const inner = (scatter.scatter as { steps: Step[] }).steps;
  const gate = inner.find(s => s.type === 'conditional') as Step;
  const seven = (gate.steps as Step[]).find(s => s.id === 'step7c') as Step;
  return seven.steps as Step[];
}

const byId = (variant: Variant = 'draftClientReplies') =>
  Object.fromEntries(decisionSteps(variant).map(s => [s.id as string, s]));

describe('the receptionist keeps its four answers, and its fifth sends only a door', () => {
  it('offers exactly five outcomes, with the original four first and unchanged', () => {
    const step8 = byId().step8;
    const schema = step8.output_schema as {
      properties: { outcome: { enum: string[] } };
    };

    expect(schema.properties.outcome.enum).toEqual([
      'draft',
      'needs_owner',
      'ignore',
      'already_handled',
      'send_link',
    ]);
  });

  /*
   * The load-bearing assertion. Each branch must test EQUALITY against its own
   * value: that is what makes a new outcome unable to reach it.
   */
  it.each([
    ['step9', 'draft'],
    ['step12', 'needs_owner'],
    ['step14', 'already_handled'],
    ['step12r', 'send_link'],
  ])('%s fires only on "%s", by equality', (stepId, value) => {
    const condition = byId()[stepId].condition as Record<string, unknown>;

    expect(condition.field).toBe('decision.outcome');
    expect(condition.operator).toBe('equals');
    expect(condition.value).toBe(value);
  });

  it('a link outcome never reaches the owner-escalation branch', () => {
    /*
     * Stated as the behaviour rather than the shape: whatever the conditions
     * become, `send_link` must not satisfy the one that raises a card.
     */
    const owner = byId().step12.condition as { operator: string; value: string };
    const sendMatchesOwnerBranch =
      owner.operator === 'equals' && owner.value === 'send_link';

    expect(sendMatchesOwnerBranch).toBe(false);
  });

  it('the only thing it can send is a door, and the door list is closed', () => {
    /*
     * THE LOAD-BEARING ASSERTION OF THE WHOLE SEND DESIGN.
     *
     * `send_portal_door_contacts` takes a door from a closed list and the words
     * come from a table in `portal-door.ts`. If a `message`, `body` or `subject`
     * param ever appears here, the model is writing to a client and "send a
     * door, never an answer" has quietly stopped being true.
     */
    const send = (byId().step12r.steps as Step[])[0];
    const params = send.params as { data: Record<string, unknown> };

    expect(send.action).toBe('send_portal_door_contacts');
    expect(Object.keys(params.data).sort()).toEqual(['contact_id', 'door', 'thread_id']);
    for (const forbidden of ['message', 'body', 'subject', 'html', 'text']) {
      expect(params.data).not.toHaveProperty(forbidden);
    }
  });

  it('the doors are exactly the self-service pages that exist', () => {
    const schema = byId().step8.output_schema as {
      properties: { door: { enum: string[] } };
    };

    expect(schema.properties.door.enum).toEqual([
      'book',
      'reschedule',
      'cancel',
      'pay',
      'intake',
      'quote',
      'refund',
    ]);
  });

  it('an answered thread is not labelled "Needs you"', () => {
    /* That label means the owner must look, which is what this outcome
       avoids. Using it would move the interruption into their mailbox. */
    const label = (byId().step12r.steps as Step[])[1];
    const params = label.params as { add_labels: string[] };

    expect(params.add_labels).toEqual(['AgentPilot/Handled']);
    expect(params.add_labels).not.toContain('AgentPilot/Needs you');
  });

  it.each(VARIANTS)('%s: offers the same five outcomes and the same seven doors', variant => {
    /*
     * The drift check. Gmail and Outlook are one job, and an owner should not
     * get a different agent because of which mailbox they use.
     */
    const schema = byId(variant).step8.output_schema as {
      properties: { outcome: { enum: string[] }; door: { enum: string[] } };
    };

    expect(schema.properties.outcome.enum).toEqual([
      'draft',
      'needs_owner',
      'ignore',
      'already_handled',
      'send_link',
    ]);
    expect(schema.properties.door.enum).toEqual([
      'book',
      'reschedule',
      'cancel',
      'pay',
      'intake',
      'quote',
      'refund',
    ]);
  });

  it.each(VARIANTS)('%s: sends a door and nothing else', variant => {
    const send = (byId(variant).step12r.steps as Step[])[0];
    const params = send.params as { data: Record<string, unknown> };

    expect(send.action).toBe('send_portal_door_contacts');
    expect(Object.keys(params.data).sort()).toEqual(['contact_id', 'door', 'thread_id']);
    for (const forbidden of ['message', 'body', 'subject', 'html', 'text']) {
      expect(params.data).not.toHaveProperty(forbidden);
    }
  });

  it.each(VARIANTS)('%s: the draft guard is scoped to the conversation', variant => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE BUG THIS PINS, MEASURED 2026-11-15.
     *
     * `step7c` stops a message dead when a draft is already waiting, and it
     * asked about the PERSON: "any draft to this client in two days". One
     * unrelated draft therefore silenced that client completely — their next
     * message was read, marked read, and dropped with no classification, no
     * label and no row. A client asking "why did you charge me" vanished that
     * way.
     *
     * Harmless when the only outcome was another draft. Not harmless now: the
     * thing dropped is a client who would have been answered automatically.
     * ─────────────────────────────────────────────────────────────────────
     */
    const gate = (() => {
      const scatter = allSteps(variant).find(s => s.type === 'scatter_gather') as Step;
      const inner = (scatter.scatter as { steps: Step[] }).steps;
      const conditional = inner.find(s => s.type === 'conditional') as Step;
      return Object.fromEntries((conditional.steps as Step[]).map(s => [s.id as string, s]));
    })();

    const params = gate.step7b.params as Record<string, string>;
    const asksAboutTheSubject =
      (params.query ?? '').includes('{{current_reply.subject}}') ||
      params.subject_prefix === '{{current_reply.subject}}';

    expect(asksAboutTheSubject).toBe(true);
    /* And still about this person: both halves, or it would hold a draft to
       somebody else who happens to share a subject line. */
    expect(JSON.stringify(params)).toContain('{{current_reply.from_email}}');
  });

  it('the scan skips both handled labels, so nothing is classified twice', () => {
    /* Gmail only: Outlook's plan has no labels, and its scan is bounded by
       `within_days` instead. Its dedupe is the action's own per-thread check,
       which is why it needs no marking step. */
    const step1 = allSteps().find(s => s.id === 'step1') as Step;
    const query = (step1.params as { query: string }).query;

    expect(query).toContain('-label:"AgentPilot/Needs you"');
    expect(query).toContain('-label:"AgentPilot/Handled"');
    /* Only ever REMOVES messages. A positive label filter here would make the
       agent read nothing at all. */
    expect(query).not.toMatch(/(^|\s)label:"AgentPilot/);
  });

  it.each(VARIANTS)('%s: the doors are listed BEFORE needs_owner', variant => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * ORDER IS THE FIX. Measured twice on 2026-11-15.
     *
     * The prompt said "BUT READ THE DOORS FIRST" inside `needs_owner` — and
     * the doors were still listed FOURTH, after it. A client wrote the words
     * "מבקשת החזר כספי" ("requesting a refund"), with `send_link` and the
     * refund door both available, and the agent escalated anyway: it matched
     * the first rule that fit, and `needs_owner` came first.
     *
     * Telling a reader to look ahead is not the same as putting the thing in
     * front of them. This asserts position, because position is what moved
     * the behaviour.
     * ─────────────────────────────────────────────────────────────────────
     */
    const prompt = byId(variant).step8.prompt as string;

    const doors = prompt.indexOf("'send_link'");
    const owner = prompt.indexOf("'needs_owner' — a question");

    expect(doors).toBeGreaterThan(-1);
    expect(owner).toBeGreaterThan(-1);
    expect(doors).toBeLessThan(owner);

    /* And the reader is told the list is ordered, so the position means
       something rather than being incidental. */
    expect(prompt).toContain('Read these in order');
  });

  it.each(VARIANTS)('%s: not knowing the answer sends a door, it does not escalate', variant => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE RULE COLLISION THIS PINS, MEASURED 2026-11-15.
     *
     * `needs_owner` read "choose this when answering would need any fact you
     * were NOT given above". For a refund that is ALWAYS true — you never
     * know the policy or what was decided — so it swallowed `send_link`
     * every time and the door could not win.
     *
     * The model wrote, in its own reason, "the client is asking for a
     * refund", and escalated anyway because it did not know the policy. It
     * was obeying the rules it was given.
     *
     * Both halves now say the same thing from their own side, and the doors
     * are read first. Reinstating the old unqualified sentence puts every
     * refund back on the owner's card.
     * ─────────────────────────────────────────────────────────────────────
     */
    const prompt = byId(variant).step8.prompt as string;

    /* The door is explicitly the outcome for NOT knowing. */
    expect(prompt).toContain('SENDING A DOOR IS NOT ANSWERING');
    expect(prompt).toContain('reasons to send a door');

    /* And `needs_owner` defers to the doors rather than claiming everything. */
    expect(prompt).toContain('BUT READ THE DOORS FIRST');
    expect(prompt).toContain('no door fits');

    /* The sentence that caused it must not come back. */
    expect(prompt).not.toContain('Choose this when answering would need any fact you were NOT given');

    /* A client questioning a charge is a refund, whatever words they use. */
    expect(prompt).toContain('They do not have to use the word refund');
    expect(prompt).not.toContain('Complaining is not a refund');
  });

  it('refunds and availability are no longer owner work, in the prompt', () => {
    /*
     * The prompt sent them there explicitly ("complaints; disputes; refunds;
     * discounts"). Leaving that line while adding the new outcome would have
     * given the model two valid answers for one message.
     */
    const prompt = byId().step8.prompt as string;

    expect(prompt).toContain("'send_link'");
    /* Availability is a door, never a sentence: a time the model names may be
       gone by the time the client reads it. */
    expect(prompt).toContain('NEVER state availability yourself');
    expect(prompt).not.toContain('disputes; refunds; discounts');
    /* And ambiguity still falls to the older, safer path. */
    expect(prompt).toContain("choose 'needs_owner'");
  });
});
