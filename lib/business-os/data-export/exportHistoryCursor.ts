// lib/business-os/data-export/exportHistoryCursor.ts
//
// Module export MX-4b (workplan BUSINESS_OS_EXPORT_MX4_WORKPLAN.md §5.1 H-1;
// SA workplan review Q-10 with C-4): the "Show older" keyset cursor of the
// export history, and the page size it moves by.
//
// Shared by the owner route (query validation) and the request repository
// (the keyset filter). A pure file with Zod only, so the route's tests, which
// mock the repository module wholesale, still get the real schema.
//
// SA C-4: the cursor time goes back to the database exactly as the database
// wrote it. It is pattern-checked here and never re-serialised through `Date`
// (`toISOString` drops microseconds and would skip or repeat rows at a page
// edge). The pattern admits only digits and `-:.+TZ ` and a space, so a value
// placed inside the double-quoted `.or()` filter cannot close the quote or add
// a condition. Character classes, not backslash escapes (the repo's Tailwind
// hazard).

import { z } from 'zod';

/** Requests per history page (SA MX1B-9). The repository's default limit is this number. */
export const HISTORY_PAGE_SIZE = 20;

/** A `timestamptz` as PostgREST writes it: date, `T` or a space, time, up to six fraction digits, `Z` or an offset. */
export const HISTORY_CURSOR_TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$/;

/** The longest such string is 32 characters; the cap stops anything long before the pattern runs. */
export const HISTORY_CURSOR_TIMESTAMP_MAX = 40;

export const historyCursorTimestampSchema = z.string().max(HISTORY_CURSOR_TIMESTAMP_MAX).regex(HISTORY_CURSOR_TIMESTAMP);

/** The cursor: the last request of the page already shown. */
export const historyCursorSchema = z.object({ requestedAt: historyCursorTimestampSchema, id: z.string().uuid() }).strict();
export type ExportHistoryCursor = z.infer<typeof historyCursorSchema>;

/**
 * The GET query: nothing, or the whole cursor (`before` + `beforeId`). Strict,
 * so `userId` or any other key is refused.
 */
export const historyQuerySchema = z
  .object({ before: historyCursorTimestampSchema, beforeId: z.string().uuid() })
  .partial()
  .strict()
  .refine((q) => (q.before === undefined) === (q.beforeId === undefined), { message: 'before and beforeId go together' });
