# Workplan — EP-Production Sheets-Range Fix (the "Sheet1" fabrication)

> **Last Updated**: 2026-07-01
> **Owner**: Dev · **Surface**: agent-creation-flow (v16 prompt) + google-sheets plugin executor
> **RCA**: [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](../investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md) · Method: [AGENT_CREATION_RCA_RUNBOOK.md](../investigations/AGENT_CREATION_RCA_RUNBOOK.md)

## Overview

Root cause (proven from thread `08c05035…` `iterations[]`): v16 **Phase 3** fabricated `range="Sheet1"` from a `gid=0` spreadsheet URL — the narrative preserved "gid=0 / first tab" while the structured `resolved_user_inputs` collapsed it to Google's default tab name. Drivers: `range` mis-framed as "a single sheet tab name" (v16 L275), a `Sheet1!`-leading plugin example, and a mandate to emit a concrete value, with **no rule** for opaque-id / URL-fragment references.

**Deeper root cause — a v16 regression (verified 2026-07-02).** The mis-framing was **latent in v14/v15** and harmless there, because those versions' *"Ask until nothing is ambiguous"* bias + the parameter-aware block **elicited the tab from the user** (v15 GOOD example: *"Which single sheet tab should rows be appended to?"*). v16 added the **PACING & CONVERGENCE / STOP-early** rule (commit `5ac952c`, OI1) — verified new to v16 (`git`: "PACING & CONVERGENCE" 0/0/1 across v14/v15/v16). That flipped the bias from *ask* to *default-and-stop*, so the tab question got **skipped**, leaving Phase 3 to materialize a value it never collected → fabrication. **The pacing/assumptions requirement is the trigger; the mis-framing is the latent fault it activated.**

**Three fixes, layered (primary-first):**
- **#3 (PRIMARY — pacing carve-out, Phase 2):** restore the v15 behavior *surgically* — required plugin parameters are not silently defaultable; ask/confirm a spec-matching value. Applied + smoke-tested (below).
- **#1 (BACKSTOP — Phase 3 anti-fabrication):** if the value still isn't collected, don't fabricate — emit name-less/defer.
- **#2 (HYGIENE — framing):** remove the false "single sheet tab name" teaching.
- Deterministic guarantee = the **optional** gid-carry cycle (see Part 2), now demoted.

---

## Part 1 — v16 prompt fix (#3 primary + #1 backstop + #2 hygiene) — ✅ APPLIED + smoke-tested

**File:** `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`

| # | Change | Status |
|---|---|---|
| **#3 (primary)** | New EXCEPTION inside the Phase-2 PACING rule (~L233): "required plugin parameters are NOT auto-defaultable" — a param a bound action marks required (per `plugin_action_summary`) may not be silently defaulted when the user hasn't supplied it in a directly-consumable form (incl. an opaque URL/id/fragment where the param needs a name); ask **one** concise question for a spec-matching value, or to confirm the param's default/name-optional form, framed low-friction ("read the first tab, or a specific named tab?"). Narrow: required plugin params only; business gaps still default. No plugin names hardcoded. | ✅ |
| **#2 (hygiene)** | L275 (parameter-aware): reframed the `range` example from "single sheet tab name" → "A1 notation; the sheet/tab name is optional, and omitting it targets the first/default tab". Removes the mis-teaching (the latent fault). | ✅ |
| **#1 (backstop)** | New Phase-3 HARD RULE (~L496): "NEVER FABRICATE A HUMAN-READABLE IDENTIFIER FROM AN OPAQUE ONE" — when a resource is given only as an opaque id/URL fragment with no user-given name, emit a name-optional/id form (name-less `A:Z` → first tab) or defer to `user_inputs_required`; never guess; preserve the opaque id in prose. Catches the cases #3 doesn't ask. | ✅ |

**Smoke results (faithful `3fc703fd` replay, gpt-5.2, throwaway harness):**
- **#3 carve-out** — replayed to the point the old prompt stopped: right after the URL, **4/6** runs ask the tab with the ideal framing (*"…or the first tab, just say so"*); 2/6 ask another question first. Late catch-up once skipped: **0/6** (so position matters — the ask must land while the plugin param is the fresh topic). No over-asking blow-up (legitimate questions only, count stays ~6).
- **#1 backstop** — Phase-3 replay: **4/6** emit a valid name-less range or defer; baseline was **100% `"Sheet1"`**. Non-regressive.
- **Combined estimate** — carve-out asks (≈4/6) ∪ backstop catches the rest (≈4/6 of remainder) ≈ **~90% clean**. A strong mitigation, **not** a guarantee — which is why the deterministic gid-carry (Part 2) remains available, now optional.

**Guardrails honored:** no hardcoded plugin/action names (CLAUDE.md § No Hardcoding) — `gid`/`A:Z` used as illustrative examples of the general class, matching the prompt's existing illustrative style; no new Phase-3 schema field (a name-less range fits the existing `range` string); no new feature flag (FR10); no new Phase-3 divergence from v15's contract shape (this is a rule addition within Phase 3, not a response-shape change).

