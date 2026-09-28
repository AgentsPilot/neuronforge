# Workplan: Admin guard hardening (F-2, OI-21) and a runnable lint entry point

> **Last Updated**: 2026-09-24

**Developer:** Dev
**Branch:** `fix/admin-guard-hardening-and-lint` (created by RM, off `origin/main` `a34f2572`)
**Requirement:** none — three review findings carried out of [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md) §5.3b (F-2), §5.3d (OI-21 and the three surviving shapes) and §5.3c / DEF-S2-6 (lint)
**Date:** 2026-09-24
**Status:** Code Complete — **SA rounds 1 and 2 plus the QA round addressed in full** (§QA round — D1–D10). ⚠️ **PR #104 was MERGED (`d45a6cca`, 2026-09-24) WITHOUT the D1/D2, D3, F1 and F2 fixes** — see [Correction of record](#correction-of-record--104-merged-without-these-fixes). They land on the follow-up branch `fix/admin-guard-scanner-followup`, so **every statement below that treats them as closed on `main` is wrong until that branch merges**. **SA rounds 1 and 2 addressed in full** (§SA round 1, §SA round 2). **Hardening is CLOSED by SA's instruction** — see [The finding of record](#the-finding-of-record--stop-hardening-this-parser). Awaiting the user's review, then QA, then RM. **Not committed.**

---

## Correction of record — #104 merged without these fixes

> **Written 2026-09-25, after the fact.** PR **#104 merged at 2026-09-24 19:21 UTC as `d45a6cca`
> — before the D1/D2, D3, F1 and F2 fixes were pushed.** What landed on `main` is the parsed
> guard at **106 tests**. What did **not** land is any of the scanner fixes this document
> describes. **Read every section below with that correction applied: wherever one says a gap is
> closed, or closed "for `main`", it is describing the follow-up branch
> `fix/admin-guard-scanner-followup` (119 tests), not the merged state.**

**What is true of `main` right now** — read off the committed files, not reasoned:

| Gap | Where it lives on `main` | Consequence |
|---|---|---|
| **The apostrophe bypass (D1/D2)** | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:466` — `stripComments` still opens with `const scaffold = blankStringLiterals(source)`, so **strings are blanked before comments are found** | A one-line block comment containing an apostrophe (`/* the admin user's list */`) swallows its own `*/`; the comment never closes and the scan deletes real code up to the next `*/` anywhere later in the file. QA hid an early return in `app/admin/layout.tsx` this way and got **106/106 green with the admin shell rendered to any caller** |
| **The `build` / `dist` / `coverage` blind spot (D3)** | `SKIP_DIRS` (line 157) is a bare-name set tested at **every depth** by `walk` (line 426) | An unguarded server page at `app/admin/build/page.tsx` and an ungated handler at `app/api/admin/build/route.ts` are **invisible to the required check**, while byte-identical files in normally-named directories fail it. `build` is an ordinary route segment |
| **Truncated input** (the consequence of the first) | the same `stripComments` | **36 files / 62,594 characters** deleted from the corpus the guard scans. `lib/repositories/BusinessProfileRepository.ts` loses **97%** of its content; `enforceContentLevel.wp24.test.ts` loses **all 8,529** characters. **R1–R5 are deciding on mangled source in production CI today**, and a `profiles.role` access decision has been demonstrated disappearing from R4's input |

**So a green `Admin authz surface guard` on `main` is weaker than it looks, and has been since #104
merged.** None of it is a regression #104 introduced — the precedence inversion and the skip list
are both **inherited**, byte-identical, from before it. #104 made them load-bearing by making the
guard required.

**The follow-up branch closes all three**, and because the fix lands inside the required check,
merging it is what makes this document's claims true of `main`. Nothing else about #104 is
retracted: the parsed guard, R8, the caps and the ratchet all merged and all stand.

## Overview

Three fixes on one branch so they can be reviewed and committed together. Two of them change `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, which backs **`Admin authz surface guard` — a REQUIRED status check on `main`**. A wrong change there turns `main` red for every PR in the repo, so every assertion added below is mutation-proved in both directions (it fails on the mutation, it passes on the real tree), and the equality caps and ratchet are re-verified untouched.

---

## The finding of record — 🛑 STOP HARDENING THIS PARSER

> **The durable fix is BEHAVIOURAL: one test that renders `AdminLayout` as a non-admin and asserts the redirect. That test should LEAD the parked admin-authz work — not a v7 of this parser.**

This is SA's conclusion after five rounds on one assertion, and it is written here as the finding of record because **the next person's instinct will be another regex.**

The history is the argument:

| Round | What was closed | What it cost |
|---|---|---|
| 1 (F-1) | a substring match defeated by a comment | — |
| 2 (DEF-S2-1/2) | try/catch and early return | — |
| 3 (SA slice-2 re-check) | `&&`, ternary, shadowed no-op | — |
| 4 (SA branch review) | a decoy **signature** in a template literal | **four false positives** on correct code |
| 5 (SA re-check) | a decoy **import** in a template literal, plus nested templates | **one more false positive** (hand-wrapped bindings) |

Every round closed a real hole **and opened a way to reject correct code**, which is the more dangerous failure: a required check that fails a correct file gets switched off. Rounds 4 and 5 were the same defect class twice — a predicate reading unblanked source — found in a different predicate each time. A textual rule cannot be finished, only extended.

