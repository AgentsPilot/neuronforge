# Follow-up: the planner snapshot is red every day, for ever

> **Last Updated**: 2026-09-22

**Raised by:** Dev, out of Business OS LLM admin-screen slice 1 (where it was found, confirmed pre-existing, and deliberately **not** fixed)
**Confirmed by:** SA (first slice-1 review) and QA (slice-1 report, DEF-7)
**Status:** ✅ Fixed on `fix/dated-snapshots` (test-only, 2026-09-22). **Not** part of the admin-screen feature.
**Size:** XS as scoped; the measured blast radius was wider than the diagnosis below — see “What was actually measured”.

## Overview

`lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts › T3-S › chat/planner` fails on every run and **will never pass again without a change**. It is red on `main` today, it was red before the admin-screen branch existed, and it is not date-*flaky*: it is **permanently** red, one day after the snapshot was recorded.

This matters more than one failing test. A suite that is always red trains everyone to skip it, and the same suite is the only thing proving — per call site, at the provider boundary — that Business OS calls obey their area row. That is the property Layer 2 exists to deliver. A permanently red guard is worse than an absent one.

---

## Evidence

**File:** `lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step3.test.ts.snap:44`

```
-           "content": "Today is 2026-09-21.
+           "content": "Today is 2026-09-22.
```

One line differs; everything else in the snapshot matches.

**Why it will not heal.** The value is derived per **UTC day**:

**File:** `lib/business-os/bizql/planner/Planner.ts:412-422`

```typescript
const todayInZone = new Intl.DateTimeFormat('en-CA', {
  timeZone: request.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const user = `Today is ${todayInZone}.\n` + …
```

So re-recording the snapshot (`-u`) buys exactly **one day**. It is red again tomorrow.

**Why only this one site.** The snapshot serialiser hashes any string over 200 characters:

**File:** `callParams.boundary.step3.test.ts:265-272` — `sha256:<hex> (len N)`.

The planner's **system** prompt is thousands of characters, so it is hashed and stable. Its **user** message is short, so it is stored raw — and it is the only snapshotted call site whose raw stored content carries a date. QA verified the other sites hash theirs, so **this will not spread**, but it also will not fix itself.

---

---

## What was actually measured (2026-09-22, on clean `origin/main` `737b52d1`)

The diagnosis above is right about the mechanism and right about the fix. It is
**wrong about the blast radius**, and the correction matters more than the fix does.

### The claim that was falsified

> “The planner’s **system** prompt is thousands of characters, so it is hashed and
> stable … QA verified the other sites hash theirs, so **this will not spread**.”

Hashing does not make a string stable. It makes an unstable string *unreadable*:
`sha256:… (len N)` moves exactly as freely as the text under it. Had a second call
site put the day into a long prompt, the snapshot would have rotted the same way and
the diff would have said nothing more useful than “the hash changed”. The reasoning
behind “this will not spread” — long means hashed means safe — does not hold, which is
why the fix normalises **before** the digest rather than after.

### Everything red on `main` today, and why

| Suite › case | Moving value | Same disease? |
|---|---|---|
| `callParams.boundary.step3` › `chat/planner` | Raw `Today is 2026-09-21.` in the stored user message, re-derived per UTC day | ✅ **Yes.** The only true date-rot site in the repo. |
| `callParams.boundary.step2` › `briefing/daily_narration` | `sha256:… (len 5155)` → `(len 7051)` | ❌ **No.** `BriefingNarrator.ts` gained 259 lines of prompt in `c1a427e6`, merged to `main` in `a0d0209d` on 2026-09-22. A real prompt change, never re-recorded. |
| `callParams.boundary.step2` › `intake/form_generation` | `sha256:… (len 2576)` → `(len 3365)` | ❌ **No.** Same merge; `IntakeGenerationService.ts` +59 lines. |
| `callParams.boundary.step3` › `chat/planner` (second cause) | System prompt `(len 22721)` → `(len 31334)`, new `prompt_cache_key`, larger entity/action enums | ❌ **No.** Catalog growth on `main`, on top of the date. |

`main` was red for **two independent reasons at once**, and the date was the smaller
of them. Proof that the two step-2 failures are not date-driven: the prompt strings
were dumped in full at the boundary and contain no date, time or timestamp anywhere
— a date/time grep matches nothing but the fixture’s literal `09:00` appointment time.

### The rest of the repo

Five `.snap` files exist; there are no inline snapshots at all.

| File | Verdict |
|---|---|
| `lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step3.test.ts.snap` | Was diseased — fixed |
| `…/callParams.boundary.step2.test.ts.snap` | No dates; two entries were stale for a production reason |
| `…/callParams.snapshot.test.ts.snap` | Clean — records only provider/model/temperature |
| `app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap` | Contains dates and is **immune**: the suite pins the clock with `jest.setSystemTime(NOW)` |
| `lib/analytics/__tests__/__snapshots__/aiAnalytics.trackAICall.test.ts.snap` | Same — pinned to `2026-09-18T10:00:00.000Z` |

The two boundary suites were the only snapshot suites in the repo that did **not**
pin the clock. That, not the length of any one prompt, is what singled them out.

### Does production put the date in the prompt?

**Yes, and it is correct.** `lib/business-os/bizql/planner/Planner.ts:412-422` derives
the day in the caller’s timezone and prepends `Today is …`; the planner’s own rules
tell the model to take the year from that line. Proved rather than assumed: with the
clock moved to 2031-03-07, production emitted `“Today is 2031-03-07.”` at the provider
boundary. **No production file was changed by this work.**

---

## Fix shape (suggested; SA to confirm)

