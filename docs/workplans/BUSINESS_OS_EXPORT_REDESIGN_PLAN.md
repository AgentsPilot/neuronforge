# Plan: Business OS — Export Redesign (MX-0 to MX-7)

> **Last Updated**: 2026-10-25

**Developer:** Dev (written by the DELETE session's Dev for hand-off to the EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (incl. `## SA Split Review — 2026-10-25`, conditions SR-1 to SR-12, and the parent's XC conditions copied in §10)
**Parent:** [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) (`## SA Review — 2026-10-25`, binding; TL edits it, nobody else)
**Coordination file:** `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md` (not in git)
**First slice workplan:** [BUSINESS_OS_EXPORT_MX0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md)
**Status:** Planning (no code). Checked against `origin/main` at `7e51af5b`.

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
| 1 | **MX-0** Module map + per-module switches | `feature/bos-export-mx0-module-map` | — | No | None | No | (does not exist yet) | 🟢 1.5 d |
| 2 | **MX-2a** Joined CSV builder + lookups | `feature/bos-export-mx2a-joined-csv` | MX-0 merged; BQ-26 | No | None | No | — | 🟡 2 d |
| 3 | **MX-2b** Header labels en/he/es | `feature/bos-export-mx2b-column-labels` | MX-2a merged; BQ-31 | No | None | No | — | 🟢 1.5 d |
| 4 | **MX-1a** Schema, start function, claim/reap RPCs, repositories, descriptors, cleanup regen | `feature/bos-export-mx1a-schema` | MX-0 merged; BQ-29; **DL-1a released the lock** | **Yes** (2nd in order: DL-1a → MX-1a → MX-7) | **Two** (tables N, regenerated cleanup N+1; open item SA-P1) | **Yes** | — | 🟡 2.5 d |
| 5 | **MX-1b** Request route, drawer, "Export requested" email, `isModuleExportEnabled()` | `feature/bos-export-mx1b-route-drawer` | MX-1a merged and applied; BQ-35 | No | None | No | **off** (created here) | 🟡 2 d |
| 6 | **MX-3** Cron worker, part splitting, never-duplicate sends, failure emails | `feature/bos-export-mx3-worker` | MX-1b + MX-2b merged; BQ-28, BQ-42, BQ-43 | No | None | No (cron entry; ops checks) | off | 🟡 2.5 d |
| 7 | **MX-4** History, per-module audit, receipt facts (XC-12), ZIP start 404, switch on | `feature/bos-export-mx4-switch-on` | MX-3 merged; BQ-25, BQ-27, open issues 1 + 2; ops gates | No | None | **Yes (switch-on + ops gates)** | **on** (flipped after QA) | 🟡 2 d |
| 8 | **MX-5** Admin "Send export to owner" | `feature/bos-export-mx5-admin-send` | MX-4 live; BQ-30 | No | None | No | on | 🟢 1.5 d |
| 9 | **MX-6** Retire the ZIP | `feature/bos-export-mx6-retire-zip` | MX-5 live ≥ 72 h, ≥ 1 sweep run, bucket empty; LX-1 on `main` | No | None | Yes (bucket-empty check) | on | 🟢 1.5 d |
| 10 | **MX-7** Drop `business_os_data_exports` + its start function, regenerate cleanup, remove the bucket | `feature/bos-export-mx7-drop-old-table` | MX-6 merged; lock free (last in order) | **Yes** (last) | **Two** (regenerated function N first, then DROP N+1; SR-6) | **Yes** | on | 🟢 1 d |

**Total: 18 working days.** Per-module export is live after MX-4. Manual migration gates: MX-1a and MX-7.

**Critical path:** MX-0 → MX-2a → MX-2b and MX-1a → MX-1b, joining at MX-3 → MX-4. MX-1a may be built on its branch while DL-1a still holds the lock (SR-4), but it does **not** regenerate or apply until the lock is released.

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
| `findDeletionFacts` | `new BusinessOsDataExportJobRepository(client?).findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>` in `lib/repositories/BusinessOsDataExportJobRepository.ts`; `DataExportDeletionFacts = { ownerLastExportReadyAt: string \| null; ownerExportDownloadedAt: string \| null; adminExportExisted: boolean }`. Never throws; invalid uuid → error without a DB call; reads by `user_id` only (service role, documented). Same path, class, method and type names | End of stream, **including MX-6 and MX-7**. A rename is a follow-up after DELETE's DL-5 merged |
| `DownloadMyDataButton` | `components/business-os/data-export/DownloadMyDataButton.tsx`, `export interface DownloadMyDataButtonProps { variant: 'row' \| 'button'; className?: string }`, `export function DownloadMyDataButton(props): JSX.Element`. The visible label may change (`downloadMyDataCopy.ts`) | Through MX-6 |

