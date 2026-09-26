/**
 * Zod schemas for archiving inputs (FR-2).
 *
 * Both are BUILT from the constants in `lib/archiving/config.ts`, the same
 * constants the page's dropdown reads, so the client and the server cannot
 * disagree about what is allowed. Nothing in Slice 1 consumes them at runtime
 * (the overview GET has no input); Slice 2's `POST /api/admin/archiving/runs`
 * does.
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
