# V6 Open Items — Consolidated Backlog

> **Last Updated:** 2026-05-20
> **Purpose:** Single source of truth for everything that's deferred, partial, or "future" in V6. Aggregates from `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`, `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md`, the regression `scenario.json` caveats, and session-level observations.

## How to use this doc

- **Picking up new V6 work?** Start here. The recommended next items are flagged ⭐ at the top of each section.
- **Resolving an item?** Move it from this doc to its authoritative source's "Fixed" row (e.g., WEAK_POINTS Change History) and remove the entry here. Don't double-track.
- **Discovering a new open item?** Add it here AND open the authoritative source (new WP entry, new task in WORKPLAN, new scenario caveat).

This doc is **a pointer index** — every entry links to the authoritative source where the full detail lives.

---

## Section 1: Open Weak Points (WPs)

Sourced from [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) summary table where status is ⬜ / 🟡 / ⚠️.

### P0 (blocking-class — affects user-visible correctness)

| WP | One-line summary | Status | Notes |
|---|---|---|---|
| ⭐ [WP-15](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-15-ai-declared-output-slots-lose-item-level-shape) | AI-declared output slots lose item-level shape (grammar gap in `generate.outputs[]` / `extract.fields[]`) | ⬜ Not started | Concrete tasks queued in WORKPLAN_INTENT_CONTRACT 0.4–0.6 + 2.11. Largest open foundational item. |

### P1 (real-user impact, well-scoped fix)

| WP | One-line summary | Status | Notes |
|---|---|---|---|
| ⭐ [WP-44](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-44-v6-formalization-drops-explicit-ep-format-requirements-html-vs-plain-text) | V6 formalization-system-v4.md drops explicit EP format requirements (e.g. `html_body` → `body`, "HTML table" → "plain-text table") | ⬜ Documented | First surfaced 2026-05-17 at Stage 1.2f live Phase E (gantt-urgent-tasks-v2ui). Same Phase 3 prompt-fidelity family as WP-43; bundle as a "Phase 3 prompt-fidelity audit" follow-up. **Two angles:** (A) extend `formalization-system-v4.md` to preserve EP format keywords + plugin-param names; (B) compiler-side rewrite (brittle, not recommended). |
| ⭐ [WP-34](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-34-deterministicextractor-swallows-pdf-parse-exceptions-and-document-extractor-silently-fabricates-unknown-defaults) | `DeterministicExtractor` swallows PDF-parse exceptions → document-extractor fabricates "Unknown" defaults | ⬜ Documented, multi-component | **Highest user-visible risk.** Could send fabricated content to suppliers in po-monitor's reply-in-thread (step10). 5-part fix shape spec'd in the WP body. |
| [WP-14](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-14) (reopened) | Multi-nested-step scatter body token bloat (`isExtractLike` guard missing on multi-step branch in `ParallelExecutor.ts:470`) | ⚠️ Partial fix | Triggers on contract-enddate Phase E (1M tokens). ~30 lines. |
| [WP-26](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-26-o23-doesnt-recognize-project_columnby_index-as-a-positional-consumer) | O23 doesn't recognize `project_column.by_index` as positional consumer | ⬜ Future | User workaround: add header row to sheet. ~15 lines. |
| [WP-27](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-27-sheets-append_rows-shifts-to-non-A-column-when-existing-data-has-empty-cells) | Sheets `append_rows` shifts off column A on sparse data | ⬜ Future | User workaround: add header row. ~5 lines compiler-side normalization. |

### P2 (Phase D / Phase A realism)

| WP | One-line summary | Status | Notes |
|---|---|---|---|
| [WP-19](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-19-ai_processing-on-array-input-bulk-vs-per-item) | `ai_processing` on array input runs as single bulk call instead of scatter-gather | ⬜ Future / latent | Revisit when Phase E observes token bloat or item drop. |

### P3 (lower priority / defer)

| WP | One-line summary | Status | Notes |
|---|---|---|---|
| [WP-9](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-9-phase-ad-mock-gap--llm-output-shape-validation) | Phase A/D mock gap — no LLM output shape validation | ⬜ Deferred | F7, has token cost. |
| [WP-38](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-38-self-referential-gmail-queries-pick-up-the-agents-own-past-confirmation-emails) | Self-referential Gmail queries pick up agent's own past confirmation emails | ⬜ Prompt-level fix deferred | Affects orders-po + po-monitor scenarios. Phase 1 prompt should steer toward `-from:me` exclusions. |

### In progress