Meaning changes of `findDeletionFacts` (MX-4, MX-7) are announced in the coordination file **before** the PR opens.

### Hotspot anchors for EXPORT (SR-10)

| File | EXPORT inserts |
|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-6 then removes that neighbour) |
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
| Business questions | BQ-25 / BQ-27 **moved to before MX-4 switch-on** (SA Split Review). MX-0 is built on BA's default placement; moving a section later is a one-line change |
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
| Business questions | **BQ-31** (translate headers only, or values too) before the workplan |
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
| Switches | `isModuleExportEnabled()` = **off**. With it off the new route answers 404 and the ZIP flow is unchanged |
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
| Switches | Worker runs regardless of `isModuleExportEnabled()` (XC-15); with the switch off there are no jobs to claim |
| Effort | 🟡 2.5 d |
| Business questions | **BQ-42** (7 MB vs 10 MB), **BQ-43** (interrupted → "export again" email), BQ-28 (max 10 emails per module) before the workplan |
| Done when | AC MX-3; QA's local measurement of a 100,000-row module inside 270 s recorded (local only: preview and prod share one DB) |
| Open | What a job does if its module was switched off between request and claim (SA-P4) |

**Coordination checklist (MX-3):** CC-1; S-10 claim/announce (`[EXPORT→DELETE] MX-3 idempotencyKey claim taken` or "reusing DL-3's"); CC-6 for `vercel.json`, `events.ts`, `eventAudience.ts`; note in the log that the worker's 5-min schedule also runs at :50, beside DELETE's lifecycle job, on one shared Resend team limit (2/s).

### 4.7 MX-4 — History, audit definitions, receipt facts, switch on

| Field | Value |
|---|---|
| Goal | Full history in the drawer; audit definitions and `eventAudience` / owner presentation for `DATA_EXPORT_MODULE_SENT` / `_FAILED` (and `DATA_EXPORT_REQUESTED` `details.modules` + origin); **XC-12 receipt facts re-sourced inside `findDeletionFacts`** (reads old and new tables until MX-7); a test that no export route is in `ENFORCEMENT_POINTS` (XC-19); owner ZIP **start** answers 404 when the switch is on (XC-15); QA; switch on |
| Touches | `lib/repositories/BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body only; signature frozen) + its test; `lib/audit/events.ts`, `eventAudience.ts` (EXPORT anchors); drawer components; `app/api/business-os/data-exports/route.ts` (start → 404 when on); new test under `lib/business-os/entitlements/__tests__/` or export tests importing `ENFORCEMENT_POINTS` (**`business-os-entitlements` skill: register the importer; run `npm run test:bos-entitlements`**); `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` (add a section only: `ownerExportDownloadedAt` meaning; S-14) |
| Lock / migration | No / none |
| Manual prod gate | **Switch-on gate.** Before flipping: ops gates (agentspilot.ai verified in Resend with SPF/DKIM/DMARC; `RESEND_FROM_EMAIL` set; Resend sending limit and plan quota checked against 13 modules × up to 10 emails), open issue 1 (sender / support address) and open issue 2 (legal on files) answered, BQ-25 / BQ-27 answered (apply any section moves in `exportModules.ts` first) |
| Switches | `isModuleExportEnabled()` **on** after QA. Owner ZIP start → 404; ready ZIPs stay downloadable until expiry |
| Effort | 🟡 2 d |
| Done when | AC MX-4; switch flipped in prod; `[EXPORT→DELETE] MX-4 switch flipped` sent (this **unblocks DELETE's switch-on**, B.4) |

**Coordination checklist (MX-4):** CC-1; **interface notice before the PR opens:** append to the coordination file and message `[EXPORT→DELETE] MX-4 interface notice — findDeletionFacts meaning changes (XC-12), signature unchanged`; CC-6 for `events.ts`, `eventAudience.ts`; S-12: add only the "no export route in `ENFORCEMENT_POINTS`" test; S-14: add a section only; whoever reaches switch-on first raises the ops gates in the coordination file (B.4).

### 4.8 MX-5 — Admin "Send export to owner"

| Field | Value |
|---|---|
| Goal | Admin route `requireAdmin` first, authz registry entry, owner id from the path (`tenant-isolation-guard`), recipient = owner's login email at send time, its own limit 2 per owner per 24 h (in the start function, already built in MX-1a), not counted to the owner; works for a locked (banned) account; admin ZIP prepare answers 404 (XC-20, XC-16 step 2) |
| Touches | New route under `app/api/admin/users/[id]/` + tests; admin authz registry (add own entry); `app/admin/users/components/DataExportBlock.tsx` **inside only**, `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts`; `app/api/admin/users/[id]/data-exports/route.ts` (prepare → 404) |
| Lock / migration | No / none |
| Switches | on |
| Effort | 🟢 1.5 d |
| Business questions | BQ-30 (admin export shape) before the workplan |
| Done when | AC MX-5; tested against a banned user directly (does not wait for DL-4) |

**Coordination checklist (MX-5):** CC-1; S-13 add own authz entries only; do **not** edit `BusinessDetail.tsx` or `app/admin/users/page.tsx` (MX-5 changes the inside of `DataExportBlock`); log the "MX-5 live" time: MX-6's 72 h clock starts there.

### 4.9 MX-6 — Retire the ZIP

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
| Goal | SR-6 order: migration N = regenerated cleanup function that no longer names `business_os_data_exports` (descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR); migration N+1 = DROP of the `20261074` start function and `business_os_data_exports`; `findDeletionFacts` reads only the new tables (signature unchanged); bucket deleted through the Storage API once empty |
| Touches | Same S-1 file set as MX-1a; `descriptors.ts` (remove EXPORT's own old descriptor); `BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body; other ZIP methods may go, class and file stay, SR-2) |
| Lock | **Yes** (last in order). Wait for any DELETE regeneration in flight |
| Migration numbers | **Two**, reserved at once (SR-6) |
| Manual prod gate | **Yes.** SR-5 pre-apply check; apply N, then N+1, then enqueue at once; checker; release lock |
| Effort | 🟢 1 d |
| Done when | AC MX-7; checker green; lock released; bucket removed |

