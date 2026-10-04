// lib/audit/ownerVisibility.ts
//
// Which audit entries an account OWNER may read back (credit deduction BD-26,
// KI-25; workplan BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md §2).
//
// Some entries are written against an owner's account (`user_id` = the account)
// but are internal: an admin's credit grant and its internal reason, an admin's
// plan operation, a Business OS AI action (operator-only until the charging
// decision, Layer 3 D-6), and slice 8b's low-line event. They stay written as
// they are; only owner READS leave them out. Admin screens read with the
// service role and are not affected.
//
// The rule is by `entity_type` and lives here once. It is mirrored by:
//   - the owner RLS policy on `audit_trail` (the latest migration that runs
//     `ALTER POLICY "Users can view their own audit logs"`, today 20261018);
//   - AuditTrailRepository.listOwnerEntries (GET /api/audit/query, /monitoring);
//   - the data export route (app/api/user/data-export).
// lib/audit/__tests__/ownerVisibility.test.ts fails if the policy's list and
// this registry differ, and lib/audit/__tests__/ownerAuditReads.guard.test.ts
// fails if a new owner-facing reader of `audit_trail` appears.
//
// Every entity type is classified, on purpose (forced classification, not an
// allow-list): the live table holds legacy entity types outside the TS union,
// and an allow-list of visible types would silently drop them from /monitoring.

import { AI_ACTION_EVENT_PREFIX } from './requestSchemas';
import { AUDIT_ENTITY_TYPES, type EntityType } from './types';

/** 'owner': the account owner may read their own rows. 'operator': admins only. */
export type AuditOwnerVisibility = 'owner' | 'operator';

export const AUDIT_ENTITY_OWNER_VISIBILITY = {
  agent: 'owner',
  shared_agent: 'owner',
  user: 'owner',
  plugin: 'owner',
  settings: 'owner',
  profile: 'owner',
  connection: 'owner',
  execution: 'owner',
  system: 'owner',
  scheduling_service: 'owner',
  scheduling_booking: 'owner',
  payment_invoice: 'owner',
  payment_transaction: 'owner',
  payment_plan_subscription: 'owner',
  payment_plan_installment: 'owner',
  proposal: 'owner',
  crm_contact: 'owner',
  business_profile: 'owner',
  website_page: 'owner',
  intake_form: 'owner',
  subscription: 'owner',
  boost_pack: 'owner',
  // Layer 3 D-6: operator-only until the charging decision.
  ai_action: 'operator',
  // Written by the admin pricing helpers with the admin's own id as user_id, so
  // an owner-visible classification shows nothing to anyone but that admin.
  ai_pricing: 'owner',
  // BD-26: an admin's plan operation on the account (entitlements route).
  business_os_account_plan: 'operator',
  // Written with the admin's own id as user_id (archiving runs route).
  archive_run: 'owner',
  // Admin invites are written with the admin's own id; an owner's friend invites
  // are written against the owner's account and are theirs to see.
  business_os_invite: 'owner',
  // BD-26: an admin's credit grant / reduction, with the internal reason.
  business_os_credit_lot: 'operator',
  // Written with the admin's own id as user_id (admin Drain now route,
  // POST /api/admin/jobs-queues/drain), like archive_run: it never lands on an
  // owner's account, so 'owner' hides nothing from anyone but that admin.
  bos_queue: 'owner',
  // BD-26 / KI-25: slice 8b's system-written low-line event.
  business_os_credit_period: 'operator',
} as const satisfies Record<EntityType, AuditOwnerVisibility>;

/**
 * The entity types an owner never reads back, sorted. The latest owner-policy
 * migration's `NOT IN (...)` list must equal this set.
 */
// The Set drops a duplicate a textual merge with slice 8b could leave in
// AUDIT_ENTITY_TYPES (W26-3).
export const OWNER_HIDDEN_ENTITY_TYPES: readonly EntityType[] = Object.freeze(
  [...new Set(AUDIT_ENTITY_TYPES)]
    .filter((type) => AUDIT_ENTITY_OWNER_VISIBILITY[type] === 'operator')
    .sort()
);

const HIDDEN = new Set<string>(OWNER_HIDDEN_ENTITY_TYPES);

/**
 * True when an owner's read filter can only match hidden entries: the entity
 * type is a hidden one, or the action is a Business OS AI action. The owner
 * read answers such a request with an empty page without querying.
 */
export function isOwnerHiddenFilter(filter: { action?: string; entityType?: string }): boolean {
  return (
    (filter.entityType !== undefined && HIDDEN.has(filter.entityType)) ||
    (filter.action !== undefined && filter.action.startsWith(AI_ACTION_EVENT_PREFIX))
  );
}
