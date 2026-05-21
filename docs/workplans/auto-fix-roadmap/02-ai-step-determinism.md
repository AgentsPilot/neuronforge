# WP-02: AI Step Nondeterminism Narrowing

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~1.5h
> **Author**: Dev agent

## Problem

AI steps (`ai_processing`, `llm_decision`) call LLMs which can produce different output for the same input across runs. Calibration sees one output shape; production may see another. Downstream steps that depend on specific keys / value formats can break.

Mitigations exist but are **inconsistently applied**:
- `AIOutputValidator` validates output against a declared schema (good).
- But: no enforcement of `temperature=0` for steps where determinism matters.
- No enforcement of structured-output mode where the model supports it (OpenAI's `response_format: json_schema`).
- No "if output shape doesn't match, retry once" guard for transient LLM nondeterminism.

## Goal

For AI steps that have a declared `output_schema`, the runtime should:

1. **Force `temperature=0`** automatically. (Calibration is about reproducibility.)
2. **Force structured-output mode** when the provider supports it.
3. **Retry once** if the LLM's output fails `AIOutputValidator` — same prompt, force structured-output more strictly, with a repair-prompt nudge.
4. Surface to the user only after the retry also fails.

For AI steps WITHOUT a declared `output_schema` (open-ended generation like summarization), keep current behavior — those are user-creative steps, not deterministic ones.

## Non-goals

- Modifying how temperature is set for non-AI step types.
- Changing the LLM provider abstraction layer.
- Implementing JSON-schema → provider-specific structured-output config (each provider does it differently — out of scope here).

## Design

### D1 — Schema as the gate

The rule: **if `step.output_schema` is non-empty, the step is "deterministic-intended."** Apply the narrowing automatically.

This avoids new flags or config — the schema's presence IS the signal.

### D2 — Where to inject

`StepExecutor.executeLLMDecision` (or `callLLMDirect` for `ai_processing` steps) is where the LLM call is built. Inject `temperature: 0` into the request when the step has a non-empty `output_schema`. Existing user-set temperature is preserved when no schema is declared.

### D3 — Structured-output enforcement

For OpenAI provider with `output_schema` present:
- Add `response_format: { type: 'json_schema', json_schema: { name, schema } }` to the request.
- Existing `AIOutputValidator` runs as a second-line check.

For Anthropic and others without native structured-output: rely on `AIOutputValidator` + prompt instructions. (No-op for now.)

### D4 — Shape-retry on validation failure

Today's flow: `executeLLMDecision` → returns data → `AIOutputValidator.validate(...)` → if invalid, log warn + maybe trigger `buildRepairPrompt`. The repair-prompt path exists (`StepExecutor.ts:1850`) but should be reliably invoked:

1. First LLM call.
2. If `validateAIOutput(...)` returns invalid, take the validation errors, build a repair prompt that includes the original output AND the schema violations, re-call.
3. If the second call also fails validation, surface to the user via `userFacing.translateAIShapeFailure(...)`.

The repair logic exists but is wired only for some AI types. Make it unconditional when `output_schema` is set.

## File-by-file changes

| File | Change |
|---|---|
| `lib/pilot/StepExecutor.ts:executeLLMDecision`, `callLLMDirect` | Before the LLM call, if `step.output_schema` is non-empty: force `temperature: 0` and (for OpenAI) inject `response_format: 'json_schema'`. |
| `lib/pilot/StepExecutor.ts:1850 region` | Ensure the repair-prompt retry fires whenever `AIOutputValidator.validate` returns invalid AND `output_schema` was set. |
| `lib/pilot/AIOutputValidator.ts` | No changes — already correct. |
| `lib/pilot/shadow/userFacing.ts` | Add a translator branch for `ai_shape_validation_failed` errors (after the retry). |
| `lib/pilot/__tests__/StepExecutor.ai-determinism.test.ts` | New test file: assert temperature=0 is set when schema present, repair fires on bad output, both fail surfaces to user. |

## Tests

| # | Case | Expected |
|---|---|---|
| A1 | AI step with `output_schema` present | LLM request has `temperature: 0` |
| A2 | AI step with NO `output_schema` | User-set temperature preserved |
| A3 | First call returns invalid shape | Repair prompt fired, retry attempted |
| A4 | Repair retry also fails | User-facing translator produces friendly message; step marked failed |
| A5 | Repair retry succeeds | Step marked success; no user-visible warning |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | A user-set `temperature` (creative-writing step) is silently overridden | Only override when `output_schema` non-empty — the explicit signal that determinism is wanted |
| R2 | Structured-output JSON Schema differs from `output_schema` shape | Validate that AgentPilot's `output_schema` translates cleanly to OpenAI's JSON Schema before injecting; fall back to schema-less + AIOutputValidator if translation fails |
| R3 | Doubling LLM cost on every step that fails validation | Cap retry at one attempt (not infinite). Existing `AIOutputValidator` flow is already a single retry. |

## Estimated effort

~1.5 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
