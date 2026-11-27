/**
 * The response body of `GET /api/version` (app version stamp R19;
 * DEVELOPMENT_LIFECYCLE.md §5.4; SA-V5).
 *
 * STRICT on purpose: the route parses its own answer through this schema, so a
 * field that is not one of the three fails the parse instead of reaching a
 * caller. The endpoint is public; "nothing else" is enforced here, not by
 * convention.
 *
 * Client-safe: no server imports, so the version line can share the type.
 *
 * @module lib/validation/app-version-schema
 */

import { z } from 'zod';

import type { DeploymentRole } from '@/lib/admin/environment-types';

/** Every role, as the lowercase id the API returns. Words are applied in the UI only (SA-V2). */
export const DEPLOYMENT_ROLE_IDS = ['production', 'staging', 'preview', 'development', 'local', 'unknown'] as const;

// Compile-time check that the list and the shared type cannot drift apart.
type RoleIdsMatch = [DeploymentRole] extends [(typeof DEPLOYMENT_ROLE_IDS)[number]]
  ? [(typeof DEPLOYMENT_ROLE_IDS)[number]] extends [DeploymentRole]
    ? true
    : never
  : never;
const ROLE_IDS_MATCH: RoleIdsMatch = true;
void ROLE_IDS_MATCH;

/** A short commit id: exactly 7 lower-case hex characters. */
export const SHORT_SHA = /^[0-9a-f]{7}$/;

export const appVersionSchema = z
  .object({
    environment: z.enum(DEPLOYMENT_ROLE_IDS),
    commit: z.string().regex(SHORT_SHA).nullable(),
    builtAt: z.string().datetime().nullable(),
  })
  .strict();

export type AppVersion = z.infer<typeof appVersionSchema>;
