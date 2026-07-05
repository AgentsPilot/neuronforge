# Workplan: Troubleshooter (TS) — Agent-Failure RCA Team Member

**Developer:** Dev
**Requirement:** [TROUBLESHOOTER_AGENT_REQUIREMENT.md](/docs/requirements/TROUBLESHOOTER_AGENT_REQUIREMENT.md)
**Branch:** `agent-failure-troubleshooting` *(existing branch — user- and TL-approved continuation for this cycle; RM did not cut a new `feature/...` branch on purpose, so unrelated in-progress working-tree changes are not disturbed)*
**Date:** 2026-07-05
**Status:** Planning

---

## Analysis Summary

This is a **meta-feature**: a new AI-agent-team member (the **Troubleshooter / TS**) defined as an agent Markdown file, plus its integration into the existing team workflow. **There is zero application/runtime code** — no API routes, repositories, components, DB migrations, prompts, plugins, or DSL. Nothing under `app/`, `lib/`, or `components/` is touched.

**What the feature touches (3 files):**

| Concern | File | Nature |
|---|---|---|
| New agent definition | `.claude/agents/troubleshooter.md` | New Markdown (frontmatter + prose) |
| Team roster | `CLAUDE.md` (Agent Team table) | One table row added |
| Orchestration | `.claude/agents/team-leader.md` | TS trigger recognition + routing + handshake + routing-record rule |

**What the TS agent operates (read-only, NOT modified by this feature):**
- Three DIAGNOSTIC-ONLY RCA skills: `.claude/skills/agent-creation-rca/SKILL.md`, `.claude/skills/calibration-rca/SKILL.md`, `.claude/skills/v6-pipeline/SKILL.md`.
- Three read-only evidence scripts: `scripts/dump-agent-thread.ts`, `scripts/dump-agent.ts`, `scripts/dump-calibration.ts` (all three confirmed present).
- Style reference: `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` (retained untouched).
- Runbooks the skills point to: `docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md`, `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md`.

**Convention baseline (from reading the five existing agent files):** every agent file uses YAML frontmatter with exactly `name` / `description` / `tools`, a `# Role: <Name> (<Initials>)` heading, and (for the worker agents BA/SA/QA) a `Tech Stack Context` block, procedure/phase sections, `## Communication Rules`, and `## What You Must NOT Do`. TS follows the BA/SA/QA shape (worker agent), not the TL/RM shape.

---

## Implementation Approach

### Phase-ownership note (per CLAUDE.md root-cause rule)
No runtime phase is being changed. The "root cause phase" framing does not apply — this is a documentation/agent-definition deliverable. The only correctness surface is **convention fidelity to the existing agent files** and **coverage of FR-1…FR-22**.

### File 1 — `.claude/agents/troubleshooter.md` (create)

The file's CONTENT must satisfy FR-1 through FR-22. Concretely it will contain:

1. **Frontmatter (FR-1/FR-2/FR-3):**
   - `name: troubleshooter`
   - `description:` (multi-line, matching the `description: |` style of the other agents) stating TS is **triggered by the user or TL when an agent failure is reported**, is **strictly diagnostic**, operates the three RCA skills across the full agent lifecycle, and **produces a root-cause conclusion with a named fix-owner** — recommends but does not fix.
   - `tools: Read, Bash, Write, Glob` — **exactly these four, no `Edit`.** Rationale captured in prose: Bash is scoped to the read-only dump scripts; Write is scoped to the single conclusion doc under `docs/investigations/`. This tool restriction is the *hard structural guarantee* of the diagnostic-only boundary (NFR "Diagnostic-only safety").

2. **`# Role: Troubleshooter (TS)`** heading + one-line role statement (strictly-diagnostic agent-failure RCA).

3. **`## Tech Stack Context`** — same block as BA/SA/QA (Next.js 14 / Supabase / multi-provider LLM / Zod / Pino / Vercel / Jest+Playwright), so the file matches the roster convention (NFR "Convention consistency").

4. **`## Input Contract`** (FR-7/FR-11): accepts any one of **agent ID / execution ID / calibration session ID**, plus an OPTIONAL free-text symptom. **If given only a symptom with no identifier → TS asks the user for an identifier before proceeding; it must not guess or attempt a live reproduction to obtain one** (FR-11). When a `suspect_value` can be derived from the symptom, pass it to `dump-agent-thread.ts` to trace first appearance (FR-12).

5. **`## Lifecycle Stages & Worked Paths`** (FR-4, AC-4) — a table + four worked paths, each naming its **input identifier type**, the **dump script(s)** it runs, and the **RCA skill** it operates:
   - (a) **Creation chat flow** → skill `agent-creation-rca`; input = agent ID; runs `scripts/dump-agent-thread.ts <agent_id> [suspect_value]` + `scripts/dump-agent.ts <agent_id>`; identifies the authoring iteration/phase of a disputed value in `metadata.iterations[]` (FR-8).
   - (b) **V6 DSL generation** → skill `v6-pipeline`; input = agent ID; uses persisted `intent_contract` / `data_schema` via `scripts/dump-agent.ts <agent_id>`; identifies the failing pipeline phase.
   - (c) **Calibration** → skill `calibration-rca`; input = calibration session ID **or** agent ID; runs `scripts/dump-calibration.ts <agent_id>` (+ `scripts/dump-agent.ts <agent_id>`); reads the RCA HINT (earliest failing step + cascade) and names the earliest failing step (FR-9).
   - (d) **Runtime execution / external plugin API** → input = execution ID; resolves the owning agent, runs the appropriate dump script(s) to reach the failing step + raw external-API error/reason; **always** writes the standard conclusion with layer = `runtime/external API` and fix-owner = named executor/external config (FR-4d, FR-10, Q4).

