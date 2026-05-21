# V6 Docs Index

> **Last Updated:** 2026-05-15
> **Purpose:** Reading order for getting up to speed on the V6 semantic agent generation pipeline. Open this file FIRST when starting a fresh session.

## Overview

V6 is the current AgentPilot semantic agent generation pipeline — converts natural-language prompts into runnable workflows via a 5-phase pipeline (Plan, Grounding, Ambiguity, Formalization, Compilation). This index orders the documentation by relevance so you can reach productive context quickly without reading every file.

> **For broader project context, see [CLAUDE.md](/CLAUDE.md) at the repo root first.** It covers the V6 design principles (no hardcoding, fix at root cause) plus tech stack, repository structure, security rules, and code patterns.

---

## Tier 1 — Read FIRST (canonical, ~10 docs)

These get you to the same understanding the previous session reached. Read in order.

| # | Doc | Purpose |
|---|---|---|
| 1 | [V6_OVERVIEW.md](./V6_OVERVIEW.md) | High-level introduction to the 5-phase pipeline. Entry point. |
| 2 | [V6_DESIGN_PRINCIPLES.md](./V6_DESIGN_PRINCIPLES.md) | **Prescriptive design rules synthesized from 38 WPs.** 12 principles + 7 anti-patterns + decision checklist. Read this BEFORE writing new V6 code — it documents the mistakes we've already made so you don't repeat them. |
| 3 | [V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md](./V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md) | **The canonical current design doc** (April 2026, 100KB). Supersedes earlier V6_WORKFLOW_DATA_SCHEMA_DESIGN.md (archived). Covers the IntentContract → IR Converter → ExecutionGraphCompiler pipeline + three implementation directions. |
| 4 | [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) | **The active catalog of pipeline weak points (WP-1 .. WP-38+)**. Most-updated doc. Every fix, deferred item, and design observation lives here. Skim the summary table and Change History first, then dive into specific WPs as needed. The descriptive companion to V6_DESIGN_PRINCIPLES.md. |
| 5 | [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) | Active workplan for IntentContract grammar, binder, IR converter, and compiler work. Tasks 0.4–0.12 still pending (W2 primitives, grammar extensions). Referenced by WP-15..18. |
| 6 | [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md) | Active workplan for the execution simulator (Phase A/B/D/E test strategy). Defines how regression scenarios are verified end-to-end. |
| 7 | [V6_ARCHITECTURE.md](./V6_ARCHITECTURE.md) | Deep dive into all 5 phases, data flow, and error handling. Use as a reference after #1-6 give you the high-level shape. |
| 8 | [V6_WP16_INVENTORY.md](./V6_WP16_INVENTORY.md) | Inventory of deterministic ops misrouted to AI (WP-16). Feeds the grammar extension work in WORKPLAN_INTENT_CONTRACT task 0.8. |
| 9 | [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md) | **Active QA testing manual** — step-by-step procedure for validating any new scenario through Phase 1 → Phase A → Phase D → Phase E. Use this every time you add a regression scenario. |
| 10 | [V6_OPEN_ITEMS.md](./V6_OPEN_ITEMS.md) | **Consolidated backlog of everything deferred / partial / future.** Open WPs (sorted by priority), open Workplan tasks, untested scenario logic, doc-maintenance debt. The "what's next" doc — start here when picking up new work. |

After Tier 1 you should have:
- The pipeline shape (5 phases, IntentContract → IR → DSL → execution)
- The current state of weak points and what's been fixed vs deferred
- The active workplan structure (where new work plugs in)

---

## Tier 2 — Reference (read on demand, ~9 docs)

Open these when working on a specific area — no need to read upfront.

