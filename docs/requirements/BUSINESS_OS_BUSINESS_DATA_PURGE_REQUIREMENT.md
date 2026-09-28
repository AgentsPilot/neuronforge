# Requirement: Business OS — Business Data Reset & Purge

> **Last Updated**: 2026-09-26

**Created by:** BA
**Date:** 2026-09-14
**Status:** ✅ **Slice 1 cleared for QA by SA (2026-09-16).** Delivery is sliced (**§0**); §§1–12 are the complete, self-contained requirement.

> 📌 **This document is authoritative and self-contained.** It defers to no commit SHA for its own content. See [§0.7 O-4](#07-carried-forward-and-not-to-be-lost) for the ruling and the reasoning behind it.

## Overview

A capability to delete all data belonging to one business in Business OS. A *business* is a **user account** — there is no `business_id` ([§2](#2-there-is-no-business_id)) — so "delete business X" means "delete every row for user X" across **110 user-scoped base tables**, measured against the live database.

**This document is two things:** a **delivery plan** (§0) and the **full requirement** (§§1–12). The knowledge in §§1–12 is measured, not inferred, and cost an entire cycle. The plan exists because the owner halted that cycle on a scope concern and ruled: *keep the knowledge, re-shape the delivery.*

**Read [§0](#0-delivery-slices) first.** §§1–12 are the normative requirement.

---

## Table of Contents

0. [**Delivery slices**](#0-delivery-slices) ⭐
1. [Evidence base & honesty statement](#1-evidence-base--honesty-statement)
2. [There is no `business_id`](#2-there-is-no-business_id)
3. [Table inventory — the blast radius](#3-table-inventory--the-blast-radius)
4. [Indirect / second-degree data](#4-indirect--second-degree-data)
5. [Delete semantics already in the codebase](#5-delete-semantics-already-in-the-codebase)
6. [Ordering constraints & trigger hazards](#6-ordering-constraints--trigger-hazards)
7. [Non-table state](#7-non-table-state)
8. [The exclusion set — enumerated](#8-the-exclusion-set--enumerated)
9. [Product decisions (D1–D12)](#9-product-decisions-d1d12)
10. [Requirement — FRs and ACs](#10-requirement--frs-and-acs)
11. [Open follow-throughs during Dev](#11-open-follow-throughs-during-dev)
12. [Notes on integration points](#12-notes-on-integration-points)
13. [SA Review — first pass (summary)](#13-sa-review--2026-09-14-first-pass-summary)
14. [SA Review — second pass (summary)](#14-sa-review--2026-09-14-second-pass-summary)
15. [SA Review — workplan pass (amendments)](#15-sa-review--2026-09-15-workplan-pass-amendments)
16. [SA Review — the re-slice](#16-sa-review--2026-09-16-the-re-slice)
17. [Change History](#change-history)

---

# 0. Delivery slices

## 0.1 What the owner asked, and what changed

> *"I feel this has grown from the original scope of a simple cleaning up to many other elements… we should rollback the feature and start assessing how do we split this feature to incremental small steps vs one big one."*

**The feature never grew.** The blast radius was 110 tables on day one, fixed by the schema. What moved four times — 55 → 56 → 60 → 64 → 110 — was BA's *measurement*, produced from an oracle this document itself had documented as unreliable. That is a confidence failure, not a scope failure (§0.6).

What *did* grow the deliverable is separable, and is the basis for the slicing:

| Cause | Share of the acceptance surface | Where it goes |
|---|---|---|
| Irreducible structure (110 tables, 37 blocking edges) | ~26 of 49 ACs | Slices 1–3 — unavoidable |
| **D1** — customer-facing as well as internal | ~8 of 49 ACs | **Slice 5** |
| **D6** — the hard-blocking Stripe gate | **14 of 49 ACs** (AC-6…AC-18, AC-33) | **Slice 4** |
| Pre-existing defects surfacing | 0 ACs — correctly excluded | Out-of-band register (§0.7) |

**D1 and D6 are the natural fault lines**, and both were owner decisions taken without a cost figure attached. Neither was wrong. Both are deferrable.

## 0.2 The AC-37 problem, and its resolution

**The problem.** FR-1 / AC-37 make the engine **fail closed when any user-scoped table is in neither the delete set nor the exclusion set**. That property caught 38 unclassified relations. It also means the engine cannot run *at all* until all 110 tables are classified — so "ship CRM purge first" is architecturally impossible. It was reviewed four times and nobody named it.

**The resolution: separate *classification* from *capability*.**

| Concept | Definition | Scope |
|---|---|---|
| **Classification** | Every live user-scoped table is `reset` / `purge` / `never` / `optional:<checkbox>`, with a scope predicate | **Global and complete, from slice 1 onward.** This is what AC-37 checks |
| **Capability** | Which *operations* this build may perform — `preview`, `reset`, `purge`, `gate`, `customer-surface` | **Per slice.** A build constant, asserted in tests |

AC-37 then reads: *the engine refuses to run when the live enumeration contains a table with no classification.* It says nothing about capability. A preview-only build still requires, and gets, complete classification.

**This costs nothing:** the complete classification already exists — **121 machine-checked descriptors (77 in-scope/opt-in + 44 `never`)**, zero unclassified. Classification is the cheap part; the gate, snapshot, RPC, surfaces and localised copy are behaviour, and behaviour slices cleanly.

### The failure mode the split admits, and the invariant that closes it

AC-37 today binds two claims: **(i)** every live user-scoped table has a classification, and **(ii)** the engine acts on all of them. The split keeps (i) and drops (ii). For slice 1 that is free. **For slices 2+ it is not:**

> A table is classified `reset`. Classification is complete, so **AC-37 passes**. The build's capability set is `['preview','reset']`. If the executor resolves its work list by filtering descriptors through *capability as well as level*, a mis-set capability term, a filter typo, or a descriptor whose level and capability disagree causes that table to be **silently not deleted — while AC-37 still reports complete**, because completeness is now measured on a different axis from execution.

- **AC-37b (SA-S1).** Capability must filter **operations, never tables**. For every declared capability, the executor's resolved table list is **exactly** the descriptor set filtered **by level only, with no capability term in the comparison**.
- **SA-S2 (compile-time half).** The capability constant is an allow-list with an exhaustive `switch` and a TypeScript `never` check, so adding a capability without handling it fails compilation rather than silently no-op'ing.

### 0.2.1 Classification drift — `never` is not a scheduling device

Incremental delivery creates a temptation a single-shot build does not: to **narrow a classification to fit a slice's capability** — to mark an awkward table `never` in slice 2 rather than defer the capability that handles it.

**`never` is a claim about the schema** — *this table must survive a purge* — **not a statement about what this build implements.** Mis-used as a scheduling device it is the worst failure available, because it is silent in all three directions: it **passes AC-37**, it **loses the data permanently**, and it **carries forward into slices 3–5** where nobody re-derives a classification that already looks settled.

**FR-32 and AC-37c carry this:** the classification set is **snapshotted at each slice boundary** (table, level, scope predicate); any descriptor whose **level changes between slices fails the invariant test** until the change carries an explicit review note.

> **Adding a new table is not drift** — that is FR-1 working. **Changing an existing table's level is.** Conflate them and the guard becomes noise and gets disabled.

### How strong the guarantee actually is

An earlier draft claimed the guarantee is *"not weakened anywhere."* **That was one notch too strong:**

| Slice | Guarantee | Why |
|---|---|---|
| **1** | **Strengthened** | Fail-closed is exercised first on a **read-only** build, where a false refusal costs a retry rather than a half-deleted business |
| **2+** | **Equivalent — conditional on AC-37b** | Classification- and execution-completeness stay on the same axis only because capability cannot subtract a table |
| **2+ without AC-37b** | **Weaker** | The hole above opens, and it is silent |

> ⚠️ **One gap slicing does not fix.** `organizations` keys on `owner_user_id`, so FR-1's literal `user_id` predicate cannot see it. **The union predicate — a tenancy column by name OR any FK to `auth.users` — lands in slice 1, its only possible home** (O-3): slice 1 ships AC-37 and the classification, so landing it later changes what "complete" means underneath slices 2–5. Its bound is intact and **B7 is the proof it does not close the class** (§4).

## 0.3 Why these slices and not module slices

"Ship CRM purge first" is **unsafe**, and the live census says why: **B4** couples `crm_contacts` to `payment_plan_subscriptions` **through a trigger**, and that trigger deletes future `scheduling_bookings`, tripping **B2**. A "CRM only" slice reaches into Payments and Scheduling on its first delete. **Module boundaries are not delete boundaries in this schema.**

**Ten live ordering constraints** (37 blocking edges; 23 point at `auth.users` and are inert under D3, 4 inert otherwise):

| Constraint | Endpoints | Internal to one slice? |
|---|---|---|
| **B1** `payment_refunds` → `payment_transactions` | both `D` | ✅ Reset |
| **B2** `payment_plan_subscriptions` → `scheduling_bookings` | both `D` | ✅ Reset |
| **B3** `insight_automations` → `kernel_executions` | both `D` | ✅ Reset |
| **B4** trigger-mediated via `crm_contacts` | all `D` | ✅ Reset |
| **B6** `agent_logs` → `agents` | both `optional:agents` | ✅ opt-in set |
| **B7** `agent_scheduler_state` → `agent_executions` (`NO ACTION`) | both `optional:agents` | ✅ opt-in set |
| 5 remaining | all between `never` tables | ✅ never constrain a purge |
| **`crm_activities` last** | within `D` | ✅ Reset |

**Every live ordering constraint is internal to a single slice's delete set.** That is what makes level-wise slicing safe.

> 🔄 **B7 was missing from this census until SA's review, and *why* is the point.** `agent_scheduler_state` is **not user-scoped** — it reaches its tenant only through `agent_executions`. A census filtered to user-scoped tables cannot see it **by construction**, the same blind spot the union predicate does not close (§4). The conclusion survived and the code was already correct (`descriptors.ts:88`, `:260`), but the census is the load-bearing justification for the slice structure, so it is corrected here rather than left for the next person to re-derive and get nine again.

## 0.4 The five slices

### Slice 0 — repo-wide deletion-path guard ✅ **already shipped**

`lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`, committed on `fix/business-os-deletion-paths` @ `66c3ee35` (PR #41), with four retired deletion paths. **It shipped ahead of any slice and independently of the feature** — the precedent for out-of-band handling (§0.7). **Do not revert.**

### Slice 1 — Census (read-only, internal, admin-gated)

| | |
|---|---|
| **Delivers** | The introspection RPC **with the union predicate**; the complete 110-table classification **plus the drift snapshot (FR-32)**; the invariant suite including **AC-37b**; `POST /api/business-os/purge/preview`; the `AdminAccessService` gate; a Danger Zone tab reporting per-table row counts and per-bucket object counts. **Nothing is deleted; no destructive code path exists in this build.** |
| **Defers** | All deletion · the snapshot artefact · the advisory lock · the Stripe gate · the customer surface · typed confirmation |
| **Depends on** | Nothing. **O-1 — commit `20260915a_purge_schema_introspect.sql` in this slice's own PR** |
| **Ships alone** | ✅ **Yes, with value beyond this feature** — the only working oracle for this schema |
| **Proves** | AC-37 **and AC-37b** in production, at zero blast radius |

### Slice 2 — Reset, **available only in the skip-cleanly case** ← the owner's original ask

| | |
|---|---|
| **Delivers** | The `purge_business_data` RPC at **Reset** level; the three-phase shape; the pre-purge snapshot; the transaction-scoped advisory lock; typed confirmation; ordered deletes honouring B1–B4 and `crm_activities`-last; storage removal; the structured result and audit row |
| **Defers** | Purge level · the Stripe **provider** gate · the customer surface · localised copy · the opt-in extras *(→ slice 3; B6/B7 engage only when the agents checkbox is ticked, off by default)* |
| **Depends on** | Slice 1 |
| **Ships alone** | ✅ Yes — a working "reset my test business" |

**Two controls, complementary rather than redundant:**

1. 🔴 **Runtime refusal on any Stripe Connect account (SA-S5).** Slice 2 **refuses when `resolveUserConnectAccounts()` returns a non-empty list** — not when local blocking rows exist, but when an account is present at all. One existing call; fail-closed; no new machinery.
2. **A local-only precondition**, a **literal subset** of slice 4's gate — same tables, same statuses, same predicate: `payment_plan_subscriptions.status ∈ {pending, active, past_due, paused}` · `payment_transactions.status = 'pending'` · `payment_refunds.status = 'pending'` · `payment_invoices.status ∈ {sent, overdue}`. **It must not diverge by one value**, or slice 4 becomes a reconciliation rather than a replacement.

> **Why both.** Control 1 removes the provider-state class entirely — including the residual this plan previously only documented: **Stripe-dashboard state with no local row.** Control 2 still does real work in the skip-cleanly case, because locally-originated blocking state exists **with no Stripe at all**: a manually-issued `payment_invoices` row sitting `sent`/`overdue`, or a manual `payment_transactions` row left `pending`. Neither subsumes the other.

**Why the release note was the wrong instrument.** *"If the test business ever holds live Stripe state, slice 4 becomes a prerequisite"* must be evaluated **every run**, **a human cannot evaluate it** (dashboard state has no local signal), and violating it produces **silently wrong books rather than an error**. The refusal converts *"please remember"* into *"cannot happen"*, **matches FR-8's skip-cleanly semantics**, and makes slice 4 a **mechanical** prerequisite. The note survives as documentation *of the refusal*.

### Slice 3 — Purge, internal only

| | |
|---|---|
| **Delivers** | The **Purge** level (also removes the `K` tables); cron starvation (FR-14); subdomain release copy; re-seed with a new `user_code`; the three opt-in extras including **B6 and B7** ordering |
| **Defers** | Stripe gate · customer surface |
| **Depends on** | Slice 2 |
| **Ships alone** | ✅ Yes |

### Slice 4 — Stripe pre-flight gate

| | |
|---|---|
| **Delivers** | The full provider-enumerated gate across all connected-account candidates, `stripeAccount`-scoped; C1/C2/C3 from the provider rather than local rows; fail-closed semantics; the six resilience bounds; the shared `lib/stripe/client.ts`; the blocked-state message naming Stripe-side ids |
| **Replaces** | Slice 2's runtime refusal and local precondition |
| **Depends on** | Slice 2 (a gate with nothing to gate is dead code) |
| **Prerequisite for** | **Any business holding live money** — enforced mechanically by slice 2's refusal — and for slice 5 |

### Slice 5 — Customer-facing surface, flag-gated

| | |
|---|---|
| **Delivers** | Everything D1 added: the surface behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`; localised en/es/he copy (FR-23, FR-25, FR-26); the post-purge destination (FR-27); the no-PII snapshot branch; D11's resolution of *which* of the two live Danger Zones carries the flow; D9's un-gating checklist |
| **Depends on** | Slices 2, 3 **and 4** |
| **Ships alone** | ✅ Yes, once its dependencies land |

## 0.5 Is any of these not a slice?

| Slice | Ships alone? | Caveat |
|---|---|---|
| 1 | ✅ | None |
| 2 | ✅ | Capability **bounded by a runtime refusal**, not a remembered condition |
| 3 | ✅ | None |
| 4 | ✅ | Pointless before slice 2, so sequenced after — not blocked by it |
| 5 | ✅ | Hard-depends on 2+3+4. Inherent to D6 |

## 0.6 What the original requirement got wrong

1. **No delivery-slices section.** Slicing was never considered, so never rejected.
2. **AC-37's delivery consequence was never stated.** A correctness guarantee had silently become a delivery constraint.
3. **Size was reported as structure, never as cost.** "31 FRs, 49 ACs" read as thoroughness.
4. **D1 and D6 were recorded faithfully and priced at nothing.**
5. **The stop condition arrived as a lesson instead of a stop.** §1.4 was written after three corrections. On day one the correct output was *"this cannot be sized from this repository"*.
6. **"Ruled out" in §3.16 described tables that had never been found.**
7. **The evidence-tier taxonomy was a closing apology, not an opening convention.**
8. **Module boundaries are not delete boundaries** (§0.3) — never stated.
9. **"Not weakened anywhere" overclaimed** (§0.2).
10. 🆕 **Summarising §§1–12 to avoid "transcribing a fourth time" destroyed content.** 65 identifiers — table names, trigger names, and six columns/functions (`account_token`, `credentials`, `deleted_at`, `get_or_create_user_organization`, `idempotency_key`, `preferred_language`) that exist nowhere else in the repo — vanished when §3's rationale rows collapsed. **The instinct was right and the method was wrong:** a normative document is re-inlined from its own prior text, never re-derived from memory. Fixed in this revision.

### Standing rules taken from this cycle

| Rule | Owner |
|---|---|
| **A global fail-closed invariant's delivery consequence is stated in the same breath as its safety benefit** | BA + SA |
| Every requirement carries a **Delivery slices** section proposing at least two candidates | BA |
| Every decision put to the owner carries **what it adds, what it defers, and an explicit defer option** | BA + TL |
| **A split FR/AC appears once per slice it splits across, or it is not split** | BA |
| An evidence tier on every factual claim, from the first draft | BA |
| If size depends on an inventory BA cannot measure, **BA stops** | BA |
| 🆕 **A requirement is self-contained. It never defers its own normative content to a commit SHA** (§0.7 O-4) | BA |

## 0.7 Carried forward and not to be lost

**Verified knowledge**, measured live: 110 user-scoped base tables · 239 FKs · 84 triggers · 360 policies · **37 blocking edges → 10 live ordering constraints**, B1–B4/B6/B7 confirmed, **B5 a recorded negative result** · four DELETE-capable triggers, one live T5 path · **121 descriptors** · the `organizations` oracle gap · 27 tables with no DELETE policy · 9 open `WITH CHECK (true)` INSERT policies.

**D1–D12 and FU-1…FU-18 preserved in full.** A re-slice is not an amnesty.

| # | Open item | Owner |
|---|---|---|
| **O-1** | 🔴 **`supabase/migrations/20260915a_purge_schema_introspect.sql` is applied live but untracked** — the `audit_logs` defect class. **Commit it in slice 1's own PR — not PR #41** | Dev |
| **O-2** | The dump is true as of **2026-09-15 13:12Z**. Every slice re-runs `purge_schema_introspect()` rather than trusting the markdown (C-1) | Dev, each slice |
| **O-3** | ✅ **Closed** — the union predicate lands in slice 1 | SA |
| **O-4** | ✅ **Ruled — see below** | BA |

### O-4 ruling: the document is authoritative and complete

**This requirement defers to no commit SHA for any of its own content.** §§1–12 are inlined in full.

The reasoning, recorded so the next revision does not re-summarise for the same good reason I did:

- **A SHA is not a source, it is a coordinate.** `bf824c76` stays reachable, so nothing is destroyed absolutely — but a governing requirement for a **destructive feature** that points at a git object for the text of its own 32 FRs and 51 ACs has stopped being a requirement. Anyone reading `HEAD` cannot answer "what must this feature do?" without archaeology.
- **This is O-4's own failure mode inverted.** SA-S8 reworded O-4 because *"`main` never carried the long form, so applying it literally would have discarded the 130 lines it existed to protect."* Summarising §§1–12 committed the identical error in the other direction — and it cost 65 identifiers, six of which survive nowhere else in the repo.
- **Pointers are legitimate only to a living tracked file, and only for non-normative material.** §§13–15 point at the workplan's §12–§12D — a tracked, current, byte-verified file — for SA's *review record*, which is history rather than specification. That is sound. Pointing §10 at a SHA for the *specification* is not.
- **Re-inline, never re-derive.** This revision was rebuilt from main's own text with the T1 and SA deltas layered on top. Re-deriving from memory is exactly how the 65 identifiers were lost.

**Out-of-band defect register.** Findings that are *not this feature* go to `docs/investigations/` with their own severity and owner: `/api/auth/cleanup-incomplete` arming on `CRON_SECRET` · 41 unauthenticated `/api/admin/**` routes · **the public `service_role` key (P0 — rotate before anything else on this list)** · FU-17 · FU-18 · the 9 open INSERT policies. **PR #41 is the precedent.**

## 0.8 FR / AC mapping

**32 FRs · 51 ACs** (49 numbered + **AC-37b** + **AC-37c**). Every item appears **once per slice it splits across**, so the expected duplicate set is exactly **FR-3, FR-15, FR-31, AC-33, AC-40**; anything else appearing twice is a defect.

| Slice | FRs | ACs |
|---|---|---|
| **1 — Census** | FR-1 *(+ union predicate)*, FR-2, FR-13 *(read-only)*, FR-19 *(preview result)*, FR-20, FR-21, FR-29, FR-31 *(admin-gate half)*, **FR-32** | AC-1, AC-28, AC-37, **AC-37b**, **AC-37c**, AC-39, AC-40 *(admin half)*, AC-45, AC-46, AC-49 |
| **2 — Reset** | FR-3 *(Reset half)*, FR-11, FR-12, FR-15 *(B1–B4)*, FR-16, FR-17, FR-18, FR-22, FR-26, FR-28, FR-30 | AC-3, AC-4, AC-5, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-26, AC-29, AC-30, AC-35, AC-36, AC-38, AC-41, AC-47, AC-48 *(slice subset)* |
| **3 — Purge** | FR-3 *(Purge half)*, FR-4, FR-14, FR-15 *(B6, B7)*, FR-24, FR-25 | AC-2, AC-25, AC-27, AC-31, AC-32, AC-33 *(ordering half)*, AC-34, AC-42 |
| **4 — Gate** | FR-5, FR-6, FR-7, FR-8, FR-9, FR-10 | AC-6…AC-18, **AC-33 *(provider half)*** |
| **5 — Customer** | FR-23, FR-27, FR-31 *(flag half)* | AC-40 *(flag half)*, AC-43, AC-44 |

**On AC-33's split.** Slice 3 owns the **ordering** half — `plugin_connections` is read before it is deleted. Slice 4 owns the **provider** half — that with integrations ON the gate still behaves correctly. Slice 3 has no gate, so it cannot own the second half, and that is the half guarding against a **false all-clear**.

## 0.9 Recommendation

**Slice 1 is cleared for QA and ships now.** **Slice 2 is the owner's original ask and should follow immediately.**

---

# The requirement

## 1. Evidence base & honesty statement

| Source | Used for |
|---|---|
| **[T1 live schema dump](/docs/workplans/business-os-business-data-purge-schema-dump.md)** | ⭐ **The authoritative inventory.** 110 user-scoped base tables, 239 FKs, 84 triggers, 360 policies. `generated_at 2026-09-15T13:12:15Z` |
| `supabase/migrations/**` · `supabase/SQL Scripts/**` | DDL *intent*. Not proof — §1.4 |
| `lib/payments/stripeAccountContext.ts` | Stripe account resolution; the direct-charge model; "absent evidence refuses". `resolveUserConnectAccounts()` is also slice 2's refusal control |
| `lib/business-os/bizql/mutate/ActionLog.ts` | The `idempotency_key` construction behind FR-24 |
| `lib/repositories/*.ts` (54 files) | What code *believes* exists — not evidence of existence (§1.4) |
| `vercel.json` | The 11 crons and their enumeration sources |
| **Workplan §12–§12D** | The canonical SA review record (history, not specification) |

### 1.1 Evidence tiers

| Tag | Meaning |
|---|---|
| ✅ **Verified live** | In the T1 dump (2026-09-15) or `catalog.generated.ts` |
| 📄 **Migration-only** | Read from DDL; unverified |
| ❌ **Absent** | Measured as not present |

> This taxonomy belongs in the **first** draft. It arrived here after three corrections.

### 1.2 Prior art: a deletion script in this repo was broken in exactly the way the guard exists to prevent

`supabase/SQL Scripts/delete_user_by_id.sql` declared a PL/pgSQL variable named `user_id`, identical to the column, then ran `DELETE FROM agent_executions WHERE user_id = user_id`. Under `plpgsql.variable_conflict = use_variable` that is constantly true — **every row, every user.** Under the default it raises an ambiguity error. **Which happens is a database setting, not a property of the file.** Removed (FU-13). It is why RPC parameters are prefixed `p_` and why AC-45 exists.

### 1.3 Live customer-facing delete paths already shipped, and they were broken

`POST /api/user/delete-account` has **four wired callers, two live** (`app/business-os/settings/page.tsx`, `components/v2/settings/SecurityTabV2.tsx`), split by `uiVersion` routing.

| Verified fact | Consequence |
|---|---|
| It deletes `auth.users` | **Violates D3 and FR-30**, which forbid that absolutely |
| It deletes `user_preferences` | A **`K*` table** — retained by both levels (§3.14) |
| It deletes `notification_settings` and `security_settings` | Account config someone once treated as personal data (§8.12) |
| It touches **exactly one** of the in-scope tables | The rest are left behind entirely |
| It audits **intent but never outcome** | A failed run is indistinguishable from a successful one |
| It **500s at its final phase for every onboarded user** — 16 `auth.users` FKs have no `ON DELETE` clause | **After earlier phases have irreversibly run**, so it reliably half-deletes and then reports failure |

A path that always fails *after* destroying part of the account leaves more unaccounted residue than one that never starts. **D11** puts it in scope. **Five live deletion paths were found this cycle; four are retired at `66c3ee35`; zero shipped.**

> A **fourth** destructive path — `/api/auth/cleanup-incomplete`, which deletes `auth.users` on a predicate the live onboarding flow never writes, dormant only because `CRON_SECRET` is unset — is out of scope and escalated. **It must reach the `CRON_SECRET` owner before that variable is set.**

### 1.4 What the live dump proved about this document's own method

| Claim | Built from | Measured |
|---|---|---|
| "`insight_outcomes` is a 7th insight table" | `OutcomeRepository` querying it | ❌ **Does not exist.** That repository has never worked |
| "`payment_methods` was dropped" | `2026-08-14_drop_payment_methods.sql` | ✅ **Still live** — never applied |
| "`audit_logs` is a phantom name" | No `CREATE TABLE`, no code reference | ✅ **Live and user-scoped** |

**The rule:** a repository querying a table proves only that *code believes* it exists. A migration file proves only that someone *intended* a change. Only the live database is evidence of the schema. This is why FR-1 is a **runtime** oracle.

---

## 2. There is no `business_id`

No table has a `business_id` column. The tenancy root is `auth.users(id)`:

```
auth.users(id)
   └── business_profiles.user_id   UNIQUE   ← 1:1. THIS is the "business" row.
   └── every other Business OS table .user_id
```

- `20260721_create_business_profiles.sql` — `user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`. ✅ SA-confirmed.
- [DATA_MODEL §13 obs. 12](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#13-data-model-observations--risks) — *"`business_profiles` is the natural per-tenant anchor."*

**Consequences:** "delete business X" = "delete all Business OS rows where `user_id = X`"; one login = one business; a purge is close to an account wipe, hence the conservative opt-ins in §10.3 and the absolute exclusion of `auth.users`.

⚠️ **Except `organizations`, which keys on `owner_user_id`** and is invisible to a literal `user_id` predicate — §0.2, dump §9.5.

---

## 3. Table inventory — the blast radius

**64 user-scoped tables in scope**, plus 1 view, 3 storage buckets, and the enumerated exclusion set in §8. Full per-table detail also lives in `lib/business-os/purge/descriptors.ts` (121 descriptors, zero unclassified) and the [dump §9.7](/docs/workplans/business-os-business-data-purge-schema-dump.md).

**R column:** `D` = deleted by Reset · `K` = kept by Reset, deleted by Purge · **`K*` = retained by BOTH levels**.

> **Numbering note.** Rows keep their original numbers so every cross-reference elsewhere in this document still resolves. **#11 and #53 were measured absent and are struck in place rather than renumbered**; the six tables T1 added are #61–#66. In-scope total = 60 − 2 + 6 = **64**.

### 3.1 Business profile

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 1 | `business_profiles` | `user_id` **1:1** | K | ✅ | UNIQUE `user_code`, UNIQUE partial `subdomain`. **No DELETE RLS policy**. Reset retains it — the enumeration source for `calendar-sync` (FR-26) |

### 3.2 CRM — 5 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 2 | `crm_contacts` | `user_id` | D | ✅ | CRM hub — referenced by 13 tables. **BEFORE DELETE trigger T1**. One of `insight-detect`'s four enumeration sources |
| 3 | `crm_activities` | `user_id` + contact CASCADE | D | ✅ | **Deleted LAST inside the RPC** (T5 ordering) |
| 4 | `crm_pipeline_stages` | `user_id` | K | ✅ | Seeded by `/api/onboarding/build` |
| 5 | `crm_tasks` | `user_id` + contact SET NULL | D | ✅ | |
| 6 | `contact_documents` | `user_id` + contact CASCADE | D | 📄 | Rows point at storage objects |

### 3.3 Website — 4 tables + 1 view

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 7 | `website_pages` | `user_id` | D | ✅ | UNIQUE `subdomain` |
| 8 | `website_blocks` | **indirect** (`page_id` CASCADE) | D | ✅ | **No `user_id`.** Child ids captured in snapshot (AC-5) |
| 9 | `website_content` | `user_id` **1:1** | D | 📄 | **No DELETE RLS policy** |
| 10 | `website_page_views` | `user_id` + page CASCADE | D | ✅ | **Open INSERT policy** `WITH CHECK (true)` |
| ~~11~~ | ~~`websites`~~ | — | — | ❌ **ABSENT** | **Measured absent — removed from the purge set.** Queried only by the two [known-dead detectors (H2)](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md#11-known-state--hazards), which were querying nothing |
| — | `website_analytics_summary` (VIEW) | — | — | ✅ view | No rows of its own |

### 3.4 Scheduling — 4 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 12 | `scheduling_services` | `user_id` | D | ✅ | |
| 13 | `scheduling_bookings` | `user_id` | D | ✅ | Blocked by **B2**; reached by **T1**. One of `insight-detect`'s four enumeration sources |
| 14 | `scheduling_availability_exceptions` | `user_id` | D | 📄 | |
| 15 | `external_calendar_events` | `user_id` | D | 📄 | **Repopulated by `calendar-sync` within ~5 min after a Reset** (FR-26) |

### 3.5 Payments — 14 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 16 | `payment_invoices` | `user_id` | D | ✅ | Unpaid rows drive **C3**. One of `insight-detect`'s four enumeration sources |
| 17 | `payment_transactions` | `user_id` | D | ✅ | Blocked by **B1**. Pending rows drive **C2** |
| 18 | `payment_refunds` | `user_id` | D | ✅ | `transaction_id … RESTRICT`. SELECT-only RLS. `status='pending'` drives **C2** |
| 19 | `payment_plan_subscriptions` | `user_id` | D | ✅ | `booking_id … RESTRICT`. SELECT-only RLS. Drives **C1**. **B2 + B4** |
| 20 | `payment_plans` | `user_id` | D | ✅ | |
| 21 | `payment_plan_installments` | `user_id` | D | ✅ | CASCADE from plan **and** subscription |
| 22 | `payment_events` | `user_id` | D | 📄 | |
| 23 | `payment_automation_rules` | `user_id` | D | 📄 | |
| 24 | `payment_automation_executions` | `user_id` + rule CASCADE | D | 📄 | Durable queue |
| 25 | `payment_reminders` | `user_id` | D | 📄 | Durable queue; dead-letter via `status='failed'` |
| 26 | `payment_processors` | `user_id` | K | 📄 | Holds `credentials` JSONB |
| 27 | `stripe_connect_accounts` | `user_id` **1:1** | K | 📄 | Gate reads this **before** any delete |
| 28 | `saved_payment_methods` | `user_id` + contact CASCADE | D | 📄 | |
| 29 | `payment_methods` | `user_id` | D | ✅ *(was ❓)* | ⚠️ **LIVE — `2026-08-14_drop_payment_methods.sql` was never applied.** Stays in the purge set |

### 3.6 Email automation — 6 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 30 | `email_sequences` | `user_id` | D | 📄 | |
| 31 | `email_sequence_steps` | `user_id` + sequence CASCADE | D | 📄 | |
| 32 | `email_campaigns` | `user_id` | D | 📄 | |
| 33 | `email_sends` | `user_id` + contact CASCADE | D | ✅ | |
| 34 | **`email_unsubscribes`** | `user_id` | **K\*** | 📄 | 🔒 **RETAINED ON BOTH LEVELS (D8).** A third-party consent record. `auth.users` survives (D3), so the same `user_id` can re-onboard and resume emailing people who opted out |
| 35 | `email_sequence_enrollments` | `user_id` + CASCADEs | D | 📄 | |

### 3.7 Intake — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 36 | `user_intake_settings` | `user_id` **1:1** | K | 📄 | Created by `20260728_create_intake_tables.sql` — **older than #37, so #37's earlier ❓ never propagated here** |
| 37 | `business_intake_forms` | `user_id` | K | ✅ *(was ❓)* | ⚠️ **LIVE.** §10.2 ¶2's intake half is **firm, not contingent**, and **AC-3's intake assertion is unconditional** |

### 3.8 Onboarding & chat — 8 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 38 | `onboarding_conversations` | `user_id` | D | 📄 | Append-only RLS |
| 39 | `onboarding_prompt_ideas` | `user_id` | D | 📄 | |
| 40 | `command_sessions` | `user_id` | D | 📄 | |
| 41 | `business_chat_conversation` | `user_id` is **PK** | D | 📄 | |
| 42 | `business_chat_action_log` | `user_id` | D | 📄 | UNIQUE `idempotency_key` — deleting re-arms plan-level sends. **Accepted; FR-24** |
| 43 | `business_chat_saved_plans` | `user_id` | D | 📄 | |
| 44 | `business_chat_plan_cache` | `user_id` **NULLABLE** | D (own rows only) | 📄 | ⚠️ `user_id IS NULL` = portable, cross-tenant — **excluded (§8.2)**. Those surviving rows are why a `planId` can recur post-purge (FR-24) |
| 61 | **`business_chat_verified_questions`** | `user_id` **NOT NULL** | D | ✅ **new** | Classified in-scope: **every other `business_chat_*` table is business data**, so `never` would need a reason and there is none. `user_id` is **NOT NULL**, confirmed — it does **not** repeat #44's portable-row shape |

### 3.9 Capabilities — 2 tables

| # | Table | Scoping | R | Status |
|---|---|---|---|---|
| 45 | `user_capabilities` | `user_id` | K | 📄 |
| 46 | `user_capability_blocks` | **indirect** (CASCADE) | K | 📄 |

### 3.10 Conversion / attribution — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 47 | `smart_links` | `user_id` | D | ✅ | UNIQUE `code` |
| 48 | `smart_link_clicks` | **indirect** (CASCADE) | D | ✅ | **No `user_id`.** Insert policy `WITH CHECK (true)` |

### 3.11 Channel insights — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 49 | `channel_connections` | `user_id` | K | ✅ | Holds `account_token`. **Always deleted by Purge** regardless of checkbox. Reset retains it **including `last_synced_at`**, which is why channel stats return only on the next scheduled sync (FR-26) |
| 50 | `channel_metrics_daily` | `user_id` | D | ✅ | Repopulated by `channel-metrics-sync` on the connection's next due sync — **up to ~20 h** |

### 3.12 Insights — 6 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 51 | `insights` | `user_id` | D | ✅ | Self-FK `correlation_parent_id` SET NULL |
| 52 | `owner_insight_history` | `user_id` + insight CASCADE | D | 📄 | |
| ~~53~~ | ~~`insight_outcomes`~~ | — | — | ❌ **ABSENT** | **Measured absent — removed.** This document called it "a 7th insight table" on the strength of `lib/repositories/OutcomeRepository.ts` querying it at lines 92, 135, 151 and 174. It is absent from the **database**, so that repository **has never worked** (FU-17). The as-built Insights doc saying "six" was right. Per `business-os-schema-check` Rule 5 the reference must **not** be deleted — that leaves the code silently returning empty, which is worse than the error |
| 54 | `business_events` | `user_id` | D | 📄 | Hazard H1 — no emitters. One of `insight-detect`'s four enumeration sources |
| 55 | `derived_metrics` | `user_id` | D | 📄 | |
| 56 | `insight_automations` | `user_id` | D | 📄 | **Blocks B3** |
| 57 | `business_health_summaries` | `user_id` | D | 📄 | |

### 3.13 Kernel (insight-triggered) — 2 tables

| # | Table | Scoping | R | Status |
|---|---|---|---|---|
| 58 | `kernel_executions` | `user_id` | D | 📄 |
| 59 | `kernel_action_log` | `user_id` | D | 📄 |

### 3.14 Owner configuration — 1 table

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 60 | **`user_preferences`** | `user_id` | **K\*** | 📄 | 🔒 **RETAINED ON BOTH LEVELS.** Holds `preferred_language` and currency — read by `InsightRepository.ts:420`, `LanguageContext.tsx`, `BookingEmailService`, `CurrencyService`. Two reasons: deleting it mid-run resets the owner's language **while they read the result screen**, and it is an **account preference on a login that survives every level** (D3), so deleting it renders the owner's *next sign-in* in the wrong language. ⚠️ **The existing `/api/user/delete-account` route deletes this table** — §1.3, D11 |

### 3.15 Business content — 5 tables added by T1

The owner's own content, not platform telemetry. A "delete my business" that left these behind would be wrong. All ✅ verified live.

| # | Table | R | Evidence & reasoning |
|---|---|---|---|
| 62 | **`proposals`** | D | Business content the owner authored and sent to *their* clients — the same class as `payment_invoices`. Platform telemetry has no noun like this |
| 63 | **`lead_responses`** | D | Lead data is customer data. Leads are an established Business OS concept — `LeadNotificationToggles` ships in `components/business-os/settings/` |
| 64 | **`daily_briefings`** | D | Owner-facing generated content, the same class as `business_health_summaries` (already `D`) |
| 65 | **`daily_briefing_sends`** | D | A send log. ⚠️ It has the `email_unsubscribes` *flavour* but not its substance — a send history is the business's own activity record, not a third party's withdrawal of consent, so **D8's retention reasoning does not extend to it** |
| 66 | **`user_media`** | D | User-uploaded content. **Confirmed to use the existing `website-images` bucket — no fourth bucket is needed**, so AC-4's bucket list is unchanged |

### 3.16 Resolved and corrected — the former "still unresolved" list

| Table | Earlier status | Resolved |
|---|---|---|
| `processed_webhook_events` | ❓ "does it carry `user_id`? If not it is global" | ✅ **It does carry one**, so the stated default did not apply. **Excluded anyway** — §8.12 |
| `payment_methods` | ❓ was the drop applied? | ✅ **Live** — #29 |
| `business_intake_forms` | ❓ does it exist? | ✅ **Live** — #37 |
| `websites` | ❓ does it exist? | ❌ **Absent** — #11 struck |
| `user_settings_complete` | ❓ FK target | **SA-resolved:** a view PostgREST reports as the FK target; the real target is `auth.users(id)` |
| Landing pages | ❓ separate table? | **SA-resolved:** no `landing` table exists; the `landing` surface is a `website_pages` row |

### 3.17 `supabase/SQL Scripts/` — disposition of every user-scoped table

| Table | Scoping | Disposition |
|---|---|---|
| `agent_prompt_threads` | `user_id` CASCADE | **In the "delete my agents" checkbox** (§10.3) |
| `agent_prompt_workflow_generation_sessions` | `user_id` | **Same** |
| `user_memory` | `user_id` CASCADE | **Same** — the user's own remembered preferences |
| `agent_memories`, `run_memories` | `user_id` | **Same — added by T1.** Both live and user-scoped, both absent from the checkbox until measured |
| `audit_trail` | `user_id` **SET NULL** | The third opt-in checkbox |
| `advisor_reports` | `user_id` + `org_id` | **Excluded** — org-analytics advisor, a different subsystem (§8.6) |
| `automation_slas` | `user_id` + `org_id` + `agent_id` | **Excluded** (§8.6) |
| `metric_baselines` | `user_id` + `org_id` | **Excluded** — agent-execution analytics, not `derived_metrics` (§8.6) |
| `group_metrics_rollup` | `user_id` / `org_id` | **Excluded** (§8.6) |
| `storage_usage` | `user_id` | **Excluded** — platform quota accounting (§8.5) |
| `agent_versions`, `usage_records`, `user_api_keys`, `contact_submissions` | named only by the removed `delete_user_by_id.sql` | ❌ **Measured ABSENT — genuinely phantom.** The intake-shaped `contact_submissions` caveat is **moot; nothing to rule on** |
| **`audit_logs`** | `user_id` | ⚠️ **Measured LIVE and user-scoped** — not phantom as earlier stated. No `CREATE TABLE` in either DDL directory and no `lib/`/`app/` reference. **Excluded (§8.12)**, flagged as a live table nobody owns (FU-18). **It is not `audit_trail`**, so the §10.3 activity-history checkbox does not cover it |

---

## 4. Indirect / second-degree data — and the compensating mechanism

| Risk | Table | Only reachable via | Mitigation |
|---|---|---|---|
| 🔴 | `website_blocks` | `page_id → website_pages` | CASCADE — verify live. **Child ids captured in the snapshot** so AC-5 is testable |
| 🔴 | `smart_link_clicks` | `smart_link_id → smart_links` | Same |
| 🔴 | `user_capability_blocks` | `user_capability_id → user_capabilities` | Same |
| 🔴 | **`agent_scheduler_state`** | `last_execution_id → agent_executions` | **B7.** `optional:agents`; `via`-scoped descriptor at `descriptors.ts:260` |
| 🟡 | `payment_reminders` | Also CASCADE from invoice/installment | Order-sensitive |
| 🟡 | `payment_plan_installments` | CASCADE from plan **and** subscription | Order-sensitive |
| 🟡 | `owner_insight_history` | CASCADE from `insights` | |
| 🟡 | `crm_activities` | CASCADE from `crm_contacts` | Deleted last regardless (T5) |
| 🟡 | **`daily_briefing_sends`** | Possibly CASCADE from `daily_briefings` | Confirm from the dump; if so, order it before the parent |
| 🟢 | `insights` children | Self-FK SET NULL | Cosmetic |

> **SA-S4 — the limit, and what covers it.** FR-1's enumeration, **even with the union predicate**, covers only **directly-tenanted** tables: a tenancy column by name, or an FK to `auth.users`. **It cannot see parent-scoped children**, and `agent_scheduler_state` is the proof — it has neither, and reaches its tenant only through `agent_executions`.
>
> **Parent-scoped children are enumerated by the blocking-edge / FK check, not by FR-1.** The two are **deliberately separate**: FR-1 answers *"is every tenant-owned table classified?"*; the FK check answers *"is every row reachable from a deleted parent accounted for?"*. Folding them together would hide exactly the case **B7** occupies — which is also why B7 was missing from §0.3's census until SA's review. Two questions, two oracles, neither sufficient alone.

---

## 5. Delete semantics already in the codebase

### 5.1 No soft-delete convention exists in Business OS

`status='deleted'` is a **kernel `agents`** convention; **no `deleted_at` column on any Business OS table**; three tables have unrelated `archived` states. Hence D4.

### 5.2 CASCADE from `auth.users` is partial and inconsistent

`business_profiles`, `crm_contacts`, `crm_activities`, `crm_pipeline_stages`, `payment_processors`, `payment_plans`, `payment_events`, `payment_automation_rules`, `onboarding_conversations`, `website_pages` declare the FK with **no ON DELETE clause** (= NO ACTION). "Delete the auth user and let CASCADE handle it" does not work — and is forbidden anyway (D3).

> Not theoretical: **16 `auth.users` FKs have no `ON DELETE` clause**, which is exactly why `/api/user/delete-account` 500s at its final phase for every onboarded user (§1.3).

> ⚠️ The [duplicate CRM migrations](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#3-crm) disagree about CASCADE **and about triggers** — both `update_crm_contacts_timestamp` and `update_crm_contacts_updated_at_trigger` exist live on `crm_contacts`, calling the same function. Both are `BEFORE UPDATE`, so a delete-only purge never fires them.

### 5.3 RLS makes this a service-role operation

**27 of the 110 user-scoped base tables have no `DELETE` (or `ALL`) policy at all** — the requirement had estimated "~20". The service role is **structurally required, not a convenience**, and that is what the documented RLS-bypass comment must say. Hence the §10.9 **delete-scoping** guard.

---

## 6. Ordering constraints & trigger hazards

### 6.1 Hard blockers — ten live constraints

**239 FKs, but only ten ordering constraints.** The full FK graph is cyclic and cannot be sorted; only `RESTRICT`/`NO ACTION` edges constrain a delete, and that subgraph is acyclic. A new CASCADE FK cannot invalidate this contract.

| # | Blocked delete | Blocked by | Must delete first |
|---|---|---|---|
| **B1** | `payment_transactions` | `payment_refunds_transaction_id_fkey` — **RESTRICT** | `payment_refunds` |
| **B2** | `scheduling_bookings` | `payment_plan_subscriptions_booking_id_fkey` — **RESTRICT** | `payment_plan_subscriptions` |
| **B3** | `kernel_executions` | `insight_automations_last_run_execution_id_fkey` — **NO ACTION** | `insight_automations` |
| **B4** | `crm_contacts` | **The mechanism is the trigger, not the FK.** The only FK between them is `scheduling_bookings_contact_id_fkey` (**SET NULL**), which does not block. `delete_future_bookings_on_contact_delete_trigger` deletes future bookings and so trips **B2** from a direction B2 alone does not name | `payment_plan_subscriptions` before `crm_contacts` |
| **B5** | `data_decision_requests` before `agents`? | ❌ **Does NOT materialize.** `fk_data_decision_requests_agent`, `…_execution` and `…_user` are all **CASCADE**. The `optional:agents` classification stands on its own merits, but it adds **no ordering constraint**. *Recorded as a negative result so it is not re-investigated* | — |
| **B6** | `agents` | `agent_logs_agent_id_fkey` — **NO ACTION**. Both tables are in the **"delete my agents"** opt-in, so ticking that checkbox fails unless `agent_logs` goes first. **Off by default — a default sweep never reaches it** | `agent_logs` |
| **B7** | `agent_executions` | `agent_scheduler_state_last_execution_id_fkey` — **NO ACTION**. Both `optional:agents`. **The child is not user-scoped**, so a user-scoped census cannot see it (§4) | `agent_scheduler_state` |
| — | 5 remaining blocking edges | Between `billing_events`, `boost_pack_purchases`, `user_rewards`, `credit_transactions`, `token_usage`, `user_subscriptions` — **all `never`** | Never constrain a purge. Recorded so a future reclassification knows it inherits an ordering problem |
| — | **`crm_activities` deleted last** | The single live T5 path | — |

The purge overrides these **by ordering**, never by altering a FK.

### 6.2 Triggers — from live definitions

**Only four DELETE-capable triggers exist in `public`.**

| # | Trigger | Fires on | Effect during a delete-only purge |
|---|---|---|---|
| T1 | `delete_future_bookings_on_contact_delete_trigger` | **BEFORE DELETE** on `crm_contacts` | Deletes **future** bookings only; past bookings keep `contact_id` SET NULL. **Source of B4** |
| T2 | `recompute_transaction_refund_state_trigger` | AFTER INSERT **OR DELETE** OR UPDATE on `payment_refunds` | UPDATEs `payment_transactions` **including `status`** |
| T3 | `propagate_refund_to_booking_trigger` | AFTER UPDATE on `payment_transactions` | UPDATEs `scheduling_bookings.payment_status` |
| T4 | `update_invoice_on_payment` | Transaction changes | **Unscoped** — `WHERE id = NEW.invoice_id` |
| **T5** | `log_*_activity` triggers | `AFTER INSERT OR UPDATE **OF status**` | ⚠️ **One live path only.** `payment_refunds` delete → T2 updates `payment_transactions.status` → `log_payment_activity_trigger` writes `crm_activities`. `log_booking_activity_trigger` watches `status`, but `propagate_refund_to_booking` writes `payment_status`, so it does **not** fire. `log_task_activity_trigger`, `log_email_activity_trigger` and `log_document_activity_trigger` are likewise unreachable |
| T6 | `ensure_user_code_on_insert` | BEFORE INSERT on `business_profiles` | Re-seed after Purge generates a **new** `user_code`; Reset keeps the row and the code |
| — | `trigger_update_storage_on_delete`, `trigger_update_storage_used` | AFTER DELETE on `storage_usage` | Inert — `storage_usage` is `never`. Noted because reclassifying it would start recomputing quota |

**T5 is handled by ordering, not suppression.** `crm_activities` is deleted **last**, as the final statement inside the RPC transaction. Suppression is **not available**: `ALTER TABLE … DISABLE TRIGGER` is table-owner-only and `SET session_replication_role = replica` is superuser-only.

### 6.3 Crons and public endpoints re-populate after commit

**The enumeration source decides whether a cron finds a business after a Reset** — this document previously got that wrong.

| Cron | Schedule | Enumerates tenants from | Returns after a **Reset**? |
|---|---|---|---|
| `calendar-sync` | 5 min | `business_profiles` (**K**) | ✅ **~5 min.** `calendar_last_synced_at` is retained and already stale |
| `channel-metrics-sync` | hourly :30 | `channel_connections` (**K**) | ✅ **Next scheduled sync, up to ~20 h.** `last_synced_at` is retained, so a Reset does not make the connection due |
| `insight-detect` | 15 min | `payment_invoices` · `scheduling_bookings` · `crm_contacts` · `business_events` — **all four `D`** | ❌ **No.** Only once the owner creates new data |
| `insight-metrics` | daily 03:00 | `D` tables | ❌ No |
| `insight-automations` | 5 min | `insight_automations` (**D**) | ❌ No |
| `payment-reminders` / `payment-retry` | daily 08:00 / hourly | `D` tables | ❌ No |

Plus two **public unauthenticated INSERT paths**: `website_page_views` and `smart_link_clicks`.

**Requirement implication (FR-14):** **Purge** removes the rows that make a business visible to every producer above. **Reset** deliberately keeps `business_profiles` and `channel_connections`, so what returns is calendar events and channel stats — **not insights**. FR-26 governs the copy.

> *Noted, not a change to this requirement:* each of `insight-detect`'s four enumeration selects carries `.limit(500)` with no pagination — a pre-existing tenant-coverage bug (FU-16).

---

## 7. Non-table state

| Kind | Item | Handled by |
|---|---|---|
| Storage | `contact-documents` (private), `website-images` (public, **also serves `user_media`**) — objects under `{auth.uid()}/…` | ✅ Both levels. **Non-transactional** — FR-22 |
| Storage | **`business-purge-snapshots`** (new, private, no RLS policy) | §10.7 |
| Queue | `payment_reminders`, `payment_automation_executions` | ✅ Rows only |
| Queue | `payment_refunds` pending rows — the reconciler's work queue | 🛑 **BLOCKS** (C2) |
| External | Live subscription schedules | 🛑 **BLOCKS** (C1) |
| External | Pending/uncaptured payments **and in-flight refunds** | 🛑 **BLOCKS** (C2) |
| External | Unpaid invoices owed to the business | 🛑 **BLOCKS** (C3) |
| External | Connect account, saved customers, calendar events | 📋 Reported, non-blocking |
| External | Emails already delivered | ❌ Irreversible |
| External | `subdomain` — the `*.agentpilot.io` rewrite | ✅ Purge frees it; **the name becomes claimable** — FR-25 |
| Platform | `plugin_connections` · agents+threads+sessions+memories · `audit_trail` | ⚙️ Opt-in, off by default (§10.3) |
| Platform | `profiles`, `auth.users` | 🚫 Never deleted (D3) — **and the existing delete-account route violates this** (§1.3, D11) |

---

## 8. The exclusion set — enumerated

> ⚠️ **Machine-readable input, not prose.** An `information_schema` enumeration **cannot distinguish "Business OS" from "kernel"**. AC-37 is only implementable if the engine holds an **enumerated known-and-excluded list** alongside its known-and-deleted list. Every row below becomes one descriptor at `level: 'never'`. **`never` is a claim about the schema, not a scheduling device** (§0.2.1).

### 8.1 Global catalogs — no `user_id`

| Table | Scope | Why |
|---|---|---|
| `capabilities` | `global` | Shared catalog, RLS off |
| `capability_building_blocks` | `global` | Same |
| `website_templates` | `global` | Public read; breaks website creation platform-wide |
| `intake_form_templates` | `global` | ❓ a DROP exists in `20260910_business_intake_forms.sql` |

### 8.2 Cross-tenant rows inside an in-scope table

| Table | Rule |
|---|---|
| `business_chat_plan_cache` **WHERE `user_id IS NULL`** | Portable rows shared by **all** tenants. Predicate must be `user_id = p_user_id`; **`<>`, `IS DISTINCT FROM` and `NOT IN` are forbidden** — the danger is a future "tidy-up" rewriting equality as exclusion. These surviving rows are also why a `planId` can recur post-purge (FR-24) |
| `business_chat_verified_questions` | ✅ **Checked — `user_id` is NOT NULL**, so it does **not** repeat the shape above. In scope as #61 |

### 8.3 Retained Business OS tables

| Table | Scope | Why |
|---|---|---|
| `email_unsubscribes` | `user_id`, `level: never` | D8 — third-party consent record |
| `user_preferences` | `user_id`, `level: never` | Account preference on a login that survives (D3); holds `preferred_language` |

### 8.4 Organisation / multi-user

| Table | Why |
|---|---|
| `organizations` | Every user gets a row via `get_or_create_user_organization`. ⚠️ Keys on `owner_user_id` — **the oracle gap** (§0.2) |
| `organization_members` | Deleting a membership can strand a multi-user org |

### 8.5 Billing & quota

| Table | Why |
|---|---|
| `subscriptions` | Billing state |
| `storage_usage` | Platform quota accounting |
| ~~`usage_records`~~ | ❌ **Measured absent.** The "if present" hedge resolves to *not present* |
| **`user_subscriptions`** | Owner-ruled `never` — the platform's own commercial record |
| **`subscription_invoices`** | Same |
| **`billing_events`** | Same |
| **`credit_transactions`** | Same |
| **`boost_pack_purchases`** | Same |

> Five blocking edges sit entirely between these tables; recorded so a future reclassification of any billing table knows it inherits an ordering problem.

### 8.6 Org analytics (a different subsystem)

| Table | Why |
|---|---|
| `advisor_reports` | Org-analytics advisor, not Business OS Insights |
| `automation_slas` | Workflow/agent SLAs |
| `metric_baselines` | Agent-execution analytics, not `derived_metrics` |
| `group_metrics_rollup` | Workflow-group analytics |

### 8.7 Kernel / V6 learning — ✅ closed and confirmed live

| Table | Live | `user_id`? | Status |
|---|---|---|---|
| `calibration_history` | ✅ | ✅ | Active exclusion — `20260428_calibration_history_table.sql` |
| `error_patterns` | ✅ | ✅ | Active — `20260629_error_patterns_table.sql` |
| `execution_anomalies` | ✅ | ✅ | Active |
| `execution_baselines` | ✅ | ✅ | Active |
| `plugin_performance` | ✅ | ✅ | Active — `20260629_plugin_performance_table.sql` |
| `intent_examples` | ✅ | ❌ | **Inert** — never enumerated. Kept as documentation |
| `behavior_rules` | ❌ absent | — | **Inert** — an exclusion matching nothing |
| `execution_model_tracking` | ❌ absent | — | **Inert** |
| `workflow_patterns` | ✅ | ❌ | ✅ Created by `20260629_platform_learning_tables.sql`; **no `user_id`**, so structurally outside FR-1's reach — **no descriptor needed** |
| `global_failure_patterns` | ✅ | ❌ | ✅ Same |

### 8.8 Platform identity

| Table | Why |
|---|---|
| `admin_users` | Locks admins out — **and is the authorisation source for the internal surface (D12)** |
| `profiles` | D3 |
| `auth.users` | D3 — never deleted, at any level, under any option |

### 8.9 Confirmed phantom — no descriptor needed

❌ `agent_versions` · `usage_records` · `user_api_keys` · `contact_submissions` · `websites` · `insight_outcomes` — **all measured absent.** The intake-shaped `contact_submissions` caveat is **moot**.

### 8.10 Agent / workflow platform (kernel)

All ✅ live, all `level: 'never'`.

| Table | Reasoning |
|---|---|
| `agent_configurations` | Kernel agent config |
| `agent_execution_logs` | Kernel execution telemetry |
| `agent_templates` | Template catalog |
| `agentkit_analytics` | Platform analytics |
| `calibration_sessions` | Kernel calibration (`CalibrationSessionRepository`) |
| `workflow_executions` | Kernel execution records |
| `pilot_step_routing_history` | Orchestration routing telemetry |
| `shadow_failure_snapshots` | Kernel failure capture |
| `shared_agents` | Agent sharing (`SharedAgentRepository`) |
| **`agent_stats`**, **`agent_intensity_metrics`** | **Base tables, not views** — BA suspected views, the dump proved otherwise |
| `execution_insight_runs`, `execution_insights` | ⚠️ **The *other* "insights" system** (`lib/pilot/insight/**`) — an agent's execution quality, not the owner's business. [The name collision is the single most common mistake in this area](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md#1-scope--the-name-collision) |
| `data_decision_requests` | `optional:agents` — orphaned rows pointing at deleted agents. **B5 proved it adds no ordering constraint** |

### 8.11 Token accounting

`token_usage` — `level: 'never'`. Platform metering, and the substrate billing is computed from.

`archive_runs` — `level: 'never'`, global scope (added 2026-09-26, Admin Archiving slice 2). The platform's run log of archiving: counts, cutoffs and the admin who ran it. No `user_id` and no business content. Its partner `archived_records` is **not** excluded: it rides the activity-history checkbox with `audit_trail` (§10.3), with `snapshot: 'ids'` because archived history is the long tail. See [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md) C-4.

### 8.12 Account configuration and unowned tables

All `level: 'never'`. **Reasoning is the `user_preferences` precedent (§3.14):** settings attached to a login that **survives every level** (D3).

| Table | Reasoning |
|---|---|
| `notification_settings` | Account config. ⚠️ The retired `/api/user/delete-account` deletes it — someone once treated it as personal data. That route is being retired precisely because its choices were wrong |
| `security_settings` | Same |
| `api_keys` | The user's own API credentials. Deleting them by default breaks integrations the user did not ask to break — the reasoning that makes `plugin_connections` an opt-in checkbox |
| `user_rewards` | Loyalty/credit balance — billing-adjacent |
| `audit_logs` | ⚠️ Live, user-scoped, **created by no migration and referenced by no code** (§3.17). Excluded because nothing is known about it — the conservative direction. **FU-18: how did it get there?** |
| `processed_webhook_events` | Carries `user_id`, so §3.16's planned default did not apply. **Excluded anyway:** it is webhook idempotency state, and `20260828_webhook_event_status.sql` exists because a consumed-but-failed event is a **money bug**. Deleting a user-scoped row mid-flight could let Stripe replay a webhook against a business that no longer exists |

### 8.13 Confirmed views — no descriptor needed

`active_plugin_connections` · `agent_executions_with_details` · `agent_memory_stats` · `daily_token_usage` · `monthly_token_usage` · `top_complex_agents` · `website_analytics_summary`.

> BA listed eight suspected views; **six confirmed, two were base tables** and moved to §8.10. The over-classification argument held: **no classification work was invalidated**, because a `never` descriptor on a view is inert while a missing descriptor on a base table fails the run closed.

---

## 9. Product decisions (D1–D12)

| # | Decision | Ruling | Slice |
|---|---|---|---|
| **D1** | Audience | **Both** — a customer-facing "delete my business" *and* the owner's test cycles. BA recommended test-only | **5** |
| **D2** | Levels | **Reset** and **Purge**, per §10.2 | 2, 3 |
| **D3** | Non-BOS data | **None by default**; three opt-in checkboxes off by default. **`auth.users` never deleted** | 3 |
| **D4** | Reversibility | **Hard delete + pre-purge JSON snapshot.** No soft delete, no undo | 2 |
| **D5** | Surfaces | **Two surfaces, one engine**, caller's own session user only. No admin-purge-of-another-business in v1 | 1, 5 |
| **D6** | External state | **Pre-flight gate, then report.** Blocks on C1/C2/C3; never calls a provider cancel API in v1 | **4** |
| **D6a** | Gate scope | **Hard block on both surfaces. No override, no bypass flag** | 4 |
| **D6b** | In-flight refunds | `payment_refunds.status='pending'` folds into **C2** | 4 |
| **D7** | Grace period | **None.** Immediate on typed confirmation | 2 |
| **D8** | `email_unsubscribes` | **RETAINED on both levels.** BA proposed deletion; SA overruled because `auth.users` survives (D3), so the same `user_id` can re-onboard and resume emailing people who opted out. **The customer copy must not claim total erasure** (FR-23) | 2 |
| **D9** | Customer surface | **FLAG-GATED** behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`, off by default. Un-gating requires **AC-2, AC-5, AC-10, AC-13, AC-16, AC-24, AC-37** demonstrated on a real account. ⚠️ **Amended by D12** | 5 |
| **D10** | Stripe key | **No read-only credential exists today** — only `STRIPE_SECRET_KEY` (53 references). Provisioning `STRIPE_RESTRICTED_KEY_READONLY` is a Vercel-env task, **same blocker shape as `CRON_SECRET`**. Until it lands **the gate runs on the fully-privileged key — a known, time-boxed state.** FU-12 | 4 |
| **D11** | **The existing "Delete account" button is IN SCOPE** | The user **rejected** replacing it with a support-request message — self-service erasure stays. **Dev decides and justifies between (a)** reuse the existing button and build the correct functionality behind it, or **(b)** build the new surface and formally deprecate the old button. ⚠️ **Four callers, two live**, on two surfaces split by `uiVersion` routing — so "reuse the button" must name *which*. Either way the route's current behaviour must not survive this cycle | 5 |
| **D12** | **Internal-surface authorisation → `AdminAccessService`** | SA **retracted** its first-pass approval of an "unflagged" internal surface. `/test-business-os` is on the middleware skip-onboarding list with **no admin gate** and the page gates on `useAuth()` only — so an unflagged internal Purge would be **reachable by every signed-in customer who knows the URL**, making D9's staging a fiction. Control is **server-side on the preview and commit routes**, not on tab visibility — a `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary. **Per CLAUDE.md § Security Rules, `profiles.role` must never be used** — it is user-writable and self-promotable; `admin_users` is the only trusted admin signal. Call **`isAdmin({ id, email })`**, not `isAdminById` — the latter checks only already-bound `user_id`s and would deny a legitimately seeded admin | 1 |

### BA's position on D8, preserved

BA proposed deleting `email_unsubscribes`, reasoning that a purged business cannot send. **That premise was wrong** — D3 keeps `auth.users`, so the same login re-onboards under the same `user_id`. SA's overrule is correct and BA does not contest it.

### ⚠️ Residual risk

1. **TOCTOU** — narrowed to one round-trip under the RPC shape; both gate timestamps logged (FR-19).
2. **Non-blocking residue** — calendar events, Connect account, Stripe customers.
3. **Liveness** — a Stripe outage means you cannot delete. A refusal, never a false pass.
4. **`email_unsubscribes` and `user_preferences` survive** — the copy must be honest (FR-23).
5. **The gate runs on a fully-privileged key** until FU-12 lands (D10).
6. **A broken customer-facing delete path ships today** until D11 resolves (§1.3).

---

## 10. Requirement — FRs and ACs

### 10.1 Users & user stories

- As a **business owner**, I want to delete my business and all its data, and be told plainly what is kept and why.
- As a **business owner**, I want the platform to stop me if deleting would leave my clients being charged, or a refund owed to them in limbo.
- As a **business owner**, I want to know exactly which Stripe items to resolve and where.
- As the **product owner testing Business OS**, I want to wipe my business and immediately re-run a scenario without redoing onboarding or reconnecting OAuth.
- As a **developer**, I want the purge to fail loudly if the live schema or Stripe does not answer cleanly.

### 10.2 The two levels

| | **Reset** | **Purge** |
|---|---|---|
| **Pre-flight gate** | Applies — identical | Applies — identical |
| `business_profiles`, `crm_pipeline_stages`, `user_capabilities` (+blocks) | Kept | Deleted |
| `user_intake_settings`, `business_intake_forms` | Kept | Deleted |
| `payment_processors`, `stripe_connect_accounts` | Kept | Deleted |
| `channel_connections` | Kept | Deleted |
| **`email_unsubscribes`, `user_preferences`** | **Kept** | **Kept (D8 / §3.14)** |
| All other §3 tables | Deleted | Deleted |
| Storage buckets | Emptied | Emptied |
| Re-run tests without onboarding? | **Yes** | No |
| What returns on a timer | Calendar events (~5 min), channel stats (next sync, up to ~20 h). **Not insights** — FR-26 | Nothing — all producers starved |

**Re-seed divergence:**

1. **`user_code` / `subdomain`.** Reset keeps them, so `/c/{userCode}` links and the public address still resolve. Purge releases both; a re-seed fires T6 and generates a **new** `user_code`, and the subdomain becomes claimable (FR-25).
2. **Intake — now firm, not contingent.** `business_intake_forms` is **live** (T1). The **settings** half was always firm: `user_intake_settings` (#36) comes from an older migration, so Reset keeps the business's intake configuration regardless. The **forms** half is now equally firm: Reset keeps the `draft` and `published` rows (one each, partial unique indexes) so re-testing needs no regeneration, and **Purge loses archived versions and with them the readability of old submissions**. **AC-3's intake assertion is unconditional and must be tested.**
3. **Capabilities.** Reset keeps the dashboard's tabs; Purge returns to pre-onboarding state.
4. **Stripe.** Reset keeps Connect, so test payments work immediately.

### 10.3 Opt-in extras (all off by default)

| Checkbox | Deletes | Default |
|---|---|---|
| **Also disconnect integrations** | `plugin_connections` | Off |
| **Also delete my agents** | `agents`, `agent_executions`, `agent_logs`, `agent_memory`, `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions`, `user_memory`, **`agent_memories`**, **`run_memories`**, `agent_scheduler_state`, `data_decision_requests` | Off |
| **Also delete my activity history** | `audit_trail` rows for this user, **and their archived copies in `archived_records`** (added 2026-09-26, Admin Archiving) | Off |

> **`agent_memories` and `run_memories` were added from T1** — both live and user-scoped, both absent from this list until measured. A checkbox labelled "delete my agents" that leaves the user's own agent memory behind is the same defect that added `agent_prompt_threads`. **B6 (`agent_logs` before `agents`) and B7 (`agent_scheduler_state` before `agent_executions`) are engaged only by this checkbox**, which is off by default — so a default sweep never exercises them.

Constraints:
- `auth.users` / `profiles` never deleted, under any combination.
- **Purge always deletes `channel_connections`** regardless of the integrations checkbox.
- With the audit checkbox ticked, the audit record of *this* purge is still written afterwards.
- **The gate runs before every deletion including the extras** — `plugin_connections` is one of the two sources of a Stripe account id (AC-33).

### 10.4 The two surfaces, one engine

| | `/test-business-os` → Danger Zone | Account settings → Delete my business |
|---|---|---|
| **Authorisation** | **`AdminAccessService` (`admin_users`), server-side on the routes (D12)** | `getUser()`, session user only |
| Flag | No `NEXT_PUBLIC_` flag — the admin check is the boundary | **`NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`, off by default (D9)** |
| Target | Caller's own session user only | Caller's own session user only |
| Levels | Reset **and** Purge | Purge |
| Gate | Enforced, no override | Enforced, no override |
| Copy | Technical; table names and counts | Plain language, localised, no table names |
| Dry-run | Mandatory | Mandatory |
| Confirmation | Type the business name | Type the business name |

**Neither surface accepts a `user_id` from the client.** Tab visibility is never the control — it renders only after the server check resolves.

### 10.5 Pre-flight external-state gate

#### 10.5.1 Blocking conditions

| # | Condition | Why it blocks | Local signal |
|---|---|---|---|
| **C1** | Active recurring subscription schedules | Stripe executes the schedule; deleting the local record leaves clients charged with nothing recording it | `payment_plan_subscriptions.status ∈ {pending, active, past_due, paused}` |
| **C2** | Pending/uncaptured payments **and in-flight refunds** | Money in flight either way. A pending refund is money owed **back to a client** | `payment_transactions.status='pending'`; `payment_refunds.status='pending'` |
| **C3** | Unpaid invoices owed to the business | The owner loses the record of money owed to them | `payment_invoices.status ∈ {sent, overdue}` |

> **C3 — a deliberate decision.** BA assessed it as different in kind: an unpaid invoice is the business's **own** loss. The owner saw that reasoning and chose to block anyway. FU-1a is the cheapest softening.

#### 10.5.2 Enumerate from the provider; Reset gated identically

**From Stripe, not from local rows.** A schedule or refund created in the Stripe dashboard has no local row.

**Multi-account.** `resolveUserConnectAccounts()` returns a **list**, warning when the two sources differ. Every read carries `stripeRequestOptions()` / `stripeAccount` — these are **direct charges on connected accounts**, and a platform-scoped read returns "no such object": a **false all-clear**.

**Reset is gated identically.** Reset keeps Connect but deletes subscriptions, transactions, invoices, refunds and reminders — so the business keeps trading while Stripe keeps charging and settling, with the local mirror gone, producing **silently wrong books**.

#### 10.5.3 Failure and absence semantics

| Situation | Behaviour |
|---|---|
| Provider unreachable / error / timeout / budget exceeded | **Fail closed — refuse.** Per `stripeAccountContext.ts`: *"A failed read is not a 'no'… so it refuses, loudly"* |
| **No Stripe connected** | **Skipped cleanly.** Not a failure, no warning |
| Account revoked / "does not exist" | Provider failure → fail closed |
| Multiple accounts | Check all; any blocking state blocks |

#### 10.5.4 Placement and TOCTOU

Evaluated **inside the dry-run**, and **re-evaluated immediately before the RPC**. v1 accepts the residual window; both timestamps are logged (FR-19).

#### 10.5.5 What the block tells the user

Per condition: what was found, how many, and the id to search for in Stripe (subscription / schedule / payment-intent / **refund** / invoice).

### 10.6 Dry-run preview and confirmation

1. A destructive run is reachable only after a dry-run in the same session, same target, level and options, carrying the same `correlationId` (FR-21).
2. The dry-run returns gate outcome, per-table counts, per-bucket object counts, non-blocking provider items, and any table FR-1 could not verify.
3. If the gate blocks, **no confirmation is offered**.
4. Confirmation requires typing the business name.
5. Material count drift is **reported**, not hidden.
6. No grace period (D7).

### 10.7 Pre-purge snapshot

1. Written before any deletion: every row to be deleted keyed by table, **plus the child ids of `website_blocks` / `smart_link_clicks` / `user_capability_blocks` / `agent_scheduler_state`**, the gate result, and the non-blocking provider inventory.
2. **Location:** private bucket `business-purge-snapshots`, `public = false`, `{user_id}/{iso8601}.json`. **No storage RLS policy granting `authenticated` anything**, no read route, no signed-URL helper. Service role only.
3. **Retention is a mechanism: 7 days, with a shipped enforcer.** If the enforcer does not ship, the customer-path snapshot carries counts and row ids only — **no contact PII**.
4. **"Verified" means write-then-read-back.**
5. **Snapshot failure aborts the run** with zero rows deleted.
6. Forensic artefact, **not** a restore path.

### 10.8 Functional requirements

1. **Schema verification — route (a).** A **`SECURITY DEFINER` RPC** returning `information_schema.columns` + `pg_constraint` + `pg_trigger` + `pg_policies`, consumed **at run time**. Route (b), a build-time manifest, was rejected: it cannot detect a table added after the manifest was committed. Conditions: **(i)** `EXECUTE` granted to **`service_role` only, never `authenticated`** — a SECURITY DEFINER function returning `information_schema` is a schema-disclosure endpoint if browser-callable; **(ii)** the engine holds §8's **enumerated** exclusion descriptors; **(iii)** it **fails closed** when an expected table is missing, or a user-scoped table is in neither set. **(iv) The enumeration predicate is the union** — a tenancy column by name (`user_id`, `owner_user_id`) **OR** any FK referencing `auth.users` — because a name allow-list alone closes today's gap and not tomorrow's, and an FK test alone misses tenancy columns with no declared constraint. Its cost is ~9 extra `never` descriptors; its bound is §4.
2. Operates on exactly one business, `user_id` from `getUser()`. **No client-supplied id accepted.**
3. Two levels per §10.2 and the **R** column.
4. Three opt-in extras, off by default, per §10.3.
5. **Pre-flight gate before any deletion, both levels, both surfaces, no override.** Blocks on C1, C2 (charges **and** refunds), C3.
6. The gate enumerates **from the provider across all connected-account candidates**, every read scoped with `stripeAccount`.
7. The gate **fails closed** on any provider error, timeout, 429-after-retry, or exceeded budget.
8. The gate is **skipped cleanly** when no Stripe account is connected.
9. The gate result appears **in the dry-run**; a blocked outcome suppresses confirmation.
10. The gate is **re-evaluated immediately before the RPC**; both must pass.
11. Typed confirmation of the business name. No grace period.
12. Pre-purge snapshot written, **read-back verified**, child ids captured (§10.7).
13. Covers every §3 table appropriate to the level, all storage buckets, and reports orphan counts for the four parent-scoped tables.
14. **Purge** starves the six crons and two public INSERT paths; **Reset** does not, and says so (FR-26).
15. Respects **B1, B2, B3, B4, B6 and B7**; **never alters a FK definition**. The order is derived from the live `pg_constraint` dump, not from migration files.
16. Never touches the §8 exclusion set or the portable `business_chat_plan_cache` rows.
17. **T5 residue prevented by ordering** — `crm_activities` deleted last inside the RPC.
18. **Three-phase execution:** **(1)** gate + snapshot in TypeScript, no transaction, all reads through repositories; **(2)** destructive commit as **one `SECURITY DEFINER` RPC** `purge_business_data(p_user_id uuid, p_level text, p_options jsonb)` returning per-table counts as JSONB; **(3)** storage removal, report, audit. **Resume is rejected.** Engine in **`lib/business-os/purge/`**.
19. Structured result: gate outcome, rows per table, storage objects deleted **and any that failed**, tables skipped and why, non-blocking provider state, snapshot path, **both gate timestamps and the commit timestamp**, duration.
20. Every run — **including blocked attempts** — written to the audit trail with actor, target, level, options, gate outcome, counts, snapshot path and timestamps.
21. **`correlationId` carried from the dry-run into the commit**, not regenerated.
22. **Storage removal is non-transactional.** It runs after the DB commit. Partial failure **reports per-object failures and surfaces the residue; it does not fail the run**.
23. **The customer copy must not claim total erasure.** `email_unsubscribes` and `user_preferences` survive. Required sentence, localised: *"People who asked you to stop emailing them are kept, so they won't be emailed again if you come back."*
24. **Duplicate-send re-arm: accepted, and documented.** `business_chat_action_log` is deleted; keys are **not** retained. `ActionLog.ts:47` builds `sha256(planId|stepId|itemId ?? '-')`. Where `itemId` is present it is an entity row id re-created post-purge with a **new UUID**, so the key is not reproducible. Where absent it reduces to `planId|stepId`, and a `planId` from the **portable** `business_chat_plan_cache` rows (§8.2) **is** reproducible — so the re-arm is real but confined to item-less, plan-level actions. **In exactly that case re-arming is correct:** a business that wiped its data should be able to send its welcome sequence again. The note appears on the **internal** surface's result only.
25. **Subdomain release is stated.** Purge frees `business_profiles.subdomain`; the old URL may later serve a **different** business. The result copy says so.
26. **Reset's post-state is not presented as permanent — and the UI must name the right things.** Reset keeps `business_profiles` and `channel_connections`, so **`calendar-sync` repopulates `external_calendar_events` within about five minutes** (it enumerates via `business_profiles`, and the retained `calendar_last_synced_at` is already stale), and **`channel-metrics-sync` repopulates `channel_metrics_daily` on that connection's next scheduled sync — up to ~20 hours**, because `channel_connections.last_synced_at` is retained and a Reset does not make the connection due. **Insights and metrics do not return on a timer:** `insight-detect` enumerates tenants from `payment_invoices` / `scheduling_bookings` / `crm_contacts` / `business_events`, all of which Reset deletes, and `insight-metrics` and `insight-automations` likewise read `D` tables — so they rebuild only once the owner creates new data. The UI must say this and **must not promise insights within 15 minutes**.
27. **Post-purge destination is specified.** After Purge, `business_profiles` is gone and the middleware onboarding gate routes the account into the onboarding wizard. The customer must not be silently dropped into "let's set up your business".
28. **Double submission is a provable no-op.** A second concurrent run returns "already running". Mechanism: **`pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` taken inside `purge_business_data`**, released automatically at COMMIT or ROLLBACK, with no unlock call that can leak. The pre-existing `pg_try_advisory_lock` wrapper (`supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`) is **deliberately not used**: it is session-scoped, and `supabase-js` speaks PostgREST over a pooled connection, so it yields both false passes (a concurrent call served by another backend does not observe the lock) and permanent false blocks (a run that dies leaves the lock held on a connection handed to unrelated traffic). No new DDL beyond the purge RPC itself.
29. **Both routes validate input with Zod before any business logic** (mandatory rule 2).
30. `auth.users` and `profiles` are never deleted. ⚠️ **The existing `/api/user/delete-account` route violates this today** — D11 resolves it.
31. **No bypass flag, env var, query parameter or internal route may skip the gate** (D6a). The D9 flag hides the **surface**, never the **gate**; and per D12 the internal surface's boundary is server-side authorisation, not flag or tab visibility.
32. 🆕 **Classification snapshot and drift control.** The classification set is **snapshotted at each slice boundary** — table name, level, scope predicate. Any descriptor whose **level changes between slices fails the invariant test** until the change carries an explicit review note naming the evidence that justified it. **Adding a new table is not drift** — that is FR-1 working; **changing an existing table's level is.** `never` is a claim about the schema, not a scheduling device (§0.2.1).

> **Note (was FR-27, relaxed by SA):** with `user_preferences` retained on both levels, resolving the owner's language before phase 2 is no longer load-bearing. Sensible ordering, not a requirement.

### 10.9 Non-functional requirements

- **Security — delete scoping (the guard that matters).** FR-2 / AC-28 already forbid a caller-supplied `user_id`, stronger than an ownership pre-check. The real service-role risk: **a purge is one missing `WHERE user_id = …` away from `DELETE FROM crm_contacts` platform-wide** — §1.2 shows a script that had that defect. Required:
  - One **declarative descriptor** per table — table, level (`reset` / `purge` / `never` / `optional:<checkbox>`), scope (`user_id`, `via: { parent, fk }`, `global`). **The executor iterates only that structure.**
  - **§8's exclusions are `level: 'never'` rows**, not prose — FR-1 cannot otherwise distinguish unknown from excluded.
  - A **unit test asserts the structural invariant**: every descriptor has a non-`global` scope or is `level: 'never'`, and **no delete is emitted without a scoping predicate**.
  - **Capability filters operations, never tables** (AC-37b).
  - `business_chat_plan_cache` carries `user_id = p_user_id`; **`<>` / `IS DISTINCT FROM` / `NOT IN` forbidden**.
  - **RPC parameters prefixed `p_`**, never sharing a name with a column they filter on (§1.2).
  - The two unscoped triggers filter by `id`. Safe **provided no FK crosses tenants** — AC-24 tests that empirically.
  - The RLS bypass is documented in code per CLAUDE.md § Security Rules, and must state that **27 of 110 tables have no DELETE policy**, so the service role is structurally required.
- **Security — authorisation boundary (D12).** Server-side on the preview and commit routes, via `AdminAccessService` / `admin_users`, calling **`isAdmin({ id, email })`**. **`profiles.role` must never be used.** A `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary.
- **Security — provider credentials.** **(a) No read-only Stripe credential exists;** the gate runs on the full-privilege `STRIPE_SECRET_KEY` — acceptable for v1 because the gate's surface is `list`/`retrieve` on an authenticated path, but **stated, not assumed** (D10, FU-12). **(b) No existing Stripe client to reuse** — 18 files in `lib`+`app` each call `new Stripe(...)` (47 sites repo-wide, 13 unpinned across 7 files). Dev creates `lib/stripe/client.ts` with **one pinned `apiVersion`**; two versions are live in the tree (`2025-10-29.clover` and `2024-12-18.acacia`) so pin the newer and comment that a second exists. **Unbudgeted work the workplan must carry.** Do not migrate the other call sites this cycle.
- **Resilience — gate bounds (exceeding any bound is a refusal, never a truncated pass).** Three of four conditions use list endpoints with **no status filter**, so each is a **paginated traversal of account history**.
  1. **Time-window every unfilterable traversal** — `created: { gte: now − N days }`, N justified per condition.
  2. **Hard page cap and hard wall-clock budget — ≤ 10 s for the entire gate.** Exceeding either is a **fail-closed refusal with a distinct message**. Silently truncated results would be a false all-clear.
  3. **`export const maxDuration`** set explicitly on both routes, above the gate budget.
  4. **Retry is global, not per-read** — ≤2 for the whole gate.
  5. **429 is not a "no"** — retry, then refuse.
  6. **Cache the dry-run gate result for the session.**
- **Atomicity.** Per FR-18.
- **Duration & progress (customer path).** The workplan specifies the progress signal and the timeout message.
- **Rate limiting.** Both destructive routes rate-limited.
- **Data protection (customer path).** Residue is a compliance failure, not cosmetic.
- **Logging.** Pino, `correlationId` continuous across dry-run and commit. No `console.*`.
- **Repository pattern.** **Every read** in phase 1 goes through repositories. The RPC is the destructive commit only — the documented exception, rule-7 signed off.
- **Performance.** Set-wise deletes inside the RPC.
- **Accessibility.** Keyboard-operable dialogs; **blocked state announced to assistive technology, not conveyed by colour alone**.
- **Copy quality.** Plain language, localised via `LanguageContext` (en/es/he). Must include FR-23's retention sentence, FR-25's subdomain sentence and FR-26's corrected Reset copy.

### 10.10 Acceptance criteria

**Completeness**

- [ ] **AC-1** Dry-run on a seeded business returns non-zero counts for contacts, bookings, invoices, activities, insights.
- [ ] **AC-2** After a **Purge**, all §3 tables return **0 rows** for that `user_id`, **except `email_unsubscribes` and `user_preferences`**, which must be non-zero if they were non-zero before.
- [ ] **AC-3** After a **Reset**, every **K**/**K\*** table retains its rows and every **D** table returns 0. **Includes `business_intake_forms` — unconditional (T1).**
- [ ] **AC-4** After either level, both content buckets (`contact-documents`, `website-images`) contain no objects under that user's folder.
- [ ] **AC-5** **Orphan scan:** the child ids of `website_blocks`, `smart_link_clicks`, `user_capability_blocks` and `agent_scheduler_state` are **captured in the snapshot before the delete**, and after the Purge **those specific ids** are absent. The captured id set must be **non-empty and of known count**, or the assertion passes vacuously.

**The pre-flight gate**

- [ ] **AC-6** **C1** — active subscription schedule → refused on both levels and surfaces, zero rows deleted.
- [ ] **AC-7** **C2 (charges)** — pending/uncaptured payment → refused, zero rows deleted.
- [ ] **AC-8** **C2 (refunds)** — a `payment_refunds` row in `status='pending'`, and an unsettled refund at Stripe, each → refused, zero rows deleted.
- [ ] **AC-9** **C3** — unpaid (sent/overdue) invoice → refused, zero rows deleted.
- [ ] **AC-10** **Fail-closed:** Stripe stubbed to error/timeout → **refused**, zero rows deleted. *(D9 un-gating condition.)*
- [ ] **AC-11** **No Stripe connected** → completes normally, gate recorded as skipped, **no error or warning surfaced**.
- [ ] **AC-12** **Gate in the preview** — a blocked business returns the blocked outcome from the **dry-run**; the confirmation input is never offered.
- [ ] **AC-13** **Dashboard-created state is caught** — a schedule at Stripe with no local row, and a dashboard-issued refund with no local row, each block. *(D9 un-gating condition.)*
- [ ] **AC-14** **Multi-account** — blocking state on **either** candidate blocks; a connected-account object is not missed by a platform-scoped read.
- [ ] **AC-15** **No override** — no parameter, header, env var, route variant **or the D9 flag** permits a run while the gate blocks.
- [ ] **AC-16** The blocked message names, per condition, the count and the Stripe-side identifiers — including refund ids. *(D9 un-gating condition.)*
- [ ] **AC-17** **Gate budget** — a stubbed account exceeding the page cap or the 10 s budget → **refused** with the distinct budget message, never a truncated pass.
- [ ] **AC-18** Blocked attempts are written to the audit trail.

**The deletion traps**

- [ ] **AC-19** A business with `payment_refunds` and `payment_plan_subscriptions` rows (both in **non-blocking terminal** states) purges successfully — proves **B1**, **B2**, no FK altered.
- [ ] **AC-20** A `kernel_executions` row referenced by `insight_automations.last_run_execution_id` purges successfully — proves **B3**.
- [ ] **AC-21** **B4** — a `payment_plan_subscriptions` row whose `booking_id` points at a **future** booking of a contact being deleted purges successfully.
- [ ] **AC-22** After a **Purge**, `crm_activities` is empty — proves the single live T5 path left no residue.
- [ ] **AC-23** After a **Purge**, every §8 table is unchanged — the four global catalogs, `organizations`/`organization_members`, billing, org analytics, the §8.7 kernel tables, §8.10's agent platform, `token_usage`, and §8.12's account config — **and `business_chat_plan_cache WHERE user_id IS NULL` matches on both row count and a content checksum** (a count alone survives a delete-and-reinsert).
- [ ] **AC-24** A **second, different** business is completely unaffected — full cross-tenant sweep. *(D9 un-gating condition.)*
- [ ] **AC-25** **Purge** leaves no row causing the six crons to pick this business up. **Each cron's selection predicate is named in the workplan.**
- [ ] **AC-26** After a **Reset**, the UI states that calendar events resync within minutes, that channel stats refresh on their next scheduled sync, and that insights and metrics rebuild once new data is created. A later cron regenerating any of them is **not** a failure.
- [ ] **AC-27** A public `POST` to the page-view or smart-link-click endpoint after a **Purge** cannot create a row attributable to the deleted business.

**Safety & surfaces**

- [ ] **AC-28** The purge cannot be invoked for another `user_id` — body, header and query, on both routes.
- [ ] **AC-29** A destructive commit is rejected without a prior matching dry-run in the same session.
- [ ] **AC-30** A destructive commit is rejected when the typed name does not match.
- [ ] **AC-31** With all checkboxes **off**, `plugin_connections`, agents-and-friends and `audit_trail` are untouched; `auth.users` / `profiles` untouched in all cases.
- [ ] **AC-32** With integrations **off**, a **Purge** still deletes `channel_connections`.
- [ ] **AC-33** With integrations **on**: *(ordering half, slice 3)* `plugin_connections` is read for account resolution **before** deletion; *(provider half, slice 4)* the gate still runs correctly and does not produce a false all-clear.
- [ ] **AC-34** With **Also delete my agents** on, `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions`, `user_memory`, `agent_memories`, `run_memories` and `agent_scheduler_state` are all removed, and **B6/B7 ordering holds**.
- [ ] **AC-35** A failed snapshot write aborts with zero rows deleted; a snapshot that writes but fails **read-back** does the same.
- [ ] **AC-36** The snapshot bucket has **no** policy granting `authenticated` any access, and no route returns its contents.
- [ ] **AC-37** **Schema completeness** — the engine fails closed when an expected table is absent **and** when a user-scoped table exists in neither the delete set nor §8's enumerated exclusion set. **The FR-1 RPC is not executable as `authenticated`.** *(D9 un-gating condition.)*
- [ ] **AC-37b** 🆕 **Capability filters operations, never tables.** For every declared capability, the executor's resolved table list is **exactly** the descriptor set filtered **by level only, with no capability term in the comparison**.
- [ ] **AC-37c** 🆕 **Classification drift.** A descriptor whose level changes between slice snapshots **fails the invariant test** until the change carries a review note. Adding a table does not trip it.
- [ ] **AC-38** **Double submission** — two concurrent runs for the same user: the second returns "already running"; exactly one purge occurs. **The lock is transaction-scoped** — a run that dies leaves no lock held.
- [ ] **AC-39** **Zod** — malformed bodies rejected with 400 before any business logic, on both routes.
- [ ] **AC-40** **Authorisation and flag.** With `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` off, the customer surface is unreachable **and no other surface in the application offers Reset or Purge to a non-admin.** A non-admin calling the preview or commit routes for the internal surface or the Reset level receives **403 regardless of what the client renders** (D12).

**Behaviour after**

- [ ] **AC-41** After a **Reset**, the full test flow (contact → service → booking → invoice → payment) runs again without re-onboarding or reconnecting.
- [ ] **AC-42** After a **Purge**, re-seeding via `/api/onboarding/build` yields a working business with a **new** `user_code` (T6), documented in the result copy.
- [ ] **AC-43** The result names the non-blocking provider state left behind, **the retained `email_unsubscribes` / `user_preferences` (FR-23)**, and **the subdomain becoming claimable (FR-25)**.
- [ ] **AC-44** After a **Purge** on the customer surface, the user lands on the specified destination with the specified message — not silently in the onboarding wizard.

**Engineering**

- [ ] **AC-45** **Structural invariant** — the descriptor unit test fails when a descriptor is added without a scope, asserts that **no delete is emitted without a scoping predicate**, and asserts that **every §8 exclusion is present as a `level: 'never'` descriptor**.
- [ ] **AC-46** `correlationId` is identical across the dry-run and the commit, and both gate timestamps plus the commit timestamp appear in the audit row.
- [ ] **AC-47** Partial storage-removal failure reports per-object failures and surfaces residue **without** failing the run.
- [ ] **AC-48** Unit tests cover C1/C2(both halves)/C3, fail-closed, no-Stripe, gate budget, **B1–B4, B6, B7**, the §8 exclusion set and the descriptor invariant. Integration tests cover happy path + auth failure + invalid input + blocked-by-gate + missing-table failure.
- [ ] **AC-49** No `console.*` in any new or touched file; all logging via `createLogger` with a `correlationId`.

### 10.11 Out of scope (v1) and follow-ups

| # | Item | Priority |
|---|---|---|
| **FU-1** | Resolve provider state on purge — cancel schedules, settle refunds, void invoices, release Connect, delete calendar events | 🟡 |
| **FU-1a** | Clear a **C3** block in-product by voiding the unpaid invoices | 🟡 |
| **FU-2** | Close the TOCTOU window (provider-side freeze); needs FU-1 | 🟢 |
| **FU-3** | Data export alongside deletion | 🟡 |
| **FU-4** | Admin / support-initiated purge of **another** business (D5 keeps v1 self-service only; D12 gates *who may reach the internal surface*, not *whose data they may purge*) | 🟡 |
| **FU-5** | Restore-from-snapshot | 🟢 |
| **FU-6** | Soft delete / undo / grace period | 🟢 |
| **FU-7** | Pausing or fencing the crons during a run | 🟢 |
| **FU-8** | Scheduled cleanup of stale test businesses | 🟢 |
| **FU-9** | Deleting `auth.users` / closing the account | 🟢 |
| **FU-10** | Extend the gate to future payment processors | 🟢 |
| **FU-11** | **Replace retained `email_unsubscribes` addresses with salted hashes** — the resolution if legal later objects to D8 | 🟡 |
| **FU-12** | **Provision `STRIPE_RESTRICTED_KEY_READONLY`** and move the gate onto it (D10) | 🟡 |
| **FU-13** | ✅ **Done — `delete_user_by_id.sql` removed**, not repaired | ✅ |
| **FU-14** | Migrate the remaining `new Stripe(...)` call sites onto `lib/stripe/client.ts` | 🟢 |
| **FU-15** | **The `pg_try_advisory_lock` / `pg_advisory_unlock` wrappers are `SECURITY DEFINER` and granted to `authenticated`** — any logged-in user can take or release an arbitrary advisory lock id. Not used by this feature (FR-28), but a real exposure needing an owner | 🟡 |
| **FU-16** | `insight-detect`'s four enumeration selects each carry `.limit(500)` with no pagination | 🟢 |
| **FU-17** | 🆕 **`OutcomeRepository` queries `insight_outcomes`, which does not exist** — the feature has never worked. Rebuild or retire; **do not delete the reference** (Rule 5) | 🟡 |
| **FU-18** | 🆕 **`audit_logs` provenance** — a live, user-scoped table created by no migration and referenced by no code | 🟡 |

---

## 11. Open follow-throughs during Dev

1. ~~`business_intake_forms` ❓~~ ✅ **Closed** — measured live; §10.2 ¶2 firm; AC-3 unconditional.
2. ~~§8.7 seeded, not closed~~ ✅ **Closed** — confirmed live.
3. **D11 — Dev's justified choice** between reusing the existing Delete-account button as the customer surface, or building the new surface and formally deprecating the old button. ⚠️ **Two live Danger Zones** — the choice must name which. Owner + SA, slice 5.
4. **SA-S1 / SA-S2 / SA-S3** carry into slice 1's build; **SA-S5** into slice 2.
5. **O-1, O-2** (§0.7). **O-3 and O-4 are closed.**
6. Every slice **re-runs `purge_schema_introspect()`** rather than trusting the dump markdown.

---

## 12. Notes on integration points

| System | Impact |
|---|---|
| **The T1 dump** | ⚠️ **Evidence, not a code input.** No constant may be generated from it (C-1) |
| **`purge_schema_introspect()`** | The runtime oracle. **Migration untracked — O-1, slice 1's own PR** |
| **`lib/payments/stripeAccountContext.ts`** | Gate foundation — `resolveUserConnectAccounts()`, `stripeRequestOptions()`, "absent evidence refuses". **Also slice 2's refusal control.** Do not reimplement account resolution |
| **`lib/stripe/client.ts`** | **Does not exist — Dev creates it** in slice 4. Two live API versions in the tree; pin the newer and say so. Unbudgeted |
| **`lib/business-os/bizql/mutate/ActionLog.ts`** | `idempotencyKey = sha256(planId\|stepId\|itemId)` — the evidence behind FR-24 |
| **`supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`** | **Not used by this feature** — session-scoped over a pooled connection, so unsuitable as a double-submit guard (FR-28). Recorded because it is `SECURITY DEFINER` and granted to **`authenticated`**, letting any logged-in user take or release an arbitrary advisory lock id (FU-15) |
| **`/api/user/delete-account` + its four callers** | ⚠️ **In scope under D11**, two callers live. Deletes `auth.users`, `user_preferences`, `notification_settings`, `security_settings`; audits intent but never outcome; 500s at its final phase after earlier phases have run |
| **`AdminAccessService` / `admin_users`** | **The internal surface's authorisation boundary (D12)**, server-side on the preview and commit routes. **Never `profiles.role`.** Call `isAdmin({ id, email })`, not `isAdminById`. See [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) |
| **`middleware.ts:155–156`** | `/test-business-os` is on the **skip-onboarding-check** list with no admin gate — the reason D12 exists |
| **`supabase/migrations/20260828b_payment_refund_ledger.sql`** | The refund lifecycle C2's refund half gates on |
| **`lib/payments/` (PaymentPlanService, invoiceLifecycle, RefundService, cancelPlan)** | Existing lifecycle vocabularies — the gate's conditions must agree |
| **Account settings** | Destructive section behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` (D9), localised incl. blocked-state copy |
| **`/test-business-os`** | Danger Zone tab, **admin-gated server-side (D12)**, session-based, no gate bypass |
| **`lib/business-os/purge/`** | **Engine location (SA-ruled).** Not `lib/services/` |
| **`lib/repositories/**`** | All phase-1 reads |
| **`AuditTrailService`** | `BUSINESS_DATA_PURGED` / `..._BLOCKED`, non-blocking `.catch()`, severity ≥ `warning` |
| **Snapshot retention enforcer** | 7-day cleanup; host cron per the workplan's C-17 ruling |
| **`POST /api/onboarding/chat/reset`** | Existing precedent; the purge should **absorb** it rather than duplicate it |
| **`POST /api/onboarding/build`** | Re-seed counterpart (AC-42) |
| **Supabase Storage** | `contact-documents`, `website-images`, plus the new `business-purge-snapshots` |
| **`no-deletion-paths.guard.test.ts`** | Shipped in PR #41. **Do not revert** |
| **Workplan §12–§12D** | The canonical SA review record — history, not specification (O-4) |

---

## 13. SA Review — 2026-09-14 (first pass, summary)

> 📌 **Summary — the authoritative text is the workplan's §12–§12D** (O-4). `main` never carried a long form; its copy is a 12-line table. SA assessed this restoration as faithful: the verification table matches SA's own measurements, and the T5 narrowing carries the AC number correct *at that time* — internal evidence of restoration rather than reconstruction.

**Verdict:** 🔄 **Rework required.** Two things stopped it reaching Dev: **§3 was not complete**, and **FR-1 — the mechanism the requirement leans on to prove completeness — did not exist.**

**Verified independently by SA:** no `business_id`; B1 (`20260828b:39`), B2 (`20260828e:35`), B3 (`20260801_create_insight_automations:35`); T1 (`20260727:27`); T2's SET list includes `status` (`20260828b:193-206`); `business_chat_plan_cache`'s portable rows; two buckets and **no third**; 11 crons; 54 repositories; `resolveUserConnectAccounts` returns a list; direct charges ⇒ a platform-scoped read returns "no such object". **Corrected: T5 was overstated.** **Rejected: "55 user-scoped tables"** and **"reuse the existing Stripe client"** (there is none).

**SA-B1** — §3 incomplete (`insight_outcomes`, `onboarding_prompt_ideas`, `user_preferences`, `organizations`/`organization_members`, `websites`); **an entire DDL directory unread** (`supabase/SQL Scripts/`, 65 files) — *"not having looked is not the same as having ruled out"*; the agents checkbox missed `agent_prompt_threads` and `agent_prompt_workflow_generation_sessions`; eleven 📄 tags under-claimed; `business_intake_forms` had to move 📄 → ❓.

**SA-B2** — neither named tool can satisfy FR-1. **Strike "not a second mechanism".**

**R1** customer surface flag-gated. **R2** three-phase shape; **resume rejected**; T5 by ordering; **B4 added**; engine at `lib/business-os/purge/`. **R3** `email_unsubscribes` retained. **R4** snapshot: no `authenticated` policy; retention is a mechanism; write-then-read-back. **R5** `user_settings_complete` is a view; no `landing` table. **R6** widen the dump to `pg_trigger`/`pg_policies`. **R7** no read-only credential; no existing client; **"eight reads" understates by orders of magnitude**; six mandatory bounds.

**Other findings:** the tenant-isolation guard was aimed at the wrong vector — the real one is *"one missing `WHERE user_id =` away from a platform-wide delete"*; D1's dual audience needs progress signalling, a double-submit guard and a post-purge destination; **TOCTOU accepted** with both timestamps audited; **AC-5 not testable as written**; **no AC covered Zod**.

---

## 14. SA Review — 2026-09-14 (second pass, summary)

> 📌 **Summary — the authoritative text is the workplan's §12–§12D** (O-4).

**Verdict:** ✅ **Approved for Dev**, subject to SA-2P1, four rulings and the `service_role`-only grant.

**SA-2P1** — an `information_schema` enumeration **cannot distinguish Business OS from kernel**, so §8's *prose categories* are not evaluable and **route (a) would fail closed permanently on its first run**. Every category expands to one `level: 'never'` descriptor per table; the five unnamed were `calibration_history`, `error_patterns`, `execution_anomalies`, `execution_baselines`, `plugin_performance`. **The RPC is granted to `service_role` only.**

**Four rulings.** `user_preferences` → **`K*`** (a preference on a login that survives, so deleting it renders the *next sign-in* wrong). `business_intake_forms` **does not block Dev**, and its ❓ **does not propagate to `user_intake_settings`**. FR-24 — **accept the re-arm, delete the log**: reproducible only for item-less plan-level actions via the portable cache, **and there re-arming is correct behaviour**. FR-1 — **route (a)**: a manifest cannot detect a table added after it was committed, *"which is precisely how §3 became incomplete, twice, in this very document."*

**FU-13 — remove, don't repair:** a repaired script is a second deletion path with no gate, snapshot, audit or descriptor guard.

---

## 15. SA Review — 2026-09-15 (workplan pass, amendments)

| # | Amendment | Status |
|---|---|---|
| **1** | **FR-28** — `pg_try_advisory_lock` is **session-scoped** and unsafe over a pooled PostgREST connection. Replaced with **`pg_try_advisory_xact_lock`** inside the RPC | ✅ Applied |
| **2** | **FR-26** — the claim that insights return 15 minutes after a Reset is **false**: `insight-detect` enumerates from four tables Reset deletes | ✅ Applied |
| **3** | **AC-26** — replaced to match | ✅ Applied |
| **4** | **§6.3** — the false sentence removed, replaced with the enumeration-source table | ✅ Applied |
| **5** | **§8.7** — closed statically | ✅ Applied |
| **D11** | The existing customer-facing delete path is **in scope** | ✅ Recorded |
| **D12** | Internal authorisation → **`AdminAccessService`**; SA **retracted** its "unflagged internal surface" approval | ✅ Recorded |

---

## 16. SA Review — 2026-09-16 (the re-slice)

**Verdict: ✅ Slice 1 is clear to go to QA**, subject to eight conditions, all applied.

**On TL's central finding — it is right, and it is mine twice over.** AC-37's fail-closed global invariant made incremental delivery architecturally impossible, and I reviewed it twice without naming that. I ruled on the *correctness* of the invariant, wrote conditions to strengthen it, and never once asked what it cost to deliver. **A reviewer who only ever tightens is not neutral.** The rule I take from this: **whenever a global fail-closed invariant enters a design, the reviewer states its delivery consequence in the same breath as its safety benefit.**

**Ruling 1 — classification/capability split: sound, conditional on AC-37b.** The hunted failure mode is real: if the executor filters descriptors by *capability as well as level*, a mis-set term causes a table to be **silently not deleted while AC-37 still reports complete**, because completeness is measured on a different axis from execution. Closed by **SA-S1** (capability filters operations, never tables), **SA-S2** (exhaustive constant), and **SA-S3** — the risk §0.2 did not name: under slicing the temptation is to mark an awkward table `never` to fit a capability. *"`never` is a claim about the schema, not a scheduling device."* **"Not weakened anywhere" is one notch too strong** — strengthened for slice 1, equivalent for slices 2+ *given AC-37b*.

**Ruling 2 — union predicate: confirmed, slice 1 is the only right home.** Landing it later means slice 1 ships a guarantee whose *scope* changes underneath slices 2–5. **B7 remains the proof the union does not close the class.** **SA-S4:** §3/§4 must name the compensating mechanism, not only the limit.

**Ruling 3 — slice 2's weakening: the mitigation is right, the release note is the wrong instrument.** A condition evaluated every run, unevaluable by a human, and silent on violation. **SA-S5: make it a runtime refusal** — refuse when `resolveUserConnectAccounts()` is non-empty. It matches FR-8's own skip-cleanly semantics and makes slice 4 a **mechanical** prerequisite.

**Verification.** Module slicing ✅ holds, checked against SA's own extraction of all 37 edges — **but the census was stale by one edge, B7** (SA-S6), *"stale by precisely the edge whose discovery required correcting the method §0.3 uses."* Descriptor count **77 + 44 = 121** ✅. FR/AC machine-checked: FR 1–31 complete with exactly the three declared splits; AC 1–49 complete — **but AC-33's provider half had no slice** (SA-S7), the half guarding against a false all-clear. **§§13–15: `main` never carried the long form**, so "verbatim vs main" is unverifiable; the restoration reads as faithful. **O-4 as written was self-defeating** — SA-S8: name the workplan's §12–§12D as canonical and demote §§13–15 to summaries.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-14 | Created | No `business_id` — a business is a user account. 56 tables, FK blockers, triggers, crons, orphan-risk tables, portable plan-cache rows. |
| 2026-09-14 | D1–D7 resolved | D1 overrode BA's test-only recommendation. Reset/Purge split, opt-in extras, two surfaces one engine, dry-run + typed confirmation, snapshot. |
| 2026-09-14 | D6/D6a/D6b — pre-flight gate | External state from post-hoc report to hard gate, enumerated from the provider. C3 blocked over BA's contrary reasoning. |
| 2026-09-14 | **SA passes 1 & 2** | Six blockers closed; §3 56 → 60; §8 enumerated; FR-1 route (a); `user_preferences` `K*`. 31 FRs, 49 ACs. |
| 2026-09-15 | **Workplan-review amendments** | FR-28 → `pg_try_advisory_xact_lock`; FR-26/AC-26/§6.3 corrected; D11, D12; §8.7 closed. |
| 2026-09-15 | **T1 live-schema classification** | FR-1 ran live: 117 relations vs 79 enumerated → 38 unclassified. All classified. Three inventory corrections. |
| 2026-09-16 | **🔄 Re-sliced at the owner's instruction** | Five slices along the D1 and D6 fault lines; §0.2 resolves AC-37 by separating classification from capability; §0.3 finds module slicing unsafe; §0.8 maps every FR and AC. |
| 2026-09-16 | **SA review of the re-slice — slice 1 clear to QA** | Three rulings and eight conditions; SA turned TL's finding on itself. |
| 2026-09-16 | **BA applied SA's eight conditions** | AC-37b, AC-37c, FR-32, §0.2.1; the "not weakened anywhere" overclaim corrected; §4's compensating mechanism; slice 2 as a runtime refusal; census corrected to ten with B7; AC-33 split into slice 4; O-4 reworded. |
| **2026-09-16** | **🔴 Re-inlined §§1–12 — the document is self-contained again** | RM caught that the previous revision **could not be committed**: summarising §§1–12 to avoid "transcribing a fourth time" deleted **541 lines against 701**, and with them **65 identifiers present on `main` and absent locally** — table names (`payment_invoices`, `payment_plans`, `email_sequences`, `crm_tasks`, `scheduling_services`, `stripe_connect_accounts`), trigger names, and six columns/functions that exist **nowhere else in the repo**: `account_token`, `credentials`, `deleted_at`, `get_or_create_user_organization`, `idempotency_key`, `preferred_language`. Each had been the rationale in a §3 row or §8 entry that collapsed. Worse, §10 pointed at a **commit SHA** for the text of its own FRs and ACs, so committing it would have left `HEAD` carrying a governing requirement for a **destructive feature** that could not state what the feature must do. **This is O-4's own failure mode inverted** — the same error SA-S8 had just corrected in the other direction, committed by me while recording why it was wrong. **Fix:** §§1–12 rebuilt **from `main`'s own text** with the T1 and SA deltas layered on top, never re-derived — re-deriving is how the identifiers were lost. §3 keeps `main`'s numbering so every cross-reference resolves, with **#11 `websites` and #53 `insight_outcomes` struck in place** rather than renumbered and the six T1 additions numbered #61–#66. §5.3 corrected to **27 of 110** tables with no DELETE policy. §6.1 carries all ten constraints with their real constraint names, including **B5 as a recorded negative result**. §6.2 lists all four DELETE-capable triggers plus the inert `storage_usage` pair. §8 restores every rationale and adds §§8.10–8.13. §10 restores all 32 FRs and 51 ACs in full. **O-4 ruled:** *the document is authoritative and complete; it defers to no commit SHA for its own content.* A pointer is legitimate only to a **living tracked file** and only for **non-normative** material — which is why §§13–15 may point at the workplan's §12–§12D for SA's review *record*, but §10 may not point anywhere for the *specification*. Recorded as standing rule 7 in §0.6 so the next revision does not re-summarise for the same good reason I did. |
| 2026-09-26 | Admin Archiving: two tables classified | `archived_records` joins the activity-history checkbox beside `audit_trail` (`optional:activityHistory`, `user_id`, `snapshot: 'ids'`); `archive_runs` is `never` (§8.11). Classification lives in `lib/business-os/purge/descriptors.ts`, and the SA-S3 baseline moved 124 → 126 deliberately. Admin Archiving requirement C-4 |
