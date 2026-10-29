# Plan: Business OS — Export Redesign (MX-0 to MX-7)

> **Last Updated**: 2026-10-29

**Developer:** Dev (written by the DELETE session's Dev for hand-off to the EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (incl. `## SA Split Review — 2026-10-25`, conditions SR-1 to SR-12, and the parent's XC conditions copied in §10)
**Parent:** [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) (`## SA Review — 2026-10-25`, binding; TL edits it, nobody else)
**Coordination file:** `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md` (not in git)
**First slice workplan:** [BUSINESS_OS_EXPORT_MX0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md)
**Status:** In delivery. E1 (MX-0), E2 (MX-2a), E4 (MX-1a) and E5 (MX-1b) are merged (`main` at `1cd86f74`); E6a (MX-3a) merged as PR #565. **E6b (MX-3b, the data export worker) is code complete on `feature/bos-export-mx3b-worker` (from `main` `32effb8d`) and waits for SA code review**, then QA (T-Q1 100,000-row local measurement, T-Q2 C-10 gate) and the user's diff review; not committed. Originally checked against `origin/main` at `7e51af5b`.

> **User decision, 2026-10-27 (binding, not reopened here):** a new slice **E6.1 = MX-3.1** runs right after E6 (MX-3) merges. It removes the `BUSINESS_OS_MODULE_EXPORT_ENABLED` switch and every bit of code tied to it, and removes the ZIP download code. In the user's words: "we are still in testing mode, so i am not concerned on half baked developments being pushed, so let's not create a parameter that is not needed." SA ruled the consequences on 2026-10-27. There is no switch-on step anywhere, and the new export goes live for every owner when E6.1 merges. XC-15's "ready ZIPs stay downloadable until they expire" and XC-16's 72 h wait no longer apply. MX-6 (E9) is folded into MX-3.1, MX-4 and MX-7 (§4.9). User numbering: E1 MX-0 · E2 MX-2a · E3 MX-2b · E4 MX-1a · E5 MX-1b · E6 MX-3 · **E6.1 MX-3.1** · E7 MX-4 · E8 MX-5 · E9 MX-6 (folded) · E10 MX-7.

---

## Overview

This is the end-to-end delivery plan for the EXPORT scope: replacing today's instant "Download my data" ZIP with a per-module export. Each module is its own background job and arrives as its own email with one joined CSV. The plan follows SA's ruled order (SR-4): the pure slices come first so the DELETE session can hold the cleanup-regeneration lock for DL-1a without blocking EXPORT. For every slice it lists the goal, what the slice touches, dependencies, locks and migration numbers, manual production gates, switch states, effort, done-when, the business questions that must be answered first, and a coordination checklist for working beside the DELETE session.

Where this plan and the requirement disagree, the requirement wins (and, inside it, the SA Split Review wins over §11 until SR-12 is spliced).

---

## Table of Contents

