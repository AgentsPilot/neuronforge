'use client';

/**
 * The Signup Invites KPI strip (Admin Layout Standard §7.9, K-1 to K-10).
 *
 * Five tiles, every figure from the page's one GET (K-9): the four state
 * counts over the rows the read returned, and the stopped-halfway figure the
 * page derives once from the server's summary (SA L-6 M-5), so the tile and the
 * banner can never show different numbers.
 *
 * ── Not links (D-7 (a), K-6) ────────────────────────────────────────────────
 * This page keeps no filter in its URL (the shown-once invite link must not
 * survive a reload), so a tile has no filtered view to point at. Every tile is
 * the no-target mode: a `div role="group"` with the K-7 name, never a link and
 * never a button.
 *
 * ── Colour (K-5 (ii)) ───────────────────────────────────────────────────────
 * Only Stopped halfway carries a status: amber when at least one signup stopped
 * halfway, the same fact the page's amber banner states. The four state tiles
 * are neutral: a count of invites in a state is not a problem.
 *
 * ── "At least" (SA-R-10, K-8) ───────────────────────────────────────────────
 * When the server's list ceiling was reached, every figure here is a lower
 * bound, the stopped-halfway one included (the server derives it over the same
 * returned rows), so all five tiles say so.
 *
 * State words and counts only: no plan name, no fetch.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import type { InviteRow, InvitesPayload } from '../types';

export interface InviteStateCounts {
  pending: number;
  accepted: number;
  expired: number;
  revoked: number;
}

/**
 * Rows per state. A stopped-halfway or opened-by-an-existing-account invite is
 * still in one state and counts there once; a state word this screen does not
 * know (a newer server) counts nowhere, so the four never over-count.
 */
export function countInvites(invites: readonly InviteRow[]): InviteStateCounts {
  const counts: InviteStateCounts = { pending: 0, accepted: 0, expired: 0, revoked: 0 };
  for (const invite of invites) {
    switch (invite.state) {
      case 'pending':
        counts.pending += 1;
        break;
      case 'accepted':
        counts.accepted += 1;
        break;
      case 'expired':
        counts.expired += 1;
        break;
      case 'revoked':
        counts.revoked += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

export interface InviteKpisProps {
  /** Null before the first read, and while the page shows an error (K-10). */
  payload: InvitesPayload | null;
  /** The page's one stopped-halfway figure, the banner's too (SA M-5). */
  stoppedCount: number;
  /** A read is in flight. */
  loading: boolean;
}

export function InviteKpis({ payload, stoppedCount, loading }: InviteKpisProps) {
  // K-10: placeholders while the first read is in flight; no strip at all when
  // there is nothing to show (the error says why).
  if (!payload) return loading ? <KpiStrip loading placeholderCount={5} /> : null;

  const counts = countInvites(payload.invites);
  const sub = payload.truncated === true ? `at least: the newest ${formatCount(payload.invites.length)} only` : null;

  return (
    <KpiStrip>
      <KpiTile testId="kpi-pending" label="Pending" value={formatCount(counts.pending)} sub={sub} />
      <KpiTile testId="kpi-accepted" label="Accepted" value={formatCount(counts.accepted)} sub={sub} />
      <KpiTile
        testId="kpi-stopped-halfway"
        label="Stopped halfway"
        value={formatCount(stoppedCount)}
        sub={sub}
        status={stoppedCount >= 1 ? 'amber' : null}
      />
      <KpiTile testId="kpi-expired" label="Expired" value={formatCount(counts.expired)} sub={sub} />
      <KpiTile testId="kpi-revoked" label="Revoked" value={formatCount(counts.revoked)} sub={sub} />
    </KpiStrip>
  );
}
