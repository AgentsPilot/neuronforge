# Agent Calibration RCA — `df67bf69` (Daily Retail Solutions Blog Digest Email)

> **Last Updated**: 2026-07-05

## Overview

This document is the consolidated root-cause conclusion for a **locally-created** agent that failed
calibration on the user's local dev server. It answers two asks in one investigation:

- **Part A** — why the agent's calibration failed (earliest failing step → cascade → layer → the
  "2 empty emails" explanation → fix-owner), and whether calibration itself behaved correctly.
- **Part B** — why the IMP-2 admin failure alert did **not** reach the admins, tracing the exact
  suppressing branch/guard.

It is **diagnostic only**. No code was changed. Fixes are recommended and fix-owners named; the Team
Leader routes remediation (SA→Dev for a hotfix, BA for a full cycle). Secret values are never printed —
env vars are referenced by name only.

| Field | Value |
|---|---|
| Agent ID | `df67bf69-c2ec-45e7-8d77-0301caa1ae54` |
| Agent name | Daily Retail Solutions (Israel) Blog Digest Email |
| Environment | Local dev server (`dev.log` in repo root; local/dev Supabase) |
| Calibration session | `926e2cd7-64fc-4533-b562-5c4938c4e39e` — `awaiting_fixes` |
| Calibration history | `0a8b0427-0b89-4f5d-8941-71d7ff23c81c` — `needs_review`, iterations=1, workflow_hash `ce0f123dfa91` |
| Steps | completed=2, failed=3, skipped=0 (of 5) |
| Run type | **owner-initiated background/post-creation** calibration (`isBackground=true`, `adminActorId=null`) |

---

## 1. Reported symptom

The user reported three observations after creating + calibrating this agent locally:

1. Received **2 empty emails** from calibration.
2. Received an email saying **there was an error in the calibration process** of the agent.
3. Did **NOT** receive the **admin failure email** (the IMP-2 admin alert with RCA detail).

---

## 2. Evidence gathered

| Source | Command / location | Salient output |
|---|---|---|
| Calibration DB | `npx tsx scripts/dump-calibration.ts df67bf69…` | session `awaiting_fixes`; history `needs_review`; RCA HINT: earliest failing step = **step1**; `execution_summary.data_written` = 1 × `send_email` ("Sent email"); `first_execution_success=true` |
| Agent DB | `npx tsx scripts/dump-agent.ts df67bf69…` → `c:/tmp/agent-df67bf69.json` | 5 pilot_steps; **step1 `chatgpt-research/research_topic` has `"params": {}`** (no `topic`); step2/step3 are transforms; step5 is `google-mail/send_email` |
| Plugin definition | `lib/plugins/definitions/chatgpt-research-plugin-v2.json` | `research_topic.parameters.required = ["topic"]`, `topic.minLength = 3` |
| Pre-exec validator | `dev.log` L5202-5204, L5601-5603 | `ConstrainedSemanticValidator` flagged `stepId: step1 / "Missing required parameter: topic"` **before** execution — plus step2/step3 type mismatches and step4 refs to non-existent `publication_date`/`source_name` |
| Runtime failure | `dev.log` (calibration issues) | `step1 :: chatgpt-research research_topic failed: Topic is required for research`; step2/step3 `has no input data` |
| Empty-email sends | `dev.log` L7244-7332, L9801, L10087 | step5 `send_email` fired twice (13:03:31, 13:03:46) with subject **"No data available."** (`subject_length: 18`), `provider: "gmail-plugin"` |
| IMP-1 result email | `dev.log` L10846-10864 | `CalibrationResultEmail` sent OK via `provider: "gmail-plugin"`, subject `🔧 We're getting "…" ready for you`, `passed: false` |
| IMP-2 admin alert | `dev.log` L10865-10920 | branch reached; recipients = 2 (`meiribarak@gmail.com`, `offir.omer@gmail.com`); **"Email NOT sent — no working transport"**; `Gmail send failed — invalid_grant: Bad Request`; `Calibration admin alert not delivered`; tail `passed:false, isBackground:true` |
| Env (names only) | `.env.local` | Present: `GMAIL_CLIENT_ID/SECRET/USER/REFRESH_TOKEN`, `NEXT_PUBLIC_APP_URL`, `SYSTEM_ADMIN_USER_ID`. **Absent: `RESEND_API_KEY`.** |

