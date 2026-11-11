/**
 * The card must say WHO is handling a problem, and must not claim coverage
 * there is none.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WORK HAS TWO HALVES, AND THE CARD HAD THREE OPINIONS ABOUT IT
 *
 * A standing chaser sends on the owner's milestone days; an agent takes the
 * tail once those are spent. The catalogue says so — the agent declares
 * `worksAlongside: 'chase_invoices'` — and the detectors respect it, offering
 * the agent only once `chaserCanStillReach` is false.
 *
 * The CARD did not. It made three separate statements about that one body of
 * work, each from a different fact and none of them complete:
 *
 *   · the projection column   — agent INSTALLED, named nothing
 *   · the green strip         — named the agent only
 *   · `nextStep`              — read the chaser's switch, named nothing
 *
 * So an owner could not tell which automation was handling their money, and a
 * card could carry "I'm already handling these" directly above "nothing is set
 * to chase these automatically".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND ONE OF THEM WAS WRONG
 *
 * `sendInvoiceChase` opens by reading `chase_invoices_enabled` and FAILS
 * CLOSED. An agent installed with that switch off therefore sends nothing at
 * all — while the card showed a green tick and "<agent> is already handling
 * this". The most reassuring element on the card marked the one state in which
 * nothing was happening.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD = strip(read('components/business-os/insight/InsightAdvisorCard.tsx'));
const AUTOMATIONS = strip(read('lib/business-os/gaps/automations.ts'));

describe('coverage is read from BOTH halves', () => {
  it('the chaser is found through the process it covers', () => {
    /* `OPERATIONAL_AUTOMATIONS` already carries it, joined on the same
       `paired_process_id` the agent is found by. Nothing new is fetched. */
    expect(CARD).toMatch(/automation\.coversProcess === insight\.paired_process_id/);
  });

  it('and its switch is read, not merely whether the agent is installed', () => {
    expect(CARD).toMatch(/const chaserOn = Boolean\(/);
    expect(CARD).toMatch(/\?\.enabled/);
  });
});

describe('sharing a subject is not the same as gating', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CORRECTION, 2026-11-10.
   *
   * `sendingBlocked` was `agentAlreadyWorking && coveringOperational &&
   * !chaserOn` — covering the same process taken to mean gating it. Wrong in
   * two of the three cases that exist, and the card said so out loud: it told
   * an owner "קביעת הפגישה הבאה cannot send while this is off" on the same
   * screen as the list showing that agent had run, worked, and was due again
   * on the 15th.
   *
   *   gates      `chase_invoices` — `sendInvoiceChase` reads the column first
   *              and fails closed, so the agent really is stopped.
   *   inverse    `remind_about_meeting` — the agent stands down while the
   *              chaser is ON, to avoid two reminders for one booking.
   *   unrelated  `reply_to_enquiries` — `lead_autosend_enabled` is read
   *              nowhere a message goes out.
   *
   * Declared on the automation, because inferring it is what got it wrong.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('the relationship is declared, not inferred from coversProcess', () => {
    expect(AUTOMATIONS).toMatch(/pairedAgentRelation\?: 'gates';/);
  });

  it('and exactly one automation claims it', () => {
    const claims = AUTOMATIONS.match(/pairedAgentRelation: 'gates'/g) ?? [];
    expect(claims).toHaveLength(1);

    /* And it is the invoice chaser, because that is the one whose column a
       sender actually reads. */
    const at = AUTOMATIONS.indexOf("pairedAgentRelation: 'gates'");
    const entry = AUTOMATIONS.slice(AUTOMATIONS.lastIndexOf('id:', at), at);
    expect(entry).toContain("'chase_invoices'");
  });

  it('the card blocks only on that relationship', () => {
    expect(CARD).toMatch(
      /const sendingBlocked = Boolean\(\s*agentAlreadyWorking && coveringOperational\?\.pairedAgentRelation === 'gates' && !chaserOn/
    );
  });

  it('and draws a rail only where there is a real sequence', () => {
    /* Two automations that merely touch the same records are not a chain, and
       a line between them invites an order the owner would read as real. */
    expect(CARD).toMatch(
      /const chaserInChain = coveringOperational\?\.pairedAgentRelation === 'gates'/
    );
    expect(CARD).toMatch(/if \(chaserName && chaserInChain\)/);
  });

  it('the sender it models still fails closed, which is why any of this holds', () => {
    const dispatch = strip(read('lib/services/InsightActionDispatchService.ts'));
    const fn = dispatch.slice(dispatch.indexOf('export async function sendInvoiceChase('));
    expect(fn.slice(0, 1800)).toMatch(/chase_invoices_enabled/);
    expect(fn.slice(0, 1800)).toMatch(/skipped: true/);
  });
});

