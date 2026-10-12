'use client';

/**
 * Messages (Admin Layout Standard L-7): the contact-form inbox.
 *
 * Header → filter bar (Search page-held, Status in the URL) → content area
 * (always mounted: loading, error, empty, or the count line and the table) →
 * one page-level drawer keyed by the open message. Every request is the one
 * the page sent before L-7: the list GET, the status PATCH, the notes PATCH and
 * the DELETE, with the same URLs and bodies. The Reply control, its modal and
 * its handler are gone (D-14 (b), R-15); no reply route is called.
 *
 * Action failures (user decision D-19, SA M-1) show one fixed line next to the
 * action. PATCH and DELETE bodies are never read (`response.ok` only, as
 * before), so a route's error text cannot reach the screen.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { AdminDrawer } from '@/app/admin/components/layout/AdminDrawer';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import {
  AdminFilterBar,
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_BUTTON, ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import { MessageDetail } from './components/MessageDetail';
import { MessagesTable } from './components/MessagesTable';
import {
  MARK_ALL_READ_FAILED,
  MESSAGES_FILTER_SPEC,
  MESSAGES_READ_FALLBACK,
  MESSAGES_WHAT,
  toMessageStatusFilter,
  type MessageStatusFilter,
} from './messagesFilters';
import { countLine, visibleMessages } from './messagesFormat';
import type { ContactMessage } from './messagesTypes';

/**
 * Facts only (SA M-4): HTTP status, counts, `hasSearch`, the status filter and
 * the message id. Never a name, email, phone, company, subject, message text,
 * notes or the search text.
 */
const logger = clientLogger.child({ module: 'AdminMessagesPage' });

const PURPOSE = 'Messages sent through the contact form: read them, keep internal notes, and mark them read or unread.';

const SEARCH_DEBOUNCE_MS = 300;

/** D-19: which status change failed, for which message (shown only while that message is open). */
interface StatusFailure {
  id: string;
  kind: 'read' | 'unread';
}

