/**
 * The wire shapes of the customer self-delete (data export DE-10b.2, workplan
 * §2.3; SA Review 2 C2-10).
 *
 *   GET  /api/business-os/account/deletion-check  → `deletionCheckResponseSchema`
 *   POST /api/business-os/account/delete           ← `accountDeleteBodySchema`
 *
 * The body is `.strict()` and holds the typed statement and the UI language
 * only: an `email`, a `userId` or any other key is a 400. The account is
 * always the session's. Client-safe (zod only): the drawer parses the check
 * response with the same schema the route answers with.
 *
 * @module lib/business-os/account-deletion/schemas
 */

import { z } from 'zod';
import { MAX_STATEMENT_LENGTH, STATEMENT_LANGUAGES } from './acknowledgement';
import { BLOCKER_CODES } from './blockerCopy';

export const accountDeleteBodySchema = z
  .object({
    statement: z.string().min(1).max(MAX_STATEMENT_LENGTH),
    language: z.enum(STATEMENT_LANGUAGES),
  })
  .strict();
export type AccountDeleteBody = z.infer<typeof accountDeleteBodySchema>;

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
