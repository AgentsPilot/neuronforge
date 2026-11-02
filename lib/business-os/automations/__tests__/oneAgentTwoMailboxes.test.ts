/**
 * Two plans, one agent: the provider variants may differ only where they must.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * Drafting replies to clients exists twice, because `pluginsRequired` is the
 * column the runtime grants a run from — one entry naming both mail plugins
 * would make an owner connect Gmail AND Outlook to run either. So the catalogue
 * holds two entries and the offer holds one.
 *
 * The cost of that is two files containing the same judgement. The Gmail and
 * Outlook plans differ only where Graph forces them to: a folder called
 * `sentitems` rather than `sent`, a window in days rather than a search term, a
 * draft made FROM a message rather than addressed with a thread id. Everything
 * ABOVE the plumbing — what the model is asked, what it may answer, what gets
 * written to the client's timeline — is meant to be identical.
 *
 * Nothing makes that true. Two copies of a prompt drift, and a drifted prompt
 * does not fail: it means one owner's agent escalates what another's answers,
 * with nothing to point at and no way to notice. The same goes for the activity
 * types, which are what the needs-you card reads — a twin writing
 * `reply_drafted` where the original writes `reply_draft` would simply never
 * reach the owner, silently, on one provider only.
 *
 * So the equivalence is asserted rather than hoped for. A deliberate divergence
 * means changing this file, which means saying why.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findByTag = jest.fn();
const create = jest.fn();
const activate = jest.fn().mockResolvedValue({ error: null });
const updatePilotSteps = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockResolvedValue({ error: null });

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findByTag: (...a: unknown[]) => findByTag(...a),
    create: (...a: unknown[]) => create(...a),
    activate: (...a: unknown[]) => activate(...a),
    updatePilotSteps: (...a: unknown[]) => updatePilotSteps(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { AUTOMATION_AGENTS } from '../catalog';
import { installAutomation } from '../install';

const PLANS = join(process.cwd(), 'lib/business-os/automations/agents');

type Step = Record<string, unknown>;

/** Every step in a plan, flattened through scatters and conditional branches. */
function allSteps(file: string): Step[] {
  const plan = JSON.parse(readFileSync(join(PLANS, file), 'utf-8')) as Step[];
  const out: Step[] = [];

  const walk = (steps: Step[]) => {
    for (const step of steps) {
      out.push(step);
      const scatter = step.scatter as Record<string, unknown> | undefined;
      if (scatter && Array.isArray(scatter.steps)) walk(scatter.steps as Step[]);
      for (const key of ['steps', 'then', 'then_steps', 'else', 'else_steps']) {
        if (Array.isArray(step[key])) walk(step[key] as Step[]);
      }
    }
  };

  walk(plan);
  return out;
}

const GMAIL = 'draftClientReplies.steps.json';
const OUTLOOK = 'draftClientRepliesOutlook.steps.json';

describe('the catalogue declares the pair', () => {
  it('holds both variants under one group, with one default', () => {
    const members = AUTOMATION_AGENTS.filter(a => a.variantGroup === 'draft_client_replies');

    expect(members.map(m => m.id).sort()).toEqual([
      'draft_client_replies',
      'draft_client_replies_outlook',
    ]);
    expect(members.filter(m => m.variantDefault).length).toBe(1);
    expect(members.map(m => m.variantPlugin).sort()).toEqual(['google-mail', 'outlook']);
  });

  it('names one mail plugin each, so either can run alone', () => {
    /*
     * The whole reason this is two entries. An entry naming both would demand
     * two connections for one agent, and `plugins_required` is granted whole.
     */
    for (const id of ['draft_client_replies', 'draft_client_replies_outlook']) {
      const entry = AUTOMATION_AGENTS.find(a => a.id === id)!;
      const mail = entry.pluginsRequired.filter(p => p !== 'business-os');

      expect(`${id} requires ${mail.length} mail plugin(s)`).toBe(`${id} requires 1 mail plugin(s)`);
      expect(mail[0]).toBe(entry.variantPlugin);
    }
  });

  it('describes them with the same words, because they do the same job', () => {
    /*
     * Shared keys rather than two translations, so no owner is shown a
     * distinction they do not have. Only one of the two is ever offered, which
     * is what makes one set of words correct for both.
     */
    const [a, b] = ['draft_client_replies', 'draft_client_replies_outlook'].map(
      id => AUTOMATION_AGENTS.find(x => x.id === id)!
    );

    expect(b.nameKey).toBe(a.nameKey);
    expect(b.descriptionKey).toBe(a.descriptionKey);
    expect(b.watchesKey).toBe(a.watchesKey);
  });

  it('holds the owner-facing choices equal, so neither mailbox is the better deal', () => {
    const [a, b] = ['draft_client_replies', 'draft_client_replies_outlook'].map(
      id => AUTOMATION_AGENTS.find(x => x.id === id)!
    );

    expect(b.cadenceChoices).toEqual(a.cadenceChoices);
    expect(b.defaultCron).toBe(a.defaultCron);
    expect(b.defaultStopAfterDays).toBe(a.defaultStopAfterDays);
    expect(b.stopAfterChoices).toEqual(a.stopAfterChoices);
    expect(b.offeredFromInsight).toBe(a.offeredFromInsight);
  });
});

