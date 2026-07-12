# Requirement: Troubleshooter (TS) — Agent-Failure RCA Team Member

> **Last Updated**: 2026-07-05

**Created by:** BA
**Date:** 2026-07-05
**Status:** Draft

## Overview

This requirement defines a **new member of the AI agent team — the Troubleshooter (TS)** — whose sole job is to diagnose *why* an agent failed anywhere across its lifecycle (creation chat flow, V6 DSL generation, calibration, or runtime/external-API execution) and drive that failure to a defensible, layered root cause with a named fix-owner and a recommended remediation path. TS is a **strictly diagnostic** role: it operates the existing DIAGNOSTIC-ONLY RCA skills (`agent-creation-rca`, `v6-pipeline`, `calibration-rca`), runs read-only evidence scripts, and writes a root-cause conclusion under `docs/investigations/` — but it never edits or writes production/application code.

The "feature" here is a **new agent definition file** (`.claude/agents/troubleshooter.md`) plus its **integration into the existing team workflow** (Agent Team table in `CLAUDE.md` and Team Leader orchestration in `.claude/agents/team-leader.md`). TS concludes and *recommends*; the **Team Leader routes** the conclusion onward (hotfix → SA→Dev, or larger fix → BA→full cycle). TS never itself triggers BA/SA/Dev.

---

## Table of Contents

