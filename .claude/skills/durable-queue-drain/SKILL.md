---
name: durable-queue-drain
description: Build a concurrency-safe, cron/worker-drained background queue on the canonical §8.1 claim pattern (batched FOR UPDATE SKIP LOCKED claim RPC, provably-dead reaper, dead-letter, idempotency). Use when adding or fixing any background job that selects rows and processes/dispatches them — payment reminders, retries, automation executions, event reactions, notification/email sends, scheduled tasks — or when wiring a Vercel cron that drains a table. Prevents the double-send / unbounded re-execution bugs of naive select-then-process drains.
---

# durable-queue-drain

Use this whenever you build or fix a **background job that reads rows from a table and does an effect** (send, charge, execute, notify) — and especially before wiring a cron to one. Naive `SELECT pending → loop → do effect` drains have two latent bugs that activate the moment the job runs on more than one overlapping invocation: **double-processing** (two runs grab the same row) and **unbounded re-execution** (the row never leaves its ready state). This skill is the standard fix.

**Canonical reference (read it, link it, do not duplicate it):** `docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md` **§8.1** (claim/lease/dead-letter), **§8.2** (trigger sources — retire in-process buses), **§9** (idempotency). This skill operationalizes §8.1 into a checklist.

**Worked reference implementation (copy its shape):** the payment queue-drain, PR #27 (`fix/business-os-payment-queue-drain`, commit `138ff46`) + `docs/workplans/BUSINESS_OS_PAYMENT_QUEUE_DRAIN_WORKPLAN.md`. Two queues (`payment_reminders`, `payment_automation_executions`) built on this exact pattern — use them as the template.

---

## The rule

A drained queue table is **claim-then-process**, never select-then-process. A row is only ever dispatched by the one runner that atomically claimed it, guardrails are enforced **at the point the effect runs**, and the row's terminal status is its own dedupe marker. **Never schedule the cron before the claim is in place** — that activates the bug.

---

## Step 1 — Queue-row columns (migration)

Add to the queued table (all `IF NOT EXISTS`):

| Column | Purpose |
|---|---|
| `status` | lifecycle: `pending → running → completed`/`failed`/`cancelled`/`dead_letter` (pick per-table terms, keep them consistent) |
| `claimed_by UUID` | the runner instance id holding the lease |
| `claimed_at TIMESTAMPTZ` | lease clock |
| `attempts INT NOT NULL DEFAULT 0` | bumped on each claim; drives dead-letter |
| `next_attempt_at TIMESTAMPTZ` | exp-backoff gate (nullable = eligible now) |

