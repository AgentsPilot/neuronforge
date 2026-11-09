/*
 * Is the agent scheduler actually running? A probe that can fail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY. SELECT only, inside a read-only transaction, returning counts,
 * booleans and timestamps. No owner text: an agent's name is the owner's words,
 * which is why the scheduler route keeps names out of its own logs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT JUST READ THE ENV VAR
 *
 * `AGENT_SCHEDULER_ENABLED` can be read from the Vercel dashboard, and reading
 * it there proves what the PROJECT holds, not what the running deployment does.
 * The protocol asks for a probe that fails when the thing is wrong, measured on
 * the deployed surface.
 *
 * The HTTP response cannot be that probe. With the flag off,
 * `runScheduledAgents` returns its zero-count result and the route answers
 * `{ success: true, … }` with zeros — which is byte-for-byte what a healthy
 * pass with nothing due returns. Only the log line differs.
 *
 * `agents.last_run` can be that probe. A switched-off pass "reaps nothing,
 * queues nothing and runs nothing", so it never claims a row and never stamps
 * one. The column therefore advances if and only if the scheduler is live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO READ IT
 *
 *   scheduled_ahead = true        the scheduler is LIVE. `next_run` is in the
 *                                 future, and only a completed pass puts it
 *                                 there.
 *
 *   scheduled_ahead = false       AND overdue_minutes is large → the pass is not
 *                                 getting through. Three causes, and
 *                                 `has_ever_run` plus the logs separate them:
 *
 *                                   flag off      logs "Agent scheduler is
 *                                                 switched off; nothing was
 *                                                 read or run" at info
 *                                   pass failing  logs "Scheduler pass failed"
 *                                                 at error, and `last_run` is
 *                                                 deliberately NOT written on a
 *                                                 failure
 *                                   cron silent   logs neither
 *
 *   no rows                       no automation agent is installed on this
 *                                 account, so this probe cannot answer. Install
 *                                 one, or probe a different account.
 *
 * `overdue_minutes` of a few minutes is normal: the pass runs every five.
 * Anything past about fifteen is a real signal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

begin read only;

select
  a.id                                        as agent_id,
  a.status,
  a.schedule_enabled,
  a.mode,
  a.schedule_cron,
  a.last_run,
  a.next_run,
  /*
   * THE WHOLE PROBE, AS ONE BOOLEAN.
   *
   * `next_run` in the FUTURE is the evidence, because only a completed pass
   * moves it there: `install` stamps `next_run = now()` so the first run is
   * immediate, and nothing but the runner ever advances it. A switched-off
   * scheduler therefore leaves it in the past for ever.
   *
   * Not `last_run >= next_run`, which was the first formulation here and is
   * wrong in the healthy case: a successful pass stamps `last_run` and then
   * pushes `next_run` a whole cadence ahead, so the comparison is false twenty
   * minutes after a perfectly good run.
   */
  (a.next_run is not null and a.next_run > now()) as scheduled_ahead,
  (a.last_run is not null)                        as has_ever_run,
  /* How long it has been due without running. Negative means not due yet. */
  round(extract(epoch from (now() - a.next_run)) / 60)::int
                                              as overdue_minutes
from public.agents as a
where 'business-os-automation' = any(a.tags)
  and a.deleted_at is null
order by a.next_run asc nulls last;

/* And the same question for the whole platform, in one row: how many installed
   automation agents are past due and have never run since. A healthy scheduler
   keeps this at zero. */
select
  count(*)                                                        as installed_and_active,
  count(*) filter (where next_run < now() - interval '15 minutes'
                     and (last_run is null or last_run < next_run)) as stuck_past_due
from public.agents
where 'business-os-automation' = any(tags)
  and deleted_at is null
  and status = 'active'
  and schedule_enabled is true;

commit;
