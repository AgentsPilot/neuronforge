// lib/business-os/entitlements/config/chatActionMap.ts
//
// CHAT OPERATION → CAPABILITY.
//
// Requirement FR-6 / AC-3, workplan §4.5. Engineering owns this file: it says
// which capability an operation belongs to, never which plan includes it.
//
// ── WHY A RULE AND NOT A LIST OF 130 LINES ──────────────────────────────────
// Every entity in the chat catalog supports `find` and `compute`, and most
// support a handful of actions — about 130 pairs in total. A hand-written line
// per pair would be 130 chances to forget one, and the forgetting would be
// silent until someone was charged for something they had paid for (or not
// charged for something they had not).
//
// So the mapping is a DEFAULT PER ENTITY plus explicit exceptions, and the
// invariant test walks the live chat catalog and asserts every real pair
// resolves. Adding an entity or an action to the chat catalog fails that test
// until it is classified here — which is exactly the "a chat action is
// unmapped" invariant FR-8 asks for.
//
// ── THE READ RULE (Q-B1, still the user's decision) ─────────────────────────
// "Search via chat" is a sellable capability in the draft price list, but what
// counts as search was never settled. Both readings are expressible here, and
// shadow mode records BOTH, so the decision can be made with numbers instead of
// intuition. See `ChatReadRule`.

import type { CapabilityOrUngated, ChatReadRule, Ungated } from '../types';
import type { CapabilityId } from './catalog';

/** A mapping value: a capability, or a reasoned decision not to gate. */
export type ChatMapping = CapabilityOrUngated<CapabilityId>;

export function isUngated(mapping: ChatMapping): mapping is Ungated {
  return typeof mapping === 'object' && mapping !== null && 'ungated' in mapping;
}

/**
 * The capability an entity belongs to.
 *
 * This is the default for every operation on that entity, reads included under
 * the `domain_group` rule.
 */
export const ENTITY_DOMAIN: Readonly<Record<string, ChatMapping>> = {
  // CRM
  contacts: 'crm.core',
  tasks: 'crm.core',
  activities: 'crm.core',
  pipeline_stages: 'crm.core',

  // Money
  invoices: 'chat.invoice_control',
  installments: 'chat.invoice_control',
  plans: 'chat.invoice_control',
  plan_subscriptions: 'chat.invoice_control',
  refunds: 'chat.invoice_control',
  transactions: 'chat.invoice_control',

  // Quotes
  proposals: 'chat.quotes',

  // Scheduling
  bookings: 'chat.scheduling',
  services: 'chat.scheduling',
  business_profile: 'chat.scheduling',

  // Website
  pages: 'website.ai_site',
  sections: 'website.ai_site',
  page_views: 'website.ai_site',
  links: 'website.ai_site',
  link_clicks: 'website.ai_site',

  // Insights
  insights: 'insights.checks',
  channel_metrics: 'insights.channels',
  channel_connections: 'insights.channels',

  // Email
  emails: 'chat.email',

  // The agent platform. Gating these would couple the two products, which B-8
  // forbids: a Business OS subscription grants nothing on the agent platform and
  // vice versa. Showing an owner their own agent runs is not a Business OS sale.
  agents: { ungated: 'agent platform, B-8' },
  agent_runs: { ungated: 'agent platform, B-8' },
};

/**
 * Operations that do not belong to their entity's domain.
 *
 * Keyed `entity.action`. Each one is a judgement about what the owner is really
 * doing, not about which table the row lives in.
 */
export const ACTION_OVERRIDES: Readonly<Record<string, ChatMapping>> = {
  // Asking what a client owes and has paid is invoice work, whatever entity it
  // starts from.
  'contacts.statement': 'chat.invoice_control',
  // Writing to a client is email, not CRM.
  'contacts.send': 'chat.email',
  // Sending an invoice or a proposal is part of that capability, not of email.
  // (Left unstated on purpose: they fall through to the entity default.)

  // Exporting the ledger is reporting.
  'business_profile.export_ledger': 'chat.reporting',
  // "How much time is free tomorrow?" is scheduling, and stays with it.
  'business_profile.open_time': 'chat.scheduling',
};

/**
 * Plan-level operations: things a plan does, rather than things done to an
 * entity.
 */
export const PLAN_OP_CAPABILITY = {
  /** Fanning out over many rows is its own sellable capability. */
  for_each: 'chat.bulk',
  /** Narrative analysis of a result set is reporting. */
  analyse: 'chat.reporting',
} as const satisfies Record<string, CapabilityId>;

/**
 * Which capability a READ belongs to (Q-B1).
 *
 * `domain_group` (the default) — a read belongs to its entity's domain, so a
 * plan that includes scheduling can answer "what's on tomorrow?" without also
 * buying search. `chat.search` then covers reads of entities with no domain of
 * their own.
 *
 * `read_only_plans_need_search` — any look-up that is itself the answer needs
 * `chat.search`; reads that only feed a write are covered by the write.
 *
 * Changing this value changes what a lower plan can ask, with no code change —
 * and the shadow report shows what each reading would have cost before anyone
 * commits to it.
 */
export const READ_RULE: ChatReadRule = 'domain_group';

/** Aggregations are reporting under either reading. */
const COMPUTE_CAPABILITY: CapabilityId = 'chat.reporting';

/**
 * The capability one chat operation needs.
 *
 * `op` is `find`, `compute`, or an action name from the chat catalog.
 * Returns `undefined` only for an entity nobody has classified — which the
 * invariant test turns into a failure rather than a silent pass.
 */
export function capabilityForOp(
  entity: string,
  op: string,
  rule: ChatReadRule = READ_RULE
): ChatMapping | undefined {
  const override = ACTION_OVERRIDES[`${entity}.${op}`];
  if (override !== undefined) return override;

  const domain = ENTITY_DOMAIN[entity];
  if (domain === undefined) return undefined;

  // An ungated entity stays ungated whatever the operation: gating the read of
  // something we deliberately do not sell would make no sense.
  if (isUngated(domain)) return domain;

  if (op === 'compute') return COMPUTE_CAPABILITY;

  if (op === 'find') {
    return rule === 'read_only_plans_need_search' ? 'chat.search' : domain;
  }

  return domain;
}

/** The capability a plan-level operation needs. */
export function capabilityForPlanOp(op: keyof typeof PLAN_OP_CAPABILITY): CapabilityId {
  return PLAN_OP_CAPABILITY[op];
}
