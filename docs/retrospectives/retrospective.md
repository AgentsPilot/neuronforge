# Retrospectives

## Gmail `modify_email` Action -- 2026-03-29

**MD links:** [BA Requirement](/docs/requirements/gmail-modify-email-action-2026-03-29.md) | [Dev Workplan](/docs/workplans/gmail-modify-email-action-workplan.md)

### What went well
- Requirement was thorough and included exact API endpoint, schema, and test scenarios -- no clarifying questions needed from BA
- The existing `list_labels` method on the executor validated the label-fetching pattern before implementation
- The `gmail.modify` scope was already present in the plugin's OAuth config, so no auth changes were needed
- Implementation was clean: 4 files changed, all scoped to the plugin boundary with no cross-cutting concerns
- Pre-existing documentation gap (missing `get_email_attachment` from plugin docs) was fixed as part of this work

### What did not go well
- Number of Dev to SA back-and-forths: 0
- Number of Dev to QA bug fix cycles: 0
- Any blocked handshake and why: None

### Conclusions & process improvements
- Well-defined requirements with exact API references and acceptance criteria eliminate BA/Dev back-and-forth entirely
- Naming the helper `resolveLabelNames` + `createLabel` instead of the single `getOrCreateLabel` from the requirement was a better design -- batching the label list fetch for all custom labels in one call rather than per-label
- Consider adding the `get_email_attachment` action to plugin docs at the time it is implemented, not retroactively

### Status: PENDING USER APPROVAL

---

## R1 -- V2 Agent Creation Phase 4 Cleanup -- 2026-05-24

**MD links:** [BA Requirement](/docs/requirements/V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/v2-agent-creation-r1-phase4-cleanup-workplan.md)

### What went well
- Single Dev implementation pass with zero rework -- workplan was sufficiently detailed to enable a clean one-shot build
- SA workplan review caught two latent blockers before implementation began: the implicit init-thread route flip and a `phase4-schema.ts` consumer that would have broken the rename. This saved a Dev rework cycle.
- Option C (rename instead of delete) was a proportional design choice that prevented R1 scope from expanding into consumer-side refactors
- Test-suite movement was net positive: -2 failures / +2 passes vs the pre-R1 baseline, and 6/6 new repository tests pass on first run
- `tsc --noEmit` clean for all R1-touched files
- BA requirement captured the full Q&A trail (Q1-Q4 plus the versioning + branching FRs added later), which gave Dev and SA an unambiguous specification
- Per-FR verification by SA in code review -- all 13 acceptance criteria PASS
- Merge to `main` completed cleanly with `--no-ff` per FR17 -- zero conflicts; v4/v5 generator files auto-merged with incoming main calibration changes
- Post-merge `tsc --noEmit` confirmed clean for R1 (only the 20 pre-existing archive-file errors remain)

### What did not go well
- Number of Dev to SA back-and-forths: 0 (workplan approved with minor revisions, no implementation rework needed; code review approved on first pass)
- Number of Dev to QA bug fix cycles: 0
- Any blocked handshake and why: None
- Branch creation policy was ambiguous at cycle start -- Dev created the branch under the old policy. Now resolved going forward (RM owns branch creation per the updated `team-leader.md` / `release-manager.md` / `developer.md` definitions); R1 is the one-time transition cycle.
- `next lint` is uninitialised in the repo -- pre-existing project state, surfaced during R1 but deferred to a separate `chore/reinit-next-lint` follow-up
- QA flagged 3 non-blocking caveats indicating coverage gaps that could become first-class acceptance criteria:
  1. Versioning log assertion verified at mock layer only -- no logger-spy assertion in integration tests
  2. Stepper rendering verified by source grep only -- no browser smoke test
  3. Legacy phase4 coercion verified at the mock layer only -- no end-to-end DB integration test
