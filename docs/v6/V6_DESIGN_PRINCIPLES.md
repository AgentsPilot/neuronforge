# V6 Design Principles — Lessons from 38 Weak Points

> **Last Updated:** 2026-05-15
> **Purpose:** Prescriptive design rules synthesized from the WP-1..38 catalog. Read this BEFORE writing new code in `lib/agentkit/v6/`, `lib/pilot/`, or `scripts/test-dsl-execution-simulator/`. Every rule has 2-4 affected WPs as evidence — if you find yourself arguing against a rule, read those WPs first.

## How to use this doc

1. **Before adding code** that touches runtime guards, IR converters, validators, or test infrastructure — skim the relevant section.
2. **Before reviewing a PR** that adds new transform primitives or runtime checks — use the [Decision Checklist](#decision-checklist).
3. **Before declaring a bug "edge case" and deferring it** — check if it matches an anti-pattern below. Edge cases that recur 5 times across different surfaces are not edge cases.

This doc is **distilled from concrete failures** — it doesn't add new architecture; it codifies what we've already learned. The authoritative per-issue analysis lives in [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md).

---

## Section 1: Core Principles

### Principle 1 — Runtime tolerance > strict guards

**Rule:** When the LLM emits a syntactically valid form that's slightly off the strict runtime contract, **normalize at runtime; don't throw.**

**Why:** The runtime contract is narrower than the LLM's emission space. The LLM commonly drifts to "looks reasonable" forms (template strings, bare ref names, alternative casings) that production code rejects. Each strict throw becomes a Phase E failure that's invisible until live data is involved.

**Evidence — 5 WPs are all variants of this single bug:**
- [WP-22](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `set_difference.reference` emitted as bare RefName, runtime needed `{{varname}}`
- [WP-30](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `case 'config'` resolveVariable called with bare path
- [WP-32](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): validator over-corrected valid per-item-nested flatten field
- [WP-33](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `with_fields.expression` as template-string, runtime needed structured AST
- [WP-37](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `transformWithFields` rejected `expression: undefined` (post-resolveAllVariables mangling)

**How to apply:**
- Inside any `transform/*` runtime function, treat shape validation as a **normalization pass first, throw-only-on-unrecoverable last**.
- When you write `if (!field.X) throw`, ask: "What if the LLM emits X in a slightly-off-but-meaningful form? Can I normalize?"
- Pair every runtime tolerance with an IR converter normalization (so phase4 stores the canonical shape going forward) — but don't rely on the converter alone.

**Anti-rule:** Never weaken the runtime contract to accept *meaningless* input. If the field truly cannot be made meaningful (e.g., missing `name` on a `with_fields` field — there's nothing to attach the result to), throw. The rule is "be lenient about *form*, strict about *meaning*."

---

### Principle 2 — Fail loud on empty/broken input; never substitute defaults

**Rule:** When extraction, parsing, or any data-producing step fails, **propagate the failure visibly** — never silently substitute placeholder values like `"Unknown <Field>"` or empty strings. Downstream consumers (especially AI generators and email senders) cannot distinguish fabricated defaults from real data.

**Why:** Defaults that look like real data get rendered into emails, written to Sheets, and sent to suppliers. Every "Unknown Vendor" that reached a user was the system substituting a value the user thought was extracted from their PDF.

**Evidence:**
- [WP-13](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): AI step fabricated two-row table with fake package numbers when search returned 0 emails
- [WP-34](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `DeterministicExtractor` swallows PDF-parse exceptions; plugin substitutes `"Unknown <Field>"` for missing required fields → fabricated content sent to suppliers in po-monitor scenario

**How to apply:**
- For required fields that fail extraction: return `null` (forcing downstream code to handle it explicitly), throw a typed error, or set a distinct sentinel like `__EXTRACTION_FAILED__` that downstream conditionals can branch on.
- Never use a human-readable placeholder ("Unknown", "N/A", "TBD") — these look like real data when rendered.
- For AI steps with empty input: the WP-13 guard (deterministic no-data payload + "respond exactly 'No data available.'" prompt) is the canonical pattern. Apply it universally to AI steps that receive arrays.
- For empty filter results that feed scatter-gather: `on_empty: "throw"` is correct behavior — don't weaken it. If you have a legitimate empty-scatter case, declare it explicitly (`on_empty: "skip"`).

**Anti-rule:** Don't conflate "prevent downstream crash" with "fabricate plausible content." Crash-prevention should make the failure visible, not hide it.

---

### Principle 3 — Validators must catch up to the runtime, not vice versa

**Rule:** When the runtime accepts a more permissive form than a validator (Phase A simulator, Phase D pre-execution check, or the StructuralRepairEngine), **fix the validator** — never weaken the runtime.

**Why:** The runtime is what users depend on. A validator that's stricter than the runtime causes false-positive failures that block real workflows from running. A runtime that's stricter than the validator causes real-data crashes that mocks don't catch.

**Evidence:**
- [WP-32](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): StructuralRepairEngine's flatten-field validator rejected and rewrote a per-item-nested pattern the runtime accepts correctly. Fix: extend the validator to match runtime semantics.
- [WP-35](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase A simulator didn't understand `field[N]` array-index syntax that the runtime handles fine. Fix: extend the simulator's path resolver.

**How to apply:**
- When a Phase A or Phase D check raises an error, FIRST verify whether the runtime actually has the problem. If it doesn't, the validator is wrong.
- Validators should mirror the runtime's path-resolution, expression-evaluation, and field-lookup semantics — sharing helpers where practical.
- "False-positive Phase A failures" are bugs in the validator, not in the workflow.

**Anti-rule:** Don't add validator strictness for "defense in depth" without also tightening the runtime. Defense-in-depth that disagrees with the runtime is just disagreement.

---

### Principle 4 — Wide grammar requires wide tolerance (compile-time or runtime)

**Rule:** If the IR converter / compiler accepts multiple emission shapes for the same semantic intent (e.g., template-string OR structured AST for `with_fields.expression`), **every emission shape must work end-to-end** — either via compile-time normalization to a canonical form, or via runtime tolerance.

**Why:** The LLM doesn't reliably pick one shape over another. If the converter accepts shape A but the runtime only handles shape B, every shape-A emission becomes a Phase E failure.

**Evidence — the "convention-mismatch family":**
- [WP-22](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): IR converter emitted bare RefName, runtime required `{{}}` template
- [WP-30](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `case 'config'` runtime called resolveVariable with bare path; required `{{}}`
- [WP-33](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): IR converter passed string `expression` through unchanged; runtime required structured AST
- [WP-37](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `resolveAllVariables` pre-substituted unresolvable templates to undefined; runtime `transformWithFields` rejected undefined

**How to apply:**
- Before adding a new emission shape to the grammar, audit every consumer (IR converter, validators, runtime executors) to verify they all handle it.
- Prefer **converter normalization** as the structural fix (phase4 stores the canonical shape), **plus** runtime tolerance as defense for legacy/cached phase4 files.
- Don't say "the LLM should emit form X" — the LLM will drift. Engineer for the drift.

**Anti-rule:** Don't add new shapes "for flexibility" without tracking which surfaces handle them. Every new shape is N new normalization paths.

---

### Principle 5 — Test infrastructure must match runtime semantics

**Rule:** Phase A (DSL simulator), Phase D (mocked execution), and Phase E (live execution) must share **the same path-resolution, expression-evaluation, and shape-handling code** wherever possible. If they diverge, they will eventually disagree silently.

**Why:** Divergence between Phase A/D and Phase E hides bugs in Phase E (failure surfaces only with real data) AND causes false positives in Phase A/D (failures that block valid workflows). Both directions waste developer time.

**Evidence:**
- [WP-35](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase A simulator's `VariableStore._lookupRef` didn't understand `field[N]` syntax that runtime's `ExecutionContext.resolveVariable` handles correctly. Same syntax, two implementations, divergent.
- [WP-36](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase D stub generator produced `mock_name_001` that fails keyword filters real data passes.
- [WP-14 reopened](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase D passed because mocks were tiny; Phase E hit 1M-token limit on real PDF content. The original fix's `isExtractLike` guard wasn't tested with realistic payloads.

**How to apply:**
- When you write a new resolver / evaluator / validator helper in the runtime, look for the simulator's equivalent and either share the code or mirror the logic exactly.
- Phase D mocks should produce realistic shapes — not just type-correct stubs. A name field that never matches any keyword filter is type-correct but semantically useless for testing.
- When debugging a "Phase D passes but Phase E fails" or vice versa, the answer is almost always "test infrastructure doesn't match runtime."

**Anti-rule:** Don't dismiss "Phase A false positive on a real ref" or "Phase D mock that doesn't match real data" as test-infrastructure tweaks — they signal real divergence.

---

### Principle 6 — No hardcoded plugin-specific behavior anywhere

**Rule:** The IR converter, compiler, runtime, validators, and prompts must never contain logic specific to a single plugin. Use schemas as the source of truth.

**Why:** AgentPilot serves any plugin combination. Hardcoded rules for "Gmail," "Sheets," "Drive" break the moment a user uses a new plugin or a plugin's API changes. They also accumulate as the plugin set grows — every new plugin requires N new hardcodes.

**Evidence:** Codified in `CLAUDE.md` Platform Design Principles (the only V6-relevant principle that pre-existed this doc). Reinforced by:
- The W2/WP-16 work explicitly chose `transform/with_fields` grammar instead of "Gmail-specific normalizer"
- The `inferFlattenField` priority lists in StructuralRepairEngine include heuristic names but no plugin-specific code

**How to apply:**
- If you find yourself writing `if (plugin === 'gmail') ...` or `if (action === 'search_emails') ...` — stop. Use `output_dependencies`, `x-variable-mapping`, or the action schema's `output_schema` instead.
- Plugin schemas are the contract. Read them; don't hardcode their values.
- Acceptable: shared heuristic priority lists (e.g., common field names like `'emails'`, `'attachments'`) that work across plugins. Not acceptable: branches keyed on plugin identity.

**Anti-rule:** Don't push "this is just one quick exception" into a generic component. The exception becomes load-bearing within weeks.

---

### Principle 7 — Fix at root cause, not at the failing layer

**Rule:** When a bug surfaces at layer N (e.g., a runtime crash), the fix usually belongs at an earlier layer (IR converter, Phase 1 prompt, plugin definition). Only fix at layer N if the bug is genuinely an N-layer concern.

**Why:** Layer-N fixes accumulate as "patches" that mask deeper issues. The same root cause then resurfaces in another layer-N variant.

**Evidence:**
- [WP-11/12](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Fixed in IR converter (root cause) not in runtime patches.
- [WP-33](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Two-layer fix — runtime tolerance (for legacy phase4) AND IR converter normalization (for new emissions). The IR converter fix is the root cause; the runtime tolerance is defense-in-depth.
- CLAUDE.md Platform Design Principles §2: "Fix issues at the root cause" — codifies this.

**How to apply:**
- When a bug surfaces, identify the **earliest** layer that could have prevented it. Fix there.
- A runtime fix without a corresponding compile-time fix means the same bug returns the next time the same emission shape reappears.
- For LLM-emission-shape bugs: fix the Phase 1 prompt OR the IR converter normalization. The runtime tolerance is the defense net, not the cure.

**Anti-rule:** Don't accept "fix in the runtime is faster" as a justification. Cumulative runtime patches become unmaintainable.

---

### Principle 8 — Phase D mocks must exercise the workflow's actual semantics, not just shapes

**Rule:** Phase D stub data must produce values that exercise filter conditions, comparisons, and AI-classification logic in the workflow under test. Type-correct-but-generic mocks silently bypass the very logic the workflow is testing.

**Why:** A Phase D run where every filter returns 0 or 100% of items isn't testing the filter — it's testing the runtime's empty-input path. The workflow's actual logic is untested until Phase E hits real data.

**Evidence:**
- [WP-36](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase D `mock_name_NNN` failed all keyword filters → scatter-gather aborted on the bogus empty result, not on a real workflow issue
- [PD-1](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) (open): Realistic plugin mock payloads — flagged as a top-priority gap
- [WP-14 reopened](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Phase D mocks ~20 bytes/field; real PDF content ~165KB/doc. Token-bloat invisible at Phase D.

**How to apply:**
- The `DOCUMENT_NAME_BANK` pattern in `stub-data-generator.ts` (WP-36 fix) is the model: cycle through values that collectively cover common filter keywords for the domain.
- Stub size should match real-data size for fields that flow into AI steps or scatter merges (PDFs, email bodies, document text). Tiny stubs hide token-bloat bugs.
- When adding a new scenario, audit its filters and ensure the mock generator produces matching values for at least some items.

**Anti-rule:** Don't say "Phase D failed because of mock data" as if it's the user's problem. It's the test infrastructure's problem.

---

### Principle 9 — Beware self-referential side effects in real-data workflows

**Rule:** Workflows that emit outputs to systems they also read from (e.g., Gmail confirmation emails landing in the inbox the workflow searches) create silent feedback loops that "pass" Phase E without testing the workflow's actual logic.

**Why:** Phase E success means "the pipeline ran end-to-end without crashing" — not "the workflow produced meaningful results." Self-referential workflows reliably "succeed" with empty data because their input is their own past empty output.

**Evidence:**
- [WP-38](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): `orders-po-extractor-xlsx` and `po-monitor-supplier-confirmation` both filter `subject:Orders newer_than:7d` AND send a confirmation email with "Orders" in the subject. Phase E processed the prior confirmation email as if it were a real order. Cascade succeeded; meaningful logic never ran.

**How to apply:**
- For any Gmail-search workflow that sends a confirmation back to the same inbox: query MUST include `-from:me` or a similarly specific exclusion.
- For Sheets / Drive workflows that write to a sheet/folder they also read from: the read query must filter by a field that the write doesn't populate (e.g., a `processed_at` column).
- Phase 1 prompt should steer the LLM toward queries that exclude self-output by default for inbox/folder-monitor patterns.
- After a "successful" Phase E with suspiciously empty data, inspect the actual input — did the agent read its own output?

**Anti-rule:** Don't trust `phase_e_success: true` alone. Always inspect what data flowed through if the output looks empty.

---

### Principle 10 — Documentation drift is a real failure mode

**Rule:** Stale design docs actively mislead future work. When a design is rebased or replaced, **archive the old doc explicitly** and add a redirect link from the new doc. Don't leave both lying around.

**Why:** During the WP-32..37 work, multiple agent sessions (including LLM-based ones) repeatedly read `V6_COMPREHENSIVE_RULE_SYSTEM.md` (Dec 2025, describing 6 priority-dispatched rule classes that no longer exist) and tried to apply its lessons to the current IntentContract-based architecture. Each lookup wasted time and risked introducing the wrong solution.

**Evidence:**
- The 2026-05-15 docs cleanup archived 14 stale docs because they described pre-rebase architectures or were point-in-time work-session reports masquerading as design references.
- See `V6_DOCS_INDEX.md` for the current canonical reading order.

**How to apply:**
- When you make a design change that supersedes prior docs, in the same commit: (1) update the new canonical doc, (2) move the obsoleted doc to `v6-archive/`, (3) add a redirect note pointing readers to the new location.
- When writing a new design doc, check `V6_DOCS_INDEX.md` first to see what's current. If you find a stale doc you need to read past, flag it in your PR.
- "Last Updated" dates older than ~3 months on V6 docs should be treated with skepticism by default.

**Anti-rule:** Don't leave "the old design is in V6_X.md, the new design is in V6_X_REBASE.md" without making one of them clearly superseded. Both will be read; both will conflict.

---

### Principle 11 — Defense in depth must not hide failures

**Rule:** Defense-in-depth checks (auto-repair, autoFix, fallback values, "smart defaults") are useful only if they make failures **more visible**, not less. A defense layer that silently produces plausible output is a fabrication, not a defense.

**Why:** Several auto-repair systems we shipped (StructuralRepairEngine in WP-32, document-extractor's "Unknown <Field>" defaults in WP-34) made workflows "succeed" while producing wrong data. Users couldn't tell the system had failed.

**Evidence:**
- [WP-32](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): StructuralRepairEngine's autoFix rewrote a valid LLM emission to an invalid one and persisted the rewrite to the DB. Phase E "succeeded" with empty results.
- [WP-34](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): Extractor's `createFailureResult` returns success=false but the plugin layer overrides this by setting `"Unknown <Field>"` for missing required fields, surfacing as "successful" output downstream.

**How to apply:**
- Auto-repair should warn loudly (logs at info+ level) and ideally surface in the user-visible execution result.
- Fallback defaults should be sentinels (`__MISSING__`, null, throwing typed errors) — never human-readable placeholders.
- The success/failure signal on each layer must propagate unmodified. A layer that sets `success: false` should not have its result silently overwritten by a downstream layer's default-substitution.
- When adding a new defense-in-depth check: ask "if this check fires, will the user know?" If not, redesign.

**Anti-rule:** Don't add defense-in-depth that's designed to "not crash." Crashes are signals. Designed-to-not-crash code is designed to hide signals.

---

### Principle 12 — Per-scenario regression snapshots are the canonical "what works"

**Rule:** The `tests/v6-regression/scenarios/*/` directories — with their `scenario.json` Phase A/D/E status fields and committed `phase4-pilot-dsl-steps.json` snapshots — are the canonical record of which workflows currently work. Documentation about coverage that doesn't reference these snapshots is unreliable.

**Why:** The doc-based "we support 70-75% of patterns" claim in `V6_WORKFLOW_PATTERN_CATALOG.md` (now archived) was several months out of date when read. The scenario snapshots are git-tracked and update with every Phase E success.

**Evidence:**
- `V6_WORKFLOW_PATTERN_CATALOG.md` archived 2026-05-15 because its coverage claims didn't match reality after WP-29..38.
- Each scenario.json now has `phase_e_success`, `phase_e_success_timestamp`, and `phase_e_caveat` fields documenting the *actual* verification state.

**How to apply:**
- When you want to know "does V6 support workflow shape X?", grep the scenario snapshots — don't trust prose claims.
- When you ship a new feature, add or update at least one scenario that exercises it through Phase E. Update its `scenario.json` with the new timestamp.
- `phase_e_caveat` is for "the pipeline ran but X was untested because Y" cases (see po-monitor's caveat after WP-37). Don't pretend Phase E coverage you didn't actually get.

**Anti-rule:** Don't update a doc claim about coverage without verifying the matching scenario's `phase_e_success_timestamp` is recent.

---

## Section 2: Anti-patterns (if you see this, it's the bug we just fixed)

These are concrete code shapes that triggered prior WPs. If you find code matching one of these patterns, treat it as a probable bug.

### Anti-pattern A: Strict guard on a structured-expression field

```ts
// ❌ DON'T — this rejects valid LLM emissions
if (!field.expression) {
  throw new Error('invalid field declaration');
}
augmented[field.name] = evaluateExpression(field.expression, ...);
```

**Why it's wrong:** `field.expression` can be `undefined` post-resolveAllVariables (WP-37), a template string (WP-33), or a structured AST. The strict guard fires before the runtime tolerance.

**Canonical fix:** Split the guard — `name` missing throws; `expression` missing/undefined produces an undefined value. See `transformWithFields` post-WP-37.

---

### Anti-pattern B: Path resolution that splits-then-literal-lookup

```ts
// ❌ DON'T — this fails on field[N] array-index syntax
const parts = ref.split('.');
let value = stepOutputs.get(parts[0]);
for (let i = 1; i < parts.length; i++) {
  value = value[parts[i]];  // ← literal property lookup of "files[0]"
}
```

**Why it's wrong:** The runtime accepts `{{var.field[N].subfield}}` but `value["files[0]"]` returns undefined (WP-35).

**Canonical fix:** Use `parsePathSegment()` from `variable-store.ts` to parse each segment for optional `<name>[<index>]` syntax. See WP-35 fix.

---

### Anti-pattern C: Human-readable default substitution

```ts
// ❌ DON'T — fabricates content downstream consumers can't distinguish from real data
for (const fieldDef of outputSchema.fields) {
  if (fieldDef.required && extractedData[fieldDef.name] == null) {
    extractedData[fieldDef.name] = `Unknown ${fieldDef.name}`;
  }
}
```

**Why it's wrong:** Downstream AI generators and email senders render "Unknown Vendor" / "Unknown Type" as if real (WP-13, WP-34).

**Canonical fix:** Return `null`, throw a typed error, or use a distinct sentinel (`__EXTRACTION_FAILED__`) that downstream code branches on. Make the failure visible.

---

### Anti-pattern D: Validator that's stricter than runtime

```ts
// ❌ DON'T — false positives on workflows that work in production
const rootArrayFields = Object.keys(schema.properties).filter(/* root only */);
if (!rootArrayFields.includes(field)) {
  // flagged as invalid, autoFix rewrites
}
```

**Why it's wrong:** The runtime supports per-item-nested flatten patterns the validator doesn't (WP-32). The validator's "fix" persists to DB and breaks the workflow.

**Canonical fix:** Mirror the runtime's semantics — check `varMatch[2]` for sub-array navigation BEFORE validating against root-level keys. See WP-32 fix.

---

### Anti-pattern E: Generic stub for a domain-specific field

```ts
// ❌ DON'T — produces values that never match real filter conditions
function generateStringByFieldName(name: string, idx: string): string {
  return `mock_${name}_${idx}`;
}
```

**Why it's wrong:** `mock_name_001` never matches a filter for `["Contract", "MSA", ...]`. Phase D fails on the bogus empty result, not on a real workflow issue (WP-36).

**Canonical fix:** Cycle through a domain-specific bank for fields the LLM commonly filters on. See `DOCUMENT_NAME_BANK` in `stub-data-generator.ts`.

---

### Anti-pattern F: Plugin-specific branch in a generic component

```ts
// ❌ DON'T — breaks when the plugin changes or a new plugin emerges
if (action === 'search_emails') {
  result.extracted_text = '(PDF text extraction not yet implemented)';
}
```

**Why it's wrong:** Codifies plugin-specific behavior in a place that should be schema-driven. The "not yet implemented" stub from WP-34 misled downstream consumers for months.

**Canonical fix:** Read the plugin's `output_dependencies` declaration, or use a schema-driven helper. Never inline plugin-keyed logic into generic infrastructure.

---

### Anti-pattern G: Self-referential Gmail/Sheets query

```ts
// ❌ DON'T — the agent will read its own past outputs
query: "subject:Orders newer_than:7d"
// AND later in the same workflow:
send_email({ subject: "Orders PO Extraction – Processing Complete", ... })
```

**Why it's wrong:** The prior run's confirmation email matches the query (WP-38). Phase E "succeeds" with the confirmation as the only matching email.

**Canonical fix:** Either (a) the query excludes self-sent emails via `-from:me`, or (b) the confirmation email's subject doesn't contain the search keyword.

---

## Section 3: Decision Checklist

Before merging a change that touches any of these areas, answer the matching questions.

### When adding a new runtime guard (`throw new Error(...)`)

1. **Does the LLM ever emit a shape that would fail this guard?** Test with the actual phase4 files of all 10 regression scenarios.
2. **Is there a more permissive form I could normalize to?** Apply Principle 1.
3. **If the guard fires, how does the user know?** Apply Principle 11.
4. **Is the IR converter doing the corresponding normalization?** Pair runtime guards with compile-time normalization.
5. **Is there a unit test that exercises the guard from a real LLM-emission shape?** Not just an artificial test case.

### When adding a new validator check (Phase A / Phase D / StructuralRepair)

1. **Does the runtime actually have this constraint?** Apply Principle 3 — runtime is the source of truth.
2. **Can I share path-resolution / expression-evaluation code with the runtime?** Apply Principle 5.
3. **What does Phase E look like when this check passes?** A check that's always satisfied in Phase D but always fails in Phase E means the check is wrong.
4. **Will the check's auto-fix rewrite phase4 in a way that breaks real workflows?** See WP-32 — autoFix wrote bad data to the DB.

### When adding a new transform primitive or grammar shape

1. **Have I updated the IR converter normalization for all emission variants?** Apply Principle 4.
2. **Does every transform/runtime executor handle every emission variant?** Test with template-string AND structured AST AND post-resolveAllVariables-mangled forms.
3. **Are there scenario snapshots that exercise this primitive end-to-end?** Apply Principle 12.
4. **Does Phase D mock data exercise this primitive's semantics, not just shape?** Apply Principle 8.

### When adding plugin-specific behavior

1. **Stop.** Apply Principle 6.
2. **Can this be driven by `output_dependencies`, `x-variable-mapping`, or `output_schema`?** Use schemas as the contract.
3. **If genuinely plugin-specific:** does it live in the plugin's own definition/executor, not in generic V6 infrastructure?

### When updating documentation

1. **Is there an older doc that this supersedes?** Move it to `v6-archive/` in the same commit. Apply Principle 10.
2. **Does this change affect `V6_DOCS_INDEX.md`'s Tier 1/2 reading order?** Update it.
3. **Does this change conflict with `V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md`?** Reconcile, don't add a new contradictory source.
4. **Did I add a new principle the next agent should follow?** Add it here, not buried in a WP entry.

---

## Section 4: How to extend this doc

This file is **active**. When future WPs surface new patterns:

1. If the pattern fits an existing principle, add the new WP to the "Evidence" list. Don't create duplicate principles.
2. If the pattern is genuinely new, add a new principle (Section 1) with its evidence + how-to-apply + anti-rule structure.
3. If you find a code shape that triggered the bug, add it to Section 2 as a new anti-pattern with a concrete `// ❌ DON'T` example.
4. If a decision-point keeps producing the same bug class, add a checklist item to Section 3.

The goal is keeping this doc short and prescriptive (~250-400 lines). When it exceeds 500 lines, the most-quoted principles should bubble up to `CLAUDE.md` so they apply project-wide.

---

## Related Documentation

- **The descriptive catalog:** [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) — full per-issue analysis for every principle's evidence.
- **The architecture:** [V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md](./V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md) — current design including Direction #1 / #2 / #3.
- **The reading order:** [V6_DOCS_INDEX.md](./V6_DOCS_INDEX.md) — which docs to load first.
- **Project-wide rules:** [/CLAUDE.md](/CLAUDE.md) § Platform Design Principles — the 2 high-level rules ("no hardcoding," "fix at root cause") this doc operationalizes.