| Doc | Open when working on |
|---|---|
| [V6_API_REFERENCE.md](./V6_API_REFERENCE.md) | API routes / endpoints for V6 phases. |
| [V6_DEVELOPER_GUIDE.md](./V6_DEVELOPER_GUIDE.md) | Integration, extension, debugging, testing patterns. |
| [V6_TEST_DECLARATIVE.md](./V6_TEST_DECLARATIVE.md) | Test page UI (`/test-plugins-v2` and related) for running the pipeline end-to-end. |
| [V6_AGENT_CREATION_INTEGRATION_PLAN.md](./V6_AGENT_CREATION_INTEGRATION_PLAN.md) | V6 integration with the V2 agent-creation flow + review UI + feature flags. |
| [V6_SCHEMA_BASED_GROUNDING.md](./V6_SCHEMA_BASED_GROUNDING.md) | Phase 2 (Grounding) architecture — schema-only approach, no real data fetch during agent creation. |
| [V6_PRODUCTION_METADATA_INJECTION.md](./V6_PRODUCTION_METADATA_INJECTION.md) | How V6 dynamically injects plugin metadata at each phase. |
| [V6_STRICT_SCHEMA_QUICK_REFERENCE.md](./V6_STRICT_SCHEMA_QUICK_REFERENCE.md) | OpenAI strict-mode schema rules — relevant for Phase 1 prompt engineering. |
| [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md) | **Enhanced-Prompt Key Hints design** — the `{plugin}__{capability}__{param}` prefix convention for `resolved_user_inputs`. Live mechanism (Phases 1-4 ✅, Phase 5 E2E testing ⬜). Read when touching `buildVocabularyInjection()`, `toActionSummaryContext()`, the v14 thread template, or Phase 1 LLM behavior. |
| [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md) | **Regression test infrastructure design** — scenario folder layout, `scenario.json` schema, `run-regression.ts` orchestrator, EP Key Hints pre-flight validation. Read when modifying the regression system (`tests/v6-regression/`, `scripts/test-dsl-execution-simulator/`, `scripts/test-workflowpilot-execution.ts`). |

---

## Tier 3 — Needs UPDATE (open todos, ~3 docs)

Currently stale. Either fix or fold into Tier 1 docs. Listed here so you know to treat them with skepticism if you do open them.

| Doc | What's stale | Suggested fix |
|---|---|---|
| [V6_EXECUTION_GUIDE.md](./V6_EXECUTION_GUIDE.md) | Dated 2025-12-30, describes a **6-phase pipeline (P0-P5)**. Current is 5 phases. | Either correct phase numbering or merge into V6_ARCHITECTURE.md. |
| [V6_PRODUCTION_READINESS_ROADMAP.md](./V6_PRODUCTION_READINESS_ROADMAP.md) | Dated 2025-12-25 with 18-24 week timeline projection. Many phases are now complete (WP-29..38 shipped, RETIRE-1 done, W2/WP-16 primitives in progress). | Status sweep — mark complete/in-progress/deferred. Or retire in favor of WEAK_POINTS as the active tracker. |
| [V6_PLUGIN_INTEGRATION_COMPLETE.md](./V6_PLUGIN_INTEGRATION_COMPLETE.md) | Dated 2025-12-25 declaring V2 plugin integration "complete." Plugin system has evolved since (PluginManagerV2 path-alias work in CP-C, new plugins). | Verify current state vs the doc; either update or archive. |

---

## Archived (`v6-archive/`)

Docs moved to [`v6-archive/`](./v6-archive/) on 2026-05-15 because they either (a) describe pre-rebase architectures that have been replaced, or (b) are point-in-time work-session artifacts that don't help future development.

