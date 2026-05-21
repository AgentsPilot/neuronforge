# Investigation: `new Function()` Eval Usage in the Pilot Runtime

> **Last Updated**: 2026-05-12
> **Status**: 🔍 INVESTIGATION ONLY — no code changes
> **Author**: Dev agent

## Summary

There are **three** `new Function()` call sites in the Pilot runtime. Two of them are unconditionally reached every time a workflow uses the legacy `expression` map operation; one is a deeply-nested last-resort fallback inside variable resolution. All three are reachable from LLM-emitted DSL strings, so all three are real injection / unpredictability vectors. None of them is gated by a feature flag.

**Recommendation:** Ship Phase A (safer structured-replace coverage + telemetry) immediately, defer Phase B (sandbox or remove `expression`) until telemetry confirms the real-world usage rate. Do NOT remove `new Function()` blindly — the current compiler actively emits `expression` via `map_expression`, so removing eval would break workflows in production.

---

## The three call sites

### Site #1 — `StepExecutor.transformMap`, line **2871**

```ts
return data.map(row => {
  const evalFn = new Function('item', `return ${resolvedExpression}`);
  return evalFn(row);
});
```

**Reached when:** `config.expression` is a string AND the heuristic at lines 2846–2858 detects a "per-item literal" (e.g. `{ "Date": item[0], "Name": item[1] }` or `[item.date, item.amount]`).

**Triggering DSL pattern:** any `transform` step with `operation: 'map'` and `config.expression` set to a per-item literal — typically emitted when the LLM writes things like:
```
"expression": "[item.date, item.type, item.amount]"
```

---

### Site #2 — `StepExecutor.transformMap`, line **2877**

```ts
const evalFn = new Function('item', `return ${resolvedExpression}`);
const result = evalFn(data);
```

**Reached when:** Same `transform` map step, but the expression operates on the **whole array** (`item` is the array, not a row). Triggered when none of the per-item literal heuristics match.

**Triggering DSL pattern:** `transform` map with full-array expressions like:
```
"expression": "item.map(row => row[0])"
"expression": "item.filter(x => x.status === 'open')"
"expression": "item.reduce((sum, n) => sum + n, 0)"
```

The LLM is taught (in `formalization-system-v4.md`) that `map_expression` is **optional** — the default `map` example uses no expression. So this path is reached only when the LLM judges that the safer structured modes aren't enough.

---

### Site #3 — `ExecutionContext.resolveLiteralWithVariables`, line **561**

```ts
try {
  const result = JSON.parse(resolvedExpression);   // ← first attempt: safe
  return result;
} catch (jsonError) {
  try {
    const result = new Function(`return ${resolvedExpression}`)();   // ← last resort: eval
    return result;
  } catch (evalError) { … throw … }
}
```

