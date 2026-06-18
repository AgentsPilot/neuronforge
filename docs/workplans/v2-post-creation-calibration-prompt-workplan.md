# Workplan: V2 Post-Creation Calibration Prompt

> **Last Updated**: 2026-06-14

**Developer:** Dev
**Date:** 2026-06-14
**Branch:** Implementing on the current branch `fix/v6-drive-extractor-flow` (user is mid-flight there; a dedicated branch was deferred). Changes are additive and don't intersect the v6 drive-extractor work, so they apply cleanly. Calibration changes will be kept in clearly-scoped commits so they can be cherry-picked onto a separate branch before PR if desired.
**Status:**
- **Phase 1 — Post-creation prompt + R7 button gating:** 🔨 Implemented (2026-06-16), live test passed. The prompt navigates the user into the sandbox and auto-starts a *synchronous* calibration.
- **Phase 2 — Async background calibration + email + access gating:** 🔨 Implemented (2026-06-17) on `fix/v6-drive-extractor-flow` — tsc clean on touched files (only 2 pre-existing sandbox null errors remain). Post-creation navigates to `/v2/agent-list` (option a) where the gating UI lives. **Live smoke test + migration apply still pending.** **Supersedes the Phase 1 "navigate to sandbox + auto-start" behaviour for the post-creation path.**

---

## Overview

After an agent is created and saved in the V2 thread-based creation flow (`/v2/agents/new`), today the UI shows a success message and auto-redirects to the agent detail page after 300 ms. This workplan adds an **optional, user-consented choice point**: prompt the user to test the new agent via **calibration** before going live.

- **Approve ("Test it now")** → navigate to the calibration page (`/v2/sandbox/[agentId]`), which **auto-starts** the batch calibration run using the inputs saved during creation.
- **Decline ("Skip for now")** → navigate to the agent detail page (`/agents/[agentId]`) — the current destination.

The entire behaviour is gated behind a **new feature flag, default OFF**. When off, the flow behaves exactly as today (auto-redirect to the agent page). When on, the choice card is shown on every successful creation, and the user **must explicitly approve or decline** — the flow never force-navigates to calibration without consent.

The user's approve/decline choice is **persisted on the agent** so we can later distinguish a deliberate skip from never-prompted. Calibration *outcome* tracking (did it pass, when) **reuses existing DB state** — no new outcome columns.

---

## Strategic context / tension to be aware of