- V4/V5 architecture doc stragglers (mentions of removed/renamed Phase 4 modules in older design docs) were noted by SA and deferred to a follow-up documentation PR
- **Rebase-before-merge policy ambiguity surfaced at merge time:** SA's workplan-review note recommended rebase-before-merge as a default. During the actual merge, the user correctly pointed out that FR17's `--no-ff` produces a merge commit anyway, so rebasing first does not materially improve the history. The rebase step was therefore skipped in favour of a direct `--no-ff` merge. Process change captured under Conclusions below so this isn't relitigated at R2/R3 merge time.

### Conclusions & process improvements
- **Branch ownership going forward:** For R2 and R3, TL must invoke RM first to create the feature branch *before* Dev is invoked. This aligns with the updated team-leader handshake table and prevents the R1 branch-creation ambiguity from recurring.
- **Merge strategy going forward:** For R2 and R3, SA and TL should default to a direct `--no-ff` merge (no preceding rebase) unless there is a specific conflict-resolution reason that makes a rebase materially better than letting `--no-ff` produce the merge commit. Captured here so the R1 merge-time conversation does not repeat.
- **Live-environment verification policy:** Discuss before R2 kickoff whether QA's "live environment verification" steps (browser smoke for UI flow, DB integration test for coercion, logger-spy for versioning) should be promoted to first-class acceptance criteria or remain deferred to manual QA. Recommend deciding the policy once and applying consistently across R2/R3.
- **Follow-up tracking:** Two explicit non-R1 follow-ups recorded so they are not lost:
  - `chore/reinit-next-lint` -- initialise `next lint` config so ESLint runs in CI
  - Documentation PR -- sweep V4/V5 architecture docs for stale Phase 4 references
- **Workplan-quality reinforcement:** The Gmail `modify_email` cycle (0 rework) and R1 (0 rework after SA workplan review) both confirm that investing in a thorough workplan up front consistently eliminates Dev/SA back-and-forth during implementation. Continue this pattern.

**Status:** COMMITTED -- `feature/v2-agent-creation-r1-phase4-cleanup` -- merge commit `ed79428` on `main` -- feature commits `b18f939` + `0f4c04f` + `568d288` -- merged 2026-05-24

---

## Business OS Business Data Reset & Purge -- 2026-09-16

**MD links:** [BA Requirement](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/business-os-business-data-purge.md) | [Live Schema Dump](/docs/workplans/business-os-business-data-purge-schema-dump.md)

**Cycle:** 2026-09-14 to 2026-09-16. **Outcome: not delivered.** The owner halted the cycle on a scope concern and ruled: keep the verified knowledge, re-slice the delivery. This retrospective is written to that instruction and is deliberately not reassuring.

---

### 1. The apportionment

The owner's concern was that the feature "grew from a simple cleaning up to many other elements". Having read the requirement, the workplan, the dump and all four SA review sections, my finding is that **three different things were happening at once, and I reported them to the owner as one thing.** Only one of them was growth.

**Method for the numbers below:** I assigned each of the 49 acceptance criteria and each of the 32 tasks to the decision that made it necessary. The split is approximate; the direction is not.

| Bucket | Effect on the feature's size | Evidence |
|---|---|---|
| **A. Irreducible structure of the problem** | ~26 of 49 ACs, ~20 of 32 tasks | There is no `business_id`. `business_profiles.user_id` is UNIQUE and 1:1 with `auth.users`, so "delete business X" means "delete every row for user X" across **110 user-scoped base tables, 239 FKs, 84 triggers, 360 policies**. This was true on day 1 and was never going to be smaller. |
| **B. Owner product decisions** | ~22 of 49 ACs, ~10 of 32 tasks | Two decisions, each taken by the owner against or beyond BA's recommendation. See below. |
| **C. BA investigation error** | **Zero ACs, zero tasks** | BA's errors were measurement and confidence errors. They cost rework and credibility. They did not add one table, FR or AC to the feature. |
| **D. Pre-existing defects surfacing** | 2 tasks (T31, T32) in scope; the rest deliberately excluded | Five live deletion paths, 41 unauthenticated admin API routes, a public `service_role` key. Correctly kept out of the requirement -- but they consumed the cycle's attention and dominated the owner's sense of its size. |

#### B -- what the owner's own decisions cost, stated plainly

This is the part that most needs saying, because it is the part BA is currently being blamed for.