A rendering test is immune to all twelve known shapes and to the thirteenth, and does not care how the call is written. **It is recorded in the module header, on OI-20, and here. If you arrived because you found a twelfth shape: write that test instead.**

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [Task List](#task-list)
5. [Mutation Evidence](#mutation-evidence)
5b. [SA round 1 — the four findings](#sa-round-1--the-four-findings)
5c. [SA round 2 — the import decoy](#sa-round-2--the-import-decoy)
5d. [Incident — the admin doc was blanked](#incident--the-admin-doc-was-blanked-and-the-tooling-reported-success)
5e. [QA round — D1–D10, and the provenance answer](#qa-round--d1d10-and-the-provenance-answer)
5f. [SA final re-check — F1 and F2](#sa-final-re-check--f1-and-f2)
5g. [Correction of record — #104 merged without these fixes](#correction-of-record--104-merged-without-these-fixes)
6. [Decisions taken rather than instructed](#decisions-taken-rather-than-instructed)
7. [Lint: the true state of the repo](#lint-the-true-state-of-the-repo)
8. [Gates](#gates)
9. [SA Review Notes](#sa-review-notes)
10. [QA Testing Report](#qa-testing-report)
11. [Commit Info](#commit-info)

---

## Analysis Summary

| Item | What it touches |
|---|---|
| **F-2** | R6 of the required guard suite asserts `toContain('requireAdminPage')`, which the **import line** satisfies. SA reproduced a green run with the call deleted (M1, §5.3b). Slice 2 already solved this for one file with a **first-statement** property (`app/admin/business-os-llm/__tests__/source.guard.test.ts:166`), proved against five synthetic layouts. Two callers now need it, so it is extracted once and imported twice. |
| **OI-21** | A crafted `Next-Router-State-Tree` header returns **200 with `requireAdminPage()` never running**. Containment rests on (a) all 22 `/admin` pages being `'use client'` with no server props and (b) every admin API being gated. (a) is hand-verified only, it breaks silently, and the guard's scanner **already computes `isClient`** (`:789`). Assert (a). |
| **lint** | `next lint` on Next 14 ignores `eslint.config.mjs` and drops into the interactive setup wizard — reproduced below. The repo therefore has **no working full-lint entry point**, the second time a broken one has hidden findings here (the first was `eslint.config.js` shadowing the flat config, PR #76). |

## Implementation Approach

### F-2 — one shared first-statement assertion, two callers

The property stays slice 2's: **the guard call is the first statement of `AdminLayout`'s body**, with the statement terminated at `;` **or** `{` (so a `try {` opener *is* the first statement and fails) and `null` — itself a failure — when the signature cannot be found.

It moves to `tests/helpers/admin-page-guard.ts`, beside the existing `tests/helpers/bos-llm-literal-rules.ts` precedent (slice 2's D-6, extracted at its third caller). `tests/` is **not** a `TS_SCAN_ROOTS` entry, so the helper's synthetic fixtures — which contain every forbidden shape by construction — cannot be read by the guard that imports them.

Two deliberate strengthenings over slice 2's version, both driven by SA's surviving shapes (see [Decisions](#decisions-taken-rather-than-instructed)):

1. The comment stripper is a **required parameter**, not an internal default. Each caller passes its own already-unit-tested stripper (`stripComments` in the guard suite, `codeOf` in slice 2's). The signature makes "called on raw source" unrepresentable — which matters, because on raw source the `//`-commented mutation passes.
2. The match is **anchored** (`^…$`) against the whole first statement rather than being a substring of it, with an optional leading `const|let|var … =` so the legitimate `const admin = await requireAdminPage();` still passes.

### OI-21 — a new rule R8, over data the scanner already has

Named **R8, not R7**: R7 is reserved in the suite header for the parked inverted rule ("is everything that *behaves* like an admin route gated, wherever it lives?"), and re-using the number would silently retire a documented parked decision.

R8: **every Next.js render entry point under `app/admin/**` is a client component** — over `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error`, not just `page.tsx`, because a nested `layout.tsx` under `app/admin/foo/` renders *inside* the bypassed segment and would leak exactly as a server page would. One structural exception: `app/admin/layout.tsx` itself, which R6 requires to be a Server Component.

It carries an allow-list and an equality cap like every other rule, both at 0, so an exemption cannot be added without signing for it, and floors on the entry count so a renamed directory cannot make the rule vacuous. The failure message states the exploit.

### lint

Replace `next lint` with a direct `eslint` invocation against the flat config, add the build and worktree ignores that `next lint` used to supply, then **measure and report**. No CI wiring in this PR, and no findings fixed.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `tests/helpers/admin-page-guard.ts` | create | The one first-statement assertion plus the mutation fixtures, shared by both suites |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | F-2: R6 uses the shared assertion and runs the mutation table. OI-21: new R8 with its allow-list, cap and mutation proof |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | modify | Drop the local copy and import the shared one — two copies of a security assertion is how they drift |
| `package.json` | modify | `lint` becomes a runnable entry point |
| `eslint.config.mjs` | modify | Ignore build output and agent worktrees, which `next lint` used to supply |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | OI-20's page half and OI-21 are now asserted — record what changed and what did not |
| `docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md` | modify | Point §5.3b's F-2 and §5.3d's two "recorded, not fixed" entries at this branch |
| `docs/workplans/ADMIN_GUARD_HARDENING_AND_LINT_WORKPLAN.md` | create | This file |

## Task List

- [x] ✅ T1 Extract the first-statement assertion and the mutation fixtures to `tests/helpers/admin-page-guard.ts`
- [x] ✅ T2 Point slice 2's suite at the shared module — 54 tests pass, local copy deleted
- [x] ✅ T3 F-2: R6 asserts the first statement, and the mutation table runs inside the required suite
- [x] ✅ T4 Mutation-proved: **eight** shapes (the five instructed plus SA’s three), each FAILS the required check, each reverted
- [x] ✅ T5 SA's three surviving shapes — **all three caught**, see [Decisions](#decisions-taken-rather-than-instructed) D-2/D-3
- [x] ✅ T6 OI-21: R8 added with allow-list, cap 0/0, floors and an exploit-naming failure message
- [x] ✅ T7 Mutation-proved R8 four ways, each reverted
- [x] ✅ T8 Caps and ratchet re-verified — the diff touches no existing exemption or cap
- [x] ✅ T9 `npm run lint` runs; true state measured and reported below
- [x] ✅ T10 Every gate run, output recorded verbatim
- [x] ✅ T11 Docs updated — `ADMIN_IDENTIFICATION_AND_ACCESS.md`, the slice-2 workplan, the workflow header

## Mutation Evidence

Every run is `npm run test:authz-guard` — **the required check itself** — with the mutation applied to the **real** file and reverted immediately after (`git status` verified clean after every sweep). Baseline on this branch: **103 passed / 103**. On `main` before this change: **74 / 74**.

### F-2 — must FAIL (10 shapes, all on the real `app/admin/layout.tsx`)

| Mutation | Before this branch | Now |
|---|---|---|
| The call **deleted** | ✅ green (SA's M1 — the original finding) | **1 failed** / 102 |
| **`//`-commented** out | ✅ green | **1 failed** / 102 |
| **`/* */`-commented** out | ✅ green | **1 failed** / 102 |
| Wrapped in **try/catch** (redirect swallowed) | ✅ green | **2 failed** / 101 |
| Placed **after an early return** | ✅ green | **1 failed** / 102 |
| **`&&`-conditional** (SA, slice-2 re-check) | ✅ green, also under v3 | **1 failed** / 102 |
| **Ternary** (SA, slice-2 re-check) | ✅ green, also under v3 | **1 failed** / 102 |
| **Locally shadowed no-op** (SA, slice-2 re-check) | ✅ green, also under v3 | **1 failed** / 102 |
| **Template-literal decoy**, real call deleted (SA, branch review — finding 1) | ✅ green at 92/92 under v4 | **1 failed** / 102 |
| **Default-valued parameter** shadow (SA, branch review — finding 1) | ✅ green at 92/92 under v4 | **1 failed** / 102 |

### F-2 — must PASS (7 shapes, all correct code, all on the real file)

| Shape | Under v4 | Now |
|---|---|---|
| `const admin = await requireAdminPage();` | ❌ 1 failure (my own over-specified equality) | ✅ **103/103** |
| `const { id } = await requireAdminPage();` | ❌ 1 failure (SA, finding c) | ✅ **103/103** |
| `): Promise<React.ReactElement> {` return type | ❌ 1 failure (SA, finding a) | ✅ **103/103** |
| A block comment line beginning `'use client'` | ❌ 1 failure (SA, finding b) | ✅ **103/103** |
| Arrow component, `export default AdminLayout;` below | ❌ `firstStatement: null` (SA, finding a) | ✅ **103/103** |
| Named function, `export default AdminLayout;` below | ❌ `firstStatement: null` (SA, finding a) | ✅ **103/103** |
| No semicolon (ASI) | — | ✅ **103/103** |

### OI-21 — R8, on real files under `app/admin/`

| Mutation | Expected | Result |
|---|---|---|
| New probe page: **async Server Component** reading a repository | fail | **2 failed** / 101 |
| Same as a **sync** Server Component | fail | **1 failed** / 102 |
| **`'use client'` page beside a server nested `layout.tsx`** | fail | **2 failed** / 101 — the case a `page.tsx`-only rule misses |
| `'use client'` **deleted** from `app/admin/users/page.tsx` | fail | **1 failed** / 102 |
| **Lookalike**: server page whose guard runs **after** a repository read | fail | **2 failed** / 101 |
| **Self-guarding** server page (`await requireAdminPage()` first) | **pass** | ✅ **103/103** |
| An existing admin **page moved out of the tree** | **pass** | ✅ **103/103** — the old `>= 22` floor went red here |

## SA round 1 — the four findings

SA reproduced all 12 of the first round's mutations and confirmed every number, then found four things. All four are fixed; the first two changed the rule's implementation, not only its inputs.

| # | Finding | Fix |
|---|---|---|
| **1** (High) | **A ninth shape: a decoy component signature inside a TEMPLATE LITERAL above the component, real call deleted — 92/92 green, `/admin` unguarded.** `firstStatementOfAdminLayout` matched one signature regex against un-blanked text and took the **first** hit, so it read the decoy's body. **Plus a tenth (Low): a default-valued parameter `requireAdminPage = async () => {}`.** | **Did what R1 already does** rather than inventing a third approach: R1's D-Q1 (`…guard.test.ts:1416`) scans `blankStringLiterals(body)` because a string can make a non-gate look like a gate. That primitive **moved to `tests/helpers/source-scan.ts`** and is now imported by R1 *and* by the page-guard rule — one implementation of "what counts as a string", because a second copy is how two guards drift. The rule also stopped matching a signature and now **parses**: it locates the **default export** (declaration, arrow, or `export default Name;` resolved back to its declaration), paren-matches the parameter list — which is what catches the default-param shadow — and takes the first statement of the body. |
| **2–4** (the false positives) | **(a)** a return-type annotation gave 1 failure; the arrow form and the named-then-default-export form both gave `firstStatement: null`. **(b)** a block comment line beginning `'use client'` gave 1 failure, because `isClient` read **raw** source with `/m`. **(c)** `const { userId } = await …` was rejected even though the regex advertised `{}`. | **(a)** fixed by parsing the default export rather than one signature, plus angle-depth skipping of the return type. **(b)** `SCANNED[].isClient` now reads the **stripped** code through the shared `isClientComponent`, anchored to the start of the file rather than `/m` — fixed at the source, so R6 and R8 both benefit. **(c)** the statement now ends at a `;` **or newline at depth 0**, so a destructuring brace no longer truncates it. **I also found a fourth of the same class in my own code** and fixed it: R6's real-file assertion pinned the literal string `'await requireAdminPage()'`, so the correct `const admin = await requireAdminPage();` failed. `firstStatement` is now echoed on both sides of the equality — it prints on failure without constraining. |
| **The failure message** | It said *"do not relax this assertion… fix the layout"* — the wrong instruction on a correct file, and the likeliest route to someone disabling a required check. | Two messages now. `ADMIN_LAYOUT_GUARD_FAILURE` ends with *"IF YOU BELIEVE THE FILE IS CORRECT: this may be a FALSE POSITIVE in the assertion rather than a fault in your code — the parser lives in tests/helpers/admin-page-guard.ts and documents its limits. Fix the parser and add your shape to GUARDED_ADMIN_LAYOUTS."* And a separate `ADMIN_LAYOUT_UNPARSEABLE`, shown when no default export is found, opens by saying that outcome *"is more likely to be a BUG IN THE ASSERTION than in your file"*. Both still end with "do not weaken or delete the rule, and do not exempt the file". |
| **R8: the floor** | `>= 22` was that day's exact census, so **moving one page out turned a required check red** for a blameless change. | Replaced with the property: **the scanner's view equals the filesystem's** (an independent `walk` of `app/admin` must produce exactly the scanned set), the guard layout is present, and there is at least one page. Proved by moving `users/page.tsx` out of the tree — **103/103, green**, where the count floor went red. |
| **R8: the self-guarding page** | It failed a server page that **guards itself** — the one shape *immune* to the OI-21 bypass, so the rule forbade the safest thing an author could write and pushed them toward the client shape whose safety depends on a property held elsewhere. | R8 gained a **second accepting clause**: server-rendered is fine if the file `guardsItselfFirst`, computed with the **same verdict R6 uses** — so all ten disabling shapes apply to it too. Not an exemption and not allow-listed. Proved both ways on real files: a self-guarding page is **accepted (103/103)**, and a **lookalike whose guard runs after a repository read is rejected (2 failed)**. The message explains the clause. |
| **Corpus ratchet** (SA's request) | The rule and its mutation corpus are co-located with nothing stopping the fixtures being quietly deleted. | `CORPUS_FLOORS = { disabled: 10, guarded: 8 }`, asserted, plus every disabled fixture must name a sub-rule that exists — same spirit as the exemption caps: the corpus may grow, never shrink. |

**Round-1 count:** the required suite went **92 → 103** tests; the screen suite **54 → 61**.

---

## SA round 2 — the import decoy

SA re-ran every gate, confirmed all round-1 fixes on the real file (including the R8 floor, and the self-guarding page accepted while three lookalikes are rejected), and found two things.

| # | Finding | Fix |
|---|---|---|
| **M1** (High) | **An eleventh shape — D-Q1 for the THIRD time.** `importsCanonicalGuard` was the last predicate still reading **unblanked** source. Importing the guard from `@/lib/admin/requireAdminPage.noop` while parking the canonical import text in a template literal gave **103/103 green on the real `app/admin/layout.tsx` with the guard a no-op**. Second order: `blankStringLiterals` did not handle **nested** template literals, which defeats a naive scaffold fix. | The predicate now uses the **offsets contract the parser already relies on**, not another regex: locate `import { … } from` on the **blanked scaffold** (so an import inside a string is invisible), then read the module specifier out of the **original** text by offset via a new `literalSpanAt`. It asserts the local name `requireAdminPage` is bound by **exactly one** import and that its specifier equals the canonical module — "exactly one" because two imports binding one local name is a TS error, so it costs nothing on correct code and removes the canonical-beside-no-op shape. And `blankStringLiterals` is now a **character scanner** with an interpolation stack rather than one alternation: nested templates pair correctly at any depth, `${…}` stays visible as the real code it is, and length/newlines are still preserved — which is what the offsets contract requires. |
| **M2** (Medium) | **A false positive my own round-1 fix created.** The newline-at-depth-0 terminator truncated `const { userId, email } =` / newline / `await requireAdminPage();` → **1 failed / 102** on the real file. There is no Prettier config in this repo, so line breaks are hand-chosen. | A depth-0 newline now terminates the statement **only if the statement is complete**: `continuesOntoNextLine` keeps scanning past a trailing operator, `await`, or an open comma list. ASI remains the default, so the semicolon-less form still works. |
| **M5** (Low) | R8's offender message said "add `use client`", **contradicting R8's own accepting clause** and pushing an author with a correct self-guarding page toward the weaker shape. | The message now names **both** accepted fixes, says option 2 is *immune* to the bypass and why, and warns that the guard must be the **first** statement because a guard after a repository read is still an offender. |
| **Nit** | The false-positive escape hatch sat ~1,000 characters into `GUARD_FAILURE`. | Moved to **sentence two**. `UNPARSEABLE` left as SA judged it right. |
| **Recorded, not chased** (Low) | `export { AdminLayout as default }` and a semicolon-less `export default AdminLayout` report `parsed: false`. | Correct outcome — fails **closed** with `ADMIN_LAYOUT_UNPARSEABLE`, which says the failure is probably a parser gap rather than the author's bug. Neither shape exists in this repo. Written into the module header so the next reader recognises it instead of rediscovering it. |

### Round-2 mutation evidence — all on the real `app/admin/layout.tsx`

Baseline after these fixes: **106 passed / 106** (was 103).

| Mutation | Expected | Result |
|---|---|---|
| **Import decoy**: guard from `…requireAdminPage.noop`, canonical import in a template literal (SA's M1) | fail | **1 failed** / 105 |
| The same decoy inside a **NESTED** template literal (M1, second order) | fail | **1 failed** / 105 |
| The look-alike module alone, no decoy | fail | **1 failed** / 105 |
| Canonical module but the binding **aliased away** (`requireAdminPage as realGuard`) | fail | **1 failed** / 105 |
| **`const { userId, email } =` hand-wrapped onto the next line** (SA's M2) | **pass** | ✅ **106/106** |
| The call itself split across lines | **pass** | ✅ **106/106** |
| A trailing comment after the call | **pass** | ✅ **106/106** |
| Blank lines before the call | **pass** | ✅ **106/106** |
| A backtick inside a comment above the call | **pass** | ✅ **106/106** |

Corpus floors raised to **12 disabled / 9 guarded**, and the attribution assertion now covers the third sub-rule (`importsCanonicalGuard`) — it caught the omission itself when the floors went up, which is the ratchet working.

---

## Incident — the admin doc was blanked, and the tooling reported success

**What happened.** While applying the round-2 edits, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` was left at **zero bytes**. It is the document CLAUDE.md points at for all admin authorization, and it carries OI-20 and the OI-21 `curl` exploit merged in PR #102. The TL caught it and restored it from `origin/main`. **Nothing was lost — but only because the content was already merged.** A doc authored on this branch would have gone.

**Mechanism, exactly.** The edit ran as:

```python
io.open(path, 'w', encoding='utf-8', newline='').write(text)
```

`open(..., 'w')` **truncates the file at open time**, before a single byte of the new content is validated. The `.write()` then raised:

```
UnicodeEncodeError: 'utf-8' codec can't encode characters in position 15546-15547: surrogates not allowed
```

because the replacement text contained a **lone surrogate pair** — a non-BMP emoji written as two separate `\uXXXX` escapes rather than as one character. Python holds that as two unpaired surrogates, which cannot be encoded to UTF-8. So: **target truncated, content never written, file destroyed by an error that happened after the destruction.**

**Why I reported success — the part that matters more than the deletion.** The write was chained into a compound shell command that ended with an `until … done; cat …` gate-reporting block. The traceback went to the **head** of the output; the compound command's exit code came from the **last** command in the chain, which was a successful `cat`. I read the tail, saw five green gates, and reported. **Two independent failures had to line up: a write that can destroy before it validates, and a report that read the wrong end of the output.**

**What changed so it cannot recur the same way:**

| Guard | Detail |
|---|---|
| **Encode before opening** | `tests`-side edits now go through a helper that calls `text.encode('utf-8')` **first**. The exact error that destroyed the file now raises with the target untouched. |
| **Atomic replace** | Content is written to a sibling temp file and moved over the target with `os.replace`. A partial or failed write cannot leave a truncated target. |
| **Refuse-to-write invariants** | A minimum line count and a list of canary strings that must survive. It has already earned itself: it **refused two writes** during the re-apply — once on a miscounted `OI-21` assertion (`grep -c` counts lines, `str.count` counts occurrences) and once on a canary string that was never in the document. Both times the file was left intact and I fixed the check, not the file. |
| **Read-back verification** | The helper re-reads the file and asserts it equals what was intended. |
| **Never chain a write with reporting** | A destructive edit runs as its own command, and its exit code is the command's exit code. |

**The honest residue:** none of this makes an over-wide *replacement* impossible — a bad anchor that matches too much would still be written, because it encodes fine and passes the canaries. What it does stop is the **silent total loss**, and what the numstat sweep below adds is detection: a deletion-without-insertion is now something I check for rather than something I hope did not happen.

**Sweep of the rest of the branch (`git diff --numstat origin/main`), after the restore:**

| File | +/- | Verdict |
|---|---|---|
| `.github/workflows/admin-authz-guard.yml` | 8 / 1 | the removed line is the R6 description I rewrote |
| `.gitignore` | 3 / 0 | additions only |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | 84 / 89 | a rewrite of one block; 256 → 251 lines, ends `});`, 61 tests pass |
| `docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md` | 7 / 1 | additions plus one stray `**` removed |
| `eslint.config.mjs` | 22 / 0 | additions only |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 392 / 31 | 1,585 → 1,946 lines; the 31 removals are the old R6 body and the moved `blankStringLiterals` |
| `package.json` | 2 / 1 | `lint` rewritten, `lint:report` added |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | 33 / 5 | **re-applied additively after the restore**; the 5 removals are single-line rows rewritten in place; OI-21 references 4 → 6, `curl` exploit intact |

**No other deletion-without-insertion anywhere on the branch** (`awk '$1==0 && $2>0'` over the numstat: empty).

---

## QA round — D1–D10, and the provenance answer

QA probed 18 synthetic + 3 real-file bypasses and 18 + 2 false positives: **48 PASS / 10 FAIL / 1 BLOCKED, three High**. The two High findings are **one precedence fix and one scope fix**, and both make the parser *smaller*. Neither is a v7 hardening round.

### ⚠️ The provenance answer — both High findings are INHERITED, and one is a LIVE GAP on `main`

The TL asked whether D1's truncation is new here or already true of `origin/main`. **Measured, not reasoned** — `origin/main`'s `stripComments` and `blankStringLiterals` were lifted verbatim out of the committed guard test and run over the same 2,524-file corpus, compared against a reference stripper:

| `stripComments` version | Files truncated | Characters deleted |
|---|---|---|
| **`origin/main` (committed, today)** | **36** | **62,594** |
| this branch, after the precedence fix alone | **27** | **1,840** |
| this branch, after the precedence fix **and** the regex state | **0** | **0** |

> ⚠️ **These numbers replace the ones first reported on this branch (16 / 64,700 and “0 / 0”), and the correction is SA's F1.** The original reference stripper was hand-written and had **no regex-literal state — the same blind spot as the implementation**, so it scored a fix that was still broken as perfect. A reference that can agree with the bug is not a reference.
>
> The figures above come from an oracle built on **TypeScript's own parser**, which has already resolved regex-vs-division, JSX and template interpolation. It is validated by identity: on sources containing no comments — plain, template, JSX, a regex containing `/*`, division, and CRLF — its output equals its input byte for byte. Against it, SA's 28 files / 1,952 characters reproduces as **27 / 1,840** (the small delta is CRLF accounting and one excluded file), which is the independent confirmation that matters.

**So yes: `main`'s required check is deciding on truncated source right now.** Worst case on `main` is `lib/repositories/BusinessProfileRepository.ts`, which loses **35,397 of its 36,422 characters — 97% of the file**; `enforceContentLevel.wp24.test.ts` loses **all 8,529**. R1–R5 have been scanning mangled input in production CI, not only here — which makes this a **live gap in the merged guard**, not a defect this branch introduced.

Two honest qualifications:

* **This branch AMPLIFIED it** before fixing it. The round-2 `blankStringLiterals` scanner is *more* correct about templates, and a more accurate blanker feeding a wrongly-ordered stripper truncates more, not less. QA measured 234 files / 192,936 characters; my 230 / 226,111 is the same finding under a slightly different reference. **Either way the amplification was mine and the root cause was not.**
* **D3 is inherited with no amplification at all.** `origin/main` has the byte-identical `SKIP_DIRS` set and the byte-identical `walk`, so `app/admin/build/page.tsx` and `app/api/admin/build/route.ts` are invisible to the merged guard today exactly as they were here.

**Both therefore matter beyond this PR.** They are fixed here, and because the fix lands in the required check, merging this branch closes them for `main` too.

### The fixes

| # | Finding | Fix |
|---|---|---|
| **D1 + D2** (High) | **A precedence inversion.** `stripComments` blanked **strings before finding comments**, so an apostrophe inside a one-line block comment opened a phantom string, swallowed the closing `*/`, left the comment unclosed, and deleted real code up to the next `*/` anywhere later in the file. QA hid an early return in `app/admin/layout.tsx` that way: **106/106 green with the admin shell rendered to any caller**. The same flaw failed correct files — the layout's own comment reflowed to one line, and `/* the admin user's list */` above `'use client'` in the real `app/admin/users/page.tsx`. | `stripComments` **moved to `tests/helpers/source-scan.ts` and rewritten as one left-to-right pass that recognises comments BEFORE strings.** Inside a comment a quote is just a character; inside a string `//` is two characters. Neither construct is discovered by reading a text the other has already rewritten. Four regression unit tests added beside the existing ones, including the line-count invariant. **The precedence fix alone was not enough — see F1 below.** |
| **D3** (High) | **`SKIP_DIRS` matched a bare directory NAME at every depth**, so any `build`, `dist` or `coverage` directory was invisible: an unguarded server page at `app/admin/build/page.tsx` and an ungated handler at `app/api/admin/build/route.ts` both passed 106/106, while identical files elsewhere went red. `build` is an ordinary route segment. R8's walk-equality could not catch it because **both sides called `walk`**. | Split by **where**, not just by name: `SKIP_ANY_DEPTH` (`node_modules`, `.git`, `.next`, `.claude`) versus `SKIP_AT_ROOT_ONLY` (`dist`, `build`, `coverage`, `out`, `.vercel`), the latter skipped only when the directory is a child of the repo root. And R8's second side is now `listEveryFileUnconditionally`, which **shares no code with `walk`** and applies no skip list at all — so a skip-list bug shows up as a mismatch instead of cancelling out. Asserted as a rule (the two sets must not overlap; the root-only names must not be skipped at depth), plus an assertion that the two sides really are independent. |
| **D4** (Medium) | R8 rejected a **correct self-guarding page** written `export { X as default }`, and its message had no parser hatch. | The parser accepts `export { Name as default }` as well as `export default Name`, with or without the semicolon. R8's message gained the same hatch the layout rule has: if you believe the file is already correct, this may be a false positive in the parser — extend it, never delete the assertion. |
| **D5** (Medium) | The real-page false positive. | **Confirmed it falls out of the D1 fix** — `/* the admin user's list */` above `'use client'` in the real `app/admin/users/page.tsx` now gives **112/112**. |
| **D6** (Low) | Stale lint census. | Refreshed to QA's post-merge measurement below. |
| **D7** (Low) | Screen-suite count stale. | Re-measured; both suites now **176 tests** together. |
| **D8** (Low) | The alias rejection was unrecorded. | Recorded in the module header: `import { requireAdminPage as guard }` is rejected because the first statement then reads `await guard()`. A known limit with the hatch message, not a silent one. |
| **D9** (Low) | `typeof requireAdminPage` in a parameter TYPE read as a shadow. | Type-only references are stripped before the binding test — a reference is not a binding. A real default-valued parameter still fails. |
| **D10** (Low) | The guarded floor was paddable with duplicates. | Floors now count **distinct sources**, and distinctness of both sources and names is asserted. |

### Real-file evidence, after the fixes

| Shape | Expected | Result |
|---|---|---|
| D1 bypass: apostrophe comment + early return in the real layout | fail | **1 failed** / 111 |
| D3: unguarded server page at `app/admin/build/page.tsx` | fail | **2 failed** / 110 |
| D3: ungated handler at `app/api/admin/build/route.ts` | fail | **1 failed** / 111 |
| D2 false positive: the layout's own comment reflowed to one line | **pass** | ✅ **112/112** |
| D2/D5 false positive: apostrophe comment above `'use client'` in the real `app/admin/users/page.tsx` | **pass** | ✅ **112/112** |
| D4 false positive: self-guarding page via `export { X as default }` | **pass** | ✅ **112/112** |
| D9 false positive: `typeof requireAdminPage` in the params type | **pass** | ✅ **112/112** |

**Confirmed clean by QA and not re-litigated here:** R1–R5 and every cap and exemption untouched; R8's caps genuinely 0/0; all three corpus ratchets bite; the workflow diff is comment-only so the required check keeps its identity; the false-positive hatch really is sentence two; the admin doc intact with both `curl` blocks; no deletion-without-insertion anywhere.

---

## SA final re-check — F1 and F2

SA approved **one PR, not two**, and ruled it **safe in front of a required check**, with one condition. It re-ran everything, reproduced every real-file result, and added three probes of its own: a root-only skip name at depth (`app/admin/dist/page.tsx`) is caught **2/110**, and nested templates, regex literals and a CRLF copy of the whole file all pass with no new false positive.

| # | Finding | Resolution |
|---|---|---|
| **F1** (High, the condition) | **The precedence fix was correct but incomplete: no REGEX-LITERAL state.** `/[/*]/` still opened a phantom block comment, deleting everything to the next `*/`. SA demonstrated a `profiles.role` decision vanishing from R4's input and `AnswerRenderer.ts` losing 22,686 of 40,701 characters. **And it corrected a number I reported**: my "0 files / 0 chars" was measured against a reference that shared the blind spot. | **One more state in the same left-to-right pass**, as instructed — no restructure. A `/` starts a regex only where an expression may start (not after an identifier, literal, `)` or `]`), with a carve-out so TSX's `</div>` is not a regex opener, and a regex that finds no closing `/` before the newline is treated as division — the conservative direction. Re-measured against the **parser-based** oracle: **27 files / 1,840 characters before, 0 / 0 after.** Seven regression tests added: the regex-with-comment-opener, SA's `profiles.role`-after-regex shape, division, the JSX closing tag, both template cases, and CRLF. |
| **F2** (Medium) | `stripComments` lacked the `${}` awareness `blankStringLiterals` has, so a comment inside a template interpolation survived into the scanned text — which for R1 means a `requireAdmin(` written in a comment could read as a gate. SA: *"**one scanner, two outputs** is the real answer, rather than two scanners that must agree."* | **Taken, because it was contained** — the interpolation stack is the same shape of change as F1's regex state: one more state in the pass already being edited, no restructure, and it is proved by the same parser oracle scoring **0 / 0** (the oracle strips interpolation comments, so any divergence would have shown). Two tests pin both directions: a comment inside `${…}` is stripped, template TEXT is left alone. **SA's "one scanner, two outputs" is NOT done and is recorded as the next step**: `stripComments` and `blankStringLiterals` remain two passes that must agree, and unifying them is a restructure of the primitives behind a required check — the right change, and the wrong moment. |

**This branch is now closed to further hardening.** No more shapes, no more rounds — the durable fix remains the behavioural test recorded at the top of this document.

---

## Decisions taken rather than instructed

| # | Decision | Why |
|---|---|---|
| **D-1** | **The shared module lives in `tests/helpers/`, and the comment stripper is a required parameter rather than a default.** | `tests/` is not one of the guard's `TS_SCAN_ROOTS`, so the helper's synthetic fixtures — which contain every forbidden shape by construction — cannot be read by the guard that imports them. The stripper is a parameter because on **raw** source the `//`-commented mutation PASSES (the comment carries its own `;`), so a defaulted stripper would let a future caller be silently wrong. Each suite passes the stripper it already unit-tests. |
| **D-2** | **SA's `&&` and ternary shapes: CAUGHT, not recorded.** The first statement must now **be** the guard call (anchored `^…$`), not contain it. | Both shapes make the guard skippable at runtime — a guard that runs only when an env var says so is not a guard. Catching them cost one anchor. **The anchor deliberately permits an optional `const\|let\|var … =` prefix**, because `requireAdminPage()` returns the admin's identity and `const admin = await requireAdminPage();` is a correct future edit; rejecting it would turn `main` red for every PR in the repo. |
| **D-3** | **SA's locally shadowed no-op: CAUGHT, by a different sub-rule.** The verdict also requires `requireAdminPage` to be imported from `@/lib/admin/requireAdminPage` and forbids a local declaration of that name. | A first-statement rule cannot catch this — the first statement is literally correct. Note the shape is only *writable* if the import is removed or renamed (a local `const requireAdminPage` beside the import is a TS redeclaration error), so requiring the canonical import is the load-bearing half; the no-local-declaration check is the belt to that braces. |
| **D-4** | **SA's ruling that the durable fix is behavioural is recorded, not discharged.** No rendering test was added. | SA is right that this is the fourth regex round. But F-2 is specifically "the **required** gate is weaker than the local suite", and the proportionate fix is to raise the gate to the level slice 2 had already reached. Introducing a rendering test — mocking `getUser`, `AdminAccessService` and `next/navigation`, importing JSX — into a pure static-scan suite that gates **every merge in the repo** is a materially riskier change than the one it replaces. The ruling is copied verbatim into the shared module's header so the next person meets it, and it stays with OI-20. |
| **D-5** | **The OI-21 rule is numbered R8, not R7.** | R7 is reserved in the suite header and in `ADMIN_IDENTIFICATION_AND_ACCESS.md` for the parked *inverted* rule. Taking the free number would have retired a documented parked decision by accident. |
| **D-6** | **R8 covers every render entry point, not just `page.tsx`** — `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error`. | The header bypass skips the **`/admin` layout segment**; everything deeper still renders on the server. A nested `app/admin/foo/layout.tsx` would therefore leak exactly as a server page would, and a `page.tsx`-only rule would miss it. None of those files exists today, which is precisely when the rule is cheap. Mutation-proved with a client page beside a server nested layout. |
| **D-7** | **`app/admin/layout.tsx` is excluded from R8 by a named path in the rule body, not by an allow-list entry.** | R6 *requires* it to be a Server Component, so it is a structural exclusion, not an exemption. Putting it in `R8_PARKED` would make a permanent architectural fact look like a parked hole, which is the confusion the suite's own PARKED/PERMANENT split exists to prevent. `R8` is therefore capped at **0/0** and asserted genuinely zero. |
| **D-8** | **`archive/` was NOT added to the ESLint ignores, even though `tsconfig.json` excludes it.** | Ignoring it would drop errors **420 → 253** and remove the only fatal parse error — which is exactly why it is a decision for SA and the user rather than one to take silently inside a lint-plumbing fix. Hiding findings behind an ignore is the failure mode this task exists to correct, twice over. Recorded in [Lint](#lint-the-true-state-of-the-repo) as the single cheapest scope question, and **SA's ratchet order is now recorded there** so the next person does not rediscover it. |
| **D-9** | **`npm run lint` fails on errors only; `--max-warnings 0` was not adopted.** | There are 9,909 warnings against 420 errors. `--max-warnings 0` would make the exit code permanently red and destroy the only signal the entry point has. A second script, **`npm run lint:report`**, always exits 0 and writes `.eslint-report.json` (gitignored) — that is the run-and-report half. Neither is wired into CI, as instructed. |

## Lint: the true state of the repo

### What was broken

`next lint` on Next 14 **ignores `eslint.config.mjs` entirely** and drops into the interactive setup wizard:

```
$ npx next lint < /dev/null
? How would you like to configure ESLint? https://nextjs.org/docs/basic-features/eslint
❯  Strict (recommended)
   Base
   Cancel
next lint exit=1
```

It lints **nothing**, in either direction — no findings, and an exit code that says "failed" for a reason unrelated to the code. This is the **second** broken lint entry point in this repo: `eslint.config.js` shadowed the flat config until 2026-09-20 (PR #76), and `npm run lint` silently checked one file.

### The fix

| Change | Detail |
|---|---|
| `package.json` | `"lint": "eslint ."` — plus `"lint:report": "eslint . --format json --output-file .eslint-report.json \|\| true"`, which always exits 0 |
| `eslint.config.mjs` | An `ignores` block: `.next/`, `out/`, `build/`, `dist/`, `coverage/`, `public/`, `.vercel/`, `.claude/`, `next-env.d.ts`, `**/*.min.js`. Flat config's defaults are only `node_modules/` and `.git/`, so without this the lint walks build output and the agent worktrees — `next lint` used to supply these |
| `.gitignore` | `.eslint-report.json` |

### Measured state — `npm run lint`, whole repo, 2026-09-24

**3,168 files linted · 409 errors · 9,899 warnings · 1 fatal parse error · exit 1** (QA re-measured after the `main` merge; my pre-merge run was 3,165 files / 420 errors / 9,909 warnings). `no-console` reproduces exactly at **4,658 / 410**. The per-rule table below is the pre-merge run and is within a handful of each rule; it is kept because the shape of the backlog, not the exact count, is what the ratchet order depends on.

| Rule | Severity | Count |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | warning | 7,624 |
| `@typescript-eslint/no-unused-vars` | warning | 1,758 |
| `@typescript-eslint/no-require-imports` | **error** | **299** |
| `react/no-unescaped-entities` | warning | 250 |
| `react-hooks/exhaustive-deps` | warning | 156 |
| `prefer-const` | **error** | **83** |
| *unused `eslint-disable` directive* | warning | 72 |
| `@next/next/no-img-element` | warning | 47 |
| `@typescript-eslint/no-unused-expressions` | **error** | **13** |
| `@typescript-eslint/ban-ts-comment` | **error** | **8** |
| `react/jsx-no-duplicate-props` | **error** | **6** |
| `@typescript-eslint/no-empty-object-type` | **error** | **4** |
| `react/display-name` | **error** | **2** |
| `@next/next/no-assign-module-variable` | **error** | **2** |
| **fatal parse error** | **error** | **1** |
| `@typescript-eslint/no-unsafe-function-type` | **error** | **1** |
| `prefer-rest-params` | **error** | **1** |
| `import/no-anonymous-default-export` | warning | 1 |
| `jsx-a11y/alt-text` | warning | 1 |

**Nothing above was fixed.** Three findings are worth surfacing beyond the counts:

1. **`archive/` is 167 of the 420 errors (40%) and the only fatal parse error** (`archive/test-dsl-wrapper.ts:93 Parsing error: Expression expected`). `tsconfig.json` already excludes `archive`, so the project's own definition of "the code" excludes it. Aligning the lint scope with the compile scope would take errors **420 → 253** and fatals **1 → 0**. **Not done here** — see D-8.
2. **The 72 "unused `eslint-disable` directive" warnings are evidence, not noise — and the thing they point at is large.** They are disable comments naming rules that **are not enabled at all**: `no-console`, `no-await-in-loop`, `@typescript-eslint/no-var-requires`. So the `// eslint-disable-next-line no-console` comments scattered through this repo are **decorative** — there is nothing to disable.

   **The baseline is ESLint's own count, because that is what a ratchet compares** — not a `grep`. SA's instruction, and both of our earlier `grep` figures (mine 4,666 / 418, SA's 4,683 / 420) are superseded:

   ```bash
   npx eslint app lib components hooks --rule '{"no-console":"error"}'
   ```

   **4,658 findings across 410 files** — reproduced exactly, counting only `ruleId === 'no-console'` in the JSON report. The command is recorded beside the number so the baseline is reproducible rather than remembered.

   **CLAUDE.md mandatory rule 3 — "never `console.*`, always Pino" — has therefore had ZERO automated enforcement for its entire life, and it cannot simply be flipped to `error`.** 4,666 findings would swamp the 420 real errors. It needs a counted baseline and a ratchet, which is step 3 below. This is a finding for BA/SA, not a fix for this branch.
3. **`tests/`, `__tests__/` and `scripts/` are 146 of the 253 non-`archive` errors** (58%), almost all `no-require-imports` from `jest.mock` factories. So the error backlog is mostly *test plumbing*, not product code — which matters for how a ratchet would be scoped.

### Is `--max-warnings 0` viable today? No.

| Option | Viable now? | Verdict |
|---|---|---|
| `eslint . --max-warnings 0` | ❌ | 9,909 warnings. It would be permanently red and would destroy the signal from the 420 errors. |
| `eslint .` (errors only) | ❌ **as a gate**, ✅ **as an entry point** | Exits 1 today on 420 errors. It runs, and it reports the truth — which is the thing that did not exist before. |
| `eslint .` after scoping out `archive/` | ❌ | Still 253 errors. Closer, still not green. |
| A **ratchet** (fail only if counts exceed a committed baseline) | ✅ | The only shape that can go into CI without either a cleanup sprint or a lie. ESLint has no `--max-errors`, so it needs a small script over `--format json` — `lint:report` already produces the input. |

**The honest interim, stated plainly:** `npm run lint` is now a **script that runs and reports**, not one that blocks. It exits 1, so it is *usable* as a gate the moment someone decides to burn the errors down or to commit a baseline — but **it is not wired into CI in this PR, as instructed**, and wiring it today would turn `main` red for everyone.

### The ratchet order (SA, recorded so it is not rediscovered)

1. **Ignore `archive/`** — `tsconfig.json` already excludes it. Errors **420 → 253**, fatal parse errors **1 → 0**. A scope decision, not a code change.
2. **Clear the 219 `no-require-imports` (299 total, 167 of them in `archive/`) and `prefer-const` errors** — mechanical, mostly `jest.mock` factories in test plumbing, and `prefer-const` is auto-fixable.
3. **Take a counted `no-console` baseline** — `npx eslint app lib components hooks --rule '{"no-console":"error"}'`, today **4,658 findings / 410 files** — then enable the rule as a ratchet. It cannot go straight to `error`: see finding 2 above.
4. **Only then** make it a required status check.

Steps 1–4 are a separate requirement, not this branch.

## Gates

All run on this branch, verbatim. **Re-run in full after the SA round-1 fixes; every line below is the post-fix run.**

| Gate | Exit | Output |
|---|---|---|
| `npm run typecheck:bos-llm` | **0** | `234 files in scope, 28 errors, 0 new (83.8s)` · `1 baseline entry is fixed; consider --update-baseline` · `passed`. The fixed baseline entry (`app/api/onboarding/build/route.ts` TS18047) is **pre-existing and unrelated** — not touched here. |
| `npm run check:bos-llm-literals` | **0** | `43 files in scope, 2 exempt, 0 violations (18.2s)` · `passed` |
| `npm run lint:hooks` | **0** | no output — `--max-warnings 0` clean |
| `npm run test:authz-guard` (**the required check**) | **0** | `Test Suites: 1 passed, 1 total` · `Tests: 103 passed, 103 total` — up from **74** on `main` (92 before the SA round-1 fixes) |
| `npx jest --ci` (full suite) | **1** | `Test Suites: 24 failed, 8 skipped, 480 passed, 504 of 512 total` · `Tests: 143 failed, 64 skipped, 7715 passed, 7922 total` · 220s. **Identical on `main`:** the same 24 suites, the same `143 failed`, `7691 passed` — this branch is `7715 passed`, exactly **+24**, which is the 24 tests it adds (18 in the guard suite, 6 in the screen suite). Measured by running the same command in the `main` checkout. |
| `npm run build` | **0** | completes, `ƒ Middleware 64.7 kB` |

⚠️ **The full jest suite is red on `main` and was red before this branch** — 24 suites, none of them touched here (V6/pilot compiler suites, orchestration, website-builder, featureFlags, and suites importing modules deleted months ago). This is the known state recorded in the test-tiering work; it is **not** a finding of this change, and it is why the *required* check is a single scoped suite rather than `npm test`.

## SA Review Notes

### SA Review — guard hardening and lint

**Reviewed by SA — 2026-09-24**
**Status:** 🔄 Revision Required (findings 1–4 must be fixed before this goes in front of the required check)

Every number below was re-measured by SA in the worktree, by mutating the **real**
`app/admin/layout.tsx` / the real `app/admin/**` tree and running
`npm run test:authz-guard` — the required check itself — then restoring
(`git checkout --` verified clean after every run).

**What reproduced exactly as reported.** Baseline **92/92**. All eight F-2 mutations fail:
1 failure each, try/catch **2**. All four R8 mutations fail as documented; SA added three
more — a **nested server `layout.tsx`** (1 failure), a server **`loading.tsx`** (1 failure),
and a **legitimate new `'use client'` page** (92/92, i.e. correctly accepted).
`npm run lint:hooks` clean, `tsc --strict` on the new helper clean, screen suite 54/54,
lint report reproduced at **3,167 files / 420 errors / 9,909 warnings / 1 fatal**, with
`archive/` = **167** errors and the only fatal. No exemption, cap or ratchet was widened:
the only cap added is `R8: { parked: 0, permanent: 0 }`, both R8 lists are empty and
asserted empty, and R1–R5 are untouched.

This branch is a strict improvement on `main`, where the call can be **deleted** and the
required check stays green. The findings below are not a reason to keep `main`'s version;
they are the reason not to merge this one as-is.

### Findings

1. **`tests/helpers/admin-page-guard.ts:116-134` (`firstStatementOfAdminLayout`) — the ninth shape: F-2 still reproduces. Priority: High.**
   The extractor takes the **first** match of `ADMIN_LAYOUT_SIGNATURE` in the file and does
   not blank string literals. Put a decoy signature inside a template literal above the real
   component and **delete the real guard call**:

   ```typescript
   const EXAMPLE_LAYOUT = `export default async function AdminLayout({ children }: P) {
     await requireAdminPage();
     return <AdminChrome>{children}</AdminChrome>;
   }`;

   export default async function AdminLayout({ children }: { children: React.ReactNode }) {
     return <AdminChrome>{children}</AdminChrome>;   // no guard at all
   }
   ```

   SA ran this against the real file: **`Tests: 92 passed, 92 total`** — the required check
   green with the `/admin` tree unguarded, which is F-2 verbatim. A single-quoted one-line
   string reproduces it too.
   This repo has **already learned this lesson in this same file**: R1 blanks string literals
   for exactly this reason (`lib/admin/__tests__/admin-authz-surface.guard.test.ts:1414`,
   test `D-Q1: a requireAdmin( that occurs only inside a STRING LITERAL is not a gate`). The
   fix is to reuse the existing `blankStringLiterals` (`:490`, offset-preserving by contract)
   as the scaffold for locating the signature and the statement end, and slice from the
   unblanked text — so `importsCanonicalGuard`, which legitimately needs the module-path
   string, is unaffected. Add the decoy to `DISABLED_ADMIN_LAYOUTS` with
   `caughtBy: 'firstStatementIsTheGuard'`.

2. **`tests/helpers/admin-page-guard.ts:91` (`ADMIN_LAYOUT_SIGNATURE`) — a legitimate TypeScript edit turns the required check red, with a message that does not say why. Priority: High.**
   Adding a return-type annotation — `}): Promise<React.ReactElement> {` — makes the
   signature unmatchable. SA applied it to the real file: **1 failed / 91 passed**. The same
   happens for the two other standard component forms:
   `const AdminLayout = async ({ children }) => { … }; export default AdminLayout;` and
   `async function AdminLayout(…) { … } export default AdminLayout;` (both return
   `firstStatement: null`).
   Failing closed on `null` is right, and the header argues it well — the defect is that
   `ADMIN_LAYOUT_GUARD_FAILURE` says *"Do not relax this assertion… fix the layout"*, which
   is the wrong instruction for someone whose layout is correct and whose **signature** is
   merely unrecognised. Fix both halves: allow an optional `\s*:\s*[^{;]+` return type before
   the brace, and when `firstStatement === null` fail with a distinct message that names the
   accepted signature forms. This is the danger the brief asked about, and it is live.

3. **`tests/helpers/admin-page-guard.ts:107-108` — the regex advertises support for destructuring the extractor can never deliver. Priority: Medium.**
   `FIRST_STATEMENT_IS_THE_GUARD`'s character class includes `{}` and `[]`, so it reads as
   accepting `const { userId } = await requireAdminPage();`. It cannot:
   `firstStatementOfAdminLayout` truncates at the first `{`, so the first statement comes back
   as the bare string `"const"` and the verdict is `guarded: false`. Same for
   `const admin: AdminUser = …` when the annotation is an object type. The file therefore
   documents one rule and enforces a narrower one, in the direction that reddens `main`.
   Either terminate the statement on a `{` that is not balanced-and-closed before the `;`, or
   drop `{}[]` from the class and say in the docstring that a destructured result is not
   accepted. Whichever is chosen, add the case to `GUARDED_ADMIN_LAYOUTS` (if supported) or to
   a new "rejected on purpose" list (if not) — the point is that the next reader learns it
   from a test rather than from a surprise red build.

4. **`lib/admin/__tests__/admin-authz-surface.guard.test.ts:822` (`isClient`) — computed from RAW source, so a comment decides a security verdict. Priority: Medium.**
   `/^\s*['"]use client['"]/m` is tested against `raw`, not `code`. A block comment whose line
   begins with the directive —

   ```typescript
   /*
   'use client' is deliberately not used here.
   */
   ```

   — sets `isClient: true`. SA added exactly that comment to the real `app/admin/layout.tsx`:
   **1 failed / 91 passed**, i.e. a documentation comment reddens the required check. The same
   laxity runs the other way for R8: a genuinely server-rendered admin page carrying such a
   comment would be classed as a client component and pass. `isClient` was cosmetic before
   this branch and is now load-bearing for a security rule, so it should read the **stripped**
   source and anchor to the file's first non-empty line, which is where Next.js requires the
   directive.

5. **R8's census floor — `>= 22` is today's exact count, so it is equality in disguise. Priority: Medium.**
   The tree has exactly 22 pages. SA moved one real admin page aside: **1 failed / 91 passed**,
   message *"found the /admin page tree — this rule cannot pass by scanning nothing"*. Deleting
   an admin screen is a normal change (the purge and config-cleanup work both do it) and should
   not redden a required check, least of all with a message about scanning nothing. It is also
   inconsistent with this file's own convention for anti-vacuity floors — `SCANNED.length > 500`
   at `:880` against ~3,000 files. Set the floor well below the census (≥15 is still
   unreachable by accident) and keep "22 on 2026-09-24" in the comment, where it belongs.

6. **R8 rejects the one page shape that is genuinely immune to OI-21. Priority: Medium.**
   A server page that guards **itself** —
   `export default async function Page() { await requireAdminPage(); … }` — fails R8 twice
   (SA: **2 failed / 90 passed**), and the failure text instructs the author *"do not exempt
   the file"*. But the OI-21 bypass works by re-using the cached **layout** segment; a page
   always renders, so a page holding its own `requireAdminPage()` is strictly safer under that
   exploit than a client page trusting R1 downstream. As written, R8 forbids the better fix and
   mandates the weaker one. Narrow it: allow a server render entry point whose first statement
   is the guard, reusing `adminLayoutGuardVerdict` — the shared helper makes this cheap, and it
   keeps the rule's claim ("nothing here renders unguarded server data") true instead of
   over-broad.

7. **`tests/helpers/admin-page-guard.ts:142-146` (`declaresLocalGuard`) — a second shadow shape still passes. Priority: Low (contrived, but the same class as shape 8).**
   The regex requires `const|let|var|function` at line start. A **default-valued parameter**
   shadows the import inside the body without any of them:

   ```typescript
   export default async function AdminLayout(
     { children }: { children: React.ReactNode },
     requireAdminPage = async () => {}
   ) {
     await requireAdminPage();          // the no-op
   ```

   SA against the real file: **`Tests: 92 passed, 92 total`**. Cheap containment without a
   fourth regex round: assert the identifier appears in the body **exactly once** and that the
   signature's parameter list does not mention it.

8. **The rule and its own mutation corpus live in one module, with no ratchet. Priority: Medium.**
   `DISABLED_ADMIN_LAYOUTS` is what proves the rule, and it sits beside the rule, so one edit
   can relax both and stay green — the failure mode the exemption caps exist to prevent
   elsewhere in this suite. Add the caps' equivalent: assert
   `DISABLED_ADMIN_LAYOUTS.length >= 9` (8 + finding 1's decoy) and
   `GUARDED_ADMIN_LAYOUTS.length >= 3` inside the required check. Deleting a mutation then costs
   a visible edit to a number, which is the standard this file already sets.

### Rulings requested

**The shared helper's placement — sound, and for the right reason.** `TS_SCAN_ROOTS` is
`['app','lib','components','hooks']` (`:133`), so `tests/` is genuinely outside the scan: SA
confirmed the helper's fixture strings — which contain `await requireAdminPage()` and a shadow
declaration — cannot be read as source by the guard that imports them. Had it landed in
`lib/admin/__tests__/`, the `SELF` exclusion covers only the guard file itself, so the fixtures
would have been scanned. It also typechecks under `--strict` and is inside `tsconfig.json`'s
`include`. The "one rule, two callers" argument is correct on the evidence: the drift already
happened, in the direction where the weaker copy held authority. The residual risk is **not**
the directory — it is the co-location of rule and corpus, which is finding 8, and one number
fixes it.

**The lint interim — accept "runs and reports, not wired to CI".** It is the honest state and
the alternative is a lie or a cleanup sprint. Two corrections to the Dev's three findings:

- **`archive/` in scope: fine for the report, must be ignored before any gate.** `tsconfig.json`
  already excludes it, it holds 167 of 420 errors and the **only fatal**
  (`archive/test-dsl-wrapper.ts`), and a fatal parse error makes a clean gate unreachable.
  Leaving it visible now is the right call; the eslint `ignores` block must match `tsconfig`'s
  `exclude` the day this blocks anything.
- **`no-console` is the finding that matters, and it is worse than "not enabled".** SA measured
  the backlog: **4,683 `console.*` calls across 420 files** under `app/ lib/ components/ hooks/`.
  CLAUDE.md mandatory rule 3 therefore has **zero** mechanical enforcement, and the rule cannot
  simply be switched to `error`.

**The ratchet, if this is ever to block.** In this order: (1) ignore `archive/`; (2) clear the
136 `@typescript-eslint/no-require-imports` and 83 `prefer-const` errors — 219 of the 253
non-archive errors, almost all test plumbing; (3) add `no-console` as a **counted** rule over
`app/ lib/ components/` with the 4,683 baseline committed and a script over `lint:report`'s JSON
that fails when any count **exceeds** its baseline (ESLint has no `--max-errors`, and
`lint:report` already produces the input); (4) only then make it a required check. Steps 1–4 are
a separate requirement, as the workplan says.

**Is this safe to put in front of a required status check? Not yet — after findings 1–4, yes.**
Findings 1 and 7 mean the hole F-2 named is still open (92/92 with the guard gone), and findings
2 and 4 are demonstrated ways for a **correct** edit to turn `main` red, which is how a required
check gets switched off. All four fixes are local to the helper and two assertions, and each
needs a fixture in the shared corpus. Re-run the full mutation matrix after the change —
including the three new shapes above — and SA will re-review.

SA's standing ruling stands and is correctly recorded verbatim in the module header: this is the
fourth regex round, the durable fix is one behavioural test that renders `AdminLayout` as a
non-admin, and findings 1, 2, 3 and 7 are all evidence **for** it. Keeping a rendering test out
of a static-scan suite that gates every merge was the right judgement for this branch; it should
be the **first** thing done when the parked admin-authz work (OI-20) resumes, not a fifth round.

### Approved for QA: No — revise findings 1–4 first (5–8 may be taken in the same pass, or logged as follow-ups at TL's discretion)


## SA Re-check — guard hardening

**Re-reviewed by SA — 2026-09-24 (delta only)**
**Status:** 🔄 Revision Required — **one must-fix (M1)** and one should-fix (M2). Everything from the first review is genuinely closed.

Re-derived, not spot-checked: SA read the new parser line by line, then probed it with
19 synthetic shapes and re-ran the ones that matter against the **real**
`app/admin/layout.tsx` / `app/admin/**` through `npm run test:authz-guard` itself,
restoring after each (`git checkout --` clean).

**Gates re-run by SA.** `test:authz-guard` **103/103** · both guard suites together
**164/164** · `lint:hooks` clean · `typecheck:bos-llm` `234 files, 28 errors, 0 new` +
the same pre-existing fixed baseline entry · `check:bos-llm-literals` `43 files, 2 exempt,
0 violations` · `tsc --strict` clean on both new helpers. All as reported.

**Every previous finding verified fixed.** The decoy-in-a-template-literal shape now fails
(1/102); the default-valued-parameter shadow now fails (1/102); the return-type annotation,
the arrow form, the named-then-default form, `'use client'` in a block comment and the
destructured result all pass **103/103** on the real file. Moving `app/admin/queues/` out of
the tree is now **green**, where `>= 22` went red — the floor false positive is gone. R8 now
accepts a self-guarding server page (**103/103**) and rejects all three lookalikes: a
repository read before the guard, the guard in `try/catch`, and no guard at all (**2 failed
/ 101** each). A nested server `layout.tsx` and a server `default.tsx` are both caught
(1/102). A legitimate new `'use client'` page is green. `blankStringLiterals` now has one
implementation in `tests/helpers/source-scan.ts`, imported by R1 and by the page-guard rule.

### M1 — The eleventh shape. `importsCanonicalGuard` is the one predicate still reading UNBLANKED source. Priority: High (must fix).

`tests/helpers/admin-page-guard.ts:335-341` tests `strip(source)` directly. The parser and
`declaresLocalGuard` were both moved onto the blanked scaffold; this one was not. So point the
real import at a no-op module and put the canonical import text in a string:

```typescript
import { requireAdminPage } from '@/lib/admin/requireAdminPage.noop';
const IMPORT_DOC = `
import { requireAdminPage } from '@/lib/admin/requireAdminPage';
`;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();          // resolves to the no-op module
  return <AdminChrome>{children}</AdminChrome>;
}
```

SA applied this to the real `app/admin/layout.tsx`: **`Tests: 103 passed, 103 total`** — the
required check green while the `/admin` tree's guard is a no-op. `firstStatement` is the
canonical call, nothing is shadowed, and the decoy alone satisfies the import predicate. A
one-line single-quoted decoy works identically.

This is D-Q1 for the third time in three rounds, and the reasoning that moved
`blankStringLiterals` into a shared primitive applies unchanged here: **the predicate that
reads a module path is exactly the one that needs to know what a string is.** Blanking
cannot simply be applied, because the path lives inside the very literal that gets blanked —
use the offsets contract the parser already relies on: locate `import … from '…'` on the
scaffold (quotes survive blanking, contents do not) and slice the specifier from `code` at
the scaffold's quote offsets.

While fixing it, note a second-order limit SA also confirmed: `blankStringLiterals`'
template-literal pattern does not handle **nesting**, so
`` const A = `x ${`y`} import { requireAdminPage } from '@/lib/admin/requireAdminPage';`; ``
leaves the tail of the line unblanked and defeats a scaffold-based fix too (SA verdict:
`guarded: true`). Either bound the nesting case or add this fixture so the limit is pinned
rather than discovered.

### M2 — The newline-at-depth-0 terminator introduced a new false positive of the class it fixed. Priority: Medium (should fix before merge).

`firstStatementOfBody` (`:235-257`) ends a statement at the first `;` **or newline** at depth
0. A binding whose right-hand side sits on the next line therefore truncates:

```typescript
  const { userId, email } =
    await requireAdminPage();
```

`firstStatement` comes back as `const { userId, email } =` and the real file goes **1 failed /
102 passed**. Correct code, red required check — the same class as the three SA found, created
by the fix for one of them. In fairness: this repo has **no Prettier config**, so this is hand
formatting rather than a formatter product, which is why it is a should-fix and not a
must-fix. The narrow fix is to keep scanning when the statement so far ends in a continuation
token (`=`, `,`, `&&`, `||`, `(`, `?`, `:`), and to add the shape to `GUARDED_ADMIN_LAYOUTS`.
Checked and clear: a call split across lines (`requireAdminPage(\n)`), a trailing comment
after the call, a leading blank line, and the ASI form are all accepted.

### M3 — Two more legitimate default-export spellings report `parsed: false`. Priority: Low.

`export { AdminLayout as default };` (SA on the real file: **1 failed / 102**) and
`export default AdminLayout` without a semicolon (`locateComponent`'s `named` regex at `:206`
requires the `;`). Both are valid App Router code. They fail **closed** and produce
`ADMIN_LAYOUT_UNPARSEABLE`, which is the right message for the situation, so this is Low
rather than High — but the coordinator named the re-export explicitly and it costs two regex
widenings (`\s*;` → `\s*[;\n]`, plus an `export\s*\{[^}]*\b<name>\s+as\s+default\b` form) plus
two fixtures.

### M4 — The documented "known limit" produces the other message. Priority: Low (docs).

The header (`:84-91`) says a bare object-literal return type yields a false positive "whose
message says exactly that". In fact `): { a: string } {` parses, reports
`firstStatement: 'a: string'` and `parsed: true`, so the author sees
`ADMIN_LAYOUT_GUARD_FAILURE` — which does carry the false-positive escape hatch, so the
outcome is acceptable, but the header should say which message appears.

### M5 — R8's offender message now contradicts R8's own accepting clause. Priority: Medium-Low.

R8 accepts a self-guarding server page, which is the right call. But the offender string is
still `${s.file} — server-rendered file … ${OI21}`, and `OI21` says *"Add `use client` and
fetch through a requireAdmin-gated API route — do not exempt the file."* An author who wrote a
self-guarding server page in a shape the parser does not recognise is therefore told to
convert it to the **weaker** shape, with no mention that self-guarding is accepted and no
pointer at the parser. Include the `adminLayoutGuardVerdict` for the offending file in the
message, and one sentence: "a server page whose FIRST statement awaits `requireAdminPage()`
is accepted — if yours does and this still fails, the parser is at fault."

### M6 — R8's walk-equality is sound, and weaker than it reads. Priority: Low.

Both sides of `expect(ADMIN_RENDER_ENTRIES…).toEqual(onDisk)` filter through the same
`ADMIN_RENDER_ENTRY_RE`, so a render convention **missing from the regex** makes the two
agree and pass. It does catch the drift that actually happens — a changed scan root, a
renamed directory, a new extension, a `SKIP_DIRS` edit — and it is strictly better than the
count floor it replaced. Worth one more line: pin the convention list itself against Next's
documented set, so a convention added by a future Next release is a red test rather than a
silent gap.

### Corpus ratchets — yes, this is what SA asked for

`CORPUS_FLOORS = { disabled: 10, guarded: 8 }`, asserted in the required check, with every
disabled fixture required to name a live sub-rule and to be caught **by that** sub-rule. It
cannot be satisfied vacuously on the disabled side: a padding fixture would have to genuinely
fail and be attributed correctly. One soft spot: the `guarded` floor could be padded with
duplicates of the canonical shape. A `new Set(sources).size` check closes it; not a blocker.

### Lint — which console number to start the baseline from

Neither. SA's 4,683/420 and the Dev's 4,666/418 are both text scans, and they differ because
they count different method lists and include matches inside comments and strings. The
baseline must be produced by the tool that will enforce it:

```bash
npx eslint app lib components hooks --rule '{"no-console":"error"}' --format json
```

**4,658 findings across 410 files** (SA, 2026-09-24). That is the number to commit, because it
is the number the ratchet will compare against; a text-scan baseline would drift on day one.
The recorded ratchet order is otherwise as ruled.

### Verdict

**Not yet safe in front of a required check — after M1, yes.** M1 is a live, demonstrated
hole: **103/103 green with the `/admin` guard pointed at a no-op module.** That is F-2's
failure mode surviving into v5, in the one predicate the round's own fix did not reach. M2 is
a demonstrated false positive on correct code, which is the other way a required check dies.
Both are small and local, both need a fixture, and neither undoes the delta — this version is
a large net improvement on v4 and every finding from the first review is properly closed.

The parser deserves a plain statement: it is a good hand-rolled parser, and it is the fifth
regex round wearing better clothes. Three rounds have each closed the previous round's holes
and opened new ones (v4 → the string decoy; v5 → the import decoy and the wrap). SA's standing
ruling is unchanged and is now better evidenced than ever: **the durable fix is one behavioural
test that renders `AdminLayout` as a non-admin and asserts the redirect**, which is immune to
every shape in this corpus and does not care how the call is spelled. It should be the first
item when the parked admin-authz work (OI-20) resumes — not a v6.

### Approved for QA: No — fix M1, then M2. M3–M6 at TL's discretion (each is a one-liner plus a fixture)

## SA Final Re-check — guard hardening

**Re-reviewed by SA — 2026-09-24 (PR #104, open at the time of review — since MERGED as `d45a6cca` WITHOUT F1 or F2; see [Correction of record](#correction-of-record--104-merged-without-these-fixes))**
**Status:** ✅ **Approved with one condition** — F1 below must be either fixed in this PR or
explicitly deferred **with its numbers corrected in this document**. Not a blocker on the
gate's safety; a blocker on one of the PR's claims being true as written.

SA re-ran the gates and re-derived the two load-bearing changes rather than reading them.
Method for the stripper: a **regex-literal-aware reference stripper** written independently by
SA, diffed against `stripComments` over the same **2,526-file** corpus the guard scans — the
same technique the Dev used against `origin/main`, with one more construct modelled.

**Gates, re-run by SA.** `test:authz-guard` **112/112** · both guard suites **176/176** ·
`lint:hooks` clean · `typecheck:bos-llm` passed (`234 files, 28 errors, 0 new`, same
pre-existing fixed baseline entry) · `check:bos-llm-literals` `43 files, 2 exempt, 0
violations` · `npm run build` **`✓ Compiled successfully`** · `npm run lint` exits 1 at
**3,168 files / 409 errors / 9,899 warnings / 1 fatal** — matching QA's census exactly.

**Every reported result reproduced on the real files.** The apostrophe-comment bypass now
fails (**1 failed / 111**); an unguarded `app/admin/build/page.tsx` fails (**2 failed / 110**);
an ungated `app/api/admin/build/route.ts` fails (**1 failed / 111**); the reflowed
apostrophe comment is **112/112**. SA added three more: a root-only skip name at depth
(`app/admin/dist/page.tsx`) is now caught (**2 failed / 110**); a nested template literal and a
regex literal after the guard, and a CRLF copy of the whole file, are all **112/112** — no new
false positive.

### 1. Is the precedence fix correct and complete? Correct, and NOT complete.

**Correct, and demonstrably so.** Comments are now recognised before strings, in one pass, and
SA probed it with fourteen shapes: a quote inside a one-line block comment, a quote in a line
comment, a comment marker inside a string, a regex containing `/*` escaped, a template
containing `//`, a comment inside an interpolation, an unterminated block comment at EOF, an
unterminated string at EOF, CRLF, two apostrophe comments in sequence, and JSX text with two
apostrophes. All correct. Both invariants re-measured across all 2,526 files by SA:
**line-count preserved — 0 violations**, and `blankStringLiterals` length preserved — **0
violations**. The claimed shape of the fix ("smaller, not cleverer") is real: this is the right
change.

**F1 — but there is no REGEX-LITERAL state, and that reopens the same hole. Priority: High (condition of approval).**

A regex literal whose character class contains `/*` still opens a phantom block comment:

```typescript
const RE = /[/*]/;
export async function GET() {
  if (profile.role === 'admin') return grantEverything();
}
/* any later block comment closes the phantom */
```

`stripComments` returns `const RE = /[` + newlines + `const after = 1;`. The
`profiles.role` access decision is **deleted**, so R4 cannot see it — D1/D2's class, direction
and permissiveness, surviving the fix. SA verified `violationSurvives = false`.

It is live on this branch today, not hypothetically:
`lib/business-os/bizql/render/AnswerRenderer.ts:458` contains
`const purelyAdditive = !/[/*]/.test(source);`, and stripping that file loses **22,686 of its
40,701 non-newline characters** — R1, R2 and R4 decide on the remaining 44%.

Three things must be said precisely, because they cut different ways:

- **It is inherited.** `origin/main`'s stripper has no regex state either, so merging is not a
  regression on this axis.
- **But the "0 files / 0 chars" figure is measured against a reference that shares the blind
  spot**, so it cannot see this. Against a regex-aware reference over the same corpus:
  **28 files still diverge and 1,952 characters are still deleted**, one of them
  catastrophically. (In fairness: 7 further files diverge the other way, where SA's reference
  is the wrong one — `lib/pilot/StepExecutor.ts` is SA's bug, not the branch's.) The honest
  claim is "0/0 against a reference sharing this limit; 28 files / 1,952 chars against a
  regex-aware one." As written, the number would stop the next person from looking.
- **It does NOT yield an admin bypass.** SA planted the phantom in the layout body and in the
  parameter list: **1 failed / 111 each** — R6 fails closed both times. So this is an integrity
  defect in R1/R2/R4's input, not an open door to `/admin`.

The fix is one more state in the same left-to-right pass — the same shape as the fix being
reviewed — plus a fixture. Either do it here, or defer it with a WP entry and the corrected
numbers in this document. What is not acceptable is leaving "0/0" on the page.

**F2 — `stripComments` has no `${…}` awareness while `blankStringLiterals` now does. Priority: Medium.**

Two hand-rolled scanners over one grammar, in the same module, disagreeing about where a
template ends. Demonstrated: `components/public/PublicThemeStyle.tsx:225` (−139 characters) and
`lib/services/WebsiteGenerationService.ts:956` (−69) — literal text inside a **nested**
template is read as a comment and deleted. Harm today is confined to string contents, hence
Medium, not High. The structural point is the one this branch keeps rediscovering in a new
costume: **one scanner, two outputs.** Three rounds have now turned on the two helpers'
differing coverage of the same grammar (round 4: nesting in the blanker; round 5: the import
predicate on unblanked source; now: interpolation in the stripper).

**F3 — the stripper's regression corpus does not contain the shapes that break it. Priority: Low.**

The four new tests and the line-count invariant all pass, and all four are shapes that already
work. SA's probe found the one failing unit shape: a regex containing a lone backtick leaves a
following comment unstripped (restrictive direction, contained). Whichever way F1 and F2 are
resolved, add the regex-literal, nested-template and interpolated-comment shapes so the limits
are pinned rather than rediscovered next round.

### 2. Does the scan-scope split hold? Yes.

Skipping by **where** rather than by **name** is the right axis, and it is verified on the real
tree: `app/admin/build/page.tsx`, `app/api/admin/build/route.ts` and `app/admin/dist/page.tsx`
are all now caught. No real source directory remains skippable: only `node_modules`, `.git`,
`.next` and `.claude` are skipped at depth, and each is genuinely tooling.

One note, not a finding: `walk` is only ever started at `app`, `lib`, `components`, `hooks` and
the two SQL roots, never at `REPO_ROOT`, so `SKIP_AT_ROOT_ONLY` cannot fire today — it is
belt-and-braces against a future root-level scan, which is fine, but the comment should say so
rather than implying it is load-bearing.

**R8's two-sided independence is real, not nominal.** `listEveryFileUnconditionally` is a
different algorithm (explicit stack, no filtering, no skip list) from `walk` (recursion with
two skip sets), and the suite additionally asserts its source text names neither `walk(` nor
`SKIP_ANY_DEPTH`. That last assertion is structural rather than semantic, but it is exactly the
refactor it needs to catch. The residual is unchanged from SA's M6: both sides filter through
the same `ADMIN_RENDER_ENTRY_RE`, so a render convention missing from that regex agrees on both
sides and passes. Low, and already recorded.

### 3. One PR or two? One — merge this, and do not split it.

The coordinator's instinct is right and SA will not overrule it. The stripper fix is not
separable from the code that exposed it: the branch's more-correct blanker is what made D1
*measurable*, and the page-guard parser consumes the stripper's output, so a stripper-only PR
would ship a behaviour change with no rule in the tree that exercises it — which is how the
weaker-copy-with-authority problem started in the first place. The corpus evidence, the
fixtures, QA's defect log and three SA reviews all sit on this branch; splitting discards that
context to buy sequencing comfort. And `main` is measurably worse **today** (16 files / 64,700
characters truncated), so the sooner this lands the sooner that stops. One reviewed change
beats two half-reviewed ones.

### 4. Is it safe in front of a required check? Yes — with F1 settled.

Plainly: **yes.** The previous answer was "not yet, after M1 yes"; M1 landed and SA re-verified
it. QA then found two **inherited** defects, and both are fixed with the fix in the correct
place. On every axis SA can measure, this version of the gate is better than what `main`
enforces today: it catches all eleven disabling shapes plus QA's two, it fails closed on the
phantom-comment vector rather than opening, it has **no known false positive** (112/112 on
every correct shape tried, including the reflowed comment, CRLF, nested templates, regex
literals, the real `users/page.tsx` and a self-guarding re-exported page), and both invariants
hold across all 2,526 scanned files.

F1 does not change that answer. It means one sentence in this document is currently wrong and
that R1/R2/R4 are partially blind on one real file — worth fixing, not worth holding a gate
that is otherwise a large net improvement. Fix it here if it is one more state in the same
pass; otherwise defer it in writing, with the numbers corrected.

And the standing ruling, unchanged and now five rounds old: the durable fix for the page guard
is **one behavioural test that renders `AdminLayout` as a non-admin**. Every round since has
closed the last round's holes and opened new ones in the same hand-rolled-scanner seam. That
test should lead OI-20 when the parked admin-authz work resumes.

### Approved for QA / merge: Yes, conditional on F1 (fix or documented deferral). F2 and F3 are follow-ups at TL's discretion.

## QA Testing Report

## QA Test Report — guard hardening and lint

**QA — 2026-09-24**
**Test mode:** full
**Strategy used:** A (Jest unit probes over the shared helper) + C (mutation scripts against the **real** `app/admin/**` tree, each run through `npm run test:authz-guard` — the required check itself — and reverted; `git status` verified clean after every run). No log analysis was needed; every number below is a measured run.
**Focus:** security (the required check), api (R1's scan scope), tooling (lint)
**Skipped:** E2E (Playwright is not installed — CLAUDE.md § Testing). No behavioural render test was written: that is Dev/SA work, not QA's.
**Input source:** prompt keywords (run every gate; hunt a twelfth bypass; hunt a sixth false positive; attack R8; ratchet; messages; truncation)

**Totals: 48 PASS · 10 FAIL · 1 BLOCKED** over 59 checks. **10 defects, 3 of them High.**

---

### 1. Gates — all run verbatim on this branch

| Gate | Exit | Measured | Matches the workplan? |
|---|---|---|---|
| `npm run typecheck:bos-llm` | **0** | `234 files in scope, 28 errors, 0 new (116.1s)` · same pre-existing fixed baseline entry (`app/api/onboarding/build/route.ts` TS18047) · `passed` | ✅ |
| `npm run check:bos-llm-literals` | **0** | `43 files in scope, 2 exempt, 0 violations (33.0s)` · `passed` | ✅ |
| `npm run lint:hooks` | **0** | no output | ✅ |
| `npm run test:authz-guard` (**the required check**) | **0** | `Tests: 106 passed, 106 total` | ✅ |
| `npm run build` | **0** | completes · `ƒ Middleware 64.7 kB` | ✅ |
| `npm run lint` | **1** (by design) | **3,168 files · 1,396 with problems · 409 errors · 9,899 warnings · 10,308 total · 1 fatal** | ❌ **does not reproduce — DEF-QA-6** |
| `npx eslint app lib components hooks --rule '{"no-console":"error"}'` | 1 | **4,658 findings / 410 files** | ✅ exactly |
| screen suite `app/admin/business-os-llm/__tests__/source.guard.test.ts` | 0 | **64 passed** (workplan records 61) | ⚠️ stale count |

Lint scope verified from `.eslint-report.json`: `.claude/` **0** files, `.next/` **0**, `coverage/` **0** — the new `ignores` block works. `archive/` still in scope at **167 errors including the only fatal**; non-`archive` errors **242** (recorded 253); `tests/` + `scripts/` **136**.

### 2. Bypass hunt — 18 synthetic shapes + 3 real-file mutations

Verdicts taken from `adminLayoutGuardVerdict(source, stripComments)`, i.e. exactly what R6 asserts. **17 of 18 fail closed. One is a live bypass, and it reproduces on the real file through the required check.**

| # | Shape | Result |
|---|---|---|
| B1 | layout defined elsewhere and re-exported (`export { default } from './real-layout'`) | ✅ rejected (`parsed:false`) |
| B2 | `export { AdminLayout as default }`, unguarded (M3's shape) | ✅ rejected (`parsed:false`) |
| B3 | generic whose type parameter contains a paren, shadow param after it | ✅ rejected — but for the wrong reason, see DEF-QA-10 |
| B4 | `export default AdminLayout as React.FC<any>` | ✅ rejected |
| B5 | `export default AdminLayout satisfies (p) => any` | ✅ rejected |
| B6 | HOC wrapper `export default withChrome(AdminLayout)` | ✅ rejected |
| **B7** | **an apostrophe in a ONE-LINE block comment above an early return** | 🛑 **BYPASS — `guarded: true`** |
| B8 | the same trick swallowing a `try {` opener | ✅ rejected (`firstStatement: ''`) |
| B9 | an odd **backtick** in a one-line block comment above an early return | ✅ rejected here (it blanks the guard too) |
| B10 | apostrophe comment above a locally shadowed no-op | ✅ rejected (`importsCanonicalGuard:false`) |
| B11 | apostrophe comment above a look-alike import | ✅ rejected |
| B12 | `import type { requireAdminPage }` (cannot run) | ✅ rejected |
| B13 | guard inside an immediately-invoked arrow | ✅ rejected |
| B14 | shadow via a **nested destructuring default** in the params | ✅ rejected (`shadowsTheGuard`) |
| B15 | look-alike import wrapped across lines | ✅ rejected |
| B16 | `await requireAdminPage ()` (space before the parens) | ✅ accepted — correct |
| B17 | `#!` shebang line, then an unguarded component | ✅ rejected |
| B18 | decoy signature inside a JSX text node, real call deleted | ✅ rejected |
| **M1** | **B7 applied to the REAL `app/admin/layout.tsx`** | 🛑 **`Tests: 106 passed, 106 total`** — required check GREEN with an unconditional early return above the guard |
| M2 | `export { AdminLayout as default }` on the real file | ✅ red, `parsed:false`, `ADMIN_LAYOUT_UNPARSEABLE` |
| M3 | a trailing `/* the gate */` after the real call | ✅ green — correctly accepted |

**M1, verbatim, on the real file:**

```tsx
  /* we don't render the shell for crawlers */
  if (isCrawler()) return <AdminChrome>{children}</AdminChrome>;  /* fast path */
  await requireAdminPage();
```

→ `Tests: 106 passed, 106 total`. Every caller taking that branch is served the admin shell, and the required check is green. **This is F-2's failure mode surviving into v6.**

### 3. False-positive hunt — 18 synthetic shapes + 2 real-file mutations

| # | Legitimate shape | Result |
|---|---|---|
| F1 | `const { userId }: AdminIdentity = await requireAdminPage();` | ✅ accepted |
| F2 | `const AdminLayout: React.FC<…> = async ({children}) => {…}` + `export default` | ✅ accepted |
| F3 | imported props type (`{ children }: LayoutProps`) | ✅ accepted |
| **F4** | **`import { requireAdminPage as guard }` + `await guard();`** | ❌ **rejected — DEF-QA-7** |
| F5 | `async function AdminLayout(){…}` declared, `export default` below | ✅ accepted |
| F6 | `metadata` / `dynamic` exports above the component | ✅ accepted |
| **F7** | **apostrophe in a ONE-LINE block comment ABOVE the guard call** | ❌ **rejected — DEF-QA-2** |
| F8 | CRLF line endings throughout | ✅ accepted |
| F9 | BOM at the start of the file | ✅ accepted |
| F10 | comments inside the parameter list | ✅ accepted |
| F11 | tabs and doubled spaces in the `export default async function` run | ✅ accepted |
| **F12** | **params type mentioning `typeof requireAdminPage`** | ❌ **rejected — DEF-QA-8** |
| F13 | object-literal return type (`Promise<{ ok: boolean }>`) | ✅ accepted |
| F14 | `await` and the call split across lines | ✅ accepted |
| F15 | regex literal containing quotes above the imports | ✅ accepted |
| F16 | a repository read AFTER the guard | ✅ accepted |
| F17 | the real `app/admin/layout.tsx`, verbatim | ✅ accepted |
| F18 | generic component with a simple type parameter | ✅ accepted |
| **M4** | **the real layout's own comment reflowed to one line** — `/* requireAdminPage redirects by throwing, so don't wrap it in try/catch */` | ❌ **`Tests: 1 failed, 105 passed`** on correct code |
| **M5** | **`/* the admin user's list */` above `'use client'` in the real `app/admin/users/page.tsx`** | ❌ **`Tests: 1 failed, 105 passed`** — R8 calls a client page a server offender |

### 4. R8 attacked directly

| Probe | Expected | Result |
|---|---|---|
| unguarded **async Server Component** at `app/admin/build/page.tsx` | red | 🛑 **106/106 GREEN — DEF-QA-3** |
| ungated admin handler at `app/api/admin/build/route.ts` | red | 🛑 **106/106 GREEN — DEF-QA-3** (that is R1, not R8) |
| the identical handler at `app/api/admin/qa-probe-normal/route.ts` (control) | red | ✅ 1 failed / 105 |
| correct **self-guarding** server page written `export { Page as default }` | green | ❌ **1 failed / 105 — DEF-QA-4** |
| spoofing `isClient` on a genuinely server-rendered page | impossible | ✅ not reproducible — for the stripped file to start with the directive it has to *be* the directive |
| walk-equality (`ADMIN_RENDER_ENTRIES` vs an independent walk) | cannot disagree-and-pass | ⚠️ it **can**: both sides share `ADMIN_RENDER_ENTRY_RE` *and* `SKIP_DIRS`, which is the mechanism of DEF-QA-3 |

### 5. The required check cannot be weakened silently — verified

| Check | Result |
|---|---|
| `git diff` of the guard suite vs `main`: exemptions, caps, floors, `SKIP_DIRS`, `TS_SCAN_ROOTS` | ✅ **additions only** — the only cap added is `R8: { parked: 0, permanent: 0 }`; R1–R5 untouched. The removed lines are the old `blankStringLiterals` regex, the old `isClient`, and the old R6 body |
| R8 allow-lists genuinely empty | ✅ asserted and true |
| corpus ratchet — delete the last **disabled** fixture | ✅ red (`1 failed / 104`) |
| corpus ratchet — delete the last **guarded** fixture | ✅ red (`the mutation corpus may only GROW`) |
| attribution — flip a fixture's `caughtBy` to another live sub-rule | ✅ red |
| corpus ratchet — satisfy the **guarded** floor with a duplicate | ⚠️ **BLOCKED** — the mutation broke the module (suite failed to run). By inspection (`:1783`) the assertion is `length >= floor` with no uniqueness check, so SA's noted soft spot stands — **DEF-QA-9** |
| `.github/workflows/admin-authz-guard.yml` diff | ✅ comment-only — job name and triggers unchanged, so the required check's identity is preserved |

### 6. Failure messages, judged as the engineer who hits one at 18:00 on a Friday

- `ADMIN_LAYOUT_GUARD_FAILURE`: ✅ the false-positive escape hatch **is** sentence two, and it printed in full in M4's real output, naming the parser's path. Good.
- `ADMIN_LAYOUT_UNPARSEABLE`: ⚠️ the *"more likely to be a BUG IN THE ASSERTION than in your file"* clause is sentence **two**, not the lead (sentence one is "could not find a default-exported component… fails closed"). Acceptable — but the workplan claims it *leads*. Worse in practice: R6 embeds **both** messages on both sides of one `toEqual`, so ~2,000 characters of two different instructions print on **every** R6 failure and the reader must infer from `parsed:` which applies.
- R8's offender message: ❌ it names both accepted fixes (M5's fix landed) but carries **no** parser escape hatch and **no** verdict echo, so in DEF-QA-4 and DEF-QA-5 it tells an author with correct code to do something already done, and closes with "Do not exempt the file". This is the message most likely to get the check switched off.

### 7. Truncation audit — both claims independently confirmed

| Claim | Verified |
|---|---|
| nothing else on the branch was blanked | ✅ `git diff --numstat 77e200ca HEAD` → **11 files, no deletion-without-insertion row** (`awk '$1==0 && $2>0'` empty). `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` is **456 lines / 47,413 bytes**, OI-21 on 5 lines, both `curl` blocks intact |
| the 5 zero-byte tracked files are also zero on `main` | ✅ `git ls-tree -r -l` on both refs: identical set — `archive/CLAUDE_BASE_1406.md`, `lib/hooks/useAgentLibrary.ts`, `lib/hooks/useTesting.ts`, `lib/hooks/useWorkflowState.ts`, `lib/plugins/v2/configs/dropbox.json` |

---

### Defects

#### Bugs — must fix before this goes in front of the required check

1. **DEF-QA-1 — The twelfth bypass: an apostrophe in a one-line block comment deletes the code above the guard. Severity: High.**
   `stripComments` (`lib/admin/__tests__/admin-authz-surface.guard.test.ts:466`) blanks string literals **first** and then looks for comments. A `'` inside a block comment therefore blanks the comment's own `*/`, so `scaffold.indexOf('*/')` jumps to the next `*/` anywhere later in the file and everything between is deleted from the scanned source.
   - Steps to reproduce: add the two lines in §2 M1 to the real `app/admin/layout.tsx`, run `npm run test:authz-guard`.
   - Expected: red (an early return above the guard is fixture #5 of the disabled corpus).
   - Actual: **106/106 green**, with the admin shell rendered to any caller taking the branch.
   - This is **not** a thirteenth-shape whack-a-mole: it is a **precedence inversion** in the primitive D-3 was written to fix (D-3 closed "a comment opener inside a string"; the inverse was left open). The fix is one scanner in which a comment wins over a quote — comments detected on **raw** text, strings blanked **after** — plus one fixture per direction. Smaller than any round 4/5 change, and it does not extend the shape corpus.

2. **DEF-QA-2 — The same root cause rejects correct code, and it is already deleting ~193k characters from the scan. Severity: High.**
   - Reproduce (false positive): reflow the real layout's own two `//` lines into one block comment containing `don't` (§3 M4) → **1 failed / 105**. The repo's layout comment is *about* not wrapping the guard in try/catch, so this is a plausible Tuesday edit.
   - Blast radius, measured over the guard's own scan roots against a comment-first reference stripper: **234 of 2,524 files lose code, 192,936 non-whitespace characters in total.** Worked examples: `app/admin/business-os-llm/copy.ts:148` (`/** Lock glosses (FR-12), over the payload's booleans. */` → the next 7 real lines vanish) and `lib/repositories/BusinessProfileRepository.ts` (**27,540** characters, from line 27 on).
   - Consequence beyond R6/R8: **R1–R5 decide on truncated sources.** Today no file under `app/api/admin/` is affected, so there is no live R1 miss — but "an ungated admin handler hidden by an apostrophe in a comment" is one comment away, and it is the D-3 incident again.
   - Pre-existing on `main` (identical `stripComments`), so not a regression of this branch — but this branch makes the primitive load-bearing for a security verdict and stacks a second rule on it.

3. **DEF-QA-3 — `SKIP_DIRS` is an exemption mechanism keyed on a directory name, and R8's anti-vacuity property cannot see it. Severity: High.**
   `walk()` skips any directory named `build`, `dist`, `coverage` (plus `.next`, `.claude`) at **every depth**, for the whole suite.
   - `app/admin/build/page.tsx`, an unguarded `async` Server Component reading a repository → **106/106 green**.
   - `app/api/admin/build/route.ts` with no admin gate at all → **106/106 green**; the identical file at `app/api/admin/qa-probe-normal/route.ts` → **1 failed**. So R1 — the rule the whole admin-authz story rests on — is bypassed by naming a directory `build`.
   - R8's headline test ("the scan sees EVERY render entry point that exists on disk") **cannot** catch this: both sides of the `toEqual` call the same `walk`, so they agree on a tree with the file missing. That is M6's shared-filter observation one level deeper, and it applies to the scan roots as well as to the regex.
   - `app/api/onboarding/build/` already exists in this repo, so the shape is not hypothetical. Fix: restrict `SKIP_DIRS` to genuine build output at the repo root, and assert the skip list cannot elide anything under `app/`.

4. **DEF-QA-4 — R8 rejects a correct self-guarding page and tells the author to weaken it. Severity: Medium.**
   `app/admin/qa-probe/page.tsx` awaiting `requireAdminPage()` as its first statement but exported as `export { QaProbePage as default }` (M3's known-unparseable spelling) → **1 failed / 105**, message: *"server-rendered file in the /admin page tree … (1) add `use client` … Do not exempt the file."* The page is safe by the rule's own argument. R6's message has a false-positive hatch; **R8's has none**, and SA's M5 request to echo `adminLayoutGuardVerdict` for the offending file was not implemented.

5. **DEF-QA-5 — R8 false positive on a real client page, with a remedy that is already applied. Severity: Medium.**
   Prepend `/* the admin user's list */` to the real `app/admin/users/page.tsx` — a file-header comment with an apostrophe, the commonest comment there is → **1 failed / 105**, and the message says "add `use client`" to a file whose first line is `'use client';`. Root cause is DEF-QA-1's; it is listed separately because of the message: it is unfalsifiable from the author's seat.

#### Tooling issues — should fix

6. **DEF-QA-6 — The recorded lint census no longer reproduces. Severity: Low.**
   Measured today on this branch: **409 errors / 9,899 warnings / 10,308 total / 3,168 files / 1,396 with problems / 62 unused-directive warnings / 289 `no-require-imports` / 3 `no-empty-object-type` / 242 non-`archive` errors**, against the recorded 420 / 9,909 / 10,329 / 3,165 / 1,401 / 72 / 299 / 4 / 253. The delta is **fully attributable to the `origin/main` merge (3c89cbf6)**: the entitlements work removed exactly **10** `// eslint-disable-next-line @typescript-eslint/no-var-requires` comments (= the 10 lost warnings) with their requires, plus one `no-empty-object-type`; the merge-changed files now contribute **0 errors / 0 warnings**. The **`no-console` baseline — the only number a ratchet will compare against — reproduces exactly at 4,658 / 410**, and `archive/` = 167 errors including the single fatal is confirmed. Refresh the table (and the screen suite's 61 → **64**) so the committed baseline matches the tree it will be compared with.

#### Edge cases — nice to fix

7. **DEF-QA-7 — `import { requireAdminPage as guard }` + `await guard()` is working code and is rejected. Severity: Low.** `importsCanonicalGuard:false`, `firstStatementIsTheGuard:false`. The rejection is defensible (the anchored rule is the canonical spelling) but it is **recorded nowhere**: SA's finding-3 recommendation of a "rejected on purpose" fixture list was not implemented, so the next author meets it as a surprise red build.
8. **DEF-QA-8 — A parameter *type* mentioning `typeof requireAdminPage` sets `shadowsTheGuard`. Severity: Low.** `declaresLocalGuard` scans the raw parameter text, annotations included, so a legitimate type reference reads as a shadow.
9. **DEF-QA-9 — The `guarded` corpus floor is satisfiable with duplicates. Severity: Low.** `:1783` asserts only `length >= 9`; a `new Set(sources).size` check closes it. SA flagged it; unfixed. The direct probe was **BLOCKED**, so this is by inspection.
10. **DEF-QA-10 — The shadow check does not always read the real parameter list. Severity: Low.** With a generic type parameter containing a paren (`<T extends (x: number) => void>`), `paramsOpen` lands inside the generic, so `parameters` came back as `children` and the real parameter list — including a `requireAdminPage = async () => {}` shadow — was never scanned. The probe still failed **closed** (the mis-parse also wrecked `firstStatement`), so no bypass was demonstrated; the point is that the shadow surface is not reliably the parameters.

### What this branch gets right (re-verified, not taken on trust)

All **11** previously found disabling shapes are still rejected, and all **5** previously fixed false positives are still accepted (return type, arrow form, named-then-default, `'use client'` in a comment, destructured result, hand-wrapped binding). The corpus ratchet and the attribution assertion both bite. R8's caps are genuinely 0/0. `main`'s version remains far worse — there, the call can simply be **deleted** and the check stays green. The extraction to one shared helper is the right call, and the screen suite (64) and the required suite (106) agree.

### Final status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address DEF-QA-1, DEF-QA-2 and DEF-QA-3 before merge.**

**Is this safe in front of a required status check? Not as it stands — no.** Two of the three High defects are demonstrated on the real tree through the required check itself: it stays **green** with an early return above the guard (DEF-QA-1) and with an ungated admin API route in a directory called `build` (DEF-QA-3), and it goes **red** on correct code in two ways whose trigger is an apostrophe in a comment (DEF-QA-2, DEF-QA-5). A required check that both misses the hole it names and reddens on a comment edit is the check that gets switched off.

**But note what the fix is not.** DEF-QA-1/2 are one precedence bug in `stripComments` — strip comments **before** blanking strings — and DEF-QA-3 is a scan-scope bug. Neither is a v7 of the parser, and fixing them **shrinks** the surface the finding of record complains about rather than growing it. SA's standing ruling is untouched and is now better evidenced: the behavioural test that renders `AdminLayout` as a non-admin is immune to DEF-QA-1 too, and should lead OI-20.

## Commit Info

_(RM populates — **do not commit**; this branch is for the user's review)_

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-25 | **Correction of record: #104 merged WITHOUT the scanner fixes** | PR #104 merged as `d45a6cca` at 2026-09-24 19:21 UTC, **before D1/D2, D3, F1 and F2 were pushed**, so every claim in this document that they are closed on `main` was wrong. Added [Correction of record](#correction-of-record--104-merged-without-these-fixes) stating the live gap plainly — the apostrophe bypass (`stripComments` at guard-test line 466 still blanks strings first), the `build`/`dist`/`coverage` blind spot (`SKIP_DIRS` matched at every depth, line 157/426), and **36 files / 62,594 characters** of truncated input feeding R1–R5 in production CI. The fixes now land on `fix/admin-guard-scanner-followup` (119 tests). Truncation figures corrected and made consistent here, in the admin doc and in `tests/helpers/source-scan.ts`: **36 / 62,594 → 27 / 1,840 (precedence fix alone, independently reproducing SA's 28 / 1,952) → 0 / 0**; the earlier “16 / 64,700” and first “0 / 0” recorded as **superseded**, both having been measured against references that shared the implementation's missing regex-literal state. SA's **“one scanner, two outputs”** stands unchanged as the deferred next step, and the finding of record is unchanged: the durable fix is **behavioural** — one test rendering `AdminLayout` as a non-admin — and it leads the parked OI-20 work, not a v8 parser |
| 2026-09-24 | QA test report | ❌ **No-ship as-is.** All six gates re-run verbatim (5 green; `npm run lint` exits 1 by design but its census no longer reproduces — 409/9,899/3,168, delta fully attributable to the `main` merge; the `no-console` baseline reproduces exactly at 4,658/410). 48 PASS / 10 FAIL / 1 BLOCKED over 59 checks, **10 defects, 3 High**. **A twelfth bypass found and reproduced on the real `app/admin/layout.tsx`: 106/106 GREEN with an unconditional early return above the guard**, because `stripComments` blanks strings *before* finding comments, so an apostrophe in a one-line block comment makes the code above the guard invisible (a precedence inversion of D-3's own fix, not a new shape). The same root cause is a **sixth false positive** — the layout's own comment reflowed to one line goes red — and it already deletes **192,936 characters across 234 of 2,524 scanned files**, so R1–R5 decide on truncated sources. **Third High: `SKIP_DIRS` hides any directory named `build`/`dist`/`coverage` at every depth — an unguarded server page at `app/admin/build/page.tsx` and an ungated handler at `app/api/admin/build/route.ts` are both 106/106 green, and R8's walk-equality cannot detect it because both sides share the same `walk`.** Two more R8 false positives (a correct self-guarding page in the `export { X as default }` spelling; a real client page carrying a header comment with an apostrophe), each with a message that instructs the author to change correct code. Verified clean: R1–R5 and every cap/exemption untouched (additions only), R8 caps genuinely 0/0, all three corpus ratchets bite, the workflow diff is comment-only, no file truncated on the branch and the 5 zero-byte tracked files are identical on `main` |
| 2026-09-24 | Created | Workplan for F-2, OI-21 and the lint entry point, on one branch |
| 2026-09-24 | SA round 2 addressed; hardening closed | The eleventh shape (a decoy **import** in a template literal — D-Q1 a third time) closed by putting `importsCanonicalGuard` on the parser's **offsets contract**: locate the import on the blanked scaffold, read the specifier from the original text by offset, require exactly one import binding the local name. `blankStringLiterals` became a **character scanner** so **nested** templates pair correctly. M2's false positive (hand-wrapped bindings truncated by the newline terminator) fixed with a statement-completeness test. R8's offender message now names both accepted fixes instead of contradicting its own clause; the escape hatch moved to sentence two. Corpus floors **12 / 9**. Required suite **103 → 106**. **SA's conclusion recorded as the finding of record at the top of this doc: the durable fix is behavioural, and it leads the parked admin-authz work rather than a v7 parser.** |
| 2026-09-24 | SA round 1 addressed | A ninth and tenth disabling shape closed by **parsing the default export over a string-blanked scaffold** — R1's own D-Q1 primitive, moved to `tests/helpers/source-scan.ts` and shared rather than re-invented. Four false positives fixed (return type, arrow form, named-then-default, `'use client'` inside a comment, destructuring, and my own literal-pinned equality), and the failure message now says a failure may be a bug in the assertion. R8's count floor became a property (the scanner sees everything on disk) and gained a second accepting clause for a **self-guarding** server page, with a lookalike proved rejected. Corpus floors added. Required suite **92 → 103** |
| 2026-09-24 | Code complete | F-2 closed by a shared first-statement assertion in `tests/helpers/admin-page-guard.ts` (eight mutations proved, three legitimate shapes proved to pass); OI-21's property 1 asserted as R8 (four mutations proved); `npm run lint` made runnable and the repo's true state measured at 420 errors / 9,909 warnings without fixing any of it |
| 2026-09-24 | SA review | 🔄 Revision Required. Re-ran all 12 mutations against the real files through the required check; the 8 F-2 and 4 R8 results reproduced exactly. Found a ninth shape (a decoy signature inside a template literal: **92/92 green with the guard deleted**) and a tenth (a default-valued parameter shadowing the import). Found two legitimate edits the new assertion wrongly rejects (a return-type annotation on the component; a doc comment whose line starts with `'use client'`), plus a destructured result. R8's `>= 22` floor reddens when any admin page is deleted, and R8 forbids a server page that guards itself. Helper placement ruled sound; lint interim accepted, with `archive/` to be ignored before any gate and `no-console` (4,683 calls / 420 files) as the ratchet that matters. Confirmed no exemption, cap or ratchet widened and R1–R5 untouched |
| 2026-09-24 | SA re-check | 🔄 Revision Required. All prior findings verified fixed on the real files (103/103 for the three false positives; 1/102 for the ninth and tenth shapes; removing an admin page now green; R8 accepts a self-guarding page and rejects three lookalikes). **Found an eleventh shape: `importsCanonicalGuard` is the only predicate still reading unblanked source, so a decoy import string plus a real import from a no-op module is 103/103 green with the guard disabled (M1, must fix).** Found a new false positive created by the newline-at-depth-0 terminator (a binding wrapped onto the next line, 1/102 — M2), plus two unparseable-but-valid export spellings, an R8 offender message that now contradicts R8's own accepting clause, and a walk-equality that shares its filter with the scanner. Ruled the authoritative `no-console` baseline to be ESLint's own count — **4,658 findings / 410 files** — not either text scan |
| 2026-09-24 | SA final re-check | ✅ Approved with one condition. Gates re-run (112/112, both suites 176/176, build clean, lint 409/9,899/1 matching QA). All QA fixes reproduced on the real files, plus three new SA probes (a root-only skip name at depth is caught; nested templates, regex literals and CRLF produce no false positive). Precedence fix ruled **correct but not complete**: `stripComments` still has no regex-literal state, so `/[/*]/` opens a phantom block comment and deletes real code — SA demonstrated a `profiles.role` decision vanishing from R4's input, and `AnswerRenderer.ts:458` losing 22,686 of 40,701 non-newline characters today. Inherited, and **fails closed for R6** (1/111 in both the body and the parameter list), but the "0 files / 0 chars" figure is measured against a reference sharing the blind spot; a regex-aware reference over the same 2,526 files gives **28 files / 1,952 chars** (F1, condition of approval). Also: `stripComments` lacks the `${}` awareness `blankStringLiterals` now has (F2). Line-count and blank-length invariants verified across all 2,526 files, 0 violations. Scope split holds; R8's two-sided independence ruled real. Ruled **one PR, not two** |