describe('the two plans agree on everything but the plumbing', () => {
  it('asks the model exactly the same question', () => {
    /*
     * WORD FOR WORD. The judgement an agent makes about a client's message
     * cannot depend on which mail provider the owner happens to use.
     */
    const promptIn = (file: string) => {
      const ai = allSteps(file).filter(s => s.type === 'ai_processing');
      expect(ai.length).toBe(1);
      return ai[0].prompt as string;
    };

    const gmail = promptIn(GMAIL);

    /* Not vacuous: a real prompt, not an empty string matching an empty one. */
    expect(gmail.length).toBeGreaterThan(1000);
    expect(promptIn(OUTLOOK)).toBe(gmail);
  });

  it('offers the model the same four outcomes', () => {
    const outcomesIn = (file: string) => {
      const ai = allSteps(file).find(s => s.type === 'ai_processing') as Step;
      const schema = ai.output_schema as Record<string, Record<string, Step>>;
      return [...((schema.properties.outcome.enum as string[]) ?? [])].sort();
    };

    expect(outcomesIn(OUTLOOK)).toEqual(['already_handled', 'draft', 'ignore', 'needs_owner']);
    expect(outcomesIn(OUTLOOK)).toEqual(outcomesIn(GMAIL));
  });

  it('writes the same timeline entries, which is how the owner is told at all', () => {
    /*
     * These strings are read by the needs-you card: a drafted reply and an
     * escalation reach the owner ONLY through an activity of the right type, and
     * a closing one is what stops the card returning somebody. A typo in either
     * file loses the whole reporting half of the agent on one provider.
     */
    const typesIn = (file: string) =>
      allSteps(file)
        .filter(s => s.action === 'create_activities')
        .map(s => ((s.params as Step).data as Step).activity_type as string)
        .sort();

    expect(typesIn(GMAIL)).toEqual(['reply_drafted', 'reply_handled', 'reply_needs_owner']);
    expect(typesIn(OUTLOOK)).toEqual(typesIn(GMAIL));
  });

  it('has the same shape: the same step ids, doing the same kind of thing', () => {
    /*
     * Ids and types, not params. A step present in one plan and missing from
     * the other is a decision taken once — the boundary gate, the
     * already-drafted check, one of the three outcome branches — and that is
     * precisely the divergence worth failing on. The params are where the
     * providers are ALLOWED to differ.
     */
    const shapeOf = (file: string) =>
      allSteps(file)
        .map(s => `${s.step_id}:${s.type}`)
        .sort();

    expect(shapeOf(OUTLOOK)).toEqual(shapeOf(GMAIL));
  });

  it('never sends, on either provider', () => {
    /*
     * THE ONE PROMISE THE AGENT MAKES TO THE OWNER. Both plans draft; neither
     * may reach a client. Asserted on both because the actions are differently
     * named per provider, so a single rule covers neither.
     */
    for (const file of [GMAIL, OUTLOOK]) {
      const sends = allSteps(file)
        .map(s => s.action)
        .filter(a => a === 'send_email' || a === 'reply_to_email' || a === 'send_draft');

      expect(`${file} sends: ${sends.join(',')}`).toBe(`${file} sends: `);
    }
  });

  it('threads the draft it leaves, on both', () => {
    /*
     * The fix this pair shipped with. An unthreaded draft arrives beside the
     * conversation it answers and reads, to the client, as a stranger to the
     * thread they wrote in. Both providers reach the same place by opposite
     * routes, and `reply_to_message_id` is the parameter that asks for it on
     * either.
     */
    for (const file of [GMAIL, OUTLOOK]) {
      const drafts = allSteps(file).filter(s => s.action === 'create_draft');

      expect(`${file} drafts: ${drafts.length}`).toBe(`${file} drafts: 1`);
      expect((drafts[0].params as Step).reply_to_message_id).toBe('{{current_reply.id}}');
    }
  });
});