- **D1 (audience).** BA assessed the feature and **recommended test-only**. The owner chose customer-facing as well. That single decision brought: GDPR framing, the `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` flag gate (D9) with a seven-condition un-gating checklist, a second surface with its own authorisation model (D12, task T30), localised en/es/he copy (FR-23, FR-25, FR-26), a post-purge destination (FR-27, T25), a no-PII snapshot branch (C-17), and tasks T23-T26. It roughly doubled the work.
- **D6 / D6a / D6b (the Stripe pre-flight gate).** This was the **owner's idea**, and the owner chose all three blocking conditions and "no override on either surface". BA explicitly flagged C3 (unpaid invoices) as different in kind -- the business's own loss, not a third party's -- and the owner chose to block anyway. The gate alone is **AC-6 through AC-18 plus AC-33 (14 of 49 ACs)**, tasks T12-T15, a new shared Stripe client, six resilience bounds, and condition C-20.
- **D11.** The owner rejected replacing the broken self-service delete with a support-request message. That is what put `/api/user/delete-account` and, transitively, the whole Danger Zone sweep into scope.

None of these were wrong calls. But **roughly half the acceptance surface of this feature exists because of decisions the owner made, and the owner was never told that at the time they made them.** That is my failure, not BA's.

#### C -- what BA actually got wrong, and what it actually cost

BA's errors are real and each was caught by SA or Dev, never by BA:

| Error | Class |
|---|---|
| In-scope table count 55 -> 56 -> 60 -> 64 -> **110** | Estimation, corrected four times |
| Missed the entire `supabase/SQL Scripts/` directory (65 DDL files) on the first pass | Search completeness -- straightforwardly BA's |
| Asserted `insight_outcomes` was a 7th insight table | **Reasoning error**: treated `OutcomeRepository` querying it as evidence it exists. The table does not exist; that repository has never worked |
| FR-26 / AC-26 factually false (claimed insights return 15 min after a Reset) | Did not read the enumerator; `insight-detect` enumerates from four tables Reset deletes |
| FR-28 named `pg_try_advisory_lock` | Session-scoped over a pooled PostgREST connection -- both false passes and permanent false blocks |
| Section 3.16 said tables were "ruled out" | They had simply never been found |

**But note what the table count actually means.** The feature never grew from 55 tables to 110. The blast radius was 110 on day one; only the *measurement* moved. That distinction matters for the re-slice: the size the owner is reacting to is mostly the size the problem always had.

**The mitigating context is real and I weighed it.** The repository is a genuinely unreliable oracle: 58 migrations were never applied, there is no `DATABASE_URL` and no `pg` driver, `exec_sql` does not exist (five `scripts/` files call it and cannot ever have worked), and the live schema was unreadable until Dev found the PostgREST OpenAPI route and the owner ran the introspection RPC by hand.

**It does not excuse the failure, and here is the precise reason.** BA had all of that evidence *before* writing the confident inventories. The correct BA output on day one was not a 64-table inventory -- it was a stop: *"I cannot enumerate the blast radius from this repository. This requirement cannot be correctly sized until someone with SQL-editor access runs introspection against the live database."* BA eventually wrote exactly that reasoning, in section 1.4, **as a lesson learned after being corrected three times**, and it is a good piece of writing. It should have been a **stop condition at the start**, not a postscript. Instead, the introspection task became **T1 of an already-written 32-task workplan** -- the measurement that determined the feature's size was sequenced *inside* the plan that had already assumed a size.

**Apportionment, in one sentence:** the feature did not grow; it was mis-measured by BA, deliberately doubled by the owner, and surrounded by pre-existing defects that were correctly excluded from it -- and because I relayed all three as a single stream, the owner could not tell them apart. The owner's instinct that something was out of control is **accurate about the cycle and inaccurate about the feature.**

---

### 2. Why nobody proposed incremental delivery

BA, SA, Dev and I each reviewed this feature -- SA four separate times -- and none of us raised staged delivery once. That is systemic, and there are four causes, each of which is fixable.