**Test-only. No production change** — the date in the prompt is correct and load-bearing (the planner's own rules tell the model to take the year from the "Today is" line).

Extend the existing `normalise()` in the test so a calendar date becomes a placeholder, exactly as UUIDs already do one line above:

```typescript
if (UUID.test(value)) return '<uuid>';
if (ISO_DATE.test(value)) return value.replace(ISO_DATE, '<date>');   // ← add
```

with `const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;`, then re-record the snapshot once.

**Why this and not the alternatives:**

| Option | Verdict |
|---|---|
| Normalise the date in the serialiser | ✅ **Preferred.** Keeps the snapshot byte-exact about everything the test exists to prove (which model, which temperature, which messages), and drops only the one value that cannot be stable. Matches how `<uuid>` and the named-id table are already handled. |
| Inject a clock into `Planner.ts` | ❌ Production change to make a test pass, and it widens a constructor for one assertion. |
| Freeze time with `jest.useFakeTimers()` in that suite | 🟡 Workable, but it reaches into a suite that drives real provider-boundary code, and fake timers there have bitten other suites. Fallback if the serialiser change is rejected. |
| Re-record daily / delete the snapshot | ❌ The first is not a fix; the second removes the coverage the suite exists for. |

**Acceptance:** the suite passes today, and passes again with the system clock advanced a day (`TZ=UTC` plus a faked date in a scratch run is enough to prove it).

---

## What was done

1. **`normalise()` in both boundary suites** (`callParams.boundary.step2/step3.test.ts`)
   now replaces any ISO-8601 date with `<date>` (and a full timestamp with
   `<timestamp>`) **before** the long-string digest, so a date buried in a
   31k-character prompt cannot move the hash either. Everything else stays
   byte-exact, and `Today is <date>.` is still asserted verbatim around the placeholder.
   **`model` and `provider` are exempt** (SA review, required change): model ids
   carry dates - `gpt-4o-2024-08-06` is settable through `npm run bos:llm-settings`
   - and undating one would record `gpt-4o-<date>`, hollowing out the single
   assertion these suites exist to make while leaving no date for the guard to
   find. Proved both ways: with a dated planner model in the fixture the snapshot
   fails showing `gpt-4o-2024-08-06` verbatim, and the guard tolerates that line
   while still catching `Today is 2026-09-21.` in a prompt. SA measured the
   pattern's reach independently - replacing `undateString` with identity moves
   exactly one entry, 21 of 22 snapshots byte-identical - so it is otherwise narrow.
2. **Three snapshots re-recorded**, for two reasons that should not be confused:
   `chat/planner` because the placeholder changed its stored form, and the two
   step-2 entries because the production prompts genuinely changed on `main`.
   Applying the date normaliser changed **no other hash in either file**, which
   independently confirms that no other snapshotted string carried a date.
   SA upheld the re-record and put the reason on the record: `BriefingNarrator`'s
   `PROMPT_VERSION` went **3 -> 9** in `c1a427e6`, a self-declared authored rewrite,
   and only the `content` digests moved - `model`, `temperature`, `max_tokens`,
   roles and message order are byte-identical, so no Layer 2 property was
   overwritten and nothing needed reconciling. **What should have happened is that
   the re-record shipped in the same PR as the prompt change.** That is the lesson
   here; the normaliser is only the fix for the other half.
3. **A guard so it cannot come back**:
   `lib/business-os/llm/__tests__/snapshotsAreDateless.test.ts` reads every `.snap`
   in that directory as text and fails on any calendar date. It is mutation-checked
   — restoring `Today is 2026-09-21.` to the snapshot makes it fail with the file
   and line number.

## Proof that it is date-independent

The property is “passes on any date”, so it was run on other dates. A throwaway
`setupFilesAfterEnv` module (not committed) pinned `Date` construction and `Date.now()`
to `process.env.FAKE_NOW`, leaving timers alone:

| Clock | `lib/business-os/llm/__tests__/callParams*` |
|---|---|
| 2031-03-07 (future) | 3 suites, 106 tests, **23 snapshots passed** |
| 2199-12-31 (far future) | 3 suites, 106 tests, **23 snapshots passed** |
| 2019-11-02 (past) | 3 suites, 106 tests, **23 snapshots passed** |

Negative control: with the `normalise()` change reverted and the new snapshot kept,
the 2031 run fails with `+ “Today is 2031-03-07.”` — so the normalisation, not the
re-recording, is what carries the property.

One unrelated test (`modelSettings.test.ts` › “serves the last good settings”) fails
**only under that harness**, and only at a future date: it installs
`jest.useFakeTimers()` and calls `setSystemTime(Date.now() + CACHE_MS + 1)`, which does
not compose with a globally stubbed `Date`. It pins its own clock and passes on the
real one; the harness is a proof tool, not a guard.

## Follow-ups recorded, deliberately not built here

| # | Item | Why not now |
|---|---|---|
| 1 | **A per-suite clock harness should eventually replace the normaliser.** Pinning the clock (`jest.setSystemTime`, as `app/api/business-os/usage` and `lib/analytics` already do) is strictly stronger than a placeholder: it asserts the date **verbatim**, so it catches a *wrong* or *missing* date, which `<date>` cannot. It must be **per suite, not global** - `modelSettings.test.ts` calls `setSystemTime(Date.now() + CACHE_MS + 1)` itself and broke under the global harness, which is an argument for a suite owning its own clock, not against pinning. | A bigger change than a permanently red `main` justified; the normaliser + guard stop the bleeding today. |
| 2 | **`prompt_cache_key`** (`Planner.ts:541`) arrived in the same merge as the catalog growth: a new provider parameter carrying `bizchat-planner-<12 hex of a prompt hash>`. Reviewed and benign - a content hash of the system prompt and plan tool, no user data, stable across runs and dates. | Nothing to fix. Worth naming because **the snapshot caught a new parameter reaching the provider and nobody read the diff** - which is exactly what these suites are for. |
| 3 | **Make `lib/business-os/llm` a required check on `main`.** This whole episode is a concrete instance of the motivating problem in `chore/test-tiering`: a suite nothing runs in CI stayed red for days, for two unrelated reasons, and the second one (a prompt rewrite landing without its re-record) would have been caught at the merge that caused it. | **Nobody owns this today, and it should not be read as scheduled.** It belongs to `chore/test-tiering`, whose docs are committed on that branch (`be145ceb`) - which is **unpushed**, so the work depends on a branch that exists on one machine and has no named owner. Recorded here because this doc is reachable; the line still needs adding to that branch's workplan by whoever picks it up. |

## Known limits, recorded rather than built (all Low, none reachable today)

QA probed the guard and the exemption 49 ways. Nothing it found bites now, and the
reason they all stay harmless is one fact worth stating outright:

> **Every model in all 23 snapshots today is a plain string under the literal key
> `model`.** The moment that stops being true - a model under another key, inside a
> nested object, or in a positional argument - several of the limits below become
> live at once.

| # | Limit | Why it is harmless today |
|---|---|---|
| DEF-1 | The exemption is **exact-key**: `model` and `provider` only. `modelUsed`, `fallbackModel`, `image_model`, or a model passed positionally would be undated to `gpt-4o-<date>`. The guard and the normaliser also **disagree** about what counts as model-like - the normaliser matches keys, the guard matches a line containing `"model":`, which also covers `"modelUsed":`. | No such key appears at the provider boundary today; all 23 snapshots use the literal `model`. |
| DEF-2 | The guard's stated reach was wider than its real one. **Fixed** - see below. | - |
| DEF-3 | The exemption is **line-scoped**: a genuinely rotting date sharing a line with `"model":` is skipped. | The snapshot serialiser writes one field per line, so a prompt and a model id cannot share one. |
| DEF-4 | The guard is blind to dates inside `sha256:` digests, to `.snap` files in a subdirectory, and to inline snapshots. | The normaliser undates **before** digesting, so a digest cannot carry a date unless someone removes that; there are no subdirectories and no inline snapshots repo-wide. |
| DEF-5 | `normalise()` flattens non-plain objects (a `Map`, a class instance) to `{}` - pre-existing, not introduced here. | Everything on the wire today is plain JSON. |
| DEF-6 | **No CI job runs these suites**, so none of this is enforced anywhere but a developer's machine. | Not fixable here - it is follow-up 3 above, and follow-up 3 has no owner. |

### DEF-2, fixed: the guard now states its true reach

The header and the failure message previously said "any calendar date". QA mapped
what it actually catches:

> a contiguous `NNNN-NN-NN`, in plaintext, on a line that is not a `model`/`provider`
> line, in a `.snap` file directly in that one directory.

It misses `09/21/2026`, `2026/09/21`, `21.09.2026`, `26-09-21`, `21 Sep 2026`,
`20260921`, epoch milliseconds, a date split across a newline, a date inside a digest,
a date sharing a line with `"model":`, subdirectories, and inline snapshots.

The pattern was **not** widened to chase them, on purpose: a guard matching every date
shape starts flagging version strings and ids, and a noisy guard's failure mode is that
someone deletes it. Instead the file now says exactly what it catches, lists what it
does not, and states that a date in another format remains latent rot. The failure
message also carries the remedy ("normalise it, or pin the clock - do not just
re-record, that buys one day") plus a link here, because CI prints the message and
never the header comment.

## What this is NOT

- **Not caused by, and not fixable inside, the admin-screen slices.** Dev, SA and QA each confirmed it independently; QA's proof was stashing the entire working tree (`git stash push -u`) and reproducing the identical failure at a clean `d9c60ab4`.
- **Not a flake.** It fails deterministically, on every run, until the snapshot or the serialiser changes.

## SA Review — dated snapshots

**Reviewed by SA — 2026-09-22**
**Status:** ✅ Code Approved, with **one required change** — the fix is correct, proportionate, and takes `main` out of permanent red.

### Gates re-run by SA (not taken on report)

Run in the worktree `neuronforge-snapshot-fix` @ `fix/dated-snapshots` (off `737b52d1`).

| Gate | SA's result | Matches Dev's report |
|---|---|---|
| `npx jest lib/business-os/llm` — **before** (tracked files reverted to `737b52d1`) | 3 suites failed, 4 tests, **3 snapshots failed** (`boundary.step2` ×2, `boundary.step3` ×1), plus the new guard, which correctly fired on the old dated snapshot | ✅ (the guard's mutation check reproduced independently) |
| `npx jest lib/business-os/llm` — **after** | **14 suites, 341 tests, 23 snapshots — all pass** | ✅ |
| `npm run typecheck:bos-llm` | 171 files, 28 errors, **0 new** (one baseline entry is now fixed — `app/api/onboarding/build/route.ts` TS18047; unrelated, worth a separate `--update-baseline`) | ✅ |
| `npm run check:bos-llm-literals` | 38 files, 2 exempt, **0 violations** | ✅ |

`main` is green for these suites with the change applied and red without it. Confirmed.

### The blast radius of the normaliser, measured rather than argued

The claim that carries the whole design — "applying the date normaliser changed no other hash in either file" — is load-bearing, so SA re-derived it independently: `undateString()` was replaced with the identity function in both suites, the snapshots were re-recorded, and the result diffed against the Dev's.

**Exactly one entry moved** (`boundary.step3` › `chat/planner`, the user message); **21 of 22 snapshots were byte-identical**. So the normaliser today erases precisely one string in the whole snapshot corpus — no digest, no model id, no fixture date is touched. The worktree was restored afterwards and re-verified green (`git diff --stat` back to 4 files / 82 insertions / 13 deletions).

That settles the over-reach question empirically: **the trade is right and costs nothing measurable today.** The residual risk is future, and is what the required change below closes.

---

### Ruling: were the two stale step-2 snapshots right to re-record?

**Yes — re-recording is correct here, and nothing needed reconciling with the other workstream first.** Two facts decide it, both checked rather than assumed:

1. **The change was authored and self-declared.** `BriefingNarrator.PROMPT_VERSION` went **3 → 9** in `c1a427e6` (merged via `a0d0209d`, PR #95). The author bumped it six revisions. This is a deliberate prompt rewrite by another workstream, not a regression that slipped through.
2. **No Layer 2 property was overwritten.** In both re-recorded step-2 entries **only the `content` digests moved**. `model`, `temperature`, `max_tokens`, the message roles and their order are byte-identical to the previous snapshot. The property this suite exists to prove — which model, which temperature, per call site, at the provider boundary — never changed. What changed is prompt text, which the suite records but does not govern.

One genuinely new thing did appear in step 3 and deserves to be named rather than absorbed into a re-record: the planner now sends a **`prompt_cache_key`** it did not send before (`Planner.ts:541`, `bizchat-planner-${plannerVersion()}` — a hash of the system prompt; no user data, no owner text). That is exactly the "a parameter a wrapper adds between the call site and the provider" case this boundary was built to surface. It is acceptable — and it is acceptable **because someone looked**. The guard did its job even while red: the diff was read, classified and explained before being overwritten. That is the correct use of a re-record.

**What should have happened earlier:** the prompt change should have been merged *with* its snapshot re-record, in the same PR, by the author who bumped `PROMPT_VERSION`. It wasn't, because the suite cannot block a merge (see below).

### Does this episode change what the boundary snapshots are for?

**No change of purpose; a change of status.**

They are a **change detector, never a correctness oracle.** They cannot distinguish an authored prompt change from a regression, and never could — the Dev needed `git log` plus a full prompt dump to tell the two apart, which is the expected cost of the method, not a defect in it. Their entire value is *forcing a human to classify a diff before it reaches a provider.*

That forcing function has two preconditions, and this episode is both of them failing at once:

- **The suite must be able to block.** Jest is not a required check on `main`, so a request-shape change reached `main` unclassified.
- **The suite must be green by default.** Date rot made it permanently red, so its red carried no information and blended into the ambient red — which is the mechanism by which the first failure went unnoticed.

So the conclusion is not "the boundary snapshots are weaker than SA thought". It is: **a change detector that cannot block a merge is decoration.** The method ruled on through Steps 2 and 3 — capture unwired, replay wired; the whole request object plus the call count — is unchanged and still right. What is missing is enforcement, and the remedy is procedural, not a smarter serialiser.

---

### Required change (1)

1. **`callParams.boundary.step2/step3.test.ts` — `normalise()` must not undate the `model` field.** — Priority: **Medium-High**, ~5 lines, ship in this PR.
   `undateString()` is applied to every string in the request, key-blind. Dated model ids are a real OpenAI convention (`gpt-4o-2024-08-06`, `gpt-4-turbo-2024-04-09`); a model is an operator-settable free string of up to `MAX_MODEL_NAME_LENGTH` via `npm run bos:llm-settings`; and the boundary's *primary* assertion is which model each call site puts on the wire. If anyone ever pins a dated model version, the snapshot silently records `gpt-4o-<date>` and stops asserting the one thing it exists for — and `snapshotsAreDateless.test.ts` can never catch it, because the normaliser erased the date before the snapshot was written. No dated model id exists in the repo today, so this is cheap to prevent now and expensive to discover later.
   Make `normalise` key-aware and skip `undateString` when the key is `model` (and `provider`). Nothing else needs exempting: the pattern requires a literal `NNNN-NN-NN`, which no version string, uuid or `prompt_cache_key` in this corpus matches — verified by the identity-function experiment above.

### Ruling: should a permanent clock-pinning harness ship?

**Yes — but per-suite, not global, and as a follow-up rather than inside this PR.**

- **Not the throwaway harness as written.** A repo-wide `setupFilesAfterEnv` that stubs `Date` is the wrong shape, and `modelSettings.test.ts` › "serves the last good settings" proves it: a suite that pins its own clock with `jest.useFakeTimers()` + `setSystemTime` must keep owning its clock. That failure is an argument against a *global* harness. It is not an argument against pinning, and it must not be read as one.
- **The right shape** is the convention the rest of the repo already follows (`app/api/business-os/usage`, `lib/analytics`): the two boundary suites pin their own clock to a fixed future instant, in-file, leaving every other suite alone.
- **It is strictly stronger than the normaliser, and would replace it.** A pinned clock asserts `Today is 2031-03-07.` *verbatim*, so it catches the two cases a placeholder cannot: a call site that starts sending the **wrong** date (a timezone or off-by-one regression in the `Intl.DateTimeFormat` call at `Planner.ts:405-422` — exactly the bug class that code is exposed to), and one that starts sending a date it never sent.
- **Sequencing:** ship this PR as-is (with the required change), because it is what takes `main` out of red today. Open the clock pin as a follow-up, and when it lands, narrow or retire `undateString` rather than keep both. Two mechanisms for one property will drift.

### Optimisation suggestions

- **The real fix is enforcement, not serialisation.** `lib/business-os/llm` should be a required status check on `main`, as `Admin authz surface guard` and the Layer 2 literal gate already are. Without it, this recurs with a different moving value. This is the highest-value item in this review and is larger than this PR — it belongs to the test-tiering workstream (`chore/test-tiering`), which should be told this episode is a concrete instance of its motivating problem.
- **Re-record protocol.** A commit that re-records a boundary snapshot should name, in its message, the commit that moved the hash and why it is authored. Where the producer already exposes a semantic handle — `BriefingNarrator.PROMPT_VERSION` — snapshot it alongside the digest, so the diff reads "prompt version 3 → 9" instead of "the hash changed". That is the cheapest way to make the next classification take minutes rather than an afternoon.
- **`snapshotsAreDateless.test.ts` — scoping is right, three nits.** Restricting it to its own `__snapshots__` directory is correct: the two clock-pinned suites elsewhere *should* record dates, and a repo-wide version would wrongly condemn them. The header comment already says so, which handles the "will it mislead anyone" risk for anyone who opens the file. But: (a) the **failure message** should carry the remedy, not just the offending `file:line` — CI output rarely shows a header comment; say "normalise the date or pin the clock — see `FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md`". (b) `readdirSync` at module scope throws at collection time if the directory ever disappears, so the "a silent empty glob would prove nothing" test cannot report it — wrap it and return `[]`. (c) The guard sees `NNNN-NN-NN` only; an epoch-millisecond timestamp (`1790109595397`) or a bare time-of-day is the same disease in a shape it will not catch. Worth one line in the header as a known limit, rather than a broader pattern that would false-positive on ids.

### Verified untouched and unchanged

- **No production file is touched.** The change set is 4 modified test/snapshot files plus 2 new untracked files (this document and the guard test): `git diff --stat` = 4 files, 82 insertions, 13 deletions, all under `lib/business-os/llm/__tests__/`.
- **Production is correct as it stands.** `Planner.ts:405-422` derives the day in the caller's timezone, and the comment gives the reason the line sits in the **user** message rather than the system prompt: `plannerVersion()` hashes the system prompt into the plan-cache key, so a date up there would invalidate every cached plan at midnight, every night. That is a good reason, independently verified, and no production change is warranted.
- **Expected conflict.** This document also exists on the unmerged admin-screen branch (`e429660a`, 86 lines). A conflict there is expected, and should be resolved by taking **this** version whole — the admin-screen copy predates the measurement and still carries the falsified "this will not spread" claim.

### Code Approved for QA: Yes — conditional on the `model`-field exemption being applied first.

---

## QA Test Report — dated snapshots

**QA — 2026-09-22**
**Test mode:** full
**Strategy used:** B (integration — the suites under test are Jest + provider-boundary spies) + C (standalone probe harnesses: a clock-pinning `setupFilesAfterEnv`, an extracted copy of the real `normalise()`, and a crafted `.snap` dropped into the guard's own directory). E2E/Playwright does not exist in this repo and no UI is involved.
**Focus:** schema/serialisation correctness of a test-only change, plus regression accounting
**Skipped:** none
**Input source:** prompt keywords (explicit 7-point brief)
**Worktree:** `neuronforge-snapshot-fix` @ `fix/dated-snapshots`, off `origin/main` `737b52d1`. **Nothing committed.** Every mutation below was made, measured and reverted; the tree was byte-restored and re-verified green after each.

---

### 1. Gates, before and after — run by QA, not taken on report

| Gate | Before (tracked files at `737b52d1`, guard file moved aside) | After (`fix/dated-snapshots`) |
|---|---|---|
| `npx jest lib/business-os/llm` | **FAIL** — 2 suites failed, 13 total; 3 tests failed, 337 total; **3 snapshots failed**, 20 passed | **PASS** — **14 suites, 341 tests, 23 snapshots, all green** |
| `npm run typecheck:bos-llm` | (unchanged — no production file in scope moved) | **passed** — 171 files, 28 errors, **0 new** |
| `npm run check:bos-llm-literals` | (unchanged) | **passed** — 38 files, 2 exempt, **0 violations** |
| `npx jest app/api/business-os/usage lib/analytics/…trackAICall` (the other two snapshot suites) | n/a — untouched by this change | **PASS** — 3 suites, 44 tests, 9 snapshots |

The three before-state failures reproduce the diagnosis exactly:

```
FAIL callParams.boundary.step2.test.ts
  ● … briefing/daily_narration
  ● … intake/form_generation
FAIL callParams.boundary.step3.test.ts
  ● … chat/planner
Snapshots: 3 failed, 20 passed, 23 total
```

`typecheck:bos-llm` still reports `1 baseline entry is fixed; consider --update-baseline` (`app/api/onboarding/build/route.ts` TS18047). Pre-existing, unrelated, already named by SA. Not a defect of this change.

---

### 2. Attacking the normaliser's exemption — the crux

`normalise()` was extracted from `callParams.boundary.step3.test.ts` **as source text** (not retyped) into a standalone harness and driven with 28 crafted inputs.

#### The two required directions, proved independently

| # | Probe | Result | Verdict |
|---|---|---|---|
| P1 | `{ model: 'gpt-4o-2024-08-06' }` | `"model":"gpt-4o-2024-08-06"` | ✅ **verbatim, not `gpt-4o-<date>`** |
| P2 | `{ content: 'Today is 2026-09-21.' }` | `"content":"Today is <date>."` | ✅ **replaced** |

And **end-to-end through the real pipeline**, not just the extracted function: the seeded chat row's planner model was temporarily set to `gpt-4o-2024-08-06` and the real suite driven. The snapshot failed showing

```
-       "model": "gpt-4o-mini",
+       "model": "gpt-4o-2024-08-06",
```

— verbatim. **The suite's primary assertion survives a dated model id.** SA's required change does what it was asked to do. Fixture restored.

#### Trying to defeat the exemption

| # | Attack | Result | Verdict |
|---|---|---|---|
| P3 | dated model **inside an array** — `model: ['gpt-4o-2024-08-06', …]` | verbatim | ✅ the key-into-array propagation works |
| P4 | dated model in a **nested object** under `model` — `model: { name: … }` | `gpt-4o-<date>` | ⚠️ **exemption lost** — DEF-1(b) |
| P5 | `settings: { model: 'gpt-4o-2024-08-06' }` (nested, own key) | verbatim | ✅ |
| P6 | a date as an **object key**, `{ '2026-09-21': … }` | **not replaced** (keys are never normalised) | ⚠️ normaliser miss — **but the guard catches it** (G15) |
| P7 | `modelUsed: 'gpt-4o-2024-08-06'` | `gpt-4o-<date>` | ⚠️ **DEF-1(c)** |
| P8 | `fallbackModel: 'gpt-4o-2024-08-06'` | `gpt-4o-<date>` | ⚠️ **DEF-1(c)** |
| P9 | `image_model: 'gpt-image-1-2025-04-15'` | `gpt-image-1-<date>` | ⚠️ **DEF-1(c)** |
| P10 | `provider: 'openai-2026-09-21'` | verbatim | ✅ intended |
| P11 | dated model as a **bare positional argument** (key `undefined`) | `gpt-4o-<date>` | ⚠️ **DEF-1(a)** |
| P12 | dated model at args position 1 | `gpt-4o-<date>` | ⚠️ **DEF-1(a)** |
| P13 | `model` key on an element **inside** `messages: [...]` | verbatim | ✅ |
| P17 | array under `model` holding objects — `model: [{ id: … }]` | `gpt-4o-<date>` | ⚠️ DEF-1(b) |
| P18 | a **prompt** inside an array under `model` | date **kept** | ⚠️ exemption over-reaches — **guard catches it** (G16) |
| P19 / P20 | a `Set` / a `Date` object as a value | both flatten to `{}` | ⚠️ **DEF-5** (pre-existing) |

**Is DEF-1 reachable today? No.** Every model in all 23 snapshots across all three `.snap` files is a plain string under the literal key `model` — including the image call (`"model": "gpt-image-1"`) and the settings-resolver suite. Verified by reading the corpus, not assumed.

#### The load-bearing behaviour — a date inside a hashed prompt

| # | Probe | Result |
|---|---|---|
| P14 | `'Today is 2026-09-21. ' + 'x'.repeat(300)` | `sha256:80e995e1… (len 317)` |
| P15 | **same prompt, 2031-03-07** | `sha256:80e995e1… (len 317)` — **identical digest** |

✅ **The before-the-digest placement is real, and it is the only thing that protects a long prompt.** This is the claim the whole design rests on, and it holds.

---

### 3. Attacking the dateless guard

A crafted `zzQaProbe.test.ts.snap` with 17 cases was dropped into the guard's **own** `__snapshots__` directory, so the real glob, the real regex and the real exemption were exercised end-to-end. Deleted afterwards; directory verified back to 3 files.

| # | Probe | Caught? | Verdict |
|---|---|---|---|
| G01 | `"content": "Today is 2026-09-21."` | ✅ **caught** (`:6`) | **required behaviour — works** |
| G02 | `"model": "gpt-4o-2024-08-06"` | ✅ **tolerated** | **required behaviour — works** |
| G03 | `"provider": "openai-2026-09-21"` | ✅ tolerated | intended |
| G04 | `fallbackModel` / `image_model` / `modelUsed` with dated ids | ✅ caught (`:30–32`) | ⚠️ **the guard and the normaliser disagree about which keys are model-like** — see DEF-1 |
| G11 | `"updated_at": "2026-10-03T00:00:00.000Z"` | ✅ caught | timestamps are covered |
| G15 | date as an object key | ✅ caught | backstops P6 |
| G16 | date in an array under `model` | ✅ caught | backstops P18 |
| G05 | US `09/21/2026` | ❌ **missed** | DEF-2 |
| G06 | European `21.09.2026` | ❌ missed | DEF-2 |
| G07 | two-digit year `26-09-21` | ❌ missed | DEF-2 |
| G08 | slashed ISO `2026/09/21` | ❌ missed | DEF-2 |
| G09 | long form `21 Sep 2026` | ❌ missed | DEF-2 |
| G17 | compact `20260921` | ❌ missed | DEF-2 |
| G10 | a date **split across a line break** (`2026-\n09-21`) | ❌ missed | DEF-2 (the guard is line-scoped; so is the normaliser's regex) |
| G12 | epoch ms `1790109595397` | ❌ missed | DEF-2 — SA nit (c), **not applied** |
| G13 | a date **inside a digest** | ❌ **structurally impossible to catch** | DEF-4 |
| G14 | a date on the **same line** as `"model":` | ❌ missed | DEF-3 — exemption is line-scoped, not value-scoped |

**Glob reach, measured:**

| Probe | Result |
|---|---|
| `.snap` in a **subdirectory** of `__snapshots__` | ❌ missed — `readdirSync` is non-recursive. Jest never creates one, so theoretical. |
| a non-`.snap` file | ❌ missed — by design |
| **inline snapshots** (`toMatchInlineSnapshot`) in the same directory | ❌ **unguarded** — the date would live in the `.test.ts` file, which the guard never reads. **Zero inline snapshots exist anywhere in the repo today** (grepped `lib`, `app`, `components`), so this is latent, not live. |
| the two clock-pinned suites elsewhere (`app/api/business-os/usage`, `lib/analytics`) | out of scope **correctly** — they *should* record dates |

**Mutation-check, reproduced independently rather than taken on report:** with `undateString` neutered and the snapshot re-recorded at a 2031 clock, the guard fails on the real corpus naming the file. It is not a test that can only pass.

**The true boundary, stated plainly:** the guard catches *a contiguous ISO-8601 `NNNN-NN-NN`, visible as plaintext, on a line that does not also contain `"model":` or `"provider":`, in a `.snap` file directly inside `lib/business-os/llm/__tests__/__snapshots__`.* That is narrower than "any calendar date", which is what the guard's own header and this document both claim — see DEF-2. The narrower statement is still a genuinely useful guard; the over-claim is the problem, because the guard's entire value is that people trust it.

---

### 4. Date independence — re-proved by QA

A throwaway `setupFilesAfterEnv` module (scratchpad only, **not** in the repo) pinned `new Date()` and `Date.now()` to `FAKE_NOW`, leaving timers alone, via a temporary Jest config that spreads the real one.

| Clock | `lib/business-os/llm/__tests__/callParams*` |
|---|---|
| 2031-03-07 (future) | 3 suites, **106 tests, 23 snapshots — pass** |
| 2199-12-31 (far future) | 3 suites, **106 tests, 23 snapshots — pass** |
| 2019-11-02 (past) | 3 suites, **106 tests, 23 snapshots — pass** |
| 2026-09-23 (tomorrow — the case that broke `main`) | 3 suites, **106 tests, 23 snapshots — pass** |

**Negative control — the part that proves the harness is not a no-op.** `undateString` was replaced with the identity function in `step3` while keeping the new snapshots, at a 2031 clock:

```
● T3-S … › chat/planner
-           "content": "Today is <date>.
+           "content": "Today is 2031-03-07.
Snapshots:   1 failed, 2 passed
```

✅ The clock harness genuinely moves the date, **and the normalisation — not the re-recording — is what carries the property.** Both directions of the Dev's claim reproduce.

`modelSettings.test.ts` › "serves the last good settings" fails **only** under that global harness (it calls `jest.useFakeTimers()` + `setSystemTime(Date.now() + CACHE_MS + 1)` itself). Reproduced. That is an argument for follow-up #1 being **per-suite**, exactly as recorded — not an argument against pinning.

---

### 5. Snapshot diff accounting — every changed entry

Each `.snap` was parsed into named entries at `origin/main` and here, and compared entry by entry (not line by line):

| File | Entries on `main` | Entries now | **Changed** | Added | Removed |
|---|---|---|---|---|---|
| `callParams.boundary.step2.test.ts.snap` | 19 | 19 | **2** | 0 | 0 |
| `callParams.boundary.step3.test.ts.snap` | 3 | 3 | **1** | 0 | 0 |
| `callParams.snapshot.test.ts.snap` | 1 | 1 | **0** | 0 | 0 |

**Exactly 3 of 23 entries moved. Nothing was added, nothing removed, nothing else re-recorded.** The claim holds.

Accounting for each, and for **every line inside** them:

| Entry | What moved | Attributable to | Verified how |
|---|---|---|---|
| `step2 › briefing/daily_narration` | `content` digest only, `(len 5155)` → `(len 7051)` | Production prompt growth on `main` | `BriefingNarrator.PROMPT_VERSION` **3 → 9** in `c1a427e6` — confirmed by QA with `git log -L`. `model`, `temperature`, `max_tokens`, roles and order byte-identical. |
| `step2 › intake/form_generation` | `content` digest only, `(len 2576)` → `(len 3365)` | Same merge | Same — only the digest line differs in the diff |
| `step3 › chat/planner` | **four** distinct changes: (i) `Today is 2026-09-21.` → `Today is <date>.`; (ii) system digest `(len 22721)` → `(len 31334)`; (iii) a **new** `prompt_cache_key`; (iv) the `entity` and `action` enums grew (and `entity` reordered) | (i) **this fix**; (ii)–(iv) pre-existing production drift already red on `main` | The before-state failure diff shows (ii)–(iv) failing at `737b52d1` *without* this change. Nothing was absorbed that was not already visibly red. |

**The critical cross-check — did the fix itself move any digest?** Reproduced SA's identity-function experiment independently and in both files:

- `step2` with `undateString` → identity, run against the **shipped** snapshots: **PASS, 78 tests, 19 snapshots.** The normaliser touches nothing in step 2 — so both step-2 re-records are 100% production, 0% fix.
- `step3` with `undateString` → identity: fails on **exactly one line**, the planner user message.

So the normaliser erases precisely **one string in the entire 23-snapshot corpus**. SA's "21 of 22 byte-identical" reproduces.

⚠️ One thing worth naming, though it is correctly recorded in this document's own "What was actually measured" table: the `chat/planner` re-record is **not** a date-only re-record. It swallowed a new provider parameter and a catalog expansion in the same commit. That was read and classified before being overwritten (which is the correct use of a re-record), but a reader who only sees "3 snapshots re-recorded, one for a date" would under-count it.

---

### 6. Production untouched, and `prompt_cache_key`

**No production file is touched.** `git status --porcelain` is 4 modified + 2 untracked, every one of them under `lib/business-os/llm/__tests__/` or `docs/`:

```
 M lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step2.test.ts.snap
 M lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step3.test.ts.snap
 M lib/business-os/llm/__tests__/callParams.boundary.step2.test.ts
 M lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts
?? docs/workplans/FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md
?? lib/business-os/llm/__tests__/snapshotsAreDateless.test.ts
```

Filtering that list for anything outside `__tests__/` and `docs/` returns nothing. ✅

**`prompt_cache_key` is what it claims to be.** `Planner.ts:541` sends `bizchat-planner-${plannerVersion()}`, and `plannerVersion()` (`planTool.ts:506-512`) is:

```typescript
return createHash('sha256')
  .update(PLANNER_SYSTEM_PROMPT)
  .update(JSON.stringify(buildPlanTool()))
  .digest('hex')
  .slice(0, 12);
```

Both inputs are module-level static constructs — `buildPlanTool()` takes no arguments and is not keyed on the caller. **No user id, no business data, no owner text and no request content reaches the key**, and it is stable across runs and across dates (it recorded identically in all four clock runs). ✅ The assessment recorded in follow-up #2 is accurate.

**Production's date handling is correct and should not change.** `Planner.ts:412-422` derives the day in the caller's timezone and the planner's rules tell the model to read the year from that line; the comment at `:445` gives the reason it sits in the **user** message rather than the system prompt (a date in the system prompt would invalidate every cached plan at midnight, nightly, because `plannerVersion()` hashes it). Independently confirmed at a 2031 clock: production emitted `Today is 2031-03-07.` at the provider boundary.

---

### Test coverage against the acceptance criterion

The stated acceptance was: *"the suite passes today, and passes again with the system clock advanced."*

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| The three failing tests pass | ✅ | **Pass** | 14 suites / 341 tests / 23 snapshots green; red at `737b52d1` |
| Passes with the clock advanced | ✅ | **Pass** | 2031, 2199, and 2026-09-23 (the day that would have broken it again) |
| Passes with the clock moved back | ✅ | **Pass** | 2019-11-02 |
| The property comes from the normaliser, not the re-record | ✅ | **Pass** | Negative control fails with `+ "Today is 2031-03-07."` |
| A dated **model id** records verbatim | ✅ | **Pass** | Proved twice — extracted function (P1) **and** end-to-end through the real pipeline with a dated seeded model |
| A date in a **prompt** is still replaced | ✅ | **Pass** | P2; and P14/P15 prove it inside a >200-char hashed prompt |
| The guard catches a date in a prompt | ✅ | **Pass** | G01, plus a mutation-check on the real corpus |
| The guard tolerates a dated model id | ✅ | **Pass** | G02 |
| No production file changed | ✅ | **Pass** | 4 test files + 2 docs/test additions, nothing else |
| No unaccounted snapshot re-record | ✅ | **Pass** | 3 of 23 entries, 0 added, 0 removed, each attributed |
| `typecheck:bos-llm` / `check:bos-llm-literals` clean | ✅ | **Pass** | 0 new errors, 0 violations |
| The guard catches **any** calendar date | ⚠️ | **Partial** | ISO-8601 only — see DEF-2 |

---

### Issues found

#### Bugs (must fix before commit)

**None.** No defect below is reachable by any code path that exists today, and none of them blocks the change from doing what it is for.

#### Should fix (cheap now, expensive to discover later)

1. **DEF-2 — the guard claims more than it catches.** Severity: **Medium** (documentation/trust, not behaviour). File: `lib/business-os/llm/__tests__/snapshotsAreDateless.test.ts`, and this document.
   - Expected (per the guard's own header, "fails on any calendar date", and this document's "fails on any calendar date"): any calendar date is caught.
   - Actual: only a contiguous ISO `NNNN-NN-NN`. Measured misses: `09/21/2026`, `2026/09/21`, `21.09.2026`, `26-09-21`, `21 Sep 2026`, `20260921`, epoch-ms `1790109595397`, and a date split across a newline. The **normaliser has the identical blind spots**, so a non-ISO date would both rot *and* go unguarded.
   - Why it matters: the guard's whole value is that a future reader trusts it. A guard that over-states its reach is worse than one that states a narrow reach honestly. **SA nit (c) asked for exactly this line in the header and it was not applied.**
   - Fix: narrow the wording to "any ISO-8601 calendar date" in both places and add SA's known-limits line. Do **not** broaden the regex — a wider pattern would false-positive on ids and version strings. No such date exists in the corpus today (verified).

2. **DEF-1 — the `model` exemption is keyed on an exact key name, and three near-misses lose it.** Severity: **Low** (unreachable today). File: `callParams.boundary.step2/step3.test.ts`.
   - `modelUsed`, `fallbackModel`, `image_model` (P7/P8/P9), a bare positional string argument with no key (P11/P12), and a string nested in an object under `model` (P4/P17) all record a dated model as `gpt-4o-<date>` — the precise hollowing SA's required change exists to prevent, and one the guard can never catch because the date is erased before the file is written.
   - Not reachable today: **every** model in all 23 snapshots is a plain string under the literal key `model`, including the image call. Verified by reading the corpus.
   - Note the two mechanisms **disagree**: the guard *does* flag `fallbackModel` / `image_model` / `modelUsed` lines (G04) while the normaliser does not exempt them. Whichever way it is settled, settling it now costs one line. The asymmetry between arrays (exempt, P3) and nested objects (not exempt, P4) is the same issue.

3. **DEF-6 — nothing runs these suites in CI.** Severity: **Medium** (process; correctly recorded as follow-up #3, but worth a QA-side number because it bounds what this fix achieves). Verified: `.github/workflows/` contains `admin-authz-guard.yml`, `bos-llm-typecheck.yml`, `build.yml`, `plugin-tests.yml`, `react-hooks-guard.yml` — **none runs Jest over `lib/business-os/llm`**. This fix removes today's red; it does **not** stop the other half of the episode (a prompt change merged without its re-record) from recurring tomorrow.

#### Edge cases (nice to fix)

4. **DEF-3 — the guard's exemption is line-scoped, not value-scoped.** Severity: **Low**. Any date on a line that also contains `"model":` or `"provider":` is invisible (G14). Not reachable under Jest's pretty-format, which puts one key per line.
5. **DEF-4 — the guard is structurally blind to three shapes**: a date inside a digest (G13 — the only protection there is the normaliser's before-digest placement, which QA confirmed works); **inline snapshots** in the same directory (zero exist repo-wide today, so latent); and `.snap` files in a subdirectory (`readdirSync` is non-recursive; Jest never creates one). Worth one line in the header alongside DEF-2's.
6. **DEF-5 — `normalise` flattens any non-plain object to `{}`.** Severity: **Low**, **pre-existing and not introduced here**. A `Date`, `Map` or `Set` in a request records as `Object {}` (P19/P20) — which both hollows the assertion and hides a date from the guard.
7. **DEF-7 — SA's other two guard nits were not applied.** Severity: **Low**. (a) the failure message gives `file:line` but no remedy, and CI output does not show the header comment; (b) `readdirSync` at module scope throws at collection time if the directory disappears, so the "a silent empty glob would prove nothing" test cannot report it.

---

### What the user must check

**Nothing new.** This change is test-only: no production file, no migration, no environment variable, no deploy-time behaviour, no feature flag. It cannot change what a user or operator sees, and there is no post-deploy check to owe. That is unusual for this project and is worth stating explicitly.

### Are the three recorded follow-ups actionable?

| # | Item | Accurate enough to act on later? |
|---|---|---|
| 1 | Per-suite clock harness eventually replaces the normaliser | ✅ **Yes, and its supporting evidence reproduces.** QA independently confirmed `modelSettings.test.ts` fails under a *global* clock and passes under the real one — so the "per suite, not global" instruction is grounded, not stylistic. The entry also correctly records *why* pinning is stronger (it catches a **wrong** or **missing** date, which `<date>` cannot) and that the normaliser should be retired rather than kept alongside it. One thing to add when it is picked up: **DEF-2's true boundary**, since a clock pin makes the date-format question moot and would supersede DEF-2 as well. |
| 2 | `prompt_cache_key` caught-but-unread | ✅ **Yes, and the finding is correct.** QA verified the hash inputs at source; no user data. The entry is filed as "nothing to fix", which is right, and its real point — *the snapshot caught a new provider parameter and nobody read the diff* — is the durable lesson and is stated. |
| 3 | Make `lib/business-os/llm` a required check | ✅ **Yes, and it is the highest-value item.** QA confirmed no workflow runs these suites (DEF-6). The entry correctly notes the blocker: `chore/test-tiering`'s docs are committed at `be145ceb` and unpushed, so the line still needs adding on that branch. **That is an open loop with no owner in this document** — if that branch stalls, this follow-up silently disappears. Worth naming an owner or opening it as its own item. |

---

### Test outputs / logs

```
# BEFORE — tracked files at origin/main 737b52d1, guard moved aside
FAIL lib/business-os/llm/__tests__/callParams.boundary.step2.test.ts
  ● T2-S … › briefing/daily_narration
  ● T2-S … › intake/form_generation
FAIL lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts
  ● T3-S … › chat/planner
Test Suites: 2 failed, 11 passed, 13 total
Tests:       3 failed, 334 passed, 337 total
Snapshots:   3 failed, 20 passed, 23 total

# AFTER — fix/dated-snapshots
Test Suites: 14 passed, 14 total
Tests:       341 passed, 341 total
Snapshots:   23 passed, 23 total

# Guard probe — crafted .snap in the guard's own directory
× zzQaProbe.test.ts.snap records no calendar date
  + zzQaProbe.test.ts.snap:6:   "content": "Today is 2026-09-21.",
  + zzQaProbe.test.ts.snap:30:  "fallbackModel": "gpt-4o-2024-08-06",
  + zzQaProbe.test.ts.snap:31:  "image_model": "gpt-image-1-2025-04-15",
  + zzQaProbe.test.ts.snap:32:  "modelUsed": "gpt-4o-2024-08-06",
  + zzQaProbe.test.ts.snap:89:  "updated_at": "2026-10-03T00:00:00.000Z",
  + zzQaProbe.test.ts.snap:121: "2026-09-21": "value",
  + zzQaProbe.test.ts.snap:130: "Today is 2026-09-21.",
# … and NOT reported: the dated "model"/"provider" lines (correct), every
#   non-ISO format, the newline-split date, the epoch ms, the digest, and the
#   date sharing a line with "model".

# Negative control — undateString neutered, new snapshot kept, clock at 2031
-           "content": "Today is <date>.
+           "content": "Today is 2031-03-07.

# End-to-end crux — dated model through the real pipeline
-       "model": "gpt-4o-mini",
+       "model": "gpt-4o-2024-08-06",     ← verbatim, not gpt-4o-<date>
```

---

### Final status

- [x] **All acceptance criteria pass — ready for commit.**
- [ ] Issues found — Dev must address before commit

**Ship — yes.** The change does exactly what it claims, it is test-only, it is measurably narrow (it erases one string in a 23-snapshot corpus), the date-independence property was re-proved from scratch rather than taken on report, and every re-recorded entry is accounted for. **No High-severity defect is open, and no defect above is reachable by code that exists today.**

Two caveats on the record, neither blocking:

1. **DEF-2 should be folded in before merge if it is free to do so** — it is a wording change plus SA's already-requested known-limits line, no behaviour. A guard people over-trust is the one failure mode that would reproduce this whole episode.
2. **This fix stops the bleeding; it does not close the wound.** `main` went red for *two* independent reasons and only one of them was the date. The other — a prompt rewrite merged without its snapshot re-record — is untouched by anything in this change and will recur, because **no CI job runs these suites** (DEF-6). Follow-up #3 is the fix, and it currently depends on an unpushed branch with no named owner.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | QA report | Full QA on the dated-snapshot fix, in the `neuronforge-snapshot-fix` worktree, nothing committed. Gates re-run before (3 snapshots failed) and after (14 suites / 341 tests / 23 snapshots green), plus the two clock-pinned snapshot suites elsewhere. The `model`/`provider` exemption attacked 28 ways and proved in both directions, including end-to-end with a dated seeded model (records `gpt-4o-2024-08-06` verbatim). The dateless guard attacked 17 ways via a crafted `.snap` in its own directory; its true boundary is "a contiguous ISO date, in plaintext, off a model/provider line" - narrower than the "any calendar date" both the guard header and this doc claim (DEF-2). Date independence re-proved at 2031 / 2199 / 2019 / 2026-09-23 with an independent clock harness, plus the negative control. Snapshot accounting: exactly 3 of 23 entries moved, 0 added, 0 removed, each attributed; the normaliser itself erases exactly one string in the whole corpus (reproduced in both files). Production untouched and `prompt_cache_key` verified to be a hash of static inputs only. **Ship - yes**, 7 defects, none High, none reachable today. |
| 2026-09-22 | SA review | Code Approved with one required change (exempt the `model` field from date normalisation). SA re-ran every gate and re-derived the normaliser’s blast radius independently — exactly one snapshot entry is affected, 21 of 22 byte-identical. Ruled the two step-2 re-records correct (`PROMPT_VERSION` 3 → 9; only `content` digests moved, every Layer 2-governed field byte-identical), and ruled that a permanent clock pin should ship per-suite as a follow-up and then replace the normaliser. |
| 2026-09-23 | QA review applied | DEF-2 fixed: the guard's header and failure message now state its true, narrow reach and name what it misses, and the message carries the remedy. SA's remaining nits taken (remedy in the failure output; `readdirSync` wrapped so a missing directory cannot fail collection). DEF-1/3/4/5 recorded as Low with the condition that keeps them harmless, and DEF-6 recorded as unowned. |
| 2026-09-22 | SA review applied | `model` and `provider` exempted from the date rule (a dated model id would otherwise be recorded as `gpt-4o-<date>`), the dateless guard taught the same exemption, the `PROMPT_VERSION` 3 -> 9 justification for the re-record put on the record, and three follow-ups logged (per-suite clock harness, `prompt_cache_key`, making the suite a required check). |
| 2026-09-22 | Fixed | Date normalisation in both boundary suites’ `normalise()` (before the digest), three snapshots re-recorded, `snapshotsAreDateless.test.ts` added as the standing guard, proved on 2031/2199/2019 clocks. Corrected the “will not spread” claim: `main` was red for two independent reasons and only one of them was the date. |
| 2026-09-22 | Raised | Found during admin-screen slice 1; confirmed pre-existing by SA and by QA (DEF-7). Written up separately so it can be scheduled as its own small PR rather than absorbed into an unrelated feature branch. |
