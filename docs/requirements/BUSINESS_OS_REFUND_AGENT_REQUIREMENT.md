# Business OS Refund Agent

> **Last Updated**: 2026-11-11
> **Status**: 📐 **Phased, Phase 1 not started.** No code exists. The one
> change that came out of this design and *did* ship is the `movesMoney` gate
> (see [What already shipped](#what-already-shipped)).

## Overview

A refund is the one client conversation an owner dreads, and today it happens
entirely outside the platform. The client emails or phones; the owner digs through
Gmail for what was agreed, opens the CRM to find the booking, opens Stripe to find
the charge, and types a reply. Nothing is recorded and the client waits a day.

This document designs an agent that takes the whole loop: capture the request as
structured data, assemble the facts, recommend a decision, put one clear choice in
front of the owner, then either pay the refund or tell the client no.

It is the first agent that would **move money**, so most of what follows is about
where the authority sits rather than about the feature.

---

## Table of Contents

- [Phases](#phases)
- [What already shipped](#what-already-shipped)
- [What already exists](#what-already-exists)
- [The flow](#the-flow)
- [Intake A — the portal form](#intake-a--the-portal-form)
- [Intake B — email to form link](#intake-b--email-to-form-link)
- [Assessment](#assessment)
- [The owner's decision](#the-owners-decision)
- [Execution, and how it fails](#execution-and-how-it-fails)
- [Money the platform cannot move](#money-the-platform-cannot-move)
- [Rejection](#rejection)
- [Deltas from the original brief](#deltas-from-the-original-brief)
- [Data model sketch](#data-model-sketch)
- [Verification](#verification)
- [Known traps](#known-traps)
- [Risk to existing code](#risk-to-existing-code)
- [Why the agent must not be the thing that moves money](#why-the-agent-must-not-be-the-thing-that-moves-money)
- [How it installs](#how-it-installs)
- [Change History](#change-history)

---

## Phases

### The flow, in one place

Two ways in, **one form**, one record, one card.

1. **The client emails** *"I want my money back."* The receptionist already
   recognises this today. A reply goes back with a link to the refund form.
2. **The client opens the form** and picks which booking, from the ones they have
   actually paid for. They say how much and why. They submit.
   *(A client already in the portal can start here, with no email at all.)*
3. **The agent picks up the submission**, works out what they paid, when, and what
   is still refundable, and recommends.
4. **The owner sees one Needs-you card** with the facts and the recommendation, and
   presses. The refund dialog they already use opens, filled in.

The client picks the booking, so **nothing in the system ever has to guess which one
they mean.** That is the single biggest reason the form earns its place, and it is
why the email in step 1 points at a form rather than trying to parse prose.

### Three phases

| Phase | What ships | The owner's experience |
|---|---|---|
| **1. The funnel and the facts** | Steps 1, 2 and 4, with the card showing **facts only** | A structured request appears on the card: this booking, paid ₪400 on 3 Nov, ₪400 still refundable, here is what they asked for and why. One press opens the refund dialog. **The twenty-minute dig is gone** |
| | *(one classification call: is this a refund request? No judgement about money)* | |
| **2. The judgement** | Step 3. One LLM call over the record and the owner's policy | The same card now carries *"My recommendation: full refund, ₪400"* and the reasoning |
| **3. The reply loop** | Declines send a reviewed email from the card | Saying no stops being a blank page |

**Why the facts come before the opinion.** The digging is the work; the opinion is
the polish. Every fact in Phase 1 is already known — the client picked the booking,
and `getRefundability()` answers the rest — so nothing has to be reasoned about
money. Phase 2's recommendation then lands on a surface already proven and already
useful.

### Phase 1 in detail

**Build**

- **The form**, in the portal (see [Intake A](#intake-a--the-portal-form)). Lists only
  bookings this client has actually paid for, with the real refundable amount.
- **The record**, `refund_requests`, with its four registries (see
  [Risk to existing code](#risk-to-existing-code)). Phase 1 statuses only:
  `submitted → awaiting_owner → refunded | declined | withdrawn | superseded`.
- **The link email**, triggered when a refund request is recognised in the mailbox.
- **The gap** `refund_requested`, read from the table, so it fires for every account
  with nothing installed.
- **The card**, showing the booking, what was paid and when, what remains refundable,
  the amount asked for and the client's own words.

**Reuse, do not rebuild**

- **`RefundModal`** for the money, opened from the card pre-filled. The
  `booking_cancelled` gap already does exactly this rather than POSTing, for three
  reasons recorded at `NeedsYouCard.tsx:879-892`. **Zero new money code**, and the
  `movesMoney` gate is never involved.
- The portal task pattern (`?task=`), the gaps registry, `getRefundability()`,
  `refundReasons.ts`, `notifyOwnerOfLead`.

**One LLM call in Phase 1, and only one.** *"Is this escalation a refund request?"*
The receptionist classifies `needs_owner` without saying why, so something has to
decide. That is a classification, not a judgement about money — far smaller than the
assessment, which is Phase 2.

**Deliberately not in Phase 1**

- any recommendation about how much to refund
- `RefundService`, `MutateExecutor`, the `movesMoney` gate

**Manual money from day one.** A business with no Stripe sees *"Mark as returned"*,
never *"Refund ₪400"*. Label logic only; `RefundModal` already handles the case.

### How the receptionist reaches the refund agent

**Not by calling it.** Nothing in a `steps.json` gains the power to start another
agent: that is a large door to open for one feature, and it would be reused badly
later. **The chain is a queue**, which is the pattern this repo already has five
instances of.

```
receptionist (daily, UNCHANGED)
    └─ writes its escalation row, exactly as it does today

*/5 drain
    └─ sees an escalation nothing has looked at yet
    └─ calls runAutomationNow(owner, refundAgent)          ← the chain

refund agent (run on demand, not on a clock)
    ├─ is this a refund request?
    ├─ if yes: mints a portal token and emails the link
    └─ records the run, so it shows in עובד בשבילך

client submits the form
    └─ writes the refund request row

*/5 drain
    └─ runs the refund agent again → the card
```

`runAutomationNow(userId, agentId)` already exists and is exported — it is what the
**Run now** button calls, so running an agent outside its schedule is built and in
production.

**Why the queue rather than a direct call**

- **The receptionist does not change.** Its four pinned outcomes stay four and its
  no-send guard stays green, which removes a whole class of breakage.
- **No agent gains a new power.** The drain is ordinary server code with one job.
- **It survives a crash.** A direct call that fails is gone; a queue row has attempts
  and a reaper.
- **Latency drops from a day to about five minutes.** Both agents run at 09:00 and
  nothing orders them, so polling would have meant the client waiting two days for a
  link.

**Do not build on `app/api/agent-chains/`.** It looks like prior art and is not: V1-era,
raw `createServerClient` in the route (breaks rule 1), nothing in `lib` or
`components` imports it, and a stray `run.ts` sits beside `run/route.ts`.

### The link email

A purpose-built action, not generic `contacts.send`. That one is
`requiresConfirmation: true`, and **that flag is not enforced on the agent path** —
deliberately, because agents must be able to send. Using it would mean relying on a
declaration nothing checks, which is the crack the `movesMoney` gate just closed for
refunds. The new action can only ever send one thing, to the person who asked.

**It must go out as `kind: 'transactional'`**, which `emailTransport` defines as
*"anything the recipient's own action asked for"* and which **bypasses
`marketingGate`**. A client who has just emailed asking for their money back is
exactly that. Sent through the marketing path it would be blocked for every client
who never opted into marketing, which is most of them — a silent failure that would
look like the feature being broken.

**Done when:** a client emails asking for money back, gets a link, picks their booking,
submits, and the owner sees a complete, structured request on their card the same
cycle — and can act on it without opening Gmail, the CRM or Stripe.

### What the owner is shown, and when

**The owner is alerted once**, at the only moment there is a decision to make.

The trap is alerting at the start. The receptionist's escalation already produces a
`client_reply_waiting` card saying *"{name} wrote back, and is still waiting on
you."* If that fires the moment a refund is mentioned, the owner is interrupted
before anything is decidable, may reply by hand and cut across the agent, and will be
interrupted a second time when the real decision arrives.

Three states, and only the last one asks for anything:

| | State | The card |
|---|---|---|
| **1** | The agent has taken the escalation | **Nothing new.** The agent writes `reply_handled` for that thread, which clears the generic card. That is honest: the "client wrote back" question *is* settled — it has been triaged into a named process |
| **2** | Link sent, waiting on the client | `blocksOn: 'client'`. *"ביקשתי מדנה לבחור איזו פגישה"* — visible if the owner looks, and **not** in the morning briefing |
| **3** | Form returned and assessed | `blocksOn: 'owner'`. **The first and only alert**, arriving with everything needed to decide |

`blocksOn` exists for exactly this. Its own comment in `gaps/types.ts`: *"nagging the
owner about it every morning is what `blocksOn` exists to prevent."*

**And it must age.** A client who never fills the form must not make the request
disappear. After a few days state 2 becomes owner-blocking on its own — *"Dana asked
for a refund 5 days ago and never filled the form"* — because the alternative is the
state `app/api/business-os/gaps/route.ts` calls the worst of the three: *"The work
does not move and nothing says so."*

**A caveat, so it is not assumed free.** The mechanism that pulls a client-blocked gap
back onto the card when its automation is off (*"visibility follows the automation
rather than `blocksOn`"*) keys off `OPERATIONAL_AUTOMATIONS` and their `gapId`. It is
built for the standing chasers. A gap owned by a **catalogue agent** is not covered
today, so "the owner pauses the refund agent and the request returns to their plate"
has to be wired, not merely declared.

---

## What already shipped

Designing this uncovered a live gap unrelated to the agent, and that gap was closed
on 2026-11-11.

`transactions.refund` declared `risk: 'delete'` **and** `requiresConfirmation: true`,
and its plugin definition said *"Requires explicit confirmation"*. That flag was read
in exactly one place: the chat route. The agent path calls `executeMutate` with
`consumer: 'kernel'`, which had only ever decided how a CRM activity row is
attributed. So a committed `steps.json` with a refund step would have moved money on
a cron with nobody asked.

Nothing exploited it — the nine shipped automations only call `find_*`, `create_*`,
`remind_*`, `invite_contacts`, `modify_email` and the sheet range ops.

**The fix:** a new `movesMoney` flag on the catalog action shape, set on
`transactions.refund` alone, and a refusal in `executeMutate` when
`consumer === 'kernel'`. Gated on `movesMoney` and **not** on `requiresConfirmation`,
because that flag is also true for every `risk: 'send'` action and four live agents
exist to send. Guarded by
`lib/business-os/bizql/__tests__/anAgentMayNotMoveMoney.guard.test.ts`, whose last
test enumerates every shipped plan and fails the day one reaches a money mover.

**Consequence for this design:** when the agent is built, the approval must hand
`executeMutate` something that proves a person decided. The gate is deliberately a
flat refusal today, because there is no such thing to hand it yet.

---

## What already exists

The reason this is mostly assembly rather than construction.

| Piece | Where | State |
|---|---|---|
| Refund execution | `lib/payments/RefundService.ts` | **Excellent.** Over-refund guard in the DB under `FOR UPDATE`, cross-currency refusal in the same trigger, two-layer idempotency, ledger row written *before* the Stripe call, compare-and-set after |
| Refundability maths | `getRefundability()`, `lib/payments/refundMath.ts` | Done. `remainingRefundableMinor` is what the form must show |
| Refund reasons | `lib/payments/refundReasons.ts` | 5 stable keys, already the chips in `RefundModal` |
| Client email on refund | `lib/payments/notifyRefund.ts` | Done |
| Email detection of refund asks | `draftClientReplies.steps.json:160` | Already classifies them `needs_owner`. **The hook exists** |
| Client portal | `/book/manage/[token]`, `lib/security/portalAccess.ts` | Token plus a 2h grant cookie that already holds **several** bookings |
| Structured client submission | `app/api/proposal/[token]/route.ts` | The precedent to copy: validate before claim, one-shot, server-authored text |
| Owner surface | gaps registry → `NeedsYouCard` + My Day + daily briefing | One `findGaps` feeds all three, so they cannot disagree |
| Editable draft, second-tap send | `MailReplyBox.tsx`, `app/api/business-os/gaps/reply/route.ts` | Reuse verbatim for the rejection |
| Durable queue pattern | 5 live queues, `durable-queue-drain` skill | Copy exactly |
| Approval freezing | `lib/business-os/bizql/mutate/ConfirmationStore.ts` | The principle to copy: store the **resolved** write, never the question |

---

## The flow

```
  A. portal form                 B. email
  ───────────────                ───────────
  client opens their             client emails "I want a refund"
  portal, picks a paid                 │
  booking, states the            receptionist classifies refund_requested
  case, submits                  (it still never sends — see Deltas)
         │                             │
         │                       refund agent sends the FORM LINK
         │                             │
         └──────────────┬──────────────┘
                        ▼
         refund_requests row (status: submitted)
                        │   */5 claim-and-drain
                        ▼
         ASSESSMENT (one LLM call, never talks to the client)
         reads: booking, transaction, refundability, policy,
                client history, what they wrote
         writes: recommendation + amount + reasoning
                        │
                        ▼
              status: awaiting_owner
                        │
         gap `refund_requested` → NeedsYouCard / My Day / briefing
                        │
         ┌──────────────┴───────────────┐
         ▼                              ▼
  "Refund ₪300"                  "Decline and reply"
  frozen decision                 MailReplyBox, editable,
  replayed by RefundService       second tap to send
         │                              │
         ▼                              ▼
   refunded + client told          declined + client told
```

---

## Intake A — the portal form

A button beside the existing task cards in `app/book/manage/[token]/page.tsx`,
opening `?task=refund`, matching how cancel, reschedule, intake and quote already
work.

**Listing the client's paid bookings is a new access pattern and the security crux.**
The token names one booking plus an email; the grant cookie already holds several.
The listing must resolve from the **token's own email within the token's owner**,
return only transactions that are `succeeded` with `remainingRefundableMinor > 0`,
and never accept a booking id from the body. Follow
`app/api/book/manage/[token]/intake/route.ts:96-101` — re-verify the email on read
*and* on write.

- Show the real refundable amount and its currency from `getRefundability()`, so the
  client cannot ask for more than exists or in the wrong currency.
- Fields: which booking, reason (reuse `refundReasons.ts` keys), amount requested
  (default: full remaining), free text, optional file.
- Fallback: *"my payment isn't listed"* → a request with no `transaction_id`, which
  reaches the owner as a plain message rather than an executable refund.
- **Notify the owner on submit.** Intake submission is the cautionary tale: it emails
  only the client and raises no event, so the owner finds out passively. This must
  raise a gap and a `business_events` row.

---

## Intake B — email to form link

- Receptionist: add `refund_requested` as a distinct escalation outcome alongside the
  existing four (`draft`, `needs_owner`, `ignore`, `already_handled`), writing a
  `crm_activities` row. **It keeps its no-send guarantee** — see Deltas.
- The refund agent sends the form link as a **transactional template** carrying one
  LLM-written opening line in the client's language. The link is a fresh portal token
  for that contact's booking, minted the way `ProposalSendService` already does it.

---

## Assessment

One `ai_processing` step. **It never writes to the client.** It reads the booking,
the transaction and its refundability, the service, the client's history, the owner's
refund policy, and what the client wrote.

Output schema, deliberately narrow:

| Field | Values |
|---|---|
| `recommendation` | `refund_full` / `refund_partial` / `decline` / `needs_owner` |
| `amount_minor` | integer, in the transaction's own currency |
| `reasoning` | owner-facing, in the owner's language |
| `client_message_draft` | never sent unreviewed |

Follow the `bos-llm-call-standards` skill: catalogued call name, server-side account,
one grouping id, `callWithTracking`, model resolved from area settings, no client text
in logs.

**The owner needs a refund policy** on `business_profiles` (window in days, whether to
auto-recommend full inside it, the maximum the agent may recommend). Without it the
LLM is inventing the business's terms.

---

## The owner's decision

A new gap `refund_requested` in `lib/business-os/gaps/definitions.ts`, priority above
`client_reply_waiting` in `mostUrgent.ts`. That buys the card, My Day and the daily
briefing for free.

The card shows the client's words, the booking, what they paid and when, what is
refundable, and the recommendation with its reasoning.

**Three buttons named for what they do**, never "approve/reject" of a recommendation:

| Button | Effect |
|---|---|
| **`Refund ₪300`** | Amount editable before pressing; editing re-freezes. Writes the frozen decision and enqueues execution |
| **`Decline and reply`** | Opens `MailReplyBox` seeded with the drafted message, editable, second tap to send |
| **`I'll handle this myself`** | Closes the request, records the decision, opens `RefundModal` for the existing manual path |

**The freeze is the safety property.** The owner approves a resolved
`transaction_id` + `amount_minor` + currency, not a recommendation. Otherwise an
amount that changes between presentation and approval rides in on the old approval.

---

## Execution, and how it fails

Approval enqueues; the drain claims and calls `RefundService.refund()` with the
frozen values and a `clientRequestId` derived from the approval id, so a replayed
approval cannot become a second refund.

| Outcome | What happens |
|---|---|
| Success | `refunded`, `notifyRefund` to the client, CRM activity, audit + flush |
| `EXCEEDS_REMAINING` | The owner refunded manually in between. Close as `superseded`, tell the owner, do not retry |
| `BALANCE_INSUFFICIENT` | Back to the owner with the real reason. Already first-class at `RefundService.ts:1339`, kept distinct *"because the business can act on it"* |
| `ACCOUNT_UNRESOLVED` | Same. Never guessed: a wrong guess refunds from the wrong balance and is not recoverable |

**Approved is not refunded.** Every one of these lands *after* the owner pressed the
button, so the card must show the request moving through `refunding` to a real
ending, and the client must not be told anything until it has one.

**A booking with a deposit and a balance is several transactions**, and `refundGroup`
can *"succeed seven times and then hit `balance_insufficient`"* (`RefundService.ts:745`).
The request must be able to say **"3 of 4 returned"** and leave the rest actionable.
It must never report a partial group as done.

---

## Money the platform cannot move

Not an edge case: a business that never connected Stripe, or one that left it to stop
paying the percentage, still invoices and still takes money.

```
settledByHand = isManual || returnedOutsideProcessor     (RefundService.ts:985)
```

- **`isManual`** needs **both** `request.manual === true` **and**
  `tx.processor_type === 'manual'`. The flag is the business asserting it; the column
  is whether the assertion is even possible. **An agent cannot fake it on a card
  payment** — `hasProcessorAccount()` refuses with `NOT_REFUNDABLE`, and treats an
  unreadable answer as *still connected*, so it fails safe.
- **`returnedOutsideProcessor`** covers card money when no account remains at all.
  Without it a business that left Stripe could never give back card money it was still
  holding, and *"the money sat as held for ever."*

**So there is nothing for the agent to execute.** A manual refund *"needs no Stripe
account, no charge reference and no API call — it needs a ledger row saying the
business returned the money."* The owner hands back the cash, makes the transfer,
sends the Bit. The platform records it, and the same triggers recompute the
transaction, invoice and booking state.

For manual money the flow ends one step earlier:

- the button reads **`Mark as returned and reply`**, not `Refund ₪300`
- pressing it writes the ledger row and sends the client email; the **owner** does the
  actual returning
- the card must say so plainly, or the owner will think the money has gone

`components/payments/MoneyEntryActions.tsx:203-213` already relabels to
`payments.refund.record_action` for manual money. The agent must match it.

The portal form therefore lists manual payments too — a client who paid cash is
entitled to ask — but what the owner is offered on the other end is *record*, never
*refund*.

---

## Rejection

Owner-sent from `MailReplyBox` via the existing `app/api/business-os/gaps/reply`
route. Writes the declined status and a CRM activity.

---

## Deltas from the original brief

1. **The receptionist must not send.** Its "never writes to a client" promise is
   enforced by a guard test (`oneAgentTwoMailboxes.test.ts:230-243`) and is the reason
   owners trust it on their own mailbox. Let it escalate `refund_requested`; let the
   refund agent send the templated link. Same outcome for the client, one less broken
   promise.

2. **"Approve / reject" must not reach the UI.** If the agent recommends *decline* and
   the owner presses *Approve*, what happened? Name the buttons after the consequence.
   This is the highest-risk copy in the feature.

3. **The rejection email gets a second tap.** Telling a client "no" in the business's
   name is as irreversible as the refund and harder to undo socially. `MailReplyBox`
   already does exactly this and is already trusted.

4. **`*/5` drain, not a daily agent.** Catalogue agents run on cron
   (`defaultCron`, `cadenceChoices`). A refund request answered on tomorrow's 9am run
   is worse than the status quo. Not inline in the public submit route either — that
   would put an LLM call behind an unauthenticated endpoint.

---

## Data model sketch

`refund_requests`, on the canonical §8.1 queue shape: `status`, `claimed_by`,
`claimed_at`, `attempts`, `next_attempt_at`, a partial index on exactly the claim
predicate, `claim_due_*` and `reap_stale_*` RPCs, `REVOKE` from `anon`/`authenticated`,
owner SELECT-only RLS.

```
submitted → assessing → awaiting_owner → approved → refunding → refunded
                                       ↘ declined
                                         refund_failed
                                         withdrawn
                                         superseded
```

Carries `user_id`, `contact_id`, `booking_id`, `transaction_id`, requested amount and
currency, the client's own words, source (`portal_form` / `email` / `owner`), the
assessment, and — once approved — the frozen decision.

Plus `dedupe_key`, so one client cannot open two live requests on one transaction.

**Two registrations that are easy to miss and fail CI or worse:**

- a purge descriptor in `lib/business-os/purge/descriptors.ts` **with an `export`
  classification** (`exportClassification.test.ts`, `businessOwnedTables.test.ts`)
- an entry in `scripts/generate-test-account-cleanup-sql.ts`. A user-owned table with
  an FK to `auth.users` that the cleanup plan does not know about makes **G-10 and
  G-18 refuse every future test-account check and delete**

---

## Verification

1. **Guard first:** an agent-path `refund_transactions` call without a frozen approval
   is refused. (Shipped — see [What already shipped](#what-already-shipped).)
2. **Claim:** two concurrent drains cannot both process one request.
3. **Idempotency:** approving twice, and replaying one approval, produce exactly one
   `payment_refunds` row and one Stripe refund.
4. **Over-refund:** request more than remaining → the DB trigger refuses, the owner
   sees `EXCEEDS_REMAINING`, no ledger damage.
5. **Race:** owner refunds manually via `RefundModal` between assessment and approval
   → request closes as `superseded`, nothing sent twice.
6. **Token scope:** a portal token for booking A cannot list or refund a booking
   belonging to another contact or another owner.
7. **No Stripe:** an owner with no connected account gets `Mark as returned`, the
   ledger row is written, invoice and booking states recompute, and **no Stripe call
   is made**. An agent passing `manual: true` on a card payment while an account
   exists is refused with `NOT_REFUNDABLE`.
8. **Partial group:** a deposit-plus-balance booking where the second leg hits
   `balance_insufficient` reports *"1 of 2 returned"* and tells the client nothing
   until the group has a real ending.
9. **Three languages** for every client-facing and owner-facing string
   (`dictionariesStayInStep.guard.test.ts`).
10. **Manual, on the test account:** submit from the portal, watch the gap appear,
    approve a partial refund, confirm the Stripe refund, the ledger row, the client
    email, the CRM activity and the audit entry.

---

## Known traps

- **The Connect balance.** Card money lands in the business's **own** connected Stripe
  account, and a refund is paid out of that account's available balance — not ours,
  and not by reversing the original charge. A business that has already paid out to
  its bank can have too little left.
- **Migrations 20261117 / 20261118** (`draft_body`, `source_thread_id`) may not be
  applied to live. The receptionist card depends on them; confirm before building on
  that path.
- **`marketingGate`.** Catalogue agents may only call `business-os`, whose sends route
  through BizQL and the consent gate. A transactional refund-form link is not
  marketing and must not be gated as if it were.
- **Two detectors already watch refunds** (`CashRefundPatternDetector`,
  `CashCancelledUnrefundedDetector`). A refund the agent issues must not make the
  advisor card report a problem the platform just created.
- **No conversation store exists.** Threading is Gmail's own `threadId` carried on a
  CRM activity, plus the drafts folder used as de-facto memory. Multi-turn negotiation
  would be new infrastructure, which is the strongest argument for the form.

---

## Risk to existing code

The agent is additive. Almost all the blast radius is in the **registrations** a new
table and a new gap require, and in three files pinned by guard tests.

### The new table has four registries, and one failure is silent

| Registry | If missed |
|---|---|
| FK to `business_profiles(user_id)` ON DELETE CASCADE | **Rows survive the business being deleted and are inherited by whoever next holds that `user_id`.** `20261119_a_quotes_children_belong_to_the_business.sql` records this as how the pipeline stages and the capabilities leaked |
| `businessOwnedTables.test.ts` | CI red |
| purge descriptor + `export` classification | CI red (`exportClassification.test.ts`) |
| `scripts/generate-test-account-cleanup-sql.ts` | **G-10 and G-18 refuse every test-account check and delete, for everyone** |

Three go red loudly. The first does not: it leaks a client's refund request, in their
own words, to the next account that reuses the id.

### Three files are pinned

- **The receptionist.** `oneAgentTwoMailboxes.test.ts:183` asserts the outcome enum
  equals exactly `['already_handled', 'draft', 'ignore', 'needs_owner']` **and** that
  Gmail and Outlook match. A fifth outcome fails both plans at once. Phase 2 only.
- **The briefing.** `BriefingFactsService` builds every fact from an explicit
  allow-list (`fromGaps(gaps, ['client_reply_waiting'])`). A new gap is counted and
  **never narrated** unless added — the bug recorded in `9981d4f5` as
  *"THE ALERT WAS BUILT AND INVISIBLE."*
- **`GapAction`.** An action with no handler is a dead button showing "something went
  wrong". It has happened twice; `answer_client` was dead its whole life.

### Behaviour changes to things that already work

- `mostUrgent.ts` priority reorders what every owner sees first.
- `app/book/manage/[token]/page.tsx` is 1968 lines and is the only client-facing
  surface. A render error there takes cancel, reschedule, intake and quote with it.
- **Listing a client's paid bookings widens what a token authorises.** Every public
  write today re-verifies booking → contact email. Listing *by email* is a different
  shape, and is where a cross-tenant leak would come from.
- `CashRefundPatternDetector` already watches refunds, so the advisor card may report
  a refund pattern the feature itself created.
- Entitlements: `refunds` maps to `chat.invoice_control`. CLAUDE.md records this CI
  check going red three times from work not about entitlements.
- A new table means regenerating `catalog.generated.ts` or the drift test fails.

---

## Why the agent must not be the thing that moves money

The riskiest framing is *"the agent executes the refund"*, because it argues for
giving an automation money authority and for weakening the `movesMoney` gate.

It does not need to. When the owner presses the button, the card posts to a route
that calls `RefundService` — exactly as `RefundModal` does today, through a path that
is already audited, already idempotent, already guarded in the database. The agent
prepares the case and reports the outcome; it never calls the refund op.

Same experience for the owner, no new authority, and the question of whether an
automation can be trusted with money never has to be answered.

---

## How it installs

**Two things are being called "the refund agent", and only one is an agent.**

| | Works with nothing installed? |
|---|---|
| Intake, the record, the card, execution | **Yes, required.** A client's refund request cannot depend on whether the owner browsed the catalogue |
| The AI assessment | **No.** Optional, and genuinely agent-shaped |

The first is platform, like the portal's cancel / reschedule / intake / quote tasks
that nobody installs, and like `intake_outstanding` firing from data.

**The assessment installs per user, like any catalogue agent — but it cannot be a
scheduled one.** `CADENCE_CRON` is every cadence at `0 9 * * ...`: daily at 09:00 UTC
is the floor, and there is no hourly. A client submitting at 10:00 would wait 23
hours.

So: create the `agents` row on install exactly like the others, so the owner gets the
list entry, the pause control, the run history and *"מצא 2 · טיפל ב-2"* — but have
the drain invoke it when a request arrives, the way **Run now** already invokes an
agent outside its schedule, rather than the scheduler claiming it at 09:00.

Three consequences:

- It is the **first event-triggered agent**. New pattern, SA review (rule 7).
- The list's "next run" column has nothing true to say. It already handles this shape
  for a paused agent (*"לא ירוץ כל עוד מושהה"*), so it needs one more case.
  `AgentsStoppedDetector` selects on `mode = 'scheduled'` and must not flag it.
- **Not installing it becomes the offer.** The card appears either way; without the
  agent it shows the request cold. So the card can offer the install at the moment
  the owner feels the work, which is better discovery than the catalogue list.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-11 | One alert, not three | Three states with `blocksOn`; the owner is alerted only when a decision exists. Unfilled forms age into owner-blocking |
| 2026-11-11 | Chaining settled | The receptionist reaches the refund agent through a `*/5` queue calling `runAutomationNow`, never by calling it. The link email is a purpose-built transactional send. `agent-chains` ruled out |
| 2026-11-11 | Phases rewritten around the funnel | Email → link → form → assess → card. Phase 1 is the funnel plus the FACTS, no LLM; Phase 2 adds the recommendation. Earlier ordering shipped a form nothing directed clients to |
| 2026-11-11 | Risk register, install model | Risk to existing code and the install question folded in |
| 2026-11-11 | Created, parked | Design worked out end to end. The `movesMoney` gate it uncovered shipped separately the same day; the agent itself is not scheduled |