Add a **partial index on the claim predicate**: `CREATE INDEX … ON tbl(scheduled_at) WHERE status='pending'`. The claim is the hot path — index exactly the status it filters. (Watch for a pre-existing partial index on a *different* status — it won't back your claim; create the right one.)

## Step 2 — Claim RPC (the Supabase JS client can't express `FOR UPDATE SKIP LOCKED`)

```sql
CREATE OR REPLACE FUNCTION claim_due_<queue>(p_runner uuid, p_batch int)
RETURNS SETOF <queue>
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE <queue> SET status='running', claimed_by=p_runner, claimed_at=now(), attempts=attempts+1
  WHERE id IN (
    SELECT id FROM <queue>
    WHERE status='pending' AND scheduled_at <= now()
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    ORDER BY scheduled_at LIMIT p_batch
    FOR UPDATE SKIP LOCKED         -- two runners never grab the same row, never block
  )
  RETURNING *;
END $$;
REVOKE ALL ON FUNCTION claim_due_<queue>(uuid,int) FROM anon, authenticated;
```
One round-trip, `RETURNING *` — claim and read together, never claim-then-reselect.

## Step 3 — Reaper RPC (safety net; makes the lease provably-dead, not guessed)

A separate `reap_stale_<queue>(p_lease_seconds int, p_max_attempts int)`. Set **lease > the function's `maxDuration` + margin** (e.g. lease 90s when `maxDuration=60s`). A row still `running` past the lease is *provably dead* (the platform hard-kills at `maxDuration`), so reclaim it: `attempts < max` → back to `pending` with backoff `next_attempt_at`; `attempts >= max` → terminal `dead_letter`/`failed` (kept for manual replay). `REVOKE` from anon/authenticated.

## Step 4 — Idempotency

Delivery is at-least-once, so each effect must be safe twice. The **terminal status is the dedupe marker** — the claim only selects `status='pending'`, so a `completed`/`sent` row is never re-dispatched; duplicates are bounded to crash-then-reap. For a **non-idempotent external effect** (send email, charge), also carry a `dedupe_key = f(row.id)` and check-insert before the effect. Prefer naturally-idempotent ops (`find_or_create`, `set status=paid`).

## Step 5 — The drain runner

```
runnerId = crypto.randomUUID()
await repo.reapStale(LEASE_SECONDS, MAX_ATTEMPTS)   // reaper FIRST
claimed = await repo.claimDue(runnerId, BATCH)
for each row in claimed:
    enforce guardrails HERE (see Step 6)
    do the effect
    repo.complete(row.id) | repo.fail(row.id, msg)   // terminal on the SAME claimed row
```
Constants (`LEASE_SECONDS=90, MAX_ATTEMPTS=5, BATCH=100`) live beside the route's `export const maxDuration`.

## Step 6 — Guardrails at the choke point (not the enqueuer)

Any per-entity cap / cooldown / rate-limit is enforced **where the effect runs** (claim/execute time), so no path (immediate, delayed, manual drain) can bypass it. Count **prior terminal rows and EXCLUDE the current row** (`.eq('status','completed').neq('id', selfId)`) — a just-claimed `running` row must not block itself.

## Step 7 — If the queue is event-fed: enqueue durably, retire in-process buses (§8.2)

Do **not** use an in-process `EventEmitter`/`subscribe()` — it silently drops events on serverless cold start. Enqueue a row at the **write boundary** (repo/emit), in a **repo-only seam** (imports only repositories, no back-import of the service that calls it — avoids an import cycle). The cron then claim-drains. See `lib/payments/paymentReactionEnqueuer.ts`.

## Step 8 — Cron wiring (LAST) + fail-closed auth

- Wire the cron in `vercel.json` **only after** the claim + tests are in. Scheduling a naive drain activates the bug.
- Route: `export const runtime='nodejs'` + `export const maxDuration=60` (align the lease). Auth must **fail closed**: in prod a missing `CRON_SECRET` **refuses** (return false / 401), never runs unprotected. Vercel injects `CRON_SECRET` as the `Authorization: Bearer` on cron calls.
- The endpoint is a public URL; the bearer secret is the only gate. `CRON_SECRET` is a hard prerequisite — setting it needs a **redeploy** to take effect.
- **Apply migrations before the deploy that schedules the cron.** If the RPCs aren't there yet the drain fails-safe (no double-send) but no-ops until they land.

## Step 9 — Repository + standards

- All queue-table access through a repository (`lib/repositories/`); zero `.from('<queue>')` outside it. `.eq('user_id', userId)` on every method **except** the cron claim/reap/complete/fail methods, which operate cross-user by row id — mark each `⟨unscoped-by-design⟩` with a doc-comment citing the `PluginConnectionRepository` precedent.
- Pino `createLogger` only (no `console.*`); Zod on any route input; TS strict.

## Step 10 — Test the invariant

The required test: **the claim prevents double-processing.** Model `SKIP LOCKED` (second concurrent claim gets a disjoint/empty batch) and assert each row is dispatched exactly once and a terminal row is never re-claimed. Also: reaper reclaims a stale row + dead-letters at max; guardrail skips at the choke point excluding self. Unit tests mock the RPC; a real local Postgres (`supabase start`) exercises true `SKIP LOCKED`. See `scripts/dev-payment-queue.ts` for a dev harness that fires the drain twice concurrently.

---

## Checklist

- [ ] Claim columns + partial index on the claim's `status`
- [ ] `claim_due_*` RPC: `FOR UPDATE SKIP LOCKED`, batched, `RETURNING *`, `SECURITY DEFINER`, REVOKEd
- [ ] `reap_stale_*` RPC: lease > `maxDuration`, dead-letter at max attempts, backoff
- [ ] Runner: reap → claim → guardrails-at-choke-point → effect → terminal on the claimed row
- [ ] Idempotent effect (terminal-status marker; `dedupe_key` for external sends)
- [ ] Event-fed? durable enqueue in a repo-only seam; no in-process bus
- [ ] Repo methods (`⟨unscoped-by-design⟩` on cron methods); user_id-scoped otherwise; Pino
- [ ] Cron wired LAST; fail-closed auth; migrations applied before deploy
- [ ] Test proves claim prevents double-processing

## Anti-patterns (probable bugs)

- `findDue()` → loop → effect with **no claim** between select and dispatch → double-processing.
- Success path that never moves the row out of its ready state → unbounded re-execution.
- Guardrails checked at enqueue only → bypassed by the drain path.
- In-process `subscribe()`/`start()` for delivery → dropped on cold start.
- Cron auth that allows when the secret is unset → public unprotected endpoint.
- Scheduling the cron before the claim/idempotency fix lands.
