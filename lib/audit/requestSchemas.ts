// lib/audit/requestSchemas.ts
//
// Input validation for the audit trail's own HTTP routes (Layer 3 step 0,
// FR-24). Server code writes audit entries through AuditTrailService directly
// and is not validated here; these schemas guard only what a browser can send.
//
// Reads and writes are deliberately asymmetric (SA WC-6):
//   - a READ filter is not a security boundary (the repository scopes every read
//     to the session user and excludes AI entries in the query), and the live
//     table already holds entity types outside the TS union, so read filters
//     accept any well-formed identifier;
//   - a WRITE is what a client could forge, so it accepts only the events and
//     entity types the browser really sends (an explicit allow-list, SA CR-1),
//     and never an AI entry.

import { z } from 'zod';
import { AUDIT_EVENTS } from './events';
import type { EntityType } from './types';

/**
 * AI audit entries (Layer 3) are written by the server only. A client can
 * neither create one nor read one back (D-6, FR-24, FR-27).
 */
export const AI_ACTION_ENTITY_TYPE = 'ai_action';
export const AI_ACTION_EVENT_PREFIX = 'BUSINESS_AI_ACTION_';

export function isAiAuditFilter(filter: { action?: string; entityType?: string }): boolean {
  return (
    filter.entityType === AI_ACTION_ENTITY_TYPE ||
    (filter.action !== undefined && filter.action.startsWith(AI_ACTION_EVENT_PREFIX))
  );
}

/** A well-formed audit identifier (event name or entity type), not necessarily registered. */
const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;

const MAX_LIMIT = 1000; // the /monitoring page asks for 1,000
const MAX_DETAILS_BYTES = 8 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024;

const positiveInt = (fallback: number, max?: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? fallback : Number(v)),
    max === undefined ? z.number().int().min(1) : z.number().int().min(1).max(max)
  );

/**
 * GET /api/audit/query. `offset` is accepted and ignored: the /monitoring page
 * sends `offset=0`, and the route has always paginated by `page` (M-11).
 */
export const AuditReadQuerySchema = z.object({
  limit: positiveInt(50, MAX_LIMIT),
  page: positiveInt(1),
  offset: z.string().optional(),
  action: z.string().regex(IDENTIFIER).optional(),
  entityType: z.string().regex(IDENTIFIER).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
});
export type AuditReadQuery = z.infer<typeof AuditReadQuerySchema>;

/**
 * The only events a browser may write (SA CR-1). Exactly what the surveyed
 * callers send (workplan §13.5); everything else in AUDIT_EVENTS is written by
 * server code, where it happens. Without this list a signed-in owner could put
 * "a refund happened" or "business data purged" into their own compliance log.
 * Adding a browser caller means adding its event here, deliberately.
 */
export const CLIENT_WRITABLE_EVENTS: readonly string[] = [
  AUDIT_EVENTS.USER_LOGIN, // auth/callback
  AUDIT_EVENTS.USER_LOGOUT, // LogoutButton, business-os settings
  AUDIT_EVENTS.USER_ONBOARDING_COMPLETED, // useOnboarding
  AUDIT_EVENTS.USER_ONBOARDING_FAILED, // useOnboarding
  AUDIT_EVENTS.SETTINGS_NOTIFICATIONS_UPDATED, // NotificationsTab (V1, V2)
  AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED, // ProfileTab (V1, V2)
  AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED, // SecurityTab
  AUDIT_EVENTS.USER_PASSWORD_CHANGED, // SecurityTab (V1, V2)
  AUDIT_EVENTS.USER_DATA_EXPORTED, // SecurityTabV2
  AUDIT_EVENTS.PLUGIN_DISCONNECTED, // PluginsTab (POST /api/audit-trail)
];

/** The only entity types a browser may write (SA CR-1). */
export const CLIENT_WRITABLE_ENTITY_TYPES: readonly EntityType[] = ['user', 'settings', 'connection'];

const WRITABLE_EVENTS: ReadonlySet<string> = new Set(CLIENT_WRITABLE_EVENTS);
const WRITABLE_ENTITY_TYPES: ReadonlySet<string> = new Set(CLIENT_WRITABLE_ENTITY_TYPES);

/**
 * Keys the audit service itself sets in `details` (AuditTrailService.buildLogEntry
 * spreads the caller's details first, then adds these only conditionally). A
 * client must not be able to supply them: `system_action: true` would make an
 * owner's own entry look like platform activity (SA CR-2).
 */
export const SERVICE_RESERVED_DETAIL_KEYS: readonly string[] = ['system_action', 'changeSummary'];

export function stripReservedDetailKeys(details: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SERVICE_RESERVED_DETAIL_KEYS.includes(key)) clean[key] = value;
  }
  return clean;
}

const plainObject = z.record(z.string(), z.unknown());

function serializedSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY; // circular or otherwise unserializable
  }
}

/**
 * POST /api/audit/log and POST /api/audit-trail.
 *
 * `userId`, `severity` and `complianceFlags` are accepted so existing callers
 * keep working, and then ignored: the account is the session user, and severity
 * and flags come from EVENT_METADATA (FR-24).
 */
export const AuditWriteBodySchema = z
  .object({
    action: z
      .string()
      .refine((a) => WRITABLE_EVENTS.has(a), 'Not a client-writable audit event')
      .refine((a) => !a.startsWith(AI_ACTION_EVENT_PREFIX), 'AI audit events are server-only'),
    entityType: z
      .string()
      .refine((t) => WRITABLE_ENTITY_TYPES.has(t), 'Not a client-writable entity type')
      .refine((t) => t !== AI_ACTION_ENTITY_TYPE, 'AI audit entries are server-only'),
    entityId: z.string().max(200).nullable().optional(),
    resourceName: z.string().max(200).nullable().optional(),
    details: plainObject
      .refine((d) => serializedSize(d) <= MAX_DETAILS_BYTES, 'details too large')
      .nullable()
      .optional(),
    before: plainObject
      .refine((d) => serializedSize(d) <= MAX_SNAPSHOT_BYTES, 'before too large')
      .nullable() // the settings tabs send a null snapshot when nothing was loaded
      .optional(),
    after: plainObject
      .refine((d) => serializedSize(d) <= MAX_SNAPSHOT_BYTES, 'after too large')
      .nullable()
      .optional(),
    // Accepted for backward compatibility; never used.
    userId: z.unknown().optional(),
    severity: z.unknown().optional(),
    complianceFlags: z.unknown().optional(),
  })
  .strip();
export type AuditWriteBody = z.infer<typeof AuditWriteBodySchema>;