**Coordination checklist (MX-7):** CC-1; take the lock; CC-4 two numbers; interface notice `[EXPORT→DELETE] MX-7 interface notice — findDeletionFacts reads only the new tables`; after apply + merge + checker: release and message `[EXPORT→DELETE] MX-7 lock released — stream complete`.

---

## 5. Switch states over time

| After | Module map `on` | `isModuleExportEnabled()` | Owner ZIP start | Admin ZIP prepare | Worker cron | ZIP sweep cron |
|---|---|---|---|---|---|---|
| MX-0 … MX-1a | all on (code only, no effect) | does not exist | live | live | none | runs |
| MX-1b | all on | **off** (new route 404) | live | live | none | runs |
| MX-3 | all on | off | live | live | runs (nothing to claim) | runs |
| MX-4 switch-on | per BQ-27 | **on** | **404** | live | runs | runs |
| MX-5 | per BQ-27 | on | 404 | **404** | runs | runs |
| MX-6 | per BQ-27 | on | removed | removed | runs | **removed** |

A module switched off in the map is not offered in the drawer and refused by the route; it is a code edit and a deploy, never an env var or a request value.

---

## 6. Business questions by slice

| Question | Must be answered before | Why there |
|---|---|---|
| BQ-25 keep switches, drop Excel | **MX-4 switch-on** (moved by SA) | MX-0 is config; Excel is not built in any slice |
| BQ-27 module list / placement | **MX-4 switch-on** (moved by SA) | Moving a section is a one-line edit of `exportModules.ts` |
| BQ-26 joined CSV shape | MX-2a workplan | Shape of the builder |
| BQ-29 the limit | **MX-1a** workplan | Written into SQL literals |
| BQ-31 translate headers only | MX-2b workplan | Label file scope |
| BQ-35 files reversal record | MX-1b drawer copy | Drawer sentence |
| BQ-28 max emails per module | MX-3 workplan | Constant + "too large" email |
| BQ-42 7 MB vs 10 MB | **MX-3** workplan | Byte-budget constant |
| BQ-43 interrupted email | **MX-3** workplan | Crash semantics |
| BQ-30 admin export | MX-5 workplan | Admin route |
| Open issue 1 / BQ-3 sender + support | MX-4 switch-on | Email `From` and copy |
| Open issue 2 legal on files | MX-4 switch-on | Drawer and email promise |

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
| SA-P7 | Module-level only, or also the old per-section switches | Module-level only (requirement says "on/off per module"); a section trim is a move to another module or a descriptor `exclude` (SA-reviewed). Detail in the MX-0 workplan |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev, DELETE session, for hand-off) | End-to-end EXPORT plan MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → MX-4 → MX-5 → MX-6 → MX-7 per SA SR-4; per-slice touches, locks, migration numbers, gates, switch states, effort (18 d), done-when, BQ timing, coordination checklists, frozen interfaces, hotspot anchors, files not to edit; open items SA-P1…SA-P7 |