Note: the persisted WP-55 `intent_contract` / `data_schema` was not present on the agent row (null) — this
agent's DSL predates/omits that fingerprint. The **pre-execution `ConstrainedSemanticValidator` findings in
`dev.log` serve as the generation-layer evidence** instead, and they name the same defect that later failed
at runtime.

---

## Part A — Why calibration failed

### 3A. Earliest failing step + cascade

| Step | Type / action | Outcome | Classification |
|---|---|---|---|
| **step1** | `chatgpt-research / research_topic` | **FAILED** — `Topic is required for research` | **Earliest real failure (root)** |
| step2 | `transform / dedupe` | FAILED — `has no input data. Available variables: research_results` | Cascade |
| step3 | `transform / filter` | FAILED — `has no input data. Available variables: research_results, unique_results` | Cascade |
| step4 | `ai_processing / generate` | ran on empty input → produced `subject: "No data available."` | Cascade side-effect |
| step5 | `google-mail / send_email` | executed — **sent the empty digest email** | Cascade side-effect (dry-run send) |

**step1 is the earliest and only independent failure.** The compiled DSL step1 has `"params": {}` — the
required `topic` parameter was never bound, even though the Enhanced Prompt unambiguously states the topic
("retail solutions in Israel"). The `chatgpt-research` executor correctly rejected the call. steps 2/3 then
fail with the classic cascade signature ("…has no input data"), and step4/step5 run on the empty state —
they are **not** independent bugs.

### 4A. Classified root-cause layer — **V6 generation**

The failure is a mis-compiled DSL, not bad user data and not an external-API rejection:

- **Not input/data:** the user supplied the topic; the EP encodes it correctly. There is no user value to
  fix.
- **Not runtime/external API:** the executor's rejection is *correct* — a request with no `topic` is
  genuinely invalid per `research_topic.parameters.required = ["topic"]`.
- **V6 generation** owns it: the pipeline emitted `step1.params = {}`, dropping the mandatory `topic`
  binding that should have been derived from the EP. The same run's `ConstrainedSemanticValidator` proved
  this is a generation defect by detecting it statically *before* execution
  (`dev.log` L5203-5204: `stepId: step1 / "Missing required parameter: topic"`).

**Compounding generation defects (same layer, same broken version).** The validator also flagged, and the
DSL confirms, several other structural mismatches that would each fail even if `topic` were bound:

| Defect | Evidence | Why it's wrong |
|---|---|---|
| step2 dedupe input type | `dev.log` L5306; DSL step2 `input: {{research_results.key_points}}` | `key_points` is an array of **strings**; `dedupe` by field `url` expects array of **objects** |
| step3 filter input type | `dev.log` L5311 | `unique_results` is an **object**, `filter` expects an **array** |
| step4 field references | `dev.log` L5320-5335 | prompt/table use `publication_date` + `source_name`, but `research_topic.sources` only expose `{title, url, snippet}` — no date/source-name field exists |

These share `workflow_hash=ce0f123dfa91` and belong to the same V6-generation root cause.

### 5A. The 2 empty emails — pinned

The user's **2 empty emails** are the agent's **own `step5 send_email` firing on empty data during the two
calibration dry-run executions** — exactly the `3fc703fd` "Sheet1" pattern (an empty "no leads" email
really sent from the dry-run).