### Validation checklist
- [x] Prompt-only change — no TS/schema touched, so `tsc`/jest unaffected.
- [x] **FR12 smoke test (faithful replay).** Replayed the exact `3fc703fd` conversation (thread `08c05035`, iters 0–6 + the Phase-3 request) with the **new** v16 loaded via `PromptLoader`, model `gpt-5.2`, temp 0.1 — an A/B of the same inputs against the new prompt (`scripts/_tmp-smoke-sheets-range.ts`, throwaway). **Result over 6 runs: 4/6 acceptable** (3× valid name-less `A:ZZ`, 1× safely deferred to `user_inputs_required`), **1/6 fabricated `Sheet1!A:ZZ`** (same failure class as baseline, but rarer — non-regressive), **1/6 dropped the range** (⚠). `"Sheet1"` as a bare value never recurred. **Baseline was 100% `"Sheet1"`** (both original Phase-3 productions), so this is a large, non-regressive improvement — **but not a guarantee.**
- [ ] **Full UI smoke at `/v2/agents/new`** (dev server) — pending; the replay exercises the same v16 prompt + provider path, but FR12 also wants the live UI once for UX (confirm the carve-out asks the tab question naturally, no over-asking).
- [ ] Spot-check a **named-tab** case still resolves the name (the mandate must still fire for user-named identifiers) AND that the carve-out does NOT re-ask when a usable value was already given.

### FR12 finding → prompt fixes are a strong mitigation, not a guarantee
Prompt tuning is **non-deterministic** here — both approaches top out around 4/6: the Phase-2 carve-out (#3) reliably asks the tab **when the plugin param is the fresh topic** (4/6 right after the URL) but not on a late catch-up (0/6); the Phase-3 backstop (#1) emits name-less/defer 4/6. Combined ≈ ~90% clean vs a 100%-`"Sheet1"` baseline. **An LLM slot cannot be made deterministically correct by prompt text alone.** The deterministic guarantee therefore lives at a layer that can read the live sheet — see Part 2.

---

## Part 2 — the runtime layers (safety net + optional deterministic enhancement)

Two runtime layers back the prompt mitigation. Neither is built by *this* workplan; both are tracked elsewhere.

> **Option A — calibration safety net (existing, in-flight).** [CALIBRATION_DATASOURCE_RESOLVER_WORKPLAN.md](./CALIBRATION_DATASOURCE_RESOLVER_WORKPLAN.md). On a `parameter_error` it can't fix from the blueprint, reads the **live** sheet and corrects the value. Sheets resolver ([googleSheetsRange.ts](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts)) fires on `"Unable to parse range: Sheet1"`, maps bad range → real tab (single → 0.95; multi-tab → best-effort first tab = lost `gid=0` intent). Registered + route-wired. **Still guesses** the multi-tab case because the gid was discarded upstream.

> **gid-carry — deterministic enhancement (OPTIONAL, deferred — 2026-07-02).** [GOOGLE_SHEETS_GID_RESOLUTION_WORKPLAN.md](./GOOGLE_SHEETS_GID_RESOLUTION_WORKPLAN.md) (SA-approved). Carries the `gid` end-to-end (EP → V6 → `sheet_gid` param → executor resolves `gid→title`) so **no layer guesses** — exact for `gid=0`, non-zero gids, and renamed tabs. **Demoted to optional** after the carve-out + backstop reached ~90%: build it only if that floor + Option A prove insufficient in production, or when arbitrary non-zero gids become a real need. *(Supersedes the 2026-07-01 "drop the executor guard" decision — user re-approved scoping it as an optional cycle on 2026-07-02.)*

### The reconciled division of labor for the `3fc703fd` class
| Layer | Owner | Role | Status |
|---|---|---|---|
| **#3 carve-out** (Phase 2) | this workplan | *Ask* for a spec-matching value — the primary, best-UX mitigation | ✅ applied (~4/6) |
| **#1 backstop** (Phase 3) | this workplan | *Don't fabricate* if still uncollected | ✅ applied (~4/6 of remainder) |
| **Option A** (calibration) | `CALIBRATION_DATASOURCE_RESOLVER_WORKPLAN.md` | *Catch & fix* at calibration by reading the live sheet (guesses multi-tab) | 🟡 in-flight |
| **gid-carry** (creation→executor) | `GOOGLE_SHEETS_GID_RESOLUTION_WORKPLAN.md` | *Deterministic* exact-tab resolution | ⏸ optional/deferred |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-02 | #3 carve-out added (primary) + regression root cause | Verified the v16 PACING rule (commit `5ac952c`) as the regression trigger (git: "PACING & CONVERGENCE" new to v16; v14/v15 *asked* for the tab). Added a Phase-2 carve-out — required plugin params not auto-defaultable. Smoke: 4/6 ask the tab right after the URL (0/6 late catch-up); combined with #1 ≈ ~90% clean. |
| 2026-07-02 | Part 2 repositioned | gid-carry re-approved (2026-07-02) as an **optional/deferred** deterministic enhancement (its own workplan), demoted after the carve-out reached ~90%. Option A remains the calibration safety net. Supersedes the 2026-07-01 "drop executor guard" note. |
| 2026-07-01 | Part 1 applied + smoke-tested | v16 #1 (anti-fabrication rule) + #2 (L275 reframe). FR12 faithful replay: 4/6 acceptable, baseline was 100% "Sheet1" — non-regressive mitigation, not a guarantee. |
