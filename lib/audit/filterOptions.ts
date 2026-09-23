// lib/audit/filterOptions.ts
//
// The option lists behind /admin/audit-trail's Action and Entity Type filters
// (Gap A, FR-A3). Both are derived from the catalogues that already exist —
// AUDIT_EVENTS (./events) and AUDIT_ENTITY_TYPES (./types) — so a newly
// registered event or entity type becomes selectable with **no UI change**. The
// page's JSX holds no event literal, and a source-level guard test
// (app/admin/audit-trail/__tests__/filterOptions.guard.test.ts) keeps it that way.
//
// Actions come from AUDIT_EVENTS, never EVENT_METADATA. Measured 2026-09-23:
// 149 registered events, of which only 122 have a metadata entry — a gap of 27.
// (148 / 121 before this same change registered AGENT_EXECUTED in ./events. The
// two totals move whenever an event is registered; the *gap* is the load-bearing
// part, and it is asserted by test, not by this comment.) Driving the list from
// the metadata would drop those 27 silently — USER_CREATED among them, which the
// old hardcoded JSX offered — i.e. the exact defect this module removes.
// Metadata supplies only the optional description tooltip, and
// getEventMetadata() is deliberately not used for labels: its fallback returns
// the literal "Unknown event: X", which is right for a log line and wrong for a
// dropdown.
//
// NOTHING IS EXCLUDED, and no exclusion mechanism exists. This is the
// platform-admin compliance browser; there is no event an admin must be
// prevented from *selecting*, and a hand-maintained exclusion list is the
// rejected hardcoded list wearing a different hat. If an event ever genuinely
// must be hidden, flag it on EventMetadata in ./events so the list stays
// catalogue-driven — never in JSX, and never here. isAiAuditFilter() in
// ./requestSchemas is NOT that mechanism: it guards the *owner* read path and
// must not reach the admin route, where it would block the very filter these
// options exist to add.
//
// Accepted limitation: the live audit_trail table can hold `action` /
// `entity_type` values that were never registered (./requestSchemas says so in
// its own header). These lists therefore offer the *registered* set, not the
// *observed* set; "All Actions" / "All Entities" is how an admin reaches the
// rest. Enumerating the stored distinct values would need a new query and route.
//
// Pure: no I/O, no React, no zod. Safe inside a client bundle and unit-testable
// in Jest's default node environment.

import { AUDIT_EVENTS, EVENT_METADATA } from './events';
import { AUDIT_ENTITY_TYPES } from './types';
import type { EntityType } from './types';

/**
 * Duplicated from ./requestSchemas on purpose: this module is imported by a
 * 'use client' page, and importing the constant from there would pull zod into
 * the client bundle.
 *
 * `satisfies EntityType` pins this copy to the catalogue union — but NOT to the
 * other copy: changing either one to a different valid entity type would still
 * compile, and the admin page would quietly stop rendering AI details. The two
 * are held equal by test instead (lib/audit/__tests__/filterOptions.test.ts).
 */
export const AI_ACTION_ENTITY_TYPE = 'ai_action' satisfies EntityType;

export interface AuditFilterOption {
  value: string;
  /** Human label for the dropdown. Never contains an underscore. */
  label: string;
  /** EVENT_METADATA's description, when the event has one. Optional extra only. */
  description?: string;
}

export interface AuditFilterGroup {
  label: string;
  options: AuditFilterOption[];
}

interface GroupRule {
  prefix: string;
  label: string;
}

/**
 * Cosmetic grouping only. Longest prefix wins, and every unmatched event still
 * gets a group from its first underscore token (see classifyAuditEvent), so
 * editing this list can never drop an event from the dropdown — it can only
 * rename the heading it sits under. That property is what keeps a label map
 * from quietly becoming an exclusion list, and it is asserted by test.
 *
 * `AI_PRICING_` rather than `AI_`: the only AI_* events today are the five
 * AI_PRICING_* ones, and a broader rule would mislabel a future AI_ANYTHING as
 * "AI Pricing" — a wrong label survives review far more easily than a missing
 * group. Match what exists; let the fallback handle what does not.
 */