1. **No role owns sizing.** The handshake table in my own definition is a pipeline: BA -> RM -> Dev -> SA -> Dev -> SA -> QA. There is no step called *"is this one cycle or three?"*. The only agent positioned to ask it is me, and nothing in my instructions tells me to.
2. **Every role's quality bar rewards completeness, and nothing rewards smallness.** BA is judged on whether the inventory is complete. SA is judged on whether the holes are closed. Dev is judged on whether the guard fails closed. All three incentives push toward one exhaustive artefact. Not one of the four roles is measured on shipping the smallest correct thing first.
3. **The architecture itself foreclosed slicing, and this was reviewed four times without anyone noticing.** FR-1 / AC-37 make the engine **fail closed when any user-scoped table is in neither the delete set nor the exclusion set**. That is an excellent correctness property -- it is what caught the 38 unclassified relations -- but it also means *the engine cannot run at all until all 110 tables are classified*. A correctness guarantee had silently become a delivery constraint: there is no such thing as "ship CRM purge first" under this design unless the oracle's enumeration is itself scoped to a declared domain. Nobody proposed that, because nobody was asking the question. **When a fail-closed global invariant enters a design, someone must state out loud that it has just made incremental delivery impossible.**
4. **Size was reported as structure, never as cost.** "31 FRs, 49 ACs, 32 tasks in 9 stages" was presented to the owner as evidence of thoroughness. I never converted it into an estimate or a calendar. Without a cost signal there was nothing for the owner to push against -- until instinct did the job that the process should have done.

A fifth, smaller cause: the three-phase architecture (gate + snapshot in TypeScript, one `SECURITY DEFINER` RPC, storage + audit after) was approved early and is genuinely good. Once a good shape is approved, every subsequent finding gets absorbed *into* it rather than triggering a re-ask of scope.

---

### 3. What the process caught, and whether that was enough

#### It caught a great deal, and this must not be written off

- **SA overturned its own rulings when shown better arguments, at least three times.** It retracted its approval of an "internal, unflagged" surface once Dev showed `/test-business-os` is on the middleware skip list with no admin gate -- *"That is my error, surfaced now"* -- producing T30 and D12. It retracted its objection to reusing the existing Danger Zone button once Dev showed T31 removes the old implementation on day one. And in section 12D it turned its own reasoning against its own conditions C-21/C-24, replacing per-file tombstone assertions with one repo-wide guard because *"a per-file assertion protects a path that already exists."*
- **Dev reported bugs in its own work, twice, unprompted.** (i) Its C-21 comment-stripper ran block comments before line comments, so the glob `app/admin/**` opened a block-comment match that swallowed both imports -- it failed loudly this time, but **the same bug fails open** if the swallowed region contains a deletion primitive. (ii) Its own claim that "every one of the 49 ACs has an owning task" was an assertion, not a check; re-run mechanically it was **44 of 49**, with AC-33 genuinely unowned.
- **Dev corrected SA eight times, four of them against Dev's own interest** -- including *"my DEV-Q8 arithmetic was wrong in my own favour"*.
- **Every improved oracle found what the previous one had cleared.** The route-caller grep was correct and answered the wrong question; a component sweep found the fifth Danger Zone deleting four tables from the browser behind a success message for an email that is never sent. A user-scoped FK filter was correct and could not see B7 by construction. A component sweep was correct and could not see E5's 41 unauthenticated admin routes.

Every one of those would otherwise have been a production defect. The count of live deletion paths in this codebase is **five found, zero shipped**, and that is the review chain's doing.

#### It was not enough, and the gap is specific

