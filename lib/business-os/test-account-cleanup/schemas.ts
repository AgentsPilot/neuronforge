/**
 * Request bodies of `/api/admin/test-account-cleanup/*` (SA-9). Validated
 * before any connection is opened.
 *
 * Two modes (data export DE-10b.1, SA W-8), each a `.strict()` branch of a
 * discriminated union, so an unknown key in either mode is a 400 and `tag`
 * cannot ride along in the anonymise mode:
 *   - `hard`: the test-account delete (OX-1r). The tag is free text, exactly
 *     like the pasted SQL (BQ-2): trimmed, not empty, at most 254 characters.
 *     The SQL guard G-2 does the real work (the email must CONTAIN the tag).
 *     The delete takes only the `test_account` reason (O-10).
 *   - `anonymise`: close and anonymise a real account. `subject` is the account
 *     id of the row the admin picked; guard G-2a proves in the database that
 *     the email resolves to it. Any admin reason.
 *
 * @module lib/business-os/test-account-cleanup/schemas
 */

import { z } from 'zod';
import { adminDeleteReasonSchema, hardDeleteReasonSchema } from '@/lib/business-os/account-deletion/reason';

const email = z.string().trim().max(254).email();
const tag = z.string().trim().min(1).max(254);
const subject = z.string().uuid();
// A string, compared by the server with the email (G-3). Never echoed back.
const confirmEmail = z.string().max(254);

export const cleanupCheckBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('hard'), email, tag }).strict(),
  z.object({ mode: z.literal('anonymise'), email, subject }).strict(),
]);

export const cleanupDeleteBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('hard'), email, tag, confirmEmail, reason: hardDeleteReasonSchema }).strict(),
  z.object({ mode: z.literal('anonymise'), email, subject, confirmEmail, reason: adminDeleteReasonSchema }).strict(),
]);

export type CleanupCheckBody = z.infer<typeof cleanupCheckBodySchema>;
export type CleanupDeleteBody = z.infer<typeof cleanupDeleteBodySchema>;
