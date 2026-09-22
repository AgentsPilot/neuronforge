/**
 * What a public form may say about consent.
 *
 * One schema, imported by every capture route, so a new surface cannot invent
 * its own shape and quietly record something different.
 *
 * Note what the server does NOT trust: the wording. The client echoes back the
 * statement it displayed, and the server stores its OWN current wording instead,
 * keeping the echo as evidence and logging a warning when the two disagree. That
 * is how a visitor sitting on a cached page showing last month's sentence gets
 * noticed rather than silently recorded as having agreed to this month's.
 *
 * @module lib/validation/consent
 */

import { z } from 'zod';

export const ConsentInputSchema = z
  .object({
    granted: z.boolean(),
    /** What the visitor was shown. Evidence, not the record. */
    statement_text: z.string().max(2000).optional(),
    statement_locale: z.string().max(8).optional(),
    statement_version: z.number().int().optional(),
    privacy_policy_url: z.string().max(2048).optional(),
  })
  .optional();

export type ConsentInput = z.infer<typeof ConsentInputSchema>;