| WP | Status | Notes |
|---|---|---|
| [WP-16](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-16-deterministic-data-operations-routed-to-ai-step) | 🟡 In progress | Task 0.7 ✅ done ([V6_WP16_INVENTORY.md](./V6_WP16_INVENTORY.md)). Task 0.8 ✅ done (W2 grammar). Tasks 0.9–0.12 ⬜ pending — see Section 3 below. |

### Cleanup tasks (Pipeline B retirement follow-ups)

Pipeline A migration (P1–P6) completed 2026-05-20. The V2 UI now uses Pipeline A unconditionally; Pipeline B endpoints + library code remain in the repo only as deprecated stubs awaiting deletion. **All 7 Pipeline B route files are tagged with `@deprecated` JSDoc** so future contributors get an IDE strikethrough + tooltip warning before extending them. Full Pipeline B deletion is no longer gated on test page work — all broken Pipeline B test surfaces were retired 2026-05-20 (moved to `archive/` preserving original paths so the work can be recovered via `git mv` if needed; safer than outright deletion):

| Task | Owner | Status | Notes |
|---|---|---|---|
| ~~Migrate `app/test-plugins-v2/page.tsx` off Pipeline B endpoints~~ | — | ✅ Done 2026-05-20 | Aggressive cleanup: removed V6 Review Mode section (imports, state, handlers, render block, button). Remaining tabs (plugin / ai-services / thread-based) unaffected. |
| ~~Retire `public/test-v6-declarative.html`~~ | — | ✅ Archived 2026-05-20 | Moved to `archive/public/test-v6-declarative.html` (git mv). Called broken `/api/v6/compile-declarative` (no longer exists). |
| ~~Retire `public/test-v6.html`~~ | — | ✅ Archived 2026-05-20 | Moved to `archive/public/test-v6.html` (git mv). Called broken `/api/v6/generate-workflow-plan` + `/api/v6/compile-declarative` (no longer exist). |
| ~~Retire orphaned V6 review/preview components~~ | — | ✅ Archived 2026-05-20 | Moved to `archive/components/v6/V6ReviewCustomizeUI.tsx` + `archive/components/v6/V6WorkflowPreview.tsx` (git mv). Last consumer was the now-stripped V6 Review Mode section. `components/v6/` directory is now empty. |
| Delete Pipeline B HTTP endpoints | TBD | ⬜ Open (unblocked) | All 7 routes already tagged with `@deprecated` JSDoc — delete in one sweep: `/api/v6/generate-ir-semantic`, `/api/v6/generate-semantic-grounded`, `/api/v6/generate-semantic-plan`, `/api/v6/generate-ir-fast-path`, `/api/v6/generate-workflow-validated`, `/api/v6/ground-semantic-plan`, `/api/v6/formalize-to-ir`. |
| Delete Pipeline B library code (after endpoints) | TBD | ⬜ Blocked on endpoints | `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`, `IRFormalizer.ts`, `GroundingEngine.ts`, `formalization-system-v4.md`, `semantic-plan-system.md`. Plus retire WP-40 and WP-44 (Pipeline-B-prompt-specific) once library is gone. |
| Decide on `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` flag fate | TBD | ⬜ Open | Currently gates V4 (legacy generator) vs V6. If V4 codepath is to be retired too, this flag + the `/api/generate-agent-v4` endpoint + V4 library code can all go together. Separate decision from Pipeline B retirement. |

---

## Section 2: Phase D Hardening Roadmap (PD-N items)

Sourced from [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) § "Phase D Hardening Roadmap".