6. **`## The Three-Skill Handoff Chain`** (FR-5, AC-5): document the chain **creation → V6 → calibration** as one investigation, and the rule that TS follows it to the **earliest** failing stage, not the loudest symptom. Include the concrete worked hand-offs from the skills: a `calibration-rca` conclusion proving the value originated in EP production continues into `agent-creation-rca`; a calibration/creation RCA proving the EP was correct but the compiled DSL is wrong continues into `v6-pipeline`.

7. **`## Root-Cause Layer Classification`** (FR-6): the fixed five-value set — **input/data · V6 generation · runtime/external API · calibration-detection · creation chat flow** — exactly one per conclusion.

8. **`## Evidence Integrity` / diagnostic-only method** (FR-13/FR-14): rely on **persisted** evidence (DB rows, `metadata.iterations[]`, persisted `intent_contract`); **never re-generate or re-run an agent to diagnose** (non-determinism trap) — a live re-run is only a means of *testing a fix*, which is out of TS's scope; never introduce a write path; the dump scripts are read-only.

9. **`## Conclusion Document (Deliverable)`** (FR-16/FR-17/FR-19, AC-7): **one consolidated** doc per reported failure under `docs/investigations/`, named `AGENT_RCA_CONCLUSION_<slug>.md` (SCREAMING_SNAKE_CASE), in `EP_PRODUCTION_RCA_CONCLUSION_*` **style** (header block: title, `> **Last Updated**`, Overview) with the **8 required fields**:
   1. reported symptom
   2. evidence gathered (which scripts run + salient outputs)
   3. earliest failing step + cascade
   4. classified root-cause layer (one of the five)
   5. defensible root cause (the "why", with exact references — prompt lines, plugin-definition JSON, step/field, or external API reason)
   6. named fix-owner (phase/surface/skill — e.g. `agent-creation-flow` v16 Phase 3, `v6-pipeline` IR converter, a specific plugin executor)
   7. suggested solution(s)
   8. recommended remediation path — **hotfix vs full cycle**

   Plus the **one-consolidated-doc rule**: when the investigation traverses the three-skill chain across stages, produce a **single** doc — one labelled section per stage traversed + a single final "earliest root cause + fix-owner" — never one doc per skill (FR-16, Q3). And the **honest-failure distinction** (FR-19): state whether calibration behaved correctly (honest failure detection) vs a calibration-detection defect.

10. **`## V6 Defects — Propose, Do Not Write`** (FR-18, AC-8): when the root cause is a V6 defect, **additionally propose** the WEAK_POINTS.md / V6_OPEN_ITEMS.md entry *text* per the CLAUDE.md V6 Work Protocol — **inside the conclusion doc only**. TS **must not** write to WEAK_POINTS.md or V6_OPEN_ITEMS.md (TL/Dev own that backlog write when the fix lands), preserving single-source-of-truth.

11. **`## Handoff — Agent Recommends, TL Routes`** (FR-20, AC-9): TS recommends a remediation path but **must not** trigger BA/SA/Dev and **must not** open a feature/fix branch, workplan, or requirement.

12. **`## Communication Rules`** — conclusions live in the investigation doc (single-sourced); ask for an identifier when only a symptom is supplied; state explicitly when calibration behaved correctly; quote exact evidence references; recommend, never route.

13. **`## What You Must NOT Do`** (FR-13/FR-15/FR-18/FR-20, AC-3) — explicit list:
    - Never edit or write production/application code, prompts, plugin definitions, DSL, or schemas (the only file TS writes is its conclusion doc under `docs/investigations/`).
    - Never trigger BA, SA, or Dev; never open a branch/workplan/requirement — TS recommends, **TL routes**.
    - Never write to WEAK_POINTS.md or V6_OPEN_ITEMS.md — only propose their text.
    - Never re-generate/re-run an agent to diagnose (non-determinism); never mutate data; live re-runs belong to fix-testing (Dev/QA).
    - The actual fix is **always implemented by Dev after SA review** — never by TS (FR-15).

### File 2 — `CLAUDE.md` Agent Team table (modify)

Add exactly one row to the Agent Team table:

| Agent | Initials | Triggered by |
|---|---|---|
| Troubleshooter | TS | User or TL |

Placed logically in the roster (after RM, or grouped near the diagnostic flow — final placement to be confirmed in review). No other CLAUDE.md edits (FR-22, AC-10). *Note: the "Standard flow" line in CLAUDE.md describes the build cycle; TS is an out-of-band diagnostic entry point, so the standard-flow diagram is intentionally left unchanged — routing lives in team-leader.md.*

### File 3 — `.claude/agents/team-leader.md` orchestration (modify)

