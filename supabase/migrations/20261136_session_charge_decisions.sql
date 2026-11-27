/*
 * The owner's charge decision, kept on the session it is about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG WITHOUT IT
 *
 * Measured on production 2026-11-27, package 8b74f5c0 (billed per session):
 *
 *   · Session 2 marked a no-show and WAIVED. Its stage went to `cancelled`.
 *     Thirty-four seconds later the client booked the replacement from the
 *     rebook link, and `reconcileSessionStages` saw a live no-show with no
 *     standing stage and wrote it a fresh $111.02. The waiver was undone.
 *
 *   · An owner adding a session with "No, free of charge" gets no stage from
 *     the route, and then the same reconciler, run at the end of that route,
 *     gives it one. The free session is billed.
 *
 * The reconciler cannot tell "nobody wrote a stage" from "the owner said
 * there is none", because the answer was never written down anywhere it can
 * read.
 *
 * And the no-show dialog's "let the client pick a time" books the new session
 * DAYS later, from the client's side, so the owner's answer about that
 * session's money has to be held somewhere until then.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO COLUMNS
 *
 *   billable          On a session: the owner's answer for ITS money.
 *                       false  given free, no stage is owed
 *                       true   charged like any other
 *                       null   not asked; the package's own rule applies
 *                     Only stops or permits a stage being created. It never
 *                     voids one.
 *
 *   makeup_billable   On a missed (or called-off) session: the owner's answer
 *                     for the session that will be booked to REPLACE it.
 *                     Read when the replacement is booked, by whichever path
 *                     books it, and copied onto that session's `billable`.
 *                     null means the owner was not asked (every row before
 *                     this migration), and the old inference applies.
 *
 * Nullable with no default, so every existing row keeps meaning exactly what
 * it meant: nothing is backfilled, and no stage anywhere changes.
 *
 * Additive only. Rollback is the two DROP COLUMN statements at the end,
 * which lose only the answers recorded since.
 * ─────────────────────────────────────────────────────────────────────────────
 */

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS billable boolean,
  ADD COLUMN IF NOT EXISTS makeup_billable boolean;

COMMENT ON COLUMN public.scheduling_meetings.billable IS
  'Owner''s charge decision for this session: false = given free (no stage owed), true = charged, null = package default.';

COMMENT ON COLUMN public.scheduling_meetings.makeup_billable IS
  'On a missed or called-off session: owner''s charge decision for the session booked to replace it. null = not asked.';

/*
 * ROLLBACK
 *
 *   ALTER TABLE public.scheduling_meetings DROP COLUMN IF EXISTS makeup_billable;
 *   ALTER TABLE public.scheduling_meetings DROP COLUMN IF EXISTS billable;
 */
