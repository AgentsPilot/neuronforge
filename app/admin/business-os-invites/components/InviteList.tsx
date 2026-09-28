'use client';

/**
 * FR-5 (the Slice 0 subset): the newest invites, each with its derived state.
 *
 * The state arrives decided (`deriveInviteState` on the server); this list
 * never compares a date to decide whether a link has expired. Filters and email
 * search arrive with Slice 1, when the list grows (SA scope cut R-2).
 */

import { useState } from 'react';

import type { InviteRow, InviteState } from '../types';
import { RevokeDialog } from './RevokeDialog';

interface Props {
  invites: InviteRow[];
  onRevoked: (invite: InviteRow) => void;
}

const STATE_STYLE: Record<InviteState, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-sky-500/20 text-sky-300' },
  expired: { label: 'Expired', className: 'bg-slate-500/20 text-slate-300' },
  revoked: { label: 'Revoked', className: 'bg-rose-500/20 text-rose-300' },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/20 text-emerald-300' },
};

/** A calendar date, the same everywhere: the ISO date part, in UTC. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export function InviteList({ invites, onRevoked }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);

  if (invites.length === 0) {
    return (
      <p data-testid="invite-list-empty" className="text-sm text-slate-400">
        No invites yet.
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
            <th className="px-3 py-2">First opened</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/60 text-slate-200">
          {invites.map((invite) => {
            const style = STATE_STYLE[invite.state];
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
