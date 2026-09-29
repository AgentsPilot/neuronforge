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
 */

import { useState } from 'react';

import type { InviteEmailStatus, InviteRow, InviteState } from '../types';
import { RevokeDialog } from './RevokeDialog';

interface Props {
  invites: InviteRow[];
  onRevoked: (invite: InviteRow) => void;
  /** Slice 1c: "no invites yet" and "nothing matches" are different answers. */
  emptyMessage?: string;
}

const STATE_STYLE: Record<InviteState, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-sky-500/20 text-sky-300' },
  expired: { label: 'Expired', className: 'bg-slate-500/20 text-slate-300' },
  revoked: { label: 'Revoked', className: 'bg-rose-500/20 text-rose-300' },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/20 text-emerald-300' },
};

/** Slice 2a: the invitation email. "Sent" means the provider accepted it, not that it arrived. */
const EMAIL_STYLE: Record<InviteEmailStatus, { label: string; className: string; title: string }> = {
  not_emailed: { label: 'Not emailed', className: 'bg-slate-500/20 text-slate-300', title: 'The link was copied, not emailed' },
  sent: { label: 'Sent', className: 'bg-emerald-500/20 text-emerald-300', title: 'Accepted by the email provider' },
  sent_untracked: {
    label: 'Sent (not tracked)',
    className: 'bg-emerald-500/10 text-emerald-200',
    title: 'Sent through a fallback transport that reports no delivery',
  },
  not_sent: { label: 'Not sent', className: 'bg-rose-500/20 text-rose-300', title: 'The email did not go out' },
  unknown: { label: 'Unknown', className: 'bg-amber-500/20 text-amber-300', title: 'An email was attempted but no result was recorded' },
};

/** A calendar date, the same everywhere: the ISO date part, in UTC. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export function InviteList({ invites, onRevoked, emptyMessage = 'No invites yet.' }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);

  if (invites.length === 0) {
    return (
      <p data-testid="invite-list-empty" className="text-sm text-slate-400">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table data-testid="invite-list" className="w-full text-left text-sm">
        <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Access</th>
            <th className="px-3 py-2">Invited by</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Link expires</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">First opened</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/60 text-slate-200">
          {invites.map((invite) => {
            const style = STATE_STYLE[invite.state];
            const emailStyle = invite.emailStatus ? EMAIL_STYLE[invite.emailStatus] : undefined;
            const canRevoke = invite.state === 'pending' || invite.state === 'expired';
            return (
              <tr key={invite.id} data-testid={`invite-row-${invite.id}`} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{invite.email}</td>
                <td className="px-3 py-2">{invite.grantLabel}</td>
                <td className="px-3 py-2 text-slate-400">{invite.accessSummary}</td>
                <td className="px-3 py-2 text-slate-400">{invite.inviterDisplayName}</td>
                <td className="px-3 py-2 text-slate-400">{day(invite.createdAt)}</td>
                <td className="px-3 py-2 text-slate-400">
                  {day(invite.linkExpiresAt)} <span className="text-xs text-slate-500">({invite.linkExpiryDays} days)</span>
                </td>
                <td className="px-3 py-2">
                  <span data-testid="invite-state" className={`rounded px-2 py-0.5 text-xs ${style.className}`}>
                    {style.label}
                  </span>
                  {invite.state === 'revoked' && invite.revokeReason && (
                    <p className="mt-1 text-xs text-slate-500">
                      {day(invite.revokedAt)}: {invite.revokeReason}
                    </p>
                  )}
                  {invite.state === 'accepted' && invite.redeemedAccountId && (
                    <p data-testid="invite-accepted-account" className="mt-1 text-xs text-slate-400">
                      <span className="font-mono">{invite.redeemedAccountId}</span>
                      {' · '}
                      {day(invite.redeemedAt)}
                      {invite.level !== null && <> {' · '}L{invite.level}</>}
                    </p>
                  )}
                  {invite.redemptionStoppedHalfway && (
                    <div data-testid="invite-stopped-halfway" className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                      <p className="font-medium">Signup stopped halfway</p>
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
                <td className="px-3 py-2">
                  {emailStyle ? (
                    <span
                      data-testid="invite-email-status"
                      title={emailStyle.title}
                      className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${emailStyle.className}`}
                    >
                      {emailStyle.label}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{day(invite.firstViewedAt)}</td>
                <td className="px-3 py-2">
                  {canRevoke && revoking !== invite.id && (
                    <button
                      type="button"
                      onClick={() => setRevoking(invite.id)}
                      className="rounded border border-rose-500/50 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
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