export default function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  /** A list read has succeeded since the last failure (§5.10). */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the list was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);
  // The drawer (§2.7, the L-1d / L-4b way): `isOpen` drives the panel and
  // `openId` names its message; closing clears only `isOpen`, so the body stays
  // during the slide-out.
  const [isOpen, setIsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The row's Open button: focus goes back to it on close (D-6), whichever path opened it (D-17). */
  const opener = useRef<HTMLButtonElement | null>(null);
  // D-19 (SA M-1 (c)): page-held failure lines.
  const [statusFailure, setStatusFailure] = useState<StatusFailure | null>(null);
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const [markAllFailed, setMarkAllFailed] = useState(false);

  // Status lives in the URL (`?status=`, `all` omitted); the search text is
  // page state and never reaches the address bar (SA-R-8, D-6 (a)).
  const { filters, setFilters, clear, isDefault } = useAdminFilters(MESSAGES_FILTER_SPEC);
  const filter: MessageStatusFilter = toMessageStatusFilter(filters.status);
  const [searchTerm, setSearchTerm] = useState('');

  const searchId = useId();
  const statusId = useId();
  /** Always mounted, so focus has a connected place to land (§5.12 A-3). */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Newest read wins (§5.10): only the read holding the latest number may set read state. */
  const readSeq = useRef(0);
  /** The search text of the last read STARTED, whoever started it (D-16, the L-4a M-1 mechanism). */
  const lastSearched = useRef<string | null>(null);
  /** Focus was inside the content area when the newest read started. */
  const focusWasInside = useRef(false);
  /** Bumped when the newest read settles; the focus fallback runs after that commit. */
  const [settledReads, setSettledReads] = useState(0);
  /** What the next read asks for. A ref, so `fetchMessages` keeps one identity. */
  const query = useRef<{ status: MessageStatusFilter; search: string }>({ status: filter, search: searchTerm });

  const fetchMessages = useCallback(async () => {
    const { status, search } = query.current;
    readSeq.current += 1;
    const seq = readSeq.current;
    const isNewest = () => seq === readSeq.current;
    lastSearched.current = search;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    focusWasInside.current = Boolean(active && contentRef.current?.contains(active));
    const facts = { filter: status, hasSearch: search.trim() !== '' };

    setLoading(true);
    setError(null);

    // On failure the list is cleared, as before; the error now says so (F-9).
    const fail = (message: string) => {
      setError(message);
      setMessages([]);
      setHasLoaded(false);
    };

    try {
      const queryParams = new URLSearchParams({
        filter: status,
        search,
      });

      // Only the fetch sits inside this try: a rejection here is a network failure.
      let response: Response;
      try {
        response = await fetch(`/api/admin/messages?${queryParams}`);
      } catch (err) {
        logger.error({ err, ...facts }, 'Failed to fetch messages');
        if (isNewest()) fail(ADMIN_NETWORK_ERROR);
        return;
      }

      if (!response.ok) {
        // §5.10 via the shared helper; a non-ok response only reaches its
        // failure branches (session ended, the route's error, the fallback).
        const result = await readAdminResponse<never>(response, { what: MESSAGES_WHAT, sessionEndedCopy: true });
        logger.warn({ httpStatus: response.status, ...facts }, 'Messages read failed');
        if (isNewest()) fail(result.ok ? MESSAGES_READ_FALLBACK : result.message);
        return;
      }

      // F-111: the 200 is `{ messages }` with no `success`, so the shared helper
      // cannot read it; the page reads it, trusting only an array (SA S-6).
      const body = (await readJsonBody(response)) as Readonly<Record<string, unknown>> | null;
      if (!isNewest()) return;
      const rows = body?.messages;
      if (!Array.isArray(rows)) {
        logger.warn({ httpStatus: response.status, ...facts }, 'Messages read returned no list');
        fail(MESSAGES_READ_FALLBACK);
        return;
      }

      setMessages(rows as ContactMessage[]);
      setHasLoaded(true);
      setReadAt(new Date().toISOString());
    } finally {
      if (isNewest()) {
        setLoading(false);
        setSettledReads((n) => n + 1);
      }
    }
  }, []);

  // Declared before the reads below, so they see this render's status and search.
  useEffect(() => {
    query.current = { status: filter, search: searchTerm };
  }, [filter, searchTerm]);

  useEffect(() => {
    void fetchMessages();
  }, [filter, fetchMessages]);

  // D-16 (SA Q-2): after the pause, read when, and only when, the text differs
  // from the text of the last read started. That covers an emptied box, skips
  // the mount, and skips a second read when the status changed inside the pause.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== lastSearched.current) {
        void fetchMessages();
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, fetchMessages]);

  // §5.12 A-3: focus that was inside the content area and fell to <body> with
  // the old content (Try again) goes to the content area once the newest read settles.
  useEffect(() => {
    if (!focusWasInside.current) return;
    focusWasInside.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) contentRef.current?.focus();
  }, [settledReads]);

  /** The status PATCH, unchanged. True when the route answered ok (D-19 (f)). */
  const updateMessageStatus = async (messageId: string, status: ContactMessage['status']): Promise<boolean> => {
    let response: Response;
    try {
      response = await fetch(`/api/admin/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      });
    } catch (err) {
      logger.error({ err, messageId }, 'Failed to update message status');
      return false;
    }

    if (!response.ok) {
      logger.warn({ httpStatus: response.status, messageId }, 'Message status update failed');
      return false;
    }

    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, status, updated_at: new Date().toISOString() } : msg)),
    );
    return true;
  };

  /** The notes PATCH, unchanged. True when the route answered ok. */
  const saveAdminNotes = async (messageId: string, adminNotes: string): Promise<boolean> => {
    let response: Response;
    try {
      response = await fetch(`/api/admin/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_notes: adminNotes,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      logger.error({ err, messageId }, 'Failed to save admin notes');
      return false;
    }

    if (!response.ok) {
      logger.warn({ httpStatus: response.status, messageId }, 'Saving admin notes failed');
      return false;
    }

    setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, admin_notes: adminNotes } : msg)));
    return true;
  };

  const deleteMessage = async (message: ContactMessage) => {
    // Kept: the native confirm, same words (SA Q-8; F-10 stays open).
    if (!confirm('Are you sure you want to delete this message?')) return;
    // D-19 (d): a new attempt clears the line.
    setDeleteFailedId(null);

    let response: Response;
    try {
      response = await fetch(`/api/admin/messages/${message.id}`, {
        method: 'DELETE',
      });
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Failed to delete message');
      setDeleteFailedId(message.id);
      return;
    }

    if (!response.ok) {
      logger.warn({ httpStatus: response.status, messageId: message.id }, 'Deleting message failed');
      setDeleteFailedId(message.id);
      return;
    }

    // The row leaves `messages`; an open drawer on it closes (close-when-gone below).
    setMessages((prev) => prev.filter((msg) => msg.id !== message.id));
  };

  const markAllRead = async () => {
    // Kept: the native confirm, same words, the same fan-out and one re-read (SA Q-8; F-12 stays open).
    if (!confirm('Mark all messages as read?')) return;
    setMarkAllFailed(false);
    const unread = messages.filter((m) => m.status === 'unread');
    const results = await Promise.all(unread.map((m) => updateMessageStatus(m.id, 'read')));
    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) {
      logger.warn({ failed, total: unread.length }, 'Mark all read: some updates failed');
      setMarkAllFailed(true);
    }
    void fetchMessages();
  };

  /** The one way a row opens, from its Open button or a row click (D-17): same opener, same request. */
  const openRow = (message: ContactMessage, button: HTMLButtonElement) => {
    opener.current = button;
    setOpenId(message.id);
    setIsOpen(true);
    // Opening again is the retry of a failed mark-read (D-19 (a)).
    setStatusFailure((prev) => (prev?.id === message.id ? null : prev));
    // The same single PATCH as before, sent as the drawer opens (SA Q-3).
    if (message.status === 'unread') {
      void updateMessageStatus(message.id, 'read').then((ok) => {
        if (!ok) setStatusFailure({ id: message.id, kind: 'read' });
      });
    }
  };

  const markUnread = async (messageId: string) => {
    setStatusFailure((prev) => (prev?.id === messageId ? null : prev));
    const ok = await updateMessageStatus(messageId, 'unread');
    if (!ok) setStatusFailure({ id: messageId, kind: 'unread' });
  };

  /** §5.5 part 5: back to the defaults (All, empty search). Exactly one read follows. */
  const clearAll = () => {
    clear();
    setSearchTerm('');
  };

  const shown = visibleMessages(messages, filter, searchTerm);
  const hasUnread = messages.some((m) => m.status === 'unread');
  const isFiltered = filter !== 'all' || searchTerm !== '';

  /**
   * The open message, looked up in ALL loaded messages, not the rows on screen
   * (SA Q-7): under "Unread", opening marks the row read and the client filter
   * hides it, and the drawer must stay open.
   */
  const selected = openId === null ? null : messages.find((m) => m.id === openId) ?? null;

  // Close when gone (QA B-1, L-1d): the open message left `messages` (deleted,
  // a read without it, a failed read). End the open state, so a later read that
  // brings it back does not reopen the drawer unasked.
  useEffect(() => {
    if (isOpen && selected === null) {
      setIsOpen(false);
      setOpenId(null);
    }
  }, [isOpen, selected]);

  // D-6: back to the row's Open button; when that row is not on screen its
  // button is detached, so focus goes to the content area, never <body>.
  const returnFocus = () => {
    if (opener.current?.isConnected) opener.current.focus();
    else contentRef.current?.focus();
  };

  const headerActions =
    hasUnread || markAllFailed ? (
      <>
        {markAllFailed && (
          <p role="alert" data-testid="mark-all-failed" className="text-xs text-red-300">
            {MARK_ALL_READ_FAILED}
          </p>
        )}
        {hasUnread && (
          <button type="button" onClick={() => void markAllRead()} className={ADMIN_BUTTON}>
            Mark All Read
          </button>
        )}
      </>
    ) : undefined;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Messages" purpose={PURPOSE} actions={headerActions} />

      <AdminFilterBar
        what={MESSAGES_WHAT}
        busy={loading}
        onRefresh={() => void fetchMessages()}
        readAt={readAt}
        onClear={clearAll}
        canClear={!isDefault || searchTerm !== ''}
      >
        <div className="w-full sm:w-64">
          <label htmlFor={searchId} className={ADMIN_FIELD_LABEL}>
            Search
          </label>
          <input
            id={searchId}
            type="text"
            placeholder="Search messages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${ADMIN_FIELD_CONTROL} w-full`}
          />
        </div>
        <div>
          <label htmlFor={statusId} className={ADMIN_FIELD_LABEL}>
            Status
          </label>
          <select
            id={statusId}
            value={filter}
            onChange={(e) => setFilters({ status: toMessageStatusFilter(e.target.value) })}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="all">All Messages</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="replied">Replied</option>
          </select>
        </div>
      </AdminFilterBar>

      {/* Always mounted (§5.10, F-17): a read never unmounts the header, the bar or the search box. */}
      <div
        ref={contentRef}
        tabIndex={-1}
        aria-busy={loading}
        data-testid="messages-content"
        className="space-y-4 focus:outline-none"
      >
        {error && <AdminError message={error} testId="messages-error" onRetry={() => void fetchMessages()} />}
        {!error && !hasLoaded && <AdminLoading what={MESSAGES_WHAT} />}

        {!error && hasLoaded && shown.length === 0 && (
          <AdminEmpty
            testId="messages-empty"
            message={isFiltered ? 'No messages match this search or status.' : 'No messages yet.'}
            onClear={isFiltered ? clearAll : undefined}
          />
        )}

        {!error && hasLoaded && shown.length > 0 && (
          <>
            <p data-testid="messages-count" className={ADMIN_COUNT_LINE}>
              {countLine(shown)}
            </p>
            <MessagesTable
              rows={shown}
              openId={isOpen ? openId : null}
              deleteFailedId={deleteFailedId}
              onOpen={openRow}
              onDelete={(message) => void deleteMessage(message)}
            />
          </>
        )}
      </div>

      {/* One drawer for the page, outside the content area and every state
          branch (L-2b SA M-4), keyed by the open message. Being outside the
          table also keeps clicks inside it from reaching a row (D-17 rule 6). */}
      <AdminDrawer
        open={isOpen && selected !== null}
        onClose={() => setIsOpen(false)}
        onReturnFocus={returnFocus}
        title={selected ? `Message from ${selected.name}` : ''}
        titleSuffix={selected ? formatUtc(selected.created_at) : undefined}
        testId="message-drawer"
      >
        {selected && (
          <MessageDetail
            key={selected.id}
            message={selected}
            statusFailure={statusFailure?.id === selected.id ? statusFailure.kind : null}
            onMarkUnread={() => void markUnread(selected.id)}
            onSaveNotes={(text) => saveAdminNotes(selected.id, text)}
          />
        )}
      </AdminDrawer>
    </div>
  );
}
