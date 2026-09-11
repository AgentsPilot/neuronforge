# Audit — Barak's Reply of 2026-09-10 (corrections round)

> **Last Updated**: 2026-09-10

## Overview

Barak's 2026-09-10 email replies to our audit of 2026-09-07
([reply-barak-blockers-2026-09-07.txt](/docs/investigations/reply-barak-blockers-2026-09-07.txt)).
Unlike a normal bug report, most of it concedes points; the substantive new content is a
counter-claim about **which git tree is ahead**, a claim about a new schema-check script, a
proposed work ordering, and one open question addressed to the user.

This document records every command executed and its raw output. Two hard constraints applied,
set by the user:

- **No merge of any kind** — not a real merge, not a trial merge, not `git merge-tree`, not a
  throwaway worktree. His "it merges clean" claim is therefore deliberately **NOT AUDITED**.
- **Read-only git and read-only database only.** No checkout, branch create/delete/reset/push,
  no `git fetch`, no working-tree modification, no SQL writes.

---

## Table of Contents

1. [Verdict Table](#verdict-table)
2. [Item 1 — The Three Self-Corrections](#item-1--the-three-self-corrections)
3. [Item 2 — The Tree Question](#item-2--the-tree-question)
4. [Item 3 — "It Merges Clean"](#item-3--it-merges-clean)
5. [Item 4 — Does dda5c51f Carry the `.in('email')` Bug](#item-4--does-dda5c51f-carry-the-inemail-bug)
6. [Item 5 — schema-check.ts and the Fix Branch](#item-5--schema-checkts-and-the-fix-branch)
7. [Item 6 — Proposed Ordering](#item-6--proposed-ordering)
8. [Item 7 — Q2 / psql](#item-7--q2--psql)
9. [Corrections We Owe on Our Own 2026-09-07 Audit](#corrections-we-owe-on-our-own-2026-09-07-audit)
10. [Open Decision — Not Answered Here](#open-decision--not-answered-here)
11. [Change History](#change-history)

---

## Verdict Table

| # | Claim | Verdict |
|---|-------|---------|
| 1a | `allow_online_payment` is the real column (not `online_payment_enabled`); the migration IS applied | ✅ **CONFIRMED** |
| 1b | `tsc` currently reports **0 errors** on the working tree | ❌ **REFUTED** — 2,116 errors |
| 1c | `@/types/database` is imported nowhere now | ✅ **CONFIRMED** |
| 1d | …"I removed the `BusinessProfileRepository` import during the merge" | 🟡 **PARTLY CONFIRMED** — he removed it, but in `8054d8c`, 2026-08-12, three weeks before the merge |
| 1e | The `TS2307` at `BusinessProfileRepository.ts:9` documented in our agent definition | ✅ **CONFIRMED GONE** — agent definition is stale |
| 2a | `origin/main` still selects `client_email` in the detectors | ✅ **CONFIRMED** — and in **7** files, not 3 |
| 2b | `origin/feature/business-os-reports-and-readiness` has the `contact_id` version | ✅ **CONFIRMED** |
| 2c | `dda5c51f` is exactly one commit ahead of `origin/main`, 64 files, unmerged | ✅ **CONFIRMED** on all three counts |
| 2d | "It's the other way round" — our tree note was backwards | ✅ **CONFIRMED — he is right, we were wrong** |
| 3 | "It merges clean — no conflicts" | ⬜ **NOT AUDITED** — user ruled out all merge checks |
| 4 | `dda5c51f` carries the `.in('email', <uuids>)` bug | ✅ **CONFIRMED** |
| 4b | Our `.in('email')` one-liner is not yet written anywhere | ✅ **CONFIRMED** |
| 4c | The `$75` one-liner (`price` → `payment_amount`) is not written anywhere either | ✅ **CONFIRMED** |
| 5a | Branch `fix/business-os-detector-dead-selects` exists on origin | ✅ **CONFIRMED** — tip `7e432f5` |
| 5b | `scripts/schema-check.ts` exists, wired to `npm run schema:check`, read-only, "48 of 530" | ⬜ **NOT AUDITED** — objects absent from local store; verifying needs a `git fetch` |
| 6 | Proposed ordering: dda5c51f first, then the two one-liners, `$75` first | 🟡 **PARTLY CONFIRMED** |
| 7 | Q2 still needs psql, still unanswered | ✅ **CONFIRMED** |

---

## Item 1 — The Three Self-Corrections

### 1a. `allow_online_payment` — CONFIRMED

Read-only PostgREST probe with the service-role key from `.env.local`:

```
OK    payment_invoices select=id,allow_online_payment  rows=0
FAIL  payment_invoices select=id,online_payment_enabled  42703 column payment_invoices.online_payment_enabled does not exist
```

His account of the failure cause also checks out — the migration **filename** is
`invoice_online_payment`, and the **column** it adds is `allow_online_payment`:

```bash
$ ls supabase/migrations | grep -i "online_payment"
20260909_invoice_online_payment.sql

$ grep -rln "allow_online_payment" supabase/migrations
supabase/migrations/20260909_invoice_online_payment.sql
```

### 1b. `tsc` 0 errors — REFUTED

First run reproduced our own 2026-09-07 result — and revealed why it was wrong:

```bash
$ npx tsc --noEmit -p tsconfig.json | tee tsc.txt | tail -20
<--- Last few GCs --->
[89939:...] 25760 ms: Mark-Compact 2044.1 (2058.5) -> 2043.5 (2059.2) MB ...
      allocation failure; scavenge might not succeed
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
$ grep -c "error TS" tsc.txt
0
```

**The `0` is an out-of-memory artifact.** `tsc` crashed before emitting diagnostics, so
`grep -c "error TS"` counted nothing. Re-run with a larger heap:

```bash
$ NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p tsconfig.json > tsc2.txt 2>&1
exit=2
$ grep -c "error TS" tsc2.txt
2116
$ grep -c "TS2307" tsc2.txt
53
```

Breakdown (`tsconfig.json` `include` is `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`;
`exclude` is only `node_modules`, `archive`):

| Bucket | Errors |
|---|---|
| Total | 2,116 |
| From `.next/` generated types | 4 |
| From tests (`__tests__/`, `tests/`, `*.test.*`, `*.spec.*`) | 219 |
| From `app/`, `lib/`, `components/`, `hooks/`, `types/`, `scripts/` (non-test) | **1,885** |

So his explanation for the ~4,400 figure ("`.next/` generated types and test files") does not
account for the bulk of it — `.next/` contributes 4 errors, tests 219.

Top non-test contributors:

```
  59 components/wizard/hooks/useWorkflowActions.ts
  48 scripts/test-slot-filling-scenarios.ts
  47 app/v2/agents/[id]/page.tsx
  43 scripts/test-hard-requirements-intake.ts
  42 components/wizard/hooks/useWorkflowData.ts
  28 lib/intelligence/execution/PluginCoordinator.ts
  26 app/api/v6/requirements-lineage/route.ts
  24 lib/business-os/LanguageContext.tsx
```

Measured on the current working tree (branch `feature/business-os-reports-and-readiness` at
`dda5c51f`, with uncommitted modifications present).

There is **no `typecheck` npm script** in `package.json`.

### 1c / 1d. `@/types/database` — CONFIRMED / PARTLY CONFIRMED

```bash
$ grep -rn "types/database" lib app components types scripts
app/business-os/website/page.tsx:7416:  // `types/database.ts` does not exist in this repo, so the generated
app/api/website/forms/intake/__tests__/route.test.ts:6: * ... the generated `@/types/database`
```

Both are comments. No import anywhere. `types/` contains only `analytics.ts`, `pdf-parse.d.ts`,
`pdfjs-dist.d.ts`, `settings.ts`, `system-health.ts`.

Who removed it, and when:

```bash
$ git log --all --oneline --format="%h %ad %an %s" --date=short \
    -S"@/types/database" -- lib/repositories/BusinessProfileRepository.ts
8054d8c 2026-08-12 Barak Meiri refactor(repositories): add getOverdueInvoices + DI + local interfaces (drop missing @/types/database)
a670353 2026-07-28 offiromer  feat(business-os): implement AI Business OS phases 1-3
```

He is right that he removed it. It was **not** during the merge — it was a standalone refactor
on 2026-08-12. Note the merge requirement doc records a *second*, separate removal at merge time
(D27, 2026-09-02: "His side adds `import type { Database }` … Removed rather than left to add a
new type error"). Worth asking which of the two he means; they are different events.

### 1e. The `TS2307` at `BusinessProfileRepository.ts:9` — CONFIRMED GONE

```bash
$ sed -n '1,12p' lib/repositories/BusinessProfileRepository.ts
import type { SupabaseClient } from '@supabase/supabase-js';   # line 7
import { createLogger } from '@/lib/logger';                    # line 8
import { supabaseServer } from '@/lib/supabaseServer';          # line 9
import type { DocumentType } from '@/lib/payments/documentType'; # line 10
```

```bash
$ grep 'TS2307' tsc2.txt | grep -i "types/database"
(no output)
```

53 `TS2307`s exist, none for `@/types/database`; they are V6 compiler modules,
`@testing-library/react`, deprecated generators, and two Deno/esm.sh URL imports in edge functions.

**Our own agent definition (`.claude/agents/peer-report-auditor.md:35`) still asserts this
TS2307 exists. It is stale and should be corrected.**

---

## Item 2 — The Tree Question

**He is right. We were wrong.**

### Ref state (authoritative, `ls-remote`)

```bash
$ git ls-remote origin main \
    refs/heads/feature/business-os-reports-and-readiness \
    refs/heads/fix/business-os-detector-dead-selects
dda5c51fbb061a5915a758a6c5a3cc585942f4bb  refs/heads/feature/business-os-reports-and-readiness
7e432f5b21fae88adc73f521db771e34cf1dcd75  refs/heads/fix/business-os-detector-dead-selects
b83b3590c24d087737fa7e8688bddf8cdc66cb7d  refs/heads/main
```

Local `origin/main` matches `ls-remote` (`b83b359`), so this measurement is not stale.

### 2c — one commit ahead, 64 files, unmerged

```bash
$ git log --oneline origin/main..HEAD
dda5c51 feat(business-os): booking self-service, bizql writes, and CRM drawer fixes

$ git show --numstat --format="" dda5c51 | wc -l
64

$ git show --stat --oneline dda5c51 | tail -1
 64 files changed, 5143 insertions(+), 644 deletions(-)

$ git branch -a --contains dda5c51
* feature/business-os-reports-and-readiness
  remotes/origin/feature/business-os-reports-and-readiness
```

All three sub-claims confirmed: exactly one commit ahead, exactly 64 files, contained by no
branch other than the feature branch (i.e. **not merged to main**).

Shape of the divergence — `origin/main` is itself a merge of an *earlier* state of the same
feature branch:

```bash
$ git rev-list --parents -n 1 b83b359
b83b359  6ffa504  84614f0

$ git show --format="%H%n%an%n%ad%n%s" --no-patch b83b359
b83b359 | offiromer | Mon Sep 7 12:29:04 2026 -0400
Merge pull request #35 from AgentsPilot/feature/business-os-reports-and-readiness

$ git show --format="%an%n%ad%n%s" --no-patch dda5c51
offiromer | Mon Sep 7 23:49:38 2026 -0400
feat(business-os): booking self-service, bizql writes, and CRM drawer fixes
```

PR #35 merged the branch at `84614f0` (12:25 on 7 Sep). `dda5c51f` was committed at 23:49 the
same day — **after** the merge. That is exactly how the confusion arose: main did take the merged
branch recently, but it took it one commit short.

### 2a / 2b — the actual select lines, per branch

Seven detector files differ, not three:

```bash
$ git grep -n "client_email" origin/main -- 'lib/business-os/insight/detectors/'
CrmEngagementDecayDetector.ts:121:      .select('client_email, start_time')
CrmEngagementDecayDetector.ts:127:      const activeClientEmails = new Set(bookings?.map((b) => b.client_email?.toLowerCase()) || []);
OpsLastMinuteCancelsDetector.ts:72:     .select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')
PricingIntroOfferStuckDetector.ts:90:   .select('id, client_email, service_id, payment_amount, created_at, status')
PricingIntroOfferStuckDetector.ts:143:  const email = booking.client_email?.toLowerCase();
RetCancellationSpikeDetector.ts:63:     .select('id, client_email, service_id, cancellation_reason, updated_at')
RetRepeatBookingLowDetector.ts:72:      .select('client_email, id, start_time, payment_amount')
RetRepeatBookingLowDetector.ts:76:      .not('client_email', 'is', null);
WebMobileIssuesDetector.ts:130:        .select('id, metadata, client_email')
WebPageUnderperformDetector.ts:115:     .select('source_url, client_email')

$ git grep -n "client_email" origin/feature/business-os-reports-and-readiness -- 'lib/business-os/insight/detectors/'
PricingIntroOfferStuckDetector.ts:143:  // The contact, not an email string. `client_email` was dropped
RetRepeatBookingLowDetector.ts:90:      // Grouped by contact, not by email text. `client_email` was dropped
```

On the feature branch the only two survivors are **comments recording the removal** — the exact
tell we look for, which is what made our 2026-09-07 read look like "already shipped".

Side-by-side, all seven:

| File (`lib/business-os/insight/detectors/catalog/`) | `origin/main` | `origin/feature/…` |
|---|---|---|
| `CrmEngagementDecayDetector.ts:121` | `.select('client_email, start_time')` | `.select('contact_id, start_time')` |
| `OpsLastMinuteCancelsDetector.ts:72` | `…payment_amount, client_email, cancellation_reason')` | `…payment_amount, cancellation_reason')` |
| `PricingIntroOfferStuckDetector.ts:90` | `.select('id, client_email, service_id, …')` | `.select('id, contact_id, service_id, …')` |
| `RetCancellationSpikeDetector.ts:63` | `.select('id, client_email, service_id, …')` | `.select('id, service_id, …')` |
| `RetRepeatBookingLowDetector.ts:72/76` | `.select('client_email, id, …')` / `.not('client_email',…)` | `.select('contact_id, id, …')` / `.not('contact_id',…)` |
| `WebMobileIssuesDetector.ts:130` | `.select('id, metadata, client_email')` | `.select('id, metadata')` |
| `WebPageUnderperformDetector.ts:115` | `.select('source_url, client_email')` | `.select('source_url')` |

```bash
$ git show --stat --format="" dda5c51 -- lib/business-os/insight/detectors/
 CrmEngagementDecayDetector.ts       | 16 ++++++++++++----
 OpsLastMinuteCancelsDetector.ts     |  2 +-
 PricingIntroOfferStuckDetector.ts   |  8 ++++++--
 RetCancellationSpikeDetector.ts     |  2 +-
 RetRepeatBookingLowDetector.ts      | 10 ++++++----
 WebMobileIssuesDetector.ts          |  2 +-
 WebPageUnderperformDetector.ts      |  2 +-
 7 files changed, 28 insertions(+), 14 deletions(-)
```

### Live-schema verdict for every one of those selects

Read-only probes. Error code is the verdict; `rows=0` reflects an empty
`scheduling_bookings` table today (`content-range: */0`), not a schema failure.

| Select | Verdict |
|---|---|
| `scheduling_bookings.client_email` (any form) | ❌ `42703 column scheduling_bookings.client_email does not exist` |
| `contact_id, start_time` | ✅ OK |
| `id, start_time, updated_at, payment_amount, cancellation_reason` | ✅ OK |
| `id, contact_id, service_id, payment_amount, created_at, status` | ✅ OK |
| `id, service_id, cancellation_reason, updated_at` | ✅ OK |
| `contact_id, id, start_time, payment_amount` | ✅ OK |
| `id, metadata` | ❌ `42703 column scheduling_bookings.metadata does not exist` |
| `source_url` | ❌ `42703 column scheduling_bookings.source_url does not exist` |
| `price` | ❌ `42703 column scheduling_bookings.price does not exist` |
| `payment_amount` | ✅ OK |
| `payment_invoices.client_email` | ✅ OK (different table, still live) |

**Consequence:** `dda5c51f` takes **five** of the seven detectors from dead to green.
`WebMobileIssuesDetector` and `WebPageUnderperformDetector` stay dead after it, on
`metadata` / `source_url` — which matches item 3 of the 2026-09-07 audit. Their other queries
are still broken too:

```
FAIL  websites           42P01 relation "public.websites" does not exist
FAIL  website_page_views select=visitor_id,device_type  42703 column website_page_views.visitor_id does not exist
FAIL  website_page_views select=page_path,visitor_id    42703 column website_page_views.page_path does not exist
FAIL  website_pages      select=id,path,title           42703 column website_pages.path does not exist
OK    website_pages      select=id,slug,title           rows=1
OK    crm_contacts       select=id,source               rows=1
FAIL  business_profiles  select=id,subdomain            42703 column business_profiles.subdomain does not exist
```

---

## Item 3 — "It Merges Clean"

⬜ **NOT AUDITED, deliberately.**

The user explicitly ruled out every form of merge check — real merge, trial merge on a throwaway
branch or worktree, `git merge-tree`, `git merge --no-commit`, and any simulation. No command was
run against this claim and no position is taken on it in either direction.

One adjacent fact that *was* observable read-only, and is not a merge assertion: the two commits
visible on `fix/business-os-detector-dead-selects` edit the **same two lines** that `dda5c51f`
edits (see [Item 5](#item-5--schema-checkts-and-the-fix-branch)).

---

## Item 4 — Does dda5c51f Carry the `.in('email')` Bug

✅ **CONFIRMED**, read out of the commit's own tree — no checkout.

```bash
$ git show dda5c51:lib/business-os/insight/detectors/catalog/PricingIntroOfferStuckDetector.ts | sed -n '230,236p'
    // Get contact details for stuck users
    const { data: contacts } = await this.supabase
      .from('crm_contacts')
      .select('id, email, first_name, last_name')
      .eq('user_id', userId)
      .in('email', [...stuckEmails].slice(0, 50));
```

And the source of the UUIDs, same file, lines 143-148:

```typescript
      // The contact, not an email string. `client_email` was dropped —
      // crm_contacts is the single source of truth — and `contact_id` is the
      // better key regardless: one person with two spellings of their address
      // used to count as two clients.
      const email = booking.contact_id;
```

`stuckEmails` therefore holds `contact_id` UUIDs, filtered at line 235 against the `email` column.

Reproduced against live data:

```
sample contact: {"id":"8742fcd8-fdfc-4e32-bb1f-c599cf72adf5","email":"offir.omer@tenafly-tg.com"}
.in('email',[<contact uuid>]) -> status=200  rows=0
.in('id',   [<contact uuid>]) -> status=200  rows=1
```

No error, no rows — `stuckContacts` is always `[]`.

**Note on the pre-condition:** on `origin/main` this bug is not reachable, because line 90's
select fails outright on `client_email` and the detector returns before line 235. The bug only
becomes live *when `dda5c51f` lands*. `origin/main` line 143 reads
`const email = booking.client_email?.toLowerCase();`, which is type-consistent with the `.in('email', …)`
below it.

### 4b / 4c — neither one-liner is written anywhere

```bash
$ grep -rn "\.in('email'" lib app components --include="*.ts" --include="*.tsx"
lib/business-os/insight/detectors/catalog/PricingIntroOfferStuckDetector.ts:235:      .in('email', [...stuckEmails].slice(0, 50));

$ git diff --stat HEAD -- lib/business-os/insight/detectors/
(empty — working tree clean for these files)
```

The `$75` fix likewise does not exist on any branch. `OpsPeakUnutilizedDetector.ts` is byte-identical
on `origin/main` and `origin/feature/…`:

```bash
$ git log --all --oneline -- .../OpsPeakUnutilizedDetector.ts
3390050 feat(business-os): system readiness, reports period filter, and RTL fixes
```

Both branches, lines 167-176:

```typescript
      .from('scheduling_bookings')
      .select('price')                       // 42703 — column is payment_amount
      ...
        : 75; // Default estimate
```

---

## Item 5 — schema-check.ts and the Fix Branch

### 5a — the branch exists: CONFIRMED

```bash
$ git ls-remote origin refs/heads/fix/business-os-detector-dead-selects
7e432f5b21fae88adc73f521db771e34cf1dcd75  refs/heads/fix/business-os-detector-dead-selects

$ git rev-parse --verify fix/business-os-detector-dead-selects
fatal: Needed a single revision                    # no local branch
```

### 5b — the script itself: NOT AUDITED

The local remote-tracking ref is stale and the newer objects are not in the local store:

```bash
$ git rev-parse origin/fix/business-os-detector-dead-selects
312b9303a9da1a8cc0ef1285425f9e899a3b0082          # stale

$ git cat-file -t 7e432f5b21fae88adc73f521db771e34cf1dcd75
fatal: git cat-file: could not get object info
```

Reaching `7e432f5` requires `git fetch`, which writes remote-tracking refs and was outside the
read-only remit for this pass. Consequently **none of the following were checked**:
the existence of `scripts/schema-check.ts`, the `npm run schema:check` wiring, the read-only /
zero-row claim, the non-zero exit code, the branch+SHA printing, the declared blind spots, or the
"48 of 530" figure. **The script was not run** — and could not have been, since its source could
not be read to prove it performs no writes.

What is visible at the stale tip `312b930`:

```bash
$ git log --oneline --format="%h %ad %an %s" --date=short origin/main..origin/fix/business-os-detector-dead-selects
312b930 2026-09-08 Barak Meiri docs(business-os): workplan for the phantom-column class
88c3265 2026-09-07 Barak Meiri fix(business-os): drop dead client_email selects from two detectors

$ git diff --stat origin/main...origin/fix/business-os-detector-dead-selects
 docs/workplans/business-os-phantom-column-remediation.md   | 208 +++++++++++++
 .../catalog/OpsLastMinuteCancelsDetector.ts                |   6 +-
 .../catalog/RetCancellationSpikeDetector.ts                |   5 +-
 3 files changed, 217 insertions(+), 2 deletions(-)
```

No `schema:check` entry in `package.json` at `312b930`, and none in the working tree.

**Overlap with `dda5c51f`** — `88c3265` makes the same functional edit to the same two lines:

```diff
# 88c3265
-      .select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')
+      // `client_email` was selected here and never used. The column is GONE from the live
+      // database — 20260810_remove_client_fields_and_total_amount.sql has been applied —
+      // and Postgres rejects the whole select for one unknown name ...
+      .select('id, start_time, updated_at, payment_amount, cancellation_reason')

# dda5c51 (same two files, same two lines, no comments)
-      .select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')
+      .select('id, start_time, updated_at, payment_amount, cancellation_reason')
```

Recorded as an observation only. No inference about mergeability is drawn from it — see
[Item 3](#item-3--it-merges-clean).

### Sanity check on the "530" denominator

Order-of-magnitude only, from the working tree:

```bash
$ grep -rn "\.from('"   lib app components --include=*.ts --include=*.tsx | wc -l   # 2185
$ grep -rn "\.select("  lib app components --include=*.ts --include=*.tsx | wc -l   # 1748
$ grep -rn "\.select('" lib app components --include=*.ts --include=*.tsx | wc -l   # 1445
```

1,445 string-literal selects against his 530. Not a contradiction — his stated blind spots
(star selects, embedded joins, template literals) plus non-Supabase `.select()` calls could
account for the gap — but the gap is large enough to be worth him confirming. Not verifiable
without the source.

---

## Item 6 — Proposed Ordering

His order: `dda5c51f` first, then the two one-liners, `$75` before `.in('email')`.

🟡 **PARTLY CONFIRMED.**

| Sub-claim | Verdict | Evidence |
|---|---|---|
| `dda5c51f` must precede the `.in('email')` fix | ✅ Holds | On `origin/main` the line-235 code is unreachable: line 90 fails on `client_email` and returns early. The one-liner is a no-op until `dda5c51f` lands. |
| `dda5c51f` must precede the `$75` fix | ❌ Does not hold | `OpsPeakUnutilizedDetector.ts` is identical on both branches and untouched by `dda5c51f`. Zero dependency; it can ship in either order or in parallel. |
| `$75` before `.in('email')` | ✅ Holds, and for his stated reason | `$75` is live on `origin/main` today — the detector fires, and prices the finding from a fabricated `$75/booking` default. `.in('email')` is not live until `dda5c51f` lands. |
| "nothing else is coherent while main and the branch disagree" | ✅ Supported | 5 of 7 detectors are dead on main and green on the branch; any measurement taken now is branch-dependent. |
| The whole ordering rests on the merge being clean | ⬜ Unverified | See [Item 3](#item-3--it-merges-clean). |

One addition the ordering omits: `dda5c51f` does **not** fix `WebMobileIssuesDetector` or
`WebPageUnderperformDetector`. Those stay dead on `metadata` / `source_url` and still need the
retire-or-rebuild decision from the 2026-09-07 audit.

---

## Item 7 — Q2 / psql

✅ **CONFIRMED still unanswered**, on both the document and the access constraint.

Document state — `docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md`:

```
:633 | Q2 | Does BizQL's `MutateExecutor` account for triggers T2 / T3 / T4 / T8, or does
           BizQL assume it owns the side effects? | BA / RM | ⬜ Open | (blank)
:569 | Q1 and Q5 answered; Q2, Q3, Q4, Q6, Q7, Q8, Q9 still open.
```

Access state — the trigger catalogue is still unreachable read-only over PostgREST:

```
pg_trigger                    404  42P01 relation "public.pg_trigger" does not exist
information_schema.triggers   404  42P01 relation "public.information_schema.triggers" does not exist
pg_catalog.pg_trigger         404  42P01 relation "public.pg_catalog.pg_trigger" does not exist
rpc exec_sql                  404  PGRST202 Searched for the function public.exec_sql ...
```

The underlying trigger behaviour remains ⬜ **NOT AUDITED**. It needs psql, exactly as he says.

---

## Corrections We Owe on Our Own 2026-09-07 Audit

Two of our own findings were wrong. Both are recorded here so the record is not left standing.

### C1. The tree note (reply, lines 277-281) — wrong, and backwards

We wrote that items 2 and 4 "describe a tree older than current main." The reverse is true:
`origin/main` is one commit behind `dda5c51f`, and it is `origin/main` that carries the dead
`client_email` selects. He audited main; we audited the branch; neither said which.

### C2. Commit attribution (reply, lines 56-68) — exactly inverted

We wrote: *"this shipped on 26 Aug. It's commit 3390050, 2026-08-26, and I confirmed it's an
ancestor of origin/main."* The ancestry is right; the direction is not.

```bash
$ git show --format="%H%n%ad%n%s" --no-patch 3390050
3390050e87d4bc9e1b87da7b73fa34ccd46f6a0f
Wed Aug 26 12:15:56 2026 -0400
feat(business-os): system readiness, reports period filter, and RTL fixes

$ git merge-base --is-ancestor 3390050 origin/main && echo "YES ancestor of origin/main"
YES ancestor of origin/main

$ git show 3390050 -- lib/business-os/insight/detectors/catalog/ | grep -E "^[+-].*client_email|^\+\+\+"
+++ b/.../CrmEngagementDecayDetector.ts            (created from /dev/null)
+      .select('client_email, start_time')
+      const activeClientEmails = new Set(bookings?.map((b) => b.client_email?.toLowerCase()) || []);
+++ b/.../OpsLastMinuteCancelsDetector.ts          (created from /dev/null)
+      .select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')
+++ b/.../PricingIntroOfferStuckDetector.ts        (created from /dev/null)
+      .select('id, client_email, service_id, payment_amount, created_at, status')
+      const email = booking.client_email?.toLowerCase();
```

`3390050` **created** these files **with** `client_email`. It introduced the bug. The commit that
removes it is `dda5c51f`, 2026-09-07, unmerged. We named the wrong commit and gave it the
opposite role.

### C3. Our "0 TypeScript errors" — a false negative

`npx tsc --noEmit | grep -c "error TS"` returned 0 because `tsc` ran out of heap and produced no
diagnostics at all. The grep counted a crash. See [1b](#1b-tsc-0-errors--refuted). This also means
we accepted his concession on a figure we had measured wrong.

### C4. Our agent definition is stale

`.claude/agents/peer-report-auditor.md:35` still states `@/types/database` produces a `TS2307` at
`BusinessProfileRepository.ts:9`. That import was removed on 2026-08-12 (`8054d8c`).

---

## Open Decision — Not Answered Here

> "Can we merge `dda5c51f` to main? Was it held back deliberately, or just not got to yet?"

**This is the user's call and is not answered by this audit.** Nothing in this document should be
read as clearance to merge. `dda5c51f` is `offiromer`'s commit, pushed to
`origin/feature/business-os-reports-and-readiness`, unmerged as of 2026-09-10. No merge, trial
merge, or mergeability simulation was performed.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-10 | Created | Audit of Barak's 2026-09-10 corrections reply. 7 claim groups; tree question resolved in his favour; 4 corrections owed on our own 2026-09-07 audit; merge-cleanliness and `schema-check.ts` deliberately not audited. |