describe('the card quotes the list rather than describing it', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A RECEIPT, NOT A PROMISE.
   *
   * Two earlier attempts wrote SENTENCES about coverage — first one line
   * naming both automations, then a role label beside each name. Both were
   * descriptions, and an owner reading one had no way to tell a claim from a
   * fact. Which mattered, because one of the claims was false.
   *
   * The agent's own row from `/api/business-os/automation-agents` carries what
   * it found, what it handled and when it runs next — the same facts the list
   * below the carousel renders. Quoting them means the two surfaces cannot
   * disagree, because there is only one fact.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('the host passes the rows, and the card finds this agent among them', () => {
    expect(CARD).toMatch(/installedAgents\?: InstalledAgentRow\[\]/);
    expect(CARD).toMatch(
      /installedAgents\?\.find\(row => row\.automationId === offeredAgent\.id\)/
    );
  });

  it('the dashboard keeps them instead of reducing to ids', () => {
    /* It fetched this response already and threw everything but the ids
       away, which is why the card had nothing to quote. */
    const dash = strip(read('components/business-os/insight/LiveDashboard.tsx'));
    expect(dash).toMatch(/setInstalledAgents\(rows\)/);
    expect(dash).toMatch(/installedAgents=\{installedAgents\}/);
  });

  it('what it found and what it handled come from the run, not from us', () => {
    expect(CARD).toMatch(/const outcome = agentRow\?\.lastOutcome/);
    expect(CARD).toMatch(/insight\.chain\.found/);
    expect(CARD).toMatch(/insight\.chain\.handled/);
  });

  it('and an agent with nothing behind it claims nothing', () => {
    /* `state !== 'never'` and a non-null `found`: an agent that has not run
       has nothing to prove, and inventing a line for it is how the card got
       into this in the first place. */
    expect(CARD).toMatch(/outcome\.state !== 'never' && outcome\.found !== null/);
    expect(CARD).toMatch(/receipt: parts\.length > 0 \? parts\.join\(' · '\) : null/);
  });

  it('a blocked agent reports zero sent, not the number it handled', () => {
    /* It still FINDS all four invoices. Reporting them as handled is the
       green-tick bug in another costume. */
    expect(CARD).toMatch(/insight\.chain\.sent_to/);
    expect(CARD).toMatch(/String\(sendingBlocked \? 0 : outcome\.actedOn\)/);
  });
});

