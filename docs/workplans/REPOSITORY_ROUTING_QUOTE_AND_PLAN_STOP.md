# Repository Routing — Quote Stop and Plan Stop

> **Last Updated**: 2026-10-31
> **Status**: SA-reviewed (🔄 revision required), **revision applied below**.
> Awaiting SA sign-off on this revision and on §Slice 4 Test Plan. No code written.

## Overview

`lib/payments/cancelQuoteStages.ts` and `lib/payments/stopBookingPlan.ts` reach
Supabase directly — ten `.from(` sites between them — in breach of CLAUDE.md
Mandatory Rule 1. This workplan routes both behind `lib/repositories/`.

These two slices were **removed from** the `REPOSITORY_ROUTING_BOOKING_CANCEL_AND_CHANNEL`
stream by SA ruling E1 / §Adjusted items, which named this document and required
"their own workplan, their own SA pass and a QA pass that is allowed to include a
live money check". This is that workplan. The reasons for the split were:

1. they remove **zero** measured network calls, so none of the parent stream's
   perishable CI-flake evidence applies;
2. the cost was estimated as rewriting a 780-line and a 241-line suite whose
   stated purpose is asserting query *filters*;
3. these are the two paths that **void invoices and close money rows**, and
   "a mistake there writes `status: 'cancelled'` over the wrong rows on a live
   account".

Bullets 1 and 3 stand. **Bullet 2 is withdrawn by SA** on the evidence in
§Finding — but either of the others was sufficient on its own, so the process
this document follows is unchanged.

---

## Table of Contents

