/**
 * Pure display helpers of the Messages screen, shared by the table and the
 * drawer body (Admin Layout Standard L-7, §3.2). Client-safe, no markup, no read.
 */

import { formatCount } from '@/app/admin/components/layout/adminFormat';
import type { StatusTone } from '@/app/admin/components/layout/StatusChip';

import type { MessageStatusFilter } from './messagesFilters';
import type { ContactMessage, MessageStatus } from './messagesTypes';

const MS_PER_HOUR = 3_600_000;

/**
 * The age line under a UTC time (§5.11: relative time only as a secondary hint;
 * the L-4a SA M-3 form). Always relative, never a locale date.
 */
export function ageLine(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const hours = Math.floor((Date.now() - time) / MS_PER_HOUR);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** §5.9: "unread" is `info`; Read and Replied are plain state words (Replied proves no delivery, F-1; SA Q-4). */
export function statusTone(status: MessageStatus): StatusTone {
  return status === 'unread' ? 'info' : 'neutral';
}

export function statusLabel(status: MessageStatus): string {
  if (status === 'unread') return 'Unread';
  if (status === 'read') return 'Read';
  return 'Replied';
}

/** SA Q-5: Low / Normal neutral, High warn, Urgent danger. Null for no or an unknown priority (no chip). */
export function priorityTone(priority: string | undefined): StatusTone | null {
  if (priority === 'low' || priority === 'normal') return 'neutral';
  if (priority === 'high') return 'warn';
  if (priority === 'urgent') return 'danger';
  return null;
}

/** The same words as before: the value with its first letter capitalised. */
export function priorityLabel(priority: string): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** The same words as before (`replace('_', ' ')`; the cell keeps `capitalize`). */
export function sourceLabel(source: string): string {
  return source.replace('_', ' ');
}

/** §5.7 count line over the rows shown (SA Q-1): "12 messages, 3 unread, newest first"; the unread part omitted at 0. */
export function countLine(rows: readonly ContactMessage[]): string {
  const total = rows.length;
  const unread = rows.filter((row) => row.status === 'unread').length;
  const noun = total === 1 ? 'message' : 'messages';
  const unreadPart = unread > 0 ? `, ${formatCount(unread)} unread` : '';
  return `${formatCount(total)} ${noun}${unreadPart}, newest first`;
}

/**
 * The client filter over the server's result (kept from the old page): status,
 * then a five-field substring search, newest first. Sorts a COPY: the old code
 * sorted the state array in place when no filter was on (SA S-1).
 */
export function visibleMessages(
  messages: readonly ContactMessage[],
  status: MessageStatusFilter,
  searchTerm: string,
): ContactMessage[] {
  let filtered = [...messages];
  if (status !== 'all') {
    filtered = filtered.filter((msg) => msg.status === status);
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(
      (msg) =>
        msg.name.toLowerCase().includes(term) ||
        msg.email.toLowerCase().includes(term) ||
        msg.message.toLowerCase().includes(term) ||
        (msg.subject ?? '').toLowerCase().includes(term) ||
        (msg.company ?? '').toLowerCase().includes(term),
    );
  }
  return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