- Two `agent_executions` rows exist (13:03:34 and 13:03:49 window; step5 sends at 13:03:31 and 13:03:46).
- Both sent subject **"No data available."** (`subject_length: 18`, `dev.log` L7250, and the second at
  L9801/L10087) to `meiribarak@gmail.com` via the owner's `gmail-plugin` connection.
- `execution_summary.data_written = [{action:"send_email", count:1, description:"Sent email"}]` corroborates
  a real send per execution.

The **"error in the calibration process" email (symptom #2)** is a **separate, third** message: the IMP-1
`CalibrationResultEmail` ("🔧 We're getting … ready for you", `passed:false`), sent OK at 13:03:57 via the
owner's `gmail-plugin` connection (`dev.log` L10846-10864). It is expected behaviour, not a defect.

> **Root cause of the empty sends:** execution does **not** short-circuit delivery when the upstream data
> pipeline produced nothing. step4/step5 run unconditionally on empty state and dispatch a real email. This
> is a **dry-run side-effect / execution-engine gap** (Pilot engine), distinct from the step1 generation
> bug that triggered the emptiness. step3 carries `_on_empty: "warn"` but there is no empty-guard on the
> delivery step.

### 6A. Did calibration behave correctly? — **Yes (honest failure detection)**

Calibration behaved correctly and must be recorded as an honest failure, **not** a calibration-detection
defect:

- It landed `needs_review` / `awaiting_fixes` (not a false `success`), with `passed=false`.
- It surfaced the real earliest failure (step1 topic) and correctly marked step2/step3 as failures with the
  cascade "no input data" message.
- It even caught the defect **statically pre-execution** (`ConstrainedSemanticValidator`).

The **one honest caveat** is the dry-run side-effect: calibration executed the agent's real `send_email`
step twice against live Gmail, so the user received 2 real (empty) emails. That is a side-effect of running
the real workflow, correctly recorded in `execution_summary.data_written` — it is a Pilot-engine
delivery-guard gap, not a mis-report by calibration's detection logic.

### Fix-owner (Part A)

| Concern | Fix-owner | Recommended fix |
|---|---|---|
| **Primary — missing `topic` binding on step1** | **`v6-pipeline`** (IntentToIRConverter / ExecutionGraphCompiler — required-param binding) | Bind `research_topic.topic` from the EP topic; never emit an action step with an empty `params` when the plugin declares required params. |
| step2/step3 type mismatches, step4 phantom fields | **`v6-pipeline`** (same broken version) | Align transform input shapes to the actual upstream schema; don't reference fields (`publication_date`, `source_name`) absent from the `research_topic` output schema. |
| Empty digest email really sent in dry-run | **Pilot execution engine** (`lib/pilot/`) | Guard the delivery step: when upstream produced no items, skip (or hold) `send_email` in calibration/dry-run mode rather than sending an empty message. |

---

## Part B — Why the IMP-2 admin alert did NOT fire

### 3B. What actually happened (the dispatch path executed)

Contrary to the "was it gated / deduped / no-recipients?" suspects, the admin-alert branch **fully
executed** and was **not** suppressed by any guard:

**File:** `app/api/v2/calibrate/batch/route.ts` (L4632)

```typescript
if (isBackground && !passed && latest?.workflow_hash) {   // ← all TRUE for this run
  const dedup = await histRepo.hasAdminAlertBeenSent(...);
  if (dedup.data === true) { /* skip */ }                 // ← NOT taken (first alert)
  else {
    const adminEmails = await AdminAccessService.getInstance().listAdminEmails();  // ← 2 recipients
    const sent = await sendCalibrationAdminAlert({ adminEmails, ... });
    if (sent && latest.id) { await histRepo.markAdminAlerted(...); }  // ← sent=false, so NOT marked
  }
}
```

Ruling out each prime suspect against `dev.log`:

| Suspect | Verdict | Evidence |
|---|---|---|
| **workflow_hash dedup** suppressed it | **No** — dedup did not trigger; no "already sent … skipping (dedup)" line | `dev.log` (no dedup line); first alert for `ce0f123dfa91` |
| **Owner- vs admin-initiated** gating | **No** — IMP-2 fires on any `isBackground && !passed` run, including owner-initiated | `route.ts` L4632; tail log `isBackground: true` (L10920) |
| **Outcome not classified as failure** | **No** — `passed=false` (`needs_review` with remaining issues) satisfies the guard | `route.ts` L4595; tail `passed: false` |
| **`listAdminEmails()` empty** | **No** — resolved **2** recipients | `dev.log` L10870 / L10898: `meiribarak@gmail.com`, `offir.omer@gmail.com` |
| **Email transport not configured** | **YES — this is the cause** | see below |

### 4B. Classified root-cause layer — **runtime / external configuration (email transport)**

The admin alert was composed and dispatched, then **silently no-op'd at the transport layer** because the
**system email transport has no working path on the local server**.

**Root of the transport failure:**

- `sendCalibrationAdminAlert` calls `notificationService.sendTransactionalEmail(adminEmails, …)` **with NO
  `ownerUserId`** (by design — an internal alert must use system transport, never a per-user plugin
  connection). See `lib/calibration/calibrationAdminAlert.ts` L79-81.
- The system transport chain is Gmail-app → Resend. Locally:
  - **Gmail-app** auth fails: `Gmail send failed — trying next transport … err: "invalid_grant: Bad
    Request"` (`dev.log` L10865-10868). The `GMAIL_REFRESH_TOKEN` in `.env.local` is present but invalid.
  - **Resend** is not configured: **`RESEND_API_KEY` is absent** from `.env.local`.
  - Result: `📧 [EmailTransport] Email NOT sent — no working transport` (L10869) →
    `No email transport delivered the message (preview only)` (L10894) →
    `Calibration admin alert not delivered — no email transport succeeded` (L10911).

**Why the other two emails still arrived while the admin alert did not** — the key asymmetry:

| Message | Transport used | Result |
|---|---|---|
| 2× agent `step5 send_email` (empty digest) | Owner's **google-mail plugin connection** (agent's own OAuth) | Delivered (`provider: gmail-plugin`) |
| IMP-1 `CalibrationResultEmail` | Passed `ownerUserId` → **owner's plugin-connection fallback** | Delivered (`provider: gmail-plugin`, L10860) |
| **IMP-2 admin alert** | **System transport only** (no `ownerUserId`) → Gmail-app / Resend | **Not delivered** (both unavailable locally) |

