# WP-07: Schema-Driven Auto-Coercion at Step Boundaries

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~5–6h
> **Author**: Dev agent

## Problem

When a step expects type A and the upstream step produces type B, today's runtime handles the mismatch via **fuzzy resolution in `ExecutionContext`**:
- snake↔camel key matching (`findMatchingKey`)
- Auto-`.data` navigation
- Lenient `getNestedValue` returning `undefined` silently

These are runtime band-aids. They mask bugs, are flag-gated off by default after Tier 1 Fix #2 (strict resolution), and produce subtle behavior that's hard to reason about.

The right model: **at compile time, detect known-coercible mismatches** between adjacent steps' schemas and **emit an explicit transform step** to convert. Runtime stays strict; coercion is visible in the workflow.

## Goal

For each step transition where:
1. Upstream output schema is known
2. Downstream input expectation is known
3. The mismatch is a known coercible pattern (snake↔camel, single↔array, string↔number, object envelope)

…auto-insert a `transform` step that performs the coercion. Make the coercion explicit and visible. Eliminate the need for lenient runtime resolution.

## Non-goals

- Auto-coercing across semantically incompatible types (`number` ↔ `Date`, etc.) — that's user intent territory.
- Replacing `ConditionalEvaluator`'s type coercion (Fix #5 — that's for comparison operators, different concern).
- Removing the lenient `ExecutionContext` paths immediately — keep them as a safety net for now, but the goal is they're never reached when this fix lands.

## Design

### D1 — Known coercion patterns

| Upstream → Downstream | Pattern | Inserted transform |
|---|---|---|
| `{ x: 1 }` → expects array | Wrap-in-array | `{operation: 'map', expression: '[item]'}` (or `set` to `[item]` semantically) |
| `[{x:1}]` → expects single object | Unwrap-array (take first) | `{operation: 'map', field_path: '[0]'}` |
| `{ data: [...] }` → expects `[...]` (envelope unwrap) | Extract field | `{operation: 'map', field: 'data'}` |
| `{ snake_case: 1 }` → expects `{ camelCase: 1 }` | Field-rename | `{operation: 'map', field_mapping: { camelCase: 'snake_case' }}` |
| Numeric string → expects number | Type cast | New `coerce` operation or inline `Number(item)` |
| Plugin returns `{ items: [...] }` → step expects array of items | Field extraction | `{operation: 'map', field: 'items'}` |

### D2 — Where the detection runs

The V6 `ExecutionGraphCompiler` already walks the IR's step graph with both producer and consumer schemas in scope. After the existing IR-to-DSL emission, add a pass:

```
for each edge (producer → consumer) in the execution graph:
  producerOutputSchema = producer.output_schema  (or derived from plugin definition)
  consumerInputExpectation = consumer.expected_input_schema (or derived)
  
  mismatch = compareSchemas(producerOutputSchema, consumerInputExpectation)
  
  if mismatch.isCoercible:
    insert a transform step between producer and consumer
    update all references in consumer to point at the transform's output
```

### D3 — Inserted transform metadata

Each inserted transform should be tagged so the user (and debugging tools) can see they were auto-inserted:

```ts
{
  id: '<original-consumer-id>__coerce',
  type: 'transform',
  operation: 'map',
  input: '{{<producer-id>.data}}',
  config: { field: 'items' },  // or field_mapping, or expression
  _meta: {
    auto_inserted: true,
    reason: 'envelope_unwrap',
    inserted_by: 'schema_coercion_pass',
  },
}
```

User-facing translator can surface these as auto-fixes: "We added a step to extract the email list from <plugin>'s response. No action needed."

### D4 — Schema sources

Two sources of schemas:

1. **Plugin output schemas** from `lib/plugins/definitions/*.json` (authoritative — already loaded by PluginManagerV2).
2. **AI step output schemas** declared on the step's `output_schema` field.

For consumer input expectations:
- Transform / filter operations: derived from the operation type (`filter` needs an array, `map` needs an array, etc.)
- AI steps: declared `input_schema` if present; otherwise treated as accepting anything.

When the consumer expectation is unknown, skip the coercion pass for that edge (don't risk inserting unwanted transforms).

## File-by-file changes

| File | Change |
|---|---|
| `lib/agentkit/v6/compiler/SchemaCoercionPass.ts` | **NEW** — the compile-time pass. Takes the emitted DSL workflow + plugin catalog, returns workflow with inserted transforms. |
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Invoke `SchemaCoercionPass` after the existing emission, before returning the final DSL. |
| `lib/pilot/StepExecutor.ts` (transformMap, transformFilter) | No changes (these already handle the modes the pass emits). |
| `lib/pilot/ExecutionContext.ts` | No changes initially. Once telemetry confirms the coercion pass covers the cases, the lenient `findMatchingKey` and auto-`.data` paths can be tightened separately. |
| `lib/pilot/shadow/userFacing.ts` | Translator branch for `auto_inserted` transforms (informational, will_auto_fix). |
| `lib/agentkit/v6/compiler/__tests__/SchemaCoercionPass.test.ts` | **NEW** — unit tests for each coercion pattern with mock schemas. |

## Tests

| # | Producer schema | Consumer expectation | Expected insertion |
|---|---|---|---|
| C1 | `{ items: [...] }` | array | Transform with `field: 'items'` |
| C2 | `[{x:1}]` | single object | Transform with `field_path: '[0]'` |
| C3 | `{x:1}` | array | Transform that wraps |
| C4 | `{ snake_case: 1 }` | `{ camelCase: 1 }` | Transform with `field_mapping` |
| C5 | Numeric string → number | Coerce step |
| C6 | Schemas match exactly | No insertion |
| C7 | Schemas incompatible (Date ↔ object) | No insertion; pre-flight warning emitted |
| C8 | Consumer expectation unknown | No insertion |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Inserted transforms break in edge cases (empty arrays, null inputs) | Each pattern has a defensive variant (e.g. `field_path` returns `undefined` if path missing; wrap-in-array on `null` → `[null]` which downstream filters can handle). Tested in C1–C5. |
| R2 | User edits the workflow and the auto-inserted step looks confusing | UI surface marks auto-inserted steps explicitly. User can delete them; if they do, lenient runtime path catches the mismatch (safety net). |
| R3 | Pass slows down compilation | Schema comparison is O(steps × fields). Cap depth at 5 levels. |
| R4 | Pass introduces an infinite loop (transform feeds back into itself somehow) | Pass runs ONCE over the DAG; topological order; no re-entry possible. |

## Estimated effort

~5–6 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
