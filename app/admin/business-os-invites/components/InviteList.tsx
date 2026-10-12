'use client';

/**
 * FR-5 (the Slice 0 subset): the newest invites, each with its derived state.
 * Slice 1b adds, per row: the account and time of an accepted invite with its
 * invitation circle (L1), and the "signup stopped halfway" badge (T-16) with
 * the recorded step, error code, scrubbed message and account id. No email is
 * ever part of that record.
 *
 * Slice 2a adds the invitation email's status (`deriveInviteEmailStatus` on the
 * server): Not emailed, Sent, Sent (not tracked), Not sent or Unknown.
 *
 * The state arrives decided (`deriveInviteState` on the server); this list
 * never compares a date to decide whether a link has expired. Slice 1c's filters
 * and email search run in the page (`inviteFilter.ts`); this list renders
 * whatever rows it is given.
 *
 * ── Admin Layout Standard L-6 (§5.7, §5.9, §5.11) ───────────────────────────
 * The standard table: shared classes, unique headers ("Email status", F-40),
 * "(UTC)" on the date headers, `scope="col"`, a named table. State and email
 * status are `StatusChip`s (tones ruled by SA L-6 Q-3 / Q-4: Revoked is a
 * deliberate admin act, so neutral; "Sent (not tracked)" is not a proven
 * outcome, so info; Unknown keeps its amber prompt to check, so warn). The
 * revoke form stays inline under its row (D-8): no drawer (SA Q-7).
 */

import { useState } from 'react';

import { AdminEmpty } from '@/app/admin/components/layout/AdminStates';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TH,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';

import type { InviteEmailStatus, InviteRow, InviteState } from '../types';
import { RevokeDialog } from './RevokeDialog';

interface Props {
  invites: InviteRow[];
  onRevoked: (invite: InviteRow) => void;
  /** Slice 1c: "no invites yet" and "nothing matches" are different answers. */
  emptyMessage?: string;
  /** Set only while a filter is on: the empty state offers "Clear filters" (§5.10). */
  onClearFilters?: () => void;
}

const STATE_STYLE: Record<InviteState, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'ok' },
};

/** Slice 2a: the invitation email. "Sent" means the provider accepted it, not that it arrived. */
const EMAIL_STYLE: Record<InviteEmailStatus, { label: string; tone: StatusTone; title: string }> = {
  not_emailed: { label: 'Not emailed', tone: 'neutral', title: 'The link was copied, not emailed' },
  sent: { label: 'Sent', tone: 'ok', title: 'Accepted by the email provider' },
  sent_untracked: {
    label: 'Sent (not tracked)',
    tone: 'info',
    title: 'Sent through a fallback transport that reports no delivery',
  },
  not_sent: { label: 'Not sent', tone: 'danger', title: 'The email did not go out' },
  unknown: { label: 'Unknown', tone: 'warn', title: 'An email was attempted but no result was recorded' },
};

