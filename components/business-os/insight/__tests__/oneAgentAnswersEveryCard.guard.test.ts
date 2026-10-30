/**
 * An agent is offered once, switched on once, and said so on every card that
 * would have offered it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE FAULTS THIS PINS, ALL FOUND ON A LIVE ACCOUNT IN ONE SITTING.
 *
 * 1. The card did not close. The install marks the insight `automated`
 *    server-side, but the dashboard holds the list the carousel renders, so
 *    the card the owner had just dealt with stayed on screen offering an agent
 *    that was already running.
 *
 * 2. The next card offered it again. `cash_ar_overdue` and
 *    `cash_revenue_at_risk` are DELIBERATELY separate cards — the overlap
 *    registry calls them "unpaid money at three altitudes" — and both reach
 *    `chase_overdue_invoices`. So switching the agent on from the ₪1,500 card
 *    left the ₪4,600 card still asking.
 *
 * 3. The refresh went through `onAutomate`, which posts the older `automate`
 *    action and writes an `insight_automations` row of its own. One press, two
 *    standing rules, which is the collision this codebase has documented three
 *    times.
 *
 * Asserted against the source because all three are WIRING: there is no wrong
 * value to catch, only a prop that stopped being passed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const card = readFileSync(
  join(root, 'components', 'business-os', 'insight', 'InsightAdvisorCard.tsx'),
  'utf-8'
);
const dashboard = readFileSync(
  join(root, 'components', 'business-os', 'insight', 'LiveDashboard.tsx'),
  'utf-8'
);

describe('installing an agent closes the card that offered it', () => {
  it('the dashboard re-reads its insights', () => {
    expect(dashboard).toMatch(/onAgentInstalled=\{refreshInsights\}/);
  });

  it('and the card calls it, after the install succeeded', () => {
    /* After, not before: a refusal must leave the card where it was. */
    const handler = card.slice(card.indexOf('const handleAutomate'));
    const refusal = handler.indexOf('if (!response.ok)');
    const refresh = handler.indexOf('onAgentInstalled?.()');

    expect(refusal).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(refusal);
  });

  it('without posting the older automate action, which writes a second rule', () => {
    /*
     * `onAutomate` is still used for insights we ship no agent for. What must
     * not happen is the AGENT path calling it: that would create an
     * `insight_automations` row alongside the agent.
     */
    const agentPath = card.slice(
      card.indexOf('if (offeredAgent) {'),
      card.indexOf('const done = await onAutomate')
    );

    expect(agentPath).not.toContain('onAutomate(');
  });
});

describe('a second card for the same job does not offer it again', () => {
  it('the dashboard reads what is installed', () => {
    expect(dashboard).toMatch(/installedAutomationIds=\{installedAutomationIds\}/);
    expect(dashboard).toContain("fetch('/api/business-os/automation-agents')");
  });

  it('and re-reads it when one is installed, so every card agrees', () => {
    expect(dashboard).toContain("'business-os:automation-installed'");
  });

  it('the card checks the offered agent against that list', () => {
    expect(card.replace(/\s+/g, ' ')).toContain(
      'const agentAlreadyWorking = Boolean( offeredAgent && installedAutomationIds?.includes(offeredAgent.id) )'
    );
  });

  it('says WHICH agent has it, by name', () => {
    /* "An automation is handling this" connects to nothing. The name is what
       ties this card to the row in the list below it. */
    expect(card).toContain("t('insight.covered_by')");
    expect(card).toContain('t(offeredAgent.nameKey)');
  });

  it('offers an ending instead of an offer, and it closes the card', () => {
    /*
     * The button stays pressable. A disabled green status left the card with
     * no way out but Dismiss, which records "this did not matter" against
     * something that did.
     */
    expect(card).toContain('? handleAgentCovers');
    expect(card).toContain("insight.action.got_it");
  });

  it('and that press touches no agent', () => {
    /*
     * `acknowledgeOnly`. Without it the press reaches `installAutomation`,
     * which treats a re-install of a PAUSED agent as the owner asking for it
     * back — so acknowledging a card would silently restart something they
     * deliberately stopped.
     */
    const handler = card.slice(card.indexOf('const handleAgentCovers'));
    expect(handler.slice(0, 900)).toContain('acknowledgeOnly: true');

    const route = readFileSync(
      join(root, 'app', 'api', 'business-os', 'automation-agents', 'route.ts'),
      'utf-8'
    );
    const ack = route.slice(
      route.indexOf('if (validated.acknowledgeOnly)'),
      route.indexOf('THE REQUIREMENT, ENFORCED HERE')
    );
    expect(ack).toContain('markAutomated');
    expect(ack).not.toContain('installAutomation(');
    /* And it refuses when the agent is not actually installed. */
    expect(ack).toContain('not_installed');
  });

  it('says it in every language', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = readFileSync(
        join(root, 'lib', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      for (const key of ['insight.action.got_it', 'insight.covered_by', 'insight.projection.agent_on_it']) {
        expect(`${lang}:${key}:${dict.includes(`'${key}'`)}`).toBe(`${lang}:${key}:true`);
      }
    }
  });
});