const GROUP_RULES: readonly GroupRule[] = [
  { prefix: 'BUSINESS_AI_ACTION_', label: 'Business OS AI' },
  { prefix: 'BUSINESS_', label: 'Business OS' },
  { prefix: 'AGENTKIT_', label: 'AgentKit' },
  { prefix: 'AIS_', label: 'Agent Intelligence Score' },
  { prefix: 'AI_PRICING_', label: 'AI Pricing' },
];

/** Longest-first, so "longest prefix wins" is structural rather than positional. */
const ORDERED_RULES: readonly GroupRule[] = [...GROUP_RULES].sort(
  (a, b) => b.prefix.length - a.prefix.length
);

/**
 * Pinned to the top of the group order. Business OS AI is the group this whole
 * filter change exists to surface; alphabetical-by-label would bury it under
 * "Agent Intelligence Score" and "AgentKit".
 */
const PINNED_GROUPS: readonly string[] = ['Business OS AI', 'Business OS'];

/** Tokens that read wrong when merely capitalised. */
const ACRONYMS: Readonly<Record<string, string>> = {
  ai: 'AI',
  ais: 'AIS',
  api: 'API',
  crm: 'CRM',
  gdpr: 'GDPR',
  id: 'ID',
  llm: 'LLM',
  os: 'OS',
  url: 'URL',
};

/** SNAKE_CASE -> "Title Case", with the acronyms above left upper-case. */
function toTitleCase(raw: string): string {
  return raw
    .split('_')
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      return ACRONYMS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * The group heading and option label for one event value.
 *
 * Exported so a test can route a synthetic, unregistered value through it and
 * prove the fallback: an event matching no rule still lands in a group.
 */
export function classifyAuditEvent(event: string): { group: string; label: string } {
  for (const rule of ORDERED_RULES) {
    if (event.startsWith(rule.prefix)) {
      const remainder = event.slice(rule.prefix.length);
      // An event equal to its own prefix would otherwise label as "".
      return { group: rule.label, label: toTitleCase(remainder || event) };
    }
  }
  // Mandatory fallback: the first token always yields a group.
  return { group: toTitleCase(event.split('_')[0] || event), label: toTitleCase(event) };
}

function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label);
}

function byPinnedThenLabel(a: AuditFilterGroup, b: AuditFilterGroup): number {
  const aPin = PINNED_GROUPS.indexOf(a.label);
  const bPin = PINNED_GROUPS.indexOf(b.label);
  if (aPin !== -1 || bPin !== -1) {
    if (aPin === -1) return 1;
    if (bPin === -1) return -1;
    return aPin - bPin;
  }
  return byLabel(a, b);
}

/**
 * Every registered audit event, grouped for an <optgroup> list. Exhaustive over
 * AUDIT_EVENTS: each event appears exactly once, in exactly one group.
 *
 * The "all" sentinel is not returned — it is a UI value, not a catalogue value,
 * and stays as the page's first hardcoded <option>.
 */
export function buildActionFilterGroups(): AuditFilterGroup[] {
  const byGroup = new Map<string, AuditFilterOption[]>();

  for (const event of Object.values(AUDIT_EVENTS)) {
    const { group, label } = classifyAuditEvent(event);
    const description = EVENT_METADATA[event]?.description;
    const option: AuditFilterOption = description
      ? { value: event, label, description }
      : { value: event, label };

    const existing = byGroup.get(group);
    if (existing) existing.push(option);
    else byGroup.set(group, [option]);
  }

  return Array.from(byGroup.entries())
    .map(([label, options]) => ({ label, options: options.sort(byLabel) }))
    .sort(byPinnedThenLabel);
}

/**
 * Every registered entity type, flat and alphabetical. As above, the "all"
 * sentinel stays in the page.
 */
export function buildEntityTypeFilterOptions(): AuditFilterOption[] {
  return AUDIT_ENTITY_TYPES.map((value) => ({ value, label: toTitleCase(value) })).sort(byLabel);
}