So the user-facing emails rode the owner's working per-user Gmail OAuth, while the admin alert — correctly
refusing to use a per-user connection for an internal alert — fell through to a system transport that is
not wired up locally. The alert code behaved correctly (it did not throw, and it deliberately did **not**
call `markAdminAlerted` because `sent=false`, so a later run can retry).

### Fix-owner (Part B)

| Concern | Fix-owner | Recommended fix |
|---|---|---|
| **Admin alert not delivered** | **External configuration** (local dev environment) — **not a workflow/code bug** | Configure a working system transport locally: set a valid `RESEND_API_KEY`, or refresh the Gmail-app OAuth so `GMAIL_REFRESH_TOKEN` is valid (fix the `invalid_grant`). |
| Optional hardening (observability) | `calibration` skill (batch route / `calibrationAdminAlert`) | The current behaviour is already correct (no false `markAdminAlerted` on transport failure). Optionally raise the "not delivered" log to a more visible signal, or add a local-dev preview transport so admin alerts are observable without real delivery. |

> **Note:** because `markAdminAlerted` was **not** called (dispatch returned `sent=false`), the
> `workflow_hash` dedup will **not** block a retry: a subsequent background calibration of the same version
> will attempt the admin alert again. Once system transport is configured, it should deliver.

---

## 5. Consolidated conclusion (earliest root cause + fix-owner)

