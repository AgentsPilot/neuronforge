/**
 * One description of what a scheduling service may contain.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED RATHER THAN WRITTEN TWICE
 *
 * Create and update each carried their own copy of the same thirty lines, and
 * they had drifted in seven places. Most of that drift was one bug repeated,
 * and it is the bug the `description` comment in both files already documents:
 *
 *   `.optional()` alone accepts a value or nothing, and REJECTS `null`. An
 *   owner clearing a field sends `null`, Zod throws, and the WHOLE request is
 *   refused — so the visible symptom is that the service NAME will not save,
 *   while the field that actually failed is not the one being blamed.
 *
 * `description` was fixed in both. `price`, `installment_count`,
 * `installment_frequency`, `first_payment_due` and `first_payment_days` were
 * fixed only in update, so clearing any of them on CREATE still failed that
 * way. `buffer_minutes` disagreed outright — 120 on create, 1440 on update —
 * so a service given a longer buffer could never be re-saved through create.
 *
 * Fixing seven fields in two files leaves the eighth to drift. One schema, two
 * derivations, and the class of bug cannot come back.
 *
 * THE RULE: a column that is nullable in the database is `.nullable()` here.
 * Clearing a field is a thing owners do, and it must be expressible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

/** Currencies a service may be priced in. */
export const SERVICE_CURRENCIES = ['USD', 'EUR', 'ILS', 'GBP'] as const;

/**
 * The longest gap a business may leave after an appointment.
 *
 * 24 hours, not 2. The two routes disagreed and the wider bound is the one that
 * survives: a service needing a day between bookings — a room to air, a kiln to
 * cool — is a real thing to configure, and no existing data is stranded by
 * keeping it (the longest buffer in use is 15 minutes).
 */
export const MAX_BUFFER_MINUTES = 1440;

/** Up to seven days, for multi-day courses. Null for a product. */
export const MAX_DURATION_MINUTES = 10080;

/**
 * Every field a service carries, all optional.
 *
 * Update uses this as-is. Create requires a name on top of it.
 */
export const serviceFieldsSchema = z.object({
  description: z.string().nullable().optional(),
  duration_minutes: z.number().min(5).max(MAX_DURATION_MINUTES).nullable().optional(),

  // The three facts that decide this service's client journey: a product has no
  // duration, a free service is not collected at all, and a quoted job is not
  // bought outright.
  is_scheduled: z.boolean().optional(),
  collection: z.enum(['online', 'invoice']).nullable().optional(),
  sale_mode: z.enum(['direct', 'proposal']).optional(),

  price: z.number().min(0).nullable().optional(),
  currency: z.enum(SERVICE_CURRENCIES).optional(),

  buffer_minutes: z.number().min(0).max(MAX_BUFFER_MINUTES).nullable().optional(),
  max_bookings_per_day: z.number().min(1).nullable().optional(),
  advance_booking_days: z.number().min(0).nullable().optional(),
  min_notice_hours: z.number().min(0).nullable().optional(),
  availability: z.record(z.any()).optional(),

  is_active: z.boolean().optional(),

  /*
   * `inactive` is accepted on both, though only update could set it before.
   * A service is born active (see SchedulingRepository.create), so `draft` is
   * the deliberate opt-in to the review-then-publish path — and refusing
   * `inactive` at create only meant a caller had to make one then immediately
   * update it.
   */
  status: z.enum(['draft', 'active', 'inactive']).optional(),

  payment_type: z.enum(['full', 'installments']).optional(),
  installment_count: z.number().min(1).max(24).nullable().optional(),
  installment_frequency: z
    .enum(['weekly', 'biweekly', 'monthly', 'quarterly'])
    .nullable()
    .optional(),
  first_payment_due: z.enum(['on_booking', 'days_after']).nullable().optional(),
  first_payment_days: z.number().min(0).max(365).nullable().optional(),
});

/** Creating: everything above, plus the one field a service cannot exist without. */
export const createServiceSchema = serviceFieldsSchema.extend({
  service_name: z.string().min(1),
});

/** Updating: everything above, and the name only if it is being changed. */
export const updateServiceSchema = serviceFieldsSchema.extend({
  service_name: z.string().min(1).optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
