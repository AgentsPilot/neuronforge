/**
 * Zod schemas for archiving inputs (FR-2).
 *
 * Both are BUILT from the constants in `lib/archiving/config.ts`, the same
 * constants the page's dropdown reads, so the client and the server cannot
 * disagree about what is allowed. `POST /api/admin/archiving/runs` consumes
 * them through `archiveRunRequestSchema` (Slice 2b); the overview GET has no
 * input.
 *
 * `z.custom` over the type guard rather than a union of literals (SA Q-1): Zod
 * has no numeric enum, and a literal union would write the three numbers a
 * second time. The guard does not coerce, so `"365"` is rejected.
 */

import { z } from 'zod';

import {
  ARCHIVE_SOURCE_KEYS,
  isRetentionDays,
  type RetentionDays,
} from '@/lib/archiving/config';

export const retentionDaysSchema = z.custom<RetentionDays>(isRetentionDays, {
  message: 'retentionDays must be one of 365, 180, 90',
});

export const archiveSourceKeySchema = z.enum(ARCHIVE_SOURCE_KEYS);

/**
 * The body of `POST /api/admin/archiving/runs` (Slice 2b).
 *
 * `.strict()` on both branches is the field allow-list: a body that carries
 * `cutoff`, `startedBy`, `status` or `batchSize` is a 400, not silently
 * trimmed. The cutoff is computed on the server at start and stored on the run;
 * Continue names only the run, so it can never supply a cutoff (FR-3).
 */
export const archiveRunRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      source: archiveSourceKeySchema,
      retentionDays: retentionDaysSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('continue'),
      runId: z.string().uuid(),
    })
    .strict(),
]);

export type ArchiveRunRequest = z.infer<typeof archiveRunRequestSchema>;
