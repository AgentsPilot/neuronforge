# Workplan: gpt-image-1 retirement (Business OS image model)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Branch:** `fix/gpt-image-1-retirement`
**Requirement:** user decision 2026-10-14 (Barak); feature owner Offir emailed for approval. Price record: [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) Change History 2026-10-14
**Status:** Code Complete (uncommitted)

## Overview

OpenAI shuts `gpt-image-1` down on **23 Oct 2026**. Business OS image generation (`GeneratedImageService`, area `images`) moves to `gpt-image-2.5-flare`, with the request quality pinned to `high`. The 2.5 models add `xhigh` and `max` levels, so leaving `auto` could let the provider pick a level several times the cost. This supersedes CR-1 option C (2026-09-18, which kept `auto`).

The model in prod comes from the `bos_llm_area_images` row (`{model: gpt-image-1, enabled: true, provider: openai}`), not from the code default. The code default matters as the `withModelFallback` retry target and as the model the guardrail skips. So this PR ships the default and the prices; the prod row is moved afterwards in one UPDATE.

The image guardrail (`checkImageModel`) refuses any model whose configured sizes are not all priced at low, medium and high. Prod has no `image_generation_prices_usd`, so the prices go in the in-code `IMAGE_FALLBACK_PRICING`: an out-of-band addition, since the price review flow (slice 3) is on hold and cannot carry it before the shutdown.

## Prices

Calculator estimates (OpenAI image-generation guide, row "GPT Image 2.5 (Sunburst and Flare)", checked 2026-10-14). Rule: output tokens × $30/M, plus $0.001 for prompt text tokens, rounded up to $0.001.

| Size | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| 1024x1024 | 0.007 | 0.015 | 0.054 | 0.095 | 0.212 |
| 1536x1024, 1024x1536 | 0.006 | 0.012 | 0.043 | 0.075 | 0.166 |

The `gpt-image-1` entries stay until the shutdown has passed: the prod row names it until the UPDATE, and `chargePricing` takes the conservative image rate as the maximum of the map (0.25, unchanged).

## Tasks

| # | Task | Status |
|---|---|---|
| 1 | `SystemConfigRepository.ts`: default model `gpt-image-2.5-flare`, quality `high`, doc comment; 15 fallback prices with provenance; gpt-image-1 entries kept with a note | ✅ |
| 2 | Tests that encoded the old default: repository image test (quality `high`), GeneratedImageService attribution (default `high`; reported-quality cases configure `auto` explicitly; new "report of high under the default" case), seeded-row tests (seed resolves to its own `gpt-image-1`), `bos-llm-settings` verify-equivalence (mocked legacy reader returns the stored model), step 3 boundary snapshot (quality only) | ✅ |
| 3 | New tests: default model covered at low/medium/high and xhigh/max from the fallback alone (`priceCoverage.test.ts`); a row naming gpt-image-1 is still accepted (`modelSettings.test.ts`); gpt-image-1 prices kept (repository image test) | ✅ |
| 4 | Comments in `GeneratedImageService.ts` that called `auto` the default | ✅ |
| 5 | Docs: price review requirement Change History; credit pricing §4.5 note | ✅ |
| 6 | Migration `20261061_bos_llm_images_model_gpt_image_2_5_flare.sql`: guarded one-row move of `bos_llm_area_images` to flare, applied by hand after deploy (SA F1) | ✅ |
| 7 | Attribution test: requested `high`, reported `xhigh` → priced at the flare `1536x1024:xhigh` entry with the different-quality warning (SA F2) | ✅ |
| 8 | Open item Q10 in the price review requirement: removing the gpt-image-1 entries after 23 Oct lowers the conservative image rate $0.25 → $0.212 (SA F3) | ✅ |

`lib/business-os/llm/__fixtures__/seededRows.ts` is unchanged on purpose: it mirrors what migration `20261003_seed_bos_llm_area_settings.sql` writes (T1-9 reads only that file), and an applied migration is not edited. `20261061` is a later change to the row, not part of the seed.

Removing the `gpt-image-1` fallback entries after 23 Oct is open question Q10 in [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) §8.

## Post-deploy steps

1. **Only with the user's OK**, apply migration `20261061_bos_llm_images_model_gpt_image_2_5_flare.sql` by hand (it sets `model` of `bos_llm_area_images` to `gpt-image-2.5-flare`, nothing else), then run the read-back query in its header. Never before the deploy. Until then prod generates with `gpt-image-1` at quality `high` ($0.167–$0.25 per image), so do it soon after the deploy and before 23 Oct 2026.
2. Live test: generate one image on a test business. Check the `token_usage` row: `model_name = gpt-image-2.5-flare`, `cost_usd` matches the table above for the reported quality, and no "No price" or "different quality than requested" log.

## SA Review Notes

**Code Review by SA — 2026-10-14**
**Status:** ✅ Code Approved (with nits)

