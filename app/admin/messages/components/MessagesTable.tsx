'use client';

/**
 * The Messages table (Admin Layout Standard L-7, §2.4): the `adminTable`
 * constants, status and priority chips, "Received (UTC)" with an age line, a
 * named Delete, and the Open button as an icon in a narrow last column (LF-8,
 * user request 2026-10-15). No Reply control (D-14 (b), R-15).
 *
 * The whole row also opens, as before, under the six D-17 rules (SA M-3):
 * the `tr` takes `onClick` and `cursor-pointer` only; a click on a control
 * inside the row (the Open button and Delete included) is ignored; a click
 * while text is selected in the row is ignored; otherwise the row opens
 * through the same `onOpen` with that row's Open button as the opener; the
 * Open button stays the keyboard path; the drawer is page-level, outside this
 * table. The two helpers are a page-local copy of the Businesses ones (one
 * page may not import another page's folder, §3 rule 1; SA N-1).
 */

import type { MouseEvent } from 'react';
import { Building, Mail, MessageSquare, Trash2 } from 'lucide-react';

import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_OPEN,
  ADMIN_TH,
  ADMIN_TH_OPEN,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';

import { DELETE_FAILED } from '../messagesFilters';
import { ageLine, priorityLabel, priorityTone, statusLabel, statusTone } from '../messagesFormat';
import type { ContactMessage } from '../messagesTypes';

/** D-17 rule 2: a click on any of these inside the row is not an "open". */
const ROW_CONTROL_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';

/** D-17 rule 3: the admin is selecting text inside this row. */
function isSelectingIn(row: HTMLElement): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const { anchorNode, focusNode } = selection;
  return Boolean((anchorNode && row.contains(anchorNode)) || (focusNode && row.contains(focusNode)));
}

/** The replies of a row, trusted only when they are an array (SA S-6): anything else is no thread. */
export function repliesOf(message: ContactMessage) {
  return Array.isArray(message.replies) ? message.replies : [];
}

/**
 * The status chip with its extras (§2.4): "Email sent" on a replied message
 * that says so, and the thread count. Each extra is a wrapper `span` with the
 * hover text, the icon hidden, and sr-only words (A-2, A-7; the L-5 pattern).
 */
export function MessageStatus({ message }: { message: ContactMessage }) {
  const replyCount = repliesOf(message).length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusChip tone={statusTone(message.status)} testId="message-status">
        {statusLabel(message.status)}
      </StatusChip>
      {message.status === 'replied' && message.email_sent && (
        <span title="Email sent" className="inline-flex items-center text-slate-400">
          <Mail className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Email sent</span>
        </span>
      )}
      {replyCount > 0 && (
        <span title="Has conversation thread" className="inline-flex items-center gap-1 text-xs text-slate-400">
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          <span aria-hidden="true">{replyCount}</span>
          <span className="sr-only">{`${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} in the thread`}</span>
        </span>
      )}
    </span>
  );
}

/** The priority chip beside the name; nothing for no or an unknown priority. */
export function MessagePriority({ priority }: { priority: string | undefined }) {
  const tone = priorityTone(priority);
  if (!tone || !priority) return null;
  return (
    <StatusChip tone={tone} testId="message-priority">
      {priorityLabel(priority)}
    </StatusChip>
  );
}

export interface MessagesTableProps {
  rows: readonly ContactMessage[];
  /** The message the drawer shows, if any (its row is tinted). */
  openId: string | null;
  /** The row whose last Delete failed (D-19): its action cell shows the line. */
  deleteFailedId: string | null;
  onOpen: (message: ContactMessage, opener: HTMLButtonElement) => void;
  /** Asks before deleting (LF-3b): the button is the dialog's opener, for focus return. */
  onDelete: (message: ContactMessage, opener: HTMLButtonElement) => void;
}

export function MessagesTable({ rows, openId, deleteFailedId, onOpen, onDelete }: MessagesTableProps) {
  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, message: ContactMessage) => {
    const row = event.currentTarget;
    const target = event.target;
    if (target instanceof Element) {
      const control = target.closest(ROW_CONTROL_SELECTOR);
      if (control && row.contains(control)) return;
    }
    if (isSelectingIn(row)) return;
    const button = row.querySelector<HTMLButtonElement>('[data-testid="row-open"]');
    if (!button) return;
    onOpen(message, button);
  };

  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} aria-label="Messages">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Contact</th>
            <th scope="col" className={ADMIN_TH}>Message</th>
            <th scope="col" className={ADMIN_TH}>Status</th>
            <th scope="col" className={ADMIN_TH}>Received (UTC)</th>
            <th scope="col" className={ADMIN_TH}>
              <span className="sr-only">Actions</span>
            </th>
            {/* LF-8: the Open button's narrow last column; its name is for screen readers only. */}
            <th scope="col" className={ADMIN_TH_OPEN}>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rows.map((message) => (
            // D-17 rule 1: a mouse extra only. No tabIndex, role, key handler or
            // ARIA here: the Open button is the keyboard path.
            <tr
              key={message.id}
              className={`cursor-pointer transition-colors hover:bg-slate-700/30 ${
                openId === message.id ? 'bg-slate-700/20' : ''
              }`}
              onClick={(event) => handleRowClick(event, message)}
            >
              <td className={ADMIN_TD}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm text-white ${message.status === 'unread' ? 'font-bold' : 'font-medium'}`}>
                    {message.name}
                  </p>
                  <MessagePriority priority={message.priority} />
                </div>
                <p className="text-sm text-slate-400">{message.email}</p>
                {message.company && (
                  <p className="flex items-center gap-1 text-xs text-slate-400">
                    <Building className="h-3 w-3" aria-hidden="true" />
                    {message.company}
                  </p>
                )}
              </td>
              <td className={ADMIN_TD}>
                {message.subject && (
                  <p className="mb-1 max-w-xs truncate text-sm font-medium text-white">{message.subject}</p>
                )}
                <p className="line-clamp-2 max-w-md text-sm text-slate-400">{message.message}</p>
              </td>
              <td className={ADMIN_TD}>
                <MessageStatus message={message} />
              </td>
              <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="row-received">
                <span className="block">{formatUtc(message.created_at)}</span>
                <span className="block text-xs text-slate-400">{ageLine(message.created_at)}</span>
              </td>
              <td className={ADMIN_TD}>
                <button
                  type="button"
                  onClick={(event) => onDelete(message, event.currentTarget)}
                  aria-label={`Delete message from ${message.name}`}
                  className="rounded p-1 text-red-400 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                {deleteFailedId === message.id && (
                  <p role="alert" data-testid="delete-failed" className="mt-1 text-xs text-red-300">
                    {DELETE_FAILED}
                  </p>
                )}
              </td>
              <td className={ADMIN_TD_OPEN}>
                <OpenRowButton
                  label={`Open message from ${message.name}`}
                  onOpen={(button) => onOpen(message, button)}
                  testId="row-open"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
