'use client';

/**
 * "Invite friends" — a Founding Partner invites friends to Essentials
 * (invite-only signup, Slice 5a; FR-28 to FR-32, F5a-12).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RENDERS; IT DOES NOT DECIDE
 *
 * Self-contained, like `PlanSection`: it does its own fetch of
 * `/api/business-os/friend-invites` and renders NOTHING AT ALL, its own row
 * header included, unless the server says `eligible: true`. That covers the
 * switch being off, an account that is not an in-force champion, and a failed
 * load. The client never works out eligibility, the allowance or a status: the
 * server sends "N left", the allowance and each invite's status.
 *
 * It owns its row and its drawer (settings drawer review S-4) so the page needs
 * one import and one line, and so an ineligible account sees no empty header.
 * The fetch still runs on page load, not when the drawer opens: eligibility
 * decides whether the row exists at all (C-6), and the row shows "N left" from
 * that same answer (C-8).
 *
 * It imports nothing from the entitlements module: no plan, cohort or number is
 * named here. The words live in `inviteFriendsCopy.ts` (en/he/es); the language
 * and direction are the reader's display settings from `useLanguage()`. The
 * INVITE's language is chosen in the form, defaulting to the champion's saved
 * preference, which the server sends (C-8), never `LanguageContext`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE-TIME LINK (Q-5 (a), SA-2, C-6)
 *
 * The link from a send is a credential: whoever holds it can sign up on the
 * champion's invite, and it is never re-fetchable (the server stores a hash).
 * It is held in THIS component's state and nowhere else: not the page, not the
 * address, not browser storage, not a log line.
 *
 * The drawer is this component's child. Radix unmounts the drawer's content
 * when it closes, but this component (the row) stays mounted for the life of
 * the page, so the link is still here when the owner reopens the drawer, until
 * they press Dismiss or leave the page. No `forceMount`: a closed drawer keeps
 * no hidden copy of the link in the DOM. The draft (email, note, language)
 * lives here for the same reason, so closing loses nothing and there is nothing
 * to ask "discard?" about.
 *
 * While a send or a revoke is in flight the drawer refuses to close (C-4): its
 * answer, the link or the error, has to have somewhere to show.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Loader2, UserPlus } from 'lucide-react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

import {
  INVITE_FRIENDS_COPY,
  inviteFriendsErrorOf,
  inviteFriendsLocaleOf,
  type InviteFriendsErrorCode,
  type InviteFriendsStatus,
} from './inviteFriendsCopy';

const logger = createLogger({ module: 'BusinessOsInviteFriendsSection' });

const ENDPOINT = '/api/business-os/friend-invites';
const NOTE_MAX = 1000;

/** One invite, as the route sends it (F5a-9). Mirrored, not imported: the ops module is server-only. */
interface FriendInvite {
  id: string;
  email: string;
  createdAt: string;
  linkExpiresAt: string;
  status: InviteFriendsStatus;
  slotReturned: boolean;
}

interface EligibleSummary {
  eligible: true;
  allowance: number;
  remaining: number;
  defaultLanguage: string;
  languages: string[];
  invites: FriendInvite[];
  truncated: boolean;
}

type Load = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ready'; summary: EligibleSummary };

interface SentLink {
  link: string;
  emailSent: boolean;
}

function formatDay(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(date);
}

