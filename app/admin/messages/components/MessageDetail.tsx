'use client';

/**
 * The body of the Messages drawer (Admin Layout Standard L-7, §2.7). Rendered
 * by the page with `key={message.id}`, so the notes edit mode, the draft and
 * the notes failure line belong to one message and never carry over to the
 * next. It reads the row from the page's `messages`, so the status it shows is
 * the list's, never a stale copy (§1.4).
 *
 * No Reply button, no Reply modal (D-14 (b), R-15). It sends nothing itself:
 * Mark as Unread and Save call the page, which sends the same PATCH bodies as
 * before.
 */

import { useState } from 'react';
import { Edit, MailOpen, Save } from 'lucide-react';

import { DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';

import { MARK_READ_FAILED, MARK_UNREAD_FAILED, NOTES_FAILED } from '../messagesFilters';
import { sourceLabel } from '../messagesFormat';
import type { ContactMessage } from '../messagesTypes';
import { MessagePriority, MessageStatus, repliesOf } from './MessagesTable';

const FAILURE_LINE = 'text-xs text-red-300';

export interface MessageDetailProps {
  message: ContactMessage;
  /** D-19: the open message's last status change failed ('read' = the mark-read sent on open). */
  statusFailure: 'read' | 'unread' | null;
  onMarkUnread: () => void;
  /** Sends the notes PATCH; true when the route answered ok (D-19 (f)). */
  onSaveNotes: (text: string) => Promise<boolean>;
}

export function MessageDetail({ message, statusFailure, onMarkUnread, onSaveNotes }: MessageDetailProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.admin_notes || '');
  const [notesFailed, setNotesFailed] = useState(false);
  const replies = repliesOf(message);

  const toggleNotes = async () => {
    if (!editing) {
      setEditing(true);
      return;
    }
    // D-19 (d): a new attempt clears the line first.
    setNotesFailed(false);
    const saved = await onSaveNotes(draft);
    if (saved) {
      setEditing(false);
    } else {
      // Today's behaviour kept: edit mode and the draft stay. D-19: say so.
      setNotesFailed(true);
    }
  };

  return (
    <>
      <DrawerSection title="Status" testId="drawer-status">
        <div className="flex flex-wrap items-center gap-2">
          <MessageStatus message={message} />
          <MessagePriority priority={message.priority} />
        </div>
        {message.status !== 'unread' && (
          <button type="button" onClick={onMarkUnread} className={`flex items-center gap-2 ${ADMIN_BUTTON}`}>
            <MailOpen className="h-4 w-4" aria-hidden="true" />
            Mark as Unread
          </button>
        )}
        {statusFailure && (
          <p role="alert" data-testid="status-failed" className={FAILURE_LINE}>
            {statusFailure === 'read' ? MARK_READ_FAILED : MARK_UNREAD_FAILED}
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Contact" testId="drawer-contact">
        <DrawerFields>
          <DrawerField label="Name">{message.name}</DrawerField>
          <DrawerField label="Email">{message.email}</DrawerField>
          {message.phone && <DrawerField label="Phone">{message.phone}</DrawerField>}
          {message.company && <DrawerField label="Company">{message.company}</DrawerField>}
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title="Details" testId="drawer-details">
        <DrawerFields>
          <DrawerField label="Received (UTC)">{formatUtc(message.created_at)}</DrawerField>
          {message.updated_at && <DrawerField label="Last updated (UTC)">{formatUtc(message.updated_at)}</DrawerField>}
          {message.source && (
            <DrawerField label="Source">
              <span className="capitalize">{sourceLabel(message.source)}</span>
            </DrawerField>
          )}
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title={message.subject ? `Subject: ${message.subject}` : 'Message'} testId="drawer-message">
        <div className="rounded-lg bg-slate-800/60 p-4">
          <p className="whitespace-pre-wrap leading-relaxed text-slate-200">{message.message}</p>
        </div>
      </DrawerSection>

      <DrawerSection title="Admin notes" testId="drawer-notes">
        <div>
          <button type="button" onClick={() => void toggleNotes()} className={`flex items-center gap-1 ${ADMIN_BUTTON}`}>
            {editing ? <Save className="h-3 w-3" aria-hidden="true" /> : <Edit className="h-3 w-3" aria-hidden="true" />}
            {editing ? 'Save' : 'Edit'}
          </button>
          {notesFailed && (
            <p role="alert" data-testid="notes-failed" className={`mt-1 ${FAILURE_LINE}`}>
              {NOTES_FAILED}
            </p>
          )}
        </div>
        {editing ? (
          <textarea
            aria-label="Admin notes"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Add internal notes about this message..."
          />
        ) : (
          <div className="rounded-lg bg-slate-800/60 p-4">
            <p className="text-slate-200">{message.admin_notes || 'No admin notes yet.'}</p>
          </div>
        )}
      </DrawerSection>

      {replies.length > 0 && (
        <DrawerSection title="Conversation thread" testId="drawer-thread">
          <div className="space-y-4">
            {replies.map((reply) => (
              <div key={reply.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    {reply.sender === 'admin' ? 'Admin Reply' : message.name}
                  </span>
                  <span className="text-xs text-slate-400">{formatUtc(reply.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-slate-200">{reply.content}</p>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