- [Finding — the suites survive the move, with four exceptions](#finding--the-suites-survive-the-move-with-four-exceptions)
- [Site Inventory](#site-inventory)
- [Methods](#methods)
- [Placement — the guarded source regions](#placement--the-guarded-source-regions)
- [Slices](#slices)
- [Slice 4 Test Plan](#slice-4-test-plan)
- [Invariants That Must Stay At The Call Site](#invariants-that-must-stay-at-the-call-site)
- [Declared Behaviour Deltas](#declared-behaviour-deltas)
- [Hazards](#hazards)
- [Exit Criteria](#exit-criteria)
- [The Four Questions, And Their Answers](#the-four-questions-and-their-answers)
- [Implementation — PR 1 (slices 1 and 2)](#implementation--pr-1-slices-1-and-2)
- [Implementation — PR 2 (slices 3, 3b and 4)](#implementation--pr-2-slices-3-3b-and-4)
- [Follow-ups](#follow-ups)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## Finding — the suites survive the move, with four exceptions

SA's cost estimate assumed the existing filter assertions die with the move:
"both tests replace `@/lib/supabaseServer` with a Proxy query-builder and assert
on the filters passed to it; both must be rewritten to mock repositories and
assert on behaviour."

Mostly they do not die, because of where the mock sits. Both suites mock the
**client**:

**File:** `lib/payments/__tests__/stopBookingPlan.test.ts`

```ts
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { from: (table) => … } }));
```

And every repository singleton binds that same module at construction:

| Singleton | Binding |
|---|---|
| `proposalRepository` | `new ProposalRepository()` → `constructor(private supabase = supabaseServer)` |
| `paymentInvoiceRepository` | `new PaymentInvoiceRepository()` → `constructor(supabase = supabaseServer)` |
| `paymentPlanRepository` | `new PaymentPlanRepository(supabaseServer)` |
| `paymentPlanSubscriptionRepository` | `new PaymentPlanSubscriptionRepository()` |
| `schedulingBookingRepository` | `new SchedulingBookingRepository(supabaseServer)` |

So under `jest.mock('@/lib/supabaseServer')` the repository singletons hold the
**mock**, and the fake goes on recording `from(table)` and every `eq` / `in` /
`not` / `is` — applied one layer down, by the repository, but on the same client
and in the same order. The assertions observe the scope exactly where it is
applied, which is the property SA's B4 and the `stopBookingPlan` suite's own
comment demand.

### Proven, not predicted

Run as a throwaway probe and then deleted: under `jest.mock('@/lib/supabaseServer')`,
importing the `paymentPlanSubscriptionRepository` **singleton** and calling
`findAnyForBooking('booking-1', 'owner-1')` recorded
`table: 'payment_plan_subscriptions'` plus `['user_id', 'owner-1']` and
`['booking_id', 'booking-1']` on the mock. The mechanism holds.

SA independently verified all five constructor bindings and **withdrew E1's
bullet 2**.

### The four exceptions — and one inverted safety property

§Finding is about assertions made through the **client**. Two things it does not
carry:

1. **Source-text scans die.** `cancelQuoteStages.test.ts:703-746` is a `describe`
   block that reads `lib/payments/cancelQuoteStages.ts` off disk with
   `fs.readFileSync`, strips comments, and asserts on a 900-character slice taken
   from `if (cancelUnpaidInvoice`. Four assertions in it name query text that this
   move removes from the file:
   - `.in('status', LIVE_INVOICE_STATUSES)`
   - `const LIVE_INVOICE_STATUSES = ['draft', 'sent', 'overdue']` (the constant moves — K3)
   - `.eq('user_id', userId)`
   - `.eq('booking_id', proposal.booking_id)`

   The other assertions in that block — `cancelUnpaidInvoice = false`, the
   `if (stageInvoiceIds.includes(invoice.id)) continue;` dedupe and the
   `if (voidError) … logger.warn … continue` shape — survive, because those stay
   at the call site. **So the original exit criterion 2 was false**, and it is
   rewritten below. Worse, this `describe` is the **only** coverage the loose-invoice
   path has: the fake defines no `in`, so the path cannot execute today. The four
   assertions must be **re-homed** into `PaymentInvoiceRepository` unit tests, not
   deleted. §Slice 4 Test Plan says how.

2. **A missing fake method changes from loud to silent.** Today `cancelQuoteStages`
   has exactly one `try` (the email block at the end), so a fake missing a builder
   method throws straight out of the function and the test fails loudly. After the
   move that throw lands inside a repository's `try`, is caught, and returns
   `{ data: null, error }` — which three of the four call sites log and continue
   past. The original H-1 said "inside a `try` that swallows it"; that was wrong
   about today and right about tomorrow. This is why H-1's mitigation is to extend
   the fake rather than rely on a failure surfacing.

---

## Site Inventory

Measured by `grep -n "supabaseServer|\.from("`. Ten `.from(` sites, plus one
client hand-off that A1 of the parent plan rules stays.

### `lib/payments/cancelQuoteStages.ts` (542 lines)

| Line | Table | What it does |
|---|---|---|
| 167 | `proposals` | ownership read before anything is written |
| 211 | `payment_plan_installments` | the billed stages, to void their invoices |
| 260 | `payment_invoices` | per-invoice settlement state, **inside the void loop** |
| 319 | `payment_invoices` | the "loose" invoice no stage points at (opt-in) |
| 352 | `payment_plan_installments` | close the unbilled stages, returning rows |
| 436 | `proposals` | mark the quote `stopped`, conditional on `accepted` |
| 416 | — | `lowerPlansForCancelledStages(supabaseServer, …)` — **stays** (parent A1) |

### `lib/payments/stopBookingPlan.ts` (243 lines)

| Line | Table | What it does |
|---|---|---|
| 102 | `scheduling_bookings` | ownership read before anything is written |
| 124 | `payment_plan_subscriptions` | is this a Stripe plan? decides the whole branch |
| 165 | `payment_plan_installments` | the open periods, read before the close |
| 209 | `payment_plan_installments` | close exactly the periods just read |

---

## Methods

No new repository class — every table already has an owner (parent C0). **Four**
of the ten sites need no new method at all.

### Reused as-is

| Site | Method | Fit |
|---|---|---|
| `stopBookingPlan:102` | `schedulingBookingRepository.findOwnedId(id, userId)` | exact |
| `stopBookingPlan:124` | `paymentPlanSubscriptionRepository.findLiveForBooking(id, userId)` | **SA's Q-2 ruling.** See the proof below and delta D-1′ |
| `cancelQuoteStages:436` | `proposalRepository.stopAccepted([id], userId, { reason, note })` | identical patch, identical `.eq('status','accepted')` guard. See delta D-2 |
| `cancelQuoteStages:352` *(partly)* | — | no reuse; see "Why M-2, not `cancelOpenStagesForBooking`" |

#### Why `findLiveForBooking` and not `findAnyForBooking` — and why `maybeSingle()` is provably safe

The site asks "is there a live Stripe plan on this booking?", then applies
`isPlanStopped` to the answer. `findLiveForBooking` asks exactly that question in
the query, and the predicate is *identical*:

- `PLAN_STOPPED_STATUSES = ['completed', 'cancelled']` (`lib/payments/planStatus.ts:27`),
  and `isPlanStopped(s)` is membership in it.
- `PlanSubscriptionStatus` has **exactly six** values:
  `pending | active | past_due | paused | completed | cancelled`
  (`PaymentPlanSubscriptionRepository.ts:33-39`).
- So "not `completed`, not `cancelled`" is **exactly** `{pending, active, past_due, paused}`.
- The partial unique index covers **exactly those four**:

```
CREATE UNIQUE INDEX idx_plan_subs_one_live_per_booking
  ON public.payment_plan_subscriptions USING btree (booking_id)
  WHERE ((booking_id IS NOT NULL)
     AND (status = ANY (ARRAY['pending','active','past_due','paused'])))
```

Therefore at most one row can satisfy `findLiveForBooking`'s filter, and
`maybeSingle()` cannot throw on it. The limit question disappears rather than
being answered.

**SA's blocking condition on this, answered:** `payment_plan_subscriptions.status`
is **`NOT NULL`**, verified against `information_schema` on 2026-10-31. SA's
concern was that a NULL status is excluded by `not.in` while `isPlanStopped(null)`
returns `false`, which would run the delta in the *unsafe* direction — the site
would close local rows where today it refuses without a Stripe client. **That hole
does not exist.** The column is `text NOT NULL`.

`findAnyForBooking` is the wrong reuse here: it is deliberately unfiltered for the
`ON DELETE RESTRICT` pre-check, and its `.limit(1)` would turn a future throw into
a silent, un-ordered arbitrary pick on the branch that decides whether to call
Stripe at all. Picking a cancelled row there closes local rows while the
subscription keeps charging — invariant I-5.

### New

| # | Method | Class | Query |
|---|---|---|---|
| M-1 | `findBilledStagesForProposal(proposalId, userId)` | `PaymentPlanRepository` | `select('id, invoice_id')`, `user_id`, `proposal_id`, `not('invoice_id','is',null)`, `is('subscription_id',null)` |
| M-2 | `cancelOpenStagesForProposal(proposalId, userId)` | `PaymentPlanRepository` | the proposal-scoped twin of `cancelOpenStagesForBooking`; `not('status','in','(paid,cancelled)')`, `is('subscription_id',null)`, `.select('id, amount, payment_plan_id')`. Move patch is **exactly three keys** — see D-3 |
| M-3 | `findOpenPeriodsForBooking(bookingId, userId)` | `PaymentPlanRepository` | `select('id, invoice_id, installment_number')`, `user_id`, `booking_id`, `not('status','in','(paid,cancelled)')` — **no `subscription_id` filter**, see D-4 |
| M-4 | `cancelStagesByIds(ids, userId, cancellation)` | `PaymentPlanRepository` | `in('id', ids)` + `user_id`; the full cancellation patch including `next_retry_at: null`. Returns **`PaymentPlanRepositoryResult<null>`** — see K1 below |
| M-5 | `findSettlementStateById(id, userId)` | `PaymentInvoiceRepository` | `select('id, status, amount, refunded_amount, currency')`, `id` + `user_id`, `maybeSingle`. Types `currency: string \| null`, dropping the call site's cast |
| M-6 | `findOpenForBooking(bookingId, userId)` | `PaymentInvoiceRepository` | `select('id, status')`, `user_id` + `booking_id`, `in('status', LIVE_INVOICE_STATUSES)` — **no `statuses` parameter**, see K3 below |
| M-7 | `findStopTarget(id, userId)` | `ProposalRepository` | `select('id, user_id, booking_id, status, title')`, `id` + `user_id`, `maybeSingle` |

**K1 — M-4 returns `null`, not a count.** The call site already has the number
(`cancelledPeriods: openPeriods.length`) and reads only `closeError`. Deriving a
count would mean adding `.select()` or `{ count: 'exact' }` to a write that today
returns nothing — a behaviour change bought for no caller.

**K3 — M-6 is named `findOpenForBooking` and takes no `statuses` argument.**
Two reasons, both load-bearing:

- `findLiveForBooking` already exists on `PaymentPlanSubscriptionRepository` with
  different semantics, and under the Q-2 ruling **both** are reachable from these
  two files. Two same-named methods meaning different things, one row apart in a
  money path, is how the wrong one gets called.
- A `statuses` parameter reopens the generic-filter door parent C0/C3 closed. The
  constant moves into `PaymentRepository.ts` instead, beside the existing
  `ISSUED_INVOICE_STATUSES`, **with the difference named in a comment**:

| Constant | Value |
|---|---|
| `ISSUED_INVOICE_STATUSES` (existing, `PaymentRepository.ts:974`) | `['sent', 'pending', 'overdue']` |
| `LIVE_INVOICE_STATUSES` (moving in) | `['draft', 'sent', 'overdue']` |

They differ by **`draft` vs `pending`**. Reusing the wrong one would silently stop
voiding drafts and start voiding pendings — on the path whose entire subject is
"two live quotes in that state, one of them ₪5,000".

**S-2 — `SETTLED_INVOICE_STATUSES` stays in `cancelQuoteStages.ts`.** One of these
two constants moves and the other does not, and the instinct to move both together
is wrong. `LIVE` is a **query filter** (`in('status', …)`), so it belongs with the
query. `SETTLED` is a **predicate over a row already returned**
(`SETTLED_INVOICE_STATUSES.includes(invoice.status)`), used to decide whether to
add that invoice to `collected` — a call-site decision, not a fact about the
table. Moving it would also kill a fifth source-text assertion
(`cancelQuoteStages.test.ts:726`) for no gain; it is deliberately **not** among
the dying four in §Finding exception 1.

**M-7 is `findStopTarget`, not a reuse of `findById`, and not `findStopState`.**
`findById` is `select('*')`, which pulls `accepted_snapshot` and the frozen tax
fields on every cancellation; parent A2's over-fetch objection applies verbatim
even though its `.single()` and error-log objections do not. The name
`findStopState` reads as "has it been stopped", which is not what it answers.
Keep today's five columns byte-faithful — only `booking_id` is ever read, and
`status`/`title` are dead, but narrowing them is FU-Q3, not this commit.

**Why M-2, not the existing `cancelOpenStagesForBooking`** (SA verified line by
line and endorsed this). They are not the same transition:

| | existing `cancelOpenStagesForBooking` | the site at `stopBookingPlan:209` |
|---|---|---|
| scope | `booking_id` + `not status in (paid,cancelled)` | `in('id', …)` — exactly the rows just read and voided |
| `subscription_id` | `is null` | **no filter** |
| returns | the closed rows | nothing (the caller already has them) |

The id-list form is what makes the close agree with the voids: it closes the rows
whose invoices this same call just voided, and nothing that appeared in between.
Swapping in the booking-scoped method would also silently stop closing periods
carrying a `subscription_id` — reachable here, because a *stopped* subscription
falls through to this branch. Parent C3 already ruled against folding
differently-filtered transitions together.

### Column verification (parent G7)

All 38 columns named across these methods verified present against
`information_schema` on the live schema, 2026-10-31 — **38/38, no phantoms**.
Two type-vs-schema notes, both ruled on by SA:

- `payment_plan_installments.amount` and `payment_plan_id` are **`NOT NULL`** in
  the database, but `cancelOpenStagesForBooking` types them `number | null` /
  `string | null`. **M-2 mirrors the existing looser shape**: one consumer
  (`lowerPlansForCancelledStages`) eats the rows of both methods, and two types
  for one consumer is worse than one loose type. Tighten both together
  separately — FU-Q5.
- `payment_invoices.currency` exists and is nullable `text`. The call site reaches
  it through `(invoice as { currency?: string | null }).currency` only because an
  inline read has no type. **M-5 typing it properly and dropping the cast counts
  as part of the move**, not a rider (CLAUDE.md rule 6).

---

## Placement — the guarded source regions

All three target files carry source-shape guard tests that pin regions by text
offset and forbid `try {` / `logger.` / `.eq('user_id'` inside them. The natural
"append at the end of the class" insertion point falls **inside** one. This is
parent-QA Bug 1 repeating, and it is now an exit criterion.

| File | Guarded region | Guard test | Where the new methods go |
|---|---|---|---|
| `PaymentRepository.ts` | **L1936 → L2092** (webhook header → `// Stripe Connect Repository`), i.e. the whole tail of `PaymentInvoiceRepository` | `PaymentInvoiceRepository.webhook.test.ts:475-512` forbids `try {` and `logger.` in it | **M-5, M-6 before L1936** |
| `PaymentPlanRepository.ts` | **L1045 → L1163** (unscoped) and **L1163 → L1210** (owner-scoped, to `// ==================== HELPER METHODS`) | `PaymentPlanRepository.webhook.test.ts:353-399`. Line 399 pins `.eq('user_id', userId)` in the scoped region to **exactly `SCOPED.length` = 2** | **M-1…M-4 before L1045**, beside `cancelOpenStagesForBooking` (L856) |
| `PaymentPlanSubscriptionRepository.ts` | **L446 → end of class**; also forbids `cancel_reason\|cancel_note\|cancelled_by` | `PaymentPlanSubscriptionRepository.webhook.test.ts:157-178` | nothing added — Q-2 reuses the existing `findLiveForBooking` |

A method with `.eq('user_id', userId)` placed in `PaymentPlanRepository`'s scoped
region breaks an exact count, which is a red suite rather than a subtle bug — but
only if the guard runs, hence the exit criterion.

---

## Slices

Small, numbered, one commit each, in this order. **Two PRs, and the gate stays**
(SA's Q-4 ruling): parent A3's revert-granularity reasoning is untouched by
§Finding, and the two files share no suite and no `try` block — the opposite of
parent B3.

| # | Scope | Why this boundary |
|---|---|---|
| **1** | M-3, M-4 + their unit tests | `PaymentPlanRepository` only, no call site touched. Unit-testable in isolation |
| **2** | `stopBookingPlan.ts` onto M-3, M-4, `findOwnedId`, `findLiveForBooking`; **plus D-5's renamed test** | the smaller file (4 sites, 10 tests) |
| **3** | M-1, M-2, M-5, M-6, M-7 + their unit tests, + the `LIVE_INVOICE_STATUSES` constant move | the remaining repository additions, no call site touched |
| **3b** | M-2 gains `cancellation: { reason, note, by }` and writes the four columns | a **separately described** commit, not a rider on the move — see D-3 |
| **4** | `cancelQuoteStages.ts` onto them, + the fake extension and the re-homed source-scan assertions | the 6-site file, last |

**The gate between PR 1 and PR 2 changes meaning.** It is no longer "does §Finding
hold" — that is settled. It is **"does slice 4's test rework stay test-only"**, and
SA requires §Slice 4 Test Plan signed off before slice 3 is coded.

---

## Slice 4 Test Plan

Required by SA before slice 3 is coded. The question it has to answer: the four
dying source-text assertions (§Finding exception 1) are the **only** coverage the
loose-invoice path has, so this is a coverage move, not a deletion.

### What happens to each dying assertion

| Dying assertion in `cancelQuoteStages.test.ts:703-746` | Re-homed to |
|---|---|
| `.in('status', LIVE_INVOICE_STATUSES)` | `PaymentInvoiceRepository.findOpenForBooking` unit test — asserts the `in` filter carries exactly `['draft','sent','overdue']` |
| `const LIVE_INVOICE_STATUSES = ['draft','sent','overdue']` | a unit test on the constant **in `PaymentRepository.ts`**, asserting its value *and* that it differs from `ISSUED_INVOICE_STATUSES` by `draft`/`pending` (K3) |
| `.eq('user_id', userId)` | the same unit test — Rule 4 assertion on the method |
| `.eq('booking_id', proposal.booking_id)` | the same unit test |

The surviving assertions in that `describe` stay exactly where they are: they
assert call-site facts (`cancelUnpaidInvoice = false`, the dedupe, the
log-and-continue), and the call site keeps all three.

### The fake extension (H-1)

`cancelQuoteStages.test.ts`'s fake defines only `select / update / eq / is / not /
maybeSingle / then`. It must gain pass-through `in`, and `limit` / `order` /
`range` / `single` defensively. **`in` is not optional**: D-2's `stopAccepted`
chains `.in('id', ids)`, so without it the chain breaks *before* the terminal
`.select()`, `dbState.updates` never receives its `proposals` entry, and roughly
ten tests that call `statusUpdate()` fail. Extending the fake is test-only and
cannot affect production.

Once `in` exists, the loose-invoice path becomes **executable for the first time**,
so slice 4 adds behavioural tests for it: that it is skipped unless
`cancelUnpaidInvoice`, that it skips ids already in `stageInvoiceIds`, and that one
void failure does not abandon the rest.

---

## Invariants That Must Stay At The Call Site

Carried across from parent D6 and extended by SA (its L-labels in brackets).
Twelve, not six.

1. **`cancelQuoteStages`: void BEFORE close.** Invoices are voided (L211–L344)
   before stages are closed (L352). A crash between them leaves stages `pending`
   — visibly unfinished and safe to re-run. The reverse order leaves a closed
   stage beside an invoice still chasing the client, which looks finished and is
   not. **No repository method may ever both void and close.**
2. **`stopBookingPlan`: read → void → close.** Same reason, and the read must stay
   separate from the close because `voidInvoice` has to be called per invoice; a
   bulk update leaves nothing to iterate.
3. **`cancelQuoteStages`: the proposal status update is LAST and conditional on
   `accepted`.** Statement order in the function, which no repository can enforce.
   `stopAccepted` carries the `.eq('status','accepted')` guard; the *lastness* is
   the call site's.
4. **"Everything not settled, which includes the billed ones."** `paid` and
   `cancelled` are the only settled statuses; a `billed` stage whose invoice this
   same call just voided must be closed, or it reads `billed` on a stopped job.
   The filter lives in M-2 / M-3 / M-4; the *reason* travels with it.
5. **`stopBookingPlan`: the Stripe branch delegates entirely to `cancelPlan`**,
   including the local close, and refuses rather than half-doing it when no Stripe
   client is available. Closing local rows while the subscription kept its schedule
   would show a stopped plan to the owner and keep charging the client.
6. **Void failures are counted and logged, never fatal.** A plan half-stopped is
   worse than one stopped with an invoice still open, because the open invoice is
   visible where a still-charging plan is not.
7. **Ownership is read before any write, at both sites** — [SA L1]. The point is a
   clean refusal rather than a silent no-op on someone else's row.
8. **`stageInvoiceIds` collects every stage invoice, voided or not** — [SA L2]. The
   `push` stays *before* the liveness check. Both the loose-sweep dedupe and
   `invoicesVoided` depend on it, and on M-1 not being narrowed to live invoices
   only.
9. **`collected` is summed from exactly the invoices the void loop SKIPS** — [SA L3].
   A settled invoice is not voided, so the sum and the skip are the same branch.
   This is the coupling FU-Q2 would break.
10. **The three error reactions are deliberately different** — [SA L4]:
    `billedError` logs and continues, `closeError` aborts, `statusError` logs and
    still returns `ok: true`. Routing all three through methods that log and return
    null makes flattening them into one shape easy and wrong.

    **Operationally** — [SA S-3] — every routed site branches on **`error`**, never
    on `!data`. This is a K1 consequence and is easy to get backwards: M-4 returns
    `{ data: null, error: null }` on success, so `if (!data)` is *always* true; and
    M-2 returns `{ data: [], error: null }` when it legitimately closes zero
    stages, so `if (!data?.length)` would report failure where today's behaviour
    is the correct `stagesClosed: 0, ok: true`. SA will check this line by line in
    code review.
11. **`ok: true` with no write when nothing is open** — [SA L5]. A plan collected in
    full, or already stopped, is not an error.
12. **A missing fake method is no longer loud** — §Finding exception 2. Not a
    production invariant but a test-integrity one, and it governs §Slice 4 Test Plan.

---

## Declared Behaviour Deltas

Every one must appear in its commit message. None is a silent rider on a commit
described as a pure move.

| # | Delta | Assessment |
|---|---|---|
| **D-1** | ~~`.limit(1)` from reusing `findAnyForBooking`~~ | **STRUCK** by SA's Q-2 ruling. The reuse is `findLiveForBooking`, where `maybeSingle()` is provably safe, so there is no limit delta |
| **D-1′** | `stopBookingPlan:124` fetches five columns where one is needed | `findLiveForBooking` returns more than `id, status`. Declared; harmless; one row |
| **D-2** | `cancelQuoteStages:436` filter becomes `.in('id', [id])` from `.eq('id', id)` | Equivalent in SQL. Returns `package_booking_id` as an extra unread column. The test assertion changes shape, and the fake needs `in` (§Slice 4 Test Plan) |
| **D-3** | M-2's move patch writes no `cancel_reason` / `cancel_note` / `cancelled_by` | Confirmed for the **move** commit. But the remainder is **not** an unbounded follow-up: it ships as slice **3b**, a separately described commit in PR 2. `cancelOpenStagesForBooking`'s own doc states the invariant this breaks — "THE REASON TRAVELS. One namespace with every other cancellation surface… which is what lets one report union them" — and the reason is already in hand at the call site. SA explicitly **rejected** the shortcut of adding the parameter in the move commit and passing `{}`: `cancel_reason: … ?? null` writes an explicit NULL where today's update does not name the column at all |
| **D-4** | M-3 carries no `is('subscription_id', null)` filter, matching today's inline read | Deliberate and load-bearing: the periods of a *stopped* subscription reach this branch and must be closed. Documented in the method so a later "consistency" fix has to change a test on purpose |
| **D-5** | **The fall-through decision moves from a call-site predicate into a database filter** (SA S-1, blocking before slice 2) | Today the site reads every plan row and decides in TypeScript: `subscription && !isPlanStopped(subscription.status)`. Under the Q-2 ruling `findLiveForBooking` decides in the query, and the site branches on `subscription !== null`. Equivalent in production — the predicate is identical (§Methods proof) — but **the fake can no longer express "a cancelled plan is present"**, because its `maybeSingle` is `data: Array.isArray(rows) ? rows[0] ?? null : …`, which returns the first row **without evaluating any filter** (`stopBookingPlan.test.ts:55-59`, verified). So `stopBookingPlan.test.ts:232`, *"treats an already-stopped subscription as an ordinary invoice plan"*, becomes unsatisfiable: the fake hands back the `cancelled` row, the site delegates, no Stripe client is supplied and the result is `ok: false` where the test expects `ok: true`. Handling, all four parts required: **(a)** express the case as `tables['payment_plan_subscriptions'] = []`; **(b)** **rename** the test — it now proves "no live plan falls through to the invoice path", not "a stopped plan does", and leaving the old name on it would be a comment that lies; **(c)** the invariant does not disappear, it **changes suite** — it lives in `findLiveForBooking`'s own unit test, which already asserts the status filter (parent D3) and which parent QA confirmed catches the mutation "`findLiveForBooking` loses its status filter"; **(d)** that mutation joins exit criterion 4, because it is what now carries invariant I-5 |
| **M-a** | Every routed error is now logged **twice, with different wording** | `findOwnedId` logs "Failed to check booking ownership"; the call site logs "Could not read the booking". These are the lines an operator greps during a money incident. Accepted, but the call-site wording is the one to keep searchable |
| **M-b** | The per-stage invoice read's error is currently **discarded** (L260 does not destructure `error`); M-5 will log it | One log line per stage on a flaky database. Accepted: a swallowed error on a money path is worse than a noisy one |

---

## Hazards

### H-1 — the `cancelQuoteStages` fake is an explicit builder, not a Proxy

`stopBookingPlan.test.ts` mocks `from()` with a `Proxy`, so any builder method a
repository calls is absorbed. `cancelQuoteStages.test.ts` defines `select`,
`update`, `eq`, `is`, `not`, `maybeSingle` and `then` **explicitly**.

A repository method calling anything else throws — and per §Finding exception 2
that throw now lands inside a repository `try` and is swallowed, where today it
would surface. **`in` is certainly needed** (D-2). Mitigation and scope: §Slice 4
Test Plan. Extending the fake is test-only; constraining the methods would put a
test's shape into production code.

### H-2 — the N+1 invoice read at `cancelQuoteStages:260`

One `payment_invoices` read per billed stage, inside the void loop. M-5 preserves
it exactly. Collapsing it into one `.in('id', ids)` read would also break
invariant I-9, which depends on the sum happening in the branch that skips the
void. **Not in this plan** — FU-Q2.

### H-3 — `supabaseServer` stays imported in `cancelQuoteStages.ts`

It is still needed for `lowerPlansForCancelledStages(supabaseServer, …)` (parent
A1). So that file's criterion is **"no `.from(`"**, not "no `supabaseServer`
import". `stopBookingPlan.ts` has no such hand-off, so there the import goes and
`grep -c supabaseServer` must reach 0.

### H-4 — a surviving mutation is the only proof the tests are not vacuous

Per parent B4: no slice is complete on a green suite. The mutation set is in
exit criterion 4 and now includes ordering and guard mutations, not just filter
ones.

### H-5 — the guarded source regions

See §Placement. Three guard tests pin regions by text offset; one pins an exact
`.eq('user_id', userId)` count. Inserting in the wrong place turns a required
suite red.

### H-6 — the live money check

SA's E1 allows QA a live money check. Anything run against live data must be a
**read**, or a write on a row created for the test and cleaned up. Nothing in
this plan justifies stopping a real client's plan. **The QA report names the row
ids any live check touched** (SA S-1 conditions), so a reviewer can tell a
fixture from a real client's money.

---

## Exit Criteria

Criteria 1, 5, 6 and 7 approved as originally written; 2, 3 and 4 rewritten per
SA, and 8–10 added.

1. `grep -c "\.from("` returns **0** in both files.
2. **Rewritten (§Finding exception 1).** Both existing suites pass. Of the 57
   assertions, the four source-text ones listed in §Slice 4 Test Plan are
   **re-homed to repository unit tests, not deleted**; every other assertion
   survives unchanged but for the fake extension and D-2's shape change. The
   loose-invoice path gains behavioural coverage it has never had.
3. **Extended.** Every new method has a unit test asserting its filters —
   including both halves of the pair: the **absence** of `is('subscription_id', null)`
   on M-3 (D-4), *and its presence* on M-1 and M-2, *and* that M-4 is scoped
   `in('id', …)` rather than by `booking_id`.
4. **Extended.** The mutation set is 100% caught. Filter mutations: drop each
   `user_id`; drop `booking_id` / `proposal_id`; widen `not('status','in',…)` to
   match `paid`; remove `is('subscription_id', null)` from M-1 / M-2; swap M-4's
   `in('id')` for a `booking_id` scope. Plus seven ordering and guard mutations:
   swap `findLiveForBooking` for `findAnyForBooking` at `:124`; close-before-void
   at both sites; move the proposal status update earlier; drop
   `if (!invoice) continue`; drop the `stageInvoiceIds` dedupe; drop the
   `!openPeriods?.length` early return; skip the ownership read. Plus, per D-5,
   **"`findLiveForBooking` loses its status filter"** — after slice 2 that
   mutation is the only thing carrying invariant I-5, and parent QA confirmed its
   existing unit test catches it.
5. `npm run build` clean for the touched files; the repo's pre-existing errors
   filtered out, and the command checked for an OOM crash rather than grepped for
   "clean".
6. QA runs the full gate, and is **allowed a live money check** per SA's E1,
   within H-6.
7. No commit before the user has seen the diff.
8. **Added.** The three webhook source-shape guards green —
   `PaymentInvoiceRepository.webhook.test.ts`,
   `PaymentPlanRepository.webhook.test.ts`,
   `PaymentPlanSubscriptionRepository.webhook.test.ts` — plus
   `paymentTablesWriteLockdownMigration.test.ts` and
   `lib/payments/__tests__/planSurfaces.guard.test.ts`.
9. **Added.** A per-slice full gate, diffed against a baseline worktree at the
   merge-base. This is how parent QA found both of its branch-only failures; a
   green run on the branch alone proves nothing about what the branch changed.
10. **Added.** `grep -c supabaseServer` returns **0** in `stopBookingPlan.ts`
    (H-3 — the criterion differs per file).

---

## The Four Questions, And Their Answers

Asked of SA before implementation; answered in full in §SA Review. Summary:

| # | Question | Ruling |
|---|---|---|
| Q-1 | M-7, or reuse `ProposalRepository.findById`? | **Add M-7**, renamed `findStopTarget`. `findById` is `select('*')` — parent A2's over-fetch objection applies |
| Q-2 | Is the `.limit(1)` from reusing `findAnyForBooking` acceptable? | **No. D-1 struck; route through `findLiveForBooking`** instead, where `maybeSingle()` is provably safe. Blocking condition (`status NOT NULL`) verified |
| Q-3 | Does M-2 ship without the cancellation columns? | **Yes for the move commit**, with the remainder as slice **3b**, not an open follow-up |
| Q-4 | One PR or two? | **Two, and keep the gate** — with its meaning changed to "does slice 4's rework stay test-only" |

---

## Implementation — PR 1 (slices 1 and 2)

Coded 2026-10-31, after SA's revision-2 sign-off. Not committed: the user sees
the diff first.

### Slice 1 — M-3 and M-4 in `PaymentPlanRepository`

Placed at **L929** (`findOpenPeriodsForBooking`) and **L982** (`cancelStagesByIds`),
inserted at the seam between `cancelOpenStagesForBooking`'s closing brace and
`stampFirstPeriodInvoice`'s doc block — so no JSDoc was orphaned from its method,
the defect SA caught three times in the parent stream. The webhook header moved
from L1045 to L1159, i.e. both methods are **before** the guarded region as
§Placement requires.

- 12 unit tests, all passing.
- **Mutations: 12/12 caught.** Both halves of the pair are proved: `M-3 gains the
  subscription filter` (the D-4 violation) is caught, and so are `M-4 closes every
  period of the owner, not the ids`, `M-4 loses user_id`, `M-4 stops clearing
  next_retry_at`, `M-4 adds a terminal select to return a count` and `M-3 matches
  only pending, not billed`.
- Two mutations initially reported `PATTERN-MISS`, which was a flaw in the
  mutation script — the patterns matched `cancelOpenStagesForBooking` as well —
  not evidence about the tests. Re-run with anchors unique to M-4: both caught.
- Guard suites green: all four of criterion 8's, 87 tests.

### Slice 2 — `stopBookingPlan.ts` routed

Exit criteria 1 and 10 met for this file: **`.from(` = 0** and
**`supabaseServer` = 0**. `ALREADY_CLOSED` and the `isPlanStopped` import are now
dead and removed; the status filter's reason moved to M-3's doc beside the query.

**§Finding held, and D-5 was exactly as SA predicted.** Of the 10 existing tests,
**9 passed untouched** after the move; precisely one failed —
`stopBookingPlan.test.ts:238`, `Expected: true, Received: false` — the test S-1
named. It is renamed and re-expressed per D-5(a)/(b).

**Better than D-5(c) required.** SA ruled the old guarantee "changes suite" to
`findLiveForBooking`'s own unit test. It does — but it can also stay asserted
*here*, because the fake records the column and operator of a `.not(…)`. So a new
test, *"asks only for a LIVE plan, in the query"*, asserts `['status', 'in']`
plus the `user_id` and `booking_id` scopes on the routed read. Invariant I-5 is
therefore carried in both suites, not moved out of this one. **11 tests, all
passing.**

- **Mutations: 5 of 6 caught, 1 equivalent.** Caught: live-plan read swapped for
  the any-plan read (T1, the Q-2 ruling's own hazard); ownership read skipped;
  **close happens before the voids** (T4, invariant 1); the reason stops
  travelling to the close; `findLiveForBooking` loses its status filter (T6, which
  D-5(d) added and which now carries I-5).
- **T3 — "nothing-owed early return dropped" survived, and that is correct.** It
  is an *equivalent* mutation after slice 1, not a coverage gap. M-4 guards the
  empty list itself, so with `openPeriods = []` both versions issue no query and
  return `{ ok: true, cancelledPeriods: 0 }`; the existing test at
  `stopBookingPlan.test.ts:174` pins that outcome and passes either way. Worth
  recording because it is a **change in what the early return is for**: before the
  move, dropping it sent `in.()` to PostgREST and flipped `ok` to false, so it was
  a correctness guard; now it is a short-circuit and M-4 is the guard. No
  behaviour delta — the outcome is identical — so this is an observation, not a
  D-row.

### Found in passing — FU-Q6, and deliberately not fixed

`stopBookingPlan`'s subscription read **discards its error** today:
`const { data: subscription } = await …`, with no `error` destructured. So a
failed read yields `null` and the function falls through to the invoice path —
closing local periods on a booking whose Stripe subscription may still be
charging. That is invariant **I-5**'s exact failure mode, reached by a database
error rather than by a logic slip.

The routed version **preserves it**, with the reason written at the call site, and
it is filed as FU-Q6 rather than fixed here: changing it inside a commit described
as a pure move is what D-3 and S-2 exist to prevent. It is pre-existing, it is on
a money path, and it now at least logs — `findLiveForBooking` logs the error the
inline read swallowed. **Recommend FU-Q6 be scheduled, not left open.**

---

## Implementation — PR 2 (slices 3, 3b and 4)

### Slice 3 — M-1, M-2, M-5, M-6, M-7 and the constant move

| Method | Class | Placed |
|---|---|---|
| `findBilledStagesForProposal` | `PaymentPlanRepository` | beside M-3/M-4, **before** the unscoped webhook header |
| `cancelOpenStagesForProposal` | `PaymentPlanRepository` | ditto |
| `findSettlementStateById` | `PaymentInvoiceRepository` | **before** the webhook header at the class tail |
| `findOpenForBooking` | `PaymentInvoiceRepository` | ditto |
| `findStopTarget` | `ProposalRepository` | end of class — this file carries **no** guarded region (verified: no test reads its source) |

`LIVE_INVOICE_STATUSES` now lives in `PaymentRepository.ts` beside
`ISSUED_INVOICE_STATUSES`, with the `draft`-versus-`pending` difference written
between them. **S-2 honoured:** `SETTLED_INVOICE_STATUSES` stayed in
`cancelQuoteStages.ts`, and so did its source-text assertion.

**One thing the plan did not foresee.** `LIVE_INVOICE_STATUSES` has *two* uses in
`cancelQuoteStages.ts`, not one: the loose sweep's `.in('status', …)` filter, and
a per-row predicate inside the stage loop
(`if (!LIVE_INVOICE_STATUSES.includes(invoice.status)) continue;`). The plan
described it only as a query filter. So the **declaration** moved with the query,
as ruled, and the call site **imports** it for the predicate — one list, one
source of truth, no duplicated array. This is the only departure from the written
plan and it changes nothing about S-2's reasoning.

§Placement held: `PaymentPlanRepository.webhook.test.ts` stayed green, including
the assertion pinning `.eq('user_id', userId)` in its scoped section to exactly 2.

**43 unit tests across three new suites. Mutations: 21/21 caught.**

The mutation harness was itself falsified before its result was trusted: an
**equivalent** mutation (swapping the order of two `.eq()` filters, which
`toContainEqual` cannot see) was confirmed to **survive**, and a real one (wrong
table) to be caught. Without that check the run was worthless — a `cp1252`
reader thread throws on the shekel sign in the new doc comments, and had that
been setting the exit code, every mutation would have read "caught".

### Slice 3b — the reason travels

`cancelOpenStagesForProposal` gained `cancellation: { reason, note, by }` with
`by` defaulting to `'owner'`, and writes `cancel_reason`, `cancel_note`,
`cancelled_by` and `cancelled_at`. Per D-3 this is a **separately described
commit**, not a rider on the move.

Columns verified against `supabase/migrations/20260930_installment_cancel_reason.sql`:
all four present and nullable, and `cancelled_by` carries
`CHECK (… IN ('client','owner','system'))`, which the `'owner'` default
satisfies. *(The live-schema MCP check timed out twice; the migration is the
decisive local evidence and `cancelOpenStagesForBooking` already writes the same
four columns to the same table in production.)*

`cancelled_at` and `updated_at` are stamped from **one** `now`, with a test
asserting they are equal — two `new Date()` calls can straddle a millisecond and
leave a row that reads as edited after it was cancelled.

### Slice 4 — `cancelQuoteStages.ts` routed

All six queries gone: **`grep -c "\.from(" ` returns 0.** `supabaseServer`
remains as the import plus the one documented hand-off to
`lowerPlansForCancelledStages` — exit criterion 10 is per-file, and H-3 is why.

| Site | Routed to |
|---|---|
| ownership read | `proposalRepository.findStopTarget` |
| billed stages | `paymentPlanRepository.findBilledStagesForProposal` |
| per-stage invoice | `paymentInvoiceRepository.findSettlementStateById` — the `currency` cast dropped |
| loose sweep | `paymentInvoiceRepository.findOpenForBooking` |
| stage close | `paymentPlanRepository.cancelOpenStagesForProposal`, now carrying the reason |
| quote status | `proposalRepository.stopAccepted([id], …)` — delta D-2 |

**§Finding held a second time.** The suite went 47 → 52 tests and 80 → 90
assertions. Of the four dying source-text assertions, every one is re-homed, not
dropped; only **one** existing assertion changed shape, exactly the one D-2
predicted (`filters.id` → `ins.id`).

The fake gained `in` — **required**, not defensive, per the Slice 4 Test Plan —
plus pass-through `limit` / `order` / `range` / `single`. One bug caught in
writing it: `builder.single = builder.maybeSingle` assigns `undefined`, because
`maybeSingle` is defined further down the builder; it is a lazy call instead.

**The loose-invoice path is executable for the first time**, and gained six
behavioural tests: skipped unless asked, skipped without a booking, the dedupe
holding at `invoicesVoided`, one void failure not abandoning the rest, and a
failed sweep read not stopping the close. The four regex matches it replaces
could only ever see the query's *shape*.

### Exit criteria

| # | Result |
|---|---|
| 1 | ✅ `.from(` = 0 in both files |
| 2 | ✅ four assertions re-homed, one changed shape (D-2), none deleted; loose path gained coverage |
| 3 | ✅ every method has filter tests, both halves of each pair |
| 4 | ✅ **21/21** slice 3, slice 4 below, harness falsified |
| 5 | ✅ 0 diagnostics in the changed files; the check proven able to fail |
| 8 | ✅ all five guard suites green |
| 9 | ✅ **zero new failing suites.** Full gate on the branch: 29 failed / 1889 passed of 1926 suites, 169 failed / 48415 passed tests. Baseline at the merge base: 33 failed of 1914. Set diff: **29 of the 33 still fail (all pre-existing), 4 no longer do** (jsdom render flakes — the baseline log carries a jsdom `Timeout`), **and nothing new**. The first diff of these two lists was wrong and said all 29 were new: `jest` prints `FAIL` more than once per suite, so the file held 58 raw lines for 29 suites and `comm`'s set logic broke on the duplicates. Worth recording — the bogus answer looked like a catastrophe and the real one is clean |
| 10 | ✅ per-file, per H-3 |

---

## Follow-ups

| # | Item |
|---|---|
| FU-Q2 | Collapse the N+1 invoice read at `cancelQuoteStages:260` into one `.in('id', ids)` read — must preserve invariant I-9 |
| FU-Q3 | Narrow M-7's column list: `status` and `title` are read by nobody |
| FU-Q4 | **Pre-existing, found by SA, out of scope.** `collected` sums `amount - refunded_amount` across every settled stage invoice but labels the total with the **first** one's currency, and emails that to the client. A cross-currency sum, against CLAUDE.md § Currency & Timezone |
| FU-Q5 | Tighten `amount` and `payment_plan_id` to `NOT NULL` on both `cancelOpenStagesFor*` methods together, with `lowerPlansForCancelledStages` |
| FU-Q6 | **Money path, pre-existing, recommend scheduling.** `stopBookingPlan`'s subscription read discards its error, so a failed read falls through and closes local periods on a booking whose Stripe plan may still be charging — invariant I-5's failure mode via a database error. Preserved verbatim by slice 2 and declared rather than fixed (see §Implementation) |
| FU-A | (from the parent plan) `lowerPlansForCancelledStages`' own two statements, next to `PaymentReminderService` |

---

## SA Review

**Reviewed by SA — 2026-10-31 (pre-implementation)**
**Status:** 🔄 REVISION REQUIRED — approved in direction, blocked on five findings

The plan is well built: the site inventory is accurate, the invariant list is real
rather than decorative, and §Finding is the kind of correction that should stop a
plan rather than be absorbed silently. **§Finding holds** — verified against the
code, see Q-0 below — and it does retire one of E1's three bullets.

But it retires that bullet and replaces it with two costs the plan has not seen,
both of which have already bitten this stream once:

- **three of the 47 `cancelQuoteStages` assertions are SOURCE-TEXT SCANS of
  `cancelQuoteStages.ts`** and die when the read they scan for moves out of the
  file (J-1). Exit criterion 2 is therefore false as written.
- **all three target repository classes carry guarded source regions** that forbid
  `try {` and `logger.` and pin `.eq('user_id', userId)` occurrence counts. A
  method appended at the natural end of `PaymentInvoiceRepository` or
  `PaymentPlanRepository` lands inside one and turns a required gate red (J-2).
  This is parent-QA Bug 1 repeating verbatim.

Neither changes the direction. Both change what slices 3 and 4 cost, so slice 4's
test work must be re-planned before it is coded.

---

### Q-0 — §Finding: verified, it holds, and what it does to E1

1. **Q-0.1** — Confirmed against the code. `proposalRepository` is
   `new ProposalRepository()` with `constructor(private supabase = supabaseServer)`;
   `paymentInvoiceRepository` is `new PaymentInvoiceRepository()` with
   `constructor(supabase: SupabaseClient = supabaseServer)`;
   `paymentPlanRepository` is `new PaymentPlanRepository(supabaseServer)` (the
   import sits at `PaymentPlanRepository.ts:1235`, below the class — immaterial,
   ESM hoists it); `paymentPlanSubscriptionRepository` is
   `new PaymentPlanSubscriptionRepository()` with the same default parameter;
   `schedulingBookingRepository` is `new SchedulingBookingRepository(supabaseServer)`.
   Every one resolves the binding at construction, which happens after
   `jest.mock('@/lib/supabaseServer')` has replaced the module in the registry. So
   the singletons hold the fake and the fake goes on recording the filters, one
   layer down, in the same order. The plan's table is correct. — [SA: approved]
2. **Q-0.2 — E1 sizing: the cost bullet is WITHDRAWN; the ruling is unchanged.**
   E1 rested on three bullets. Bullet 2 (the rewrite cost) is wrong and I withdraw
   it, superseded by J-1 and J-2 — a smaller cost, but not nil. Bullet 1 (zero
   perishable evidence) and bullet 3 (these two paths void invoices and close money
   rows; a mistake writes `status: 'cancelled'` over the wrong rows on a live
   account) stand untouched, and either alone was sufficient. So: own workplan, own
   SA pass, QA allowed a live money check — unchanged. — [SA: approved]
3. **Q-0.3** — One mechanism §Finding does **not** carry across, and it inverts a
   safety property. Today a missing builder method on the fake throws straight out
   of `cancelQuoteStages` — there is exactly one `try` in that function (the email
   block, L495), so the failure is loud. After the move the throw happens *inside*
   a repository method's `try`, is caught, and returns `{ data: null, error }`,
   which three of the four call sites log and continue past. H-1's phrase "inside a
   `try` that swallows it" is wrong about today and right about tomorrow. The
   consequence is a rule, not a correction: **no slice may be accepted on a green
   suite** — see H-4 and J-3. — [SA: pending Dev]

---

### Answers to the four questions

#### A-1 — Q-1: add M-7. Do not reuse `findById`. Keep it byte-faithful, and rename it.

- **The parent's A2 over-fetch objection applies verbatim.** `ProposalRepository.findById`
  is `select('*')`, which on `proposals` pulls `accepted_snapshot` and the frozen
  tax fields — the quote's entire snapshot — on every cancellation. The plan is
  right that A2's other two objections (`.single()`, error-log-on-miss) do not
  apply here, but the third is enough on its own: a deliberate payload increase
  inside a commit described as a pure move.
- **A named narrow method is also the only thing that tells the next reader which
  columns the stop path depends on.** `findById` tells them nothing.
- **Keep today's five columns exactly** — `id, user_id, booking_id, status, title`.
  I checked: only `booking_id` is ever read (L318, L323, L527); `status` and
  `title` are dead. Dropping them would be an improvement and therefore belongs
  in a separate commit, not this one — the same reasoning the plan applies to
  itself in D-3. File as **FU-Q3**.
- **Rename required.** `findStopState` reads as "has this been stopped", which is
  not what it answers — it answers "is this quote this owner's, and what booking
  is it on". Use `findStopTarget(id, userId)`. Not negotiable as a name *shape*:
  the method name must state the question (the `findAnyForBooking` / `findLiveForBooking`
  precedent in D3 of the parent plan). — [SA: pending Dev]

#### A-2 — Q-2: NO. Reject the `.limit(1)`. Use the existing `findLiveForBooking` instead, conditional on one schema check.

The `.limit(1)` is not acceptable, and the live-schema evidence makes that
clearer than the plan does: `idx_plan_subs_one_live_per_booking` is a **partial**
unique index over `booking_id WHERE booking_id IS NOT NULL AND status = ANY
('pending','active','past_due','paused')`. It constrains the *live* rows only, so
the schema permits any number of `completed` / `cancelled` rows per booking beside
one live one. The read at `stopBookingPlan.ts:124` applies no status filter and
ends in `maybeSingle()`, so one cancelled plan plus one active plan on the same
booking makes that read throw **today**. `.limit(1)` converts that loud throw into
a silent, un-ordered, arbitrary pick — on the branch that decides whether to
delegate to Stripe or close rows locally. Pick the cancelled row and
`isPlanStopped` is true, `cancelPlan` is never called, and the local periods are
closed while the subscription keeps charging the client. That is **invariant 4**,
the worst failure this file names. Latent, not live (0 bookings currently carry
more than one plan row), but "latent on a money path" is not a defence.

**The fix is not a third method.** Use the existing
`paymentPlanSubscriptionRepository.findLiveForBooking(bookingId, userId)`:

- It is the question the call site actually asks. `subscription && !isPlanStopped(subscription.status)`
  collapses to `subscription !== null`.
- The predicate is **identical**, not merely similar: `findLiveForBooking` filters
  `not('status','in','(completed,cancelled)')` from `PLAN_STOPPED_STATUSES`, and
  `isPlanStopped` is membership of that same array. Same module, derived not
  retyped.
- `maybeSingle()` is **provably** safe there, which it is not today:
  `PlanSubscriptionStatus` has exactly six values, so "not completed, not
  cancelled" is exactly the four the partial index covers. At most one row can
  match. The `.limit(1)` question disappears rather than being answered.
- It already exists, already has a unit test, and that test already asserts the
  status filter is present (parent D3) — so the invariant arrives guarded.

**Two conditions, both blocking:**

1. **Verify `payment_plan_subscriptions.status` is `NOT NULL` in the live schema
   before adopting this.** A NULL status is excluded by `not('status','in',…)`
   (SQL three-valued logic) but `isPlanStopped(null)` returns `false`, so today a
   NULL-status row is treated as **live** and refuses without Stripe. After the
   change it would be treated as absent and the local close would run. `isPlanStopped`'s
   own doc says that direction is the unsafe one ("not knowing is not the same as
   knowing it is finished"). If the column is nullable, this becomes a declared
   behaviour change and needs a `.or(status.is.null,…)` or a dedicated method.
2. **Declare the over-fetch as D-1′:** `findLiveForBooking` selects five columns
   where the site needs `id`. Trivial, one row, but it goes in the commit message
   like every other delta.

**D-1 as written is struck.** `findAnyForBooking` stays reserved for the
`ON DELETE RESTRICT` pre-check it was built for; E2's "two of its four sites
arrive pre-built" becomes "two arrive pre-built, and the second is a *different*
pre-built method from the one E2 named". — [SA: pending Dev]

#### A-3 — Q-3: confirmed for the move commit, but D-3 does not become an unbounded follow-up. It ships as a second, separately-described commit in the same PR.

- **Confirmed:** M-2's move commit writes `status, next_retry_at, updated_at` and
  nothing else, exactly as `cancelQuoteStages.ts:354` does today. The pure-move
  reading is right and I will not approve a behaviour change hidden in a move.
- **But FU-Q1 is the wrong home for the rest.** `cancelOpenStagesForBooking`'s own
  doc block states the invariant D-3 breaks: *"THE REASON TRAVELS. One namespace
  with every other cancellation surface (`20260930_installment_cancel_reason`),
  which is what lets one report union them without a translation layer."* D-3
  leaves one of the three stop paths writing NULL into that namespace. The reason
  is already in hand at the call site (`input.reason` is REQUIRED). An open-ended
  follow-up on a documented cross-surface reporting invariant has no owner.
- **Required shape:** PR 2 carries the move commit, then a second commit
  `fix(payments): the quote stop records its reason on the stages it closes`,
  which adds the `cancellation: { reason, note, by }` parameter to M-2, the four
  columns to the patch, and a unit test. Additive only: it cannot change which
  rows match and cannot change `status`.
- **Do not take the shortcut of giving M-2 the parameter in the move commit and
  passing `{}`.** `cancel_reason: cancellation.reason ?? null` writes an explicit
  NULL where today's inline update does not name the column at all. That is a
  silent delta inside a move. The move commit's patch has three keys; the second
  commit changes the method. — [SA: pending Dev]

#### A-4 — Q-4: keep two PRs and keep the gate. Reject one PR. Add an SA sign-off on slice 4's re-plan.

- **Reject all four in one PR.** Parent A3's third bullet applies unchanged: it
  makes a revert all-or-nothing across both money-closing paths. §Finding being
  proven does not touch that.
- **Keep 1+2 as PR 1, 3+4 as PR 2, one commit each.** The two files share no suite
  and no `try` block, which is the opposite of parent B3 — so unlike slices 2–4 of
  the parent stream there is no reason to bundle them.
- **Keep the gate after slice 2, with new meaning.** It is no longer "does §Finding
  hold" — that is settled. It is: does the `cancelQuoteStages` mock rework plus the
  source-scan re-homing stay **test-only**? J-1 and J-2 say slice 4's test work is
  materially bigger than slice 2's, and the plan's estimate for 3/4 was built on
  the assumption it is the same.
- **Added gate:** before slice 3 is coded, this document gains a §Slice 4 test plan
  naming (a) every source-scan assertion being re-homed and where to, (b) the mock
  methods being added, (c) the placement line for each new method relative to the
  guarded regions in J-2. That is **documentation-only and I will sign it off on
  the spot** — no second full SA cycle. — [SA: pending Dev]

---

### Comments

**J — The two costs the plan has not seen (both blocking)**

1. **J-1 — three to four of the 47 `cancelQuoteStages` assertions are source-text
   scans of the file being changed, and they die with the move.** Exit criterion 2
   ("no assertion deleted — only the mechanical edits of H-1 and D-2") is **false**.
   `cancelQuoteStages.test.ts:703-746` reads `lib/payments/cancelQuoteStages.ts`
   off disk, strips comments, and asserts on a 900-character slice from
   `if (cancelUnpaidInvoice`:

   | Assertion | After the move |
   |---|---|
   | `sweep` contains `.in('status', LIVE_INVOICE_STATUSES)` | **dies** — the read is M-6 |
   | `sweep` contains `.eq('user_id', userId)` | **dies** |
   | `sweep` contains `.eq('booking_id', proposal.booking_id)` | **dies** |
   | `code` contains `const LIVE_INVOICE_STATUSES = ['draft', 'sent', 'overdue']` | dies **if** the constant moves (see J-4) |
   | `cancelUnpaidInvoice = false`, `if (cancelUnpaidInvoice && proposal.booking_id)`, `if (stageInvoiceIds.includes(invoice.id)) continue;`, the voidError/warn/continue regex | survive — all call-site |

   These are not incidental: that whole `describe` block exists because **no
   executable test covers the loose-invoice path at all**. The fake defines no
   `in`, so the path cannot run; the source scan is the only coverage it has. They
   must be **re-homed, not deleted** — as a source-shape guard over the repository
   file plus a real executable test on M-6 now that `in` exists on the fake. Count
   this as the single largest line item in slice 4. — [SA: pending Dev]

2. **J-2 — all three target repository classes carry guarded source regions, and
   the natural insertion point is inside one of them.** This is parent-QA Bug 1
   repeating. Measured:

   | Class | Guard | Guarded region | Where M-* may go |
   |---|---|---|---|
   | `PaymentInvoiceRepository` | `PaymentInvoiceRepository.webhook.test.ts:469` | `PaymentRepository.ts` L1936 → L2092 (`// Stripe Connect Repository`) — i.e. **the whole tail of the class** | M-5, M-6 **before L1936** |
   | `PaymentPlanRepository` | `PaymentPlanRepository.webhook.test.ts:349` | L1045 → L1163 (unscoped) and L1163 → L1210 (scoped) | M-1…M-4 **before L1045**, beside `cancelOpenStagesForBooking` (L856) in the INSTALLMENT OPERATIONS section |
   | `PaymentPlanSubscriptionRepository` | `PaymentPlanSubscriptionRepository.webhook.test.ts:154` | webhook header → end of class | nothing planned; if A-2's schema check forces a method, **before the header** |

   Each region forbids `/\btry\s*\{/` and `/\blogger\./`, and the
   `PaymentPlanRepository` scoped region pins `.eq('user_id', userId)` to exactly
   `SCOPED.length` (2). A repository method written to the house style — try/catch,
   `logger.error`, one `user_id` filter — appended at the end of
   `PaymentInvoiceRepository` trips **three** assertions at once. Write the
   placement line into the plan per method, and make "the three webhook source-shape
   guards and `paymentTablesWriteLockdownMigration.test.ts` are green" an exit
   criterion. — [SA: pending Dev]

3. **J-3 — the acceptance for each slice is a full gate diffed against a baseline
   worktree, not a green suite.** Parent QA found both of its branch-only failures
   that way and neither was in a suite anyone would have thought to run. Combined
   with Q-0.3 — a missing fake method now returns a quiet `{ data: null, error }`
   instead of throwing — "the suite is green" has lost what little it was worth
   here. — [SA: pending Dev]

4. **J-4 — the `ISSUED_INVOICE_STATUSES` near-miss, and why M-6 takes no `statuses`
   parameter.** `PaymentRepository.ts:974` already exports
   `ISSUED_INVOICE_STATUSES = ['sent', 'pending', 'overdue']`. `LIVE_INVOICE_STATUSES`
   is `['draft', 'sent', 'overdue']`. They differ by **`draft` vs `pending`**, and
   reusing the wrong one would silently stop voiding draft invoices and start
   voiding pending ones on a path whose whole subject is "two live quotes in that
   state, one of them ₪5,000". Write that trap into the plan beside M-6.

   And **M-6 must not take a `statuses` array parameter.** Parent C0/C3 closed the
   generic-filter door: the filter is fixed inside the repository, one named
   transition per call site. Export a `LIVE_INVOICE_STATUSES` constant from
   `PaymentRepository.ts`, directly beside `ISSUED_INVOICE_STATUSES` with a comment
   naming the difference, and fix it inside M-6. `SETTLED_INVOICE_STATUSES` stays in
   `cancelQuoteStages.ts` — it is a predicate over a returned row, not a filter, and
   it belongs where the decision is made. — [SA: pending Dev]

**K — The method table**

5. **K1 — M-4 does not return a count, and must not.** The plan says "Returns a
   count, not rows". The call site already has the number —
   `cancelledPeriods: openPeriods.length` at `stopBookingPlan.ts:239` — and reads
   nothing but `closeError`. Deriving a count means adding `.select()` or
   `{ count: 'exact' }`, which changes what PostgREST returns for a write that
   today returns nothing. Make it `PaymentPlanRepositoryResult<null>`. (The
   `.or()` + `UPDATE` + `.select()` trap does not apply — no `.or()` here — but the
   principle that a move adds no terminal does.) — [SA: pending Dev]

6. **K2 — the argument for M-4 over `cancelOpenStagesForBooking` is correct and I
   endorse it.** Verified line by line: the existing method is `booking_id` +
   `not status in (paid,cancelled)` + `is('subscription_id', null)` and returns
   `id, amount, payment_plan_id`; the site is `in('id', …)` + `user_id` and returns
   nothing. Three differences, each load-bearing. The subscription one is the
   dangerous one and the plan has it exactly right: a **stopped** subscription falls
   through to this branch (and under A-2 that is now the *only* way it can), so its
   periods carry a non-null `subscription_id` and the booking-scoped method would
   silently stop closing them. Parent C3 governs: one named transition per call
   site. — [SA: approved]

7. **K3 — M-6 must be renamed.** `PaymentPlanSubscriptionRepository.findLiveForBooking`
   already exists and means "a plan still charging". Under A-2 both are reachable
   from the two files in this stream. Two same-named methods on different classes
   with different semantics on the same money path is a review rejection. Use
   `findOpenForBooking(bookingId, userId)`. — [SA: pending Dev]

8. **K4 — M-1, M-2, M-3, M-5 confirmed genuinely new and correctly placed** (subject
   to J-2's placement lines). `PaymentPlanRepository` has no `proposal_id`-scoped
   method of any kind, so M-1 and M-2 are new by scope, not by preference. M-3 is
   new by filter (no `subscription_id` exclusion). M-5 is new: `PaymentInvoiceRepository.findById`
   is `select('*')` + **`.single()`** + an error log, which would turn the loop's
   legitimate "this stage's invoice is gone" into an error row per stage;
   `findSettlementStateByStripeInvoiceId` is keyed by the Stripe id and unscoped.
   M-6 is new: `findByBookingId` is `select('*')` with no status filter. No claimed
   reuse is wrong except D-1 (A-2). — [SA: approved]

9. **K5 — the three reuses.** `findOwnedId` is exact, including the "not found is
   not logged" property the site needs. `stopAccepted` is behaviourally exact: same
   patch, same `stop_note?.trim() || null`, same `.eq('status','accepted')`, and
   `(data?.length ?? 0) > 0` reads the same on error (`data: null`). Its filter
   order differs (`user_id`, `in('id')`, `status` vs `id`, `user_id`, `status`) —
   immaterial, the fake records filters by column name, not position. `findAnyForBooking`
   is struck per A-2. — [SA: approved]

10. **K6 — typing rulings** (both raised during the live-schema check):
    - **M-2 mirrors the existing looser return shape** — `amount: number | null;
      payment_plan_id: string | null` — even though both columns are `NOT NULL`
      live. `lowerPlansForCancelledStages` consumes the rows of both M-2 and
      `cancelOpenStagesForBooking`; two different types for one consumer is worse
      than one loose type. Tightening both together is a welcome separate change,
      not this stream's.
    - **M-5 types `currency: string | null` and the cast at
      `cancelQuoteStages.ts:280` goes.** That counts as part of the move, not a
      rider: `(invoice as { currency?: string | null }).currency` exists only
      because an inline read has no type, and removing it is the move's own
      consequence (CLAUDE.md rule 6). Keep the `?? null` at the call site — the
      column is genuinely nullable. — [SA: pending Dev]

**L — Invariants the plan has not listed but the comments make load-bearing**

The list of six is right as far as it goes. Six more, each quoted from the code:

11. **L1 — ownership is read BEFORE anything is written, at both sites.** "*Confirm
    the quote is this user's BEFORE touching anything … without it, naming a
    stranger's proposal id would silently update nothing and report success, which
    reads as 'there was nothing to stop' rather than 'that is not yours'*"
    (L159-166); and "*Ownership first, before anything is written … the check that
    produces a clean refusal rather than a silent no-op*" (`stopBookingPlan` L97).
    Statement order, unenforceable by any repository. This is invariant 0 and the
    list starts at 1. — [SA: pending Dev]

12. **L2 — `stageInvoiceIds` collects EVERY stage invoice the walk saw, voided or
    not.** "*A stage that was PAID is not voided above … so the paid ones would be
    missing from any list built only from what we voided*" (L229-236). The loose
    sweep's `if (stageInvoiceIds.includes(invoice.id)) continue;` dedupe depends on
    it, and so does `invoicesVoided` not double-counting. The `push` must stay
    **before** the liveness check, and M-1 must not be narrowed to unsettled
    stages. — [SA: pending Dev]

13. **L3 — `collected` is summed from exactly the invoices the void loop SKIPS.**
    "*The settled invoices are exactly the ones this loop SKIPS … summing here
    rather than in a second query is the only place both facts are already in
    hand*" (L269-276). This is the coupling FU-Q2 (H-2) would break, so it has to be
    written down before FU-Q2 is picked up by someone who only reads the follow-up.
    — [SA: pending Dev]

14. **L4 — the three error reactions are deliberately different, and the call site
    owns all three.** `billedError` → log and **continue** with `[]`;
    `closeError` → **abort**, `ok: false`; `statusError` → log and still report
    `ok: true` ("*Loud, and NOT a failure of the whole call*", L452-460). Routing
    three reads through methods that all log-and-return-null preserves the data
    shape and makes it very easy to flatten the reactions into one. Name them. —
    [SA: pending Dev]

15. **L5 — `stopBookingPlan` returns `ok: true` with no write at all when nothing
    is open.** "*Nothing owed. Not an error: a plan collected in full, or already
    stopped*" (L177-180). The suite pins it (`expect(updates).toHaveLength(0)`), and
    it is what keeps M-4 from ever being called with an empty id list. — [SA: pending Dev]

16. **L6 — not an invariant but a finding, recorded because M-5 is the read that
    feeds it.** `collected` sums `amount - refunded_amount` across every settled
    stage invoice while `collectedCurrency ??=` labels the total with the **first**
    one's currency (L247-249, L277-281) — and that figure is emailed to the client
    as `paidAmount`. A business may invoice a quote's stages in more than one
    currency; CLAUDE.md § Currency forbids summing money across currencies, and
    this is a sum across currencies with one currency's label. **Pre-existing, not
    introduced here, and out of scope** — do not fix it in a move commit. File it
    as **FU-Q4** and say in the plan that M-5 preserves it deliberately. — [SA: pending Dev]

**M — Deltas the plan has not declared**

17. **M-a — every routed error is now logged twice**, once by the repository and
    once by the call site, and **the repository's wording is different**:
    `findOwnedId` logs "Failed to check booking ownership" where the site logs
    "Could not read the booking". These are the lines an operator greps during a
    money incident. Benign, but it is a change to observable output and belongs in
    the commit message. — [SA: pending Dev]

18. **M-b — the per-stage invoice read's error is currently DISCARDED.**
    `const { data: invoice } = await supabaseServer…` at L260 does not destructure
    `error`. M-5 will log it. On a quote with several billed stages against a flaky
    database that turns silent skips into one error line per stage. An improvement,
    and still a delta. — [SA: pending Dev]

19. **M-c — D-2 is understated.** It is not only an assertion shape change: the
    `cancelQuoteStages` fake **defines no `in`** (only `select`, `update`, `eq`,
    `is`, `not`, `maybeSingle`, `then`). `stopAccepted` chains `.in('id', ids)`,
    so without the fake extension the chain breaks *before* the terminal `.select()`,
    `dbState.updates` never gets its `proposals` entry, and every test using
    `statusUpdate()` fails — roughly ten. **H-1's mitigation list names `limit`,
    `order` and `range` and omits `in`, which is the one method that is certainly
    needed.** Add it. — [SA: pending Dev]

20. **M-d — D-1 is struck and replaced by D-1′** (A-2): `findLiveForBooking`
    over-fetches three unused columns, and the status predicate moves from a
    call-site `isPlanStopped` test to a database filter. — [SA: resolved by A-2]

**N — Hazards: assessment**

21. **N1 — H-1 is right in substance, wrong in two details.** Wrong that the throw
    is swallowed *today* (Q-0.3); wrong to omit `in` (M-c). Its mitigation — extend
    the fake rather than constrain the methods — is **correct and I endorse it**:
    constraining a production method to a test's shape is the worse trade. — [SA: pending Dev]

22. **N2 — H-2, H-3 approved as assessed.** H-3 matches parent A1 and E1 exactly:
    the exit criterion is "no `.from(` in the file", and `cancelQuoteStages.ts`
    keeps its `supabaseServer` import solely for
    `lowerPlansForCancelledStages(supabaseServer, …)` at L416. — [SA: approved]

23. **N3 — H-4's mutation set is incomplete.** Every mutation it lists is a *filter*
    mutation, and the invariants most likely to be destroyed by this particular
    move are *ordering* ones. Add, and require each to be caught by a named test:
    - swap `findLiveForBooking` for `findAnyForBooking` at `stopBookingPlan:124`
      (the A-2 invariant — nothing currently catches it)
    - close stages before voiding invoices, at both sites (the
      `dbState.order` test should catch the quote one; prove it does)
    - move the proposal status update above the stage close
    - delete the `if (!invoice) continue;` guard
    - remove the `if (stageInvoiceIds.includes(invoice.id)) continue;` dedupe (L2)
    - remove the `!openPeriods?.length` early return (L5)
    - skip the ownership read entirely, at both sites (L1) — [SA: pending Dev]

**O — Logging, schema, scaffolding**

24. **O1 — Logging: both files are already `console.*`-free** (verified), as are all
    five repository files. CLAUDE.md § Logging raises nothing. New methods follow the
    repository convention: `logger.error({ err, … }, '…')`, not-found neither thrown
    nor logged. Note `cancelQuoteStages.test.ts` mocks `@/lib/logger` and
    `stopBookingPlan.test.ts` does not — so the repositories' real Pino logger will
    run in the latter. Harmless, but do not let a new log line make that suite
    noisy. — [SA: resolved]

25. **O2 — Schema: all 38 columns verified present against `information_schema`, no
    phantom columns.** The parent plan's G7 risk does not recur: every column named
    here is already selected by the code being moved. The one genuinely new check is
    A-2's condition 1 (`payment_plan_subscriptions.status` nullability). — [SA: resolved]

26. **O3 — `new-repository` skill:** no new class (parent C0 holds — every table has
    an owner), no new constructor (all five already take an injectable client, so
    parent C2 does not recur), no new table / bucket / column, so the data-export
    classification item is **N/A**. The checklist items that do bite are "unit tests
    cover each method" (parent QA Bug 3 — six methods shipped untested last time)
    and `RepositoryResult` conformance. — [SA: resolved]

### Exit criteria — ruling: NOT sufficient. Six changes.

1. **Criterion 2 is false and must be rewritten.** "No assertion deleted" cannot
   hold: J-1's source scans must be re-homed. Restate as *"no assertion deleted;
   every assertion either survives unchanged or is re-homed to a named new test,
   and the plan lists each re-homing."*
2. **Add:** the three webhook source-shape guards and
   `paymentTablesWriteLockdownMigration.test.ts` are green (J-2).
3. **Add:** a full gate diffed against a baseline worktree, per slice, with
   branch-only failures named (J-3).
4. **Criterion 3 — strengthen:** a unit test per new method asserting its filters,
   **including a presence assertion** that M-1 and M-2 keep `is('subscription_id',
   null)` and that M-4 is scoped by `in('id')` and not by `booking_id`. D-4's
   absence assertion alone is half the pair.
5. **Criterion 4 — extend to N3's mutation set.**
6. **Add:** `grep -c "supabaseServer"` in `stopBookingPlan.ts` returns 0 (H-3 says
   its import goes, so make it checkable), and `lib/payments/__tests__/planSurfaces.guard.test.ts`
   is green.

Criteria 1, 5, 6 and 7 approved as written. — [SA: pending Dev]

### Optimisation suggestions (never blocking)

- Once M-5 exists, H-2's N+1 collapse (FU-Q2) is one `.in('id', ids)` read — but
  read L3 first: the `collected` sum is coupled to the loop's skip set.
- `findStopTarget` narrowed to `id, booking_id` (FU-Q3) would drop two dead
  columns; it is a two-line commit once the move has landed.
- The parent plan's FU-A (`lowerPlansForCancelledStages` losing its client
  parameter) becomes cheaper after this stream: `cancelQuoteStages.ts` would then
  have no other reason to import `supabaseServer`, so FU-A plus this stream is what
  finally makes "no `supabaseServer` import" true for that file.

### Adjusted items (marked by SA)

- **D-1 struck.** `stopBookingPlan:124` routes through the existing
  `paymentPlanSubscriptionRepository.findLiveForBooking`, **not** `findAnyForBooking`,
  subject to the `status` nullability check (A-2). New delta **D-1′** replaces it.
- **M-7 stays, renamed `findStopTarget`, byte-faithful at five columns** (A-1).
  Narrowing filed as FU-Q3.
- **M-4 returns `null`, not a count** (K1).
- **M-6 renamed `findOpenForBooking` and takes no `statuses` parameter**; a
  `LIVE_INVOICE_STATUSES` constant moves to `PaymentRepository.ts` beside
  `ISSUED_INVOICE_STATUSES` with the `draft`/`pending` difference named (K3, J-4).
- **D-3's remainder ships as a second, separately-described commit in PR 2**, not as
  unbounded FU-Q1. The move commit's M-2 patch has exactly three keys (A-3).
- **Every new method gains a placement line** stating where it goes relative to the
  guarded source regions in J-2.
- **The invariant list grows from 6 to 12** (L1–L6), numbered from 0.
- **H-1's fake-extension list gains `in`** and drops the "swallowed by a `try`"
  claim about today's code (M-c, Q-0.3).
- **H-4's mutation set grows by seven ordering and guard mutations** (N3).
- **Exit criteria: six changes, criterion 2 rewritten** (above).
- **Delivery: unchanged at two PRs** — PR 1 = slices 1+2, PR 2 = slices 3+4, one
  commit each, plus D-3's second commit in PR 2. The stop-and-re-plan gate after
  slice 2 stays, and a §Slice 4 test plan must be added to this document and
  signed off by SA before slice 3 is coded (A-4).
- **New follow-ups:** FU-Q3 (narrow `findStopTarget`), FU-Q4 (the cross-currency
  `collected` sum, L6).

### Approval

- [ ] Workplan approved — **not yet.** Revision required. The direction, the slice
      boundaries, the M-4 argument and the invariant discipline are all approved;
      what blocks is J-1 and J-2 (two unseen costs that make exit criterion 2 false
      and put a required gate at risk), A-2's struck delta, and the adjusted items
      above. All of it is documentation work on this file plus one live-schema
      check — **no second full SA cycle.** Update the document, run A-2's
      nullability check and record the answer, and I will sign off the revision and
      slice 4's test plan in one pass. Code review (Phase 2) still applies per
      slice, and I will walk J-2's placements, L1–L6 and N3's mutation set against
      the diff.

---

### SA sign-off — revision 2 (2026-10-31)

**Status:** ✅ **REVISION APPROVED. §Slice 4 Test Plan APPROVED.** Slices 1, 2, 3,
3b and 4 are cleared to code, subject to the four conditions below. One is
blocking and must be recorded **before slice 2**; the other three are one-line
notes.

Verified first, as asked: my `## SA Review` section is intact — 34 `[SA: …]`
markers (34, not 35; my own count was 34), and all of Q-0, A-1…A-4, J, K, L, M,
N, O, the exit-criteria ruling, the optimisation list, the adjusted items and the
approval block are present and unaltered. The revision was spliced, not rewritten.

**What is approved, and why I am not asking for more:**

- **Q-2 is unblocked on my own terms.** `payment_plan_subscriptions.status` is
  `text NOT NULL`, so the unsafe-direction hole cannot occur, and the
  `maybeSingle()` proof in §Methods is the one I was looking for — six-value
  union, two stopped statuses, four live, and the partial index covers exactly
  those four. Nothing left open.
- **J-1 is better handled than I specified.** Enumerating the three *surviving*
  assertions alongside the four dying ones is the part that matters: it is what
  stops slice 4 from re-homing a call-site fact into a repository test, where it
  would assert nothing. §Slice 4 Test Plan is approved as written.
- **J-2 is approved as §Placement + exit criterion 8.** Naming the exact
  `.eq('user_id', userId)` count of 2 is the right level of detail — that pin is
  what converts a misplacement into a red suite.
- **D-3 → slice 3b, M-4 → `null`, M-6 → `findOpenForBooking`, M-7 →
  `findStopTarget`, the twelve invariants, M-a/M-b, both typing rulings:** all
  adopted faithfully. H-6, which the revision added unprompted, is approved as
  written — add only that the QA report must name the row ids a live check
  touched, so the cleanup is auditable.

#### S-1 — BLOCKING, before slice 2: my Q-2 ruling costs one assertion in `stopBookingPlan.test.ts`, and that is not yet declared

This is the J-1 class of finding, in slice 2, and neither the plan nor my first
pass caught it. The fake's `maybeSingle` is
`data: Array.isArray(rows) ? rows[0] ?? null : rows ?? null` — it returns the
first row **without evaluating any filter**. So moving the status predicate out of
the call site (`subscription && !isPlanStopped(subscription.status)`) and into the
query (`subscription !== null`) makes one existing test unsatisfiable:

> `stopBookingPlan.test.ts:232` — *"treats an already-stopped subscription as an
> ordinary invoice plan"* sets `tables['payment_plan_subscriptions'] = [{ id: 'sub-1',
> status: 'cancelled' }]` and expects `cancelPlan` not to be called, `ok: true`,
> `cancelledPeriods: 2`. After the move `findLiveForBooking` returns that row
> anyway, the call site delegates, no Stripe client is supplied, and the result is
> `ok: false`. **The test fails.**

Required, and all of it declarative:

1. Record it as **delta D-5** in §Declared Behaviour Deltas: *the fall-through
   decision moves from a call-site predicate to a database filter, so the fake can
   no longer express "a cancelled plan is present".*
2. The test expresses the case as `tables['payment_plan_subscriptions'] = []` and
   is **renamed** — it now proves "no live plan falls through to the invoice
   path", not "a stopped plan does". Leaving the old name on it would be a
   comment that lies, which is worse than no test.
3. State where the guarantee actually lives afterwards:
   `findLiveForBooking`'s own unit test, which already asserts the status filter
   is present (parent D3), and which parent QA confirmed catches the mutation
   *"`findLiveForBooking` loses its status filter"*. The invariant is still
   guarded — it moves suite, it does not disappear. Say so, or the next reader
   sees a weakened test and no replacement.
4. Add to exit criterion 4's mutation set: **remove `findLiveForBooking`'s status
   filter** and confirm a named test in the repository suite catches it. That is
   the mutation that now carries invariant I-5.

Slice 1 is unaffected — carry on with M-3, M-4.

#### S-2 — `SETTLED_INVOICE_STATUSES` stays in `cancelQuoteStages.ts`. Do not move both constants together.

`cancelQuoteStages.test.ts:726` asserts
`const SETTLED_INVOICE_STATUSES = ['paid', 'refunded', 'partially_refunded']` in
that file, and it is **not** in the dying four — it survives, because `SETTLED` is
a predicate applied to a row the repository returned, not a query filter. Moving
`LIVE` to the repository layer makes moving `SETTLED` with it the natural
instinct; it would kill a fifth assertion for no gain and would put a call-site
decision in the data layer. One constant moves, one stays. Note it beside K3.

#### S-3 — the call sites must branch on `error`, never on `!data`

A consequence of K1 that is easy to get wrong in the diff. `M-4` returns
`{ data: null, error: null }` on success, so `if (!data)` is always true; and
`M-2` returns `{ data: [], error: null }` when it legitimately closes zero stages,
so `if (!data?.length)` would report a failure where today `closeError` is null
and `stagesClosed: 0` with `ok: true` is correct. Every routed site keeps today's
exact branch: `closeError` / `periodsError` / `billedError` / `statusError` →
error only. This is invariant I-10 in operational form, and I will check it line
by line in code review.

#### S-4 — I-12: your reading is right. It is a test-integrity property, not a production constraint.

I did **not** mean §Finding exception 2 to constrain production code. Repository
methods keep their `try` / `catch` / `logger.error` — that is the house convention
and the thing the `new-repository` skill asks for, and I would reject a method
written without it to make a fake's gaps louder. What the property *does* is
remove "the suite is green" as evidence, which is why exit criteria 4 (mutation
set) and 9 (gate diffed against a baseline worktree) are not negotiable on this
stream. Recording it as I-12 beside the call-site invariants, clearly labelled as
test-integrity, is the right home.

#### Approval — revision 2

- [x] **Revision approved.** §Slice 4 Test Plan approved. Slices 1, 2, 3, 3b, 4
      cleared to code. **S-1 must be written into this document before slice 2 is
      coded** (documentation only — no further SA pass); S-2, S-3 and S-4 are
      notes to carry into the diff. Phase 2 code review still applies per slice,
      and I will walk §Placement, I-1…I-12, S-3's error branches and the full
      mutation set against it.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-31 | Workplan written | Split out of `REPOSITORY_ROUTING_BOOKING_CANCEL_AND_CHANNEL` per that plan's SA ruling E1. Site inventory measured, §Finding contradicts the parent plan's cost premise, four deltas and four hazards declared, four questions open for SA |
| 2026-10-31 | SA workplan review | REVISION REQUIRED. §Finding verified and E1's cost bullet withdrawn (ruling unchanged). Q-1 add `findStopTarget`, not `findById`; **Q-2 reject the `.limit(1)` — route through the existing `findLiveForBooking`**, D-1 struck; Q-3 confirmed, D-3's remainder as a second commit not an open follow-up; Q-4 two PRs and the gate stay. Blocking: 3–4 source-text-scan assertions die with the move (exit criterion 2 false), and all three target repositories carry guarded source regions the natural insertion point falls inside. M-4 returns no count, M-6 renamed and loses its `statuses` parameter, invariant list grows to 12, mutation set grows by 7, exit criteria six changes |
| 2026-10-31 | SA sign-off, revision 2 | **APPROVED.** §Slice 4 Test Plan approved; slices 1, 2, 3, 3b, 4 cleared to code. `## SA Review` verified intact (34 `[SA: …]` markers). One blocking addition before slice 2 — **S-1**: the Q-2 ruling makes `stopBookingPlan.test.ts:232` ("treats an already-stopped subscription as an ordinary invoice plan") unsatisfiable, because the fake's `maybeSingle` returns `rows[0]` without evaluating filters; declare it as delta D-5, express the case as an empty table, rename the test, record that the guarantee moves to `findLiveForBooking`'s own unit test, and add the status-filter mutation. Plus three notes: S-2 `SETTLED_INVOICE_STATUSES` stays at the call site, S-3 every routed site branches on `error` and never on `!data`, S-4 I-12 is confirmed test-integrity only and does not constrain production code |
| 2026-10-31 | SA revision applied | Q-1/Q-2/Q-3/Q-4 rulings folded in; D-1 struck for D-1′; M-6 renamed `findOpenForBooking` and de-parameterised; M-7 renamed `findStopTarget`; M-4 returns null; §Placement added for the three guarded regions; §Slice 4 Test Plan added; invariants 6→12; exit criteria 2/3/4 rewritten and 8–10 added; `payment_plan_subscriptions.status` verified `NOT NULL`, answering Q-2's blocking condition |
| 2026-10-31 | PR 1 coded (slices 1 and 2) | M-3/M-4 added to `PaymentPlanRepository` before the guarded region, 12 unit tests, **mutations 12/12**. `stopBookingPlan.ts` routed: `.from(` 0 and `supabaseServer` 0. §Finding held — 9 of 10 existing tests passed untouched and the one failure was exactly the test SA's S-1 predicted; renamed per D-5 and invariant I-5 additionally asserted in this suite rather than only moved out of it. **Mutations 5/6, the 6th equivalent** (M-4's own empty-list guard). Regression 127/128 suites, 2571/2572 tests — the one failure is the known Windows CRLF source-scan flake over a file this branch does not touch. FU-Q6 raised: the subscription read discards its error |
| 2026-10-31 | PR 2 coded (slices 3, 3b and 4) | Five methods added before every guarded region; all five guard suites green, including the exact `.eq('user_id', userId)` count. `LIVE_INVOICE_STATUSES` moved, `SETTLED_INVOICE_STATUSES` stayed (S-2). **One departure from the plan:** the moved constant has TWO uses in `cancelQuoteStages.ts`, not one — a filter and a per-row predicate — so the declaration moved and the call site imports it. `cancelQuoteStages.ts` routed: `.from(` 0, `supabaseServer` retained for the documented hand-off (H-3). §Finding held again — 47→56 tests, four assertions re-homed not deleted, exactly one changed shape (D-2). The loose-invoice path is executable for the first time and gained six behavioural tests. **Mutations: slice 3 21/21, slice 4 13/13 — but only after the first slice-4 run surfaced three real gaps:** no test covered a stage pointing at a missing invoice row, nothing asserted the call site HANDS the reason to the close, and the S-3 error-branch trap was invisible until `logger.error` was captured. The harness itself was falsified first (an equivalent mutation confirmed to survive), because a `cp1252` reader thread throws on the shekel sign and would have made every mutation read as caught |