- **The chain reviews artefacts for correctness. It never reviews plans for size.** Four SA passes and two code reviews produced 35 numbered conditions, 25 findings and 20 open items -- and **zero questions about whether this should be delivered in one piece.** A review chain that cannot say "this is too big" will make a too-big thing correct rather than make it smaller.
- **Review cost scales with artefact size, so a mis-sized requirement compounds.** Every one of those four SA passes was run against a 784-line requirement and a 2,000-line workplan. Mis-sizing at the front made every later gate more expensive.
- **The chain damaged its own artefact once.** SA truncated the workplan to zero bytes with a Python `io.open(p, "w")` that truncates on open, then raised `UnicodeEncodeError` before writing a byte; the file was untracked, so git could not restore it, and exact recovery was impossible. It was recorded openly rather than quietly repaired, which is right -- but it is a real cost of the chain, not of the feature.
- **The most valuable lesson of the cycle is about oracles, and it was learned late.** Five deletion paths, five different oracles, each time the previous one reporting clean. The generalisable rule is: **a clean result is meaningless unless it states what it could not have seen.** That rule is now embodied in Dev's repo-wide guard (a fail-closed file-count floor, so "scanned 0, found 0" turns the suite red; an allow-list rather than a deny-list) -- which is exactly right, and is the single most reusable thing produced this cycle.

**Verdict: the review chain was working and was insufficient. Both are true.** It is a defect-finding machine with no sizing function, and the thing that went wrong here was sizing.

---

### What went well

- The three-phase execution shape (gate + snapshot outside the transaction, one `SECURITY DEFINER` RPC, storage/audit after) survived four reviews unchanged. SA: *"this is the first workplan in this cycle that did not need its shape corrected."*
- FR-1 caught exactly what it was designed to catch, at the point it was sequenced to catch it: 117 relations carrying `user_id` against 79 enumerated, meaning the engine would have refused its own first run until all 38 were classified.
- The descriptor set (`lib/business-os/purge/descriptors.ts`) reached **121 descriptors, zero unclassified**, with ordering asserted against the live dump rather than by whoever last edited a band.
- Five live customer- or platform-reachable deletion paths were found and four are now retired, committed on `fix/business-os-deletion-paths` at `66c3ee35` -- including a route that deleted `auth.users` and then 500'd partway through for every onboarded user, and an unauthenticated endpoint that deleted any account from a URL path parameter while writing an audit row attributing the deletion to its own victim.
- Every agent stated the limits of its own evidence rather than overclaiming -- Dev on the RLS-policy finding (*"a strong signal, not a proven vulnerability"*), SA on the GDPR reading (*"stated for the record and is not legal advice"*). That habit is why several findings were rulable in one pass.

### What did not go well

- **Number of Dev <-> SA back-and-forths: 7 SA passes** (requirement pass 1 rework, requirement pass 2, workplan review, workplan rev-2 clearance, code review 1, dump review, the 12D rulings), producing **35 conditions (C-1...C-35), 25 findings (F-1...F-25), 12 Dev questions and 20 open items**. Several were re-derivations of facts a single live-schema read would have settled on day one.
- **Number of Dev <-> QA bug fix cycles: 0 -- QA was never reached.** Three days, 35 conditions, 121 descriptors, zero QA. The critical path (T1 -> T3 -> T4 -> T9 -> T16 -> T20 -> T28) never got past T4.
- **Blocked handshakes:** T1 blocked on a human with Supabase SQL-editor access (no `DATABASE_URL`, no `pg` driver, `exec_sql` absent); T31 blocked on RM cutting a `fix/` branch; T11 blocked because its chosen cron host is provably dormant with `CRON_SECRET` unset; T22 and T24 held on conditions.
- BA's table count moved four times, and I passed each new figure to the owner without once asking why it was changing.
- Section 3.16 of the requirement stated tables were "ruled out" when they had never been found -- the single most misleading sentence in the document, because it converts an absence of search into a positive finding.
- The workplan was destroyed once and could not be exactly recovered (see above).
- **My own contribution, recorded because it is the largest single cause:** I relayed every scope expansion to the owner as a decision to *make*, never as one to *defer*. D1 and D6 were each put as a binary choice with no third option and no cost attached. I never proposed staged delivery at any point in three days. And I passed BA's changing counts through unchallenged, which is precisely the moment a team leader is supposed to stop the line.

---

### Conclusions & process improvements

#### For BA's evidence standards

