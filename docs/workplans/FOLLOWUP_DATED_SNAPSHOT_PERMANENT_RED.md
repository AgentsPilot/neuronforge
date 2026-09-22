# Follow-up: the planner snapshot is red every day, for ever

> **Last Updated**: 2026-09-22

**Raised by:** Dev, out of Business OS LLM admin-screen slice 1 (where it was found, confirmed pre-existing, and deliberately **not** fixed)
**Confirmed by:** SA (first slice-1 review) and QA (slice-1 report, DEF-7)
**Status:** ⬜ Open — needs its own small PR. **Not** part of the admin-screen feature.
**Size:** XS (one test-only function; no production change)

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

## What this is NOT

- **Not caused by, and not fixable inside, the admin-screen slices.** Dev, SA and QA each confirmed it independently; QA's proof was stashing the entire working tree (`git stash push -u`) and reproducing the identical failure at a clean `d9c60ab4`.
- **Not a flake.** It fails deterministically, on every run, until the snapshot or the serialiser changes.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Raised | Found during admin-screen slice 1; confirmed pre-existing by SA and by QA (DEF-7). Written up separately so it can be scheduled as its own small PR rather than absorbed into an unrelated feature branch. |