Teach TL four things (FR-21, AC-11), added as a new subsection (e.g. `## Troubleshooter (TS) Routing`) plus a couple of Handshake-Rules rows:
- (a) **TS trigger**: TS can be triggered by the **user (or TL)** when an agent failure is reported.
- (b) **Routing a TS conclusion**: a well-defined **hotfix → SA→Dev**; a larger/**full-cycle fix → BA** to open a formal requirement.
- (c) **New handshake point**: TS conclusion → **TL routing decision** (added to the Handshake Rules table).
- (d) **Routing-decision record**: on routing, TL **appends a one-line routing-decision record** to the TS conclusion doc (chosen path: hotfix→SA/Dev vs full-cycle→BA, with target branch/requirement), so the trail is single-sourced on the investigation doc (FR-21d, Q5).

TL keeps its existing `tools` (`Read, Write, ...`) — appending a line to the conclusion doc uses `Write`/`Edit` already available to TL; no tool change needed. No change to the retrospective or existing build-cycle handshakes.

### Key decisions
- **TS follows the worker-agent file shape** (BA/SA/QA), including `Tech Stack Context`, for roster consistency — not the leaner TL/RM shape.
- **`Edit` is deliberately excluded** from TS tools as the *structural* enforcement of diagnostic-only; the prose `## What You Must NOT Do` is the documented backstop. Both are required (NFR).
- **Single stage-agnostic filename** `AGENT_RCA_CONCLUSION_<slug>.md` for new conclusions; the historical `EP_PRODUCTION_RCA_CONCLUSION_*` file is left untouched as the style reference (Q1).
- No new frontmatter keys beyond `name`/`description`/`tools` (NFR).

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `.claude/agents/troubleshooter.md` | create | The new TS agent definition (FR-1…FR-20) |
| `CLAUDE.md` (Agent Team table) | modify | Add the Troubleshooter (TS) row — initials TS, triggered by User or TL (FR-22) |
| `.claude/agents/team-leader.md` | modify | Teach TL to recognize a TS trigger, route a TS conclusion (hotfix→SA/Dev vs full-cycle→BA), add the new handshake point, and append a one-line routing-decision record to the TS conclusion doc (FR-21) |

**Read-only (referenced, not modified):** the three RCA skills, the three dump scripts, `EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md`, the two RCA runbooks, CLAUDE.md V6 Work Protocol. No code, prompt, plugin, DSL, migration, or test file is touched.

---

## Task List

- [ ] **Step 1:** Confirm branch is `agent-failure-troubleshooting` (done — `git branch --show-current`); record in this header. Do NOT create or switch branches (user/TL-approved deviation).
- [ ] **Step 2:** Re-read the five existing agent files' structural skeleton (frontmatter keys, heading style, section order) to lock the exact convention TS must mirror.
- [ ] **Step 3:** Author `.claude/agents/troubleshooter.md` frontmatter — `name: troubleshooter`, the `description`, `tools: Read, Bash, Write, Glob` (verify NO `Edit`).
- [ ] **Step 4:** Write `# Role: Troubleshooter (TS)` + role statement + `## Tech Stack Context` block.
- [ ] **Step 5:** Write `## Input Contract` (FR-7/FR-11/FR-12) — identifiers accepted; ask-for-identifier rule; suspect_value tracing.
- [ ] **Step 6:** Write `## Lifecycle Stages & Worked Paths` — four worked paths, each with identifier type + dump script(s) + RCA skill (FR-4, FR-8/9/10, AC-4).
- [ ] **Step 7:** Write `## The Three-Skill Handoff Chain` — earliest-stage rule + the two concrete hand-offs (FR-5, AC-5).
- [ ] **Step 8:** Write `## Root-Cause Layer Classification` — the fixed five-value set (FR-6).
- [ ] **Step 9:** Write `## Evidence Integrity` — persisted-evidence-only, no re-run-to-diagnose, no write path (FR-13/FR-14).
- [ ] **Step 10:** Write `## Conclusion Document (Deliverable)` — `AGENT_RCA_CONCLUSION_<slug>.md`, EP-style header, the 8 fields, one-consolidated-doc rule, honest-failure distinction (FR-16/17/19, AC-7).
- [ ] **Step 11:** Write `## V6 Defects — Propose, Do Not Write` (FR-18, AC-8).
- [ ] **Step 12:** Write `## Handoff — Agent Recommends, TL Routes` (FR-20, AC-9).
- [ ] **Step 13:** Write `## Communication Rules` and `## What You Must NOT Do` (FR-13/15/18/20, AC-3).
- [ ] **Step 14:** Modify `CLAUDE.md` — add the Troubleshooter (TS) row to the Agent Team table (FR-22, AC-10).
- [ ] **Step 15:** Modify `.claude/agents/team-leader.md` — add TS trigger recognition, routing (hotfix→SA/Dev vs full-cycle→BA), new handshake row, and the append-routing-record rule (FR-21, AC-11).
- [ ] **Step 16:** Self-check: map every FR (1-22) and AC (1-12) to a location in the three files; verify AC-1 (no `Edit`), AC-3 (three NOT-Dos present), AC-7 (all 8 fields), AC-10/11.
- [ ] **Step 17:** Run `git diff --stat` to confirm only the three intended files changed (pre-verifies AC-12); mark Status → Code Complete and notify TL for SA review.

---

## QA Test Scope

- **Mode:** smoke / convention-verification
- **Strategy:** log-analysis / doc-convention check — **no Jest or Playwright** (there is zero runtime code to exercise)
- **Procedure:** none (not a V6 or plugin cycle)
- **Focus:** the **12 acceptance criteria (AC-1…AC-12)** — verified by reading the three changed files and checking convention fidelity against the five existing agent files
- **Skip:** unit, integration, e2e (no code paths exist to test)

**AC-12 verification method:** verified as a **`git diff` assertion**, not a live dry-run. QA confirms the diff for this cycle touches **only** the agent-definition + Markdown files (`.claude/agents/troubleshooter.md`, `CLAUDE.md`, `.claude/agents/team-leader.md`, and workplan/requirement docs) — **no** edits to any code / prompt / plugin-definition / DSL / schema / migration file. The user confirmed: **convention + git-diff only, no live dry-run.**

**Per-AC check map QA can follow:**
| AC | How QA verifies |
|---|---|
| AC-1 | Frontmatter has `name: troubleshooter`, a `description`, `tools: Read, Bash, Write, Glob`; `tools` has **no** `Edit`. |
| AC-2 | Required sections present (`# Role:` w/ TS, Tech Stack Context, procedure sections, `## Communication Rules`, `## What You Must NOT Do`). |
| AC-3 | `## What You Must NOT Do` states: never edit code, never trigger BA/SA/Dev, never write WEAK_POINTS/OPEN_ITEMS (only propose). |
| AC-4 | Four lifecycle worked paths, each naming identifier type + dump script(s) + RCA skill. |
| AC-5 | Three-skill handoff chain documented + earliest-stage rule. |
| AC-6 | Input contract: identifiers + optional symptom; ask-for-identifier when symptom-only. |
| AC-7 | Conclusion contract: `docs/investigations/`, EP style, all 8 fields present. |
| AC-8 | V6-defect: proposes WEAK_POINTS/OPEN_ITEMS text, only proposes. |
| AC-9 | "Agent recommends, TL routes" handoff present. |
| AC-10 | `CLAUDE.md` Agent Team table has TS row (User or TL). |
| AC-11 | `team-leader.md` has TS trigger + routing + handshake. |
| AC-12 | `git diff` shows only agent-def + Markdown files changed. |

---

## SA Review Notes

**Reviewed by SA — 2026-07-05**
**Status:** ✅ Approved (with 2 conditions to address during implementation — see comments 5 and 6; neither requires a re-plan cycle)

### Comments

1. **Requirement coverage — full.** I mapped all 22 FRs and 12 ACs against the Implementation Approach and Task List. Every FR has a corresponding authoring step (FR-1→Step3/4, FR-2/3→Step3, FR-4→Step6, FR-5→Step7, FR-6→Step8, FR-7/11/12→Step5, FR-8/9/10→Step6, FR-13/14→Step9, FR-15→Step13, FR-16/17/19→Step10, FR-18→Step11, FR-20→Step12, FR-21→Step15, FR-22→Step14) and the AC self-check is Step16 with a per-AC QA map. No orphaned FR/AC. — [SA: resolved]

2. **Operated-skill and script references — verified against reality.** All three RCA skills exist (`.claude/skills/agent-creation-rca`, `.claude/skills/calibration-rca`, `.claude/skills/v6-pipeline`); all three dump scripts exist (`scripts/dump-agent-thread.ts`, `scripts/dump-agent.ts`, `scripts/dump-calibration.ts`); the EP style reference `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` exists. The four lifecycle→skill mappings in the Lifecycle Stages section are correct. The `AGENT_RCA_CONCLUSION_<slug>.md` filename does not collide with the existing `AGENT_CREATION_RCA_CONCLUSION_sheets-range.md`. — [SA: resolved]

3. **Convention model — narrow it to SA/QA, not "BA/SA/QA".** FR-1 requires the new file to carry `## Tech Stack Context` + `## Communication Rules` + `## What You Must NOT Do`. Of the existing files, only `system-architect.md` and `quality-assurance.md` carry all three; `business-analyst.md` has Tech Stack Context but **no** `## Communication Rules` heading (its equivalent is "When Other Agents Ask Questions"), and Dev/RM/TL are leaner still. Recommend Dev mirror `system-architect.md` / `quality-assurance.md` specifically as the structural template so the required section set is guaranteed. Frontmatter should use the `description: |` block-scalar style (as BA/SA/QA/TL do). — [SA: pending]

4. **`tools: Read, Bash, Write, Glob` (no `Edit`) — correct and sound.** Excluding `Edit` is the right structural enforcement of the diagnostic-only boundary. `Write` scoped to the single conclusion doc + `Bash` scoped to read-only dump scripts is internally consistent with FR-3/FR-13/FR-14 and the NFR "Diagnostic-only safety." Approved. — [SA: resolved]

5. **CONDITION — team-leader.md tool claim is inaccurate; fix wording and reconcile self-consistency (FR-21d).** Workplan line 108 states the routing-record append "uses `Write`/`Edit` already available to TL." TL's actual `tools` are `Read, Write, TodoRead, TodoWrite` — **TL has `Write` but not `Edit`.** The append must therefore be done via `Write` (rewrite the doc with the appended line); "no tool change needed" is correct, but drop the `Edit` reference. Additionally, `team-leader.md`'s own `## What You Must NOT Do` currently says "Never modify files directly" — the new TS-routing subsection must not contradict that. TL already writes docs (retrospectives), so the clean framing is that appending the routing-decision record to the conclusion doc is a documentation write of the same class; make that explicit so the edited file is not self-contradictory. — [SA: pending]

6. **CONDITION — specify how the runtime path resolves an execution ID → owning agent (FR-10 / FR-4d).** All three dump scripts take `<agent_id>`; none accepts an execution ID directly. Worked path (d) says TS "resolves the owning agent and runs the appropriate dump script(s)" but does not say *how*. To keep the runtime path actionable rather than aspirational, the `troubleshooter.md` path (d) should state the resolution mechanism (e.g. TS reads the persisted execution row to obtain the owning `agent_id`, then runs `dump-agent.ts`/`dump-calibration.ts` against it). This is a one-sentence addition to the worked path — not a re-plan. — [SA: pending]

7. **CLAUDE.md edit — non-destructive and correctly scoped.** Adding exactly one Agent Team table row (`Troubleshooter | TS | User or TL`) satisfies FR-22/AC-10. Placement after the RM row is fine. I confirm the deliberate decision to leave the "Standard flow" line unchanged: TS is an out-of-band diagnostic entry point and its routing lives in `team-leader.md`, so the build-cycle diagram should not be altered. Approved. — [SA: resolved]

8. **Branch handling — approved as an explicit deviation, not a defect.** The plan correctly stays on `agent-failure-troubleshooting`, creates/switches no branch (Step1), and Step17 asserts via `git diff --stat` that only the three intended files (plus the workplan/requirement docs) change. This is the user/TL-approved continuation; I am not flagging the departure from the `feature/*` convention. — [SA: resolved]

9. **AC-12 re-framing — acceptable.** AC-12 is behavioural (a live TS run producing a conclusion + a clean git diff). Since there is zero runtime code in this cycle, verifying it as a git-diff assertion over the three changed files (per the user's "convention + git-diff only, no live dry-run" decision) is the correct adaptation. The behavioural guarantee is instead carried structurally by the no-`Edit` tool set (comment 4). — [SA: resolved]

### Adjusted items (marked by SA)
- **Step 4 / Key decisions:** use `system-architect.md` or `quality-assurance.md` (not "BA/SA/QA" generically) as the structural template, since only those two carry the full required section set (per comment 3).
- **Step 15:** when editing `team-leader.md`, (a) describe the routing-record append as a `Write`-based documentation write — do not reference `Edit`; and (b) ensure the new TS-routing subsection is consistent with TL's existing "Never modify files directly" NOT-Do (per comment 5).
- **Step 6:** add the execution-ID→agent-ID resolution sentence to worked path (d) (per comment 6).

### Approval
[x] **Workplan approved — proceed to implementation.** Conditions in comments 5 and 6 (and the template narrowing in comment 3) are to be handled inline during authoring; they do not require another workplan-review cycle. Address all three, then proceed to code review as normal.

---

**Code Review by SA — 2026-07-05**
**Status:** ✅ Code Approved

Scope note: this is a docs/agent-definition feature with **zero runtime code** — no TypeScript, Zod, RLS, Pino, or `console.*` surface applies. The review is content correctness, convention fidelity, requirement satisfaction, and non-destructive edits. The three feature files were reviewed: `.claude/agents/troubleshooter.md` (new), `CLAUDE.md` (1 row), `.claude/agents/team-leader.md` (routing subsection + 2 handshake rows + NOT-Do reconciliation).

### Both Phase 1 conditions — verified resolved

- **Condition (comment 5) — TL routing-record append via `Write`, reconciled with "Never modify files directly."** ✅ `team-leader.md` § (d) states the append "uses your `Write` tool to rewrite the conclusion doc" — no `Edit` reference. The NOT-Do line was expanded to carve out "the documentation you own via `Write` (retrospectives, workplan commit notes, and the one-line routing-decision record…)" and § (d) explicitly frames it as "a **documentation write** of the same class as writing the retrospective" and "the **only** exception to 'Never modify files directly.'" No self-contradiction remains. TL's actual tools (`Read, Write, TodoRead, TodoWrite`) support this — `Write` is present, `Edit` is not needed. Correct.
- **Condition (comment 6) — execution-ID → owning-agent resolution in path (d).** ✅ `troubleshooter.md:92-100` now states TS "**First resolve the execution ID to its owning agent:** read the persisted `agent_executions` record for that execution ID — the row carries its owning `agent_id` — and use that `agent_id` to run the appropriate dump script(s)." The path is now actionable, consistent with the three dump scripts all taking `<agent_id>` (verified), and `agent_executions` is a real table (CLAUDE.md Key Tables). Correct.

### Code Review Comments

1. **`troubleshooter.md` frontmatter — fully correct.** `name: troubleshooter`, a valid multi-line `description: |` (states user/TL trigger on reported failure, strictly diagnostic, produces a root-cause conclusion with a named fix-owner — recommends, does not fix), and `tools: Read, Bash, Write, Glob` with **no `Edit`**. AC-1/FR-1/FR-2/FR-3 satisfied; the no-`Edit` structural guarantee of the diagnostic-only boundary holds. — Priority: n/a (pass)
2. **Structural fidelity to `system-architect.md`/`quality-assurance.md` — matched.** All required sections present: `# Role: Troubleshooter (TS)`, `## Tech Stack Context` (byte-identical block to SA/QA), procedure sections (Input Contract, Lifecycle Stages & Worked Paths, Three-Skill Handoff Chain, Root-Cause Layer Classification, Evidence Integrity, Conclusion Document, V6 Defects, Handoff), `## Communication Rules`, `## What You Must NOT Do`. Comment-3 template narrowing (mirror SA/QA, not "BA/SA/QA") was honoured. AC-2 satisfied. — Priority: n/a (pass)
3. **Accuracy — the four lifecycle→skill mappings, script names/args, 5-layer set, and deliverable name are all correct and internally consistent.** Verified against the filesystem: skills `agent-creation-rca` / `v6-pipeline` / `calibration-rca` all exist; scripts `dump-agent-thread.ts <agent_id> [suspect_value]`, `dump-agent.ts <agent_id>`, `dump-calibration.ts <agent_id>` match the file's usages exactly (incl. the `suspect_value` trace and the calibration RCA HINT). Root-cause layer set is exactly the five required values. Deliverable `AGENT_RCA_CONCLUSION_<slug>.md` does not collide with the existing `AGENT_CREATION_RCA_CONCLUSION_sheets-range.md`, and the `EP_PRODUCTION_RCA_CONCLUSION_*` style reference exists. AC-4/5/6/7 and FR-6/16/17 satisfied. — Priority: n/a (pass)
4. **All 8 conclusion fields present + honest-failure distinction + V6 propose-only.** The Conclusion Document section enumerates all eight fields (symptom, evidence, earliest failing step + cascade, classified layer, defensible root cause with exact references, named fix-owner, suggested solutions, hotfix-vs-full-cycle path), the one-consolidated-doc rule, and the honest-failure distinction (FR-19). "V6 Defects — Propose, Do Not Write" correctly bounds TS to *proposing* WEAK_POINTS/OPEN_ITEMS text inside the conclusion only (FR-18/AC-8). NOT-Do covers never-edit-code, never-trigger-BA/SA/Dev, never-write-backlog-files, fix-always-by-Dev-after-SA-review (FR-13/15/20, AC-3/9). — Priority: n/a (pass)
5. **`CLAUDE.md` edit is non-destructive.** Exactly one row added (`| Troubleshooter | TS | User or TL |`) after the RM row; the "Standard flow" line correctly left unchanged (TS is out-of-band). No other CLAUDE.md changes. AC-10/FR-22 satisfied. — Priority: n/a (pass)
6. **`team-leader.md` edit is non-destructive and complete.** Two handshake rows added, a `## Troubleshooter (TS) Routing` subsection with (a) trigger recognition, (b) hotfix→SA/Dev vs full-cycle→BA routing table, (c) new handshake point, (d) the routing-record append rule; the sole line-level change beyond additions is the intended NOT-Do reconciliation. AC-11/FR-21 satisfied. — Priority: n/a (pass)
7. **Calibration-session-ID → agent-ID resolution is left implicit** — `dump-calibration.ts` takes `<agent_id>` only, and path (c) accepts a "calibration session ID **or** agent ID" but (unlike path (d), which was fixed by condition 6) does not state how a bare session ID resolves to an `agent_id`. This is the symmetric gap to the one condition 6 closed. It does not block — the calibration-rca skill covers the mechanics and the common input is an agent ID — but a one-clause addition to path (c) (e.g. "resolve the session's `agent_id` from its calibration-session row, then run `dump-calibration.ts <agent_id>`") would make the path fully self-contained. — Priority: Low
8. **Commit hygiene for RM (process note, not a file defect).** The branch working tree carries **unrelated** in-progress changes not part of this feature — `.claude/settings*.json`, `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`, `app/v2/agents/new/page.tsx`, and `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` (the latter's diff **predates** this cycle; the file remains untouched *by this feature*, so the "retained untouched as style reference" claim holds for the TS work). RM must stage **only** the three TS feature files (+ requirement/workplan docs) at commit and not sweep in the unrelated working-tree changes. AC-12 (git-diff assertion) holds for the TS feature's own contribution. — Priority: Low (process)

### Optimisation Suggestions
- Optional: add the one-clause calibration-session-ID resolution to path (c) for symmetry with path (d) (comment 7). Non-blocking polish.
- Optional: path (b) could note that if the persisted `intent_contract` is absent on older agents (pre-WP-55), TS should say so in the evidence section rather than treat absence as a defect. Minor.

### Code Approved for QA: **Yes**
Both Phase 1 conditions are resolved, all 22 FRs and 12 ACs are met by file content (AC-12 adapted to a git-diff assertion per the user's decision), convention fidelity to SA/QA is exact, and the two edits are non-destructive. Comments 7 and 8 are Low and do not block QA. Proceed to QA (smoke / convention-verification per the workplan's QA Test Scope).

## QA Testing Report

**QA — 2026-07-05**
**Test mode:** smoke / convention-verification
**Strategy used:** E (doc-convention + git-diff assertion) — this is a docs/agent-definition feature with **zero runtime code**; there is nothing to exercise via Jest or Playwright. Per the user's decision: convention + git-diff only, **no live dry-run**. Verified by reading the three changed files, cross-checking convention fidelity against `system-architect.md` / `quality-assurance.md`, cross-checking accuracy against the three RCA skills and three dump scripts, and running `git status --short` / `git diff --stat`.
**Focus:** all (the 12 acceptance criteria)
**Skipped:** unit, integration, e2e (no code paths exist to test) — as scoped in the QA Test Scope block.
**Input source:** prompt keywords + workplan QA Test Scope (aligned)

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| **AC-1** Frontmatter: `name: troubleshooter`, a `description`, `tools: Read, Bash, Write, Glob`, **no `Edit`** | ✅ | Pass | `troubleshooter.md:2` `name: troubleshooter`; `:3-10` multi-line `description: |` (states user/TL trigger on reported failure, strictly diagnostic, produces root-cause conclusion with named fix-owner, recommends-not-fixes); `:11` `tools: Read, Bash, Write, Glob` — **`Edit` literally absent**. Hard diagnostic-only guarantee holds. |
| **AC-2** Required sections present (`# Role:` w/ TS, Tech Stack Context, procedure sections, Communication Rules, What You Must NOT Do) | ✅ | Pass | `# Role: Troubleshooter (TS)` (`:14`), `## Tech Stack Context` (`:22`, byte-identical to SA/QA), procedure sections (Input Contract, Lifecycle Stages & Worked Paths, Three-Skill Handoff Chain, Root-Cause Layer Classification, Evidence Integrity, Conclusion Document, V6 Defects, Handoff), `## Communication Rules` (`:230`), `## What You Must NOT Do` (`:241`). |
| **AC-3** NOT-Do states: never edit code, never trigger BA/SA/Dev, never write WEAK_POINTS/OPEN_ITEMS (only propose) | ✅ | Pass | `:243` never edit code/prompts/plugin defs/DSL/schemas (+ "no `Edit`"); `:246-247` never implement fix (Dev after SA review); `:248` never trigger BA/SA/Dev, never open branch/workplan/req; `:250` never write WEAK_POINTS/OPEN_ITEMS, only propose. |
| **AC-4** Four lifecycle worked paths, each naming identifier type + dump script(s) + RCA skill; paths (c)/(d) include session/execution→owning-agent resolution | ✅ | Pass | Table `:64-69` + worked paths `:71-103`. (a) creation→`agent-creation-rca`, agent ID, `dump-agent-thread.ts`+`dump-agent.ts`. (b) V6→`v6-pipeline`, agent ID, `dump-agent.ts`. (c) calibration→`calibration-rca`, session ID or agent ID, `dump-calibration.ts`+`dump-agent.ts` — **session→agent resolution present** (`:86-88`: read `calibration_sessions` row for owning `agent_id`, SA comment-7 polish applied). (d) runtime→execution ID, **execution→agent resolution present** (`:96-98`: read `agent_executions` row for owning `agent_id`, SA fix comment-6). |
| **AC-5** Three-skill handoff chain + earliest-stage rule | ✅ | Pass | `:107-131`: creation→V6→calibration chain diagram, explicit "follow the chain to the *earliest* failing stage, not the loudest symptom", both concrete hand-offs (EP-origin→`agent-creation-rca`; EP-correct-DSL-wrong→`v6-pipeline`), one-consolidated-doc rule. Cross-checked against skill files: mappings match `agent-creation-rca` (upstream), `v6-pipeline` (middle), `calibration-rca` (downstream). |
| **AC-6** Input contract: identifiers + optional symptom; ask-for-identifier when symptom-only | ✅ | Pass | `:35-54`: identifier table (agent ID / execution ID / calibration session ID) + optional symptom; `:46-48` "No identifier → ask, don't guess" (never guess, never live-reproduce); `:49-52` suspect_value derivation for `dump-agent-thread.ts`. |
| **AC-7** Conclusion contract: `docs/investigations/`, EP style, all 8 fields | ✅ | Pass | `:168-190`: `AGENT_RCA_CONCLUSION_<slug>.md` under `docs/investigations/`, EP_PRODUCTION_RCA_CONCLUSION_* style, header block. All 8 fields enumerated: symptom, evidence, earliest step+cascade, classified layer, defensible root cause (exact refs), named fix-owner, suggested solution(s), hotfix-vs-full-cycle. Plus one-consolidated-doc rule (`:192-195`) and honest-failure distinction (`:197-201`, FR-19). |
| **AC-8** V6-defect: proposes WEAK_POINTS/OPEN_ITEMS text, only proposes | ✅ | Pass | `:205-213`: propose entry text per V6 Work Protocol *inside the conclusion doc only*; explicit "must not write to …WEAK_POINTS.md or V6_OPEN_ITEMS.md yourself — TL/Dev own the backlog write." |
| **AC-9** "Agent recommends, TL routes" handoff | ✅ | Pass | `:217-226`: recommends remediation path, must not trigger BA/SA/Dev, must not open branch/workplan/requirement; TL routes (hotfix→SA→Dev / full-cycle→BA). |
| **AC-10** CLAUDE.md Agent Team table has TS row (User or TL) | ✅ | Pass | `git diff CLAUDE.md`: exactly one row added `| Troubleshooter | TS | User or TL |` after RM. "Standard flow" line correctly unchanged (TS is out-of-band). Single-line diff. |
| **AC-11** team-leader.md: TS trigger + routing + handshake (+ routing-record rule) | ✅ | Pass | `git diff .claude/agents/team-leader.md`: 2 Handshake-Rules rows added (report-failure→trigger TS; TS conclusion→routing decision), `## Troubleshooter (TS) Routing` subsection with (a) trigger recognition, (b) hotfix→SA/Dev vs full-cycle→BA routing table, (c) new handshake point, (d) append-one-line-routing-record via `Write`; NOT-Do "Never modify files directly" reconciled to carve out TL-owned documentation writes. Non-contradictory (SA comment-5 resolved). |
| **AC-12** git-diff assertion: only the 3 intended files changed by the feature; no code/prompt/plugin/DSL modified | ✅ | Pass | See Test Outputs. Feature's own contribution = `.claude/agents/troubleshooter.md` (new, `??`), `CLAUDE.md` (M, +1), `.claude/agents/team-leader.md` (M, +47) + its own requirement/workplan docs (`??`). No code/prompt/plugin/DSL/schema/migration file modified by this feature. |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None (not applicable — no runtime code).

#### Edge Cases (nice to fix)
1. **Calibration-session-ID resolution symmetry (SA comment-7)** — Already addressed: path (c) now states the `calibration_sessions`→`agent_id` resolution (`troubleshooter.md:86-88`), symmetric with path (d). No action needed; noted for the record.
2. **Older-agent `intent_contract` absence (SA optimisation note)** — Optional polish: path (b) does not explicitly say to report a missing persisted `intent_contract` (pre-WP-55 agents) as an evidence gap rather than a defect. Non-blocking; the Evidence Integrity section's "persisted evidence only" framing covers the spirit.

### Test Outputs / Logs

`git status --short` (feature files vs. unrelated pre-existing working-tree changes):
```
# --- TS FEATURE (this cycle) ---
?? .claude/agents/troubleshooter.md          # NEW agent definition (untracked → not in diff --stat)
 M CLAUDE.md                                  # +1 Agent Team row
 M .claude/agents/team-leader.md              # +47 routing subsection + handshakes
?? docs/requirements/TROUBLESHOOTER_AGENT_REQUIREMENT.md   # BA requirement (this cycle)
?? docs/workplans/TROUBLESHOOTER_AGENT_WORKPLAN.md         # this workplan

# --- UNRELATED pre-existing (NOT this cycle — do NOT commit with TS feature) ---
 M .claude/settings.json
 M .claude/settings.local.json
 M app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt
 M app/v2/agents/new/page.tsx
 M docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md   # diff predates this cycle; untouched BY the feature (style ref intact)
?? app/api/plugins/google-token/
?? lib/client/GoogleDrivePicker.tsx
?? docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md
?? docs/requirements/GOOGLE_SHEETS_GID_RESOLUTION_REQUIREMENT.md
?? docs/workplans/EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md
?? docs/workplans/GOOGLE_SHEETS_GID_RESOLUTION_WORKPLAN.md
```

`git diff --stat` (tracked modifications only; `troubleshooter.md` is untracked so not shown here — expected):
```
 .claude/agents/team-leader.md   | 47 +++++-      <- TS feature
 CLAUDE.md                       |  1 +           <- TS feature
 .claude/settings.json           |  8 +-          <- unrelated
 .claude/settings.local.json     | 34 ++++-       <- unrelated
 .../Workflow-Agent-Creation-Prompt-v16-chatgpt.txt | 8 +-   <- unrelated
 app/v2/agents/new/page.tsx      | 163 +++++++++++++++++---   <- unrelated
 .../EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md | 11 +-    <- unrelated (predates cycle)
```

**AC-12 verdict:** The TS feature's own contribution touches **exactly** its 3 intended files (`.claude/agents/troubleshooter.md`, `CLAUDE.md`, `.claude/agents/team-leader.md`) plus its own requirement + workplan docs. **No code / prompt / plugin-definition / DSL / schema / migration file is modified by this feature.** The remaining working-tree changes are pre-existing and unrelated (present at cycle start) — explicitly distinguished above, not feature defects. **RM must stage only the 3 TS feature files + the requirement/workplan docs** and must not sweep in the unrelated changes.

**Accuracy cross-checks (passed):**
- Skills `agent-creation-rca`, `calibration-rca`, `v6-pipeline` all exist; the three-skill chain and the four lifecycle→skill mappings in `troubleshooter.md` match the skills' own self-descriptions (upstream/middle/downstream, DIAGNOSTIC-ONLY, EP-origin handoff).
- Scripts `dump-agent-thread.ts <agent_id> [suspect_value]`, `dump-agent.ts <agent_id>`, `dump-calibration.ts <agent_id>` all exist and their args match the file's usages exactly (incl. suspect_value trace + calibration RCA HINT).
- The 5-layer set (`input/data · V6 generation · runtime/external API · calibration-detection · creation chat flow`) is exactly the required fixed set (FR-6).
- `AGENT_RCA_CONCLUSION_<slug>.md` does not collide with existing investigation docs; `EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` retained untouched as style ref.

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

All 12 acceptance criteria pass. No High/Medium/Low bugs. Two optional non-blocking polish notes only. **Ready for commit** (RM: stage only the 3 TS feature files + requirement/workplan docs).

## Commit Info
_(RM will populate)_
