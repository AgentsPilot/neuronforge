# Business OS — Onboarding Price Parser Fix

> **Last Updated**: 2026-09-18
> **Branch:** `fix/onboarding-price-parser`

## Overview

When onboarding asks "what does X cost?", the answer is parsed by
`OnboardingConversationManager.extractPriceFromMessage`. That parser recorded most prices as 0 (free).
This workplan covers the fix, its tests, and a read-only check of data already saved.

---

## Root cause

The parser kept a list of words meaning "free": `['free', 'חינם', 'gratis', '0', ...]`. It checked
each reply with `trimmed.toLowerCase().includes(p)`. Because `'0'` is in the list and the check
matches substrings, any reply containing the digit 0 returned price 0 before the number was
parsed: "100", "150", "250 ILS", "₪1,200". "175" worked only because it has no zero. `'free'` has
the same problem in a milder form: "freelance rate 90" was read as free. The SA verified this
root cause on 2026-09-18.

---

## Fix

**File:** `lib/services/OnboardingConversationManager.ts`

| # | Change | Status |
|---|--------|--------|
| 1 | Remove `'0'` from the free-word list. Treat zero as free only when the whole reply, with currency removed, is zero (`^0+(\.0+)?$`), e.g. "0", "$0", "0 ₪", "0.00". | ✅ |
| 2 | Match free words as whole words or phrases with Unicode-aware bounds (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`). JS `\b` cannot bound Hebrew. The list covers English, Hebrew and Spanish, the three onboarding languages. | ✅ |
| 3 | Currency-word stripping uses the same Unicode bounds, so Hebrew currency words ("0 שקל") are actually removed. | ✅ |
| 4 | Number regex starts on a digit (`\d[\d,]*`), so a stray comma ("ok, 100") is no longer taken as the number. | ✅ |
| 5 | The parser's three log lines (the parser's two and the caller's warn at the `need_price` branch) log `messageLength` and the parsed value, never the raw text. This covers part of OI-7. | ✅ |
| 6 | Module-level `FREE_PRICE_WORDS`, `PRICE_CURRENCY_WORDS` and `containsWholeWord`, placed next to `needsAPrice`. | ✅ |

**Not changed:** the number parsing for replies that aren't free, and how the result is written to services (`needsAPrice` guard).

**Known behaviour kept:** a reply containing a free word plus a number ("free, then 200") still returns 0, as before. The question asks the price of one service, so this is an edge case.

---

## Tests

**File:** `lib/services/__tests__/OnboardingConversationManager.price.test.ts`

- Table-driven cases: "100", "150", "250 ILS", "₪1,200", "1,000", "175", "0", "$0", "0 ₪", "free", "it's free", "freelance rate 90", "חינם", "בחינם", "gratis", "gratuito", plus decimal, Hebrew-currency and no-price cases.
- An OI-7 guard asserts that no log call carries `message` or the raw text, only `messageLength`.

Command: `npx jest lib/services/__tests__/OnboardingConversationManager`. Result: 2 suites, 47 tests pass.

---

## Existing data check (read-only)

Onboarding services are saved in `scheduling_services.price` by `app/api/onboarding/build/route.ts`.
Nothing on the row marks it as coming from onboarding: `source` defaults to `'manual'`. To find
onboarding services, match on user plus lowercased service name against
`business_profiles.extracted_data.services`, and use `created_at` relative to the profile build as
a second signal. **Not run: on 2026-09-19 the user decided not to check or correct existing data.**

---

## Out of scope / follow-ups

- OI-7 (the remaining raw-message log lines) was fixed separately on main (`d23e946d`).
- Onboarding-created services carry no provenance marker (`source` stays `'manual'`). A `source: 'onboarding'` value would make future corrections exact.

---

## SA Review

**Code Review by SA — 2026-09-18**
**Status:** ✅ APPROVED WITH NOTES. No changes required before QA.

### What was verified

| Check | Result |
|---|---|
| Root cause fixed | ✅ `'0'` removed from the free list. Free words now match as whole words only. "100", "250 ILS", "₪1,200", "freelance rate 90" parse correctly (tests plus SA probe). |
| Zero-only-when-whole-reply | ✅ `^0+(?:\.0+)?$` runs on the text after currency is removed. Note: a reply that *starts* with 0 ("0 for kids, 100 adults") still returns 0 through the number fallback, because `parsed >= 0` accepts 0. That is an explicit zero, so it is acceptable. The whole-reply rule mainly decides which log line is written. |
| Unicode regex vs `target: ES2017` | ✅ TS 5.9.3 raises target diagnostics only for some regex features. A control regex with a named group raised TS1503 under ES2017. The `PRICE_CURRENCY_WORDS` literal (lookbehind + `\p{L}` + `u`) raised none. The project `tsc -p` reports no errors in this file. SWC passes regex literals through without downlevelling. Node 22 / V8 has supported lookbehind and property escapes since Node 10. The module is server-only (imported only by `app/api/onboarding/{build,chat}/route.ts`), so browser support is not a concern. Lookbehind is already used elsewhere in server code (`lib/pilot/StepExecutor.ts`). The `containsWholeWord` regex is built at runtime via `new RegExp`, so TS never checks it. |
| Escaping in `containsWholeWord` | ✅ Metacharacters are escaped. Inputs are a constant list with no user-supplied patterns, so there is no ReDoS surface. |
| Hebrew / Spanish coverage | ✅ Adequate for v1. `ש״ח` with a real gershayim (U+05F4) is not in the currency list, but "0 ש״ח" still returns 0 through the number fallback. |
| Logging / OI-7 | ✅ The parser's two log lines and the caller's `need_price` warn now log `messageLength` + `extracted` only. The test asserts this. No `console.*` in the file. |
| Tests | ✅ 47/47 pass (both OnboardingConversationManager suites). The table covers the regression, zero forms, all three languages, substring false positives and the null path. The private-method cast is commented. |
| Standards | ✅ No DB, API-boundary or LLM changes. No new patterns. Module-level constants sit next to `needsAPrice`. |

### Code Review Comments (non-blocking)

1. `lib/services/OnboardingConversationManager.ts` `FREE_PRICE_WORDS`: `'nothing'` as a whole word gives false "free" results for hedged replies ("nothing fixed yet", "not sure, nothing decided"). It was in the old list too, so this is not a regression. Consider dropping it or matching only the whole reply. **Priority: Low**
2. Same list: common variants are missing: `בלי תשלום` (returns null, so the owner is simply asked again, which is safe), Spanish `nada`. Because the result is null rather than a wrong price, this is a UX gap, not a data bug. **Priority: Low**
3. Pre-existing, not introduced here: decimal-comma / dot-thousands locales parse wrongly. "80,50" gives 8050 and "1.200" gives 1.2. This matters for Spanish-speaking owners. Log it as a follow-up alongside the provenance item. It does not block this fix. **Priority: Medium (follow-up)**
4. Pre-existing: the first number wins ("60 minutes 200" gives 60). Out of scope. Record it only if QA sees it in real transcripts. **Priority: Low**

### Optimisation Suggestions

- Add "0 for kids, 100 adults" (currently 0) and "nothing fixed yet" to the test table as *documented* behaviour, so a future change to either is deliberate.
- The existing-data check (read-only `price0.ts`) is still pending the user's go-ahead. Corrupted rows (`price = 0` on onboarding-created services) are the real user impact of this bug, so the result must be recorded here before the cycle closes.

### Code Approved for QA: Yes

## QA Report

**QA — 2026-09-18**
**Test mode:** full
**Strategy used:** A (Jest unit, table-driven parser) + B-style (Jest, `processUserMessage` with the provider factory and logger mocked, as the attribution test does). No DB, API or UI surface changed, so E2E is not needed.
**Focus:** api (parser + caller branch), security (OI-7 logging)
**Skipped:** existing-data check (`price0.ts`) — it is read-only against the live DB and still needs the user's go-ahead
**Input source:** prompt keywords

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Prices containing a zero parse as numbers ("100", "250 ILS", "₪1,200", "1,000", "200 שקל") | ✅ | Pass | Table test plus probes |
| The new table would have FAILED on the old code | ✅ | Pass | Old logic re-implemented in a throwaway test: **14 of the 34 rows fail** (every zero-containing price → 0, "freelance rate 90" → 0, "nothing fixed yet" → 0, plus the new words `בלי תשלום`, `gratuito`, `Nada.` → null). Throwaway file deleted. |
| Zero is free only as the whole reply, currency aside | ✅ | Pass | "0", "$0", "0 ₪", "0 ש״ח", "ש״ח 0", "0nis", "00", "000", "0.0", "0,00" → 0 |
| Free words match whole words only, EN/HE/ES | ✅ | Pass | "freeze 50" → 50, "carefree 80" → 80, "freestyle class 120" → 120 |
| `nothing` / `nada` only as the whole reply (post-SA edit) | ✅ | Pass | "nothing", "Nothing.", "Nothing!!!", "nothing...", "NADA", "nada!!", "nada ₪" → 0. "nothing fixed yet", "nothing?", "nothing :)" → null. |
| `בלי תשלום` (post-SA edit, not seen by SA) | ✅ | Pass, with one edge case | "בלי תשלום", "בלי תשלום!", "בלי תשלום בכלל" → 0. "בלי-תשלום", a double space, "בלי תשלומים" → null, so the owner is asked again (safe). "200 בלי תשלום נוסף" → 0: see Edge Case 1. |
| Caller path: `service_details` + `need_price` | ✅ | Pass | "250 ILS" → 250, "free" → 0, "₪1,200" → 1200, "100" → 100, "בלי תשלום" → 0, written only to services with no price. The `sale_mode: 'proposal'` service keeps no price. A service that already had a price (40) is untouched. `pendingQuestion` becomes `more_services`, no LLM call. **Added permanently** as a 2-case `it.each` in `OnboardingConversationManager.price.test.ts`. |
| OI-7: no raw text in the parser / `need_price` logs | ✅ | Pass | Existing unit guard, plus a probe: no captured log carried the probe text |
| Type safety | ✅ | Pass | Full `tsc --noEmit -p tsconfig.json`: 2045 errors repo-wide (pre-existing), **0** in `OnboardingConversationManager.ts` or either test. `npm run typecheck:bos-llm`: 132 files in scope, 30 baseline, **0 new**. The new price test is in the gate's scope as a caller. |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. A 200k-character reply parses in about 5 ms. A 300k-character reply full of "freex" also takes about 6 ms. The free-word regexes are built from a constant list and have no nested quantifiers.

#### Edge Cases (nice to fix, Low unless noted)

1. **A free phrase with a price in the same reply returns 0.** "200 בלי תשלום נוסף" ("200, no extra charge"), "200 ₪ ללא תשלום נוסף", "150, no charge for parking", "150 free parking", "not free, 200", "is it free?" all return 0. The workplan already notes this as kept behaviour, and the old code returned 0 for all of these too. But the post-SA `בלי תשלום` adds one more realistic Hebrew phrasing that hits it ("…בלי תשלום נוסף" is common). Suggested follow-up: if the reply has a non-zero number, let the number win over a free phrase. That reverses the documented rule, so it needs a decision. — Low
2. **"-50" → 50.** The sign is dropped, and a negative reply becomes a positive price. The old code returned 0. It is very unlikely in practice. — Low
3. **Pre-existing number formats** (SA note 3, confirmed): "80,50" → 8050, "1.200" → 1.2, "1 200" → 1, "60 minutes 200" → 60, "1e5" → 1, ".5" → 5. Arabic-Indic digits ("١٠٠"), "zero" and "אפס" → null (asked again). — Medium follow-up for "80,50" / "1.200" (Spanish locale); the rest Low
4. **Uncovered synonyms return null** (safe, the owner is asked again): "no cost", "בלי עלות", "אין תשלום", "🆓". — Low

#### Observation (pre-existing, outside this fix)

- **An unparseable price reply does not ask again, despite the code comment.** When the parser returns null, the branch falls through to `checkIfUserHasMoreServices`, which matches "no" as a substring. So any reply containing "no" / "not" / "nothing" (e.g. "not sure yet", "nothing fixed yet") is read as "done adding services". Onboarding then moves on to `client_acquisition`, and the service keeps a null price. This was confirmed in a throwaway caller test. It is not caused by this fix, and a null price is safer than the old wrong 0. But the comment "ask again (fall through to normal flow)" is inaccurate. Recommend a follow-up ticket: whole-word matching in `checkIfUserHasMoreServices`, or an explicit re-ask when `need_price` gets no price. — Medium follow-up

### Test Outputs / Logs

```text
npx jest lib/services/__tests__/OnboardingConversationManager
PASS lib/services/__tests__/OnboardingConversationManager.attribution.test.ts
PASS lib/services/__tests__/OnboardingConversationManager.price.test.ts
Tests:       54 passed, 54 total   (52 on arrival, after the post-SA rows; +2 caller-path cases added by QA)

Old-logic replay of the table: OLD FAILS (14/34)
  "100" old=0 exp=100 | "250 ILS" old=0 exp=250 | "₪1,200" old=0 exp=1200 | "freelance rate 90" old=0 exp=90 ...

npm run typecheck:bos-llm
typecheck-bos-llm: 132 files in scope, 30 errors, 0 new (71.7s)
typecheck-bos-llm: passed
```

Environment note: this worktree has no `node_modules` of its own, so `tsc` fails to find `@types/jest` / `@types/node` (TS2688), and the gate reports about 2,100 spurious errors. For the type runs, QA temporarily junctioned the main checkout's `node_modules` into the worktree and removed it afterwards. Nothing else was changed. Both throwaway test files were deleted.

### Final Status

- [x] All acceptance criteria pass — ready for commit (no High/Medium bugs in the change. Edge cases and the pre-existing fall-through are follow-ups.)
- [ ] Issues found — Dev must address before commit

Still open before the cycle closes (not a commit blocker): the read-only existing-data check needs the user's go-ahead.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-18 | Created | Fix, tests, data-check approach |
| 2026-09-18 | SA code review | Approved with notes; approved for QA |
| 2026-09-18 | QA | PASS; caller-path test added; edge cases and pre-existing need_price fall-through logged as follow-ups |
| 2026-09-19 | User approval | Code approved. Existing-data check dropped by user decision. OI-7 follow-up removed (fixed on main in `d23e946d`). |
