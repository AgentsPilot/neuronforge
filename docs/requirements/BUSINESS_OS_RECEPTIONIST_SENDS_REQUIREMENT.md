# The receptionist answers, instead of asking the owner to

> **Last Updated**: 2026-11-13

## Overview

The receptionist reads the owner's mailbox, decides what each client reply
needs, and writes a draft. **It has never sent anything.** Every outbound step
in both variants is `create_draft` — the draft lands in the owner's drafts and
the owner presses send.

That made it safe to ship. It also makes the owner the transport layer for
messages they add nothing to: a reply that says *"here is the link to book"* is
one the owner will never edit, and asking them to open Gmail and press send is
the whole cost of the feature with none of the benefit.

This proposes the one change that removes that cost without putting words in
the business's mouth: **the receptionist may send a door, and may never send an
answer.**

---

## Table of Contents

- [The test](#the-test)
- [Why not "when the owner is not needed"](#why-not-when-the-owner-is-not-needed)
- [What exists today](#what-exists-today)
- [The doors that already exist](#the-doors-that-already-exist)
- [The outcome table](#the-outcome-table)
- [What must be closed first](#what-must-be-closed-first)
- [The owner's switch](#the-owners-switch)
- [What this does to the refund work](#what-this-does-to-the-refund-work)
- [Open questions](#open-questions)
- [Change History](#change-history)

---

## The test

> **Send a door. Never send an answer.**

**A door** is a link to a surface where the *client* does the deciding. A
booking link does not book. A reschedule link does not reschedule. A refund
form does not refund. If the agent has misread the message, the client receives
a door they do not walk through: mildly odd, entirely recoverable, and nothing
has been promised.

**An answer** is a statement of fact or a commitment — a price, a time, an
availability, a policy, *"yes, Tuesday works"*. It is irreversible the moment it
lands, and it is what `draft` exists for.

The test is checkable per outcome, before anything runs, by looking at what the
step actually does. That is the property that matters.

---

## Why not "when the owner is not needed"

It was the obvious formulation and it cannot be used, because **it is only
decidable in hindsight.** Whether the owner was needed is a fact about how the
client reacted, which arrives after the message has gone.

"Is this a door or an answer" is a fact about the message being sent, available
before sending it, and auditable afterwards by reading the step.

---

## What exists today

Measured on 2026-11-13, both variants (`draftClientReplies.steps.json` and
`draftClientRepliesOutlook.steps.json`):

| | |
|---|---|
| Outbound actions | `create_draft` only. **No send action exists in either plan** |
| Outcomes | `draft`, `needs_owner`, `ignore`, `already_handled` |
| The scan | `after:{{input.scan_after}} -label:"AgentPilot/Needs you"`, headers only |
| The boundary | `client_history.count > 0` — it only reads the body of somebody this business has already written to |
| Strangers | A separate branch: `step5b` judges whether they are worth knowing, then `create_contacts` + `create_activities`. **Nothing is sent and no door is offered** |

A fifth outcome, `refund_request`, was added the same day. It records the
request without raising an owner card, and currently sends nothing.

---

## The doors that already exist

Nothing in this proposal needs a new client-facing surface. They are built:

| Door | Surface | Answers |
|---|---|---|
| Book | smart link | *"Do you have availability?"* from a stranger or a client |
| Reschedule | `/book/manage/[token]?task=reschedule` | *"I can't make Thursday"* |
| Cancel | `?task=cancel` | *"I need to cancel"* |
| Pay | `?pay=1` | *"How do I pay?"* |
| Intake | `?task=intake` | *"What do you need from me beforehand?"* |
| Quote | `?task=quote` | *"Can you send the quote again?"* |
| Refund | `?task=refund` | *"I'd like my money back"* |

Each is a page the client acts on. None of them commits the business to
anything by being opened.

**The portal token is per booking and per email**, so a door can only ever be
opened by the person it was sent to, for a booking that is theirs.

---

## The outcome table

The classifier stops choosing between "draft" and "escalate" and starts
choosing **which door answers this**, with drafting reserved for messages that
need words.

| Outcome | What is sent | Owner sees |
|---|---|---|
| `send_booking_link` | A smart link | Nothing |
| `send_reschedule_link` | Their portal, on reschedule | Nothing |
| `send_cancel_link` | Their portal, on cancel | Nothing |
| `send_payment_link` | Their portal, on pay | Nothing |
| `send_intake_link` | Their portal, on intake | Nothing |
| `refund_request` | The refund form | Nothing *(until the refund agent has assessed it)* |
| `draft` | **Nothing** — a draft is written | The draft, as today |
| `needs_owner` | **Nothing** | The card, as today |
| `already_handled` / `ignore` | **Nothing** | Nothing, as today |

**Every send is a link and nothing else.** The accompanying sentence is one
line of fixed copy per door, in the client's language, chosen from a table —
not written by the model. That is what makes "never send an answer" true
structurally rather than by instruction.

**Unsure still means `needs_owner`.** The existing default does not change.

---

## What must be closed first

Two were measured on 2026-11-13, in production, while testing something else.
Both are harmless while the agent only drafts and are not harmless once it
sends.

### The business's own mail comes back

The receptionist escalated the business's **own** invoice reminders, and an
owner-alert email the platform had sent, as client enquiries. The owner is
their own test client, so the addresses matched.

Drafting, that is noise in a list. Sending, the agent emails a booking link in
reply to the business's own automated mail — and if that address is also
monitored, a loop.

**Required:** an exclusion that recognises mail this platform sent, and mail
from the owner's own addresses, before any send outcome is reachable.

### The "already answered" signal is per contact, not per thread

A card showed *"already replied, 4 hours ago"* using a `reply_sent` from an
unrelated conversation with the same person.

Drafting on a stale signal costs one wasted draft. **Sending** on one means
answering a question that was already answered, or staying silent on one that
was not.

**Required:** the answered-check is per thread for every send outcome.

### A third, for sends specifically

**One door per thread, ever.** A door sent twice is a client being asked twice
to do the thing they already did. The existing `refund_link_sent` activity is
the right shape: written beside the send, and checked before the next one.

---

## The owner's switch

**Default `draft_only` for every existing install.** An owner who has had this
agent for weeks has it on the understanding that it does not speak for them,
and changing that silently is the kind of surprise that loses trust in every
other agent too.

| Mode | Behaviour |
|---|---|
| `draft_only` | Today's behaviour exactly. Door outcomes become drafts carrying the same link |
| `reply_directly` | Door outcomes send |

New installs may default to `reply_directly`, since nothing was promised.

The switch lives beside the cadence and the lookback, in the same place the
owner already configures this agent.

---

## What this does to the refund work

The refund form link stops being a special case. It is **one row in the
outcome table**, sent by the same mechanism as the booking link, gated by the
same switch, deduped by the same rule.

Two consequences:

- **`refundLinkFunnel.ts` is deleted.** It exists only because the receptionist
  could not send; it reads the receptionist's own output and second-guesses it.
- **The refund agent keeps exactly one job:** watch for forms the client has
  submitted, assess them, and raise the owner's card. That is the job it was
  always meant to have.

---

## Open questions

1. **Does a door ever carry words?** A reschedule link with no sentence reads as
   curt. One fixed line per door per language is the proposal; whether the model
   may write that line is the question, and the safe answer is no.
2. **Strangers.** Today they are filed and flagged, nothing is sent. A booking
   link to a stranger asking about a service is the single highest-value send in
   this document — and it is also the one case with no prior relationship to
   lean on. Worth deciding separately from the client doors.
3. **What happens when a door is ignored?** A reschedule link nobody opens is a
   client still waiting. Does that age back into an owner card, as the refund
   request does after a few days?
4. **Both variants.** Every change lands twice, Gmail and Outlook. Nothing here
   is Gmail-specific, but the plans are separate files and drift between them is
   how one of them quietly stops matching.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-13 | Written | After the refund work surfaced that the receptionist cannot send, and that the refund link was about to be built as a special case around it |
