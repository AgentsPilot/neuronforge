/**
 * The audit filter option builders (Gap A, FR-A3 / AC-A3).
 *
 * The load-bearing assertions are the exhaustiveness and partition ones: they
 * turn "a newly registered event becomes selectable with no UI change" from an
 * aspiration into a property of the code. The fallback test proves the grouping
 * rules cannot become an exclusion list, and the "no regression on the old
 * hardcoded set" test pins the trap that would have shipped if the list were
 * driven from EVENT_METADATA (which covers only 121 of the 148 events, and does
 * not cover USER_CREATED — an option the old JSX offered).
 */

import {
  AI_ACTION_ENTITY_TYPE,
  buildActionFilterGroups,
  buildEntityTypeFilterOptions,
  classifyAuditEvent,
} from '../filterOptions';
import { AUDIT_EVENTS } from '../events';
import { AUDIT_ENTITY_TYPES } from '../types';
// The other copy of the same constant. Imported for one equality assertion —
// this is a node test, so pulling zod in through requestSchemas costs nothing.
import { AI_ACTION_ENTITY_TYPE as AI_ACTION_ENTITY_TYPE_FROM_SCHEMAS } from '../requestSchemas';

const groups = buildActionFilterGroups();
const allActionOptions = groups.flatMap((g) => g.options);
const actionValues = allActionOptions.map((o) => o.value);
const entityOptions = buildEntityTypeFilterOptions();

/** Every action option value, for membership assertions. */
const actionValueSet = new Set(actionValues);

describe('buildActionFilterGroups', () => {
  it('offers exactly the registered catalogue — every event, nothing invented', () => {
    const registered = Object.values(AUDIT_EVENTS);
    expect(actionValues).toHaveLength(registered.length);
    expect(actionValueSet).toEqual(new Set(registered));
  });

  it('partitions the catalogue: one group each, no empties, no duplicates', () => {
    expect(actionValues).toHaveLength(actionValueSet.size);
    for (const group of groups) {
      expect(group.options.length).toBeGreaterThan(0);
    }
    const groupLabels = groups.map((g) => g.label);
    expect(new Set(groupLabels).size).toBe(groupLabels.length);
  });

  it('makes both Business OS AI events selectable, grouped together and pinned first', () => {
    const aiGroup = groups.find((g) => g.label === 'Business OS AI');
    expect(aiGroup).toBeDefined();
    expect(aiGroup!.options.map((o) => o.value).sort()).toEqual([
      AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED,
      AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED,
    ]);
    // Pinned: this is the group the slice exists to surface, and alphabetical
    // order would bury it under "Agent Intelligence Score" / "AgentKit".
    expect(groups[0].label).toBe('Business OS AI');
  });

  it('still offers every action the old hardcoded JSX offered that anything writes', () => {
    // Including USER_CREATED, which has no EVENT_METADATA entry: driving this
    // list from the metadata would have dropped it, a regression not an omission.
    //
    // Two of the fourteen hardcoded options were never in AUDIT_EVENTS:
    //   - AGENT_EXECUTED is written live (app/api/run-agent/route.ts), so it is
    //     now registered in the catalogue and appears below.
    //   - USER_UPDATED has no writer anywhere in the tree — it was a dead option
    //     that could only ever return rows from code deleted long ago. It is
    //     deliberately NOT registered; "All Actions" still reaches any such rows.
    const previouslyHardcoded = [
      'AIS_SCORE_CALCULATED',
      'AIS_SCORE_UPDATED',
      'AIS_SCORE_RECALCULATED',
      'AIS_NORMALIZATION_REFRESH_STARTED',
      'AIS_NORMALIZATION_REFRESH_COMPLETED',
      'AIS_SCORES_BULK_RECALCULATED',
      'USER_LOGIN',
      'USER_LOGOUT',
      'USER_CREATED',
      'AGENT_CREATED',
      'AGENT_UPDATED',
      'AGENT_DELETED',
      'AGENT_EXECUTED',
    ];
    for (const value of previouslyHardcoded) {
      expect(actionValueSet.has(value)).toBe(true);
    }
  });

  it('offers AGENT_EXECUTED, which a live writer stores but the catalogue had not registered', () => {
    // app/api/run-agent/route.ts writes this action on every agent run. Before
    // Slice A it was selectable only because the page hardcoded it, so a purely
    // catalogue-driven list would have made those rows unfilterable.
    expect(actionValueSet.has('AGENT_EXECUTED')).toBe(true);
  });

  it('includes events that have no EVENT_METADATA entry, without a description', () => {
    const userCreated = allActionOptions.find((o) => o.value === 'USER_CREATED');
    expect(userCreated).toBeDefined();
    expect(userCreated!.description).toBeUndefined();
    expect(userCreated!.label).toBe('User Created');
  });

  it('carries the catalogue description when there is one', () => {
    const completed = allActionOptions.find(
      (o) => o.value === AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED
    );
    expect(typeof completed!.description).toBe('string');
    expect(completed!.description!.length).toBeGreaterThan(0);
  });

  it('produces human labels — no underscores, never "Unknown event"', () => {
    for (const option of allActionOptions) {
      expect(option.label).not.toContain('_');
      expect(option.label).not.toMatch(/^Unknown event/);
      expect(option.label.length).toBeGreaterThan(0);
    }
    for (const group of groups) {
      expect(group.label).not.toContain('_');
    }
  });

  it('labels AI pricing events under their own group, not a broad AI_ rule', () => {
    const pricing = groups.find((g) => g.label === 'AI Pricing');
    expect(pricing).toBeDefined();
    for (const option of pricing!.options) {
      expect(option.value.startsWith('AI_PRICING_')).toBe(true);
    }
  });
});

