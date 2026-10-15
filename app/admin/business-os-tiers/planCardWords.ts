/**
 * The plan card's words: which plan is deciding access, what free access sits
 * underneath it, and a paid plan that has lapsed (admin plan card plain
 * labels, 2026-10-15).
 *
 * ── Why this file decides nothing ───────────────────────────────────────────
 * Admins could not tell "tier" from "cohort". The card now says it in plain
 * language, driven by the resolver's `basis` — the one answer to "which plan
 * is deciding right now". Every other fact it words comes from the server
 * (`planPresentation`, built by `describeAccountPlans`): the plan names from
 * config, whether the free access is live, whether it takes over when the paid
 * plan ends, and whether the paid plan gives less than the free access. This
 * file only chooses sentences; it compares no tier and re-derives no date.
 *
 * A body without `planPresentation` (recorded before it existed, or a test
 * stub) still renders, with the raw ids in place of the names.
 */

import { formatUtc } from '@/app/admin/components/layout/adminFormat';

import type { AccountPayload } from './types';

/** An end date in the §5.11 form, or the existing words when there is none. */
export function endDate(iso: string | null | undefined): string {
  return iso ? formatUtc(iso) : 'no end date';
}

/** One line of the card: a muted label, the plan name, and what follows it. */
export interface PlanCardLine {
  label: string;
  name: string;
  detail: string;
}

export interface PlanCardWords {
  /** The plan the resolver's basis names; `null` name when nothing decides. */
  runningOn: PlanCardLine;
  /** Basis is a paid plan and a cohort is recorded. */
  underneath: PlanCardLine | null;
  /** Basis is the cohort and a (lapsed) paid plan is recorded. */
  previous: PlanCardLine | null;
  /** Amber: the paid plan in force gives less than the live free access. */
  downgradeNote: string | null;
}

/** States in which the plan the basis names has ended. */
function hasEnded(state: string): boolean {
  return state === 'grace' || state === 'paused';
}

function tierName(payload: AccountPayload): string {
  return (
    payload.planPresentation?.tier?.name ??
    payload.plan?.tier ??
    (payload.basis.kind === 'tier' ? payload.basis.tier : undefined) ??
    'unknown paid plan'
  );
}

function cohortName(payload: AccountPayload): string {
  return (
    payload.planPresentation?.cohort?.name ??
    payload.plan?.cohort ??
    (payload.basis.kind === 'cohort' ? payload.basis.cohort : undefined) ??
    'unknown free access'
  );
}

/** "Free access underneath" — truthful about whether it would take over. */
function underneathLine(payload: AccountPayload): PlanCardLine {
  const label = 'Free access underneath:';
  const name = cohortName(payload);
  const cohort = payload.planPresentation?.cohort;

  if (!cohort) {
    // No server answer about liveness: say only what the row says.
    return { label, name, detail: `(${endDate(payload.plan?.cohort_expires_at)})` };
  }

  if (!cohort.liveNow) {
    return { label, name, detail: cohort.endsAt ? `(ended ${formatUtc(cohort.endsAt)})` : '(ended)' };
  }

  if (cohort.outlivesTier === false) {
    return {
      label,
      name,
      // True whether it ends before the paid-through date or inside the renewal
      // margin after it: either way the paid plan is still in force then.
      detail: cohort.endsAt
        ? `(ends ${formatUtc(cohort.endsAt)}, while the paid plan is still in force)`
        : '(ends while the paid plan is still in force)',
    };
  }

  const ends = cohort.endsAt ? `ends ${formatUtc(cohort.endsAt)}` : 'no end date';
  // A paid plan with no end date only ends if an admin removes it — and a dated
  // free access only takes over if that happens before its own end.
  let when = "isn't renewed";
  if (!payload.plan?.tier_expires_at) when = cohort.endsAt ? 'is removed before then' : 'is removed';
  return { label, name, detail: `— ${ends}. Takes over if ${tierName(payload)} ${when}.` };
}

export function planCardWords(payload: AccountPayload): PlanCardWords {
  const label = 'Running on:';

  if (payload.basis.kind === 'tier') {
    const tierEnd = payload.plan?.tier_expires_at ?? null;
    let detail = '(no end date)';
    if (tierEnd) {
      detail = hasEnded(payload.state)
        ? `(paid through ${formatUtc(tierEnd)}, not renewed)`
        : `(paid through ${formatUtc(tierEnd)})`;
    }

    const hasCohort = Boolean(payload.planPresentation?.cohort ?? payload.plan?.cohort);
    const cohort = payload.planPresentation?.cohort;
    const downgradeNote =
      payload.planPresentation?.tierBelowCohortBase && cohort?.liveNow && cohort.base
        ? `Paid plan gives less than their free access (${cohort.name} includes ${cohort.base.name}).`
        : null;

    return {
      runningOn: { label, name: tierName(payload), detail },
      underneath: hasCohort ? underneathLine(payload) : null,
      previous: null,
      downgradeNote,
    };
  }

  if (payload.basis.kind === 'cohort') {
    const end = payload.planPresentation?.cohort?.endsAt ?? payload.plan?.cohort_expires_at ?? null;
    let detail = end ? `(ends ${formatUtc(end)})` : '(no end date)';
    if (hasEnded(payload.state)) detail = end ? `(ended ${formatUtc(end)})` : '(ended)';

    const hasTier = Boolean(payload.planPresentation?.tier ?? payload.plan?.tier);
    const tierEnd = payload.plan?.tier_expires_at ?? null;

    return {
      runningOn: { label, name: cohortName(payload), detail },
      underneath: null,
      previous: hasTier
        ? {
            label: 'Previous paid plan:',
            name: tierName(payload),
            detail: tierEnd ? `(ended ${formatUtc(tierEnd)})` : '(ended)',
          }
        : null,
      downgradeNote: null,
    };
  }

  // Basis `none`: an anomaly. Nothing is granted, and the card says so rather
  // than naming a recorded plan as if it were in force.
  return {
    runningOn: { label, name: 'nothing', detail: '— no plan is deciding access, so nothing is granted.' },
    underneath: null,
    previous: null,
    downgradeNote: null,
  };
}

/**
 * The one-line summary: the deciding plan, and the free access underneath it
 * while that is live. `null` for basis `none`, so each caller words "no plan"
 * its own way.
 */
export function planSummaryWords(payload: AccountPayload): string | null {
  if (payload.basis.kind === 'tier') {
    const cohort = payload.planPresentation?.cohort;
    const live = cohort ? cohort.liveNow : Boolean(payload.plan?.cohort);
    return live ? `${tierName(payload)} · ${cohortName(payload)} underneath` : tierName(payload);
  }
  if (payload.basis.kind === 'cohort') return cohortName(payload);
  return null;
}

/**
 * The raw facts the card used to print, kept for debugging in one muted line:
 * ids, dates, the basis kind and the matrix version.
 */
export function planTechnicalDetails(payload: AccountPayload): string {
  const basis =
    payload.basis.kind === 'none'
      ? 'none'
      : `${payload.basis.kind} ${payload.basis.tier ?? payload.basis.cohort ?? ''}`.trim();

  return [
    `tier id ${payload.plan?.tier ?? 'none'}`,
    `cohort id ${payload.plan?.cohort ?? 'none'}`,
    `tier ends ${endDate(payload.plan?.tier_expires_at)}`,
    `cohort ends ${endDate(payload.plan?.cohort_expires_at)}`,
    `basis ${basis}`,
    `matrix version ${payload.matrixVersion}`,
  ].join(' · ');
}
