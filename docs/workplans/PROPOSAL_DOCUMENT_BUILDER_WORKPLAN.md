# Proposal Document Builder

> **Last Updated**: 2026-11-10
> **Status**: Plan agreed 2026-11-10. Mockup approved. The proposal's structure
> is unchanged — a breakdown is added beside the existing single `total`, which
> every chaser keeps reading. Four decisions remain open — see
> [Open decisions](#open-decisions); none block Slices 1–2.
> **Mockup**: https://claude.ai/code/artifact/c4515a1b-476b-4e7b-997f-4c5ce061bca9

## Overview

A business owner sending a quote today sends **a price and nothing else**. This
plan adds an **optional** document builder — letterhead, overview, dated line
items with per-item detail — that a contractor can use and a therapist can
ignore entirely. It also adds PDF delivery and an optional signature on
approval.

The existing quote system is not modified. The builder is one option on one
branch of a choice the owner already makes, and everything it does not touch
keeps working exactly as it does today.

---

## Table of Contents

- [Why](#why)
- [Decisions taken](#decisions-taken)
- [The structure does not change](#the-structure-does-not-change--the-breakdown-explains-the-total)
- [Scope](#scope)
- [Data model](#data-model)
- [Slice 1 — The fork moves above the money](#slice-1--the-fork-moves-above-the-money)
- [Slice 2 — The builder](#slice-2--the-builder)
- [Slice 3 — PDF](#slice-3--pdf)
- [Slice 4 — Attachments, kept and extended](#slice-4--attachments-kept-and-extended)
- [Slice 5 — Signature and the approval path](#slice-5--signature-and-the-approval-path)
- [Slice 6 — The booking tab shows it](#slice-6--the-booking-tab-shows-it)
- [Slice 7 — Reusing a document already built](#slice-7--reusing-a-document-already-built)
- [What is reused](#what-is-reused)
- [Verification](#verification)
- [Risks](#risks)
- [Open decisions](#open-decisions)
- [Change History](#change-history)

---

## Why

Measured against live data — 46 proposals across 2 businesses:

| field | filled | reading |
|---|---|---|
| `total`, `currency`, `tax_rate`, `payment_shape` | **100%** | the commercial object is complete |
| `sent_at` / `viewed_at` / `decided_at` | 100% / 87% / 87% | the lifecycle genuinely works |
| `valid_until` | 83% | expiry is used in earnest |
| `description` | **11%** | median **26 characters** — a subject line, not a proposal |
| `document_id` | **7%** | 3 proposals ever carried a file |

The field already exists and already asks the right question.
`proposal.field.description` is labelled **"What the work covers"** with the
placeholder *"Describe the work in your own words. This is what they read before
deciding."* It is skipped 89% of the time, and the upload escape hatch did not
rescue it either.

A blank textarea asking for an essay, sitting between a title and a price, gets
a sentence or gets nothing. Structure is what is missing, not capability.

> These figures justify **what** is missing. Two businesses is far too thin to
> justify any particular item set or default — expect the specifics to move once
> real owners touch it.

---

## Decisions taken

Recorded in the owner's own framing, because several of them narrow the build
considerably:

1. **"This new feature doesn't change the way proposal work."** It adds the
   ability to build a full proposal like a contractor would. Everything else
   stays as it is.
2. **"The current total cost must get the total from the new proposal."** When
   the builder is used, `total` is the sum of the line items.
3. **"Some other users will not need proposal like that as it might be a
   therapist."** The builder is therefore **optional and off by default**.
4. **"The user still need to fill how users paid as we have today."**
   איך משלמים and שלבים remain required on every path.
5. **The builder belongs to עבודה אחת only.** סדרת פגישות never offers it — a
   package already has line items, and they are the meetings.
6. **Total and expiry move below the fork.** מה אתם מוכרים? comes first.
7. **The existing file attachment stays**, for images and any other file the
   owner wants to send.
8. **Signature on approval applies to every proposal** — עבודה אחת *and*
   סדרת פגישות, builder or no builder. It is not part of the builder.

> Decisions 5 and 8 pull in opposite directions and both are deliberate. The
> **builder** is scoped to one branch because a package already has line items.
> The **signature** is scoped to nothing, because it records consent to terms,
> and a client buying ten sessions agrees to terms exactly as one buying a
> renovation does. Keeping them independent is what makes that possible.

---

## The structure does not change — the breakdown explains the total

**The proposal is not restructured. A breakdown is added to it.**

`supabase/migrations/20260913_proposals.sql:6-14` records *"one total and a
description"*, and that rule **still holds**. `proposals.total` remains the
single authoritative figure: one number, on the proposal, in its own column.
What changes is that the owner can now explain how they reached it.

The distinction is not semantic — it is what makes this safe. Everything in the
platform that acts on a proposal reads `total`, `status`, `valid_until` or
`payment_shape`. **None of it reads `content`**, so none of it changes:

| reads a proposal | still reads | untouched |
|---|---|---|
| `expireLapsedQuotes` | `status`, `valid_until` | ✓ |
| `abandoned-proposal-invoices` cron | `status`, the created invoice | ✓ |
| `sendQuoteReminder` + its 7-day cooldown | `status`, `sent_at` | ✓ |
| Quote chasing (`chase_quotes_enabled`, `lead_responses.kind = 'quote_chase'`) | `status` | ✓ |
| `ConvQuoteAcceptanceDropDetector` | accepted ÷ sent | ✓ |
| `ProposalAcceptanceService` → invoice, plan, stages | `total`, `payment_shape` | ✓ |
| `splitTotal` | `total` | ✓ |
| Money page, booking tab, client portal | `total`, `status` | ✓ |

> A chaser cannot tell a quote with a breakdown from one without. That is the
> design, not a happy accident: `content` is additive, nullable, and read by
> exactly two surfaces — the document renderer and the PDF.

### What this does change

- **How `total` is produced**, not what it means. Typed on all 46 existing
  quotes and on every quote from an owner who never opens the builder; summed
  from the items when they do. `accepted_snapshot` freezes whichever applied.
- **One hint.** `proposal.field.description_hint` — *"No cost breakdown — one
  total, explained."* — is shown only when the builder is off, where it is
  still true. Needs the conditional in **en, he and es**.
- **One comment.** `ProposalBuilderModal.tsx:8-20` states the rule as absolute
  and should say it holds for the default path, naming this document for the
  exception. `20260913_proposals.sql` is shipped and is not edited; the new
  migration's comment carries the note.

### The pressure this invites

Once items carry unit prices, owners will ask to pick them from a list rather
than retype them — which is the *"catalogue, markup model and margin report"*
the original comment was guarding against.
[Slice 7](#slice-7--reusing-a-document-already-built) answers that by offering
the owner their own **accepted proposals**, with a price check against what they
actually charged. Nothing is maintained, and no pricing model follows.

---

## Scope

### Changes

| | |
|---|---|
| Field order in the quote dialog | מה אתם מוכרים? moves above סכום כולל and בתוקף עד |
| `ProposalBuilderModal.tsx` | a toggle inside the עבודה אחת card; total becomes read-only when on |
| New surface | the document builder — **עבודה אחת only** |
| New surface | proposal PDF generation — **every proposal** |
| Signature on approval | optional per proposal — **every proposal, both branches** |
| `ProposalAnswer.tsx` | renders the document above the existing payment block; signature gate |
| `app/api/proposal/[token]/route.ts` | signature validated **before** the claim |
| Attachments | many files instead of one, `document_id` still honoured |
| `BookingsTab.tsx` quote journey | each version also shows items built, attachment count and who signed |

### Explicitly unchanged

- `lib/services/ProposalAcceptanceService.ts` — invoice, plan, instalments,
  package meetings. **Not opened.**
- `claimForAcceptance`, `splitTotal`, `raiseInvoice`.
- `payment_shape` and the whole סדרת פגישות / package branch.
- Decline: one tap, reason and note, **never gated**.
- send / view / remind / extend / supersede / expire sweep / abandoned-invoice cron.

> `splitTotal` divides a single total, so stages and instalments are indifferent
> to whether that total was typed or summed. This is why item 4 of the decisions
> costs no work.

---

## Data model

```
proposals
  + content            jsonb    null = no document (all 46 live rows)
  + requires_signature boolean  default false

proposal_attachments            many files per proposal
  proposal_id, document_id -> contact_documents, position, created_at

proposal_signatures             append-only, one row per signed acceptance
  proposal_id, signed_name,
  statement_text / statement_locale / statement_version,
  ip_hash, ip_hash_salt, user_agent, method, evidence jsonb
```

`content` shape:

```ts
{
  letterhead: { showLogo: boolean },          // the rest comes from the profile
  overview:   ReplyBlock[],                   // mirrors `description`
  items: Array<{
    id: string;
    date: string | null;                      // delivery date, not a payment date
    label: string;
    qty: number;
    unitPrice: number;                        // minor units
    body: ReplyBlock[];                       // the per-item description
  }>,
  tax: { rate: number; label: string; inclusive: boolean },  // copied, frozen
}
```

`ReplyBlock[]` is the **existing** model from
`lib/business-os/mail/replyBody.ts`, so `renderHtml` / `renderText` already
render it and the XSS question is already answered.

---

## Slice 1 — The fork moves above the money

**Files:** `components/crm/contact-drawer/ProposalBuilderModal.tsx`

Reorder to: title → description → **מה אתם מוכרים?** → סכום כולל → בתוקף עד →
איך משלמים → שלבים.

The fork then decides how the total behaves *before* the owner reaches it. In
the old order, turning the builder on would rewrite a field they had already
filled and scrolled past.

> This is the one change every owner notices immediately, **including the ones
> who will never touch the builder**. Ship it in its own commit so it can be
> reverted alone if it is unpopular.

## Slice 2 — The builder

**New:** `components/crm/contact-drawer/proposal-builder/` — the modal is
already **3,025 lines**; adding a surface inline is how it got that way.

- A `בניית הצעה מפורטת` toggle rendered **inside the עבודה אחת card**, so it
  cannot appear on the package branch.
- Selecting סדרת פגישות **forces the toggle off**. A package must never carry a
  second item list beside its meetings — two answers to "what are the items"
  that could disagree.
- Letterhead read from `business_profiles` (name, address, contact, VAT, logo).
  Not re-entered per proposal.
- Overview mirrors `description` — written once.
- Items: date · label · qty · unit price · amount, each with its own
  `MailReplyEditor` for the description.
- Subtotal → tax → total, **written back to `total`**, which becomes read-only
  with the hint *מחושב מהפריטים בהצעה*.

### Editing items

The item list is fully editable while the quote is a draft: **add, remove,
reorder, and add or remove a description on any item.**

| operation | behaviour |
|---|---|
| **Add item** | appends an empty row — date, label, qty `1`, unit price `0`. Focus lands on the label, which is the only field that cannot be guessed |
| **Remove item** | drops the row and its description. See *losing work* below |
| **Reorder** | up / down on each row. The document reads as a sequence of work, so order carries meaning that `date` alone does not — two items can share a date |
| **Add description** | each item starts with none; the editor appears on demand |
| **Remove description** | clearing it removes the block entirely. The item then renders as a single line, which is the right shape for *"Materials — 1 × 400"* |
| **Amount** | always `qty × unitPrice`, never typed. The one derived cell |

**The total recalculates on every one of these**, and is written straight back
to `סכום כולל`. Nothing is saved as an intermediate "needs recalculating" state.

**Losing work.** Removing an item with a long description throws away the most
expensive thing on the screen. An inline undo on the row — *הפריט הוסר · ביטול*
— for the rest of the session beats a confirm dialog, which owners learn to
dismiss without reading.

**Zero items is not a valid document.** If the last item is removed while the
builder is on, `סכום כולל` cannot be derived from nothing. Either the owner
turns the builder off, which restores the typed total, or they add an item.
Sending is blocked until one of those is true, with the reason stated on the
field rather than on the Send button.

**Toggling the builder off keeps the items in local state**, so an owner who
switches to compare the two shapes does not lose their work. Only the toggle's
*on* state persists `content`.

### Editing a quote that has already gone out

Items are editable **only while `status = 'draft'`**. There is no PATCH on a
proposal and `updateDraft` already refuses anything else — a change after
sending is a new row with `supersedes_id`, which is the existing rule and the
reason the booking-tab journey in Slice 6 can be trusted.

So the builder has two modes:

- **draft** — everything above.
- **sent or later** — read-only, matching the existing `onViewProposal`
  path. "Revise" creates the next version pre-filled with these items, which is
  the fastest way to produce version 2 and the main reason to keep items
  structured rather than free text.

**Also:** `app/api/business-os/proposals/route.ts` — `content` and
`requires_signature` in `createSchema`. Validate server-side that
`sum(items) + tax === total` and that `items.length >= 1` whenever `content` is
present; never trust the client's arithmetic.

## Slice 3 — PDF

**New:** `lib/pdf/ProposalPDFGenerator.tsx` exporting
`generateProposalPDFAsync(data): Promise<Buffer>`, and
`app/api/proposal/[token]/pdf/route.ts`.

Both modelled on the invoice pair. `registerThemeFont`, the RTL `SmartText`
treatment, the Heebo/Noto assets and `resolveEmailBranding` are reused as-is.

**Offered on every proposal, like the signature** — not only on ones with a
document. What it contains scales with what exists:

| the proposal has | the PDF carries |
|---|---|
| `content` (builder used) | letterhead, overview, items with detail, totals, stages, terms |
| no `content`, one job | letterhead, title, description, total, stages, terms |
| no `content`, a package | the above **plus the session list and dates** |

The no-content case is not a degraded document — it is the quote the client
already receives, on letterhead. That is most of the value for an owner who will
never open the builder.

- **Generated on demand, never stored.** The invoice route already works this
  way, and it means a superseded proposal cannot serve a stale PDF.
- **At send time** the bytes are generated once and attached to the email —
  `ProposalSendService.ts:197-223` already downloads and attaches a file, so the
  seam exists.
- **Every importer uses `await import()`.** React-PDF registers fonts as an
  import side effect and hangs Jest; this is documented in seven places, e.g.
  `lib/services/ProposalAcceptanceService.ts:795-801`. Non-negotiable.
- **Page breaks across long prose are the real work.** Invoices never had a
  section flowing over a page boundary.

## Slice 4 — Attachments, kept and extended

The owner's own files stay. They are now a **different thing** from the
generated PDF, and the distinction has to be explicit:

| | the generated PDF | the owner's attachments |
|---|---|---|
| what it is | the proposal document itself | images, drawings, spec sheets, a PDF they already had |
| where it comes from | `content`, rendered | uploaded by the owner |
| stored? | no — generated on demand | yes, `contact-documents` bucket |
| exists without the builder? | no | **yes — exactly as today** |

**Today** `proposals.document_id` holds one file. It is kept and still honoured.

**Added:** `proposal_attachments`, so an owner can send several. Reads go
through one helper that returns `document_id` first, then the join rows:

```ts
// lib/business-os/proposals/attachmentsFor.ts
// One source of truth. A proposal written before this slice has only
// document_id; one written after has only join rows; neither caller cares.
```

Every existing consumer moves to that helper in the same commit:
`app/api/proposal/[token]/route.ts:90-114` (`presentDocument`, 1-hour signed
URL), `ProposalSendService.ts:197-223` (download and attach),
`app/api/business-os/proposals/route.ts:317-364` (names for the owner's list).

**The accept gate.** Today Accept is disabled until an attached document is
opened (`ProposalAnswer.tsx:663`). That gate **stays on the owner's attachments
only** — it means "read this before you agree". It must **not** extend to the
generated PDF, whose content is already on the page; gating on it would ask the
client to download a copy of what they are looking at.

Limits are inherited from `lib/crm/attachableDocumentTypes.ts` — PDF, DOC/DOCX,
XLS/XLSX, JPEG/PNG/GIF/WEBP/TIFF/HEIC/HEIF, text, CSV, 50 MB. Images are already
allowed, so the owner's stated case needs no new type.

## Slice 5 — Signature and the approval path

**Independent of the builder, and available on every proposal.** This is the one
slice with no branch scoping at all:

| | builder | signature · PDF |
|---|---|---|
| עבודה אחת | offered | offered |
| סדרת פגישות | **never** | **offered** |
| no document at all | — | offered |

`requires_signature` is per proposal and defaults false, so all 46 live rows and
every quote from an owner who does not want it take today's exact path.

Client side: typed full name plus an explicit agreement control, gating Approve
the same way the document gate already does.

**The package branch needs no extra work, and that is worth stating because it
is easy to assume otherwise.** Validation happens before `claimForAcceptance`,
which is common to both branches; `applyAcceptance` then does whatever that
`payment_shape` already does — including creating the package booking and its
meetings. Nothing in the signature path inspects the shape.

Two details specific to a package:

- A **per-session** package raises nothing on accept, so `dueOnAccept` is zero
  and the button carries no amount. The copy must read *חתימה ואישור* on its
  own rather than appending an empty figure.
- The sessions list sits above the signature box, so the client signs below the
  dates they are agreeing to — the same reading order the document gives on the
  one-job path.

**The server sequence. The order is the design, not the additions:**

| # | step | |
|---|---|---|
| 1 | **Validate the signature** | NEW — the accept branch of `answerSchema` gains `signature {name, statement_version, agreed}`, required only when the proposal asks for one |
| ⚠ | **Why first** | `claimForAcceptance` is a one-shot conditional update `sent\|viewed → accepted`. Validate after it and a rejected signature leaves the quote **permanently accepted, no money raised, no way back** |
| 2 | `claimForAcceptance` | unchanged — still the single winner |
| 3 | **Write the signature row** | NEW |
| 4 | `applyAcceptance` | unchanged — invoice, plan, instalments, meetings |
| 5 | `recordAcceptance` | **+ reference**: `accepted_snapshot` gains the document and a pointer to the signature. Additive only |
| 6 | Decline | unchanged, never gated |

**Evidence follows `lib/consent/recordConsent.ts`**, not a bare timestamp: the
server's wording is authoritative, the client's echoed sentence is stored
separately as `evidence.client_statement` and a mismatch is logged, and the IP
is hashed **with its salt** — `20260930_marketing_consent.sql` records why a
bare hash is unverifiable later.

**Also:** `lib/business-os/bizql/mutate/MutateExecutor.ts` creates proposals
from chat. It must default `requires_signature` false and `content` null.

## Slice 6 — The booking tab shows it

**Files:** `components/crm/contact-drawer/BookingsTab.tsx`,
`components/crm/contact-drawer/CRMContactDrawerV2.tsx`,
`app/api/business-os/proposals/route.ts`

The quote journey already lists **every version** of a quote with its status,
amount, attached document name and date. Its own comment at the render site
states the case for extending it:

> *"Named, not just flagged — a revision usually carries a different file, and
> 'which one did they agree to' is the whole question later."*

A signature is the strongest possible answer to that question, so it belongs on
the same row, not behind a click.

### `ProposalVersion` gains

```ts
interface ProposalVersion {
  // … existing: id, total, amount, status, at, isCurrent,
  //    declineReason, declineNote, stopReason, stopNote

  documentName: string | null;      // kept — now the FIRST attachment
  attachmentCount: number;          // so "+2" can be shown
  /** Did this version carry a built document, and how big was it. */
  itemCount: number | null;         // null = priced only, no document
  /** Who agreed, and when. Null when none was required or given. */
  signedBy: string | null;
  signedAt: string | null;
}
```

Built in `CRMContactDrawerV2.tsx:1554` where `documentName` is already derived,
and fed by the proposals GET route, which already flattens `document`, `stages`
and `invoice` onto each proposal (`route.ts:317-364`).

### What the row shows

| mark | when | why it earns the space |
|---|---|---|
| 📄 **3 items** | `itemCount != null` | distinguishes a version the owner *built* from one they priced in ten seconds. Without it the journey cannot show where the work went |
| 📎 `plan.pdf` **+2** | attachments exist | the existing paperclip, now able to count |
| ✍️ **דויד המלך · 24/11** | `signedAt != null` | the dispute-settling fact, on the version it belongs to |

Only on the versions where each is true — a quote with no document, no
attachment and no signature renders exactly the row it renders today.

### Two actions

- **Download this version's PDF.** Needs an owner-side route,
  `app/api/business-os/proposals/[id]/pdf`, mirroring the token route but
  scoped by `user_id`. The client's route authorises by token and cannot serve
  the owner.
- **View the signature evidence** — opens in the existing read-only proposal
  view (`onViewProposal`), showing the statement text, its version, and when it
  was signed. Not the IP hash: that is for a dispute, not a drawer.

> **Superseded versions keep both.** The owner must be able to download what
> version 1 said and see that nobody signed it, long after version 3 was
> agreed. Scoping the PDF route to the *current* version would answer the wrong
> question.

## Slice 7 — Reusing a document already built

The case is one job quoted over and over: a contractor whose *full apartment* is
always the same three phases, with the same wording, at prices that move slowly.
Retyping it every week kills the builder by the third quote.

### What this is not

- **Not a catalogue.** A maintained price list is a second product — its own
  screen, its own search, someone to keep it current — and it is what
  `20260913_proposals.sql:6-14` refused. It also fails on its own terms: an
  unmaintained list quotes last year's prices with confidence.
- **Not "duplicate my last quote".** That is a different, weaker thing: it drags
  along one client's dates and one job's quirks, and the owner then edits
  *away* from it. Useful, nearly free, worth having — but it is not the answer
  to *this* job being repeated.

- **Not a saved template.** "Save as template" asks the owner to decide at the
  wrong moment: at save time they do not yet know whether this job will recur.
  They know at *create* time. It is also an extra action on every proposal to
  benefit a few, and a saved template goes stale while the real proposals move
  on.

### What it is

**Every proposal is already the template.** The builder opens and offers the
owner their own recent documents to start from. Nothing is saved, named or
maintained — there is **no new table**, because the material is
`proposals.content`, which Slice 2 already stores.

That also raises the quality bar in the right place: the candidates are ranked
by *what the client agreed to*, not by whether somebody remembered to press
save.

### Approved documents only

The candidate set is **`status = 'accepted'`** and nothing else. A document a
client agreed to is proven; a sent-and-ignored one is only the owner's
intention, and reusing it would quietly propagate whatever stopped it working.

**Ranking, in order:** same `service_id` → most recently accepted. Show the
title regardless, because an owner who runs everything through one "שיפוצים"
service recognises the job by its name, not its service.

| situation | behaviour |
|---|---|
| One clear match — same service, accepted, recent | **prefill it**, with a dismissible line at the top: *התחלנו מההצעה ל‑דנה לוי · התחל מחדש* |
| Several accepted candidates | a short list of **three**: title, date, total, item count |
| None accepted yet | blank, exactly as a first-time owner sees it |

Prefilling beats listing when the guess is good: for the contractor quoting
their fourth identical apartment, the right answer is the builder already
filled in. The banner is what makes that safe — always visible, always naming
its source, always reversible in one click.

### When it loads, and what it must not interrupt

**On the builder opening. Not before.**

- The quote dialog stays exactly as fast as it is today. An owner who never
  opens the builder — the therapist, the consultant — pays nothing for a
  feature they do not use, which is the same rule the rest of this plan follows.
- Nothing is fetched on the dialog, on the contact drawer, or on the booking
  tab. One request, triggered by one deliberate action.

**And it must resolve before the first line item exists**, because the empty
item list *is* the surface. The offer lives in the empty state:

```
  פריטים
  ┌───────────────────────────────────────────────┐
  │  להתחיל מהצעה שאושרה?                        │
  │   · שיפוץ דירה — דנה לוי · 9,000 · 3 פריטים  │
  │   · חדר רחצה — יוסי כהן · 4,200 · 2 פריטים   │
  │  או [ + הוספת פריט ריק ]                      │
  └───────────────────────────────────────────────┘
```

Once a single item has been typed, the offer is gone. Proposing to replace a
list the owner has started building is a destructive action dressed as a
suggestion, and nobody reads it as optional.

**If the fetch is slow, it loses.** The owner must be able to start typing
immediately; a skeleton that blocks the first row would make the builder feel
heavier than the blank textarea it replaces. If an item is created while the
request is still in flight, the result is dropped — not queued, not shown.

**A revision needs none of this.** Its source is named (see below), so it
prefills from a known id with no search and no candidate list.

### The revision is the strongest case of all

A client who declines does not end the document — they change it. The owner
revises, and a revision is a **new proposal with `supersedes_id`**, which is
already how this product works.

That makes it the one case where prefill needs no ranking at all: **the source
is named.** It is not "a similar proposal" — it is *this* proposal, for *this*
client, minus whatever they objected to.

The plumbing exists. `BookingsTab.tsx:402-405` already hands the builder the
declined proposal's id **and its reason**:

> *"Carries the declined proposal's id and reason, because a revision is a new
> proposal that SUPERSEDES a named one — and the owner is pricing against it."*

So the revision opens with the previous document loaded, and **the decline
reason decides what to put in front of the owner**:

| they declined because | the builder opens with |
|---|---|
| **too expensive** | the item rows and their prices in focus, with each one's total share shown — that is the number being renegotiated |
| **timing** | the dates in focus, re-based from a later start |
| **scope / wrong fit** | the items themselves, ready to be removed or split |
| **went elsewhere · no reason** | the document as it was, nothing singled out |

This is the difference between a revision and a retype. The owner is answering
one objection, and the builder already knows which.

> It also settles why a saved template would have been the wrong shape: a
> document under negotiation **moves**, and a template is a snapshot taken
> before the movement started. The live chain is always the current truth.

### Dates re-base themselves

The source proposal's items carry real dates. Derive the offsets from its own
first item — `0`, `+14`, `+28` — and re-base them onto a new start date,
defaulting to the first working day ahead.

No offsets need storing, because the original dates already encode them. For a
contractor whose phases run a fortnight apart, this is the difference between
reuse and a list they must re-date line by line.

### Prices are checked, never silently carried

The source's prices come along, but each row is checked against what the owner
has actually been charging. Where it differs, the row says so —
*last charged 3,000 · update?* — take it or leave it.

This is the part a saved template structurally cannot do: it shows the owner
their own price drift at the moment they are setting a price, instead of
handing back a figure frozen on the day they pressed save.

### Order, and what each level costs

| | | needs |
|---|---|---|
| **L1 · Revise carries the document** | the declined version's items load into the revision | nothing — the id is already passed |
| **L2 · Date re-basing** | offsets derived and re-applied from a start date | nothing new |
| **L3 · Start from an approved proposal** | fetched on builder open, offered in the empty item list, gone once an item exists | nothing new — reads `proposals.content` where `status = 'accepted'` |
| **L4 · The decline reason steers** | prices, dates or items put in focus | nothing — the reason is already passed |
| **L5 · Prefill the strong match** | the banner and its one-click reset | ranking only |
| **L6 · Price check** | *last charged X · update?* per row | read-time scan of the owner's own proposals |
| **L7 · AI wording** | improve a description, or draft one from the label | the `bos-llm-call-standards` ritual |

**L1 is first and nearly free** — a revision that loses the document the client
just read is a worse experience than no builder at all, so it is not optional
once Slice 2 ships. L2 and L3 are the rest of the feature. L4 is the cheapest
smart thing in this plan: the reason is already in the builder's props.

### Accepted everywhere, with one exception

The candidate documents are accepted-only, and so is the price check: *last
charged X* must mean **last charged**, not last asked for.

The one exception is the **revision**, whose source is a declined proposal by
definition. That is not a contradiction — the owner is not reusing a rejected
document because it worked, they are editing the specific thing that did not.
It is named by the client's own decision rather than chosen by ranking, which
is why it can be trusted where a declined document otherwise could not.

### Scale: compute on read

Items live in `content` jsonb, and the whole platform holds **46 proposals**, so
both the candidate list and the price check are read-time scans of the owner's
own rows — no derived table, no GIN index, no refresh job. Materialise only when
a real account makes it slow; a `proposal_item_history` table now would be
infrastructure for data that does not exist, and would have to stay correct
through every edit, supersede and stop.

**The whole slice adds no migration.** That is a direct consequence of dropping
the saved template: the material was already in `proposals.content`.

> This slice is also the answer to the catalogue pressure noted in
> [the constraint section](#the-product-constraint-being-reversed). The request
> will arrive; saved documents plus a price check satisfy it without a
> maintained list, a markup model or a margin report.

---

## What is reused

| Need | Reuse | Path |
|---|---|---|
| Structured content + safe renderer | `ReplyBlock` / `renderHtml` / `renderText` — the serialiser is the gate | `lib/business-os/mail/replyBody.ts` |
| Per-item editor | `MailReplyEditor` | `components/business-os/insight/MailReplyEditor.tsx` |
| PDF with Hebrew | `generateInvoicePDFAsync`, `registerThemeFont`, font assets | `lib/pdf/InvoicePDFGenerator.tsx`, `lib/pdf/themeFonts.ts` |
| Branding | `resolveEmailBranding` | `lib/email/branding.ts` |
| File storage + signed URLs | `uploadContactDocument`, `createSignedUrl` | `lib/services/ContactDocumentService.ts` |
| Signature evidence | append-only + salted hash + verbatim statement | `lib/consent/` |
| Gating accept on an obligation | the existing document gate | `ProposalAnswer.tsx:663` |

---

## Verification

1. **The default path is untouched.** Create and send a quote with the builder
   off, on both branches. Confirm it is byte-identical to today: typed total,
   hint present, `content: null`.
2. **The fork.** Selecting סדרת פגישות hides the builder and forces it off.
   Confirm a package quote can never be saved with `content` set.
3. **The money path — the one that must not break.** Accept one proposal of each
   `payment_shape.kind`; the live mix is `single` 30, `milestones` 15,
   `installments` 1. Confirm invoice, plan, stages and package meetings are
   still created and stage amounts still sum exactly to `total`.
4. **Total integrity.** Server rejects a `content` whose items do not sum to
   `total`, and one with zero items. Confirm `accepted_snapshot` freezes the
   figure that applied.
5. **Reuse timing.** Confirm nothing is fetched until the builder is opened —
   watch the network on the contact drawer, the booking tab and the quote dialog
   itself. Open the builder and confirm only **accepted** proposals are offered,
   in the empty item list. Add one item and confirm the offer disappears. Then
   throttle the request and start typing immediately: the first row must accept
   input at once, and the late result must be dropped rather than replacing it.
6. **Editing.** Add three items, give two of them descriptions, reorder, remove
   the middle one and undo it, then clear one description. Confirm the total
   tracks every change and matches the document. Remove every item and confirm
   Send is blocked with the reason on the field. Turn the builder off and on
   again and confirm the items survived. Open a **sent** quote and confirm the
   items are read-only and Revise pre-fills a new version with them.
7. **Attachments.** A proposal with only `document_id` (one of the 3 live rows),
   one with only join rows, and one with both — all three present the same way
   on the client page, in the email, and in the owner's list. Upload an image
   and confirm it rides through.
8. **The accept gate.** Unopened attachment blocks Approve; the generated PDF
   does not. Decline is ungated in every combination.
9. **PDF.** Hebrew and English; a long item description crossing a page
   boundary; figures identical to the web page.
10. **Signature, on both branches.** Sign and approve a one-job quote and a
   **סדרת פגישות** quote. Confirm for each: the evidence row exists,
   `accepted_snapshot` still carries the terms, and a pre-signature proposal's
   snapshot still reads. Confirm a missing signature is refused **before**
   `claimForAcceptance` — assert the proposal is still `sent` afterwards.
   On the package, confirm the booking and its meetings are still created, and
   that a **per-session** package shows *חתימה ואישור* with no amount appended.
11. **The booking tab, across a revision chain.** Build a quote with a document,
   supersede it with a second, and have the client sign the second. Confirm the
   journey lists both; version 1 shows its items and **no** signature; version 2
   shows the signer and date; and version 1's PDF is still downloadable and
   still says what version 1 said. Then confirm a plain priced quote with no
   document, no attachment and no signature renders the row it renders today.
12. **Jest.** New: item-sum and minimum-one-item validation; add / remove /
   reorder / clear-description against the item reducer; a guard that no module
   imports `ProposalPDFGenerator` statically; a guard that web and PDF take
   content from the same renderer; `attachmentsFor` across all three attachment
   shapes.
   Existing must stay green: `app/api/business-os/proposals/__tests__/`,
   `components/crm/contact-drawer/__tests__/ProposalBuilderPackage.test.tsx`.

---

## Risks

| Risk | Mitigation |
|---|---|
| **React-PDF hangs Jest when imported statically.** Documented in seven places; already caused one round of hung suites. | `await import()` everywhere, plus the guard in step 9. |
| **`ProposalBuilderModal.tsx` is 3,025 lines.** | New child directory. Nothing new added inline. |
| **`accepted_snapshot` is live legal data on 28 rows.** | Additive only; readers must tolerate absence. |
| **Field reorder affects owners who never use the builder.** | Its own commit, revertable alone. |
| **Two item lists on a package.** | The toggle lives inside the עבודה אחת card and is force-cleared on switching. Asserted in verification step 2. |
| **The 46-row sample.** | Treat the default template and item set as provisional. |

---

## Open decisions

| | mocked as | cost of the alternative |
|---|---|---|
| Is the total ever still typed when the builder is on? | read-only, summed | an override needs a home for discounts and rounding |
| Tax per line or one rate on the subtotal? | one rate | per-line tax makes the frozen `tax_rate` stop describing the document |
| What is the date on a line? | delivery date | it is **not** a payment date — stages still own those |
| Entitlement gating? | **none** | `ENFORCEMENT_POINTS` is `{}` on purpose; the first gate is a pricing decision with its own four-file ritual |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-10 | Created | Plan written from the approved mockup. No code written. |
| 2026-11-10 | Scope | Signature and PDF confirmed as applying to **every** proposal, including סדרת פגישות — independent of the builder, which stays scoped to עבודה אחת. |
| 2026-11-10 | Added Slice 6 | The booking tab's quote journey surfaces the new facts per version: items built, attachment count, who signed and when, plus an owner-side PDF download. |
| 2026-11-10 | Slice 2 detail | Item editing specified: add, remove, reorder, add/remove description, derived amount, undo on remove, minimum one item, and read-only once sent. |
| 2026-11-10 | Added Slice 7 | Repetition answered by saving the **document** the owner already built as a reusable template, with day offsets instead of dates and a price check on apply — not a maintained catalogue, and not "duplicate my last quote". |
| 2026-11-10 | Agreed | Requirements settled. Framing corrected: the proposal is **not** restructured — `total` stays the single authoritative figure and no chaser, cron or detector reads `content`. The breakdown explains the total; it does not replace it. |
| 2026-11-10 | Slice 7 scoped | Candidates narrowed to **accepted only**. Fetched on builder open, never before; offered in the empty item list and withdrawn once an item exists; a slow response is dropped rather than allowed to overwrite typing. |
| 2026-11-10 | Slice 7 reworked | Saved templates dropped: every proposal **is** the template. Prefill the strong match, list three otherwise, re-base dates from the source, check prices against history. **No migration.** The revision-after-decline case leads, and the decline reason steers what the builder puts in focus — both already passed to the builder today. |
