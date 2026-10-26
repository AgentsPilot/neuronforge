'use client';

/**
 * The inbox channel, as every surface shows it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COMPONENT, FOUR PLACES
 *
 * The Channels section, the onboarding build page, My Day and the readiness
 * list all have to say something about this channel, and they must not say
 * different things. They render this, in one of two sizes:
 *
 *   `tile`  — the Channels grid, beside Facebook and Google. Logo, one line,
 *             one button. It sits next to other providers and must not be
 *             taller or louder than they are.
 *   `row`   — a full-width card for My Day, onboarding and readiness, with
 *             room for what it is watching and what is wrong.
 *
 * Same state, same words, same button. A surface chooses a size, never a
 * meaning.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RENDERS NOTHING RATHER THAN GUESSING
 *
 * While the status is unknown it draws nothing at all. A card that flashes
 * "not connected" and then corrects itself to "running" has told the owner
 * their channel is off, which is the one thing they would act on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WARNING IS NOT DECORATION
 *
 * `replies_off` means leads are filing and no client is being answered.
 * Nothing errors, no log is red, and the card looks healthy from every angle
 * except the client's — so it is drawn ON the card, in the warning tone, with
 * the fix beside it. A surface may not render this component and hide that.
 */

import { useEffect, useState } from 'react';
import { Mail, AlertTriangle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PluginIcon } from '@/components/PluginIcon';
import type {
  InboxChannelProblem,
  InboxChannelStatus,
} from '@/lib/business-os/leads/inboxChannel';
/* The leaf module, by VALUE. `inboxChannel` imports `supabaseServer`, so a
   value import from it would pull the service-role client into this bundle. */
import { PROVIDER_NAMES } from '@/lib/business-os/leads/inboxProviders';

export interface InboxChannelCardProps {
  /** How much room this surface has. Never what it means. */
  size?: 'tile' | 'row';
  /**
   * Pass a status the surface already fetched, to avoid a second request.
   * Omit it and the card fetches its own.
   */
  status?: InboxChannelStatus | null;
  /** Opens the setup dialog. The surface owns the dialog, not this card. */
  onSetUp: () => void;
  /** Where an owner goes to switch replies back on. */
  onFixReplies?: () => void;
  className?: string;
}

/**
 * Said in the owner's language. The English literals are the SPEC, not a
 * fallback: `t()` returns the key itself when a dictionary has no entry, so a
 * missing key renders `leads.inbox.title` rather than reaching the `||`. Every
 * key below exists in all three dictionaries under
 * `lib/business-os/translations/`.
 */
function useCopy() {
  const { t } = useLanguage();
  return {
    title: t('leads.inbox.title') || 'Leads from your website',
    blurb:
      t('leads.inbox.blurb') ||
      'Your website emails you when someone fills in your contact form. We file them as leads and reply with a link to book.',
    notConnected: t('leads.inbox.not_connected') || 'Not connected',
    paused: t('leads.inbox.paused') || 'Paused',
    watching: t('leads.inbox.watching') || 'Watching',
    setUp: t('leads.inbox.set_up') || 'Set up',
    resume: t('leads.inbox.resume') || 'Resume',
    change: t('leads.inbox.change') || 'Change which emails',
    problem: (p: InboxChannelProblem) =>
      ({
        replies_off:
          t('leads.inbox.problem.replies_off') ||
          'Leads are being filed, but “Reply to enquiries” is off, so nobody is being answered.',
        mailbox_disconnected:
          t('leads.inbox.problem.mailbox_disconnected') ||
          'The mailbox it reads is no longer connected, so nothing is arriving.',
        never_run:
          t('leads.inbox.problem.never_run') || 'It has not run yet. The first check happens shortly.',
      })[p],
    fix: t('leads.inbox.problem.fix') || 'Turn it on',
  };
}