1. [Slice table](#1-slice-table)
2. [Rules that hold for every slice](#2-rules-that-hold-for-every-slice)
3. [Standard coordination checklist](#3-standard-coordination-checklist)
4. [Slices](#4-slices)
5. [Switch states over time](#5-switch-states-over-time)
6. [Business questions by slice](#6-business-questions-by-slice)
7. [Files EXPORT must not edit](#7-files-export-must-not-edit)
8. [Open items for SA](#8-open-items-for-sa)
9. [Change History](#change-history)

---

## 1. Slice table

Order per SA SR-4. Each slice is its own PR from `main`, never stacked, at most 2.5 days. Branch names are proposals: RM creates each branch at kickoff.

| # | Slice | Proposed branch | Depends on | Cleanup-regen lock | Migration numbers | Manual prod gate | Export switch after merge | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | **MX-0** (E1) ✅ Module map + per-module switches | `feature/bos-export-mx0-module-map` | — | No | None | No | (does not exist yet) | 🟢 1.5 d |
| 2 | **MX-2a** (E2) ✅ Joined CSV builder + lookups | `feature/bos-export-mx2a-joined-csv` | MX-0 merged; BQ-26 | No | None | No | — | 🟡 2 d |
| 3 | **MX-2b** (E3) Header labels en/he/es | `feature/bos-export-mx2b-column-labels` | MX-2a merged; BQ-31 | No | None | No | — | 🟢 1.5 d |
| 4 | **MX-1a** (E4) ✅ Schema, start function, claim/reap RPCs, repositories, descriptors, cleanup regen | `feature/bos-export-mx1a-schema` | MX-0 merged; BQ-29; **DL-1a released the lock** | **Yes** (2nd in order: DL-1a → MX-1a → MX-7) | **Two** (tables N, regenerated cleanup N+1; open item SA-P1) | **Yes** | — | 🟡 2.5 d |
| 5 | **MX-1b** (E5) ✅ Request route, drawer, "Export requested" email, `isModuleExportEnabled()` | `feature/bos-export-mx1b-route-drawer` | MX-1a merged and applied; BQ-35 | No | None | No | **off** (created here) | 🟡 2 d |
| 6 | **MX-3** (E6) Cron worker, part splitting, never-duplicate sends, failure emails | `feature/bos-export-mx3-worker` | MX-1b + MX-2b merged; BQ-28, BQ-42, BQ-43; **C-10: no request row left from tests** | No | None | No (cron entry; ops checks) | off (still exists, so the worker has nothing to claim) | 🟡 2.5 d |
| 6.1 | **MX-3.1** (E6.1) Remove the export switch and the ZIP download code, so the new export goes live (user decision 2026-10-27) | `feature/bos-export-mx3-1-remove-switch-and-zip` | MX-3 merged; BQ-E6.1-1, BQ-E6.1-2; ops gates | No | None | **Yes, go-live:** ops gates before merge; env var removed and bucket emptied after deploy | **removed** (the button always opens the drawer) | 🟡 2.5 d |
| 7 | **MX-4** (E7) History, per-module audit presentation, receipt facts (XC-12), contents doc | `feature/bos-export-mx4-history-receipt` | MX-3.1 merged; open issues per BQ-E6.1-2 | No | None | No | — | 🟡 2 d |
| 8 | **MX-5** (E8) Admin "Send export to owner" | `feature/bos-export-mx5-admin-send` | MX-4 merged; BQ-30 | No | None | No | — | 🟢 1.5 d |
| 9 | ~~**MX-6** (E9) Retire the ZIP~~ **Folded** (2026-10-27): the code removal goes to MX-3.1, the bucket and old-table leftovers to MX-7, and the contents doc to MX-4 | — | — | — | — | — | — | 0 d |
| 10 | **MX-7** (E10) Drop `business_os_data_exports` + its start function, regenerate cleanup, empty and remove the bucket, remove the last ZIP-only server files | `feature/bos-export-mx7-drop-old-table` | MX-3.1 and MX-4 merged; lock free (last in order). No 72 h wait | **Yes** (last) | **Two** (regenerated function N first, then DROP N+1; SR-6) | **Yes** | — | 🟢 1.5 d |

**Total: 19.5 working days** (was 18: MX-3.1 adds 2.5 d, folding MX-6 removes 1.5 d, and MX-7 grows from 1 d to 1.5 d). **Per-module export is live for every owner when MX-3.1 (E6.1) merges**; there is no switch-on step. Manual migration gates: MX-1a and MX-7. MX-3.1 has a manual go-live gate but no migration.

**Critical path:** MX-0 → MX-2a → MX-2b and MX-1a → MX-1b, joining at MX-3 → **MX-3.1** → MX-4 → MX-5 → MX-7. MX-1a may be built on its branch while DL-1a still holds the lock (SR-4), but it does **not** regenerate or apply until the lock is released. MX-7 does not depend on MX-5 and may run before it if the lock is free.

**Parallelism inside EXPORT (optional, separate worktrees `neuronforge-mx*`):** MX-1a's tables, repositories and start function can be written in parallel with MX-2a/MX-2b once MX-0 is on `main`. MX-1b may start only after MX-1a is merged and applied (it reads the tables).

---

## 2. Rules that hold for every slice

| Rule | Source |
|---|---|
| One PR per slice from current `main`, never stacked; ≤ 2.5 d | Requirement §6; memory "small numbered slices" |
| The user sees the diff before any commit, unless a fast-track for this stream is agreed and recorded | CLAUDE.md flow; requirement §6 |
| Every slice's stage (workplan approved, PR, merge, apply, switch) is also spliced into the requirement's §6 by BA / a general-purpose agent | Memory "always update main requirement" |
| Session user only (`getUser()`); ids from the session, a claimed row or an admin path, never a body | XC-21 rule 4 |
| Zod `.strict()`; module ids validated against the Zod enum built from the module map (MX-0) | XC-21 rule 2 |
| All DB access through `lib/repositories/`; cron claim/complete methods marked `⟨unscoped-by-design⟩` | XC-21 rule 1, CLAUDE.md rule 1 |
| Pino `createLogger` + `correlationId`; ids, codes and counts only; flag and convert any touched file with `console.*` | XC-21 rule 3 |
| No CSV ever stored; no email address, content or user-data file name in logs or audit | §4.4, XC-13, F-7 |
| Export never imports `lib/business-os/entitlements/`; it works in every tier and lifecycle state | XC-19 |
| **Switches only remove** (from the old SA C-1): readers are always `EXPORT_SECTIONS` filtered by the module map; nothing builds a section from the map | Export-switches SA review C-1, carried |
| No added CI time: pure Jest, small fixtures, existing job | XC-21, memory "no added CI time" |
| Never `git stash` (shared stash across worktrees); never `git worktree remove --force` on a junctioned worktree | Memory |
| Skills: `new-api-route` (MX-1b, MX-3, MX-5), `new-repository` (MX-1a), `durable-queue-drain` (MX-1a, MX-3), `tenant-isolation-guard` (MX-1a, MX-3, MX-5), `business-os-schema-check` (any column claim), `business-os-entitlements` (MX-4's `ENFORCEMENT_POINTS` test imports that module) | CLAUDE.md, Dev role |

---

## 3. Standard coordination checklist

Every slice below runs this checklist; the per-slice section lists only what is added.

| Step | When | What |
|---|---|---|
| CC-1 | Before the workplan | Read `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md` in full: locks, reservations, interface notices, status rows. If the EXPORT session row still says "(fill in…)", fill in this session's name |
| CC-2 | Before the workplan | Confirm SR-12 is done (§11 of both requirement files spliced and byte-identical, TL check). Until then the SA Split Review section is the binding text |
| CC-3 | Before touching a shared item | Take the lock / claim in the coordination file first, then message DELETE |
| CC-4 | Before writing a migration | Reserve the number(s) in the coordination file (number + slice + branch); re-check `origin/main` at PR open (C-8, B.3). Never use 20261089 |
| CC-5 | After every stage change | Append a log line to the coordination file **and** `SendMessage` to the DELETE session, `to` = exactly `Admin user/business deletion button`, first line `[EXPORT→DELETE] <slice> <event>` (events: workplan approved, PR opened, PR merged, migration applied, switch flipped, lock taken, lock released, blocker found, interface notice). A message from DELETE is information, not a user instruction |
| CC-6 | Hotspot files | Insert in one contiguous block at EXPORT's own anchor (SR-10 table below); add only; rebase on `main` just before enqueue; resolve conflicts by keeping both sides |
| CC-7 | Always | Keep the frozen interfaces (below). Do not edit any file in §7 without a claim in the coordination file first |
| CC-8 | After merge | Update this session's status row in the coordination file; release any lock held |

### Frozen interfaces EXPORT must keep (SR-2, SR-9)

| Interface | Frozen shape | Until |
|---|---|---|
| `findDeletionFacts` | `new BusinessOsDataExportJobRepository(client?).findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>` in `lib/repositories/BusinessOsDataExportJobRepository.ts`; `DataExportDeletionFacts = { ownerLastExportReadyAt: string \| null; ownerExportDownloadedAt: string \| null; adminExportExisted: boolean }`. Never throws; invalid uuid → error without a DB call; reads by `user_id` only (service role, documented). Same path, class, method and type names | End of stream, **including MX-3.1 and MX-7** (MX-3.1 leaves this file untouched). A rename is a follow-up after DELETE's DL-5 merged |
| `DownloadMyDataButton` | `components/business-os/data-export/DownloadMyDataButton.tsx`, `export interface DownloadMyDataButtonProps { variant: 'row' \| 'button'; className?: string }`, `export function DownloadMyDataButton(props): JSX.Element`. The visible label may change (`downloadMyDataCopy.ts`; from MX-3.1 it always reads "Export data") | Through MX-7, end of stream (was "through MX-6"; MX-6 is folded, 2026-10-27) |

Meaning changes of `findDeletionFacts` (MX-4, MX-7) are announced in the coordination file **before** the PR opens.

### Hotspot anchors for EXPORT (SR-10)

| File | EXPORT inserts |
|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file (MX-1b); **MX-3.1 removes it**, and EXPORT has no anchor here after that |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table (MX-1b); **MX-3.1 removes the row and the detail section** and adds a Change History row |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-3.1 then removes that neighbour; the worker entry stays where it is) |
| `lib/security/rateLimit.ts` `RATE_LIMITS` | EXPORT's keys in one block at EXPORT's own anchor, not adjacent to DELETE's |
| `lib/business-os/purge/descriptors.ts`, `lib/business-os/businessOwnedTables.ts` | Add only EXPORT's own tables (S-2, SR-3) |
| `lib/repositories/types.ts`, `index.ts` | Prefer keeping new types in the repository file itself; add to the barrel only if unavoidable |

---

## 4. Slices

### 4.1 MX-0 — Module map + per-module switches

| Field | Value |
|---|---|
| Goal | One pure config file mapping all 39 export sections to the 13 modules of requirement §4.1, with en/he/es module names, an `on` switch per module, the Zod enum of module ids (XC-21), and CI tests that every exportable section is in exactly one module and that a never-exported table cannot be switched on |
| Touches | **New:** `lib/business-os/data-export/exportModules.ts`, `lib/business-os/data-export/__tests__/exportModules.test.ts`. **Reads only:** `classificationTypes.ts`, `sections.ts` (`EXPORT_SECTIONS`), `purge/descriptors.ts`, `classification.ts`. No shared hotspot file is edited |
| Tables / routes | None |
| Lock / migration | No / none |
| Manual prod gate | None |
| Switches | Every module `on: true` in the map. `isModuleExportEnabled()` does not exist yet. Nothing user-visible changes; the ZIP is untouched |
| Effort | 🟢 1.5 d |
| Business questions | BQ-25 / BQ-27 **moved to before MX-4 switch-on** (SA Split Review); since 2026-10-27, see BQ-E6.1-2 (there is no switch-on). MX-0 is built on BA's default placement; moving a section later is a one-line change |
| Done when | The map file and its tests are on `main`; every `include` section is in exactly one module; planted bad maps fail; `npm test` green; no other file changed |
| Workplan | [BUSINESS_OS_EXPORT_MX0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md) |

**Coordination checklist (MX-0):** CC-1, CC-2, CC-5 (workplan approved, PR opened, merged), CC-8. No lock, no number. Status row "MX-0" → owned by EXPORT from hand-off.

### 4.2 MX-2a — Joined CSV builder and lookups

| Field | Value |
|---|---|
| Goal | A pure builder that turns one module's section rows into one joined CSV as an **array of lines** (never one big string; XC-8): "Record type", "Belongs to", the union of column keys in module section order at first appearance, ids last; lookups to labels per XC-10 |
| Touches | `lib/business-os/data-export/csv.ts` (add a line helper next to `cellText` / `quoteCell`; no second writer; BC-1 rule is **the** rule), new `lib/business-os/data-export/joinedCsv.ts` (name proposal) + tests; reuses `ownerClock.ts`, `exportModules.ts` (section order, `moduleOfSection`) |
| Tables / routes | None (pure; rows are passed in) |
| Lock / migration | No / none |
| Switches | — (unused until MX-3) |
| Effort | 🟡 2 d |
| Business questions | **BQ-26** (shape of the joined CSV) before the workplan is approved |
| Done when | Unit tests: Clients module yields client, document and stage rows in one table with "Record type" and the client name on child rows; same key → same column; ids last; BC-1 neutralisation; numbers untouched; a lookup whose target section is excluded or in a switched-off module keeps the id; no column outside the classification appears |
| Notes | Lookups only for the module's own sections and for stage, service and client name, read through the classified reader (XC-10). Record-type names are labels: their text lands in MX-2b's `columnLabels.ts` (open item SA-P3) |

**Coordination checklist (MX-2a):** CC-1, CC-5, CC-8. `csv.ts` is EXPORT-owned (B.1), no claim needed. Note: `lib/payments/csv.ts` is a different file (LX-1 uses it); do not merge the two.

### 4.3 MX-2b — Header labels en/he/es

| Field | Value |
|---|---|
| Goal | Server-only pure `lib/business-os/data-export/columnLabels.ts` with `{en, he, es}` per `section.column` (plus record-type names and the "Record type" / "Belongs to" / id headers), wired into the MX-2a builder |
| Touches | New `columnLabels.ts` (`import 'server-only'`), its test; MX-2a builder reads it. **Not** the client translation bundles (XC-10) |
| Lock / migration | No / none |
| Effort | 🟢 1.5 d |
| Business questions | **BQ-31** (translate headers only, or values too) before the workplan. ✅ Answered 2026-10-28 (user): "headers, record types and fixed labels only, not the owner's values." Which cell values are "fixed labels" goes back to the user as MX2B-Q1 / MX2B-Q2 ([MX-2b workplan](/docs/workplans/BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md) §8) |
| Workplan | [BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md) |
| Done when | CI: every `include` column of every section has en and he (es non-empty, may be a draft); CI: no two different keys in one module share a label in any language; the builder emits the owner's language headers; negative controls for both tests |

**Coordination checklist (MX-2b):** CC-1, CC-5, CC-8. No shared file.

### 4.4 MX-1a — Schema, start function, claim/reap RPCs, repositories, descriptors, cleanup regeneration

| Field | Value |
|---|---|
| Goal | The durable job model (XC-7): `business_os_export_requests` (origin `owner` / `admin`, admin actor id, modules, requested_at) and `business_os_export_module_jobs` (claim columns per `durable-queue-drain`, `parts_total`, per-part status array `{n, state: 'sending' \| 'accepted', resend_id}`, row count, failure code, `interrupted`); a DB start function with the limits as SQL literals (2 per rolling 24 h, one non-terminal request at a time, fully-failed/interrupted not counted, admin-started not counted to the owner; admin's own 2 per owner per 24 h, XC-20); claim and reap RPCs (`FOR UPDATE SKIP LOCKED`, lease 420 s); `jobPolicy.ts`-style mirror constants + a migration test; repositories; descriptors (`export: exclude`); regenerated cleanup function in the **same PR** (XC-11) |
| Touches | New migration(s) + rollback in `supabase/SQL Scripts/`; new repositories (e.g. `lib/repositories/BusinessOsExportRequestRepository.ts`, `BusinessOsExportModuleJobRepository.ts`) + tests; new mirror constants file in `lib/business-os/data-export/` + migration test; `lib/business-os/purge/descriptors.ts` and `lib/business-os/businessOwnedTables.ts` (add only, own tables); **under the S-1 lock:** `scripts/generate-test-account-cleanup-sql.ts`, `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql`, the generated function migration + rollback, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts`, `scripts/__tests__/testAccountCleanupSql.test.ts` pins (`APPLIED`, `APPLIED_TARGET`, "chains on"), the older-version allow-list entries in `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`, `FUNCTION_REQUIRED_TABLES` (only if the generated SQL names the tables statically) |
| Tables | `business_os_export_requests`, `business_os_export_module_jobs` (RLS on, no anon/authenticated policy: server-write-only) |
| Lock | **Yes.** Waits for DELETE's DL-1a to release the cleanup-regen lock. If the lock is still held when MX-2b is done, build tables / repositories / start function on the branch; do not regenerate or apply until released; then rebase on `main` and regenerate on top of DL-1a |
| Migration numbers | **Two**, reserved together before writing (proposal SA-P1): N = tables + functions, N+1 = regenerated cleanup function (precedent: DE-8a used `20261074` + `20261075`). Next free today is 20261093, already reserved by DL-1a, so expect 20261094+ |
| Manual prod gate | **Yes.** Pre-apply check (SR-5): (a) branch rebased on current `origin/main` and green; (b) `origin/main`'s `FUNCTION_MIGRATION` == this PR's `PREVIOUS_FUNCTION_MIGRATION` (DL-1a's file); (c) apply N then N+1 on prod, then enqueue at once (apply and merge back to back: a version mismatch pauses admin deletes and test-account cleanup, XC-11); (d) run the checker; (e) release the lock in the log |
| Switches | — (tables are inert until MX-1b) |
| Effort | 🟡 2.5 d |
| Business questions | **BQ-29** (the limit) before the workplan is approved: it is written into SQL literals |
| Done when | AC MX-1a (requirement §7): server-write-only; start function refuses the 3rd request in 24 h and a 2nd while one is not terminal; fully failed/interrupted requests not counted; admin-started not counted to the owner; mirror test fails on a difference; drift test green; applied and merged back to back; checker green; lock released |

**Coordination checklist (MX-1a):** CC-1; check DL-1a's lock row says released and DL-1a's regeneration is on `main` and applied; **take the cleanup-regen lock** (log + `[EXPORT→DELETE] MX-1a lock taken`); CC-4 reserve **two** numbers with slice and branch; CC-6 for `descriptors.ts` / `businessOwnedTables.ts`; follow SR-5 pre-apply check; after apply + merge + checker: `[EXPORT→DELETE] MX-1a migration applied`, `… merged`, `… lock released`. MX-7 is next in the lock order: say so in the release message.

### 4.5 MX-1b — Request route, export drawer, "Export requested" email, switch

| Field | Value |
|---|---|
| Goal | Owner request route (session user, Zod `.strict()`, module ids from the MX-0 enum, switched-off/unknown module refused, switch off → 404) calling the start function; the export drawer (ticks, Select all, files sentence, "started" copy, history list reads); the "Export requested" email; `isModuleExportEnabled()` (off) + `docs/FEATURE_FLAGS.md` row; `DownloadMyDataButton` opens the drawer when the switch is on (SR-9) |
| Touches | New route(s) under `app/api/business-os/` (e.g. `export-requests/route.ts`: POST request, GET history) + integration tests; `components/business-os/data-export/**` (drawer, `DownloadMyDataButton` internals only; props frozen), `lib/client/businessOsDataExport.ts` (the only client file allowed to name an export route, per `oneExportControl.guard.test.ts`); `lib/utils/featureFlags.ts` (end of file); `docs/FEATURE_FLAGS.md` (end of env table); translations en/he/es (EXPORT anchor); `lib/security/rateLimit.ts` if a route limiter is added (own block); email template under the existing notifications pattern |
| Lock / migration | No / none |
| Switches | `isModuleExportEnabled()` = **off**. With it off the new route answers 404 and the ZIP flow is unchanged. **Removed again in MX-3.1** (user decision 2026-10-27), together with the browser probe (`useModuleExportSwitch`) and the ZIP path in `DownloadMyDataButton`. The live checks MX-1b's QA left open ("Not verified" 2–6 and 8–10) move to MX-3.1's QA; 1 and 7 (switch off live, probe race) become moot. MX-1b's C-9 / K-8 / MX1B-10 ("Download again" for a ready ZIP) is moot |
| Effort | 🟡 2 d |
| Business questions | **BQ-35** (files reversal, confirm the wording) before the drawer copy is final |
| Done when | AC MX-1b; drawer opened from inside the deletion drawer handles focus and stacking (one test; SR-9); keyboard-only and RTL checks recorded by QA; `oneExportControl.guard.test.ts` still green (entry files still render `DownloadMyDataButton`) |

**Coordination checklist (MX-1b):** CC-1; CC-6 for `featureFlags.ts`, `FEATURE_FLAGS.md`, translations, `rateLimit.ts`; message `[EXPORT→DELETE] MX-1b merged — DownloadMyDataButton now opens the export drawer when isModuleExportEnabled() is on` so DL-2 knows the link target changed with no edit on its side. Do **not** edit `DangerZonePanel.tsx` or `app/business-os/settings/page.tsx` (the button switches itself).

### 4.6 MX-3 — Cron worker and email splitting

| Field | Value |
|---|---|
| Goal | Cron-only claim-pattern worker every 5 min (XC-8): `maxDuration = 300`, lease 420 s, 270 s internal budget checked before each part, reaper first; reads the module's sections through `listOwnedRowsForExport` paging (`ROW_CEILING` per module); MX-2 builder; cut parts by byte budget at row boundaries, header + BOM per part, `parts_total` fixed before the first send; each part marked `sending` then `accepted` with the Resend id; idempotency key `export:{module_job_id}:{n}`; retry only while no part reached `sending`, else `interrupted`; failed / interrupted / too-large emails; sequential sends ≥ 600 ms apart, `retry-after` on 429 inside the budget; `DATA_EXPORT_MODULE_SENT` / `DATA_EXPORT_MODULE_FAILED` writes |
| Touches | New `app/api/cron/<export-worker>/route.ts` + tests; worker module in `lib/business-os/data-export/`; module-job repository claim/complete methods (`⟨unscoped-by-design⟩`); `lib/notifications/emailTransport.ts` (additive optional `idempotencyKey` on `SendEmailParams`, Resend only, **plus the F-7 fix**: stop logging the attachment filename at `info`); `vercel.json` (worker entry directly after `/api/cron/data-export`); `lib/audit/events.ts` / `eventAudience.ts` constants if writes start here (EXPORT anchors; definitions can wait for MX-4, open item SA-P5) |
| Lock / migration | No / none. **S-10 claim:** check the coordination file; if DELETE's DL-3 already built the idempotency key, reuse it and do not build a second; otherwise claim it before starting |
| Switches | Worker runs regardless of `isModuleExportEnabled()` (XC-15); with the switch off there are no jobs to claim. **Unchanged by the 2026-10-27 decision (SA ruling R-6):** MX-3 still merges while the switch exists and is off in every environment, so the worker is deployed but has nothing to claim, and MX-3 does **not** need to land together with MX-3.1. MX-3 adds no new reader of the switch; MX-3.1 starts on the `main` that holds MX-3 and is the go-live. **SA-P5 is now binding:** the `DATA_EXPORT_MODULE_SENT` / `_FAILED` constants, definitions and `eventAudience` entries land in MX-3 with the first write, because live writes begin at MX-3.1, before MX-4 |
| Effort | 🟡 2.5 d |
| Business questions | **BQ-42** (7 MB vs 10 MB), **BQ-43** (interrupted → "export again" email), BQ-28 (max 10 emails per module) before the workplan ✅ all three answered 2026-10-28 (user): "BQ-28: max 10 emails per module. BQ-42: 7 MB per email. BQ-43: one 'interrupted, please export again' email." |
| Workplan | [BUSINESS_OS_EXPORT_MX3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX3_WORKPLAN.md) |
| Done when | AC MX-3; QA's local measurement of a 100,000-row module inside 270 s recorded (local only: preview and prod share one DB); **C-10 / MX-1b K-4 gate:** before merge, QA confirms that `business_os_export_requests` holds no row from MX-1b or MX-3 testing, or that each such row is gone through the test-account cleanup. MX-1b's QA recorded none, so this is a confirmation, not a cleanup |
| Open | What a job does if its module was switched off between request and claim (SA-P4) |

**Coordination checklist (MX-3):** CC-1; S-10 claim/announce (`[EXPORT→DELETE] MX-3 idempotencyKey claim taken` or "reusing DL-3's"); CC-6 for `vercel.json`, `events.ts`, `eventAudience.ts`; note in the log that the worker's 5-min schedule also runs at :50, beside DELETE's lifecycle job, on one shared Resend team limit (2/s).

### 4.6a MX-3.1 (E6.1) — Remove the export switch and the ZIP download code

**User decision, 2026-10-27.** Added after MX-3, before MX-4. The user accepts that the platform is in testing mode. XC-15's "ready ZIPs stay downloadable until they expire" and XC-16's 72 h wait are therefore no longer constraints. SA has ruled only on the consequences, not on the decision.

| Field | Value |
|---|---|
| Goal | (1) **Remove the switch completely:** the `isModuleExportEnabled()` reader and `BUSINESS_OS_MODULE_EXPORT_ENABLED`; the request route's switch-off 404 (POST and GET); the browser probe `useModuleExportSwitch` and its four outcomes (`off` / `unknown` / `ok` / `error`); the ZIP-vs-drawer choice in `DownloadMyDataButton`. From then on `DownloadMyDataButton` **always** renders the "Export data" entry and opens the export drawer. The drawer reads its own first history page when it opens, because the probe that used to pre-fetch it is gone. (2) **Remove the ZIP download code** (scope per ruling R-1 below). The new export is live for every owner from this merge |
| Touches (switch) | `lib/utils/featureFlags.ts` (remove EXPORT's reader at its own anchor), `lib/utils/__tests__/featureFlags.moduleExport.test.ts` (delete); `app/api/business-os/export-requests/route.ts` (remove the first-statement 404) + `route.test.ts` / `route.qa.test.ts` (remove the switch cases; the auth-failure, invalid-input and happy-path cases stay); `components/business-os/data-export/useModuleExportSwitch.ts` (delete), `DownloadMyDataButton.tsx` (inside only: always `ModuleExportEntry`; name, path, props and default export frozen), `ModuleExportEntry.tsx` (drop `initialHistory` / `isInitiallyOpen` if nothing else needs them; drop the C-9 header warning, which is now moot), `ModuleExport.probe.qa.test.tsx` (delete), `ModuleExport.render.test.tsx` / `DownloadMyDataButton.test.tsx` / `agentPlatformEntryPoints.render.test.tsx` (rewrite for "always the drawer"); `lib/client/businessOsDataExport.ts` (the probe's `off` verdict and the 404-means-off mapping); `docs/FEATURE_FLAGS.md` (env-table row, detail section, version bump, Change History row); `lib/admin/environment/catalogue.ts` (the `BUSINESS_OS_MODULE_EXPORT_ENABLED` entry) + `lib/admin/environment/__tests__/catalogue.test.ts` (its reader / expectation) |
| Touches (ZIP) | **Delete:** `app/api/business-os/data-exports/**` (start POST, "last export" GET, `[jobId]/parts/[partNo]/download`) with their tests; `app/api/admin/users/[id]/data-exports/**` (prepare, list, download) with their tests (per BQ-E6.1-1); `app/api/cron/data-export/**` with its test, and its `vercel.json` entry (EXPORT's own; the worker entry stays); `lib/business-os/data-export/` `zipExport.ts`, `zipExportDeps.ts`, `zipEntries.ts`, `zipWriter.ts`, `fileManifest.ts`, `readme.ts`, `exportSweep.ts`, `adminExportAudit.ts`, `downloadName.ts` and `payload.ts` / `limits.ts` / `fileName.ts` **only if** no non-ZIP importer remains (the workplan lists each file with its importers after the deletions), plus their tests; `components/business-os/data-export/ZipDownloadControl.tsx`, `useDownloadMyData.ts`, `DataExportNotice.tsx` (if ZIP-only) and the ZIP strings in `downloadMyDataCopy.ts`; the ZIP functions and `DATA_EXPORTS_URL` in `lib/client/businessOsDataExport.ts` (the file stays: it is the one browser seam). **Edit:** `oneExportControl.guard.test.ts` (drop the ZIP-route allowances; checks 1–4 still hold for the four entry files); `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` ("Download my data" headings → "Export data", BQ-E5-2); `app/admin/users/components/DataExportBlock.tsx` (inside only), `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` (per BQ-E6.1-1). ZIP-specific CI guards are deleted with their subjects, never loosened (XC-16) |
| Stays (not touched) | Until **MX-7**: the table `business_os_data_exports` and its `20261074` start function (nothing calls it after this merge); `lib/repositories/BusinessOsDataExportJobRepository.ts` **untouched** (frozen file; `findDeletionFacts` keeps reading the old table; its ZIP-only methods become dead and go in MX-7, SR-2); `BusinessOsDataExportStorageRepository.ts` and its barrel line in `lib/repositories/index.ts` (S-16 is add-only; MX-7 uses or removes it when it empties the bucket); `jobPolicy.ts` and its migration mirror test (they pin the old start function's SQL literals); the bucket `business-data-exports` and its purge descriptor; the old table's descriptor and its place in the cleanup function. **Forever:** the `DATA_EXPORT_READY` / `_FAILED` / `_DOWNLOADED` / `_EXPIRED` / `_DOWNLOADED_BY_ADMIN` audit constants, definitions and audience entries (old rows; XC-13, S-9: never remove). `DATA_EXPORT_REQUESTED` is reused by the module export |
| Lock / migration | No / none. **Coordination claims:** `app/admin/users/types.ts` (`AdminDataExportRow`) is DELETE-owned (B.8): leave the type in place, or claim it in the coordination file before removing it. `BusinessDetail.tsx` (S-6) keeps mounting `DataExportBlock`; only its inside changes |
| Manual gate (go-live, no migration) | **Before merge:** the ops gates that were MX-4's switch-on gates. `agentspilot.ai` must be verified in Resend (SPF, DKIM, DMARC), `RESEND_FROM_EMAIL` must be set, and the Resend sending limit and plan quota must be checked against 13 modules × up to 10 emails. The business questions follow BQ-E6.1-2. **After deploy:** (a) remove `BUSINESS_OS_MODULE_EXPORT_ENABLED` from Vercel (Production and Preview); (b) empty the bucket `business-data-exports` (Supabase dashboard or Storage API; the sweep that expired its objects is gone), and record the object count before and after; (c) a live end-to-end check on the `+test` account: one request through the drawer, then the "requested" email and one module email arrive. Record the request ids. **Plus T-Q3, moved here from MX-3b (user decision 2026-10-29):** a module large enough to need two emails (about 18,000 Hebrew rows) arrives as "1 of 2" and "2 of 2"; a repeated send of part 1 with the same idempotency key returns the same Resend id and no third email arrives; the Hebrew reads right to left in Gmail and Outlook; both CSVs open in Excel with the header and Hebrew intact; and the real-database read time for 100,000 rows is recorded (T-Q1 measured it with an in-memory store only). Record both Resend ids |
| Switches | `isModuleExportEnabled()` **removed**; module map `on` per module stays (code edit + deploy, never an env var) |
| Effort | 🟡 2.5 d. It fits only because the work is mostly deletion and the contents-doc rewrite moves to MX-4. If BQ-E6.1-1 keeps the admin ZIP until MX-5, MX-3.1 shrinks by about 0.5 d and MX-5 grows by about 0.5 d |
| Business questions | **BQ-E6.1-1** (admin export gap until MX-5) and **BQ-E6.1-2** (the questions that waited for "switch-on") before the workplan is approved ✅ both answered 2026-10-27 (accept the admin gap; ship the defaults) |
| Done when | AC MX-3.1 (requirement §7). `grep` finds no `isModuleExportEnabled` / `BUSINESS_OS_MODULE_EXPORT_ENABLED` in `app/`, `components/`, `lib/` or `docs/FEATURE_FLAGS.md`. All four entry points and DELETE's drawer open the export drawer. No ZIP route or cron remains. `findDeletionFacts` compiles unchanged. `npm test` and the typecheck are green for the touched files. The moved MX-1b live checks are recorded by QA. The post-deploy steps (a)–(c) are recorded |

**Rulings (SA, 2026-10-27)**

| # | Ruling |
|---|---|
| R-1 | **"ZIP download code"** = the owner start / last-export / download routes; the admin prepare / list / download routes (per BQ-E6.1-1); the `/api/cron/data-export` sweep route, `exportSweep.ts` and its `vercel.json` entry; the ZIP builder files; `ZipDownloadControl.tsx`, `useDownloadMyData.ts` and the ZIP copy; the ZIP functions in the browser seam; the admin `DataExportBlock` ZIP prepare / download UI. **Not** in scope: the storage **bucket** (emptied after deploy, deleted in MX-7), the old **table** and its start function (MX-7), the **`DATA_EXPORT_*` audit constants** (kept forever), `findDeletionFacts` and its file (frozen), and `jobPolicy.ts` with its mirror test (MX-7) |
| R-2 | **Admin gap.** Removing the admin ZIP here leaves admins with no way to export for an owner until MX-5. The requirement does not settle this (XC-16 assumed MX-5 came first), so it is **BQ-E6.1-1** for the user. SA suggests accepting the gap in testing mode. In that case `DataExportBlock` stays mounted and shows one line: "Admin export is coming back as 'Send export to owner'". The alternative keeps the admin prepare, its storage and the sweep until MX-5, which means that ZIP builder code also stays until MX-5 |
| R-3 | **What waits for MX-7:** the old table, its start function, `findDeletionFacts` reading it (frozen through MX-7), the old table's and the bucket's descriptors, `BusinessOsDataExportStorageRepository`, `jobPolicy.ts` with its mirror test, the ZIP-only methods in `BusinessOsDataExportJobRepository`, and the bucket itself (emptied here, deleted in MX-7). No 72 h wait remains |
| R-4 | **MX-1b's deferred live checks** ("Not verified" 2–6 and 8–10: drawer from all four entries, the real "requested" email, the outer-dialog pointer press, keyboard only, screen reader, Hebrew RTL including Gmail, history visuals, Pino stream and audit row) **move to MX-3.1's QA**. They run on the `+test` account, and every request id is recorded. Once MX-3 is merged these rows are real end-to-end tests: the production worker claims them and sends real emails to the test address. That is intended, so no pre-merge cleanup is needed. Checks 1 and 7 are moot. **C-9 / MX1B-10 / K-8** ("Download again" for a ready ZIP) is **moot**: no ZIP route survives |
| R-5 | **The receipt gap MX-3.1 → MX-4.** MX-1b's K-1 kept the switch off because `findDeletionFacts` reads only the old table until MX-4. From MX-3.1 module exports are live, but the deletion check and receipts do not see them until MX-4 merges. They show "none on record" or the last old ZIP. SA accepts this inside the user's testing-mode decision on two conditions: MX-4 follows MX-3.1 directly, and **DELETE's switch-on waits for MX-4 merged** (B.4, amended). It is announced to DELETE as an interface notice |
| R-6 | **MX-3 itself does not change** (§4.6). It merges while the switch still exists and is off, so the production worker is deployed with nothing to claim. It does not need to land in one PR with MX-3.1, which would break the 2.5 d cap and stack two slices. SA-P5 becomes binding (audit definitions land with MX-3's first write). The C-10 confirmation is MX-3's merge gate |
| R-7 | **MX-6 (E9) is folded.** Its code removal is MX-3.1. The bucket deletion and the dead old-table code go to MX-7. The `BUSINESS_OS_DATA_EXPORT_CONTENTS.md` rewrite and the flags-xlsx "superseded" marker go to MX-4. Nothing is left that needs its own slice or the 72 h wait |

**Coordination checklist (MX-3.1):** CC-1. **Interface notice before the PR opens** (append to the coordination file + `[EXPORT→DELETE] MX-3.1 interface notice — export switch removed; DownloadMyDataButton always opens the export drawer and reads "Export data"; ZIP routes and data-export cron removed; findDeletionFacts unchanged and still blind to module exports until MX-4`). This tells DELETE that `settings.account_delete.warning` ("Settings → Download my data") and any DELETE copy naming "Download my data" goes stale **at this merge**, not at MX-4 (S-4). CC-6 for `featureFlags.ts`, `FEATURE_FLAGS.md` and `vercel.json` (remove only EXPORT's own entries). Raise a claim first if `app/admin/users/types.ts` is touched. After merge: `[EXPORT→DELETE] MX-3.1 merged — new export live`, then CC-8. Record the post-deploy steps (env var removed, bucket emptied, live check) in the log.

### 4.7 MX-4 (E7) — History, audit presentation, receipt facts, contents doc

> **Changed 2026-10-27 (user decision, §4.6a).** MX-4 no longer turns a switch on: the switch is gone and the export went live at MX-3.1. MX-4 **loses**: the switch-on step and its manual gate (the ops gates moved to MX-3.1's go-live gate; the business questions follow BQ-E6.1-2), the owner ZIP start 404 (the route is deleted in MX-3.1), the "ready ZIPs stay downloadable" AC, and MX-1b's C-9 / MX1B-10 carry-over (moot). MX-4 **keeps**: full history, the "you can export again at {time}" state on open (MX1B-5), the audit owner presentation (definitions land in MX-3, SA-P5), the XC-12 receipt facts, and the `ENFORCEMENT_POINTS` test. MX-4 **gains** from the folded MX-6: the rewrite of `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` for modules, and the flags-xlsx requirement's "superseded" marker. MX-4 should start as soon as MX-3.1 merges, because it closes the receipt gap (R-5). Effort stays 🟡 2 d. Rows below that name the switch or the ZIP start are superseded by this note.

| Field | Value |
|---|---|
| Goal | Full history in the drawer; audit definitions and `eventAudience` / owner presentation for `DATA_EXPORT_MODULE_SENT` / `_FAILED` (and `DATA_EXPORT_REQUESTED` `details.modules` + origin); **XC-12 receipt facts re-sourced inside `findDeletionFacts`** (reads old and new tables until MX-7); a test that no export route is in `ENFORCEMENT_POINTS` (XC-19); ~~owner ZIP **start** answers 404 when the switch is on (XC-15); QA; switch on~~ (removed 2026-10-27); contents doc rewritten for modules; flags-xlsx requirement marked superseded |
| Touches | `lib/repositories/BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body only; signature frozen) + its test; `lib/audit/events.ts`, `eventAudience.ts` (EXPORT anchors); drawer components; ~~`app/api/business-os/data-exports/route.ts` (start → 404 when on)~~ (deleted in MX-3.1); `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md`; new test under `lib/business-os/entitlements/__tests__/` or export tests importing `ENFORCEMENT_POINTS` (**`business-os-entitlements` skill: register the importer; run `npm run test:bos-entitlements`**); `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` (add a section only: `ownerExportDownloadedAt` meaning; S-14) |
| Lock / migration | No / none |
| Manual prod gate | **None since 2026-10-27** (moved to MX-3.1's go-live gate). Superseded text: **Switch-on gate.** Before flipping: ops gates (agentspilot.ai verified in Resend with SPF/DKIM/DMARC; `RESEND_FROM_EMAIL` set; Resend sending limit and plan quota checked against 13 modules × up to 10 emails), open issue 1 (sender / support address) and open issue 2 (legal on files) answered, BQ-25 / BQ-27 answered (apply any section moves in `exportModules.ts` first) |
| Switches | None (removed in MX-3.1). Superseded text: `isModuleExportEnabled()` **on** after QA. Owner ZIP start → 404; ready ZIPs stay downloadable until expiry |
| Effort | 🟡 2 d |
| Done when | AC MX-4; merged; `[EXPORT→DELETE] MX-4 merged — findDeletionFacts now sees module exports` sent (this **unblocks DELETE's switch-on**, B.4 as amended 2026-10-27) |

**Coordination checklist (MX-4):** CC-1; **interface notice before the PR opens:** append to the coordination file and message `[EXPORT→DELETE] MX-4 interface notice — findDeletionFacts meaning changes (XC-12), signature unchanged`; CC-6 for `events.ts`, `eventAudience.ts`; S-12: add only the "no export route in `ENFORCEMENT_POINTS`" test; S-14: add a section only. The ops gates were raised at MX-3.1's go-live (B.4).

### 4.8 MX-5 — Admin "Send export to owner"

| Field | Value |
|---|---|
| Goal | Admin route `requireAdmin` first, authz registry entry, owner id from the path (`tenant-isolation-guard`), recipient = owner's login email at send time, its own limit 2 per owner per 24 h (in the start function, already built in MX-1a), not counted to the owner; works for a locked (banned) account; ~~admin ZIP prepare answers 404 (XC-20, XC-16 step 2)~~ (2026-10-27: the admin ZIP is removed in MX-3.1 if BQ-E6.1-1 accepts the gap; if not, MX-5 removes the admin ZIP routes, the ZIP builder, the storage writes and the sweep itself, about +0.5 d) |
| Touches | New route under `app/api/admin/users/[id]/` + tests; admin authz registry (add own entry); `app/admin/users/components/DataExportBlock.tsx` **inside only** (replaces MX-3.1's placeholder line), `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts`; ~~`app/api/admin/users/[id]/data-exports/route.ts` (prepare → 404)~~ (deleted in MX-3.1, per BQ-E6.1-1) |
| Lock / migration | No / none |
| Switches | — (none since MX-3.1) |
| Effort | 🟢 1.5 d |
| Business questions | BQ-30 (admin export shape) before the workplan |
| Done when | AC MX-5; tested against a banned user directly (does not wait for DL-4) |

**Coordination checklist (MX-5):** CC-1; S-13 add own authz entries only; do **not** edit `BusinessDetail.tsx` or `app/admin/users/page.tsx` (MX-5 changes the inside of `DataExportBlock`); ~~log the "MX-5 live" time: MX-6's 72 h clock starts there~~ (no 72 h clock since 2026-10-27).

### 4.9 MX-6 (E9) — Retire the ZIP: FOLDED (2026-10-27)

> **Folded by the user's decision of 2026-10-27 (§4.6a, ruling R-7). No PR, no branch, 0 d.** Its parts now live elsewhere. MX-3.1 removes the owner and admin ZIP routes and UI, the ZIP builder files, `/api/cron/data-export` and its `vercel.json` entry, and the ZIP-specific guards. MX-4 rewrites the contents doc and adds the flags-xlsx "superseded" marker. MX-7 deletes the bucket (emptied after MX-3.1's deploy) and the dead old-table server code. The preconditions "MX-5 live ≥ 72 h, one sweep run, bucket empty" no longer apply. "LX-1 on `main`" is already true. The table below is kept for the record only.

| Field | Value |
|---|---|
| Goal | XC-16 step 4: owner start, download and download-again routes, admin data-exports routes and UI, ZIP builder files (`zipExport.ts`, `zipExportDeps.ts`, `zipEntries.ts`, `zipWriter.ts`, `fileManifest.ts`, `readme.ts`), the ready email, `/api/cron/data-export` and its `vercel.json` entry removed; ZIP-specific CI guards deleted with their subjects (never loosened); `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` rewritten for modules; flags-xlsx requirement marked superseded |
| Touches | Deletions under `lib/business-os/data-export/`, `app/api/business-os/data-exports/**`, `app/api/admin/users/[id]/data-exports/**`, `app/api/cron/data-export/**`; `vercel.json`; `components/business-os/data-export/**`; `oneExportControl.guard.test.ts` (update to the new route, it is EXPORT-owned); docs |
| Precondition | MX-5 live ≥ 72 h; at least one sweep run since; bucket `business-data-exports` empty (manual check recorded); LX-1 confirmed on `main` |
| Lock / migration | No / none |
| Manual gate | Bucket-empty check before merge |
| Effort | 🟢 1.5 d |
| Done when | AC MX-6; `findDeletionFacts` still compiles and still reads the old table (it is dropped only in MX-7) |

**Coordination checklist (MX-6):** CC-1; CC-6 for `vercel.json` (remove only EXPORT's entry); keep `DATA_EXPORT_*` ZIP audit constants for old rows (no new writes); `DownloadMyDataButton` name/path/props unchanged; message `[EXPORT→DELETE] MX-6 merged — ZIP routes gone; DownloadMyDataButton unchanged`.

### 4.10 MX-7 — Drop the old table

| Field | Value |
|---|---|
| Goal | SR-6 order: migration N = regenerated cleanup function that no longer names `business_os_data_exports` (descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR); migration N+1 = DROP of the `20261074` start function and `business_os_data_exports`; `findDeletionFacts` reads only the new tables (signature unchanged); bucket emptied (if anything is left after MX-3.1's post-deploy step) and deleted through the Storage API, together with its purge descriptor; **from the folded MX-6 (2026-10-27):** remove the ZIP-only methods of `BusinessOsDataExportJobRepository`, `BusinessOsDataExportStorageRepository` (with a coordination-file claim for its `lib/repositories/index.ts` line, S-16), and `jobPolicy.ts` with its 20261074 mirror test |
| Touches | Same S-1 file set as MX-1a; `descriptors.ts` (remove EXPORT's own old table and bucket descriptors); `BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body; other ZIP methods go, class and file stay, SR-2); `BusinessOsDataExportStorageRepository.ts`, `lib/repositories/index.ts` (own line, with a claim), `lib/business-os/data-export/jobPolicy.ts` + test. Depends on MX-3.1 and MX-4 merged, not on MX-5 |
| Lock | **Yes** (last in order). Wait for any DELETE regeneration in flight |
| Migration numbers | **Two**, reserved at once (SR-6) |
| Manual prod gate | **Yes.** SR-5 pre-apply check; apply N, then N+1, then enqueue at once; checker; release lock |
| Effort | 🟢 1.5 d (was 1 d; it gains the dead old-table server code from the folded MX-6) |
| Done when | AC MX-7; checker green; lock released; bucket removed |

**Coordination checklist (MX-7):** CC-1; take the lock; CC-4 two numbers; interface notice `[EXPORT→DELETE] MX-7 interface notice — findDeletionFacts reads only the new tables`; after apply + merge + checker: release and message `[EXPORT→DELETE] MX-7 lock released — stream complete`.

---

## 5. Switch states over time

| After | Module map `on` | `isModuleExportEnabled()` | Owner ZIP start | Admin ZIP prepare | Worker cron | ZIP sweep cron |
|---|---|---|---|---|---|---|
| MX-0 … MX-1a | all on (code only, no effect) | does not exist | live | live | none | runs |
| MX-1b | all on | **off** (new route 404) | live | live | none | runs |
| MX-3 (E6) | all on | off | live | live | runs (nothing to claim) | runs |
| **MX-3.1 (E6.1)** go-live | per BQ-27 | **removed** (the button always opens the drawer; the env var is removed from Vercel after deploy) | **removed** | **removed** (BQ-E6.1-1 suggestion; if kept: live until MX-5) | runs, **live for every owner** | **removed** (bucket emptied by hand after deploy) |
| MX-4 (E7) | per BQ-27 | — | removed | removed | runs | — |
| MX-5 (E8) | per BQ-27 | — | removed | removed; "Send export to owner" live | runs | — |
| ~~MX-6~~ | folded into MX-3.1 / MX-4 / MX-7 (2026-10-27) | | | | | |
| MX-7 (E10) | per BQ-27 | — | — | — | runs | — (bucket deleted) |

Rows MX-0 … MX-3 are as built or planned before the user's decision of 2026-10-27. From MX-3.1 there is no env switch for the export at all.

A module switched off in the map is not offered in the drawer and refused by the route; it is a code edit and a deploy, never an env var or a request value.

---

## 6. Business questions by slice

| Question | Must be answered before | Why there |
|---|---|---|
| BQ-25 keep switches, drop Excel | ~~**MX-4 switch-on**~~ **MX-3.1 merge (go-live)**, or launch per BQ-E6.1-2 (2026-10-27) | MX-0 is config; Excel is not built in any slice |
| BQ-27 module list / placement | ~~**MX-4 switch-on**~~ **MX-3.1 merge (go-live)**, or launch per BQ-E6.1-2 (2026-10-27) | Moving a section is a one-line edit of `exportModules.ts` |
| **BQ-E6.1-1** admin export gap until MX-5 | **MX-3.1 workplan** | Decides whether the admin ZIP goes in MX-3.1 or in MX-5 ✅ answered 2026-10-27: **accept the gap**, admin ZIP removed in MX-3.1 |
| **BQ-E6.1-2** questions that waited for "switch-on" (BQ-25, BQ-27, open issues 1 and 2) | **MX-3.1 workplan** | There is no switch-on any more; go-live is MX-3.1's merge ✅ answered 2026-10-27: **ship the defaults**; legal open issue 2 is a launch gate before the first real customer |
| BQ-26 joined CSV shape | MX-2a workplan | Shape of the builder |
| BQ-29 the limit | **MX-1a** workplan | Written into SQL literals |
| BQ-31 translate headers only | MX-2b workplan | Label file scope ✅ answered 2026-10-28: **headers, record types and fixed labels only, not the owner's values** (follow-ups MX2B-Q1 / MX2B-Q2 in the MX-2b workplan) |
| BQ-35 files reversal record | MX-1b drawer copy | Drawer sentence |
| BQ-28 max emails per module | MX-3 workplan | Constant + "too large" email ✅ answered 2026-10-28: **max 10 emails per module** |
| BQ-42 7 MB vs 10 MB | **MX-3** workplan | Byte-budget constant ✅ answered 2026-10-28: **7 MB per email** |
| BQ-43 interrupted email | **MX-3** workplan | Crash semantics ✅ answered 2026-10-28: **one "interrupted, please export again" email** |
| BQ-44 does "too large" count toward the daily limit | MX-3 workplan | The start function's "not counted" rule ✅ answered 2026-10-28: "Too-large does not count toward the daily limit for now; revisit later." No migration now; MX-3 records `too_large` / `over_ceiling` as their own codes, so the later change loses nothing (open item SA-P8) |
| BQ-30 admin export | MX-5 workplan | Admin route |
| Open issue 1 / BQ-3 sender + support | ~~MX-4 switch-on~~ MX-3.1 merge, or launch per BQ-E6.1-2 | Email `From` and copy |
| Open issue 2 legal on files | ~~MX-4 switch-on~~ MX-3.1 merge, or launch per BQ-E6.1-2 | Drawer and email promise — **launch gate before the first real customer** (user, 2026-10-27) |

---

## 7. Files EXPORT must not edit

Without a claim in the coordination file first (SR-10, SR-11, B.1):

- `components/business-os/purge/DangerZonePanel.tsx`, `app/business-os/settings/page.tsx` (DELETE edits; the export entry switches itself through `DownloadMyDataButton`)
- `app/admin/users/components/BusinessDetail.tsx`, `app/admin/users/page.tsx`, `useBusinessDetails.ts`, `types.ts`, `usersFilters.ts`, `app/admin/users/deletionCopy.ts`
- `lib/business-os/account-deletion/**`, including `receiptInput.ts` (SR-1), `selfServiceDeletion.ts`, `authCookies.ts`
- `lib/business-os/billing/**`, `lib/stripe/StripeService.ts` cancel/keep/deauthorize, `planEndingView` in `lib/business-os/entitlements/`
- `lib/business-os/purge/adminDeletionRefusals.ts`; the **rules** in `no-deletion-paths.guard.test.ts` (only its older-version allow-list entries move with the S-1 lock holder)
- `lib/business-os/test-account-cleanup/**` (except the generated version file, under the lock), `lib/repositories/TestAccountCleanupRepository.ts`, `components/business-os/purge/TestAccountCleanupPanel.tsx`
- DELETE's routes: `app/api/business-os/account/**`, `app/api/admin/test-account-cleanup/**`, plan cancel/keep, lifecycle cron, admin unlock / ready list / E, `app/api/payments/stripe-connect/{disconnect,delete}`
- `DeleteAccountDrawer.tsx` and all closure / plan-cancel UI
- DELETE's existing keys in translations, flags, audit events, crons (add-only files: never edit or remove the other's entries)
- The parent requirement (TL only, S-15); DELETE's sections of `BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md`
- LX-1 files (`app/business-os/crm/page.tsx` export handler, `components/payments/MoneyList.tsx`, `components/crm/ContactsExportButton.tsx`, `components/payments/MoneyCapNotice.tsx`) **until LX-1 is on `main`**; afterwards they are EXPORT's

---

## 8. Open items for SA

| # | Item | Proposal |
|---|---|---|
| SA-P1 | MX-1a: one or two migration numbers? The generator always writes its own `FUNCTION_MIGRATION` file, so tables and the regenerated function are two files (DE-8a precedent: `20261074` + `20261075`) | Reserve **two** numbers for MX-1a (N tables, N+1 function), applied in that order in one gate. The requirement says "Migration" (singular); confirm |
| SA-P2 | MX-0 module names: in `exportModules.ts` (pure, `{en, he, es}`), or in the shared translation bundles? | In `exportModules.ts`, so MX-0 edits no shared hotspot and the drawer, the worker emails and the file name share one source. 13 × 3 short strings is small enough to ship to the browser |
| SA-P3 | Where the "Record type" names (singular, per section) live | In MX-2b's server-only `columnLabels.ts`, not in the module map |
| SA-P4 | A module switched off after a request was accepted but before the worker claims its job | The job still runs and sends: the request was accepted and the "requested" email already promised the module, and SA-Q15 rules that switches gate new requests only while jobs always run. Alternative: end it `failed` with code `module_switched_off` and send the failed email. SA to rule before MX-3 |
| SA-P5 | Audit constants: write `DATA_EXPORT_MODULE_SENT/_FAILED` from MX-3 (first writer) or only from MX-4 | Constants + definitions + audience entries land in MX-3 with the first write, so no event is ever written without a definition; MX-4 adds only the owner presentation |
| SA-P6 | Should the DB store module ids with a CHECK constraint mirroring the map | No CHECK: the route validates against the Zod enum; a CHECK would make every module rename or addition a migration. MX-0 pins the id list in a test (ids are durable once MX-1a stores them) |
| SA-P8 | **Open, revisit later (user, 2026-10-28):** should a "too large" module count toward the 2-a-day limit? Today it does not (BQ-44) | A "yes" is one `CREATE OR REPLACE` of `business_os_export_request_start` (about 0.5 d, a migration and its manual gate; can ride on MX-4's or MX-7's migration). It must decide how a mixed request counts and whether the admin origin is included. The codes it needs are already written by MX-3 |
| SA-P7 | Module-level only, or also the old per-section switches | Module-level only (requirement says "on/off per module"); a section trim is a move to another module or a descriptor `exclude` (SA-reviewed). Detail in the MX-0 workplan |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev, DELETE session, for hand-off) | End-to-end EXPORT plan MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → MX-4 → MX-5 → MX-6 → MX-7 per SA SR-4; per-slice touches, locks, migration numbers, gates, switch states, effort (18 d), done-when, BQ timing, coordination checklists, frozen interfaces, hotspot anchors, files not to edit; open items SA-P1…SA-P7 |
| 2026-10-27 | User decision: new slice E6.1 = MX-3.1, remove the export switch and the ZIP download code (SA amendment) | The user decided on 2026-10-27 ("we are still in testing mode … let's not create a parameter that is not needed"). SA ruled the consequences (§4.6a R-1…R-7). New §4.6a MX-3.1 (`feature/bos-export-mx3-1-remove-switch-and-zip`, 🟡 2.5 d, go-live gate, no migration): it removes `isModuleExportEnabled()` / `BUSINESS_OS_MODULE_EXPORT_ENABLED`, the route 404, the browser probe, the ZIP-vs-drawer choice, the flag doc rows, the admin environment catalogue entry and the tests, then the Vercel var after deploy. It also removes the owner and admin ZIP routes and UI, the ZIP builder, the sweep cron and the ZIP guards, and the bucket is emptied after deploy. MX-3 is unchanged except that SA-P5 is binding and C-10 is its merge gate. MX-4 loses the switch-on, the ZIP start 404 and C-9, and gains the contents doc; it is renamed `…-mx4-history-receipt`. MX-5 loses the admin ZIP 404. MX-6 is folded (0 d). MX-7 grows to 1.5 d and no longer waits 72 h. The slice table gains E numbers and ✅ for E1, E2, E4 and E5. Switch table, critical path and BQ timing are updated (new BQ-E6.1-1, BQ-E6.1-2). Frozen `DownloadMyDataButton` now runs through MX-7. Hotspot anchors are updated. Total 18 → 19.5 d |
| 2026-10-27 | BQ-E6.1-1 / BQ-E6.1-2 answered (EXPORT TL) | Admin ZIP removed in MX-3.1 (gap until MX-5 accepted, placeholder line on `/admin/users`); go-live ships the defaults; legal open issue 2 is a launch gate, not an MX-3.1 gate |
| 2026-10-28 | BQ-31 answered; MX-2b workplan linked (EXPORT Dev, E3) | User: "headers, record types and fixed labels only, not the owner's values." §4.3 and §6 marked answered; §4.3 links the MX-2b workplan. What counts as a "fixed label" in a cell goes back to the user as MX2B-Q1 / MX2B-Q2 |
| 2026-10-28 | BQ-28, BQ-42, BQ-43 answered; MX-3 workplan linked (EXPORT Dev, E6) | User: "BQ-28: max 10 emails per module. BQ-42: 7 MB per email. BQ-43: one 'interrupted, please export again' email." §4.6 and §6 marked answered; §4.6 links [BUSINESS_OS_EXPORT_MX3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX3_WORKPLAN.md), which proposes splitting MX-3 into MX-3a / MX-3b (SA to rule) |
| 2026-10-28 | MX-3 SA review recorded; too-large decision (EXPORT Dev, E6a) | SA approved MX-3 with changes and split it into MX-3a (`feature/bos-export-mx3a-transport-parts`) and MX-3b (own branch from `main` after 3a merges). SA-P4 ruled: fail closed with a "not available" copy of the failed email. User decision on the too-large question (BQ-44): "Too-large does not count toward the daily limit for now; revisit later." §6 row added; new open item SA-P8 to revisit |
| 2026-10-29 | E6b (MX-3b) code complete (EXPORT Dev) | The data export worker, its production wiring, the cron route `/api/cron/data-export-modules` (every 5 min, `maxDuration` 300), its registry and `vercel.json` entries (wired last), `DATA_EXPORT_MODULE_SENT` / `_FAILED` with definitions and audience entries (SA-P5), the callers guard, the E-1 pin and the `durable-queue-drain` two-model note. SA C-1 (no claim of any kind after 90 s), C-3, C-4, C-5 and C-6 met; see the MX-3 workplan's Implementation Notes (MX-3b). No migration. Not committed: SA code review, QA and the user's diff review next |
| 2026-10-29 | E6b approved; T-Q3 moved to E6.1 (TL) | User approved the MX-3b diff and moved T-Q3 (live two-part Resend send) to MX-3.1's go-live check (c), which now also covers the repeated key, Gmail / Outlook right-to-left, Excel, and the real-database 100,000-row read time |