1. **Declare an evidence tier on every factual claim, from the first draft.** `Verified live` / `Read from DDL` / `Inferred from a code reference`. BA produced exactly this taxonomy in section 1.1 -- at the end of the cycle, after being corrected three times. It must be a starting convention, not a closing apology.
2. **A code reference is never evidence that a table exists.** A repository querying a table proves only that *code believes* it exists. `insight_outcomes` is the standing counter-example: queried at four places in `OutcomeRepository.ts`, absent from the database, so that feature has never worked.
3. **New hard stop: if the requirement's size depends on an inventory BA cannot measure, BA stops and says so.** The missing measurement becomes a **prerequisite slice with its own owner**, delivered and reviewed *before* the requirement is written -- not task T1 inside a 32-task workplan whose size already assumes an answer.
4. **Enumerate the sources before reading any of them.** The 65-file `supabase/SQL Scripts/` directory was missed on the first pass because BA started reading rather than started listing.
5. **A changed count is a confidence event, not a data update.** When an inventory moves, BA reports *why the previous method was wrong*, and TL escalates it. Four silent revisions is what turned a measurement problem into a trust problem.

#### For when a requirement must be sliced

6. **Add a mandatory "Delivery slices" section to every BA requirement.** It must propose at least two candidate slices -- what each ships, what each defers, what each proves -- even when the recommendation is a single slice. A recommendation with no alternative is not a recommendation.
7. **Hard slicing triggers. Any one of these obliges BA to propose a split, and SA to rule on it:**
   - more than ~12 FRs or ~20 ACs;
   - more than one audience or more than one surface;
   - the size depends on a fact the team cannot currently measure;
   - an external provider sits on the critical path;
   - a **fail-closed global invariant** is proposed. AC-37 is the case in point: it is a correct design that makes incremental delivery impossible, and that consequence must be stated at design time, not discovered at delivery time.
8. **New handshake point: a size review between BA and RM.** After the requirement is written and *before* RM cuts the branch, TL puts the slicing proposal and its cost to the owner. This is the step whose absence produced this cycle.

#### For how scope decisions are put to the owner

9. **Every decision put to the owner carries three things: what it adds (FRs / ACs / tasks), what it defers, and an explicit "defer to a later slice" option.** The deferral option is always present. D1 and D6 were each presented as binary and costless; had D1 been framed as *"customer-facing roughly doubles this -- do it now or in slice 3?"*, this cycle would likely have looked different.
10. **A decision that materially changes size goes back through BA for a re-sizing before the workplan proceeds.** D1 doubled the work and was absorbed silently into an existing structure.
11. **Keep an out-of-band defect register.** Findings that are *not the feature* -- the five deletion paths, the 41 unauthenticated admin routes, the public `service_role` key -- belong in `docs/investigations/` with their own severity and owner, not accumulating inside a feature workplan. This is the single change that would most have reduced the owner's sense of an unbounded cycle, because it is what was actually unbounded.
12. **TL does not pass a changed number through without asking why it changed.** Mine to own.

---

### What must be kept -- the verified knowledge

This is measured, not inferred, and it cost the whole cycle. A re-slice that starts from a blank page pays for it twice.

