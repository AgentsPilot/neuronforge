/**
 * AC-3 / FR-6 — every chat operation maps to exactly one capability.
 *
 * The key space is not written down here: it is READ FROM THE LIVE CHAT CATALOG
 * (and cross-checked against the plugin definition the planner is given). That
 * is the difference between a test that proves the mapping is complete and one
 * that proves it matches a list someone kept up to date.
 *
 * So adding an entity or an action to Business OS chat fails this test until it
 * is classified — which is the "a chat action is unmapped" invariant of FR-8.
 */

import { SEMANTIC_CATALOG } from '@/lib/business-os/catalog/catalog';
import businessOsPlugin from '@/lib/plugins/definitions/business-os-plugin-v2.json';
import {
  ACTION_OVERRIDES,
  ENTITY_DOMAIN,
  PLAN_OP_CAPABILITY,
  READ_RULE,
  capabilityForOp,
  capabilityForPlanOp,
  isUngated,
} from '@/lib/business-os/entitlements/config/chatActionMap';
import { CAPABILITY_IDS } from '@/lib/business-os/entitlements/config/catalog';

/** Every (entity, op) pair the chat catalog can produce. */
function everyOperation(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  for (const [entity, definition] of Object.entries(SEMANTIC_CATALOG)) {
    // Every entity supports the two read ops…
    pairs.push([entity, 'find'], [entity, 'compute']);
    // …plus whatever actions it declares.
    for (const action of Object.keys(definition.actions ?? {})) {
      pairs.push([entity, action]);
    }
  }

  return pairs;
}

const OPERATIONS = everyOperation();

describe('the mapping is total', () => {
  it('reads a non-trivial catalog', () => {
    // A guard on the guard: an import that silently yielded {} would make every
    // assertion below pass while checking nothing.
    expect(Object.keys(SEMANTIC_CATALOG).length).toBeGreaterThan(20);
    expect(OPERATIONS.length).toBeGreaterThan(100);
  });

  it.each(OPERATIONS)('%s.%s resolves to a capability or a reasoned ungated', (entity, op) => {
    const mapping = capabilityForOp(entity, op);

    expect(mapping).toBeDefined();
    if (isUngated(mapping!)) {
      // "Ungated" is a claim that something is deliberately not sold. It has to
      // carry its reason, or it is indistinguishable from an oversight.
      expect(mapping!.ungated.length).toBeGreaterThan(3);
    } else {
      expect(CAPABILITY_IDS).toContain(mapping);
    }
  });

  it('matches the action set the planner is actually given', () => {
    // The plugin definition is what the LLM sees. If it and the chat catalog
    // ever disagree, an action could exist for the planner that the mapping has
    // never heard of.
    const pluginActions = Object.keys((businessOsPlugin as { actions: Record<string, unknown> }).actions);
    const derived = OPERATIONS.map(([entity, op]) => `${op === 'compute' ? 'aggregate' : op}_${entity}`);

    // 103 since the agent-platform entities left the chat catalog on main
    // (2026-09-23). The number is deliberately hard-coded: it is the tripwire
    // that says "the planner surface changed" rather than something that
    // quietly follows the catalog wherever it goes.
    expect(pluginActions).toHaveLength(103);
    expect(pluginActions.filter((action) => !derived.includes(action))).toEqual([]);
    expect(derived.filter((action) => !pluginActions.includes(action))).toEqual([]);
  });

  it('classifies every entity, with nothing stale', () => {
    const entities = Object.keys(SEMANTIC_CATALOG).sort();
    const classified = Object.keys(ENTITY_DOMAIN).sort();

    expect(entities.filter((entity) => !classified.includes(entity))).toEqual([]);
    // A stale entry is not harmless: it hides that an entity was removed, and
    // would silently map a future entity of the same name.
    expect(classified.filter((entity) => !entities.includes(entity))).toEqual([]);
  });

  it('has no override for an operation that does not exist', () => {
    const real = new Set(OPERATIONS.map(([entity, op]) => `${entity}.${op}`));
    const stale = Object.keys(ACTION_OVERRIDES).filter((key) => !real.has(key));

    expect(stale).toEqual([]);
  });

  it('fails when a new action is added and left unclassified', () => {
    // The negative control: without this, "every operation resolves" could be
    // true because `capabilityForOp` never returns undefined.
    expect(capabilityForOp('a_brand_new_entity', 'find')).toBeUndefined();
  });
});

describe('the judgements the mapping encodes', () => {
  it('sends money questions to invoice control, wherever they start', () => {
    // A client statement lives on `contacts`, but asking what someone owes is
    // invoice work.
    expect(capabilityForOp('contacts', 'statement')).toBe('chat.invoice_control');
    expect(capabilityForOp('contacts', 'create')).toBe('crm.core');
  });

  it('treats writing to a client as email', () => {
    expect(capabilityForOp('contacts', 'send')).toBe('chat.email');
  });

  it('never gates anything that belongs to the agent platform (B-8)', () => {
    // `agents` and `agent_runs` were removed from the chat catalog on main, so
    // this can no longer assert "they resolve to ungated" — there is nothing to
    // resolve. It asserts the rule that outlives them instead: no entity in the
    // map is an agent-platform entity, so a Business OS plan cannot gate one.
    //
    // If chat ever offers them again, `classifies every entity, with nothing
    // stale` fails until somebody classifies them, and B-8 says the answer.
    const agentPlatform = Object.keys(ENTITY_DOMAIN).filter((entity) => /^agents?(_|$)|^agent_runs$/.test(entity));
    expect(agentPlatform).toEqual([]);

    // Non-vacuity: the map is not simply empty.
    expect(Object.keys(ENTITY_DOMAIN).length).toBeGreaterThan(10);
  });

  it('charges aggregations to reporting under either read rule', () => {
    expect(capabilityForOp('invoices', 'compute', 'domain_group')).toBe('chat.reporting');
    expect(capabilityForOp('invoices', 'compute', 'read_only_plans_need_search')).toBe('chat.reporting');
  });

  it('bulk fan-out and narrative analysis are their own capabilities', () => {
    expect(capabilityForPlanOp('for_each')).toBe('chat.bulk');
    expect(capabilityForPlanOp('analyse')).toBe('chat.reporting');
    expect(Object.keys(PLAN_OP_CAPABILITY).sort()).toEqual(['analyse', 'for_each']);
  });
});

describe('Q-B1 — the read rule is a config value, and it changes the answer', () => {
  it('ships as domain_group: a plan that includes an area can ask about it', () => {
    expect(READ_RULE).toBe('domain_group');
    expect(capabilityForOp('bookings', 'find', 'domain_group')).toBe('chat.scheduling');
  });

  it('flips to search without touching any code', () => {
    // The whole point of Q-B1 being config: both readings are expressible, and
    // shadow mode records both so the choice is made with numbers.
    expect(capabilityForOp('bookings', 'find', 'read_only_plans_need_search')).toBe('chat.search');
    expect(capabilityForOp('invoices', 'find', 'read_only_plans_need_search')).toBe('chat.search');
  });

  it('leaves writes alone whichever rule is in force', () => {
    for (const rule of ['domain_group', 'read_only_plans_need_search'] as const) {
      expect(capabilityForOp('bookings', 'cancel', rule)).toBe('chat.scheduling');
      expect(capabilityForOp('invoices', 'send', rule)).toBe('chat.invoice_control');
    }
  });
});