describe('an owner who tries to install both', () => {
  const GMAIL_AGENT = AUTOMATION_AGENTS.find(a => a.id === 'draft_client_replies')!;
  const OUTLOOK_AGENT = AUTOMATION_AGENTS.find(a => a.id === 'draft_client_replies_outlook')!;

  /* The tag each install is found again by. */
  const tagFor = (id: string) => `business-os-automation:${id}`;

  beforeEach(() => {
    findByTag.mockReset();
    create.mockReset();
    updatePilotSteps.mockClear();
    update.mockClear();
    activate.mockClear();
  });

  /** No install of anything, except the tags listed as already running. */
  const running = (ids: string[], row: Record<string, unknown> = {}) =>
    findByTag.mockImplementation((_user: string, tag: string) =>
      Promise.resolve({
        data: ids.map(tagFor).includes(tag)
          ? [{ id: `agent-for-${tag}`, status: 'active', agent_config: {}, ...row }]
          : [],
        error: null,
      })
    );

  it('gets the one already running, not a second indistinguishable row', async () => {
    /*
     * THE QUESTION THIS FILE'S SECOND HALF ANSWERS. Both entries share all
     * three translation keys, so two rows would appear in the owner's agent
     * list under the same name and the same description — and stopping "the
     * one that drafts replies" becomes guesswork.
     */
    running(['draft_client_replies']);

    const outcome = await installAutomation('owner-1', OUTLOOK_AGENT);

    expect(outcome).toEqual({
      ok: true,
      agentId: `agent-for-${tagFor('draft_client_replies')}`,
      alreadyInstalled: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('works in the other direction too', async () => {
    /* Order must not decide it: an owner running Outlook who asks for Gmail
       gets the Outlook one back, by the same rule. */
    running(['draft_client_replies_outlook']);

    const outcome = await installAutomation('owner-1', GMAIL_AGENT);

    expect(outcome).toMatchObject({ ok: true, alreadyInstalled: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('never writes the requested plan onto the other provider\'s agent', async () => {
    /*
     * THE DANGEROUS HALF, and the reason the lookup reports WHICH automation it
     * found. An install carries a copy of its plan and the install refreshes
     * that copy every time. Refreshing with the REQUESTED automation would put
     * the Outlook plan on the Gmail agent, which would then call `outlook`
     * actions holding a `google-mail` grant and fail inside a cron where
     * nobody is watching.
     */
    running(['draft_client_replies'], {
      agent_config: { business_os_automation: { id: 'draft_client_replies', planVersion: 'stale' } },
    });

    await installAutomation('owner-1', OUTLOOK_AGENT);

    expect(updatePilotSteps).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(updatePilotSteps.mock.calls[0][2]);

    /* The Gmail plan it already had, brought up to date — not the other one. */
    expect(written).toContain('"plugin":"google-mail"');
    expect(written).not.toContain('"plugin":"outlook"');
  });

  it('still installs the first one when neither is running', async () => {
    /* A guard on the guard: a rule that refused both would hide the agent
       entirely, which is the failure the available list was built to end. */
    running([]);
    create.mockResolvedValue({ data: { id: 'new-agent' }, error: null });

    const outcome = await installAutomation('owner-1', OUTLOOK_AGENT);

    expect(outcome).toMatchObject({ ok: true, agentId: 'new-agent', alreadyInstalled: false });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