| Part | Root cause | Layer | Fix-owner | Path |
|---|---|---|---|---|
| **A — calibration failure** | V6 compiled `step1.params = {}`, dropping the required `research_topic.topic` binding (steps 2/3/4/5 cascade; the 2 empty emails are step5 firing on empty dry-run data) | **V6 generation** (primary) + Pilot **execution engine** (empty-delivery guard) | `v6-pipeline` (param binding) + `lib/pilot/` (dry-run delivery guard) | Full cycle |
| **B — no admin alert** | System email transport unavailable locally (Gmail-app `invalid_grant`; `RESEND_API_KEY` absent) — the dispatch path itself ran correctly, was not deduped/gated, and resolved 2 recipients | **runtime / external configuration** | External configuration (dev env) | Hotfix (config) |

**Calibration behaved correctly** — it honestly detected a real failure (`needs_review`, real issues
surfaced, defect even caught statically pre-execution). It is **not** a calibration-detection defect. The
only calibration-adjacent caveat is the dry-run delivery side-effect (empty emails), owned by the Pilot
engine.

---

## 6. Recommended remediation path

| Item | Path | Rationale |
|---|---|---|
| **B — configure local system email transport** | **Hotfix (config-only)** | No code change; set `RESEND_API_KEY` or repair the Gmail-app refresh token. Restores admin-alert delivery immediately. |
| **A — V6 required-param binding + related generation defects** | **Full cycle** (BA → workplan → SA → Dev) | Touches `v6-pipeline` param binding and transform-shape correctness; needs a regression scenario and V6 protocol handling (see proposed WP entry below). |
| **A — dry-run empty-delivery guard** | **Full cycle** (Pilot engine) | Behavioural change to execution; must be designed so calibration never sends empty/real user emails. Can be bundled with the V6 fix cycle or tracked separately. |

Routing decision is the Team Leader's: Part B → SA→Dev (or direct config); Part A → BA to open a formal
requirement.

---

## 7. Proposed V6 backlog entries (PROPOSAL ONLY — do not write to the backlog)

Per the CLAUDE.md V6 Work Protocol, the Part A generation defect warrants a WEAK_POINTS entry. **TS only
proposes the text here; TL/Dev own the actual write** to
`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` and `V6_OPEN_ITEMS.md` when the fix lands.

**Proposed WEAK_POINTS.md entry:**

> **WP-XX — Required action params dropped at compile (empty `params: {}` on a required-param action)**
> - **Problem:** For agent `df67bf69`, V6 emitted `step1` (`chatgpt-research/research_topic`) with
>   `params: {}`, omitting the plugin-declared required `topic` (`required: ["topic"]`). Runtime failed
>   with `Topic is required for research`; steps 2-5 cascaded and an empty digest email was sent.
> - **Evidence:** `dump-agent df67bf69` step1 `params:{}`; plugin def
>   `chatgpt-research-plugin-v2.json` `research_topic.required=["topic"]`; `dev.log` L5203-5204
>   `ConstrainedSemanticValidator` "Missing required parameter: topic" (caught statically); runtime issue
>   `research_topic failed: Topic is required for research`.
> - **Fix shape:** In the IR converter / compiler, when a bound action declares required params, resolve
>   each from the EP/intent (here the topic "retail solutions in Israel"); never emit an action step whose
>   `params` omit a plugin-required field. Also align step2/step3 transform input shapes to the real
>   upstream schema and drop step4 references to non-existent `publication_date`/`source_name` fields.
> - **Why not caught earlier:** the semantic validator *did* detect it pre-execution, but the run
>   proceeded to execute anyway (detection did not gate delivery), so the compile-time gap surfaced only at
>   runtime and as a real empty email.

**Proposed V6_OPEN_ITEMS.md one-liner:**

> - WP-XX — V6 drops required action params (empty `params:{}`); required-param binding must derive from
>   EP. See WEAK_POINTS WP-XX. (agent `df67bf69`)