| Doc | Reason archived |
|---|---|
| `V6_WORKFLOW_DATA_SCHEMA_DESIGN.md` | Superseded by V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md |
| `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md` | All 6 phases complete; superseded by WORKPLAN_EXECUTION + WORKPLAN_INTENT_CONTRACT |
| `V6_SCHEMA_DRIVEN_COMPILER_DESIGN.md` | December 2025 proposal; implementation status unclear, overlaps with current docs |
| `V6_PURE_DECLARATIVE_GAP_ANALYSIS.md` | December 2025 gap analysis; lessons incorporated into current workplans |
| `V6_PURE_DECLARATIVE_TESTING_GUIDE.md` | December 2025 testing guide; merged into ARCHITECTURE/EXECUTION_GUIDE |
| `V6_DSL_VALIDATION_REPORT.md` | Point-in-time QA report on one test case |
| `V6_EXECUTION_QA_REPORT.md` | January 2026 QA report on one scenario |
| `V6_COMPREHENSIVE_RULE_SYSTEM.md` | Describes pre-rebase compiler architecture (6 priority-dispatched rule classes) — replaced by IntentContract → IR Converter → ExecutionGraphCompiler |
| `V6_WORKFLOW_PATTERN_CATALOG.md` | January 2026 pattern catalog with "70-75% coverage" — stale; canonical "what we test" is now `tests/v6-regression/scenarios/` |
| `V6_AI_PROCESSING_TRAINING.md` | A "what we did" report; the actual prompt content lives in `lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md` |
| `V6_DECLARATIVE_ARCHITECTURE.md` | Pre-rebase architecture where loops were inferred from `delivery_rules`. Current architecture uses explicit `kind: "loop"` / `notify` / `extract` in IntentContract. |

If you need historical context on why the system evolved the way it did, the archive is the place to look. For the current state, stay in Tier 1.

---

## Quick reference — regression scenarios

The 10 active regression scenarios are the canonical "what V6 must support":

```
tests/v6-regression/scenarios/
  ├── aliexpress-delivery-tracker/
  ├── complaint-email-logger/
  ├── contract-enddate-summary/
  ├── expense-invoice-email-scanner/
  ├── gantt-urgent-tasks/
  ├── gmail-urgency-flagging/
  ├── leads-email-summary/
  ├── leads-per-salesperson-email/
  ├── orders-po-extractor-xlsx/
  └── po-monitor-supplier-confirmation/
```

Each scenario folder contains:
- `scenario.json` — name, plugins, expected steps, Phase A/D/E status (read the `phase_e_caveat` field for known limitations)
- `intent-contract.json` — Phase 1 LLM output
- `phase2-data-schema.json`, `phase4-pilot-dsl-steps.json`, `phase4-workflow-config.json` — phase snapshots
- `output/` — most recent Phase A/D/E execution logs and reports

These snapshots are committed and verified through Phase E (live execution) for the scenarios listed in [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) Change History. To pick up regression work, run the next scenario through Phase A → D → E and update its `scenario.json` with results.

---

## Open work (snapshot 2026-05-15)

**Canonical source: [V6_OPEN_ITEMS.md](./V6_OPEN_ITEMS.md)** — consolidated backlog with open WPs, workplan tasks, PD-N items, untested scenario logic, and doc-maintenance debt. Snapshot below:

- **P0 open:** WP-15 (grammar gap for AI output slot shape — foundational)
- **P1 open:** WP-14 (reopened, multi-step scatter token bloat), WP-26/27 (Sheets append edge cases), WP-34 (extractor swallows exceptions → "Unknown" fabrication)
- **P2/P3 open:** WP-9, WP-19, WP-38 (self-referential Gmail queries)
- **In progress:** WP-16 (tasks 0.7/0.8/0.10–0.12 done; 0.9 vocabulary injection partial-deferred)
- **Phase D/E roadmap:** PD-1 (realistic mocks — partially addressed by WP-36), PD-3 (token-budget warnings)
- **Untested scenario logic:** orders-po-extractor-xlsx (extraction path), po-monitor-supplier-confirmation (extraction + reply-in-thread + multi-recipient)
- **Retirement gates:** RETIRE-2 (disable AI fallbacks for 5 retire-safe primitives) — deferred pending Q-A4 sequencing

**Highest-leverage next work:** WP-34 (P1, fabrication risk amplified to external recipients in po-monitor's reply-in-thread). See V6_OPEN_ITEMS.md § "Quick triage for next session" for full priority order.
