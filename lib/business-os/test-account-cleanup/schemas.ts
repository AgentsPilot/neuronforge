/**
 * Request bodies of `/api/admin/test-account-cleanup/*` (SA-9). Validated
 * before any connection is opened.
 *
 * The tag is free text, exactly like the pasted SQL (BQ-2): trimmed, not empty,
 * at most 254 characters, nothing else restricted. The SQL guard G-2 does the
 * real work (the email must CONTAIN the tag).
 *
 * @module lib/business-os/test-account-cleanup/schemas
 */

import { z } from 'zod';

const email = z.string().trim().max(254).email();
const tag = z.string().trim().min(1).max(254);

export const cleanupCheckBodySchema = z.object({ email, tag }).strict();

export const cleanupDeleteBodySchema = z
  .object({
    email,
    tag,
    // A string, compared by the server with the email (G-3). Never echoed back.
    confirmEmail: z.string().max(254),
  })
  .strict();

export type CleanupCheckBody = z.infer<typeof cleanupCheckBodySchema>;
export type CleanupDeleteBody = z.infer<typeof cleanupDeleteBodySchema>;
