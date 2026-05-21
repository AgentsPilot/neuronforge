# WP: Conditional Type Coercion for Ordering Comparisons

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/conditional-type-coercion`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`ConditionalEvaluator.compareValues` (`lib/pilot/ConditionalEvaluator.ts:532–566`) applies raw JavaScript operators `>`, `>=`, `<`, `<=` directly to the operands. Plugin outputs frequently arrive as strings (Google Sheets cells, HTTP response fields, AI-extracted values). When the left/right sides are numeric strings, lexical comparison kicks in and produces silently-wrong results:

| Expression | Today's result | Correct result |
|---|---|---|
| `"95" > 90` | true (lucky: `90` coerces to `"90"` then lexical `"95" > "90"`) | true |
| `"100" > 90` | **false** (lexical: `"1" < "9"`) | true |
| `"9" > "10"` | **true** (lexical) | false |
| `"95" >= 100` | **true** (lexical) | false |

Date strings have the same problem when one side is a `Date` object and the other is an ISO string.

This is the H-6 finding from the execution layer review. The fix adds type-aware coercion only for the four ordering operators. `==` / `!=` are left alone because JS loose equality already handles `"95" == 95` correctly enough for typical workflows.

## Goal

Make ordering comparisons type-aware: if both operands look numeric → compare as numbers; if both look like dates → compare as timestamps; otherwise fall back to today's JS behavior (so string comparisons that genuinely want lexical ordering keep working).

## Non-Goals

- Changing `==`, `!=`, `contains`, `in`, `matches`, `starts_with`, `ends_with`, or any other operator.
- Touching the existing date-aware operators (`within_last_days`, `before`, `after`) — they already use `parseDate()`.
- Adding new operators.
- Coercing in the AST evaluator at `safeEvaluate()` — that path is exclusively used by expression-mode conditions and already passes through `compareValues`.

---

## Design Decisions

### D1. Strict numeric detection (no false positives)

A value "looks numeric" if it is:
- A finite `number` (excludes `NaN`, `Infinity`); OR
- A string matching `/^-?\d+(\.\d+)?$/` after trimming.

This deliberately rejects `"95abc"`, `"1e10"`, `"0x10"`, `"  "`, and `""` — all of which `parseFloat` would happily parse but which the user almost certainly did not intend as numbers.

### D2. Strict date detection (no clash with numeric)

A value "looks like a date" if it is:
- A valid `Date` object (not `NaN`); OR
- A string that:
  - Does NOT look numeric (rule D1), AND
  - Contains at least one of `-`, `/`, `T`, `:`, AND
  - Parses cleanly via the existing `parseDate()` helper.

The first two checks avoid the JS footgun where `new Date("95")` returns "1995-01-01" — a bare numeric string should never be coerced to a date.

### D3. Coerce only when BOTH sides match the same type

If only one side looks numeric (or only one looks like a date), we do NOT coerce. We fall through to JS operators. This avoids the surprise of `"95" > "foo"` becoming `95 > NaN` (which is `false` by JS rules anyway, but the intent is unclear and we'd rather keep behavior predictable).

### D4. Order of checks: numeric before date

Always try numeric coercion first. This protects bare numeric strings (`"95"`) from being misinterpreted as dates.

### D5. Feature-flag gating

Add SystemConfig flag `pilot_conditional_type_coercion_enabled` (default `false`). When false (default), behavior is identical to today — zero regression risk. When true, the coercion logic activates.

Wired through `ExecutionContext` like the previous fixes — but with one difference: `ConditionalEvaluator` doesn't currently receive a per-context flag because it's stateless. We can either:
- Pass the flag into `evaluate()` / `evaluateSimpleCondition()` as part of an options arg, OR
- Read the flag from `context` directly inside `compareValues`.

I prefer option (b): add `private contextRef?: ExecutionContext` set inside `evaluate()`, and read `contextRef.isConditionalCoercionEnabled()` inside `compareValues`. Slightly less clean than passing through, but it avoids changing the public signatures of `compareValues`/`evaluateSimpleCondition` which are called from many places.

Actually — cleaner: add the flag to `ExecutionContext` (same shape as `strict` and `loopInnerOverwriteDisabled`), and `compareValues` becomes `compareValues(left, right, operator, options?: { coerce?: boolean })`. The caller passes `options.coerce = context.isConditionalCoercionEnabled()`.

But all internal calls to `compareValues` currently don't have a `context` in scope (they're inside the AST evaluator). Threading `context` through every internal call is a much larger change.

**Decision:** Store `context` on the `ConditionalEvaluator` instance for the lifetime of one `evaluate()` call. Set it at the top of `evaluate()`, clear it at the end (via `try/finally`). Read inside `compareValues`. This is small, safe, and contained — and since one `ConditionalEvaluator` is used per `WorkflowPilot` (singleton), but each `evaluate()` is sequential within a single workflow execution, the state isn't actually shared across executions in a way that races.

Actually wait — same H-4 concern: if `ConditionalEvaluator` is reused across concurrent `execute()` calls, mutating instance state per-call is unsafe. Let me check.

Looking at `WorkflowPilot.ts:102`:
```
this.conditionalEvaluator = new ConditionalEvaluator();
```

So one `ConditionalEvaluator` per `WorkflowPilot`. If `WorkflowPilot` is shared across concurrent executions, the same race exists. But Fix #3 already moved per-execution state off `WorkflowPilot`. So the shared `ConditionalEvaluator` is also a risk.

**Better decision:** Pass coercion choice in as a parameter from `evaluate()` only, and thread it through the AST evaluator via a local `coerce: boolean` captured in closures or passed through the AST evaluator's helper methods. The AST evaluator methods (`evaluateAST`, `evaluateASTValue`, etc.) all live inside the same class — but we can thread `coerce` through them as a parameter.

Simpler: add `coerce` to the AST node itself during `parse()`. But the AST is built before we have context.

Simplest pragma: rewrite `evaluate()` to accept an optional `options: { coerce?: boolean }` arg, and pass `coerce` through the helpers. This is straightforward.

**Final decision:** Modify the public `evaluate(condition, context)` to read `context.isConditionalCoercionEnabled()` once at the top, then thread the resulting `coerce: boolean` down through the helper chain (`evaluateSimpleCondition`, `evaluateComplexCondition`, `safeEvaluate`, `evaluateAST`, `compareValues`). About 6 method signatures touched, all internal. No public API change beyond what `evaluate()` already accepts (context is already a param).

---

## File-by-File Changes

### M1. `lib/pilot/ExecutionContext.ts` (MODIFY)

Add a 4th boolean flag, same shape as `strict` and `loopInnerOverwriteDisabled`:

- Private field `conditionalCoercionEnabled: boolean = false`
- Constructor param `conditionalCoercionEnabled: boolean = false` (8th positional arg)
- Getter `isConditionalCoercionEnabled(): boolean`
- `clone()` propagates it
- `logger.info` includes the flag

### M2. `lib/pilot/ConditionalEvaluator.ts` (MODIFY)

1. Add two new private helpers: `looksLikeNumber(value)` and `looksLikeDate(value)` per D1/D2.
2. Add a new private helper `coerceForOrdering(left, right): [any, any]` that applies D3/D4.
3. Modify `compareValues` to accept an optional `coerce: boolean` parameter (defaults `false` for safety). When `coerce` is true, call `coerceForOrdering` before applying `>`, `>=`, `<`, `<=`.
4. Thread `coerce` through the call chain: `evaluate` → `evaluateSimpleCondition` → `evaluateComplexCondition` → `safeEvaluate` → `evaluateAST` → `compareValues`.

The implementation reuses the existing `parseDate()` helper for date coercion.

### M3. `lib/pilot/WorkflowPilot.ts` (MODIFY)

Read the new SystemConfig flag alongside the existing three:

```ts
const [..., conditionalCoercionEnabled] = await Promise.all([
  ..., // existing 3 flags
  SystemConfigService.getBoolean(
    this.supabase,
    'pilot_conditional_type_coercion_enabled',
    false // Default: off — legacy JS comparison preserved
  ),
]);
```

Pass into the main and sub-workflow `ExecutionContext` constructors as the 8th positional arg.

### M4. `lib/pilot/StateManager.ts` (MODIFY)

Resume path reads the flag and passes to reconstructed context, mirroring the existing strict/loopOverwrite handling.

### M5. `lib/pilot/__tests__/ConditionalEvaluator.test.ts` (NEW FILE)

There is no existing test for `ConditionalEvaluator` — checked. New file covers:

| # | Case | Coerce | Expected |
|---|---|---|---|
| C1 | `"100" > 90` | on | true |
| C2 | `"100" > 90` | off | false (legacy) |
| C3 | `"9" > "10"` | on | false (numeric) |
| C4 | `"9" > "10"` | off | true (legacy lexical) |
| C5 | `"95" >= 100` | on | false |
| C6 | `"95.5" > "95.4"` | on | true |
| C7 | `"95abc" > 90` | on | false (not numeric → JS lexical "95abc" > "90" → true... actually need to check) — **adjust test** |
| C8 | `"foo" > "bar"` | on | true (no coercion, lexical) |
| C9 | `"2026-05-12" > "2026-04-01"` | on | true (date coerced) |
| C10 | `Date('2026-05-12') > "2026-04-01"` | on | true (one Date, one string → date coerced) |
| C11 | `"95" == 95` | (either) | true (JS already handles) |
| C12 | `null > 5` | on | false (no coercion, JS behavior) |

C5/C6 are the tricky ones — let me verify by hand: `"95abc"` doesn't match `/^-?\d+(\.\d+)?$/`, so it's not numeric. Fall through to JS: `"95abc" > 90` → `"95abc" > "90"` → first char `"9"==="9"`, second `"5"==="0"`? `"5".charCodeAt(0)=53`, `"0".charCodeAt(0)=48` → `"5" > "0"` → true. So C7 expected = true (legacy). Drop the C7 case as ambiguous — replace with simpler "not numeric, no coercion happens" check.

---

## Behavior Contract

### Flag OFF (default)
Identical to today. Every ordering comparison uses raw JS operators. Zero regression.

### Flag ON
- `"100" > 90` → `true` (was `false`)
- `"95.5" > "95.4"` → `true` (was `true` lexically too — same answer, by accident)
- `"foo" > "bar"` → `true` (unchanged — not numeric, not a date)
- ISO date string comparisons coerced to Date.getTime() and compared.

---

## Rollout

Same as Fixes #1–#4: ship with flag off, enable in staging, measure, ship to production. Instant rollback via SystemConfig toggle.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A workflow depends on lexical ordering of numeric-looking strings (e.g. SKU codes "100" / "90") | Very Low | Wrong branch taken | Such workflows are vanishingly rare; flag-gated rollout; can be detected by replaying corpus |
| R2 | Date coercion mis-identifies an ambiguous string (e.g. "12-15" — month-day or duration?) | Low | Wrong comparison | Strict regex requires multiple separators; date parser falls back to null on failure → no coercion happens |
| R3 | Threading `coerce` through 5+ helpers introduces bugs | Low | Inconsistent coercion across paths | All paths covered by tests (C1–C12); TS check ensures no `coerce` param is dropped |
| R4 | `ConditionalEvaluator` is shared across executions (H-4 echo) and the threaded `coerce` param is per-call so no race | Certain (no race) | None | This is the right pattern; passing through args avoids instance state |
| R5 | `evaluateExpression` path (lines 197–203) uses the AST evaluator without going through `evaluate()`, so doesn't get the coerce flag | Need to check | Coercion not applied in expression-mode conditions | **Must inspect**: see if `safeEvaluate` is reachable from any caller other than `evaluate()`. If yes, thread coerce there too. |

R5 is a real concern — let me verify when implementing.

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (ExecutionContext flag) | 15 min |
| M2 (ConditionalEvaluator coercion) | 45 min |
| M3 (WorkflowPilot wiring) | 10 min |
| M4 (StateManager wiring) | 10 min |
| M5 (new test file with ~12 cases) | 1 hour |
| TS check + verification | 30 min |
| **Total** | **~3 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
