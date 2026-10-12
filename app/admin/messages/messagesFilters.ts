/**
 * The Messages filter state in the URL (Admin Layout Standard L-7, §2.3).
 *
 * Exactly one key, `status` (`?status=unread|read|replied`, `all` omitted,
 * an unknown value ignored). The search text is NOT here, not even as a
 * page-only field: a page-only field is still read from an inbound link, and
 * the search never belongs in the address bar (SA-R-8, D-6 (a)). The page
 * holds it in `useState`.
 *
 * Module level, so the hook sees a stable spec.
 */

import { textFilter } from '@/app/admin/components/layout/useAdminFilters';

export type MessageStatusFilter = 'all' | 'unread' | 'read' | 'replied';

const STATUS_FILTERS: readonly MessageStatusFilter[] = ['all', 'unread', 'read', 'replied'];

export function isMessageStatusFilter(raw: string): raw is MessageStatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(raw);
}

/** The typed narrow that replaced the old `as any` cast on the select. */
export function toMessageStatusFilter(raw: string): MessageStatusFilter {
  return isMessageStatusFilter(raw) ? raw : 'all';
}

export const MESSAGES_FILTER_SPEC = {
  status: textFilter({ key: 'status', defaultValue: 'all', isValid: isMessageStatusFilter }),
};

/** Noun phrase for the shared states and Refresh ("Reading messages…", "Refresh messages"). */
export const MESSAGES_WHAT = 'messages';

/**
 * A 200 the page cannot read (no JSON, or no `messages` array). The same words
 * as the shared fallback (§5.10 rule 2); a page constant because the route's
 * 200 has no `success` flag, so the shared helper cannot read it (F-111).
 */
export const MESSAGES_READ_FALLBACK = 'Could not read messages. Try again in a moment.';

/** D-19 (user, 2026-10-12; SA M-1 (a)): the fixed words shown when an action fails. */
export const NOTES_FAILED = 'Could not save the notes. Try again.';
export const MARK_UNREAD_FAILED = 'Could not mark the message as unread. Try again.';
export const MARK_READ_FAILED = 'Could not mark the message as read.';
export const DELETE_FAILED = 'Could not delete the message. Try again.';
export const MARK_ALL_READ_FAILED = 'Could not mark every message as read. Try again.';