**Reached when:**
1. A template string contains `{{...}}` AND is not a simple `{{var}}` wrapper (e.g. `"[\"{{email.id}}\"]"`).
2. After variable substitution, `JSON.parse` fails (so it's not a JSON-shaped result).
3. The catch fires `new Function()` as a last-resort interpretation.

**Triggering pattern:** LLM-emitted literals that look like JS but aren't valid JSON. Examples:
- `"({{step1.data}} || []).includes(x)"` — JS expression with operators
- `"item.map(x => x.id)"` — JS arrow function inside a template

This site is **rarer** than #1/#2 because JSON.parse handles most LLM-emitted literals correctly. But it's still reachable, with the same eval risk.

---

## Threat model

The arguments to `new Function()` are constructed from:

1. **LLM-generated DSL fields** (`config.expression`, `map_expression`, template strings) — these flow through the V6 compiler unchanged (`ExecutionGraphCompiler.ts:660–662`).
2. **Resolved variable values** substituted into the expression — these come from:
   - User input values (`input.X` references) — **untrusted**
   - Upstream plugin outputs (Gmail body, Slack message text, Sheet cell contents) — **untrusted**

Risk vectors:

| Source | Reaches eval? | Notes |
|---|---|---|
| LLM emits malicious code | Yes | The LLM doesn't have an adversarial motive, but it can hallucinate JS that does I/O or accesses globals. |
| Plugin output contains JS-meaningful chars | Yes | Backticks, `${}`, `eval(`, `new Function`, etc. in a Gmail body or Sheet cell get JSON-stringified by `transformMap.ts:2702` before substitution, which mitigates most simple injection — but the JSON-stringified value is then embedded in a JS expression, so any double-encoded payload bypasses. |
| User-supplied input flows into a template | Yes | Same as above — JSON.stringify mitigates most cases. |

**Severity:** Medium. The mitigations exist (JSON.stringify on substitution) but are not airtight. The bigger concern is **predictability** — eval'd expressions silently fail in surprising ways (operator precedence quirks, undefined globals, scope issues). The `safeEvaluate` AST evaluator in `ConditionalEvaluator` (lines 296–516) demonstrates that a sandboxed alternative is feasible.

---

## Existing safer paths inside `transformMap`

Already implemented (no LLM-text-to-JS-eval involved):

| Mode | Trigger | Effect |
|---|---|---|
| `field_mapping` | `config.field_mapping = { sender: "from", ... }` | Renames fields per a static dict |
| `column_index` | `config.column_index = 4` | Extracts row[4] from each row |
| `field_path` | `config.field_path = "nested.id"` | Dot-path extraction |
| `field` | `config.field = "email"` | Top-level field extraction |
| `custom_code` + `output_schema` | LLM-emitted code description + target schema | Auto-maps input fields to output fields with known aliases |

The formalization prompt (`formalization-system-v4.md:773–775`) teaches the LLM that `map_expression` is **optional**:

```
| `map` | Transform each item | array | (optional `map_expression`) | `{"type": "map", "input": "{{items}}"}` |
```

So in well-formed IR, most map steps should not need `expression` at all. The eval path is reached when:
- The LLM emits a JS expression directly (legacy/cargo-cult prompts), OR
- The compiler couldn't derive a structured config from `custom_code` (see `deriveMapStructuredConfig`, line 668 of ExecutionGraphCompiler) and falls back to emitting the raw text.

---

## Recommended phased plan (no code changes here)

### Phase A — Telemetry & Coverage (ship first)

1. **Add per-mode telemetry to `transformMap`.** Each branch currently logs its own info line (lines 2560, 2579, 2597, 2613, 2639, plus the missing one for `expression`). Add `logger.info({ stepId, mode: 'expression', expressionPreview: resolvedExpression.slice(0, 200) }, '[transformMap] Using JS expression evaluation')` right before each `new Function()` call. After two weeks of production logs, we have a real count: "X out of Y map steps used the eval path."

2. **Add the same telemetry to `resolveLiteralWithVariables`** at site #3. One info log per eval fallback, with a preview of the expression.

3. **Audit the compiler's `deriveMapStructuredConfig`** (ExecutionGraphCompiler.ts:668). For each warning at line 676 (`[O24] Map step ... has unresolvable custom_code`), the compiler is falling back to emitting `custom_code` instead of structured config. Increase coverage there — many of those cases might be derivable with better heuristics.

4. **Update the system prompt.** `formalization-system-v4.md` should explicitly discourage `map_expression` in favor of `field_mapping` / `field_path` / `field` / `column_index`. The current "(optional)" framing is too permissive.

### Phase B — Sandbox or remove (decide based on telemetry)

After Phase A telemetry runs for ≥ 2 weeks, three possible outcomes:

| Telemetry shows | Action |
|---|---|
| < 5% of map steps use `expression` | **Deprecate** — emit a DSL-validation warning when `expression` is present; route the small remaining set to a small allow-list of well-known patterns (e.g. `item.map(...)`, `item.filter(...)`) that we can implement deterministically. |
| 5–25% | **Sandbox** — replace `new Function()` with a parser/evaluator like `ConditionalEvaluator.safeEvaluate()` (lines 296–516) that supports the subset of JS used by real workflows: dot/bracket access, `.map`/`.filter`/`.includes`, comparison, `&&`/`\|\|`, ternary, literal array/object. No globals, no `eval`, no I/O. |
| > 25% | **Investigate first** — the heavy usage suggests the structured modes don't cover real needs. Pull a corpus of `expression` strings from logs, cluster by pattern, and either extend `field_mapping` to cover the clusters or accept that we need a maintained sandbox. |

### Phase C — `resolveLiteralWithVariables` site (independent)

Site #3 is reached after JSON.parse fails. Two options:
1. **Tighter detection up front.** Most LLM-emitted "literal with vars" inputs are JSON-shaped. Strict-check the input shape before the JSON.parse / eval fallback chain. If it doesn't match `^\[` / `^\{` / a primitive pattern, reject upstream.
2. **Replace eval with a tiny JSON5-like parser** that handles single quotes, unquoted keys, and trailing commas — the things JSON.parse rejects but real LLM outputs often emit. Then drop the eval path entirely.

---

## What's NOT in this audit

- **Counts of real production usage** — requires running Phase A telemetry against production for ≥ 2 weeks. Not derivable from local code alone.
- **Performance impact** — `new Function()` compiles JS at runtime, which is slow. Replacing with structured operations would be faster, but the magnitude depends on call frequency.
- **A patch.** This is investigation only.

## Risk if we do nothing

| Risk | Likelihood | Impact |
|---|---|---|
| LLM emits malformed `expression` → workflow fails with confusing error | Medium-high | Already happens occasionally (D-B25, D-B27 in docs). |
| Plugin output contains JS-meaningful chars → unintended eval behavior | Low | Mitigated by JSON.stringify on substitution, but not zero. |
| New developer reads `new Function()` and assumes the codebase is OK with eval, copies the pattern elsewhere | Medium | Pattern propagation. |
| Security review flags eval as a finding | Certain (eventually) | Compliance risk — `new Function()` shows up on every static scanner. |

---

## Recommendation summary

| Action | Phase | Effort | Outcome |
|---|---|---|---|
| Add per-mode telemetry to `transformMap` (incl. an info log on the `expression` branch) | A | ~30 min | Real production data on eval usage rate |
| Add same telemetry to `resolveLiteralWithVariables` site #3 | A | ~15 min | Data on the rarer fallback eval path |
| Update `formalization-system-v4.md` to discourage `map_expression` | A | ~30 min | Reduces eval emissions over time |
| Audit `deriveMapStructuredConfig` for cheap heuristic gaps | A | ~2 hours | More LLM `custom_code` cases compiled to structured config |
| (After telemetry) Decide sandbox vs deprecate | B | TBD | Eliminate `new Function()` |

**No file changes in this investigation.** Phase A is a separate workplan once you're ready.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial investigation | Dev agent draft |
