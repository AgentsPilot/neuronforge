/**
 * Request bodies of Apply, Dismiss and the margin review (AI model price review
 * slice 8). Strict: the client sends line ids and the admin's own words, and
 * nothing else (SA 2.5 field allow-list). An injected admin id, price, model,
 * date or margin record is refused here as a 400, before any read.
 *
 * Lengths match the database CHECKs (3 to 500 characters after trimming), and
 * the 50-line limit matches the function (SA O-17).
 */

import { z } from 'zod';

export const MAX_DECISION_LINES = 50;

const reasonText = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(3, 'Write at least 3 characters').max(500, 'Keep it under 500 characters'));

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const ApplyBodySchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            lineId: z.string().uuid(),
            reason: reasonText,
            overrideReason: reasonText.optional(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_DECISION_LINES)
      .refine((lines) => distinct(lines.map((line) => line.lineId)), 'Each line can appear only once'),
  })
  .strict();

export type ApplyBody = z.infer<typeof ApplyBodySchema>;

export const DismissBodySchema = z
  .object({
    lineIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_DECISION_LINES)
      .refine(distinct, 'Each line can appear only once'),
    reason: reasonText,
  })
  .strict();

export type DismissBody = z.infer<typeof DismissBodySchema>;

export const MarginReviewBodySchema = z.object({ note: reasonText }).strict();

export const BatchIdSchema = z.string().uuid();