describe('classifyAuditEvent — the fallback that makes the rule list safe', () => {
  it('groups an unregistered event by its first token rather than dropping it', () => {
    const { group, label } = classifyAuditEvent('ZZZTEST_SOMETHING_HAPPENED');
    expect(group).toBe('Zzztest');
    expect(label).toBe('Zzztest Something Happened');
  });

  it('groups an event with no underscore at all', () => {
    expect(classifyAuditEvent('SOMETHING').group).toBe('Something');
  });

  it('prefers the longest matching prefix', () => {
    expect(classifyAuditEvent('BUSINESS_AI_ACTION_COMPLETED').group).toBe('Business OS AI');
    expect(classifyAuditEvent('BUSINESS_DATA_PURGED').group).toBe('Business OS');
  });

  it('does not label a hypothetical future AI_ event as AI Pricing', () => {
    expect(classifyAuditEvent('AI_SOMETHING_ELSE').group).not.toBe('AI Pricing');
  });
});

describe('buildEntityTypeFilterOptions', () => {
  it('offers exactly the registered entity types', () => {
    // The "all" sentinel is a UI value, not a catalogue value: it stays in the page.
    expect(entityOptions.map((o) => o.value).sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });

  it('offers ai_action, labelled for a human', () => {
    const aiAction = entityOptions.find((o) => o.value === AI_ACTION_ENTITY_TYPE);
    expect(aiAction).toBeDefined();
    expect(aiAction!.label).toBe('AI Action');
  });

  it('keeps the duplicated AI_ACTION_ENTITY_TYPE equal to the one in requestSchemas', () => {
    // filterOptions.ts redeclares the constant so the client bundle does not
    // pull in zod (SA JC-5). `satisfies EntityType` pins each copy to the
    // catalogue union, but NOT to the other copy: changing one to another valid
    // entity type would compile, and the admin page would silently stop
    // rendering AI details. This is the assertion that closes that gap.
    expect(AI_ACTION_ENTITY_TYPE).toBe(AI_ACTION_ENTITY_TYPE_FROM_SCHEMAS);
  });

  it('still offers the two entity types the old hardcoded JSX offered', () => {
    const values = entityOptions.map((o) => o.value);
    expect(values).toContain('agent');
    expect(values).toContain('system');
  });

  it('title-cases with the acronym map', () => {
    const byValue = Object.fromEntries(entityOptions.map((o) => [o.value, o.label]));
    expect(byValue['crm_contact']).toBe('CRM Contact');
    expect(byValue['ai_pricing']).toBe('AI Pricing');
    expect(byValue['payment_invoice']).toBe('Payment Invoice');
  });
});