Verified: the affected suites pass (`lib/business-os/llm`, the repository image test, `GeneratedImageService` tests, `scripts/__tests__/bos-llm-settings.test.ts`: 26 suites, 698 tests, 23 snapshots). `check:bos-llm-literals` passes (0 violations). `tsc --noEmit` reports nothing in the changed files. No `console.*` in the touched source files. No import from `lib/business-os/entitlements/`, so the entitlements checklist does not apply. The model lives only in `IMAGE_GENERATION_CONFIG_DEFAULTS` (the documented defaults home), referenced by the policy, so this complies with `bos-llm-call-standards` (no hardcoded model in feature code).

### Rulings on the questions asked

1. **Seeded-row "documented exception" (T1-9, callParams leg C): sound.** `seededRows.ts` mirrors an applied migration, and an applied migration is never edited, so the fixture must keep `gpt-image-1`. Overriding only `model` for `images` and comparing every other field keeps the test strict. Leaving the test name "the seed changes nothing" with a parenthetical is acceptable. — SA: resolved
2. **The window between deploy and the row UPDATE: acceptable.** Before this change, `auto` on `gpt-image-1` came out at `high` ($0.25) on all 5 real images, so pinning `high` does not change what prod pays in the window. Making quality depend on the model would add a new mechanism for a few days of exposure. Conditions: run the UPDATE soon after the deploy (see finding 1 for how), and **never before the deploy**. The old code has no flare prices, so its guardrail would refuse the row: one error log per cache refill, then a fallback to `gpt-image-1`. Harmless, but noisy. Also allow for the settings cache window after the UPDATE before the live test. — SA: resolved
3. **RC-W7b protection: sufficient.** The main protection already exists. T1-3 in `modelSettingsPolicy.test.ts` runs `checkModelAcceptable` on every code default with the shortcut bypassed, and it now passes for flare from the fallback prices alone. The new `priceCoverage` test adds what T1-3 does not cover: `xhigh`/`max`, the quality pin, and a finite, positive price check. One gap predates this change: both checks use the DEFAULT sizes, so a prod `image_generation_sizes` override paired with the default model is never price-checked. Not introduced here. — SA: resolved
4. **Keeping the gpt-image-1 fallback prices: correct.** They do three things: (a) the prod row now names a non-default model, so it IS price-checked, and without them every refill would log an error and fall back; (b) they price the images generated in the window; (c) they keep the `chargePricing` conservative image rate at $0.25. Removing them after 23 Oct lowers that rate to $0.212 (the flare `max` price). That is a credit-charging change in its own right and needs its own decision. See finding 3. — SA: resolved
5. **Test changes: correct.** The reported-quality cases have to configure `auto`. Under the `high` default, a reported `medium` or `low` would trigger the "different quality than requested" warning, and these tests assert there is none. The new "high under the default" case covers the default path. The `verify-equivalence` mock fix is right: that test passed before only because the default happened to equal the stored value. The step-3 snapshot (`gpt-image-1` + `high`) matches what prod will send in the window. — SA: resolved

### Code Review Comments

1. Post-deploy step 1: the prod row move is an ad-hoc UPDATE, so no file in the repo records it. A fresh or rebuilt environment that replays migrations ends up on `gpt-image-1`. After 23 Oct, every image call there would fail first and recover through `withModelFallback`. Recommended: ship the move as a migration file in this PR (applied by hand, as usual). Make it guarded (`... WHERE key = 'bos_llm_area_images' AND value->>'model' = 'gpt-image-1'`), change only `model`, and follow it with a read-back query. At minimum, put the exact SQL, its guard, and the verification query in this workplan before it runs. — Priority: Medium (not blocking the code; must be settled before step 1 runs)
2. `GeneratedImageService.attribution.test.ts`: no test covers the case the `xhigh`/`max` prices exist for: the request is `high` but the provider reports `xhigh` (or `max`). Add one: it should be priced at `IMAGE_FALLBACK_PRICING['gpt-image-2.5-flare:1536x1024:xhigh']` and log the "different quality than requested" warning. — Priority: Low
3. Follow-up, not this PR: removing the `gpt-image-1` entries after 23 Oct lowers the `chargePricing` conservative image rate from $0.25 to $0.212. Record it as an open item in the price-review requirement, so whoever removes the entries knows they are changing a charge rate, not just deleting dead code. — Priority: Low
4. `GeneratedImageService.ts` `UNREPORTED_QUALITY_PRICED_AS`: the comment is accurate. Note, though, that if an operator configures `auto` on flare, an image with no reported quality is priced at `high`, which may understate the cost (`xhigh`/`max` exist). That is acceptable while the default pin holds. Revisit it if `auto` is ever configured. — Priority: Low

### Optimisation Suggestions

- The `priceCoverage` test requires `xhigh`/`max` for whatever the default model is. If the default ever moves to a model without those levels, the test will demand prices for levels that do not exist. The comment explains why the requirement is there, so this is acceptable as it stands.
- `modelSettingsPolicy.ts` ~L283 still says `gpt-image-1` is absent from the in-code token price table. It is still true (that sentence is about the token table), but naming the current default would read better. Optional.

### Code Approved for QA: Yes (finding 1 settled before post-deploy step 1; findings 2–4 optional or follow-up)

## QA Testing Report