export function InviteFriendsSection() {
  const { isRTL, language, t } = useLanguage();
  const copy = INVITE_FRIENDS_COPY[inviteFriendsLocaleOf(language)];
  const ids = useId();
  const rowRef = useRef<HTMLButtonElement>(null);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [inviteLanguage, setInviteLanguage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<InviteFriendsErrorCode | null>(null);
  const [sent, setSent] = useState<SentLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body?.success || !body?.data?.eligible) {
        setLoad({ kind: 'hidden' });
        return;
      }
      setLoad({ kind: 'ready', summary: body.data as EligibleSummary });
    } catch (error) {
      // A failed load renders nothing: the section is an offer, not a status.
      logger.warn({ err: error }, 'Could not load the invite-friends section');
      setLoad({ kind: 'hidden' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Reached only once the drawer has let the close through (never mid-send or
   * mid-revoke). Clears what would read wrong on reopen: a half-answered revoke
   * confirmation, a stale "Copied", an old error. `sent` is NOT cleared: the
   * link survives a close until Dismiss or leaving the page (Q-5 (a)).
   */
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) return;
    setConfirming(null);
    setCopied(false);
    setSendError(null);
    setRevokeError(false);
  }, []);

  if (load.kind !== 'ready') return null;
  const summary = load.summary;
  const selectedLanguage = inviteLanguage ?? summary.defaultLanguage;

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setSendError(null);
    setSent(null);
    setCopied(false);
    try {
      const trimmedNote = note.trim();
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          language: selectedLanguage,
          ...(trimmedNote.length > 0 ? { personalNote: trimmedNote } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        setSendError(inviteFriendsErrorOf(body?.error));
        await refresh();
        return;
      }
      const status = body.data?.email?.status;
      setSent({ link: String(body.data.link), emailSent: status === 'sent' || status === 'sent_untracked' });
      setEmail('');
      setNote('');
      await refresh();
    } catch (error) {
      logger.warn({ err: error }, 'Could not send a friend invite');
      setSendError('generic');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    setRevoking(inviteId);
    setRevokeError(false);
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(inviteId)}/revoke`, { method: 'POST' });
      if (!response.ok) setRevokeError(true);
    } catch (error) {
      logger.warn({ err: error }, 'Could not revoke a friend invite');
      setRevokeError(true);
    } finally {
      setConfirming(null);
      setRevoking(null);
      await refresh();
    }
  };

  const handleCopy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch (error) {
      logger.warn({ err: error }, 'Could not copy the invite link');
    }
  };

  return (
    // The id is the champion email's anchor (`INVITER_ACTION_PATHS.champion`,
    // C-6). It stays on this always-rendered row, never inside the drawer.
    <div id="settings-section-invite-friends" data-testid="invite-friends-section" dir={isRTL ? 'rtl' : 'ltr'}>
      <button
        ref={rowRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-[var(--v2-bg)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <UserPlus className="w-5 h-5 text-[var(--v2-text-muted)]" aria-hidden="true" />
          <span className="text-sm text-[var(--v2-text-primary)]">{copy.sectionTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* From the page-load answer: no extra request (C-8). */}
          <span data-testid="invite-friends-row-value" className="text-xs text-[var(--v2-text-muted)]">
            {copy.remaining(summary.remaining, summary.allowance)}
          </span>
          <ChevronRight
            className={cn('w-4 h-4 text-[var(--v2-text-muted)]', isRTL && 'scale-x-[-1]')}
            aria-hidden="true"
          />
        </div>
      </button>

      <SettingsDrawer
        open={open}
        onOpenChange={handleOpenChange}
        title={copy.sectionTitle}
        isBusy={sending || revoking !== null}
        isRTL={isRTL}
        closeLabel={t('common.close')}
        returnFocusRef={rowRef}
        testId="settings-invite-drawer"
      >
        <div className="space-y-4 text-sm text-[var(--v2-text-primary)]">
          <p className="text-[var(--v2-text-secondary)]">{copy.intro(summary.allowance)}</p>
          <p data-testid="invite-friends-remaining" className="font-medium">
            {copy.remaining(summary.remaining, summary.allowance)}
          </p>

          {sent && (
            <div data-testid="invite-friends-link" role="status" className="space-y-2 rounded-lg bg-[var(--v2-bg)] p-3">
              <p className="font-medium">{copy.linkHeading}</p>
              {!sent.emailSent && <p className="text-[var(--v2-text-secondary)]">{copy.emailNotSent}</p>}
              <p className="text-[var(--v2-text-secondary)]">{copy.linkBody}</p>
              <input
                readOnly
                aria-label={copy.copyLink}
                value={sent.link}
                dir="ltr"
                className="w-full rounded border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2 py-1 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(sent.link)}
                  className="rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  {copied ? copy.copied : copy.copyLink}
                </button>
                <button
                  type="button"
                  onClick={() => setSent(null)}
                  className="rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs"
                >
                  {copy.dismiss}
                </button>
              </div>
            </div>
          )}

          {summary.remaining > 0 ? (
            <form data-testid="invite-friends-form" onSubmit={(event) => void handleSend(event)} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor={`${ids}-email`} className="block text-xs font-medium text-[var(--v2-text-secondary)]">
                  {copy.emailLabel}
                </label>
                <input
                  id={`${ids}-email`}
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="off"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${ids}-note`} className="block text-xs font-medium text-[var(--v2-text-secondary)]">
                  {copy.noteLabel}
                </label>
                <textarea
                  id={`${ids}-note`}
                  maxLength={NOTE_MAX}
                  rows={3}
                  value={note}
                  aria-describedby={`${ids}-note-hint`}
                  onChange={(event) => setNote(event.target.value)}
                  className="w-full rounded border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2"
                />
                <p id={`${ids}-note-hint`} className="text-xs text-[var(--v2-text-muted)]">
                  {copy.noteHint}
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${ids}-language`} className="block text-xs font-medium text-[var(--v2-text-secondary)]">
                  {copy.languageLabel}
                </label>
                <select
                  id={`${ids}-language`}
                  value={selectedLanguage}
                  onChange={(event) => setInviteLanguage(event.target.value)}
                  className="rounded border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2"
                >
                  {summary.languages.map((code) => (
                    <option key={code} value={code}>
                      {copy.languageNames[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
              {sendError && (
                <p data-testid="invite-friends-error" role="alert" className="text-red-600">
                  {copy.errors[sendError](summary.allowance)}
                </p>
              )}
              <button
                type="submit"
                disabled={sending}
                className="flex items-center gap-2 rounded bg-[var(--v2-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {sending ? copy.sending : copy.send}
              </button>
            </form>
          ) : (
            <p data-testid="invite-friends-all-in-use" className="text-[var(--v2-text-secondary)]">
              {copy.allInUse(summary.allowance)}
            </p>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-[var(--v2-text-muted)]">{copy.listHeading}</h3>
            {revokeError && (
              <p role="alert" className="text-red-600">
                {copy.revokeFailed}
              </p>
            )}
            {summary.invites.length === 0 ? (
              <p className="text-[var(--v2-text-secondary)]">{copy.empty}</p>
            ) : (
              <ul data-testid="invite-friends-list" className="divide-y divide-[var(--v2-border)]">
                {summary.invites.map((invite) => (
                  <li key={invite.id} data-testid={`invite-friends-row-${invite.id}`} className="py-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span dir="ltr" className="font-mono text-xs">
                        {invite.email}
                      </span>
                      <span data-testid="invite-friends-status" className="rounded bg-[var(--v2-bg)] px-2 py-0.5 text-xs">
                        {copy.status[invite.status]}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {copy.sentOn(formatDay(invite.createdAt, language))}
                      {invite.slotReturned && <> · {copy.slotReturned}</>}
                    </p>
                    {invite.status === 'pending' &&
                      (confirming === invite.id ? (
                        <div className="flex flex-wrap items-center gap-2" role="group">
                          <span className="text-xs">{copy.revokeConfirm(invite.email)}</span>
                          <button
                            type="button"
                            disabled={revoking === invite.id}
                            onClick={() => void handleRevoke(invite.id)}
                            className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
                          >
                            {copy.revokeYes}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            className="rounded border border-[var(--v2-border)] px-2 py-1 text-xs"
                          >
                            {copy.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(invite.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {copy.revoke}
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SettingsDrawer>
    </div>
  );
}