1. [Problem & Motivation](#problem--motivation)
2. [Actors / Personas](#actors--personas)
3. [User Stories](#user-stories)
4. [Functional Requirements](#functional-requirements)
5. [Non-Functional Requirements](#non-functional-requirements)
6. [Acceptance Criteria](#acceptance-criteria)
7. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
8. [Open Questions](#open-questions)
9. [Notes on Integration Points](#notes-on-integration-points)
10. [References](#references)
11. [Change History](#change-history)

---

## Problem & Motivation

The team already owns a mature set of **three DIAGNOSTIC-ONLY RCA skills** that chain together (creation → V6 generation → calibration), each concluding with a root cause + named fix-owner and writing a conclusion under `docs/investigations/` (mirroring `EP_PRODUCTION_RCA_CONCLUSION_*`). Today, however, there is **no agent role that owns running those skills**. When a user reports "agent X failed / calibration failed / the sheet range is wrong," the work of picking the right skill, running the evidence scripts, walking the handoff chain, and producing the conclusion falls to whichever agent is triggered — with no consistent contract, no guaranteed diagnostic-only boundary, and no defined handoff back into the development lifecycle.

The Troubleshooter fills that gap. It is the single, consistent entry point for agent-failure investigation: it selects the correct RCA skill(s) based on where the failure sits, follows the three-skill handoff chain, and produces a standardized conclusion the Team Leader can route. Crucially, it enforces the same **diagnostic-only** boundary the RCA skills already declare — the actual fix is always implemented by Dev after SA review, never by TS.

---

## Actors / Personas

| Actor | Role in this feature |
|-------|----------------------|
| **User** | Reports an agent failure and triggers TS directly (or asks TL to). Supplies an identifier and, optionally, a symptom. |
| **Troubleshooter (TS)** (new) | Diagnoses the failure, runs read-only evidence scripts, operates the RCA skills, writes the conclusion, recommends a remediation path. Does not fix. |
| **Team Leader (TL)** | Reads the TS conclusion and **routes** it: hotfix → SA→Dev; larger/full-cycle → BA to open a formal requirement. May also trigger TS on the user's behalf. |
| **Business Analyst (BA)** | Receives routing when the fix warrants a formal requirement (full cycle). |
| **System Architect (SA) / Developer (Dev)** | Own the actual fix. Dev implements after SA review; Dev/TL own any WEAK_POINTS.md / V6_OPEN_ITEMS.md backlog write. |

---

## User Stories

- As a **user**, I want to hand the Troubleshooter an agent ID (or execution ID, or calibration session ID) and optionally a one-line symptom, so that I get a defensible root cause without having to know which internal RCA skill applies.
- As a **user**, I want the Troubleshooter to tell me *which layer* owns the failure and *what the remediation path is* (quick hotfix vs. full cycle), so that I can decide how much process to spend on it.
- As the **Team Leader**, I want the Troubleshooter to conclude with a clear recommendation and a named fix-owner, so that I can route it to SA→Dev or to BA without re-diagnosing it myself.
- As a **Team Leader**, I want the Troubleshooter to never start fixing or trigger downstream agents itself, so that all fixes still flow through the standard SA→Dev review gate.
- As a **Developer/SA**, I want the Troubleshooter's conclusion to name the exact failing phase/surface and, for V6 defects, to *propose* the WEAK_POINTS.md / V6_OPEN_ITEMS.md entry text, so that I can act on a precise, pre-analyzed starting point.
- As the **platform owner**, I want the Troubleshooter's diagnostic-only boundary encoded in its tool set (no Edit tool), so that the role structurally cannot modify production code.

---

## Functional Requirements

### A. Agent Definition File & Conventions

| # | Requirement |
|---|-------------|
| **FR-1** | A new agent definition file MUST be created at `.claude/agents/troubleshooter.md`, following the same file conventions as the existing agents: YAML frontmatter (`name`, `description`, `tools`), a `# Role:` heading, a Tech Stack Context section, phase/procedure sections, a `## Communication Rules` section, and a `## What You Must NOT Do` section. |
| **FR-2** | The frontmatter `name` MUST be `troubleshooter`. The role heading MUST identify the agent as **Troubleshooter (TS)**. The `description` MUST state that TS is triggered by the user (or TL) when an agent failure is reported, is strictly diagnostic, and produces a root-cause conclusion with a named fix-owner. |
| **FR-3** | The frontmatter `tools` MUST be exactly **`Read, Bash, Write, Glob`** — and MUST NOT include `Edit`. Bash is scoped to running the read-only dump/evidence scripts; Write is scoped to the RCA conclusion document only. This mirrors the DIAGNOSTIC-ONLY contract of the RCA skills. |

### B. Scope — Full Agent Lifecycle

| # | Requirement |
|---|-------------|
| **FR-4** | TS MUST be able to diagnose failures at **any** of the four lifecycle stages and select the correct RCA skill(s) accordingly: (a) **Creation chat flow** → operates the `agent-creation-rca` skill; (b) **V6 DSL generation** → operates the `v6-pipeline` skill; (c) **Calibration** → operates the `calibration-rca` skill; (d) **Runtime execution / external plugin API failure** → diagnoses, then names the plugin/executor (or external config) fix-owner and hands off. |
| **FR-5** | TS MUST follow the **three-skill handoff chain** when the earliest root cause sits upstream of where the symptom appeared. Example: a `calibration-rca` conclusion that proves the value originated in Enhanced-Prompt (EP) production MUST continue into `agent-creation-rca`; a calibration/creation RCA that proves the EP was correct but the compiled DSL is wrong MUST continue into `v6-pipeline`. The conclusion MUST reflect the *earliest* failing stage, not merely the loudest symptom. |
| **FR-6** | TS MUST classify each conclusion into exactly one **root-cause layer** from the fixed set: **input/data** · **V6 generation** · **runtime/external API** · **calibration-detection** · **creation chat flow**. |

### C. Inputs — Any Identifier + Optional Symptom

| # | Requirement |
|---|-------------|
| **FR-7** | TS MUST accept as input any one of: an **agent ID**, an **execution ID**, or a **calibration session ID** — plus an OPTIONAL free-text symptom (e.g. "the sheet range is wrong"). |
| **FR-8** | Given an **agent ID**, TS runs `scripts/dump-agent-thread.ts <agent_id> [suspect_value]` and `scripts/dump-agent.ts <agent_id>` to gather thread iterations, `ai_context`, clarification answers, and the saved agent (pilot_steps, input_schema, EP), and identifies the authoring iteration/phase of a disputed value. |
| **FR-9** | Given a **calibration session ID** (or an agent ID for a calibration failure), TS runs `scripts/dump-calibration.ts <agent_id>` (+ `scripts/dump-agent.ts <agent_id>`) to gather calibration sessions/history/executions, reads the RCA HINT (earliest failing step + cascade), and identifies the earliest failing step. |
| **FR-10** | Given an **execution ID** (runtime failure), TS resolves the owning agent and runs the appropriate dump script(s) to reach the failing step and the raw external-API error/reason. |
| **FR-11** | If TS is given **only a symptom with no identifier**, it MUST ask the user for an identifier (agent ID, execution ID, or calibration session ID) before proceeding — it MUST NOT guess or attempt a live reproduction to obtain one. |
| **FR-12** | When a `suspect_value` can be derived from the optional symptom, TS SHOULD pass it to `scripts/dump-agent-thread.ts` to trace the value's first appearance and name the authoring iteration/phase. |

### D. Behaviour — Strictly Diagnostic

| # | Requirement |
|---|-------------|
| **FR-13** | TS MUST NOT edit or write any production/application code, prompts, plugin definitions, DSL, or schemas. The only file TS writes is its RCA conclusion document under `docs/investigations/`. |
| **FR-14** | TS MUST use only read-only evidence gathering: the dump/evidence scripts (`scripts/dump-agent-thread.ts`, `scripts/dump-agent.ts`, `scripts/dump-calibration.ts`) via Bash, plus Read/Glob. It MUST rely on **persisted** evidence (DB rows, `metadata.iterations[]`, persisted `intent_contract`) and MUST NOT re-generate or re-run an agent to diagnose (non-determinism trap); a live re-run is only ever a means of *testing a fix*, which is out of TS's scope. |
| **FR-15** | The actual fix MUST always be implemented by **Dev after SA review** — never by TS. TS's `## What You Must NOT Do` section MUST state this explicitly. |

### E. Deliverable — Root-Cause Conclusion Document

| # | Requirement |
|---|-------------|
| **FR-16** | For each investigation, TS MUST write **one consolidated** root-cause conclusion document per reported failure under `docs/investigations/`, named with the single stage-agnostic convention **`AGENT_RCA_CONCLUSION_<slug>.md`** (SCREAMING_SNAKE_CASE), following the existing `EP_PRODUCTION_RCA_CONCLUSION_*` document *style* (which is retained untouched as the style reference), and including the standard doc header block (title, `> **Last Updated**`, Overview). When the investigation traverses the three-skill chain across multiple stages, TS MUST still produce a **single** consolidated document — one labelled section per stage traversed, plus a single final "earliest root cause + fix-owner" — not one document per skill. |
| **FR-17** | The conclusion document MUST contain, at minimum, all of the following sections/fields: (1) the **reported symptom**; (2) the **evidence gathered** (which scripts were run and the salient outputs); (3) the **earliest failing step + cascade**; (4) the **classified root-cause layer** (one of the five in FR-6); (5) the **defensible root cause** (the "why," with exact references — prompt lines, plugin-definition JSON, step/field, or external API reason); (6) the **named fix-owner** (which phase/surface/skill owns the fix — e.g. `agent-creation-flow` v16 Phase 3, `v6-pipeline` IR converter, a specific plugin executor); (7) one or more **suggested solutions**; (8) a **recommended remediation path: hotfix vs full cycle**. |
| **FR-18** | When the root cause is a **V6 defect**, the conclusion MUST *additionally* propose the WEAK_POINTS.md / V6_OPEN_ITEMS.md entry text per the CLAUDE.md V6 Work Protocol. TS only **proposes** this text — TS MUST NOT write to WEAK_POINTS.md or V6_OPEN_ITEMS.md itself; TL/Dev own the actual backlog write when the fix lands. |
| **FR-19** | The conclusion MUST distinguish "the agent's workflow failed" from "a diagnostic surface misreported" — i.e. when applicable it MUST state whether calibration itself behaved correctly (honest failure detection) vs. a calibration-detection defect. |

### F. Handoff — "Agent Recommends, TL Routes"

| # | Requirement |
|---|-------------|
| **FR-20** | TS MUST conclude the RCA and **recommend** a remediation path, but MUST NOT itself trigger BA, SA, or Dev, and MUST NOT open a feature/fix branch, workplan, or requirement. |
| **FR-21** | The Team Leader orchestration (`.claude/agents/team-leader.md`) MUST be updated so TL knows: (a) TS can be triggered by the **user (or TL)** when a failure is reported; (b) how to **route a TS conclusion** — a well-defined hotfix goes straight to SA→Dev, while a larger/full-cycle fix goes to BA to open a formal requirement; (c) the new handshake points (TS conclusion → TL routing decision); (d) that upon routing, TL MUST **append a one-line routing-decision record** to the TS conclusion doc (chosen path: hotfix→SA/Dev vs full-cycle→BA, with the target branch/requirement) so the trail is single-sourced on the investigation doc. |
| **FR-22** | The **Agent Team table in `CLAUDE.md`** MUST be updated to add the Troubleshooter (TS) row: initials **TS**, triggered by **User or TL**. |

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Convention consistency** | The new `troubleshooter.md` MUST match the structural conventions of the existing five agent files (frontmatter shape, `# Role:` heading, Tech Stack Context, phase/procedure sections, `## Communication Rules`, `## What You Must NOT Do`). No new frontmatter keys beyond `name`, `description`, `tools`. |
| **Diagnostic-only safety** | The diagnostic-only boundary MUST be enforced structurally (no `Edit` tool in frontmatter) AND documented in prose (`## What You Must NOT Do`). Both are required — the tool restriction is the hard guarantee. |
| **Evidence integrity** | TS MUST prefer persisted DB evidence over live reproduction and MUST NOT mutate any data. The dump scripts are read-only; TS MUST NOT introduce any write path. |
| **Documentation standards** | The conclusion document MUST follow `/docs/` Documentation Standards: SCREAMING_SNAKE_CASE filename for the investigation conclusion, header block with Last-Updated + Overview, tables for structured data, file paths before code blocks, and status indicators where useful. |
| **Single-source-of-truth (V6)** | For V6 defects, TS only *proposes* WEAK_POINTS/OPEN_ITEMS text inside its conclusion; it MUST NOT double-track by writing into those files, preserving the CLAUDE.md single-source-of-truth principle. |
| **No architectural decisions** | Consistent with the BA/agent-team split, TS diagnoses and recommends but does not make architectural decisions or choose the final fix design — that remains with SA/Dev. |

---

## Acceptance Criteria

QA can verify each of the following:

- [ ] **AC-1** `.claude/agents/troubleshooter.md` exists with valid YAML frontmatter: `name: troubleshooter`, a `description`, and `tools: Read, Bash, Write, Glob`. The `tools` list does **NOT** contain `Edit`.
- [ ] **AC-2** The file contains all required sections: a `# Role:` heading identifying **Troubleshooter (TS)**, a Tech Stack Context section, phase/procedure sections describing the RCA flow, a `## Communication Rules` section, and a `## What You Must NOT Do` section.
- [ ] **AC-3** The file's `## What You Must NOT Do` explicitly states that TS never edits/writes production code, never triggers BA/SA/Dev, and never writes to WEAK_POINTS.md / V6_OPEN_ITEMS.md (only proposes their text).
- [ ] **AC-4** The file documents all four lifecycle stages with a worked path each: creation chat flow → `agent-creation-rca`; V6 generation → `v6-pipeline`; calibration → `calibration-rca`; runtime/external-API → diagnose + name plugin/executor fix-owner. Each path names the input identifier type and the dump script(s) it runs.
- [ ] **AC-5** The file documents the three-skill handoff chain (creation → V6 → calibration) and states that TS follows it to the *earliest* failing stage.
- [ ] **AC-6** The file specifies the input contract: accepts agent ID / execution ID / calibration session ID + optional symptom; if given only a symptom with no identifier, TS asks for an identifier.
- [ ] **AC-7** The file specifies the conclusion document contract: written under `docs/investigations/` in `EP_PRODUCTION_RCA_CONCLUSION_*` style, containing all eight required fields (symptom, evidence, earliest failing step + cascade, classified root-cause layer, defensible root cause, named fix-owner, suggested solutions, recommended remediation path hotfix-vs-full-cycle).
- [ ] **AC-8** The file states that, for V6 defects, TS additionally proposes WEAK_POINTS.md / V6_OPEN_ITEMS.md entry text per the V6 Work Protocol — and only proposes it.
- [ ] **AC-9** The file specifies the "agent recommends, TL routes" handoff: TS recommends but does not trigger BA/SA/Dev.
- [ ] **AC-10** `CLAUDE.md` Agent Team table includes a Troubleshooter (TS) row (initials TS, triggered by User or TL).
- [ ] **AC-11** `.claude/agents/team-leader.md` is updated to describe (a) TS trigger by user/TL on reported failure, (b) hotfix → SA→Dev vs. larger → BA routing of a TS conclusion, and (c) the new handshake point(s).
- [ ] **AC-12** (Diagnostic-only, behavioural) A TS run over a real identifier produces a conclusion document under `docs/investigations/` and makes no edits to any code/prompt/plugin/DSL file (verifiable via git diff — only the investigation doc is added/changed).

---

## Out of Scope / Future Roadmap

| # | Item | Note |
|---|------|------|
| 1 | Implementing any fix identified by TS | Always Dev after SA review; TS is diagnostic-only. |
| 2 | Writing to WEAK_POINTS.md / V6_OPEN_ITEMS.md | TS proposes the text; TL/Dev own the backlog write when the fix lands. |
| 3 | Live reproduction / re-running agents to diagnose | TS uses persisted evidence; live re-runs belong to fix-testing (Dev/QA), not TS. |
| 4 | A new UI, API route, or dashboard for triggering TS | TS is an agent definition + workflow integration only. (A future "one-click Troubleshoot" from the Admin Agent Health Dashboard is a possible roadmap item — see that requirement.) |
| 5 | Auto-routing (TS auto-triggering SA/Dev/BA) | Deliberately excluded — TL routes. Revisit only if the manual routing step proves a bottleneck. |
| 6 | New RCA skills or changes to the existing three skills | This requirement operates the existing skills; it does not modify them. |
| 7 | Non-agent failures (infra, build, deployment) | TS scope is the agent lifecycle; general ops incidents are out of scope. |

---

## Open Questions

*All open questions were resolved with the user on 2026-07-05 and folded into the FRs above.*

- [x] **Q1 — RESOLVED** (user, 2026-07-05): Use a **single, stage-agnostic** convention `AGENT_RCA_CONCLUSION_<slug>.md` for new conclusions (the classified root-cause layer lives inside the doc); the historical `EP_PRODUCTION_RCA_CONCLUSION_*` file is retained untouched as the style reference. Encoded in **FR-16**.
- [x] **Q2 — RESOLVED** (user, 2026-07-05): TS is triggerable by **User or TL**, mirroring BA/Dev. Encoded in FR-2/FR-21/FR-22.
- [x] **Q3 — RESOLVED** (user, 2026-07-05): **One consolidated** conclusion per reported failure — a labelled section per stage traversed and a single final "earliest root cause + fix-owner." Encoded in **FR-16**.
- [x] **Q4 — RESOLVED** (user, 2026-07-05): For runtime/external-API failures, TS **always** writes the standard conclusion doc with layer = `runtime/external API` and fix-owner = the named executor/external config. Encoded in FR-4(d)/FR-17.
- [x] **Q5 — RESOLVED** (user, 2026-07-05): On routing, TL **appends a one-line routing-decision record** (hotfix→SA/Dev vs full-cycle→BA, with target branch/requirement) to the TS conclusion doc, single-sourced. Encoded in **FR-21(d)**.

---

## Notes on Integration Points

This is a meta-feature. The concrete integration work is **three files** — one new, two edits to existing files owned by Dev during implementation:

| File | Action | Reason |
|------|--------|--------|
| `.claude/agents/troubleshooter.md` | **Create** | The new Troubleshooter (TS) agent definition (FR-1 – FR-20). |
| `CLAUDE.md` (Agent Team table) | **Modify** | Add the Troubleshooter (TS) row — initials TS, triggered by User or TL (FR-22). |
| `.claude/agents/team-leader.md` (orchestration) | **Modify** | Teach TL to (a) recognize TS trigger on a reported failure, (b) route a TS conclusion (hotfix → SA→Dev; larger → BA), (c) add the new handshake point(s) (FR-21). |

**Referenced (read-only — not modified by this feature):**

| Resource | Relationship |
|----------|--------------|
| `.claude/skills/agent-creation-rca/SKILL.md` | Skill TS operates for creation-chat-flow RCA (diagnostic-only). |
| `.claude/skills/calibration-rca/SKILL.md` | Skill TS operates for calibration RCA (diagnostic-only). |
| `.claude/skills/v6-pipeline/SKILL.md` | Skill TS operates for V6-generation RCA. |
| `.claude/skills/agent-creation-flow/SKILL.md` | Named as a *fix-owner* by TS conclusions (creation-flow layer) — TS does not operate it to change code. |
| `scripts/dump-agent-thread.ts`, `scripts/dump-agent.ts`, `scripts/dump-calibration.ts` | Read-only evidence scripts TS runs via Bash. |
| `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` | Style/format reference for the conclusion document. |
| `docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md`, `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md` | Full-method runbooks the skills point to. |
| `CLAUDE.md` V6 Work Protocol (WEAK_POINTS.md / V6_OPEN_ITEMS.md rules) | Governs the *proposed* V6 backlog-entry text in TS conclusions (FR-18). |

---

## References

- [CLAUDE.md](/CLAUDE.md) — Agent Team table, standard flow, V6 Work Protocol, Documentation Standards
- `.claude/agents/business-analyst.md`, `developer.md`, `system-architect.md`, `quality-assurance.md`, `team-leader.md`, `release-manager.md` — existing agent-file conventions
- `.claude/skills/agent-creation-rca/SKILL.md`, `.claude/skills/calibration-rca/SKILL.md`, `.claude/skills/v6-pipeline/SKILL.md` — the DIAGNOSTIC-ONLY RCA skills TS operates
- `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` — conclusion-document style reference
- `docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md` — related operator-facing failure-visibility feature (possible future "Troubleshoot" entry point)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-05 | Initial draft | BA authored requirement for a new team member, the Troubleshooter (TS): a strictly diagnostic agent that operates the three RCA skills (agent-creation-rca / v6-pipeline / calibration-rca) across the full agent lifecycle, accepts any identifier + optional symptom, runs read-only dump scripts, writes an `EP_PRODUCTION_RCA_CONCLUSION_*`-style conclusion under `docs/investigations/` with a classified root-cause layer + named fix-owner + hotfix-vs-full-cycle recommendation, and hands off via "agent recommends, TL routes." Integration = 3 files (new `troubleshooter.md`, `CLAUDE.md` Agent Team table, `team-leader.md` orchestration). 22 functional requirements, 12 acceptance criteria, 5 open questions logged. |
| 2026-07-05 | Open questions resolved | All 5 open questions resolved with the user and folded into the FRs: single `AGENT_RCA_CONCLUSION_<slug>.md` filename convention (FR-16); one consolidated doc per failure across the skill chain (FR-16); TL appends a one-line routing-decision record to the conclusion doc (FR-21d). Q2/Q4 confirmed already-encoded. Ready for TL/user sign-off → SA workplan review. |