export function InboxChannelCard({
  size = 'row',
  status: provided,
  onSetUp,
  onFixReplies,
  className = '',
}: InboxChannelCardProps) {
  const copy = useCopy();
  const [fetched, setFetched] = useState<InboxChannelStatus | null>(null);
  const [loading, setLoading] = useState(provided === undefined);

  useEffect(() => {
    if (provided !== undefined) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/business-os/leads/inbox/status');
        const body = await res.json().catch(() => null);
        if (live && body?.success) setFetched(body.data as InboxChannelStatus);
      } catch {
        /* Absent beats wrong: see the note at the top. */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [provided]);

  const status = provided ?? fetched;

  if (loading) {
    return size === 'tile' ? null : (
      <div className={`flex items-center gap-2 p-4 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" />
      </div>
    );
  }
  if (!status) return null;

  /*
   * Nothing to connect to, and nothing an owner can do about it from here.
   *
   * Every size, not just the tile. Setup's first screen offers the mailboxes
   * this owner has actually connected, so with none connected the button opens
   * a dialog with nothing in it — an invitation into a dead end. Connecting a
   * mail account is the plugins page's job, and this card is not the place to
   * send somebody there mid-setup.
   */
  if (status.channels.length === 0 && status.connectable.length === 0) {
    return null;
  }

  const running = status.state === 'running';

  /*
   * The account-level warning only. Each mailbox's own problems are drawn on
   * its own row below, where they name the mailbox they are about — a business
   * with Gmail working and Outlook disconnected must not be told "the mailbox
   * is disconnected" over the top of both.
   */
  const warning = status.problems.includes('replies_off') ? ('replies_off' as const) : undefined;

  const cardStyle = {
    borderRadius: 'var(--v2-radius-card)',
    boxShadow: 'var(--v2-shadow-card)',
  } as const;

  if (size === 'tile') {
    return (
      <div
        className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 ${className}`}
        style={cardStyle}
      >
        <div className="flex items-start gap-3">
          <Mail className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--v2-text-secondary)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
              {copy.title}
            </div>
            {/* One line for the whole account, which is all a tile has room
                for: the mailboxes by name when any are running, and the state
                when none are. The row size below lists them properly. */}
            <div className="text-xs text-[var(--v2-text-secondary)] truncate mt-0.5">
              {running
                ? `${copy.watching} ${status.channels
                    .filter(c => c.state === 'running')
                    .map(c => PROVIDER_NAMES[c.provider])
                    .join(', ')}`
                : copy.notConnected}
            </div>
          </div>
        </div>

        {/* The warning travels with the tile. A compact surface may not drop
            the one thing the owner needs to act on. */}
        {warning && (
          <div className="flex items-start gap-1.5 mt-3 text-[11px] text-[var(--v2-status-warning-text)]">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span className="leading-snug">{copy.problem(warning)}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onSetUp}
          className="mt-3 w-full px-3 py-2 text-sm font-medium border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {running ? copy.change : status.state === 'paused' ? copy.resume : copy.setUp}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 ${className}`}
      style={cardStyle}
    >
      <div className="flex items-start gap-3">
        <Mail className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--v2-text-secondary)]" />

        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-[var(--v2-text-primary)]">{copy.title}</div>

          {/* The blurb only while there is nothing to report. Once a mailbox is
              set up, the rows below say what is actually happening, and keeping
              the pitch above them reads as though nothing had been done. */}
          {status.channels.length === 0 && (
            <p className="text-sm text-[var(--v2-text-secondary)] mt-1 mb-0">{copy.blurb}</p>
          )}

          {/*
            ONE ROW PER MAILBOX.
            ────────────────────────────────────────────────────────────────
            A business can take enquiries at two addresses, and each is its
            own channel with its own template and its own health. Collapsing
            them into one line would mean a working Gmail channel hiding a
            disconnected Outlook one, which is the state this card exists to
            make visible.
          */}
          {status.channels.map(channel => (
            <div
              key={channel.provider}
              className="flex items-center gap-2 mt-2 text-xs text-[var(--v2-text-muted)]"
            >
              <span
                className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
                style={{
                  background:
                    channel.state === 'running' && channel.problems.length === 0
                      ? 'var(--v2-success-icon)'
                      : channel.problems.length > 0
                        ? 'var(--v2-status-warning-text)'
                        : 'var(--v2-text-muted)',
                }}
              />
              {/* The real brand mark, from the same assets and the same
                  component the Channels card uses. */}
              <PluginIcon pluginId={channel.provider} className="w-3.5 h-3.5 flex-shrink-0" alt="" />
              <span className="font-medium text-[var(--v2-text-secondary)] flex-shrink-0">
                {PROVIDER_NAMES[channel.provider]}
              </span>
              <span className="truncate" title={channel.watching ?? undefined}>
                {channel.problems[0]
                  ? copy.problem(channel.problems[0])
                  : channel.state === 'paused'
                    ? copy.paused
                    : (channel.watching ?? copy.watching)}
              </span>
            </div>
          ))}
        </div>

        {/*
          "Set up" names the mailbox when there is exactly one left to do, so a
          business that has finished Gmail and still has Outlook connected is
          told which one the button means rather than being offered a second
          generic setup.
        */}
        <button
          type="button"
          onClick={onSetUp}
          className="px-4 py-2 text-sm font-medium border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors flex-shrink-0"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {status.connectable.length === 1 && status.channels.length > 0
            ? `${copy.setUp} ${PROVIDER_NAMES[status.connectable[0]]}`
            : status.connectable.length > 0
              ? copy.setUp
              : status.state === 'paused'
                ? copy.resume
                : copy.change}
        </button>
      </div>

      {warning && (
        <div
          className="flex items-center gap-3 mt-3 px-3 py-2.5"
          style={{
            background: 'var(--v2-status-warning-bg)',
            border: '1px solid var(--v2-status-warning-border)',
            borderRadius: 'var(--v2-radius-button)',
          }}
        >
          <AlertTriangle
            className="w-4 h-4 flex-shrink-0"
            style={{ color: 'var(--v2-status-warning-text)' }}
          />
          <span
            className="flex-1 text-[13px] leading-snug"
            style={{ color: 'var(--v2-status-warning-text)' }}
          >
            {copy.problem(warning)}
          </span>
          {warning === 'replies_off' && onFixReplies && (
            <button
              type="button"
              onClick={onFixReplies}
              className="px-3 py-1.5 text-[13px] font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {copy.fix}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