/**
 * A calendar date, the same everywhere: the ISO date part, in UTC (§5.11 date
 * form). Kept local: the shared `formatUtcDate` stays deferred (SA L-6 Q-6).
 */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export function InviteList({ invites, onRevoked, emptyMessage = 'No invites yet.', onClearFilters }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);

  if (invites.length === 0) {
    return <AdminEmpty testId="invite-list-empty" message={emptyMessage} onClear={onClearFilters} />;
  }

  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table data-testid="invite-list" aria-label="Invites" className={ADMIN_TABLE}>
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Email</th>
            <th scope="col" className={ADMIN_TH}>Plan</th>
            <th scope="col" className={ADMIN_TH}>Access</th>
            <th scope="col" className={ADMIN_TH}>Invited by</th>
            <th scope="col" className={ADMIN_TH}>Created (UTC)</th>
            <th scope="col" className={ADMIN_TH}>Link expires (UTC)</th>
            <th scope="col" className={ADMIN_TH}>State</th>
            <th scope="col" className={ADMIN_TH}>Email status</th>
            <th scope="col" className={ADMIN_TH}>First opened (UTC)</th>
            <th scope="col" className={ADMIN_TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {invites.map((invite) => {
            const style = STATE_STYLE[invite.state];
            const emailStyle = invite.emailStatus ? EMAIL_STYLE[invite.emailStatus] : undefined;
            const canRevoke = invite.state === 'pending' || invite.state === 'expired';
            return (
              <tr key={invite.id} data-testid={`invite-row-${invite.id}`}>
                <td className={`${ADMIN_TD} font-mono text-xs text-slate-200`}>{invite.email}</td>
                <td className={`${ADMIN_TD} text-slate-200`}>{invite.grantLabel}</td>
                <td className={`${ADMIN_TD} text-slate-400`}>{invite.accessSummary}</td>
                <td className={`${ADMIN_TD} text-slate-400`}>
                  {invite.inviterDisplayName}
                  {invite.issuerKind === 'account' && (
                    <p data-testid="invite-issuer-account" className="mt-1 text-xs text-slate-400">
                      Champion · <span className="font-mono">{invite.issuerAccountId}</span>
                    </p>
                  )}
                </td>
                <td className={`${ADMIN_TD} whitespace-nowrap text-slate-400`}>{day(invite.createdAt)}</td>
                <td className={`${ADMIN_TD} text-slate-400`}>
                  <span className="whitespace-nowrap">{day(invite.linkExpiresAt)}</span>{' '}
                  <span className="text-xs text-slate-400">({invite.linkExpiryDays} days)</span>
                </td>
                <td className={ADMIN_TD}>
                  <StatusChip tone={style.tone} testId="invite-state">
                    {style.label}
                  </StatusChip>
                  {invite.state === 'revoked' && invite.revokeReason && (
                    <p className="mt-1 text-xs text-slate-400">
                      {day(invite.revokedAt)}: {invite.revokeReason}
                    </p>
                  )}
                  {invite.state === 'revoked' && invite.revokedByInviter && (
                    <p data-testid="invite-revoked-by-inviter" className="mt-1 text-xs text-slate-400">
                      Revoked by the inviter
                    </p>
                  )}
                  {invite.state === 'accepted' && invite.redeemedAccountId && (
                    <p data-testid="invite-accepted-account" className="mt-1 text-xs text-slate-400">
                      <span className="font-mono">{invite.redeemedAccountId}</span>
                      {' · '}
                      {day(invite.redeemedAt)}
                      {invite.level !== null && <> {' · '}L{invite.level}</>}
                      {invite.parentAccountId && (
                        <span data-testid="invite-parent-account">
                          {' · parent '}
                          <span className="font-mono">{invite.parentAccountId}</span>
                        </span>
                      )}
                    </p>
                  )}
                  {invite.redemptionStoppedHalfway && (
                    <div
                      data-testid="invite-stopped-halfway"
                      className="mt-1 space-y-1 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                    >
                      <StatusChip tone="warn">Signup stopped halfway</StatusChip>
                      {invite.redemptionFailure ? (
                        <p>
                          Step {invite.redemptionFailure.step}
                          {invite.redemptionFailure.errorCode && <> · code {invite.redemptionFailure.errorCode}</>}
                          {invite.redemptionFailure.errorMessage && <> · {invite.redemptionFailure.errorMessage}</>}
                          {invite.redemptionFailure.accountId && (
                            <>
                              {' · account '}
                              <span className="font-mono">{invite.redemptionFailure.accountId}</span>
                            </>
                          )}
                          {' · '}
                          {day(invite.redemptionFailure.at)}
                        </p>
                      ) : (
                        <p>The signup timed out before it could record why.</p>
                      )}
                    </div>
                  )}
                  {invite.openedByExistingAccountAt && (
                    <p data-testid="invite-existing-account" className="mt-1 text-xs text-amber-300">
                      Opened by an existing account ({day(invite.openedByExistingAccountAt)})
                    </p>
                  )}
                </td>
                <td className={ADMIN_TD}>
                  {emailStyle ? (
                    // StatusChip takes no title, so the wrapper keeps the hover text (the L-5 pattern).
                    <span title={emailStyle.title}>
                      <StatusChip tone={emailStyle.tone} testId="invite-email-status">
                        {emailStyle.label}
                      </StatusChip>
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className={`${ADMIN_TD} whitespace-nowrap text-slate-400`}>{day(invite.firstViewedAt)}</td>
                <td className={ADMIN_TD}>
                  {canRevoke && revoking !== invite.id && (
                    <button
                      type="button"
                      onClick={() => setRevoking(invite.id)}
                      className={`rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20 ${FOCUS_RING}`}
                    >
                      Revoke
                    </button>
                  )}
                  {revoking === invite.id && (
                    <RevokeDialog
                      invite={invite}
                      onCancel={() => setRevoking(null)}
                      onRevoked={(updated) => {
                        setRevoking(null);
                        onRevoked(updated);
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