The codebase currently treats calibration as a **shrinking** user-facing surface. The existing `useCalibrationButton()` flag ([lib/utils/featureFlags.ts:117-121](/lib/utils/featureFlags.ts#L117-L121)) defaults **OFF** with the comment:

> *"calibration is being phased out as a user-facing surface, so the default is OFF — the hidden state is the intended long-term state."*

This feature **adds** a calibration entry point, which runs counter to that trajectory. The mitigation is deliberate: the new prompt is **flag-gated, default OFF**, so it is opt-in for testing/diagnosis and does not change default product behaviour. If the team later decides to re-embrace calibration as a user surface, the flag is flipped on; if not, nothing ships to users.

**R7 deliberately reverses part of that stance.** Removing `useCalibrationButton()` and gating the agent-detail "Run Calibration" button on `!is_calibrated` makes that button **visible by default for every not-yet-calibrated agent** (today it is hidden by default). This is an intentional re-embrace of calibration as a user-facing surface — the user has decided to bring it back, driven by real agent state rather than a global flag. Note the resulting asymmetry, which is by design: the **post-creation auto-prompt** stays opt-in (flag default OFF), while the **manual button** becomes always-available for uncalibrated agents. The stale "phasing out" comment on the old flag will be removed so the code no longer contradicts the new direction. Unlike the post-creation prompt, this change has **no flag fallback** once the flag is deleted — rollback is `git revert`.

**Surface note:** the post-creation *decline* path navigates to the **V1** detail page `/agents/[id]`; the "Run Calibration" button being changed lives on the **V2** detail page `/v2/agents/[id]`. These are two distinct surfaces; R7 only touches the V2 one (the only place the button exists). Unifying V1/V2 detail routing is out of scope.

---

## Requirements (from user)

| # | Requirement |
|---|---|
| R1 | After create+save, **if the flag is on**, prompt the user to test via calibration instead of auto-redirecting. |
| R2 | Accept → calibration page (auto-start the run). Decline → agent detail page. |
| R3 | The user **must be able to approve or decline** — consent is mandatory; never auto-navigate to calibration. (comment 2) |
| R4 | Persist the user's prompt decision (accepted/declined + when) on the agent, to track whether calibration was intentionally skipped vs never offered. (comment 3) |
| R5 | Track whether an agent passed calibration and when — **reuse existing DB state** (`is_calibrated` + `calibration_history`); no new outcome columns. (comment 3) |
| R6 | Feature flag name: `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION`, default OFF. |
| R7 | **Remove the `useCalibrationButton()` / `NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON` flag** and tie the agent-detail "Run Calibration" button visibility to calibration state instead: show it when the agent has **not** passed calibration (`!is_calibrated`), hide it once it has. (comment 2, round 2) |

## Goal

A user finishes creating an agent. **If the flag is on**, instead of being auto-redirected, they see a friendly card: *"Want to test it on a real example first?"* with **Test it now** / **Skip for now**. The chosen path navigates accordingly, the decision is recorded on the agent, and on approval the calibration run starts automatically. **If the flag is off**, the current auto-redirect behaviour is unchanged.

## What "done" looks like

- Flag OFF (default): identical to today — success message + redirect to `/agents/[id]`. No card, no decision write.
- Flag ON: success message + choice card; both buttons navigate correctly; no auto-redirect race; the decision is persisted (non-blocking).
- Accept path: calibration page opens and the batch run begins on its own when inputs exist; if no inputs were saved, the page falls back to its normal setup form (no error, no broken run).
- "Passed calibration?" remains answerable from existing state: `agents.is_calibrated` + the agent's `calibration_history` rows.
- `npx tsc --noEmit` clean on touched files; FR12 live smoke test at `/v2/agents/new` performed with the flag on and off.

## What this is NOT

- NOT a change to the Phase 1/2/3 conversation, the v16 prompt, the Phase 2/3 Zod contracts, or `/api/create-agent`. No FR4/FR5/FR7/FR8 surface is touched.
- NOT a change to the calibration batch route, detectors, repair engines, or any calibration invariant. We only trigger the existing `handleRunCalibration`.
- NOT adding new calibration **outcome** columns — `is_calibrated`, `last_successful_calibration_id`, and `calibration_history` already cover pass/when (R5).
- NOT removing or altering the existing `useCalibrationButton()` flag or the agent-detail calibration entry.
- NOT a modal — the prompt reuses the existing inline message-stream card pattern.

---

## Existing DB state we rely on (R5 — reuse, no new outcome columns)

From the calibration migrations, the `agents` table already carries:

| Column | Meaning |
|---|---|
| `agents.is_calibrated` (boolean, default false) | True after a successful calibration with 0 issues. |
| `agents.last_successful_calibration_id` (uuid → `calibration_history.id`) | FK to the winning run. |
| `agents.workflow_hash` (text) | Workflow identity for fast-path / regression detection. |

Per-run detail lives in **`calibration_history`** (`status` ∈ `success`/`failed`/`needs_review`/`verification_only`, `created_at`, `completed_at`, issue arrays, metrics). So:

- **"Did it pass?"** → `is_calibrated === true` (or `last_successful_calibration_id IS NOT NULL`).
- **"When?"** → join `last_successful_calibration_id → calibration_history.completed_at`, or take the latest `calibration_history` row for the agent.
- **"Needs calibration?"** → `is_calibrated === false`.

> The old direct `agents.last_calibration_at` / `last_calibration_status` columns were intentionally dropped in `20260428_calibration_history_table.sql` in favour of the history table. We do **not** re-add them.

The **only** new persistence this workplan adds is the user's *prompt decision* (R4), which is a distinct signal from the calibration outcome.

---

## Files Touched

| File | Action | Why |
|---|---|---|
| `lib/utils/featureFlags.ts` | modify | Add `useMoveToCalibrationAfterCreation()` reading `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION`, default **false**. **R7:** also **remove** `useCalibrationButton()` + its stale "phasing out" comment. Add to `getFeatureFlags()`. |
| `supabase/migrations/<date>_add_calibration_prompt_decision.sql` | **create** | Add `agents.calibration_prompt_decision TEXT CHECK (... IN ('accepted','declined'))` + `agents.calibration_prompt_decided_at TIMESTAMPTZ`. Records R4. |
| `lib/repositories/AgentRepository.ts` | modify | Add `recordCalibrationPromptDecision(agentId, userId, decision)` — repository-pattern write with `.eq('user_id', userId)`, stamps `calibration_prompt_decided_at` server-side. |
| `lib/repositories/types.ts` | modify | Add `is_calibrated?: boolean`, `calibration_prompt_decision?: 'accepted' \| 'declined' \| null`, `calibration_prompt_decided_at?: string \| null` to the `Agent` interface (currently only reachable via its `[key: string]: unknown` index signature). Lets R7's `!agent.is_calibrated` gate stay strict-mode clean. |
| `app/v2/agents/[id]/page.tsx` | modify | **R7:** remove the `useCalibrationButton` import + its gate; show the "Run Calibration" button only when `!agent.is_calibrated`. ([L77](/app/v2/agents/[id]/page.tsx#L77), [L2631](/app/v2/agents/[id]/page.tsx#L2631)) |
| `app/api/v2/agents/[agentId]/calibration-decision/route.ts` | **create** | Thin POST route (canonical AgentPilot pattern: getUser → Zod `{ decision: 'accepted'\|'declined' }` → `AgentRepository.recordCalibrationPromptDecision` → structured log). Called non-blocking from the creation page. |
| `app/v2/agents/new/page.tsx` | modify | Import the flag + `FlaskConical` icon. Add `showCalibrationPrompt` + `createdAgentId` state. Branch `executeAgentCreation` success block on the flag. Add `handleStartCalibration` / `handleSkipCalibration` (each records the decision, then navigates). Render the choice card in the message stream. |
| `app/v2/sandbox/[agentId]/page.tsx` | modify | Read `?from=creation`; add a one-shot `useEffect` that auto-triggers `handleRunCalibration(inputValues)` once the agent + saved config have loaded, with safe guards. |
| `.env.example` | modify | Add `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION=false`; **R7:** remove `NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON`. |
| `docs/feature_flags.md` | modify | Add a row for the new flag; **R7:** remove the `NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON` row. |

> **Write-path alternative (lighter, less compliant):** instead of the new route + repo method, extend the existing `PUT /api/agents/[id]` whitelist ([route.ts:262-283](/app/api/agents/[id]/route.ts#L262-L283)) with the two new fields. That route already does direct-supabase writes (an existing anti-pattern). **Recommendation:** the dedicated repository-backed route above, to honour the repository pattern and keep the generic PUT whitelist from growing. Final call is the user's.

---

## Detailed Plan

### 1. Feature flag — `lib/utils/featureFlags.ts`

Add, following the existing `useCalibrationButton` shape (default `false`):

```ts
/**
 * Move the user to calibration after agent creation.
 *
 * Default OFF. When off, agent creation auto-redirects to the agent page as
 * today. When on, a choice card invites the user to calibrate the new agent
 * before going live (approve → /v2/sandbox/[id]?from=creation, decline →
 * /agents/[id]). Opt-in via NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION=true.
 */
export function useMoveToCalibrationAfterCreation(): boolean {
  const flag = process.env.NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION', value: flag ?? null, default: false }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}
```

Also add it to the `getFeatureFlags()` return object. **R7:** delete `useCalibrationButton()` and its stale "calibration is being phased out…" doc comment from this file.

### 1b. Agent-detail button gating (R7) — `app/v2/agents/[id]/page.tsx`

Remove the `useCalibrationButton` import ([L77](/app/v2/agents/[id]/page.tsx#L77)) and replace the flag gate ([L2631](/app/v2/agents/[id]/page.tsx#L2631)) with a calibration-state gate:

```tsx
{/* before: {useCalibrationButton() && ( ... )} */}
{!agent.is_calibrated && (
  <button onClick={handleSandboxClick} /* …unchanged… */>
    {/* Run Calibration */}
  </button>
)}
```

The agent object already carries `is_calibrated` (`GET /api/agents/[id]` does `select('*')`). Add `is_calibrated?: boolean` to the `Agent` type (see Files Touched) so the gate is strict-mode clean. Behaviour: the button shows for any agent that hasn't passed calibration and disappears once `is_calibrated === true`. `handleSandboxClick` is unchanged.

### 2. Migration — record the prompt decision (R4)

```sql
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS calibration_prompt_decision TEXT
  CHECK (calibration_prompt_decision IN ('accepted', 'declined')),
ADD COLUMN IF NOT EXISTS calibration_prompt_decided_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN agents.calibration_prompt_decision IS
  'User response to the post-creation calibration prompt: accepted | declined | NULL (never prompted).';
COMMENT ON COLUMN agents.calibration_prompt_decided_at IS
  'Timestamp when calibration_prompt_decision was set.';
```

### 3. Repository method — `lib/repositories/AgentRepository.ts`

```ts
async recordCalibrationPromptDecision(
  agentId: string,
  userId: string,
  decision: 'accepted' | 'declined'
): Promise<AgentRepositoryResult<null>> {
  // .update({ calibration_prompt_decision: decision,
  //           calibration_prompt_decided_at: new Date().toISOString() })
  //   .eq('id', agentId).eq('user_id', userId)   // mandatory user scoping
}
```

### 4. API route — `app/api/v2/agents/[agentId]/calibration-decision/route.ts`

Canonical AgentPilot pattern (see `new-api-route` skill): `getUser` auth → Zod-validate `{ decision: z.enum(['accepted','declined']) }` → `AgentRepository.recordCalibrationPromptDecision` → structured Pino log with `correlationId` → consistent JSON response. Server stamps the timestamp (don't trust client clock).

### 5. Creation page — `app/v2/agents/new/page.tsx`

**Imports:** add `FlaskConical` to the lucide-react import; add `useMoveToCalibrationAfterCreation` to the `@/lib/utils/featureFlags` import.

**State** (next to `agentCreated`, ~L460):
```ts
const [showCalibrationPrompt, setShowCalibrationPrompt] = useState(false)
const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)
```

**`executeAgentCreation` success block** (currently L1528-1539) — branch on the flag:
```ts
setAgentCreated(true)
stopThinkingWords()

if (useMoveToCalibrationAfterCreation()) {
  setCreatedAgentId(result.agent.id)
  addAIMessage("Your agent is ready! Want to test it on a real example first? Calibration runs it once, catches issues, and auto-fixes what it safely can.")
  setShowCalibrationPrompt(true)
  // No auto-redirect — navigation happens only on the user's button click (R3).
} else {
  // Unchanged current behaviour.
  addAIMessage('Your agent has been created successfully! Taking you to your new agent...')
  setTimeout(() => {
    router.push(`/agents/${result.agent.id}`)
  }, 300)
}
```

**Handlers** (near `handleConnectPlugin` / `handleSkipPlugin`) — each records the decision (non-blocking, fire-and-forget so navigation is never delayed/blocked), then navigates:
```ts
const recordDecision = (decision: 'accepted' | 'declined') => {
  if (!createdAgentId) return
  fetch(`/api/v2/agents/${createdAgentId}/calibration-decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  }).catch(err => console.warn('Failed to record calibration decision (non-blocking)', err))
}

const handleStartCalibration = () => {
  setShowCalibrationPrompt(false)
  recordDecision('accepted')
  router.push(`/v2/sandbox/${createdAgentId}?from=creation`)
}
const handleSkipCalibration = () => {
  setShowCalibrationPrompt(false)
  recordDecision('declined')
  router.push(`/agents/${createdAgentId}`)
}
```

**Card UI** — modeled on the existing plugin Connect/Skip card ([page.tsx:3507-3566](/app/v2/agents/new/page.tsx#L3507-L3566)), placed just before `<div ref={messagesEndRef} />`, gated by `showCalibrationPrompt && createdAgentId`. `FlaskConical` icon, title + one-line subtitle, primary **"Test it now"** → `handleStartCalibration`, secondary **"Skip for now"** → `handleSkipCalibration`. Same V2 design tokens (`--v2-surface`, `--v2-primary`, `--v2-radius-*`) so it renders natively.

### 6. Calibration page — `app/v2/sandbox/[agentId]/page.tsx`

Reuse the existing query-param convention (the page already reads `?fresh=true` at L56-57). Add:

```ts
const autoStart = searchParams?.get('from') === 'creation'
const hasAutoStarted = useRef(false)

// Auto-start calibration when arriving from the creation handoff.
useEffect(() => {
  if (!autoStart || hasAutoStarted.current) return
  if (loading || !agent) return
  if (flowState !== 'setup') return                  // a recent session was restored — don't override it
  if (Object.keys(inputValues).length === 0) return  // no inputs to run with — leave the user on the setup form
  hasAutoStarted.current = true
  console.log('[Calibration] Auto-starting calibration from creation handoff')
  handleRunCalibration(inputValues)
}, [autoStart, loading, agent, flowState, inputValues])
```

Guards, in order: only when arriving from creation; only once (ref); only after the agent + saved configuration finished loading (`!loading`); only if still on the setup screen (never hijack a restored in-flight session — `loadLatestSession` may set `flowState` to `dashboard`/`fixes-applied`); only if inputs are available (otherwise the user sees the normal `CalibrationSetup` form). `handleRunCalibration` itself sets `flowState='running'`, switching the view.

### 7. Config docs

- `.env.example`: add `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION=false` with a one-line comment.
- `docs/feature_flags.md`: add the flag to the env-flag reference table.

---

## Edge cases & decisions

| Case | Handling |
|---|---|
| Inputs not saved during creation (`result.inputsSaved === false`, [page.tsx:1524](/app/v2/agents/new/page.tsx#L1524)) | Card still shows. On accept, the sandbox auto-start guard sees empty `inputValues` and does **not** fire — user gets the normal setup form to fill inputs and run manually. No error. |
| User had a recent in-flight calibration session for this agent | `loadLatestSession` restores it and sets `flowState` away from `setup`; the auto-start guard `flowState !== 'setup'` prevents override. |
| Old 300 ms auto-redirect racing a button click | Removed in the flag-ON branch entirely; only a button click navigates. Flag-OFF branch keeps the timer (unchanged behaviour). |
| Decision write fails | Non-blocking: navigation proceeds; we log a warning. The decision is a tracking signal, not a gate (R3 consent already enforced by the click). |
| Flag off | Zero behavioural change in the creation flow; card never renders; no decision write; `executeAgentCreation` takes the original path verbatim. **R7 is independent of this flag** — the agent-detail button is always gated on `!is_calibrated`. |
| R7: agent never calibrated (legacy/pre-calibration agents, `is_calibrated` false/null) | Button shows — correct (they haven't passed calibration). |
| R7: agent passed calibration, later edited so the workflow changed | Out of scope here. `is_calibrated` is only flipped by the batch route; if a future requirement needs "re-calibration on workflow change," it belongs in the calibration subsystem (workflowHash), not this workplan. |

---

## Constraints respected

- **agent-creation-flow skill / FR10 ("no new feature flags")**: that rule scopes the *Phase 2 single-question behaviour*. This is a separate post-creation surface, and the flag was explicitly requested by the user to gate a behaviour-changing UI addition. The Phase 2 contract, v16 prompt, and schemas are untouched.
- **calibration skill**: we only invoke the existing `handleRunCalibration` (`POST /api/v2/calibrate/batch`). No batch-route, detector, repair-engine, or `MAX_ITERATIONS` changes. No calibration invariant touched. Outcome tracking reuses existing columns (R5).
- **CLAUDE.md**: repository pattern for the new write (AgentRepository, mandatory `.eq('user_id', userId)`); Zod validation on the new route; structured Pino logging with `correlationId`; `NEXT_PUBLIC_` prefix + `parseBooleanFlag` for the flag; no hardcoded model names; no new direct-Supabase-in-route added (the new write goes through the repository).

---

## Testing

- `npx tsc --noEmit` — clean on all touched source files.
- **New route**: integration test — happy path (`accepted`/`declined` persisted with timestamp), auth failure (401), invalid input (bad `decision` value → 400). (Per CLAUDE.md testing standards for new API routes.)
- **Repository**: unit test for `recordCalibrationPromptDecision` (writes both columns; scoped by `user_id`).
- **FR12 live smoke test** at `/v2/agents/new`, both flag states:
  - Flag OFF: create an agent → success message → auto-redirect to `/agents/[id]` (no card). Confirms zero regression.
  - Flag ON: create an agent → choice card appears; **Skip for now** → `/agents/[id]` and `calibration_prompt_decision='declined'` persisted; **Test it now** → `/v2/sandbox/[id]?from=creation`, run auto-starts (when inputs exist), and `='accepted'` persisted.
  - Flag ON, agent with no saved inputs: **Test it now** → sandbox shows the setup form (no auto-start, no error).
- **R7 button gating** at `/v2/agents/[id]`: an agent with `is_calibrated=false` shows the "Run Calibration" button; after a successful calibration (`is_calibrated=true`) the button is gone on reload. Confirm no `useCalibrationButton` references remain (`grep -rn useCalibrationButton`).
- Existing suites stay green: `npx jest lib/validation lib/agent-creation` (guard — no logic in those paths changes).

---

## Rollback

Flag is default OFF, so shipping is inert until enabled. The migration is additive (nullable columns) and safe to leave in place. Hard rollback of behaviour is `git revert` of the implementation commit.

---

## Phase 2 — Async Background Calibration + Email + Access Gating (PLANNED)

> **Status:** ✅ Spec finalized & approved 2026-06-17 — build-ready, no code yet.
> **Relationship to Phase 1:** Phase 2 **replaces** the post-creation "navigate to sandbox + auto-start (synchronous)" behaviour. The user no longer watches calibration live for the post-creation path; instead it runs in the background and the user is emailed the result. The agent-detail **manual** "Run Calibration" button (R7) stays **synchronous/live** (the sandbox flow is still used there and for fixing a locked agent).

### Why

Watching calibration run is dead time — it can take minutes (up to 10 iterations, real execution, LLM calls). Better UX: trigger it, tell the user "we're testing your agent, you'll get an email," send them to the dashboard, and unlock the agent when it passes.

### Decisions (from user, 2026-06-16)

| Decision | Choice |
|---|---|
| Async model | **Always background + email.** Accept fires a background job, shows a "calibration triggered — watch your email" message, sends the user to the dashboard. The Phase 1 `?from=creation` sandbox auto-start is removed for this path. |
| Dashboard appearance while calibrating | **Visible but locked** with a "Calibrating…" badge; cannot be opened or run until it passes. |
| Unlock rule | **Only on a clean pass** (0 issues). A failed / needs-review / non-converged run keeps the agent locked; the email + UI direct the user to review & fix in the sandbox. |
| Email | **Reuse Resend via `NotificationService.sendEmailNotification`** with an LLM-built calibration-summary builder on top. Sent on both pass and fail. |

### Requirements

| # | Requirement |
|---|---|
| R8 | Post-creation **accept** runs calibration **in the background by not awaiting it on the client**: the browser fires the existing batch call and immediately navigates to **`/v2/agent-list`**, showing a "we're testing your agent — you'll get an email" chat message. The Phase 1 `?from=creation` sandbox auto-start is removed for this path. |
| R9 | A new agent with a running background calibration appears on the dashboard **visible but locked** — a "Calibrating…" badge, opening/running blocked. |
| R10 | The agent **unlocks (fully accessible) only when calibration passes cleanly** (status `success`, 0 remaining issues). |
| R11 | On the dashboard, clicking an agent whose calibration **failed OR has not run** (`failed` / `skipped`) routes the user to the **sandbox** with the expectation to run calibration — NOT to the agent detail page. Re-running to a clean pass unlocks it. |
| R12 | On the dashboard, clicking an agent whose calibration is **still running** does NOT open it — it shows a message: *"Calibration is still running — please wait for it to finish."* |
| R13 | When the user lands on the sandbox via the R11 redirect, show a prompt: *"You've been redirected to the calibration page. To view this agent we first want to make sure its first run is successful — please run the calibration."* |
| R14 | The agent's calibration state is also surfaced as a **tooltip on hover over the agent name** on the dashboard (status-appropriate copy — see § copy). Keeps the cards uncluttered. |
| R15 | On completion (pass **or** fail), send the user an **email** summarizing the result (LLM-built body from `calibration_history`), CTA → agent on pass, → sandbox on fail, via `NotificationService` (Resend). Sent server-side from the batch route's tail. |
| R16 | New `agents.calibration_status` enum: `running \| passed \| failed \| skipped` (**NULL = legacy / pre-existing, treated as deferred — see R18**). Drives the badge, tooltip, click-target, and access gate. |
| R17 | **"Skip for now" now means "defer," not "use uncalibrated":** a skipped agent is gated (`calibration_status='skipped'`) and its dashboard click routes to the sandbox (R11). Both accept and skip navigate to `/v2/agent-list`. *(Reconciles the gate with the "first run must be successful" philosophy — flagged for confirmation.)* |
| R18 | **Legacy agents are treated as deferred (gated like `skipped`).** A NULL `calibration_status` is interpreted **at read-time** as deferred — clicking such an agent routes to the sandbox to run calibration. **No data backfill** (NULL is interpreted, not migrated). **All Phase 2 gating is behind the feature flag**, so flag-OFF ⇒ nothing is gated (legacy agents open exactly as today) and rollback is instant. *(Flagged for confirmation — note the rollout blast radius below.)* |
| R19 | **Effective gate:** while the flag is ON, an agent opens normally **only if `calibration_status='passed'`**; `running` → "please wait" (R12); **everything else (`failed`, `skipped`, NULL) → sandbox** (R11/R13). Flag OFF ⇒ no gating at all. |

### Technical design (revised 2026-06-16 — lightweight; supersedes the earlier QStash design)

> **Key realization:** calibration already runs to completion inside a single server request within the Vercel-Pro function limit, and Vercel does **not** terminate a serverless function when the client disconnects. So "async" only requires that the **client stop awaiting** the call — no queue, no worker, no service-role, no extraction of the batch route.

**a. Trigger (client fire-and-forget).** Creation-page accept handler: optimistically mark the agent (`calibration_status='running'`), fire `fetch('/api/v2/calibrate/batch', …)` **without `await`** (cookie-authed, exactly as today), show the "we're testing your agent" message, and `router.push('/v2/dashboard')`. The request keeps running server-side after navigation. (Do NOT tie the fetch to an AbortController/unmount.)

**b. Batch route tail (the only batch-route change).** At the end of the existing route — in a `try/finally` so it also runs on error — set `calibration_status` (`passed` on clean success, else `failed`), set `is_calibrated`/`status` on a clean pass (already partly done), and **send the result email**. No restructuring of the calibration loop; we append to what's there. Add `export const maxDuration = 60` for headroom (currently unset → platform default).

**c. Inputs for the background run.** Uses the `input_values` inline-saved at creation (Phase 1 E9 / `agent_configurations`). If absent, do **not** fire the background run — leave the agent **ungated** and tell the user to calibrate manually (mirrors the Phase 1 no-inputs fallback).

**d. Access gating + click routing.** Driven by `calibration_status`:

| Status | Dashboard badge | Hover tooltip | Card click → | Runnable |
|---|---|---|---|---|
| `running` | "Calibrating…" | "Calibration in progress — we'll email you when it's done." | **does not open** — shows "Calibration is still running, please wait for it to finish." (R12) | no |
| `failed` | "Needs attention" | "First run had issues — click to review and fix in calibration." | **sandbox** + redirect prompt (R11/R13) | no |
| `skipped` | "Not calibrated" | "Not yet calibrated — click to run calibration." | **sandbox** + redirect prompt (R11/R13) | no |
| `passed` | (none / "Calibrated ✓") | "Calibrated ✓" | agent detail page | yes |
| `NULL` (legacy / pre-existing) | "Not calibrated" | "Not yet calibrated — click to run calibration." | **sandbox** + redirect prompt (treated as deferred, R18) | no |

While the flag is ON: open/run is allowed **only** for `passed`; `running` shows "please wait"; everything else (`failed`, `skipped`, NULL) routes to the sandbox. While the flag is OFF: **no gating at all** — every agent (incl. legacy) opens normally (R18/R19). NULL is interpreted at read-time; no rows are migrated.

**Sandbox redirect prompt (R13):** when the sandbox is opened from a gated dashboard click (e.g. `?gated=1` or detecting `calibration_status != passed`), render a banner: *"You've been redirected to the calibration page. To view this agent we first want to make sure its first run is successful — please run the calibration."* — then the normal calibration setup follows.

**Copy (draft — final wording TBD):**
- Accept (creation chat): *"Great — we're testing your agent now. You'll get an email with the result, and it'll unlock on the dashboard once it passes."*
- Running click (toast/inline): *"Calibration is still running — please wait for it to finish. We'll email you when it's done."*
- Tooltips: per the table above.

**e. Email (R11).** An LLM prompt builds a short summary from the `calibration_history` row (status, issues found/fixed/remaining, steps). Sent via `NotificationService.sendEmailNotification([userEmail], subject, htmlBody)`. CTA: pass → agent detail; fail → `/v2/sandbox/[id]`.

### Files (anticipated — note how much smaller than the QStash design)

| File | Action |
|---|---|
| `supabase/migrations/<date>_add_calibration_status.sql` | **New** — `agents.calibration_status` enum column (+ index). |
| `lib/repositories/types.ts` + `AgentRepository.ts` | `calibration_status` field + a setter. |
| `app/api/v2/calibrate/batch/route.ts` | Append status-write + email in a `try/finally` tail; add `maxDuration = 60`. **No extraction, no auth change.** |
| `lib/.../calibrationEmail.ts` (new) | LLM summary builder + `NotificationService` send. |
| `app/v2/agents/new/page.tsx` | Accept → set `running`, fire batch (no await), navigate to `/v2/agent-list`. Skip → set `skipped`, navigate to `/v2/agent-list` (R17). Remove `?from=creation`. |
| `app/v2/sandbox/[agentId]/page.tsx` | Remove the Phase 1 `?from=creation` auto-start; add the R13 redirect banner when opened from a gated click. |
| `app/v2/dashboard/page.tsx` + agent card | Badge + hover tooltip + click-routing + locked affordance from `calibration_status`; running-click message (R12). |
| Agent open/run guards | Block while `running`/`failed`/`skipped`; failed & skipped → sandbox; running → "please wait" message. Never gate `NULL`/`passed`. |

### Resolved questions

- **Q1 (locked-failed UX):** No "use it anyway" override. A failed/skipped agent's card click routes to the **sandbox** (fix wizard); re-running to a clean pass unlocks it. Strict "only clean pass" gate, self-resolving. *(User-approved.)*
- **Q2 (skip navigation):** Both accept and skip navigate to **`/v2/agent-list`**. Skip = **defer** (gated, `calibration_status='skipped'`), not "use uncalibrated" (R17). *(User-approved 2026-06-17.)*
- **Q3 (infra):** **No QStash / worker / batch extraction.** Client fire-and-forget + batch-route tail (status + email) + `calibration_status` column. *(User-approved.)*
- **Q4 (re-calibration on later edits):** **Deferred** — out of scope for Phase 2. *(User: "regarding task… we are also good.")*
- **Email:** approach confirmed good (Resend via `NotificationService` + LLM summary). *(User-approved.)*

### Confirmed (2026-06-17)

- **R17 — skip = defer (gated).** ✅ Confirmed. "Skip for now" gates the agent (`calibration_status='skipped'`, click → sandbox); it no longer grants uncalibrated full access.
- **R18 — legacy/NULL agents treated as deferred (gated), full fleet.** ✅ Confirmed (option #1). Pre-existing agents are gated like `skipped` when the flag is ON; no cutoff-date scoping. ⚠️ **Accepted rollout blast radius:** enabling the global `NEXT_PUBLIC_` flag in production locks *every* user's existing agents until calibrated — accepted by design. Mitigated by all gating being behind the flag (OFF = nothing gated, instant rollback) and read-time NULL interpretation (no backfill).

### Risks (revised)

- **Client disconnect mid-run** — mitigated by Vercel continuing the function after disconnect; the `try/finally` tail still writes status + email. Residual: a hard crash/timeout could leave an agent stuck `running` → add a simple stuck-state reaper later if observed (not v1).
- **`maxDuration` ceiling** — calibration already lives within it synchronously today; adding `maxDuration = 60` only adds headroom. If a future calibration needs >60s, *then* revisit QStash.
- **Locked-failed clarity** — the click-to-sandbox routing (Q1) is the escape hatch; ensure the badge copy makes "needs attention" obvious.
- **Cost** — one background calibration + one LLM email summary per created+accepted agent; acceptable, noted.
- **Rollout blast radius (R18)** — enabling the global `NEXT_PUBLIC_` flag in production locks every user's existing agents (legacy NULL = deferred) until calibrated. Acceptable while opt-in/testing; before a production enable, decide whether to scope gating to a cutoff date or accept the full-fleet lock. Rollback is instant (flag OFF).

### Out of scope (Phase 2)

- Realtime/push dashboard updates (email + next-load refresh only).
- Re-calibration on later workflow edits (deferred — Q4 resolved).
- Changing the manual agent-detail calibration button (stays synchronous/live).
- A durable queue (QStash) for calibration — only if the function-time ceiling becomes a real limit.

---

## Phase 2 — Implementation log (2026-06-17)

Built on `fix/v6-drive-extractor-flow`:
- **Migration** `20260617_add_calibration_status_column.sql` — `agents.calibration_status` (`running|passed|failed|skipped`, NULL=legacy) + partial index.
- **Types/repo** — `CalibrationGateStatus` + `Agent.calibration_status` in `lib/repositories/types.ts`; `recordCalibrationPromptDecision` now seeds the gate (accepted→`running`, declined→`skipped`); new `setCalibrationStatus(id,userId,status)`.
- **Email** `lib/calibration/calibrationResultEmail.ts` — LLM summary (deterministic fallback) + HTML, sent via new public `NotificationService.sendTransactionalEmail` (Resend). Best-effort, never throws.
- **Batch route** — `export const maxDuration = 60`; parses `background`; `finally` tail records the gate for **every** run (so a manual sandbox pass also unlocks) and emails the user for **background** runs only. Calibration loop untouched; foreground/manual path behaviour unchanged.
- **Creation page** — accept: record `accepted` + fire batch `{ background:true }` (no await) + navigate to `/v2/agent-list` with a "we're testing — watch your email" message. Skip: record `declined` (→`skipped`) + navigate to `/v2/agent-list`. `?from=creation` removed.
- **Sandbox** — removed the Phase 1 `?from=creation` auto-start; added the `?gated=1` redirect banner.
- **Agent-list (`/v2/agent-list`)** — `getCalibrationGate()` drives badge + hover tooltip + click-routing (passed→agent page, running→"please wait" toast, failed/skipped/legacy→`/v2/sandbox/[id]?gated=1`) + a run-button guard. All behind the feature flag.

✅ **Visibility resolved (option a, 2026-06-17):** the dashboard's agent widget is execution-stats-based and won't show a brand-new, never-run agent, so the post-creation flow now navigates to **`/v2/agent-list`** (where all agents appear and the gating UI — badge, tooltip, click-routing — lives). The user lands directly where their new locked agent is visible. The `/v2/dashboard` route is unchanged (no gating added there).

### Live test findings (2026-06-18)

First live run (flag on, real email-sending agent). Three observations, all diagnosed from `dev.log`:

1. **Two "calibration" emails, same data, different format** → these were the **agent's own output emails** (its `google-mail send_email` step), not calibration notifications. Calibration **runs the real workflow**, so side-effecting steps fire — twice here, because calibration executes the workflow more than once (validation/dry-run + batch, and again after an auto-fix → "second looked better"). ⚠️ **Pre-existing calibration behavior, not introduced by Phase 2**, but the auto-trigger now causes real side effects (real emails to real recipients) right after creation. Flagged for a separate decision (should calibration sandbox/skip outbound sends?). Not changed here.
2. **No "calibration ended" notification email** → root cause: **`RESEND_API_KEY` not configured**, so the Resend path no-ops. The agent's emails arrived via the google-mail plugin (Gmail API + user OAuth), a different path. Resolution: set `RESEND_API_KEY` (verified domain, or `onboarding@resend.dev` sandbox sender for local). **+ Bug fixed:** `sendTransactionalEmail` previously returned `void`, so `calibrationResultEmail` logged "Calibration result email sent" even when Resend was skipped. Now returns `boolean` (sent vs skipped) and the caller logs honestly (`NotificationService.ts` + `calibrationResultEmail.ts`). tsc clean.
3. **Calibration not shown as a run on the agent page** → **by design**: calibration executions are tagged `run_mode='calibration'` and `ExecutionRepository.findByAgentId` excludes them by default ([ExecutionRepository.ts:40-42](../../lib/repositories/ExecutionRepository.ts#L40-L42)). Calibration is a test, not a production run. No change unless we deliberately decide calibration should count.

**Still pending:** apply the migration; set `RESEND_API_KEY` to verify the notification email end-to-end; re-run live smoke (accept→email+lock→sandbox-fix→pass→unlock; skip→locked; running→wait; legacy gated); route/repo tests; decision on the obs-1 calibration-side-effects concern.

---

## Phase 3 — Provider-agnostic email transport (🔨 Implemented 2026-06-18)

> Built: `lib/notifications/emailTransport.ts` (Resend→Gmail→console, structured result, never throws); `NotificationService.sendEmailNotification` + `sendTransactionalEmail` delegate to it (both calibration + approval emails now multi-provider); `.env.example` email section added. tsc clean on touched files. With the current env (invalid Resend key = an email, Gmail fully configured), sends now route via Gmail. Verify in dev.log: look for `Email sent via gmail`.

### Why
The calibration notification (and the pre-existing **human-approval** notification) email both go through `NotificationService`'s Resend-only path, which **no-ops when `RESEND_API_KEY` is absent/invalid**. The codebase already has a *second*, fully-configured email channel — **Gmail OAuth2 via nodemailer** — used by the contact form ([app/api/contact/route.ts:51-60](../../app/api/contact/route.ts#L51-L60)) with `GMAIL_USER` / `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (all set in this env). Rather than hard-wire either provider, send via **whatever is configured**.

### Decision (user-approved 2026-06-18)
Build a small **provider-agnostic email transport** that picks an available provider in priority order and falls back automatically:

```
Resend (if RESEND_API_KEY looks valid: starts with "re_")
   ↓ not configured / send throws
Gmail OAuth2 via nodemailer (if GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN)
   ↓ not configured / send throws
console preview (dev) — returns "not sent"
```

- A `RESEND_API_KEY` that does **not** start with `re_` is treated as *not configured* (skips Resend, logs a warning) — avoids futile 400s (current state: the key is mistakenly an email address).
- Returns a structured result `{ sent: boolean, provider: 'resend' | 'gmail' | 'none', error? }` so callers log honestly (extends the Phase-2 sent-vs-skipped fix).
- **Both** consumers benefit: calibration result email **and** human-approval step emails (the other `NotificationService` user) — unified, no behavior loss; Resend stays first so existing Resend setups are unchanged.

### Files
| File | Action |
|---|---|
| `lib/notifications/emailTransport.ts` | **New** — `sendEmail({to,subject,html,from?})` with the Resend→Gmail→console priority + fallback; structured result. Neutral module (not under `lib/pilot/`). |
| `lib/pilot/NotificationService.ts` | `sendTransactionalEmail` + the private `sendEmailNotification` (approvals) delegate to the transport. Public `sendTransactionalEmail` keeps its `boolean` return (Phase 2). |
| `lib/calibration/calibrationResultEmail.ts` | No change needed — already calls `sendTransactionalEmail`; gains Gmail fallback automatically. |
| `.env.example` + `docs/feature_flags.md`/email docs | Document the provider priority + the `GMAIL_*` and `RESEND_API_KEY`/`RESEND_FROM_EMAIL` vars. |

### Sender / `from`
- Resend default `notifications@neuronforge.app` (or `RESEND_FROM_EMAIL`); requires a verified domain.
- Gmail default `"NeuronForge" <GMAIL_USER>` — no domain verification needed (sends from the real Gmail account).

### Notes / caveats
- Gmail limits (~500/day free, ~2,000/day Workspace) and refresh-token fragility — fine for current low volume; Resend remains the production-preferred path.
- Transport is best-effort; never throws to callers (returns `sent:false`), preserving the Phase-2 "email must never break calibration" invariant.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-14 | Created | Initial workplan for the post-creation calibration prompt. Awaiting user approval before implementation. |
| 2026-06-14 | Revised per review | Flag renamed to `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION`; made approve/decline an explicit mandatory requirement (R3); added persistence of the prompt decision (R4: migration + AgentRepository method + dedicated route); confirmed calibration-outcome tracking reuses existing `is_calibrated`/`calibration_history` (R5, no new outcome columns). |
| 2026-06-14 | Revised per review (round 2) | Added R7: remove `useCalibrationButton()` / `NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON` and gate the agent-detail "Run Calibration" button on `!agent.is_calibrated` (show when not passed, hide when passed). Investigated: single flag consumer at `app/v2/agents/[id]/page.tsx`; agent object already has `is_calibrated` via `select('*')`; `Agent` type needs the field added. Documented the deliberate reversal of the "phasing out" default and the V1/V2 detail-surface distinction. |
| 2026-06-18 | Phase 3: provider-agnostic email | Added `lib/notifications/emailTransport.ts` (Resend→Gmail OAuth2→console, auto-fallback, structured result, never throws). `NotificationService` now delegates both `sendTransactionalEmail` (calibration) and the private `sendEmailNotification` (human-approval) to it — unified, Resend-first. Malformed `RESEND_API_KEY` (not `re_`) is treated as unconfigured. `.env.example` email section added. tsc clean. |
| 2026-06-18 | Live test findings + email-log fix | Diagnosed 3 observations from dev.log: (1) "2 emails" = agent's own google-mail output during calibration's real workflow runs (pre-existing side-effect behavior, flagged); (2) no notification email = `RESEND_API_KEY` not set — **fixed the misleading "email sent" log** by making `sendTransactionalEmail` return sent-vs-skipped boolean; (3) calibration not counted as a run = by-design `run_mode='calibration'` filter. See "Live test findings". |
| 2026-06-17 | Phase 2 implemented | Built migration + types/repo + email module + batch-route tail + creation-page background trigger + sandbox banner + agent-list gating. tsc clean on touched files. Surfaced the dashboard-vs-agent-list visibility note. Pending: migration apply + live smoke + tests. |
| 2026-06-17 | Phase 2 spec approved | User confirmed R18 option #1 (legacy gated, full fleet — no cutoff scoping) and R17 (skip = defer). Phase 2 spec finalized & build-ready; awaiting go to implement. |
| 2026-06-17 | R18 changed: legacy = deferred | Per user: legacy/pre-existing agents (NULL `calibration_status`) are treated as **deferred** (gated like `skipped`, click → sandbox), interpreted at read-time (no backfill). Added R19 (effective gate: only `passed` opens while flag ON). All gating tied to the feature flag (OFF = nothing gated). Flagged the rollout blast radius (global flag locks all existing agents on production enable) + offered a cutoff-date scoping option. |
| 2026-06-17 | Phase 2 gating/UX finalized | Defined the dashboard gating UX: failed/skipped click → sandbox + redirect prompt (R11/R13); running click → "still running, please wait" (R12); status surfaced via hover tooltip on the agent name (R14); status enum + gating/click-routing table (R16). Resolved Q2 (both paths → dashboard; skip = defer/gated, R17) and Q4 (re-calibration deferred). Flagged R17 (skip semantics change) + R18 (legacy NULL agents ungated) for confirmation. Email + async-task approach confirmed by user. |
| 2026-06-16 | Phase 2 simplified | Replaced the QStash/service-role/route-extraction design with a lightweight approach after investigating constraints: calibration already completes in one server request within the Vercel-Pro function limit, and Vercel keeps the function running after client disconnect. So async = client fire-and-forget + batch-route tail (status + email) + a `calibration_status` column. Resolved Q1 (failed → card routes to sandbox; no override) and Q3 (no heavy infra). Dropped enqueue route, QStash worker, batch extraction, R14. |
| 2026-06-16 | Phase 2 defined | Added the async-background-calibration + email + access-gating plan (R8–R14) based on user decisions: always background + email, dashboard "Calibrating…" locked badge, unlock only on clean pass, reuse Resend/NotificationService. Investigated infra: QStash (lib/queues/qstashQueue.ts) for async, Resend via NotificationService for email, `agents.status`/`is_calibrated` for lifecycle. Captured the batch-route-extraction refactor as the primary risk + 4 open questions. No code. |
| 2026-06-16 | UX fixes from first live test | (1) Accept/decline handlers now echo the user's choice (`addUserMessage`) + a bot follow-up (`addAIMessage`) before navigating (400 ms beat). (2) **Progress UI didn't render on auto-start** — root cause: `CalibrationSetup` gated progress on its internal `hasStarted`, set only by its own buttons; added `useEffect(() => { if (isRunning) setHasStarted(true) }, [isRunning])` so externally-triggered runs (auto-start) reflect in the UI. (3) **Concurrent-run guard** — Run/Start buttons now disable + show "Running…" while `isRunning`; parent `handleRunCalibration` early-returns when `flowState === 'running'`. UI-layer only; tsc clean on touched files (the 2 sandbox `agent` null errors are pre-existing). |
| 2026-06-16 | Implemented on `fix/v6-drive-extractor-flow` | All 9 build items done: flag swap + `getFeatureFlags`; R7 button gate + import removal; `Agent` type fields; migration `20260616_add_calibration_prompt_decision.sql`; `AgentRepository.recordCalibrationPromptDecision`; `POST /api/v2/agents/[agentId]/calibration-decision`; creation-page flag branch + approve/decline card + handlers + non-blocking decision write; sandbox `?from=creation` one-shot auto-start; `.env.example` + `feature_flags.md`. Verified: `tsc` adds no new errors on touched files (V2 agent page error count 47→46), no leftover `useCalibrationButton`/`SHOW_CALIBRATION_BUTTON` refs, 87/87 guard tests pass. Pending: live FR12 smoke test; route integration test + repo unit test (listed under Testing). |
