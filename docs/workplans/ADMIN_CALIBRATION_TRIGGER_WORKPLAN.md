# Admin Calibration Trigger — Workplan

> **Last Updated**: 2026-07-05
> **Status**: ✅ Implemented + committed (`ab68f84`) — backend, frontend, and tests all shipped. Live UI smoke pending.
> **Branch**: `agent-failure-troubleshooting`

## Overview

Give **admins** a way to trigger a calibration run on **any agent** (not just ones they own), so we can exercise the full calibration flow end-to-end — the data-source resolver auto-fixes, the managed user email (IMP-1), and the admin failure alert (IMP-2) — without needing to own the agent or connect its plugins.

Today calibration can only be triggered from the sandbox UI, and the batch route **hard-403s** when `agent.user_id !== caller.id` ([app/api/v2/calibrate/batch/route.ts:133](/app/api/v2/calibrate/batch/route.ts#L133)). This workplan lifts that restriction **for admins only**, running the calibration **on behalf of the owner** so it is a realistic test.

---

## Locked decisions (2026-07-02)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **UI placement** | A **modal on `/test-plugins-v2`** (admin-gated): pick any agent across users, optional input overrides, Run → live result + which emails were dispatched. |
| 2 | **Execution identity** | **Run as the owner** — the agent executes with `agent.user_id`'s plugin connections / OAuth, so it reflects the owner's real setup. |
| 3 | **User-facing email routing** | During an admin test, the success/failure user email goes **to the triggering admin** (not the real owner), so we observe exactly what the user would get without disturbing real users. The IMP-2 admin alert still goes to `listAdminEmails()`. |

---

## Architecture — the identity split

An admin-initiated run has **two identities**. Keeping them separate is the core of this change.

| Concern | Identity | Why |
|---|---|---|
| **Actor / authz** (who is allowed to trigger) | the **admin** (`caller.id`) | Gated via `AdminAccessService.isAdmin({ id, email })`. Recorded as the audit actor. |
| **Execution identity** (plugin connections, agent ownership, history/gate rows) | the **owner** (`agent.user_id`) | The agent must run with the owner's OAuth; calibration_history / calibration_status rows are scoped by `user_id` and must match the owner. |
| **User-facing email recipient** | the **admin** (decision 3) | Safe test — the real user is not emailed. |
| **Outbound-message redirect during the run** | the **admin** | Calibration already redirects the agent's outbound sends to a single address ([route.ts:1712](/app/api/v2/calibrate/batch/route.ts#L1712)); point it at the admin so no real recipients are touched. |
| **Admin failure alert (IMP-2)** | all admins (`listAdminEmails()`) | Unchanged. |

**Implementation approach: impersonate the owner at the boundary — a single substitution point, NOT a per-`user.id` audit.**

This is viable because of three facts verified in the code:

1. **Plugin connections resolve via service-role, keyed by an explicit `userId`.** `PluginConnectionRepository` defaults to `supabaseServer` (service role); the pilot passes `userId` down to executors ([base-plugin-executor.ts:78](/lib/server/base-plugin-executor.ts#L78) `getConnection(userId, …)`). So whichever `userId` we pass into `pilot.execute` decides whose OAuth is used — independent of the route's RLS client.
2. **The route's DB client is injected into every repo/pilot by constructor** (`new CalibrationHistoryRepository(supabase)`, `new WorkflowPilot(supabase)`, `new AgentRepository(supabase)`, …). Swap that one variable and everything downstream follows. `WorkflowPilot` also holds its own internal service-role client for writes.
3. **The route derives auth exactly once** (`supabase.auth.getUser()` at [route.ts:79](/app/api/v2/calibrate/batch/route.ts#L79)); nothing downstream re-reads auth from the client. So pointing the run client at service-role for an admin run breaks nothing.

**The substitution.** Rename the *initial* auth vars (`supabase`→`authSupabase`, `user`→`authUser`) in the ~75-line top region (auth block + body parse + agent fetch + early logs). After the admin check, define the **run** identity **once**:

```ts
// isAdmin computed from authUser via AdminAccessService; agent fetched with a
// service-role client when isAdmin so a cross-user agent read isn't RLS-blocked.
const adminInitiated = isAdmin && agent.user_id !== authUser.id;
if (agent.user_id !== authUser.id && !adminInitiated) return 403;   // non-admin cross-user stays blocked

const supabase = adminInitiated ? supabaseServer : authSupabase;                       // service-role for admin runs (documented RLS bypass)
const user     = adminInitiated ? { id: agent.user_id, email: authUser.email } : authUser; // owner id, admin email
const adminActorId = adminInitiated ? authUser.id : null;                              // audit actor + IMP-2 tag
```

The remaining ~4,200 lines keep using `supabase` / `user` **unchanged** — they now transparently point at the **owner's id** on a **service-role client**, which lands the decisions almost for free:

| Concern | Falls out of the substitution |
|---|---|
| Execution as owner (plugin connections, history/gate scoping) | `user.id` = owner ✅ |
| User-facing email → admin (decision 3) | we keep `authUser.email` on the impersonated `user`, so `runCtx.userEmail = user.email` = admin ✅ |
| Outbound-message redirect → admin | route passes `user.email` = admin ✅ |
| Cross-user DB reads/writes work | `supabase` = service-role bypasses RLS ✅ |
| Audit actor = admin | `adminActorId` captured separately ✅ |

> ✅ **Risk downgraded.** The care point shrinks from "classify every `user.id` in 4,300 lines" to "the ~75-line top region reads `authUser`, and the run identity is defined once." Reviewable at a glance. The one nuance to confirm in review: `ownerUserId` passed to the user email (google-mail fallback) — with impersonation it's the owner's id, so the fallback would try the owner's gmail connection; for an admin test prefer system transport (pass no `ownerUserId`, or `adminActorId`). Non-admin runs are byte-for-byte unchanged (still RLS client + real `user`).

---

## Backend changes

**File:** `app/api/v2/calibrate/batch/route.ts`
1. Rename the initial auth vars → `authSupabase` / `authUser`; compute `isAdmin` via `AdminAccessService`. Fetch the agent with a service-role client when `isAdmin` (so a cross-user read isn't RLS-blocked).
2. Compute `adminInitiated` (admin AND cross-user); replace the hard 403 (L133) with: block only when cross-user **and not** admin.
3. Define the run identity **once** (the substitution above): `const supabase = adminInitiated ? supabaseServer : authSupabase;`, `const user = adminInitiated ? { id: agent.user_id, email: authUser.email } : authUser;`, `const adminActorId = …`. The rest of the route is untouched.
4. Accept new optional body fields: `force?: boolean` (admin-only) to bypass the "already calibrated" / "production-ready" guards (L162–190) so an admin can re-test; ignore `force` for non-admins.
5. User email: for admin runs, send via **system transport** (drop `ownerUserId`, or pass `adminActorId`) so the google-mail fallback doesn't reach for the owner's connection.
6. In the IMP-2 alert, add `adminActorId` + a "triggered by admin" note (so the alert distinguishes a real user failure from an admin test). Still send it (that's what we're testing) but tag it.
7. Structured logs: add `adminInitiated`, `adminActorId` to the key log lines.

**Owner email lookup:** the user-facing email goes to the admin (decision 3), so we do **not** need the owner's email for delivery. We may still want the owner's email in the IMP-2 alert "Owner" row — resolve it via an admin-safe path (service-role read of `auth.users` / profiles by `agent.user_id`). Keep it best-effort.

**New admin endpoint (agent picker):** the modal needs to list agents across all users. There is no admin "list all agents" endpoint today (`/app/api/admin/` has `users`, `dashboard`, … but no `agents`). Add `GET /api/admin/agents?search=&limit=` — admin-gated via `AdminAccessService`, returns `{ id, agent_name, user_id, owner_email, calibration_status, is_calibrated, production_ready, updated_at }` for the picker. Repository-based (service-role read is justified + documented — cross-user by design).

---

## Frontend changes

**File:** `app/test-plugins-v2/page.tsx` (+ a new modal component under `components/`)
1. **Admin gate:** only render the "Run Calibration (Admin)" entry point when the caller is an admin. Check via an existing admin-context hook or a lightweight `GET /api/admin/agents` 403 probe; do **not** trust client state alone — the backend is the real gate.
2. **Modal:** searchable agent picker (calls `GET /api/admin/agents`), showing owner email + calibration status per row; optional JSON input-overrides field; a `force re-calibrate` checkbox; a **Run** button.
3. **Run:** `POST /api/v2/calibrate/batch` with `{ agentId, inputValues, background: true, force }`. Show live progress + final status, and surface **which emails were dispatched** (user email → admin; admin alert → admins) from the response.
4. Make the response report the dispatch outcomes so the modal can display them (extend the route's JSON response with an `emails` summary for admin-initiated runs).

---

## Security

| Rule | Applied |
|---|---|
| Admin authz **only** via `AdminAccessService` (never `profiles.role`) | `isAdmin({id,email})` for the 403 bypass; the new `/api/admin/agents` reuses the same gate. |
| Cross-user reads documented + service-role justified | `/api/admin/agents` and any owner-email lookup are cross-user **by design** (admin operator view) — document the `supabaseServer` use in-code. |
| Non-admins unchanged | The cross-user 403 still fires for non-admins; `force` ignored for non-admins. Non-admin runs keep the RLS client + real `user` (byte-for-byte unchanged). |
| Service-role only on the admin branch | `supabase = supabaseServer` is set **only** when `adminInitiated`; document the intentional RLS bypass in-code. |
| No real-user disturbance in test | User email → admin (impersonated `user` keeps admin email); outbound redirect → admin; user email via system transport. |
| Audit | Record `adminActorId` on the run + in the IMP-2 alert. |

---

## Tracklist

**Backend** — ✅ implemented + committed (`ab68f84`)
- [x] Rename initial auth vars → `authSupabase`/`authUser`; compute `isAdmin`; fetch agent with service-role when admin.
- [x] Compute `adminInitiated`; replace the hard 403 with the admin-aware check.
- [x] **Impersonate at the boundary:** define `supabase` / `user` / `adminActorId` once (owner id + service-role client for admin runs). Rest of route unchanged. Verified only `user.id`/`user.email` are used downstream; tsc clean.
- [x] `force` flag (admin-only) → `forceCalibrate = adminInitiated && force === true` bypasses the production-ready / already-calibrated guards.
- [x] User email → system transport for admin runs (`ownerUserId` dropped when `adminActorId`).
- [x] Tag the IMP-2 alert with `initiatedByAdminId` (+ "🧪 Admin test run" banner in `calibrationAdminAlert.ts`); owner email nulled on admin runs to avoid mislabeling.
- [x] `GET /api/admin/agents` (admin-gated via `AdminAccessService`, `AgentRepository.findAllForAdmin` cross-user + best-effort owner-email enrichment).
- [~] ~~Extend the route response with an `emails` dispatch summary~~ → **dropped** (see deviation): the emails fire in the `finally` block *after* the response body is built, so they can't be injected. The modal shows a deterministic note ("result email → you; admin alert → admins on failure") and the admin observes the real emails in their inbox.

**Frontend** — ✅ implemented + committed (`ab68f84`)
- [x] Admin-gated "🧪 Run Calibration (Admin)" entry on `/test-plugins-v2` — self-contained `components/admin/AdminCalibrationTrigger.tsx`, self-hides via a `GET /api/admin/agents` probe.
- [x] Agent-picker modal (debounced search, owner email + calibration status badges) + input-overrides JSON + force checkbox.
- [x] Trigger the run + show outcome (status, message, iterations, fixes, session/exec ids) + deterministic email note.

**Tests** — ✅ (14 new; 91/91 calibration+shadow)
- [x] **Identity split extracted to a pure helper** `lib/calibration/adminCalibrationIdentity.ts` (`resolveCalibrationIdentity`) so the risky logic is unit-testable in isolation from the 4,600-line route. The route now calls it.
- [x] `adminCalibrationIdentity`: same-user normal path; admin-on-own-agent NOT impersonated; non-admin cross-user → forbidden; admin cross-user → owner id + admin email + service-role + actor; `force` honored only on admin runs (7 tests).
- [x] `AgentRepository.findAllForAdmin`: no `user_id` filter (cross-user), search across name/agent-id/owner-id, default+explicit limit, error surfaced (3 tests).
- [x] `GET /api/admin/agents`: 401 unauthenticated, 403 non-admin, 200 admin + owner-email enrichment, enrichment failure non-fatal, limit clamped (5 tests).
- [x] `calibrationAdminAlert`: admin-test banner renders only when `initiatedByAdminId` set.
- [ ] *(deferred)* Full end-to-end route test (admin run writes history under the owner's `user_id`) — the batch route is too heavy to unit-test end-to-end; covered indirectly by the identity-helper tests + the manual live run below.

---

## How to run it (via the test page)

**Prerequisites**
- You are an admin — your email/id is in the `admin_users` table (or the `ADMIN_EMAILS` env allow-list). The button is hidden otherwise.
- Email transport is configured (`RESEND_API_KEY`, or the Gmail-app vars) so you actually receive the result email; without it, delivery is skipped and only logged.

**Steps**
1. Go to **`/test-plugins-v2`**. The **🧪 Run Calibration (Admin)** button appears top-right (it self-hides for non-admins via a `GET /api/admin/agents` probe).
2. Click it → search for any agent (by name, agent id, or owner id). Rows show the owner email + `prod` / `calibrated` / calibration-status badges.
3. (Optional) Provide **input overrides** as JSON (e.g. `{ "spreadsheet_id": "…" }`), and/or tick **Force re-calibrate** to bypass the production-ready / already-calibrated guards.
4. Click **Run calibration**. The modal shows the outcome (status, message, iterations, auto-fixes, session/execution ids).
5. **Check your inbox:** the user-facing result email (managed "we're on it" copy on failure — IMP-1) is routed to **you**, and on failure the **admin alert** (IMP-2, with the 🧪 *Admin test run* banner) goes to all admins.

**Two agents worth testing**
- `3fc703fd-…` (Sheets range = `"Sheet1"`, not a real tab) — should exercise the resolver auto-fix → ideally a **pass** + user success email.
- Any known-broken agent → **failure** path → managed user email to you + admin alert.

## Log callouts to watch (`npm run dev:pretty`)

| Log message | Module | Means |
|---|---|---|
| `Starting batch calibration` (`isAdmin: true`) | `BatchCalibration` | The caller was recognised as an admin. |
| `Admin-initiated calibration — running on behalf of the owner (service-role client, owner identity)` | `BatchCalibration` | ✅ Impersonation engaged — the run is scoped to the owner. Carries `adminActorId` + `ownerId`. |
| `Admin force-calibrate — bypassing production-ready / already-calibrated guards` | `BatchCalibration` | The `force` flag took effect (admin only). |
| `Admin agent list returned` (`count`, `search`) | `AdminAgentsAPI` | The picker query succeeded. |
| `Non-admin attempted to list all agents` | `AdminAgentsAPI` | A non-admin hit `/api/admin/agents` → 403 (expected if you're testing the gate). |
| `Owner-email enrichment failed (non-fatal)` | `AdminAgentsAPI` | The picker still works; owner emails just show as the user-id prefix. |
| `Calibration result email sent` / `…not delivered — no email transport succeeded` | `CalibrationResultEmail` | Whether the user email actually went out (check transport env if "not delivered"). |
| `Calibration admin alert sent` / `Admin alert already sent for this workflow version — skipping (dedup)` | `CalibrationAdminAlert` / `BatchCalibration` | The IMP-2 alert fired, or was deduped because this workflow version already alerted. |

> **If you re-run the same failing agent and get no admin alert**, that's the `workflow_hash` dedup working (`…already sent…skipping (dedup)`). Edit the workflow (new hash) or clear `metadata.admin_alerted` on the row to force a fresh alert.

## Risks

1. **Top-region substitution correctness** *(now the main care point)* — the ~75-line region before the substitution must read `authUser` (not the impersonated `user`), and the run identity must be defined before any repo/pilot is constructed. Mitigation: the region is small + reviewable at a glance; the identity regression test asserts owner-scoped history rows. *(This replaces the earlier "audit every `user.id`" risk — the substitution makes that unnecessary.)*
2. **Service-role blast radius** — on the admin branch the whole run uses service-role (RLS bypassed). That's intentional (acting as the owner) but means a wrong `agent.user_id` would read/write as that user. Mitigation: `supabase = supabaseServer` is strictly inside the `adminInitiated` branch; non-admin path is untouched.
3. **Owner OAuth expired** — an admin test may fail for a real reason (owner's token dead). That's realistic, but the modal should distinguish "auth/connection failure" from "calibration logic failure" in the surfaced result.
4. **Cross-user data exposure** — `/api/admin/agents` and the IMP-2 data embed expose other users' data to admins by design; keep strictly admin-gated + audited.
5. **Accidental real-user email** — if decision 3 is ever changed to "real owner", real users get test emails. Guard the recipient choice behind the `adminInitiated` branch explicitly.

---

## Open items / deferred

- Folding this trigger into the **Admin Agent Health Dashboard** (per `docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md`) as a per-agent "Run calibration" action — the backend built here is reusable there.
- A configurable test-recipient (decision 3 alt "Configurable recipient") if we later want to send to a throwaway inbox or the real owner on demand.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-05 | Committed | Feature landed in `ab68f84` (`feat(calibration): admin-only trigger to calibrate any agent`) — 12 files, 853 insertions: batch-route impersonation boundary, `GET /api/admin/agents` + `AgentRepository.findAllForAdmin`, `AdminCalibrationTrigger` modal on `/test-plugins-v2`, `resolveCalibrationIdentity` helper, admin-alert test-banner, + 14 tests. Status flipped Draft/uncommitted → committed. Live UI smoke still pending. |
| 2026-07-03 | Tests + helper extraction | Extracted the identity split into a pure `resolveCalibrationIdentity` helper (route now calls it); 14 new tests (identity 7, `findAllForAdmin` 3, `/api/admin/agents` 5) — 91/91 calibration+shadow, tsc clean. Added "How to run (test page)" + "Log callouts to watch" sections. Full end-to-end route test deferred (route too heavy; covered by the helper tests + manual live run). |
| 2026-07-02 | Implemented (uncommitted) | Backend impersonation-at-the-boundary in the batch route (owner id + service-role on the admin branch; `force` bypass; user email → system transport; IMP-2 tagged w/ "admin test" banner). New `GET /api/admin/agents` + `AgentRepository.findAllForAdmin`. New `components/admin/AdminCalibrationTrigger.tsx` (self-gating modal) mounted on `/test-plugins-v2`. tsc clean; calibration+shadow 85/85. **Deviation:** dropped the response `emails` summary (emails fire post-response in `finally`) → modal shows a deterministic note instead. **Route-level auth/identity tests still pending.** |
| 2026-07-02 | Impersonation approach | Replaced the "audit every `user.id`" identity-split with **impersonate-at-the-boundary** (single substitution: owner `user.id` + service-role `supabase` on the admin branch). Verified 3 enabling facts (connections resolve by passed userId via service-role; client injected by constructor; auth derived once). Top risk downgraded to a ~75-line review. |
| 2026-07-02 | Created | Admin calibration trigger design. Decisions locked: test-plugins-v2 modal, run-as-owner, user-email-to-admin. Tracklist. Awaiting go-ahead to implement. |
