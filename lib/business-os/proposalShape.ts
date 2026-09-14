/**
 * How an accepted quote turns into money — one schema, both doors.
 *
 * The quote builder posts a payment shape to the REST route; the chat can now
 * dictate one. Two validators for the same three shapes would drift on the
 * first bound anyone adjusted, and the cost of drift here is a quote whose
 * stages do not add up — agreed with a client, and unbillable.
 *
 * The bounds are business rules, not defensive noise: a plan of one payment is
 * a single payment (`kind: 'single'`), twenty-four periods is two years of
 * monthly billing, and a stage worth 0% is a stage that bills nothing.
 *
 * @module lib/business-os
 */

import { z } from 'zod';

export const paymentShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single') }),
  z.object({
    kind: z.literal('installments'),
    count: z.number().int().min(2).max(24),
    frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']),
  }),
  z.object({
    kind: z.literal('milestones'),
    stages: z
      .array(
        z.object({
          label: z.string().min(1).max(120),
          percent: z.number().min(0.01).max(100),
        })
      )
      .min(2)
      .max(12),
  }),
]);

export type PaymentShapeInput = z.infer<typeof paymentShapeSchema>;