| Asset | Where | Why it is irreplaceable |
|---|---|---|
| **The introspection RPC** | `supabase/migrations/20260915a_purge_schema_introspect.sql` -- **applied to live, file currently untracked** | Everything else derives from one call to it. It is the only working oracle for this schema |
| **The live dump** | `docs/workplans/business-os-business-data-purge-schema-dump.md` (committed, `734a67be`) | 2,540 column rows, **110 user-scoped base tables**, 239 FKs, 84 triggers, 360 policies, `generated_at 2026-09-15T13:12:15Z` |
| **The blocking-edge census** | Dump section 9.1, workplan F-15 / F-20 | **37 blocking edges**, correctly filtered by *parent in the delete set*: 23 inert at `auth.users`, 10 with parents among the 110, 4 inert outside. The full FK graph is cyclic and cannot be sorted; only `RESTRICT`/`NO ACTION` edges constrain a delete, and that subgraph is acyclic. **Eleven live constraints: B1, B2, B3, B4, B6, B7 plus the rest, and `crm_activities` last.** A new CASCADE FK cannot invalidate this contract |
| **B5 as a recorded negative result** | Dump section 9.2 | `data_decision_requests -> agents` is CASCADE and imposes **no** ordering constraint. An unrecorded negative gets re-investigated by the next person |
| **Trigger analysis from live definitions** | Dump section 9.3 | Only four DELETE-capable triggers exist. Exactly **one** live T5 path: `payment_refunds` delete -> `recompute_transaction_refund_state` updates `payment_transactions.status` -> `log_payment_activity_trigger` writes `crm_activities`. The `status` vs `payment_status` distinction is what makes the booking trigger unreachable. B4's mechanism is the trigger, not the FK |
| **121 machine-checked descriptors + the invariant suite** | `lib/business-os/purge/descriptors.ts`, `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` (both untracked) | All 110 tables classified, zero unclassified, ordering asserted against the live dump via exported `BLOCKING_EDGES`, plus the single-Supabase-importer scan and a deliberately broken fixture proving the assertion can fail |
| **The oracle-gap finding** | Workplan F-16, dump section 9.5, SA 12C.2 | `organizations` keys on `owner_user_id` and is invisible to a literal `user_id` predicate. Ruling: take the **union** of (a) tenancy column by name and (b) any FK to `auth.users` -- **with the stated scope limit that the union still cannot see parent-scoped children** (`website_blocks`, `smart_link_clicks`, `user_capability_blocks`, `agent_scheduler_state`). This is the most reusable design knowledge in the cycle |
| **Policy findings** | Dump section 9.6 | **27 of 110** tables have no DELETE policy (the service role is structurally required, not a convenience); **15 open `WITH CHECK (true)` INSERT policies**, three named "Service role" but granted to `public`, one to `anon`. Signal, not proven vulnerability -- needs a table-GRANT check |
| **Inventory corrections** | Requirement 1.4, workplan F-3/F-4/F-10/F-23 | `insight_outcomes` absent (FU-17); `audit_logs` live, user-scoped, created by no migration and referenced by no code (FU-18); `payment_methods` live (drop never applied); `websites` absent; four distinct memory tables; `business_chat_verified_questions.user_id` NOT NULL; `user_media` uses the existing `website-images` bucket -- no fourth bucket needed; `data_decision_requests` is `optional:agents` |
| **The repo-wide deletion-path guard** | `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | **Ship this first, independently of any slice.** Fail-closed file-count floor, allow-list not deny-list, unit-tested comment stripper, ~4s over 500+ files. It is the only thing standing between this codebase and a sixth deletion path, and it does not depend on the purge feature existing |
| **The four retired deletion paths** | Committed at `66c3ee35` | Do not revert as part of any re-slice |
| **The escalation register** | Workplan E1, E5, 12D.3 | `/api/auth/cleanup-incomplete` arms on `CRON_SECRET`; 41 unauthenticated `/api/admin/**` routes; and the P0 sequencing ruling that the **public `service_role` key must be rotated first**, because fixing route authorisation while the key is published is securing the doors of a building with no walls |

**Two caveats on keeping it:**

- **Measured knowledge has a timestamp.** The dump is true as of 2026-09-15 13:12. A re-slice re-runs `purge_schema_introspect()` rather than trusting the markdown -- which is condition C-1's own rule: *no code reads the dump doc.*
- **Flagged now because the cycle itself found this exact defect class:** the introspection function is **live in the database while its migration file is untracked**. That is precisely the `audit_logs` shape -- a live object no migration creates and no committed code explains. Commit the migration as part of the re-slice, whatever else is dropped.

---

### Status: NOT COMMITTED -- cycle halted by the owner; requirement returned to BA for re-slicing

- `fix/business-os-deletion-paths` carries the committed work: the four retired deletion paths and the repo-wide guard (`66c3ee35`), and the SA-cleared workplan plus live schema dump (`734a67be`).
- The purge engine, descriptors, introspection migration, API routes, UI component and the requirement document remain **uncommitted in the working tree**.
- No merge to `main` was proposed and none should be until BA has re-sliced the requirement and the first slice has been through SA and QA.
