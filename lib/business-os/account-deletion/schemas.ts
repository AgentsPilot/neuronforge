/**
 * The wire shapes of the customer self-delete (data export DE-10b.2, workplan
 * §2.3; SA Review 2 C2-10).
 *
 *   GET  /api/business-os/account/deletion-check  → `deletionCheckResponseSchema`
 *   POST /api/business-os/account/delete           ← `accountDeleteBodySchema`
 *   POST /api/business-os/account/keep             ← `accountKeepBodySchema` (DL-1b)
 *
 * The body is `.strict()` and holds the typed statement, the UI language and,
 * from DL-1b, the REQUIRED reason code (SA W-13; user BQ-32: the same list as
 * the plan cancel, list only): an `email`, a `userId`, an `origin`, a `status`
 * or any other key is a 400. The account is always the session's. Client-safe
 * (zod only): the drawer parses the check response with the same schema the
 * route answers with.
 *
 * DL-1b (workplan BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §4, §5): the delete
 * route is now the deletion REQUEST (nothing is deleted); its answers and the
 * Keep route's are `accountDeleteResponseDataSchema` and
 * `accountKeepResponseDataSchema`. The `/account-deleted` helpers below stay
 * for that page (DL-2 re-words it).
 *
 * @module lib/business-os/account-deletion/schemas
 */

import { z } from 'zod';
import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { MAX_STATEMENT_LENGTH, STATEMENT_LANGUAGES } from './acknowledgement';
import { BLOCKER_CODES } from './blockerCopy';

export const accountDeleteBodySchema = z
  .object({
    statement: z.string().min(1).max(MAX_STATEMENT_LENGTH),
    language: z.enum(STATEMENT_LANGUAGES),
    // DL-1b (SA W-13): required; the closure row's `reason_code` is NOT NULL.
    reasonCode: z.enum(PLAN_LEAVE_REASON_CODES),
  })
  .strict();
export type AccountDeleteBody = z.infer<typeof accountDeleteBodySchema>;

/** DL-1b: Keep carries nothing. The account and the closure are the session's. */
export const accountKeepBodySchema = z.object({}).strict();

/** DL-1b: a successful request (§4.1). */
export const accountDeleteResponseDataSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), planEndsOn: z.string().nullable(), renewalWasOn: z.boolean() }).strict(),
  z.object({ status: z.literal('grace'), lockAt: z.string(), lockTimezone: z.string() }).strict(),
]);
export type AccountDeleteResponseData = z.infer<typeof accountDeleteResponseDataSchema>;

/** DL-1b: what Keep did about the plan's renewal (§5.1; BQ-33). */
export const KEEP_RENEWAL_OUTCOMES = ['restored', 'not_needed', 'not_restored_by_choice', 'failed', 'unknown'] as const;
export type KeepRenewalOutcome = (typeof KEEP_RENEWAL_OUTCOMES)[number];

/** DL-1b: a successful Keep (§5.1). `code` / `planEndsOn` only with `renewal: 'failed'`. */
export const accountKeepResponseDataSchema = z
  .object({
    kept: z.literal(true),
    from: z.enum(['pending', 'grace']),
    renewal: z.enum(KEEP_RENEWAL_OUTCOMES),
    code: z.string().optional(),
    planEndsOn: z.string().nullable().optional(),
  })
  .strict();
export type AccountKeepResponseData = z.infer<typeof accountKeepResponseDataSchema>;

export const blockerViewSchema = z
  .object({
    code: z.enum(BLOCKER_CODES),
    count: z.number().int().positive().optional(),
  })
  .strict();

const isoOrNull = z.string().nullable();

/** What the drawer needs. Never the email, never a guard's SQL text. */
export const deletionCheckDataSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      /** False when this deployment cannot delete right now (not configured, function out of date, no login email). */
      available: z.boolean(),
      blockers: z.array(blockerViewSchema),
      willKeepBilling: z.boolean(),
      exportFacts: z.object({ lastReadyAt: isoOrNull, downloaded: z.boolean() }).strict(),
    })
    .strict(),
]);
export type DeletionCheckData = z.infer<typeof deletionCheckDataSchema>;

export const deletionCheckResponseSchema = z.object({
  success: z.literal(true),
  data: deletionCheckDataSchema,
});

/** The only place the client may go after a delete (SA V-4). */
export const ACCOUNT_DELETED_PATH = '/account-deleted';

export function accountDeletedRedirect(language: (typeof STATEMENT_LANGUAGES)[number]): string {
  return `${ACCOUNT_DELETED_PATH}?lang=${language}`;
}

/** True for a redirect the server built: the account-deleted page and nothing else. */
export function isAccountDeletedRedirect(value: unknown): value is string {
  return typeof value === 'string' && (value === ACCOUNT_DELETED_PATH || value.startsWith(`${ACCOUNT_DELETED_PATH}?`));
}