**QA — 2026-10-14**
**Test mode:** full (focus: pricing, guardrail, provider response shape)
**Strategy used:** A + B (targeted Jest suites, mocked Supabase/provider) and C (one live OpenAI call from a scratchpad script, authorized by the user, about $0.04). No dev server, no app route, no DB writes.
**Focus:** api, schema, performance (cost)
**Skipped:** D (manual browser check). The UI does not change, and the end-to-end check through the app writes a `token_usage` row, which belongs to Post-deploy step 2.
**Input source:** prompt (TL brief)

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Default model `gpt-image-2.5-flare`, quality pinned `high` | ✅ | Pass | `GeneratedImageService.attribution`: request carries the default model, `quality: 'high'`; an invalid configured quality (`ultra`) falls back to `high` |
| Default model priced for every size at low/medium/high (guardrail) and xhigh/max | ✅ | Pass | `priceCoverage.test.ts` new case, from the in-code fallback alone; every fallback value finite and > 0 |
| Report of `high` under the default is priced at the `high` table value, no warning | ✅ | Pass | New attribution case: `cost_usd` = 0.043 for 1536x1024 |
| Prod row still naming `gpt-image-1` is accepted until its UPDATE | ✅ | Pass | `modelSettings.test.ts` new case, no error logged; gpt-image-1 prices kept (repository image test) |
| Failure path: unpriced model | ✅ | Pass | Guardrail refuses an image model not priced at every size/low/medium/high (`modelSettings.test.ts`); a resolved unpriced model records `cost_usd: 0` with a "No price" error log naming model/size/quality (`GeneratedImageService.attribution`) |
| Failure path: provider error / n≠1 | ✅ | Pass | `openaiProvider.image.test.ts`: thrown call re-throws after its failure row; n≠1 refused before any call |
| Live call works with the exact request shape the provider sends | ✅ | Pass | `images.generate({model, prompt, size: '1536x1024', quality: 'high', n: 1})` via the installed SDK 5.23.2: success in 34 s |
| Live response matches what the code reads | ✅ | Pass | `data[0].b64_json` present (2,374,177 decoded bytes, valid PNG of the requested scene); `quality: 'high'` (the key `priceFor` receives); `size: '1536x1024'`; `output_format: 'png'` |
| Live token cost fits under our price | ✅ | Pass | See below: $0.041425 vs 0.043 |
| BOS literal guard | ✅ | Pass | `check-bos-llm-literals`: 63 files, 2 exempt, 0 violations |

### Live cost check (1536x1024, high)

`usage`: `input_tokens 53` (text 53, image 0), `output_tokens 1372` (all image), `total_tokens 1425`.
Cost = 1372 × $30/M + 53 × $5/M = $0.04116 + $0.000265 = **$0.041425**, under our **0.043** by $0.0016 (about 3.7%). The output token count is exactly the calculator's figure (1372), so the table's derivation is confirmed for this row. 1024x1024 high was not called live; at the calculator's 1756 tokens it is $0.05268 plus text, under 0.054.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Thin text-token allowance at high.** The table allows $0.001 for prompt text (200 tokens). The route caps the user prompt at 300 characters and the service appends `STYLE` (about 35 tokens), so a real prompt stays near or under about 150 tokens in English. Headroom before an image costs more than its price: about 315 text tokens at 1536x1024 and about 264 at 1024x1024. No realistic prompt reaches that today; if the prompt cap or `STYLE` grows, re-check. Low.
2. The live call took 34 s. Not a change from this PR to fix, but the route's timeout budget should be confirmed during Post-deploy step 2.

### Test Outputs / Logs

```text
npx jest lib/repositories/__tests__/SystemConfigRepository lib/services/__tests__/GeneratedImageService lib/business-os/llm lib/ai/providers/__tests__ app/api/website/media app/admin/business-os-llm scripts/__tests__/bos-llm-settings scripts/__tests__/check-bos-llm-literals
Test Suites: 50 passed, 50 total
Tests:       1666 passed, 1666 total
Snapshots:   23 passed, 23 total
JEST_EXIT=0   (jest's own exit code, output redirected to a file, no pipe)

npx tsx scripts/check-bos-llm-literals.ts
check-bos-llm-literals: 63 files in scope, 2 exempt, 0 violations
check-bos-llm-literals: passed   (exit 0)
```

### Final Status
- [x] All acceptance criteria pass — ready for commit (once the user has seen the diff)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS.** Post-deploy steps 1 and 2 are still owed.

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Code complete on `fix/gpt-image-1-retirement`, uncommitted, awaiting SA review and QA |
| 2026-10-14 | QA report | QA PASS: 50 suites / 1666 tests green, literal guard clean, one live flare call $0.041425 vs price 0.043 |
| 2026-10-14 | SA code review | Approved with nits; finding 1 (record the prod row move as a guarded migration, or at least its exact SQL) to settle before post-deploy step 1 |
| 2026-10-14 | SA nits F1–F3 applied | Migration 20261061 (number checked free on all branches), xhigh attribution test, Q10 open item; uncommitted pending Offir's approval |
