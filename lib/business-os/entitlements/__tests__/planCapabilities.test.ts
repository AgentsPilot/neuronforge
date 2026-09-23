/**
 * Plan → capabilities (FR-6 / RC-6).
 *
 * The mapping itself is already covered by `chatActionMap.invariant.test.ts`
 * against the live chat catalog. What this suite is about is the *plan* half:
 * that a fan-out asks for two capabilities, that a read is recorded under both
 * readings, and that an unclassified step becomes a visible gap rather than a
 * silent skip.
 */

import { capabilitiesForPlan } from '@/lib/business-os/entitlements/planCapabilities';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';

const plan = (steps: unknown[]) => ({ steps } as unknown as Pick<Plan, 'steps'>);

describe('reads are recorded under both readings (Q-B1)', () => {
  it('emits one request per reading, and they disagree', () => {
    const { requests } = capabilitiesForPlan(plan([{ id: 's1', op: 'find', entity: 'contacts' }]));

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.rule).sort()).toEqual(['domain_group', 'read_only_plans_need_search']);
    // `domain_group` says a contacts look-up is CRM; the other says it is search.
    // That disagreement is the decision the shadow data has to settle.
    expect(requests.find((r) => r.rule === 'domain_group')?.capability).toBe('crm.core');
    expect(requests.find((r) => r.rule === 'read_only_plans_need_search')?.capability).toBe('chat.search');
  });

  it('tags everything else `both`, so a reading total is rule IN (reading, both)', () => {
    const { requests } = capabilitiesForPlan(
      plan([
        { id: 's1', op: 'compute', entity: 'invoices' },
        { id: 's2', op: 'mutate', entity: 'contacts', action: 'update' },
        { id: 's3', op: 'analyse' },
      ])
    );

    expect(requests.every((r) => r.rule === 'both')).toBe(true);
    expect(requests.map((r) => r.capability)).toEqual(['chat.reporting', 'crm.core', 'chat.reporting']);
  });
});

describe('surfaces', () => {
  it('separates reads, writes and AI, because grace treats them differently', () => {
    const { requests } = capabilitiesForPlan(
      plan([
        { id: 's1', op: 'find', entity: 'contacts' },
        { id: 's2', op: 'mutate', entity: 'contacts', action: 'update' },
        { id: 's3', op: 'analyse' },
      ])
    );

    expect(requests.find((r) => r.step === 's1')?.surface).toBe('owner_read');
    expect(requests.find((r) => r.step === 's2')?.surface).toBe('owner_write');
    expect(requests.find((r) => r.step === 's3')?.surface).toBe('owner_ai');
  });
});

describe('fan-out asks for two things', () => {
  it('the bulk capability AND the action being fanned out', () => {
    const { requests } = capabilitiesForPlan(
      plan([
        { id: 's1', op: 'find', entity: 'contacts' },
        { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'send', max: 40 },
      ])
    );

    const fanout = requests.filter((r) => r.step === 's2');
    expect(fanout.map((r) => r.capability).sort()).toEqual(['chat.bulk', 'chat.email']);
    // The count is the planner's CAP, not rows processed — which is what a
    // ceiling has to be set against, and is why the field says `planned`.
    expect(fanout.every((r) => r.plannedItems === 40)).toBe(true);
  });

  it('tags a fanned-out LOOK-UP with the reading that produced it (QA A-1)', () => {
    // A `for_each` whose action is a look-up is reading-dependent like any
    // other look-up. Tagging it `both` let the replay count it under a reading
    // that had not produced it — the same class of double-count R4-1 fixed on
    // the other side.
    const { requests } = capabilitiesForPlan(
      plan([{ id: 's1', op: 'for_each', over: 's0', entity: 'contacts', action: 'find', max: 10 }])
    );

    // The bulk capability is genuinely reading-independent.
    expect(requests.find((r) => r.capability === 'chat.bulk')?.rule).toBe('both');

    const inner = requests.filter((r) => r.capability !== 'chat.bulk');
    expect(inner.map((r) => r.rule).sort()).toEqual(['domain_group', 'read_only_plans_need_search']);
    expect(inner.map((r) => r.capability).sort()).toEqual(['chat.search', 'crm.core']);
  });

  it('still tags a fanned-out WRITE as `both`', () => {
    // The control: `both` must keep meaning "the readings agree", not "we
    // stopped checking".
    const { requests } = capabilitiesForPlan(
      plan([{ id: 's1', op: 'for_each', over: 's0', entity: 'contacts', action: 'send', max: 10 }])
    );
    expect(requests.every((r) => r.rule === 'both')).toBe(true);
  });

  it('counts one when the plan sets no cap', () => {
    const { requests } = capabilitiesForPlan(
      plan([{ id: 's1', op: 'for_each', over: 's0', entity: 'contacts', action: 'send' }])
    );
    expect(requests.every((r) => r.plannedItems === 1)).toBe(true);
  });
});

describe('what is NOT a capability request', () => {
  it('an unmapped entity is a gap, logged as a defect rather than skipped', () => {
    const { requests, gaps } = capabilitiesForPlan(plan([{ id: 's1', op: 'find', entity: 'unicorns' }]));

    expect(requests).toEqual([]);
    expect(gaps).toEqual([{ step: 's1', entity: 'unicorns', op: 'find', reason: 'unmapped_entity' }]);
  });

  it('reports an unmapped read ONCE, not once per reading', () => {
    const { gaps } = capabilitiesForPlan(plan([{ id: 's1', op: 'find', entity: 'unicorns' }]));
    expect(gaps).toHaveLength(1);
  });

  it('an agent-platform entity grants nothing, and is visible as a gap (B-8)', () => {
    // `agents` and `agent_runs` left the chat catalog on main (2026-09-23), so
    // they are no longer classified at all. The rule B-8 protects still holds
    // and is what this asserts: an agent-platform step produces NO capability
    // request, so no Business OS plan can gate it.
    //
    // It is now an `unmapped_entity` gap rather than an `ungated` one. That is
    // the right signal: if chat ever offers the agent platform again, the gap
    // is loud (FR-8 treats it as a defect) until someone classifies it, and
    // `chatActionMap.invariant.test.ts` fails at the same time.
    const { requests, gaps } = capabilitiesForPlan(plan([{ id: 's1', op: 'find', entity: 'agents' }]));

    expect(requests).toEqual([]);
    expect(gaps[0]).toMatchObject({ entity: 'agents', reason: 'unmapped_entity' });
  });

  it('an action override wins over the entity default', () => {
    // Writing to a client is email, not CRM — and the shadow data has to reflect
    // that, or the report will attribute sends to the wrong capability.
    const { requests } = capabilitiesForPlan(
      plan([{ id: 's1', op: 'mutate', entity: 'contacts', action: 'send' }])
    );
    expect(requests[0].capability).toBe('chat.email');
  });
});

describe('step ids', () => {
  it('falls back to a positional id when the plan omits one', () => {
    const { requests } = capabilitiesForPlan(plan([{ op: 'analyse' }]));
    expect(requests[0].step).toBe('s1');
  });
});