| Item | Summary | Status | Related WPs |
|---|---|---|---|
| ⭐ [PD-1](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#pd-1-realistic-plugin-mock-payloads-high-value) | Realistic plugin mock payloads | ⬜ Open (partially addressed by WP-36 doc-name bank) | WP-14 (reopened), WP-36, WP-38 |
| [PD-3](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#pd-3-token-budget-warnings-cheap-defense-in-depth) | Token-budget warnings | ⬜ Open | WP-14 (reopened) |
| [PD-2](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#pd-2-plugin-schema-conformance--defer-already-covered) | Plugin-schema conformance | ⬜ Deferred — already covered | — |

---

## Section 3: Open Workplan Tasks

Sourced from [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md).

### Intent Contract workplan (tasks 0.4–0.12 series)

| Task | Summary | Status |
|---|---|---|
| 0.4 + 0.5 + 0.6 + 2.11 | WP-15 nested NestedFieldSpec grammar + prompt examples + producing-slot rule + builder recursive walk | ✅ Done (2026-05-10) |
| 0.7 | WP-16 inventory ([V6_WP16_INVENTORY.md](./V6_WP16_INVENTORY.md)) | ✅ Done |
| 0.8 | W2 grammar + IR + runtime + 60 unit tests + 14 contains_any tests | ✅ Done |
| ⭐ 0.9 | Vocabulary injection (Phase 1 sees workflow primitives, not just plugin actions) | ⬜ Partial — deferred |
| 0.10 | W3 Phase 1 prompt update | ✅ Done |
| 0.11 | Defensive `reason` field nudge for `generate/internal` | ✅ Done |
| 0.12 | W5 measurement script + baseline | ✅ Done |
| 2.12 + 2.13 + 2.14 + 2.15 | DataSchemaBuilder fixes (WP-17 + WP-18) | ✅ Done |

### Retirement gates

| Retirement | Status |
|---|---|
| RETIRE-1 — auto-repair safety nets (validateAISchemaDepth + WP-15 builder fallback) | ✅ Done (2026-05-10) — switched from warn-and-repair to throw-on-violation |
| ⭐ RETIRE-2 — disable AI fallbacks for 5 retire-safe deterministic primitives (`project_column`, `set_difference`, `filter`, `group`, `dedupe`) | ⬜ Deferred — larger blast radius; needs W5 fingerprint extraction + fresh CP-E measurements |

### Enhanced Prompt Key Hints (EP_KEY_HINTS) workplan

Sourced from [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md). Addresses O8 (config value validation via `{plugin}__{capability}__{param}` prefix convention).

| Phase | Summary | Status |
|---|---|---|
| Phase 1 | V6 vocabulary injection parses prefixed keys + translation/composition/config-key rules | ✅ Done (2026-03-16) |
| Phase 2 | `PluginDefinitionContext.toActionSummaryContext()` + `toActionSummaryText()` | ✅ Done (2026-03-16) |
| Phase 3 | Inject action summary into thread-based process-message route | ✅ Done (2026-03-16) |
| Phase 4 | `Workflow-Agent-Creation-Prompt-v14-chatgpt.txt` (prefix rules + parameter-aware questions) | ✅ Done (2026-03-16) |
| ⭐ Phase 5 | **End-to-end testing (T1-T10)** — full flow from thread-based enhanced prompt through IntentContract generation, including: backward compat (T4), parameter-aware question quality (T10), same-plugin-two-actions disambiguation (T7), multi-plugin coverage (T8) | ⬜ Todo |

### Execution workplan

Sourced from [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md). Items there are tracked alongside the scenario regression sweeps. **Most active items now flow through WEAK_POINTS WPs** — the execution workplan is mostly historical strategy now.

---

## Section 4: Untested Scenario Logic

Sourced from `phase_e_caveat` fields in `tests/v6-regression/scenarios/*/scenario.json`. These are scenarios that passed Phase E structurally but whose unique scenario logic wasn't actually exercised.

| Scenario | Untested logic | Cause | To unblock |
|---|---|---|---|
| [orders-po-extractor-xlsx](../../tests/v6-regression/scenarios/orders-po-extractor-xlsx/scenario.json) | Document-extractor on XLSX, `transform/group` on vendor, per-vendor scatter, XLSX synthesis | step1 returned 0 emails (suspected: agent's OAuth Gmail account ≠ user's browser account; account-scope discrepancy unresolved) | Resolve Gmail account scope, OR send test emails with matching subject + XLSX attachments to the agent's connected inbox |
| [po-monitor-supplier-confirmation](../../tests/v6-regression/scenarios/po-monitor-supplier-confirmation/scenario.json) | document-extractor on PDF attachments, `transform/group`, reply-in-thread (step10), multi-recipient HTML summary (step12-13) | WP-38 self-referential query — only matching email was agent's own prior confirmation with `attachments: []` | Address WP-38 (prompt-level fix or manual query exclusion); use throwaway supplier addresses in test inbox |
| All Sheets scenarios (4) compiled pre-WP-SR | Sheets data-flow validation post-WP-SR | Phase4 outputs were compiled pre-AUDIT-1; would have failed runtime cascade | Re-run Phase E across `complaint-email-logger`, `gantt-urgent-tasks`, `leads-email-summary`, `leads-per-salesperson-email` when those scenarios are touched. (Note: gantt + leads-per-salesperson have been re-verified post-WP-29..31 and WP-SR respectively.) |

---

## Section 5: Cross-cutting follow-ups

Items that don't fit a WP / task / scenario bucket but are worth tracking.

### Test infrastructure debt

| Item | Status |
|---|---|
| 6 pre-existing failing test suites in `lib/agentkit/v6/` (`IRToNaturalLanguageTranslator`, `v4-generator`, `validation`, `v6-end-to-end`, `LogicalIRCompiler`, `EnhancedPromptToIRGenerator`) | ⬜ Open — verified unrelated to WP work (stash test). Should be fixed OR quarantined so future regressions show clearly. |

### Documentation maintenance

| Item | Status |
|---|---|
| [V6_EXECUTION_GUIDE.md](./V6_EXECUTION_GUIDE.md) — phase numbering (P0-P5 → P0-P4); content possibly merge into V6_ARCHITECTURE.md | ⬜ Open (Tier 3 in V6_DOCS_INDEX.md) |
| [V6_PRODUCTION_READINESS_ROADMAP.md](./V6_PRODUCTION_READINESS_ROADMAP.md) — status sweep; many phases now complete | ⬜ Open (Tier 3 in V6_DOCS_INDEX.md) |
| [V6_PLUGIN_INTEGRATION_COMPLETE.md](./V6_PLUGIN_INTEGRATION_COMPLETE.md) — verify still accurate vs current PluginManagerV2 | ⬜ Open (Tier 3 in V6_DOCS_INDEX.md) |

### Architectural observations (no specific task; record for future planning)

- **Convention-mismatch family pattern.** WP-22 / WP-30 / WP-32 / WP-33 / WP-37 are all variants of "runtime pre-processing destroys valid LLM intent." [V6_DESIGN_PRINCIPLES.md Principle 1](./V6_DESIGN_PRINCIPLES.md#principle-1--runtime-tolerance--strict-guards) codifies the rule. Long-term: audit all `transform/*` runtime guards for "throws on shape mismatch" vs "tolerates and continues" behavior. ⬜ Open.
- **Phase E realism beyond mocks.** PD-1 addresses Phase D mock realism; Phase E has its own realism issues (WP-38 self-referential queries, untested scenario logic in Section 4). No standalone PE-N tracker yet — items live in WP entries and scenario caveats.

---

## Quick triage for next session

When picking up new work, in priority order:

1. **WP-34** (P1, high user-visible risk — fabrication amplified to external recipients in po-monitor) — multi-component but well-scoped per the WP body
2. **WP-14 reopened** (P1, partial fix exists — extend `isExtractLike` to multi-step branch) — ~30 lines
3. **WP-26 + WP-27** (P1 Sheets append edge cases — both have user workarounds, concrete fix shapes documented) — ~20 lines combined
4. **WP-15** (P0 grammar gap — foundational; required for RETIRE-2 readiness) — larger; requires grammar + prompt + builder changes
5. **PD-1** (Phase D realism — partial credit already from WP-36; finish for full coverage)
6. **WP-38** (P3 prompt-level fix — small effort, unblocks orders-po + po-monitor extraction testing)
7. **EP_KEY_HINTS Phase 5** (E2E testing of the `plugin__capability__` prefix mechanism — T1-T10 test cases spec'd; mechanism live but never validated end-to-end)

After any of these land:

- Update the relevant WP entry to ✅ Fixed with commit ref
- Move the entry out of this doc (don't double-track)
- Update the V6_DOCS_INDEX.md "Open work" snapshot accordingly

---

## How to extend this doc

This file aggregates state from multiple sources. When you discover a new open item:

1. Determine the **authoritative source** (new WP in WEAK_POINTS / new task in WORKPLAN_INTENT_CONTRACT / new scenario caveat / new PD-N).
2. Write the full detail in the authoritative source.
3. **Add a one-line entry here** pointing to the authoritative source.

The goal is to keep this doc **short and scannable** (< 250 lines) — if it grows past that, items have stopped being closed at the same rate they're being added.

---

## Related Documentation

- [V6_DOCS_INDEX.md](./V6_DOCS_INDEX.md) — Doc reading order; "Open work" snapshot section provides the same info in shorter form.
- [V6_DESIGN_PRINCIPLES.md](./V6_DESIGN_PRINCIPLES.md) — Prescriptive rules; if a new open item violates a principle, flag it.
- [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) — Authoritative source for WPs.
- [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) — Authoritative source for grammar / IR converter / compiler tasks.
- [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md) — Step-by-step QA manual used per regression scenario.