describe('the chain is drawn with the bookings drawer vocabulary', () => {
  it('a node per step, on a rail', () => {
    expect(CARD).toMatch(/const chainSteps: ChainStep\[\] = \[\]/);
    expect(CARD).toMatch(/width: '18px'/);
    expect(CARD).toMatch(/width: '2px'/);
  });

  it('a dashed empty ring for a step that has not happened', () => {
    /* The one piece of vocabulary this reuses rather than invents: an owner
       who has opened a booking already reads a dashed ring as "not yet". */
    expect(CARD).toMatch(/step\.state === 'idle' \? 'dashed' : 'solid'/);
    expect(CARD).toMatch(/step\.state === 'idle'\s*\?\s*'transparent'/);
  });

  it('the rail is not drawn under a single node', () => {
    expect(CARD).toMatch(/chainSteps\.length > 1 && \(/);
  });

  it('the icon says which KIND, which is the real question', () => {
    expect(CARD).toMatch(/step\.kind === 'agent' \? \(\s*<Bot/);
    expect(CARD).toMatch(/\) : \(\s*<Clock/);
  });

  it('and the chain is what the projection column shows', () => {
    expect(CARD).toMatch(/value: coverageNode/);
  });
});

describe('the fix is offered where the break is', () => {
  /*
   * An insight card cannot switch a chaser on: `operationalItem` is only set
   * once `currentIndex` passes the insights, because the automations are their
   * own pages appended after them. So the owner was shown a card saying
   * nothing was being sent, with no control on it that could change that.
   */
  it('the card can reach the page that owns the switch', () => {
    expect(CARD).toMatch(/const jumpToChaser = \(\(\) => \{/);
    expect(CARD).toMatch(/return at < 0 \? null : insights\.length \+ at/);
  });

  it('it navigates rather than writing, so one place still owns that column', () => {
    const btn = CARD.slice(CARD.indexOf("step.kind === 'agent' && sendingBlocked"));
    const upToClose = btn.slice(0, btn.indexOf('</button>'));
    expect(upToClose).toMatch(/onIndexChange\(jumpToChaser\)/);
    expect(upToClose).not.toMatch(/fetch\(/);
    expect(upToClose).not.toMatch(/onOperationalDecide/);
  });

  it('and is not drawn when the carousel does not carry that page', () => {
    expect(CARD).toMatch(/jumpToChaser !== null/);
  });
});

describe('one question, one answer', () => {
  it('nextStep no longer repeats the column', () => {
    /* It answered the same question from different facts, which is how the
       card came to contradict itself. */
    expect(CARD).toMatch(/if \(agentAlreadyWorking\) return null;/);
  });

  it('the install offer still keys off INSTALLED, not off consent', () => {
    /* Consent being off is not a reason to offer an install the owner has
       already made. The two tests are deliberately separate. */
    expect(CARD).toMatch(
      /const agentAlreadyWorking = Boolean\(\s*offeredAgent && installedAutomationIds\?\.includes\(offeredAgent\.id\)/
    );
  });

  it('and the green strip stops being green when nothing is sending', () => {
    /* A tick and a green panel are the strongest "handled" signal on the card.
       Leaving them on while the consent is off is worse than saying nothing. */
    expect(CARD).toMatch(/sendingBlocked \? 'rgba\(234,179,8/);
    expect(CARD).toMatch(/sendingBlocked \? \(\s*<AlertTriangle/);
  });
});

describe('a handled card has one ending, not two', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "לא עכשיו" WHEN THE ACTION HAS ALREADY BEEN TAKEN.
   *
   * With an agent on the job the card offered two ways to close, and they
   * were not equal:
   *
   *   הבנתי     `handleAgentCovers` → `markAutomated` → status 'automated'.
   *             Closes it and records WHY: an automation has this.
   *   לא עכשיו  `handleDismiss` → status 'dismissed'. Closes the same card
   *             and records that it did not matter, about a problem that is
   *             still open, with an agent working on it.
   *
   * There is no "later" on that card: the insight does not come back either
   * way. So the label promised a deferral it could not deliver, and the
   * cheaper-looking button carried the worse record.
   *
   * `dismissed` is also what the platform learns from about what to stop
   * showing, so an owner closing a handled card the obvious way would teach
   * it to hide the cards their agents are proving useful on.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('the secondary is not rendered once an agent has the job', () => {
    expect(CARD).toMatch(/\{!agentAlreadyWorking && \(\s*<button\s+onClick=\{operationalItem \? \(\) => handleDecide\(false\) : handleDismiss\}/);
  });

  it('and the primary is the ending that records the truth', () => {
    /* `markAutomated`, not a dismissal wearing a calmer label. */
    const route = strip(read('app/api/business-os/automation-agents/route.ts'));
    const ack = route.slice(route.indexOf('if (validated.acknowledgeOnly)'));
    expect(ack.slice(0, 1600)).toMatch(/markAutomated\(/);
    expect(CARD).toMatch(/\? handleAgentCovers/);
  });

  it('the decline survives everywhere it is still a real choice', () => {
    /* An offer the owner has not taken, and an automation page where it is
       reversible. Removing it there would take away the only "no". */
    expect(CARD).toMatch(/insight\.action\.secondary/);
    expect(CARD).toMatch(/automation\.decline/);
  });
});

describe('the copy exists in every language', () => {
  const KEYS = [
    'insight.chain.chaser_sends',
    'insight.chain.chaser_never',
    'insight.chain.found',
    'insight.chain.handled',
    'insight.chain.sent_to',
    'insight.chain.next_run',
    'insight.chain.waiting',
    'insight.chain.blocked_by',
    'insight.chain.turn_on',
    'insight.covered_but_off',
    'insight.covered_but_off_fix',
    /* Still reachable: the aside for an agent with no receipt and no next
       run, which is a real state and would otherwise render a bare name. */
    'insight.projection.agent_on_it',
  ];

  for (const lang of ['en', 'he', 'es']) {
    it(lang, () => {
      const dict = read(`lib/business-os/translations/${lang}.ts`);
      for (const key of KEYS) {
        expect(`${lang}:${key}:${dict.includes(`'${key}':`)}`).toBe(`${lang}:${key}:true`);
      }
    });
  }

  it('and the sentences the chain replaced are gone from every dictionary', () => {
    /*
     * Three one-line phrasings and five role labels, from the two attempts
     * before this one. Left behind they would be dead weight the next reader
     * has to decide about, and their names read as if the card still spoke
     * that way.
     */
    const RETIRED = [
      'insight.projection.both_on',
      'insight.projection.chaser_only',
      'insight.projection.nothing_sending',
      'insight.coverage.role_first',
      'insight.coverage.role_then',
      'insight.coverage.role_alone',
      'insight.coverage.role_off',
      'insight.coverage.role_blocked',
    ];
    for (const lang of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${lang}.ts`);
      for (const key of RETIRED) {
        expect(`${lang}:${key}:${dict.includes(`'${key}':`)}`).toBe(`${lang}:${key}:false`);
      }
    }
  });
});
