# Workplan: Business OS Export MX-3.1 (E6.1) — Remove the export switch and the ZIP download code (go-live)

> **Last Updated**: 2026-10-30

**Developer:** Dev (EXPORT session)
**Step:** E6.1 (user's numbering) = doc slice MX-3.1
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §6 (user decision 2026-10-27, MX-3.1 row, ops gates, BQ-E6.1-1 and BQ-E6.1-2 answered), §7 (AC MX-3.1), §11 (S-4, S-11, B.4, B.6, B.7, B.8)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §2, §3 (CC-1…CC-8, frozen interfaces, hotspot anchors), §4.6a (quoted in §2 below, with rulings R-1…R-7), §5, §6, §7
**Earlier slices this builds on:** [MX-1b](/docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md) (switch, probe, drawer; QA "Not verified" 1–10), [MX-3](/docs/workplans/BUSINESS_OS_EXPORT_MX3_WORKPLAN.md) (worker; QA pass 2 T-Q3 and the T-Q1 note, moved here by the user on 2026-10-29)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside git). CC-1 read on 2026-10-30: E6.1 row started, CC-6 claims on `vercel.json` and `lib/cron/bosCronJobs.ts` (EXPORT's own `data-export` entries only) logged; DELETE's D4b is PR #569 (auto-merge on), which takes `bosCronJobs` to 24 and adds `/api/cron/bos-plan-cancel-reminders`
**Branch:** `feature/bos-export-mx3-1-remove-switch-and-zip` (RM-created, worktree `neuronforge-mx31`, off `main` `117979c6`, which holds MX-3b #568). Dev confirmed it with `git branch --show-current` on 2026-10-30 before writing this file. Not `main`
**Date:** 2026-10-30
**Status:** Code Complete (2026-10-30), uncommitted; waits for SA code review, then QA and the user's diff review. SA workplan review APPROVED WITH CHANGES (2026-10-30): required changes 1 to 4 written in, 5 to 8 applied (see Implementation Notes). No auto-merge before P-1 to P-3 are recorded and the user has seen the diff (C-6)

---

## Overview

MX-3.1 is the go-live of the per-module export, and it is almost all deletion. It removes the `BUSINESS_OS_MODULE_EXPORT_ENABLED` switch and every line that reads it: the `isModuleExportEnabled()` reader, the request route's first-statement 404, the browser probe `useModuleExportSwitch` with its four outcomes, and the ZIP-or-drawer choice inside `DownloadMyDataButton`. From this merge the button always shows "Export data" and opens the export drawer, and the drawer reads its own first history page when it opens. It also removes the ZIP download code (ruling R-1): the owner start, "last export" and download routes, the admin prepare, list and download routes (BQ-E6.1-1: the admin gap until MX-5 is accepted), the daily `/api/cron/data-export` sweep with its `vercel.json` and registry entries, the ZIP builder files, the ZIP UI and copy, the ZIP functions of the browser seam, and the guards whose only subject was the ZIP. The admin "Data export" box stays mounted and shows one line saying the admin export returns as "Send export to owner".

What stays until MX-7 is listed in R-3 and §5.2: the old table and its start function, `BusinessOsDataExportJobRepository.ts` untouched (`findDeletionFacts` keeps reading the old table), the storage repository, `jobPolicy.ts` and its migration mirror test, and the bucket (emptied by hand after deploy). The `DATA_EXPORT_*` audit constants stay forever. There is **no migration**. The merge has a manual go-live gate: the Resend checks before merge, then three steps after deploy (env var removed, bucket emptied, a live end-to-end run on the `+test` account that also carries MX-1b's deferred browser checks and MX-3b's moved T-Q3 checks).

**Effort:** 🟡 2.5 d, at the cap (§14). A fallback split is proposed in case SA prefers smaller PRs.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Approved scope (plan §4.6a, verbatim)](#2-approved-scope-plan-46a-verbatim)
3. [Constraints carried into this slice](#3-constraints-carried-into-this-slice)
4. [Decisions](#4-decisions)
5. [Delete / keep list, with importers on current main](#5-delete--keep-list-with-importers-on-current-main)
6. [The switch removal](#6-the-switch-removal)
7. [The owner's export entry after the change](#7-the-owners-export-entry-after-the-change)
8. [The admin Data export box (BQ-E6.1-1)](#8-the-admin-data-export-box-bq-e61-1)
9. [Cron registry and vercel.json (C-6)](#9-cron-registry-and-verceljson-c-6)
10. [CI guards affected](#10-ci-guards-affected)
11. [Audit](#11-audit)
12. [Docs](#12-docs)
13. [Files to create / modify / delete](#13-files-to-create--modify--delete)
14. [Effort and proposed split](#14-effort-and-proposed-split)
15. [Task list](#15-task-list)
16. [Test plan](#16-test-plan)
17. [Manual go-live gate](#17-manual-go-live-gate)
18. [Coordination (CC-1 … CC-8)](#18-coordination-cc-1--cc-8)
19. [Risks](#19-risks)
20. [Open questions for SA](#20-open-questions-for-sa)
21. [Business questions](#21-business-questions)
22. [SA Review Notes](#sa-review-notes)
23. [QA Testing Report](#qa-testing-report)
24. [Commit Info](#commit-info)
25. [Change History](#change-history)

---

## 1. Analysis summary

Checked against `main` `117979c6` on 2026-10-30 (`origin/main` was the same commit at that time; #569 not yet merged).

| Area | What is there today | What MX-3.1 does |
|---|---|---|
| Switch | `isModuleExportEnabled()` at the end of `lib/utils/featureFlags.ts` (reads the exact string `true`); its test `lib/utils/__tests__/featureFlags.moduleExport.test.ts`; catalogue entry `lib/admin/environment/catalogue.ts:361` and its reader row in `catalogue.test.ts:58`; `docs/FEATURE_FLAGS.md` v1.16.1 (since #569; v1.16.0 at `117979c6`) (Change History row 1.15.0, env-table row line 72, detail section line 446) | Removed everywhere, docs bumped 1.16.1 → 1.17.0 with a Change History row |
| Request route | `app/api/business-os/export-requests/route.ts`: `if (!isModuleExportEnabled()) return notFound();` is the first statement of GET (l.150) and POST (l.192); `notFound` helper l.65 | Both lines and the helper go; `getUser()` stays the first thing that decides (after the correlation id) |
| Probe | `components/business-os/data-export/useModuleExportSwitch.ts` (outcomes `off` / `unknown` / `ok` / `error`); `fetchModuleExportHistory` doubles as the probe and maps our 404 to `off` | Hook deleted; the seam keeps the history read, without the `off` / `unknown` verdicts |
| Entry | `DownloadMyDataButton.tsx` renders `ZipDownloadControl` unless the probe says on, then `ModuleExportEntry` with `initialHistory` / `isInitiallyOpen` | Always `ModuleExportEntry`; name, path, props and both exports unchanged |
| Drawer | `useExportDrawer.ts` already calls `reloadHistory()` on every open, but its first state is `initialHistory` or `error` | First state becomes `loading`; `initialHistory` prop removed from `ExportDrawer`, `ModuleExportEntry` and the hook |
| ZIP routes | Owner: `app/api/business-os/data-exports/route.ts` (POST start, GET last export), `[jobId]/parts/[partNo]/download/route.ts`. Admin: `app/api/admin/users/[id]/data-exports/route.ts` (GET list, POST prepare), `[jobId]/parts/[partNo]/download/route.ts`. Cron: `app/api/cron/data-export/route.ts` | All five route files and their four test files deleted |
| ZIP lib | 12 files in `lib/business-os/data-export/` used only by the ZIP (§5.1) and `lib/repositories/BusinessDataExportFilesRepository.ts`, whose one importer is `fileManifest.ts` | Deleted with their tests (§5.1, Q-2) |
| ZIP UI | `ZipDownloadControl.tsx`, `useDownloadMyData.ts`, `DataExportNotice.tsx`, `downloadMyDataCopy.ts` (all ZIP-only, §5.1) | Deleted with their tests |
| Admin box | `app/admin/users/components/DataExportBlock.tsx` (391 lines, fetches 2 URLs), `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` | Box keeps its export, prop and `data-testid`; inside it becomes the one placeholder line; dialog deleted; copy file trimmed |
| Cron | `lib/cron/bosCronJobs.ts` entry `data-export` (l.736) and its id in the `BosCronJobId` union (l.49); `vercel.json` `/api/cron/data-export` (l.86); `bosCronJobs.test.ts` and `vercelCrons.test.ts` pin **24** since #569 (`a0804002`; was 23 at `117979c6`) | Both entries removed; literal **23** = main's count minus 1, recounted by hand (§9) |
| Entitlements | No file in scope imports from `lib/business-os/entitlements/` (only comments in `moduleExportWorker.ts` and the request route say they don't) | Skill not triggered; `npm run test:bos-entitlements` run anyway as a 10 s confirmation |
| `console.*` | None in any touched code file (the one hit in `dataExportCopy.ts` is the word "console" in a comment) | Nothing to flag |

Deletion size measured on `main`: about 4,600 lines of production code and about 3,700 lines of tests. The edits are smaller (about 25 files, §13).

---

## 2. Approved scope (plan §4.6a, verbatim)

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

The rulings R-1…R-7 (SA, 2026-10-27) that sit under this table in the plan are binding and not repeated here; this workplan cites them by number.

---

## 3. Constraints carried into this slice

| # | Constraint | Source | How this workplan meets it |
|---|---|---|---|
| K-1 | `DownloadMyDataButton`: name, path, `DownloadMyDataButtonProps { variant: 'row' or 'button'; className?: string }`, named and default export frozen through MX-7 | Plan §3 frozen interfaces, SR-2, SR-9, B.6 | Only the body changes (§7.1). A source test pins the props shape |
| K-2 | `lib/repositories/BusinessOsDataExportJobRepository.ts` untouched; `findDeletionFacts` keeps reading the old table | Plan §3, R-1, R-3, B.6 | Not in the diff. The ZIP-only methods become dead and go in MX-7. Its test stays |
| K-3 | `AdminDataExportRow` / `AdminDataExportStatus` in `app/admin/users/types.ts` are DELETE-owned (B.8) | Plan §4.6a | Left in place, unused. No claim needed because the file is not edited. Their doc comments go stale (they name the deleted route); noted for MX-5 / MX-7 |
| K-4 | `BusinessDetail.tsx` keeps mounting `<DataExportBlock key={user.id} accountId={user.id} />` | S-6, AC MX-3.1 | Not edited; the block keeps its `accountId` prop (§8) |
| K-5 | Old table, its `20261074` start function, `BusinessOsDataExportStorageRepository.ts` and its barrel line, `jobPolicy.ts` + mirror test, the bucket and its descriptor stay until MX-7 | R-3, S-16 | Not in the diff (§5.2) |
| K-6 | `DATA_EXPORT_*` audit constants, definitions and audience entries stay forever; no new events | XC-13, S-9, R-1 | `lib/audit/events.ts` and `eventAudience.ts` not edited (§11) |
| K-7 | ZIP-specific guards are deleted with their subjects, never loosened | XC-16, R-1 | §10 lists each one; every guard whose rule still applies is re-pointed at the module export files, not dropped |
| K-8 | Files EXPORT must not edit without a claim (§7 of the plan) | SR-10, SR-11, B.1 | None of them is edited. Two test files next to DELETE's area are edited (§10, rows G-11 and G-12) and are claimed first (CC-3) |
| K-9 | `vercel.json` and `bosCronJobs.ts`: remove only EXPORT's own entries; the literal count is set by hand (C-6) | S-11, MX-3 SA C-6 | §9 |
| K-10 | One PR from `main`, not stacked, at most 2.5 d; the user sees the diff before any commit (no fast-track recorded for this stream's E6.1) | Plan §2 | §14, §18 |
| K-11 | Local dev and production share one database; the production worker (MX-3b) is deployed and claims any request row within 5 minutes | MX-3 workplan, memory | Every local request made in testing is a real send. Only the `+test` account is used, and the 2-per-24-h limit is planned for (§17, R-4 in §19) |
| K-12 | No backslash-plus-hex escape in any file (Tailwind scans docs); never truncate a file on write; never `git stash`; never touch the shared `node_modules` | Memory | Applies to every edit |

---

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **One PR**, not split | The work is mostly deletion of whole files. A split (§14) would keep the ZIP builder alive on `main` between the two PRs only to serve the admin routes, and would mean two go-live reviews |
| D-2 | **No 404 replaces the deleted ZIP routes.** Next.js answers 404 for a path with no route file | The old browser seam is deleted in the same deploy, so no client of ours calls them. A cached old page that does gets the platform 404 (the old seam already maps a non-JSON answer to a generic failure). No stub route is added, because a stub would be new code to maintain until MX-7 |
| D-3 | `fetchModuleExportHistory` keeps its name and its 5 s timeout; `MODULE_EXPORT_PROBE_TIMEOUT_MS` is renamed `MODULE_EXPORT_HISTORY_TIMEOUT_MS`. Verdict becomes `{ kind: 'ok', requests }` or `{ kind: 'error' }` (a 404, a non-JSON body and a timeout are all `error`) | With no switch, a 404 is no longer "off"; it is a failure the drawer already knows how to show ("could not be loaded" plus Try again). Fewer states, same copy |
| D-4 | `startModuleExport` loses the `off` refusal code; a 404 falls through to `failed`. `exportDrawerCopy.ts` loses the `off` key in en / he / es | Same reason as D-3. The en / he / es `failed` sentence already covers it |
| D-5 | `ExportDrawer` / `useExportDrawer` / `ModuleExportEntry` lose `initialHistory` and `isInitiallyOpen`. The hook's first history state is `loading` | The drawer already reloads the history on every open (`useExportDrawer.ts` open effect). Starting from `loading` instead of the probe's page is the only change the "reads its own first page" requirement needs |
| D-6 | `ModuleExportEntry` drops its `data-module-export="on"` attribute and the C-9 header warning | There is no other state to tell apart; C-9 is moot (R-4) |
| D-7 | `downloadMyDataCopy.ts` and its test are **deleted whole**, not trimmed | Every key in it is ZIP copy (preparing, download again, expired, README, …). The "Export data" label already lives in `exportDrawerCopy.ts` (`entryLabel`). The plan's frozen-interface row names `downloadMyDataCopy.ts` as where the label "may change"; the label now lives in `exportDrawerCopy.ts`. SA to confirm (Q-1) |
| D-8 | `payload.ts`, `fileName.ts`, `ceiling.ts` are deleted; `limits.ts` stays and loses only its ZIP-only keys (Q-3) | §5.1 importer check: the first three have no non-ZIP importer after the deletions; `limits.ts` is read by `sections.ts`, `moduleExportWorker.ts` and `BusinessDataExportRepository.ts` |
| D-9 | `BusinessDataExportFilesRepository.ts` (+ test) is deleted with `fileManifest.ts` | It reads the account's stored files for the ZIP's "Your files" folder; `fileManifest.ts` is its only importer (F-6), and the module export never reads files (§4.5 of the requirement: files are not exported). It is not in the barrel, so `lib/repositories/index.ts` is not edited; its stale comment there (l.364–365) is left for MX-7 (S-16 add-only). SA to confirm (Q-2) |
| D-10 | Security-tab headings read "Export data"; the sub-line becomes "Choose what to export. Each part arrives by email." (en only, as the rest of these two pages) | BQ-E5-2 and R-1. The sub-line is copy, so the user sees it in the diff |
| D-11 | The admin box keeps its file, its export name, its `accountId` prop and `data-testid="drawer-box-export"`, and renders its heading plus one line: "Admin export is coming back as 'Send export to owner'." It makes no request | BQ-E6.1-1 answer and R-2 wording. Keeping the test id keeps DELETE-area layout tests (T-30) true without editing their structure |
| D-12 | Comments that only describe history (for example `lib/audit/ownerVisibility.ts`, `ownerEventPresentation.ts`, `lib/repositories/UserProfileRepository.ts`, `lib/business-os/supportContact.ts`, `descriptors.ts`) are **not** edited | They are not wrong about the past, and touching hotspot or DELETE-adjacent files for comments only widens the diff. MX-4 rewrites the contents doc; MX-7 removes the old-table code |

---

## 5. Delete / keep list, with importers on current main

Importers found with `grep` on `main` `117979c6` (production and test files under `app/`, `components/`, `lib/`, `scripts/`). "After" = importers left once everything marked Delete is gone.

### 5.1 Delete

| File (+ its test) | Importers on main | After | Verdict |
|---|---|---|---|
| `app/api/business-os/data-exports/route.ts` (+ `route.test.ts`, `route.get.test.ts`) | Route; named in guards G-3, G-5, G-7 | — | Delete |
| `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` (+ test) | Route; named in G-3, G-5 | — | Delete |
| `app/api/admin/users/[id]/data-exports/route.ts` (+ test) | Route; G-1, G-2 | — | Delete (BQ-E6.1-1) |
| `app/api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download/route.ts` (+ test) | Route; G-1 | — | Delete (BQ-E6.1-1) |
| `app/api/cron/data-export/route.ts` (+ test) | Route; `bosCronJobs.ts`, `vercel.json` | — | Delete |
| `lib/business-os/data-export/zipExport.ts` (+ test) | owner + admin routes, `zipExportDeps.ts`, `joinedCsv.test.ts` (C-9 parity, "until MX-6") | none | Delete; the C-9 parity block in `joinedCsv.test.ts` goes with it (G-9) |
| `zipExportDeps.ts` | owner + admin routes | none | Delete |
| `zipEntries.ts` (+ test) | `fileManifest.ts`, `zipExport.ts` | none | Delete |
| `zipWriter.ts` (+ test) | `zipExport.ts` | none | Delete |
| `fileManifest.ts` (+ test) | `zipExport.ts`, `zipExportDeps.ts`, `exportSweep.ts`, cron route, `runRecord.adoption.test.ts` (mock) | none | Delete; the mock goes (G-8) |
| `readme.ts` (+ test) | `zipExport.ts`, `downloadName.ts` | none | Delete |
| `exportSweep.ts` (+ test) | cron route | none | Delete |
| `adminExportAudit.ts` (+ test) | admin routes | none | Delete. The audit **constants** it writes stay in `lib/audit/events.ts` (K-6) |
| `downloadName.ts` (+ test) | the two download routes | none | Delete |
| `payload.ts` | `fileManifest.ts` (type), `zipExport.ts`; tests `csv.test.ts` (`FILE_INDEX_COLUMNS`), `sections.test.ts` (`EXPORT_GROUPS`, `buildExportPayload`) | only those two tests, which test `payload.ts` itself | **Delete** (no non-ZIP importer). The payload cases leave `sections.test.ts` (l.490–525, l.851–858); `csv.test.ts` l.128 inlines the four file-index column names it used as a key set, or drops them (Dev reads the case at implementation). Note: `lib/business-os/bizql/analyse/payload.ts` is a different file, untouched |
| `fileName.ts` (+ test) | owner start route, `downloadName.ts`; tests of the download route | none | **Delete** (the module export names its CSV parts in `moduleExportEmails.ts` / `csvParts.ts`, which do not import it) |
| `ceiling.ts` (+ test) | `zipExport.ts`, `exportSweep.ts` | none | Delete (not named in R-1, but only the ZIP used it: zip bytes, file count, build ms) |
| `lib/repositories/BusinessDataExportFilesRepository.ts` (+ test) | `fileManifest.ts` only | none | Delete (D-9, Q-2) |
| `components/business-os/data-export/ZipDownloadControl.tsx` | `DownloadMyDataButton.tsx`; G-6 names it | none | Delete |
| `useDownloadMyData.ts` | `ZipDownloadControl.tsx`, `DataExportNotice.tsx`, `DownloadMyDataButton.test.tsx`; G-10 names it | none | Delete |
| `DataExportNotice.tsx` | `ZipDownloadControl.tsx` only | none | Delete (ZIP-only, confirmed) |
| `downloadMyDataCopy.ts` (+ `downloadMyDataCopy.test.ts`) | ZIP control, hook, button test, probe test, render test | none | Delete whole (D-7, Q-1) |
| `useModuleExportSwitch.ts` | `DownloadMyDataButton.tsx` | none | Delete (switch) |
| `components/business-os/data-export/__tests__/ModuleExport.probe.qa.test.tsx` | — | — | Delete (its subject is the probe) |
| `lib/utils/__tests__/featureFlags.moduleExport.test.ts` | — | — | Delete (switch) |
| `app/admin/users/components/DataExportReasonDialog.tsx` | `DataExportBlock.tsx` | none | Delete (the reason was for the admin ZIP) |

### 5.2 Keep

| File | Why it stays | Until |
|---|---|---|
| `lib/business-os/data-export/limits.ts` | Read by `sections.ts` (`ROW_CEILING`), `moduleExportWorker.ts` (`ROW_CEILING`), `BusinessDataExportRepository.ts` (`PAGE_SIZE`, `VIA_PARENT_CHUNK`, `ROW_CEILING`), and guard G-4 check 5. Its ZIP-only keys (`FILE_BYTES_CEILING`, `FILE_COUNT_CEILING`, `ZIP_BYTES_CEILING`, `BUILD_MS_CEILING`, `NEAR_CEILING_RATIO`, `FILE_WALK_MAX_MS`, `FILE_WALK_MAX_CALLS`, `FILE_DOWNLOAD_CONCURRENCY`, `FILE_ROWS_MAX`) lose their last reader; proposal: remove those keys and the DE-8b half of the header comment (Q-3) | Forever (file) |
| `lib/business-os/data-export/jobPolicy.ts` + `jobPolicy.test.ts` | Pins the old start function's SQL literals; imported by the old job and storage repositories (R-3) | MX-7 |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` + test | Frozen (K-2) | MX-7 |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` + test, its `index.ts` lines | R-3, S-16. No production importer is left after this slice (only `index.ts`); MX-7 removes it | MX-7 |
| `lib/business-os/data-export/csv.ts` | The BC-1 rule and the line helpers used by the module export. `toCsv` (Uint8Array) loses its only production caller (`zipExport.ts`) and becomes dead; proposal: leave it, it is three lines and `toCsvText` is the BC-1 test seam (Q-4) | Forever |
| `sections.ts`, `classification.ts`, `classificationTypes.ts`, `exportModules.ts`, `joinedCsv*.ts`, `columnLabels.ts`, `csvParts.ts`, `moduleExport*.ts`, `exportHistory.ts`, `exportModuleSchema.ts`, `exportRequestedEmail.ts`, `ownerClock.ts` | The module export | Forever |
| `lib/client/businessOsDataExport.ts` | The one browser seam (R-1); loses its ZIP half (§7.3) | Forever |
| `lib/business-os/purge/descriptors.ts` (old table, bucket), the cleanup function, `scripts/*data-exports*.sql`, `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | The old table and bucket still exist | MX-7 |
| `lib/audit/events.ts`, `eventAudience.ts` `DATA_EXPORT_*` | K-6 | Forever |
| `app/admin/users/types.ts` (`AdminDataExportRow`, `AdminDataExportStatus`) | DELETE-owned (K-3) | DELETE's call |
| `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | Rewritten in MX-4 (R-7). It describes the ZIP until then | MX-4 |

---

## 6. The switch removal

| File | Change |
|---|---|
| `lib/utils/featureFlags.ts` | Remove the `isModuleExportEnabled()` block at EXPORT's anchor (end of file, l.~320–338, with its doc comment). Nothing else in the file moves |
| `lib/utils/__tests__/featureFlags.moduleExport.test.ts` | Delete |
| `app/api/business-os/export-requests/route.ts` | Remove the import (l.35), the `notFound` helper (l.65) if nothing else uses it, both first-statement lines and their C-1 comments (l.149–150, l.191–192); update the header flow comment (l.9: "switch (404 while off, before anything) ->") to start at the correlation id / `getUser` |
| `…/export-requests/__tests__/route.test.ts` | Delete the `SWITCH` constant, its `beforeEach` / `afterEach` set and unset (l.92, l.108, l.123) and the `describe('switch off …')` block (l.128). Replace the source rule "checks the switch as the first statement of both handlers (C-1)" (l.411) with "neither handler reads a flag or answers 404 of its own" (source: no `featureFlags` import, no `notFound`, no `404`). The 401, 400 (invalid input, strict body, unknown and switched-off modules), 409, 429, 500 and happy-path cases stay unchanged |
| `…/export-requests/__tests__/route.qa.test.ts` | Delete the `SWITCH` setup (l.101, l.121, l.128), "QA 1: switch off, every off value" (l.153), "QA 3: the probe against the real route" (l.190) and the "switch turned off between probe and click (404)" row (l.267). QA 2 (POST end to end), the invalid-input rows (l.281–297) and QA 5 (history through the route) stay |
| `lib/admin/environment/catalogue.ts` | Remove the `BUSINESS_OS_MODULE_EXPORT_ENABLED` entry (l.361) |
| `lib/admin/environment/__tests__/catalogue.test.ts` | Remove its `READERS` row (l.58) |
| `lib/business-os/data-export/moduleExportWorker.ts` | Reword the comment at l.34 ("It never reads `isModuleExportEnabled()` …") so the name no longer appears (AC: no match in `lib/`) |
| `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts` | l.797 `expect(code).not.toMatch(/featureFlags|isModuleExportEnabled/)` becomes `/featureFlags/`: the rule (the worker reads no flag) is kept, only the dead name leaves |
| `docs/FEATURE_FLAGS.md` | Remove the env-table row (l.72) and the detail section (l.446–461) at EXPORT's anchor; version 1.16.1 → 1.17.0 (SA required change 3); new Change History row. The 1.15.0 row stays (history) |

Done-when check (AC MX-3.1 first bullet; SA Q-5): `grep -rn -e isModuleExportEnabled -e BUSINESS_OS_MODULE_EXPORT_ENABLED app components lib docs/FEATURE_FLAGS.md` must return **exactly one** line: the 1.15.0 Change History row of `docs/FEATURE_FLAGS.md`. The new 1.17.0 row is written without the variable name ("Removed the module export switch (export redesign MX-3.1)…"), so the result stays exact.

---

## 7. The owner's export entry after the change

### 7.1 `DownloadMyDataButton.tsx`

```tsx
export interface DownloadMyDataButtonProps {
  variant: 'row' | 'button';
  className?: string;
}

export function DownloadMyDataButton({ variant, className = '' }: DownloadMyDataButtonProps) {
  return <ModuleExportEntry variant={variant} className={className} />;
}

export default DownloadMyDataButton;
```

The header comment keeps the list of entry points and the FROZEN note (now "through MX-7"), and loses the switch paragraph. Entry points on `main`: `/business-os/settings` (row), `DangerZonePanel` (button), `/settings` `SecurityTab`, `/v2/settings` `SecurityTabV2`, DELETE's `DeleteAccountDrawer` and `PlanCancelDrawer` (button). None of those files changes except the two security tabs' headings (D-10).

### 7.2 `ModuleExportEntry.tsx`, `ExportDrawer.tsx`, `useExportDrawer.ts`

- `ModuleExportEntryProps` = `{ variant; className? }`; `useState(false)` for open; the `isInitiallyOpen` effect, the C-9 warning and `data-module-export` go (D-5, D-6).
- `ExportDrawerProps` loses `initialHistory`; the `off` case leaves `refusalText`.
- `useExportDrawer` loses `initialHistory`; first state `{ kind: 'loading' }`. The open effect already calls `reloadHistory()`, which keeps a loaded list while reloading and shows `loading` otherwise. Nothing else changes.
- `exportDrawerCopy.ts` loses the `off` key (en / he / es) and the header lines about "while the switch is off" and `downloadMyDataCopy.ts`.

### 7.3 `lib/client/businessOsDataExport.ts` (the one browser seam)

Removed: `DATA_EXPORTS_URL`, `START_TIMEOUT_MS`, `DataExportRefusalCode`, `DataExportReady`, `DataExportRefused`, `DataExportVerdict`, `LastDataExport`, `LastDataExportVerdict`, `readyBody`, `statusBody`, `toVerdict`, `postWithTimeout`, `startDataExport`, `downloadDataExportAgain`, `fetchLastDataExport`, `browserNavigation`, `isSafeDownloadUrl`, `saveSignedDownload`, and the comment block that explains the probe and the 404-means-off mapping. Kept and still used by the module half: `readJson`, `isAbort`, `refusalBody`, `ourErrorBody` (if still used after D-3; otherwise removed), `MODULE_EXPORT_URL`, the history and start parsers, `fetchModuleExportHistory`, `startModuleExport`, `ExportHistoryRequest`. The file header is rewritten for the module export. Dev checks each helper's remaining callers at implementation and removes any that become unused.

---

## 8. The admin Data export box (BQ-E6.1-1)

`app/admin/users/components/DataExportBlock.tsx` keeps `export function DataExportBlock({ accountId }: Props)` so `BusinessDetail.tsx` compiles unchanged (K-4). It renders the shared box (`DrawerBox` or the same wrapper it uses today), `data-testid="drawer-box-export"`, the heading "Data export", and one line from `dataExportCopy.ts`: **"Admin export is coming back as 'Send export to owner'."** It sends no request, imports nothing from the browser seam, and does not use `accountId` (the prop stays for the frozen mount; a short comment says MX-5 uses it).

`app/admin/users/dataExportCopy.ts` keeps only the title and the placeholder line (English only, no backslash). `DataExportReasonDialog.tsx` is deleted. `app/admin/users/__tests__/dataExportBlock.render.test.tsx` is rewritten: the placeholder renders, no `fetch` is made, the test id is there. Users of the ZIP-era copy (`ownAccount`, failure words, `over_ceiling` mapping) go with it.

`/admin/users` drawer tests that mock `GET …/data-exports` keep working (an unused mock answers nothing). The one that **asserts** the call (`businessDrawer.layout.render.test.tsx` l.835) changes to "no export request is made" (G-12, claimed first).

---

## 9. Cron registry and vercel.json (C-6)

| File | Change |
|---|---|
| `vercel.json` | Remove only the `/api/cron/data-export` object (l.86). The `/api/cron/data-export-modules` entry stays where it is (S-11, B.7) |
| `lib/cron/bosCronJobs.ts` | Remove only the `data-export` entry (l.~724–760, with its comment) and `'data-export'` from `BosCronJobId` (l.49) |
| `lib/cron/__tests__/bosCronJobs.test.ts` | Remove the `data-export` expectation and its "18th" comment; set the literal |
| `lib/cron/__tests__/vercelCrons.test.ts` | Remove the `/api/cron/data-export` row and its comment (l.108–113); reword the worker comment "directly after the data export sweep"; set the literal and the header's "(N as of …)" |

**The count (TL instruction 2026-10-30, C-6):** at implementation, fetch `origin/main` fresh and count its entries by hand. #569 (D4b) has landed (`a0804002`, SA required change 3), so the literal is **24 → 23**, after a recount by hand of `vercel.json` `crons` and `BOS_CRON_JOBS` on the merged tree. The vercelCrons header reads "(23 after MX-3.1)", with no date-bound ordinal. Then run `bosCronJobs.test` and `vercelCrons.test`. Re-check once more just before the PR is enqueued; whoever lands second recounts. No ordinal words ("the 19th") are added in comments.

**Old run rows.** `bos_cron_runs` keeps its `data-export` rows. The admin Jobs page reads runs only for ids in `BOS_CRON_JOBS` (`lib/admin/jobs/readJobsQueues.ts:91`), so the old rows are simply not shown. No migration, no cleanup.

---

## 10. CI guards affected

Every guard below either loses an entry whose subject is deleted, or is re-pointed at the module export files where its rule still applies. None is loosened: no check is weakened for a file that still exists.

| # | Guard | What pins the ZIP today | Change |
|---|---|---|---|
| G-1 | `app/api/admin/__tests__/adminGate.writes.test.ts` (admin gate census) | Imports the two admin data-export route modules (l.265–266), three cases (l.488–500), count `toHaveLength(69)` with the arithmetic comment (l.545–552) | Remove the imports and the three cases; add a line to the arithmetic ("− 3 deleted with their routes, export MX-3.1"); set **66**. Rebase check: if another admin route lands first, recount by hand |
| G-1b | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (required CI, `admin-authz-guard.yml`) | No entry names these routes; the route count is a floor (≥ 40) | No edit. Run it (`npm run test:authz-guard`) to confirm |
| G-2 | `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts` | Allow-list entries for `app/api/admin/users/[id]/data-exports/route.ts` and its test (l.75–81), and the "every allow-listed file exists" test | Remove both entries and their comment |
| G-3 | `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | `DATA_EXPORT_ROUTES` = the two owner ZIP routes (l.50–53), "reads no audit rows at all" (l.206) with an audit-write non-vacuity (`AUDIT_EVENTS.DATA_EXPORT_`); the module-wide non-vacuity expects `payload.ts` (l.222) | **SA required change 2.** (a) `DATA_EXPORT_ROUTES` becomes the request route `app/api/business-os/export-requests/route.ts` only; its case and its audit-write non-vacuity are unchanged (it writes `DATA_EXPORT_REQUESTED`). (b) The worker cron `app/api/cron/data-export-modules/route.ts` gets **its own case**: it reads no audit rows, and its non-vacuity is that it imports `moduleExportWorker`. (c) The module-wide non-vacuity drops `payload.ts` and expects `moduleExportWorker.ts` (keeps `sections.ts`, `classification.ts`). Header: "MX-3.1 (2026-10-30): re-pointed from the deleted ZIP routes to the module export request route and its worker cron" |
| G-4 | `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` | Check 4 asserts the seam names `/api/business-os/data-exports` (l.124); negative controls plant that path; header names the ZIP routes | **SA required change 4.** The check-4 non-vacuity is **inverted**: the seam does **not** name `/api/business-os/data-exports` and **does** name `/api/business-os/export-requests`. The outside-the-seam regex keeps refusing both routes; the negative controls are re-pointed to the module route and keep one planted `data-exports` case. **Added (Q-8):** "the ZIP routes and the sweep cron do not exist" (`existsSync` false on the three directories). Optional Q-3 follow-on: check 5 also asserts `not.toHaveProperty` for the nine removed keys. Checks 1, 2, 3 and 5 stay |
| G-5 | `lib/business-os/data-export/__tests__/exportClassification.test.ts` (M-5 no conversion) | Scans the two owner ZIP route files (l.1735–1736); `LOWER_CASE_EXEMPT` names `fileName.ts` and `zipEntries.ts`; non-vacuity expects `payload.ts`; negative control uses `fileName.ts` / `zipExport.ts` | Scan re-pointed to `export-requests/route.ts` and `cron/data-export-modules/route.ts`; the two exemptions leave with their files (the "every exempt file is scanned" check would fail otherwise); non-vacuity expects `joinedCsv.ts` instead of `payload.ts`; negative control uses `columnLabels.ts` (exempt) and `moduleExportWorker.ts` (not exempt) |
| G-6 | `app/business-os/settings/__tests__/accountCard.guard.test.ts` | Mirrored-chevron check lists `ZipDownloadControl.tsx` and asserts the button renders both controls (l.62–77) | Only `ModuleExportEntry.tsx` is checked; the button must render `<ModuleExportEntry`. The rule (the row's chevron mirrors in RTL) is unchanged |
| G-7 | `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | Zone `dataExportRoutes: 'app/api/business-os/data-exports'` (l.274), "every named zone exists" | Re-point the zone to `app/api/business-os/export-requests` (the rule, "the client payments section never reaches the export", still applies). This file belongs to the exchange-rates stream (closed); a one-line re-point, noted in the PR |
| G-8 | `app/api/cron/__tests__/runRecord.adoption.test.ts` | `jest.mock` of `fileManifest` and of the storage repository's sweep methods, for the `data-export` job (l.140–155) | Remove both mocks and their comment (the job is no longer in `BOS_CRON_JOBS`; a `jest.mock` of a deleted path fails) |
| G-9 | `lib/business-os/data-export/__tests__/joinedCsv.test.ts` | C-9 parity with `zipExport.sectionColumns` "until MX-6" (l.30, l.587–590) and the logger-mock comment (l.15) | Delete the parity block, the import and the comment; `joinedCsv.ts` l.90–93 comment updated ("the ZIP copy was deleted in MX-3.1") |
| G-10 | `lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts` | "the shared export control makes no client audit call and reads no table" lists `useDownloadMyData.ts` (l.176) | Replace it with `useExportDrawer.ts` and `ModuleExportEntry.tsx` (the client files that now drive the export); `DownloadMyDataButton.tsx` and the seam stay |
| G-11 | `app/admin/users/__tests__/source.guard.test.ts` | `DATA_EXPORT_FILES()` lists `DataExportReasonDialog.tsx` (l.55); the dialog-class list (l.538); "the Data export box" block (l.627–680: three URLs, https check, in-flight ref, timeout) | Remove the dialog from both lists; replace the ZIP-specific block with "the placeholder makes no request and imports nothing from the browser seam" (`fetch(` count 0, no `@/lib/client/businessOsDataExport`). The "mounted once, before the danger area" and "no backslash in the copy file" checks stay. **Claimed first** (DELETE's screen, CC-3) |
| G-12 | `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | T-30 asserts exactly one `GET …/data-exports` (l.835) | That line becomes "no export request" (`calls.filter(url => url.includes('/data-exports'))` equals `[]`). The box-position assertions stay. **Claimed first** (CC-3). The `…/data-exports` fetch mocks in this file and in `businessDetail.render.test.tsx` (l.204) are left as they are (inert), to keep DELETE's files out of the diff; SA may ask for their removal (Q-6) |
| G-12b | `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx` | `commonReads` lists the admin `GET …/data-exports cache=no-store headers=none` (l.326); READS-1, READS-2 and READS-3 pin the exact request list | **SA required change 1.** Remove that line and its comment; the test names "ten reads" → nine and "eight common reads" → seven; every list stays exact (nothing weakened). **Claimed first** (TL posted the claim, asserting lines only) |
| G-13 | `app/api/business-os/export-requests/__tests__/route.test.ts` source rule (l.411) | Asserts the switch is the first statement | Replaced (§6) |
| G-14 | `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts` l.797 | Regex names `isModuleExportEnabled` | Narrowed to the name that still exists (§6); the rule stays |
| G-15 | Tests of the deleted files (§5.1): `zipExport`, `zipEntries`, `zipWriter`, `fileManifest`, `readme`, `exportSweep`, `adminExportAudit`, `downloadName`, `fileName`, `ceiling`, `BusinessDataExportFilesRepository`, the five route tests, `downloadMyDataCopy.test.ts`, `ModuleExport.probe.qa.test.tsx`, `featureFlags.moduleExport.test.ts` | Their subjects | Deleted with the subjects |
| G-16 | Entitlements invariants (`npm run test:bos-entitlements`) | Nothing in scope imports the module | No edit; run once (§16) |

Tests that **render** `DownloadMyDataButton` in DELETE's and settings' suites (`DeleteAccountDrawer.*`, `DangerZonePanel.*`, `PlanCancelDrawer.*`, `PlanManage.*`, `app/business-os/settings/__tests__/downloadMyData.render.test.tsx`) all mock the button, so they are not affected. Confirmed by `grep` on `main`.

---

## 11. Audit

No new event, no removed event. `DATA_EXPORT_READY`, `_FAILED`, `_DOWNLOADED`, `_EXPIRED` and `_DOWNLOADED_BY_ADMIN` stay with their definitions and audience entries, because old rows carry them (K-6). After this merge nothing writes them. `DATA_EXPORT_REQUESTED` keeps being written by the request route; `DATA_EXPORT_MODULE_SENT` / `_FAILED` by the worker. `lib/audit/events.ts` and `eventAudience.ts` are not in the diff, so the audience totals on `main` (229 / 66 BOS / 79 shared) do not move.

---

## 12. Docs

| Doc | Change |
|---|---|
| `docs/FEATURE_FLAGS.md` | §6; v1.17.0; Change History row |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | Strike rows 115–117 (`users/[id]/data-exports` GET, POST and the download POST) as "🗑 deleted 2026-10-xx, export MX-3.1", following the rows 47–49 and 57–61 precedent; re-derive the census line only if the doc states a current total; Last Updated + Change History row |
| This workplan | Status, Implementation Notes after coding |
| Plan §4.6a, plan Change History, plan Status line | Workplan link and stage (done with this workplan) |
| Requirement §6 MX-3.1 row and Change History | Stage line (done with this workplan, per "always update the main requirement") |
| `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | **Not here**: MX-4 (R-7). It still describes the ZIP between MX-3.1 and MX-4; accepted inside the testing-mode decision |

---

## 13. Files to create / modify / delete

| File | Action | Reason |
|---|---|---|
| `docs/workplans/BUSINESS_OS_EXPORT_MX3_1_WORKPLAN.md` | create | This workplan |
| 5 ZIP route files + 6 route test files (§5.1) | delete | R-1, BQ-E6.1-1 |
| 13 lib files + 11 tests (§5.1, incl. `BusinessDataExportFilesRepository`) | delete | R-1, D-8, D-9 |
| `ZipDownloadControl.tsx`, `useDownloadMyData.ts`, `DataExportNotice.tsx`, `downloadMyDataCopy.ts` (+ test), `useModuleExportSwitch.ts`, `ModuleExport.probe.qa.test.tsx` | delete | R-1, switch |
| `featureFlags.moduleExport.test.ts`, `DataExportReasonDialog.tsx` | delete | Switch, BQ-E6.1-1 |
| `lib/utils/featureFlags.ts` | modify | §6 |
| `app/api/business-os/export-requests/route.ts` + `route.test.ts` + `route.qa.test.ts` | modify | §6 |
| `lib/admin/environment/catalogue.ts` + `catalogue.test.ts` | modify | §6 |
| `components/business-os/data-export/DownloadMyDataButton.tsx`, `ModuleExportEntry.tsx`, `ExportDrawer.tsx`, `useExportDrawer.ts`, `exportDrawerCopy.ts` | modify | §7 |
| `components/business-os/data-export/__tests__/DownloadMyDataButton.test.tsx` | modify (rewrite, ~80 lines) | "always the drawer": renders "Export data" for both variants, opens the drawer, makes one history GET on open and none on mount, props shape pinned, no ZIP route named |
| `__tests__/ModuleExport.render.test.tsx`, `agentPlatformEntryPoints.render.test.tsx`, `ExportDrawer.stacking.test.tsx`, `ExportDrawer.stacking.qa.test.tsx`, `exportDrawerCopy.test.ts` | modify | Drop probe cases and `initialHistory`; the stacking cases stay (SR-9) |
| `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` | modify | G-4 |
| `lib/client/businessOsDataExport.ts` | modify | §7.3 |
| `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx` | modify | D-10 (heading, sub-line, comment) |
| `app/admin/users/components/DataExportBlock.tsx`, `app/admin/users/dataExportCopy.ts`, `__tests__/dataExportBlock.render.test.tsx` | modify | §8 |
| `app/admin/users/__tests__/source.guard.test.ts`, `businessDrawer.layout.render.test.tsx`, `businessDrawer.pins.dangerReads.render.test.tsx` | modify (claimed) | G-11, G-12, G-12b |
| `lib/business-os/data-export/limits.ts` | modify (if Q-3 = yes) | D-8 |
| `lib/business-os/data-export/__tests__/csv.test.ts`, `sections.test.ts`, `joinedCsv.test.ts`, `exportClassification.test.ts`, `moduleExportWorker.test.ts`; `joinedCsv.ts`, `moduleExportWorker.ts` (comments) | modify | §5.1, G-5, G-9, G-14 |
| `vercel.json`, `lib/cron/bosCronJobs.ts`, `lib/cron/__tests__/bosCronJobs.test.ts`, `vercelCrons.test.ts` | modify | §9 |
| `app/api/cron/__tests__/runRecord.adoption.test.ts` | modify | G-8 |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | G-1 |
| `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts` | modify | G-2 |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | modify | G-3 |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | modify | G-7 |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | modify | G-6 |
| `lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts` | modify | G-10 |
| `docs/FEATURE_FLAGS.md`, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | §12 |

**Not touched (checked):** `BusinessOsDataExportJobRepository.ts`, `BusinessOsDataExportStorageRepository.ts`, `lib/repositories/index.ts`, `lib/repositories/types.ts`, `jobPolicy.ts`, `lib/audit/events.ts`, `eventAudience.ts`, `descriptors.ts`, any migration or cleanup script, `BusinessDetail.tsx`, `app/admin/users/types.ts`, `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `DeleteAccountDrawer.tsx`, `PlanCancelDrawer.tsx`, the translation bundles, `lib/security/rateLimit.ts`, `emailTransport.ts`.

---

## 14. Effort and proposed split

| Block | Effort |
|---|---|
| Switch removal: flag, route + two tests, catalogue + test, worker comment / test, flags doc | 0.4 d |
| Owner entry: button, entry, drawer, hook, copy, seam; rewrite of the button / render / entry-point tests, stacking tests adjusted | 0.6 d |
| ZIP deletions (routes, lib, components, their tests) and the follow-on edits in `csv.test`, `sections.test`, `joinedCsv.test`, `limits.ts` | 0.35 d |
| Guards G-1…G-14 | 0.4 d |
| Admin box placeholder + its tests; security-tab headings | 0.25 d |
| Cron registry and `vercel.json` with the hand count; docs (`FEATURE_FLAGS.md`, admin access doc) | 0.15 d |
| Verification: typecheck filtered to touched files, `npm run build`, full `npm test`, authz guard, entitlements suite, the grep checks | 0.35 d |
| **Total** | **🟡 2.5 d** (at the cap) |

The manual go-live gate (§17) is QA / user time and is not counted, as in earlier slices.

**Fallback split, only if SA wants it** (not proposed as the default, D-1):
- **MX-3.1a — go-live (≈1.6 d):** the switch removal, the owner entry, the owner ZIP routes and their guards, the sweep cron, the security-tab headings. The ZIP builder stays because the admin routes still use it.
- **MX-3.1b — admin and leftovers (≈1.1 d):** the admin routes and box placeholder, the ZIP builder files, the files repository, G-1, G-2, G-11, G-12, and the remaining guard edits.
The split costs about 0.2 d of extra review and leaves the admin ZIP live for a few days longer, which the user's BQ-E6.1-1 answer did not ask for.

---

## 15. Task list

- [x] T-0: Claims in the coordination file for the DELETE-area tests G-11 `source.guard.test.ts`, G-12 `businessDrawer.layout.render.test.tsx` and G-12b `businessDrawer.pins.dangerReads.render.test.tsx` (asserting lines only): posted by TL on 2026-10-30. The existing CC-6 claims on `vercel.json` and `bosCronJobs.ts` stand
- [x] T-1: `git fetch origin main` + `git merge origin/main`: fast-forward to `a0804002` (#569), **before** any edit to `bosCronJobs*`, `vercelCrons.test.ts`, `FEATURE_FLAGS.md` or `authAccountRepository.callers.guard.test.ts` (SA required change 3)
- [x] T-2: Switch removal (§6), with its tests
- [x] T-3: Owner entry, drawer, hook, copy and seam (§7); rewrite the button and render tests; adjust the stacking and entry-point tests
- [x] T-4: Delete the owner ZIP routes, the sweep cron route and their tests; remove the cron entries (§9) with the hand count
- [x] T-5: Delete the admin ZIP routes and the reason dialog; the admin box placeholder and its tests (§8)
- [x] T-6: Delete the ZIP lib files, the files repository, the ZIP components (§5.1); fix `csv.test`, `sections.test`, `joinedCsv.test`, `limits.ts` per Q-3 / Q-4
- [x] T-7: Guards G-1…G-14 (§10)
- [x] T-8: Security-tab headings (D-10)
- [x] T-9: Docs (§12)
- [x] T-10: Verification (§16.3); record outputs in Implementation Notes
- [ ] T-11: Hand to SA for code review; then QA; then the user's diff review (no commit before it)

---

## 16. Test plan

### 16.1 Kept and adjusted (CLAUDE.md: route = auth failure, invalid input, happy path)

| Suite | After MX-3.1 |
|---|---|
| `export-requests/__tests__/route.test.ts` | GET and POST: 401 without a session; 400 for a bad body (unknown module, switched-off module, extra key, empty list); 201 happy path with flushed audit and the "requested" email; 409 / 429 / 500 as today. **New:** with `BUSINESS_OS_MODULE_EXPORT_ENABLED` unset, a signed-in GET answers 200 and POST 201 (proves no hidden switch remains); the source rule of G-13 |
| `export-requests/__tests__/route.qa.test.ts` | QA 2 (POST route → seam verdict), invalid-input rows, QA 5 (history through the route) unchanged except the deleted 404 row; a 404 through the seam now reads `failed` (D-4) |
| `DownloadMyDataButton.test.tsx` (rewritten) | Both variants show "Export data" (en, plus he via the language context); a click opens the drawer; no fetch on mount; one history GET on open; Escape closes and focus returns to the trigger; the props interface is pinned by a source check |
| `ModuleExport.render.test.tsx` | Drawer opens with `loading`, then the list; a failed history read shows "could not be loaded" + Try again (this replaces the old "probe error still means on"); Try again reads again |
| `ExportDrawer.stacking*.test.tsx` | Unchanged behaviour (SR-9: inside the deletion drawer, Escape closes only the export layer); `initialHistory` no longer passed |
| `agentPlatformEntryPoints.render.test.tsx` | `/settings` and `/v2/settings` show the "Export data" heading and the entry, with no probe |
| `dataExportBlock.render.test.tsx` | Placeholder line, test id, zero `fetch` calls |
| `bosCronJobs.test.ts`, `vercelCrons.test.ts` | The hand-set literal (§9); no `data-export` entry |
| Guards G-1…G-14 | As in §10, each with its negative control still meaningful |

### 16.2 Deleted with their subjects

G-15 in §10.

### 16.3 Verification before hand-over (recorded with outputs)

1. `npx tsc --noEmit` filtered to the touched and deleted paths' neighbours, checked for a V8 crash (an OOM prints a stack trace and no diagnostics). Also a grep for any remaining import of a deleted module: `zipExport`, `zipExportDeps`, `zipEntries`, `zipWriter`, `fileManifest`, `data-export/readme`, `exportSweep`, `adminExportAudit`, `downloadName`, `data-export/payload`, `data-export/fileName`, `data-export/ceiling`, `BusinessDataExportFilesRepository`, `ZipDownloadControl`, `useDownloadMyData`, `DataExportNotice`, `downloadMyDataCopy`, `useModuleExportSwitch`, `DataExportReasonDialog` (must be zero)
2. `npm run build` succeeds (ship drill step 1)
3. Full `npm test` green (not only the touched suites: deleted modules are mocked by path in other suites, G-8 is the known case)
4. `npm run test:authz-guard` and `npm run test:bos-entitlements` green
5. AC greps: no `isModuleExportEnabled` / `BUSINESS_OS_MODULE_EXPORT_ENABLED` in `app/`, `components/`, `lib/`, and only the history row in `docs/FEATURE_FLAGS.md` (Q-5); no `/api/business-os/data-exports` or `/api/cron/data-export"` outside tests' negative controls and the guard's "does not exist" check; `git diff --stat main -- lib/repositories/BusinessOsDataExportJobRepository.ts` empty
6. `npm run lint:hooks` (a hook file is deleted, two are edited)
7. No backslash in any new or edited doc / copy file

### 16.4 Not testable in Jest

Everything in §17 (c).

---

## 17. Manual go-live gate

### 17.1 Before merge (ops; the user or TL, recorded in this workplan and the coordination file)

| # | Check | Pass |
|---|---|---|
| P-1 | `agentspilot.ai` is verified in Resend: SPF, DKIM and DMARC records green | Screenshot or the three statuses written down |
| P-2 | `RESEND_FROM_EMAIL` is set in Vercel Production and Preview (`notifications@agentspilot.ai`, BQ-E6.1-2) | Value confirmed (name only in the record, no secret) |
| P-3 | The Resend plan's sending limit and monthly quota checked against 13 modules × up to 10 emails per request, plus the "requested" email, with 2 requests per owner per 24 h | Numbers written down; the worst case per owner per day is 2 × (1 + 130) = 262 emails |
| P-4 | Legal open issue 2 is **not** a merge gate (BQ-E6.1-2): it is a launch gate before the first real, non-test customer | Restated in the PR so nobody waits on it |
| P-5 | The deleted routes' last real use: none needed (testing mode, R-4) | — |

### 17.2 After deploy

| # | Step | Record |
|---|---|---|
| (a) | Remove `BUSINESS_OS_MODULE_EXPORT_ENABLED` from Vercel Production and Preview | Done-at time |
| (b) | Empty the bucket `business-data-exports` (Supabase dashboard or the Storage API; the sweep that expired its objects is gone) | Object count before and after (after = 0). Done by the user or with a read-only count by Dev / QA through the Supabase MCP, the removal itself by the user |
| (c) | Live end-to-end on the `+test` account (below) | Request ids, Resend ids, results |

**(c) in detail.** Run in production (or locally: both reach the same database, and the production worker sends a locally created request). The account may make **2 requests per rolling 24 h, one at a time**, so the checks are grouped into at most two requests:

1. **Request 1 (small):** one or two small modules from the `/business-os/settings` row. The "Export data" drawer opens; the "requested" email arrives with the module names and the time in the owner's zone; each module email arrives within about 5 minutes; the history shows "Waiting", then "Sent" with the email count. Record the request id.
2. **MX-1b deferred checks** (R-4; "Not verified" 2–6 and 8–10), on the same request where they need one: the drawer from all four entries (`/business-os/settings` row, Danger Zone, `/settings`, `/v2/settings`) and from DELETE's deletion drawer; a pointer press on the outer Danger Zone dialog does not close both layers; keyboard only (Tab order, Space, Enter, Escape, focus returns, one visible X); screen reader (the status line announces "Export started…", refusals as alerts, labels and legend); Hebrew RTL (drawer side, alignment, chevron, the address and dates whole, the Gmail date line keeps its parentheses); the history visuals match the invites / boost lists; one Pino line and one `audit_trail` row for the request, with only `request_id`, `modules`, `origin` in `details`. Check 8 is re-read as "a failed history read opens the drawer with 'could not be loaded' and Try again"; checks 1 and 7 are moot
3. **T-Q3, moved from MX-3b (user decision 2026-10-29):** a module large enough to need two emails (about 18,000 Hebrew rows) arrives as "1 of 2" and "2 of 2"; a repeated send of part 1 with the same idempotency key returns the same Resend id and no third email arrives; the Hebrew reads right to left in Gmail and Outlook; both CSVs open in Excel with the header and Hebrew intact. Record both Resend ids. How to produce 18,000 Hebrew rows without writing them into the shared database is open (Q-7)
4. **Real-database read time for 100,000 rows** (the T-Q1 gap): recorded. How, without seeding 100,000 rows into production, is open (Q-7)

The C-10 rule ("no request row left from testing") no longer applies after go-live: the `+test` rows are intended (R-4). They go with the test-account cleanup like any other row.

---

## 18. Coordination (CC-1 … CC-8)

| Step | When | What |
|---|---|---|
| CC-1 | Done 2026-10-30 | Coordination file read; E6.1 row and CC-6 claims logged; #569 noted |
| CC-3 | Before T-7 | Claim G-11 and G-12 (DELETE's `/admin/users` screen tests); message DELETE |
| CC-5 | Workplan approved | `[EXPORT→DELETE] MX-3.1 workplan approved` |
| CC-6 | `vercel.json`, `bosCronJobs.ts`, `featureFlags.ts`, `FEATURE_FLAGS.md` | Remove only EXPORT's own entries, at EXPORT's anchors; hand count per §9 |
| **Interface notice** | **Before the PR opens** | Append to the coordination file and send `[EXPORT→DELETE] MX-3.1 interface notice — export switch removed; DownloadMyDataButton always opens the export drawer and reads "Export data"; ZIP routes and data-export cron removed; findDeletionFacts unchanged and still blind to module exports until MX-4`. This is DELETE's cue to fix its own "Download my data" copy (`settings.account_delete.warning`, the `DangerZonePanel` fallback, `DeleteAccountDrawer`'s "Settings → Download my data" and its test l.73) in D7 or a small PR timed with this one (S-4). EXPORT does not edit that copy |
| CC-5 | PR opened, merged | `[EXPORT→DELETE] MX-3.1 PR opened`; `[EXPORT→DELETE] MX-3.1 merged — new export live` |
| CC-8 | After merge | Status row; release the CC-6 and CC-3 claims; log the post-deploy steps (a)–(c) with times and counts. Remind DELETE that their switch-on still waits for MX-4 merged (B.4, R-5) |

---

## 19. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A deleted module is still `jest.mock`ed or read by path in a suite not found by the import grep, and the full run goes red (G-8 was such a case) | §16.3 step 1 greps path strings too (`readFileSync`, `path.join` segments), and step 3 runs the full suite, not only the touched ones |
| R-2 | The cron literal is wrong because #569 lands between implementation and merge | §9: count on fresh `main` at implementation and again before enqueue; the merge queue re-runs both cron tests on the merged result |
| R-3 | An owner with a ready ZIP loses its link at deploy, and the bucket is then emptied | Accepted by the user's 2026-10-27 decision (testing mode; XC-15 no longer applies) |
| R-4 | Live testing hits the daily limit (2 per 24 h, one at a time), or sends real emails from a local run | Checks grouped into at most two requests (§17.2); only the `+test` account is used; a local run is treated as a production send |
| R-5 | Between MX-3.1 and MX-4 the deletion check and receipts do not see module exports | Accepted by SA (R-5 of the plan) on two conditions: MX-4 follows directly, and DELETE's switch-on waits for MX-4 merged. Restated in the interface notice |
| R-6 | Old `business_os_data_exports` rows in `queued` / `running` / `ready` stay in those states forever, since nothing reaps or expires them now | Harmless: nothing reads their status except `findDeletionFacts` (which reads `ready_at` / downloaded facts, unchanged) and the old start function, which nothing calls. MX-7 drops the table |
| R-7 | Resend quota or rate limit (2/s team-wide, shared with DELETE's lifecycle job) is lower than the worst case | P-3 before merge; the worker already sends sequentially ≥ 600 ms apart and honours `retry-after` (MX-3) |
| R-8 | The contents doc describes the ZIP until MX-4 | Accepted (R-7 of the plan); MX-4 starts right after this merge |
| R-9 | A revert after the bucket is emptied | The PR has no migration, so a revert restores the ZIP code and the switch (which would then be unset, so off); old ZIP links stay gone, new ZIPs can be built. The env var would have to be re-added only if the drawer is wanted back behind the switch |

---

## 20. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | `downloadMyDataCopy.ts`: delete whole, or keep a file for the label? The plan's frozen-interface row says the label "may change (`downloadMyDataCopy.ts`…)" | Delete whole (D-7). The "Export data" label is already `exportDrawerCopy.entryLabel`; a second copy file holding one string would be a duplicate. The frozen interface is the component, not the copy file |
| Q-2 | `BusinessDataExportFilesRepository.ts` is not named in R-1 or R-3. Delete it now with `fileManifest.ts` (its only importer), or keep it to MX-7? | Delete now (D-9). It is ZIP builder code ("Your files"), not old-table code; not in the barrel, so `index.ts` is untouched (its stale comment goes in MX-7) |
| Q-3 | `limits.ts`: remove the nine ZIP-only keys and the DE-8b comment half, or leave the file as is? | Remove them: their only readers are deleted, and a ceiling nobody checks reads like a promise. `ROW_CEILING`, `PAGE_SIZE`, `VIA_PARENT_CHUNK` stay; G-4 check 5 still holds |
| Q-4 | `csv.ts` `toCsv` (Uint8Array) loses its only production caller. Remove it? | Leave it: three lines in the BC-1 rule file, and `toCsvText` stays as the test seam. Remove in MX-7 if SA prefers |
| Q-5 | AC "No `BUSINESS_OS_MODULE_EXPORT_ENABLED` remains in `docs/FEATURE_FLAGS.md`": does the 1.15.0 Change History row count? | Keep the history row (Change History is a record, CLAUDE.md doc standard); the env-table row and the detail section go |
| Q-6 | The inert `GET …/data-exports` mocks in DELETE's `/admin/users` drawer tests (`businessDetail.render.test.tsx` l.204, `businessDrawer.layout.render.test.tsx` l.228): remove them too? | Leave them: they answer a request nobody makes, and removing them adds a DELETE file to the diff for no behaviour. Only the asserting line (G-12) changes |
| Q-7 | T-Q3 and the 100,000-row read time need large data. Seed 18,000 Hebrew rows (and 100,000 rows) into the `+test` account in the shared production database, or not? | Not seed. (1) T-Q3 two-part, repeated-key, Gmail / Outlook RTL and Excel: the no-database-write script described in the MX-3 workplan (QA pass 2, "T-Q3: what TL / the user must do"), sending real parts to the `+test` address; the live e2e in (c)1 covers the real worker with real data. (2) Read time: a read-only timing of the section readers (`runExportSections` with `listOwnedRowsForExport` paging) against the largest real account, scaled per 1,000 rows, run locally with no send. SA to rule whether that satisfies "real-database read time for 100,000 rows" |
| Q-8 | G-4: add a "the ZIP routes and the sweep cron do not exist" check? | Yes (§10): it is the check-2 precedent for the retired JSON route, costs nothing, and catches an accidental revert |
| Q-9 | Security-tab sub-line wording (D-10) | "Choose what to export. Each part arrives by email." The user sees it in the diff |


**SA rulings applied (2026-10-30, see the SA Workplan Review below):** Q-1: delete `downloadMyDataCopy.ts` whole; the plan §3 frozen-interface row is amended to name `exportDrawerCopy.entryLabel` (C-7; the requirement B.6 line is not edited, and the interface notice names the new location). Q-2: delete `BusinessDataExportFilesRepository.ts` now; the stale `lib/repositories/index.ts` comment (l.364) goes on MX-7's list. Q-3: remove the nine ZIP-only keys and the DE-8b header half. Q-4: keep `csv.ts` `toCsv`; "`toCsv` (no production caller since MX-3.1)" goes on MX-7's list. Q-5: keep the 1.15.0 row; the grep expects exactly that one match (§6). Q-6: leave the inert mocks. Q-7: no seeding of any kind; T-Q3 runs by the no-DB-write script (after P-1), and the read time is taken only on the `+test` account or the user's own account, labelled "estimate (extrapolated)". Q-8: yes. Q-9: wording approved. **Changes 5 to 8, applied during implementation:** C-5 re-count the admin access census from disk; C-6 no auto-merge before P-1 to P-3 are recorded and the user has seen the diff; C-7 the plan §3 row; C-8 the §16.3 grep covers path strings and `jest.mock` strings, and the full `npm test` is compared against a `main` baseline run.
---

## 21. Business questions

None new. BQ-E6.1-1 (accept the admin gap; placeholder line) and BQ-E6.1-2 (ship the defaults; legal open issue 2 is a launch gate before the first real customer, not this merge) were answered on 2026-10-27 and are applied as written. The user's 2026-10-29 decision moves T-Q3 and the real-database read time into (c); Q-7 asks SA only **how** to run them.

---

## Implementation Notes (MX-3.1)

**Date:** 2026-10-30. **Branch:** `feature/bos-export-mx3-1-remove-switch-and-zip`, fast-forwarded to `origin/main` `a0804002` (holds #569) before any code edit (T-1). Uncommitted; nothing staged. T-0 claims posted by TL (G-11, G-12, G-12b, asserting lines only).

### Files

**Deleted (45):**

| Area | Files |
|---|---|
| Owner ZIP routes | `app/api/business-os/data-exports/route.ts`, `…/[jobId]/parts/[partNo]/download/route.ts`, and their 3 tests (`route.test.ts`, `route.get.test.ts`, the download `route.test.ts`) |
| Admin ZIP routes (BQ-E6.1-1) | `app/api/admin/users/[id]/data-exports/route.ts`, `…/[jobId]/parts/[partNo]/download/route.ts`, and their 2 tests |
| Sweep cron | `app/api/cron/data-export/route.ts` and its test |
| ZIP lib | `lib/business-os/data-export/` `zipExport`, `zipExportDeps`, `zipEntries`, `zipWriter`, `fileManifest`, `readme`, `exportSweep`, `adminExportAudit`, `downloadName`, `payload`, `fileName`, `ceiling` (`.ts`), and the 10 tests of those that had one |
| Files repository (Q-2) | `lib/repositories/BusinessDataExportFilesRepository.ts` and its test |
| ZIP UI and switch | `components/business-os/data-export/` `ZipDownloadControl.tsx`, `useDownloadMyData.ts`, `DataExportNotice.tsx`, `downloadMyDataCopy.ts` (+ test, Q-1), `useModuleExportSwitch.ts`, `__tests__/ModuleExport.probe.qa.test.tsx`; `lib/utils/__tests__/featureFlags.moduleExport.test.ts` |
| Admin | `app/admin/users/components/DataExportReasonDialog.tsx` |
| Seam ZIP tests (found by the C-8 grep, not in §5.1) | `lib/client/__tests__/businessOsDataExport.test.ts`: every case in it tested the deleted ZIP half of the seam (`startDataExport`, `downloadDataExportAgain`, `fetchLastDataExport`, `saveSignedDownload`, `isSafeDownloadUrl`) |

**Modified (production):** `lib/utils/featureFlags.ts` (reader removed at EXPORT's anchor), `app/api/business-os/export-requests/route.ts` (switch lines, `notFound`, import, header line), `lib/admin/environment/catalogue.ts` (entry), `lib/client/businessOsDataExport.ts` (ZIP half removed; history verdict `ok` or `error`; `MODULE_EXPORT_PROBE_TIMEOUT_MS` renamed `MODULE_EXPORT_HISTORY_TIMEOUT_MS`; start refusal `off` removed, a 404 is `failed`), `components/business-os/data-export/DownloadMyDataButton.tsx` (always `ModuleExportEntry`; name, path, props, both exports unchanged), `ModuleExportEntry.tsx`, `ExportDrawer.tsx`, `useExportDrawer.ts` (first history state `loading`), `exportDrawerCopy.ts` (`off` key removed in en / he / es), `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` ("Export data", Q-9 sub-line), `app/admin/users/components/DataExportBlock.tsx` (placeholder, same export, props, `data-testid`s), `app/admin/users/dataExportCopy.ts` (title + placeholder only), `lib/business-os/data-export/limits.ts` (nine ZIP keys and the DE-8b header half, Q-3), `joinedCsv.ts` and `moduleExportWorker.ts` (comments), `lib/cron/bosCronJobs.ts` (entry and union id), `vercel.json` (one entry).

**Modified (tests and guards):** G-1 `adminGate.writes.test.ts` (69 → 66), G-2 `authAccountRepository.callers.guard.test.ts`, G-3 `ownerAuditReads.guard.test.ts`, G-4 `oneExportControl.guard.test.ts`, G-5 `exportClassification.test.ts`, G-6 `accountCard.guard.test.ts`, G-7 `clientPaymentsUsd.source.guard.test.ts`, G-8 `runRecord.adoption.test.ts`, G-9 `joinedCsv.test.ts`, G-10 `pluginConnectionsBrowserAccess.guard.test.ts`, G-11 `app/admin/users/__tests__/source.guard.test.ts`, G-12 `businessDrawer.layout.render.test.tsx` (two asserting lines), G-12b `businessDrawer.pins.dangerReads.render.test.tsx` (one list line, four test names), G-13 / G-14 (route and worker source rules); `bosCronJobs.test.ts` and `vercelCrons.test.ts` (24 → 23), `catalogue.test.ts`, `route.test.ts`, `route.qa.test.ts`, `DownloadMyDataButton.test.tsx` (rewritten), `ModuleExport.render.test.tsx`, `ExportDrawer.stacking.test.tsx`, `ExportDrawer.stacking.qa.test.tsx`, `agentPlatformEntryPoints.render.test.tsx`, `exportDrawerCopy.test.ts` (a test name), `dataExportBlock.render.test.tsx` (rewritten), `lib/client/__tests__/businessOsDataExport.moduleExport.test.ts`, `csv.test.ts`, `sections.test.ts`, `moduleExportWorker.test.ts`.

**Docs:** `docs/FEATURE_FLAGS.md` 1.16.1 → 1.17.0 (row and section removed, new history row written without the variable name); `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (rows 115–117 struck, census re-counted from disk, C-5); plan §3 frozen-interface row (C-7) and MX-7 list (Q-2, Q-4).

**Not touched (checked with `git diff --stat`):** `BusinessOsDataExportJobRepository.ts`, `BusinessOsDataExportStorageRepository.ts`, `lib/repositories/index.ts`, `lib/repositories/types.ts`, `jobPolicy.ts`, `lib/audit/events.ts`, `eventAudience.ts`, `descriptors.ts`, every migration and cleanup script, `BusinessDetail.tsx`, `app/admin/users/types.ts`, `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `DeleteAccountDrawer.tsx`, `PlanCancelDrawer.tsx`, the translation bundles, `emailTransport.ts`.

### Deviations and decisions for SA

| # | Deviation | Why |
|---|---|---|
| V-1 | `lib/client/__tests__/businessOsDataExport.test.ts` deleted, and `businessOsDataExport.moduleExport.test.ts` edited; neither was in §5.1 / §13 | Found by the C-8 path grep. The first file tests only the deleted ZIP half of the seam (deleted with its subject). The second pinned `off` / `unknown` verdicts that D-3 / D-4 remove; its cases now expect `error` / `failed`, and every other case is unchanged |
| V-2 | The request route tests do not set or unset the env variable any more, and no test names it | The AC grep covers `app/` (tests included), so a test that named the variable would break the exact-match rule (Q-5). The whole suite now runs with the variable unset, which is the proof that no switch remains. The new source rule asserts no `featureFlags`, no `notFound`, no `, 404)`, and that each handler's first statement is the correlation id line |
| V-3 | `agentPlatformEntryPoints.render.test.tsx`: the "no export button of its own" check now queries `/export/i` buttons instead of `/export data/i` | The card heading itself now reads "Export data". The check still refuses any export button drawn by the screen (the control is mocked as a `div`) |
| V-4 | G-4 keeps `codeOf` and the CRLF handling; the new regexes use `(?![\w-])` instead of a word-boundary escape | Same meaning for these paths, and no new backslash-plus-hex escape in a scanned file |
| V-5 | `DrawerBox.tsx`'s purpose line for `export` ("This account's exports; admin downloads are recorded with your name and reason.") is **left as is** and goes stale until MX-5 | It is pinned word for word by `drawerBox.render.test.tsx` (DB-5, "approved copy") and owned by the admin layout standard, not by this slice. Changing approved copy needs TL / user approval. Proposal for SA / TL: accept it until MX-5 rewrites the box, or approve a replacement line in a small follow-up. Dev's suggestion: "Owners export their own data; admin export returns soon." (9 words, within the 12-word rule) |
| V-6 | `DataExportBlock` takes `_props: Props` | SA optimisation suggestion: `accountId` stays in `Props` for the frozen mount, with no unused binding |

### Verification

| # | Check (§16.3, SA C-8) | Result |
|---|---|---|
| 1 | Path-string grep (imports, `readFileSync` / `path.join` segments, `jest.mock('…')` strings) for every deleted module and every removed seam export, over `app components lib hooks scripts tests .github __mocks__` | It found two files outside §5.1 (V-1), which were handled. After the fix the remaining hits are history comments only (`exportDrawerCopy.ts` header, `joinedCsv.ts` comment, `moduleExportWorkerDeps.ts` "zipExportDeps precedent", the stale `lib/repositories/index.ts` l.364 comment left for MX-7 per Q-2), one negative assertion in the new `DownloadMyDataButton.test.tsx`, and `BusinessOsDataExportStorageRepository.ts`'s own `downloadName` parameter (unrelated word) |
| 1b | Route-path grep (`/data-exports`, `cron/data-export`, `'data-export'`) | Only: `app/admin/users/types.ts` doc comments (DELETE-owned, not edited), the inert drawer-test mocks (Q-6), G-4's own planted / retired-dir strings, the frozen `BusinessOsDataExportJobRepository.ts` comment, two history comments in `lib/audit/owner*.ts` (D-12), and the adminGate arithmetic comment |
| 2 | AC switch grep `grep -rn -e isModuleExportEnabled -e BUSINESS_OS_MODULE_EXPORT_ENABLED app components lib docs/FEATURE_FLAGS.md` | **Exactly one line**: `docs/FEATURE_FLAGS.md:17`, the 1.15.0 Change History row (Q-5) |
| 3 | Scoped `tsc --noEmit` over the 46 touched TS files plus 13 importers (`BusinessDetail.tsx`, `DangerZonePanel.tsx`, settings `page.tsx`, `PlanCancelDrawer.tsx`, `DeleteAccountDrawer.tsx`, `sections.ts`, `BusinessDataExportRepository.ts`, the two jobs-page builders, the two old export repositories, `lib/repositories/index.ts`, the worker cron route); `NODE_OPTIONS=--max-old-space-size=8192` | **Completed** (149 lines of diagnostics, no heap or FATAL line, so no OOM). 105 errors, all in files this slice does not touch (`lib/business-os/gaps/definitions.ts` 55, `StripeInvoiceService.ts` 12, …), except one: `exportClassification.test.ts(2029,42)` TS2353 `'scope'`, which is **pre-existing** (line 2029 is outside every hunk of this diff, which touches l.1715–1749 only). Zero errors in any line this slice wrote |
| 4 | Touched suites + every guard G-1…G-16 (`components/business-os/data-export`, `export-requests`, `lib/client/__tests__/businessOsDataExport*`, `lib/business-os/data-export`, `app/admin/users`, `adminGate.writes`, callers guard, `ownerAuditReads`, `accountCard`, `clientPaymentsUsd`, `app/api/cron`, `lib/cron`, `pluginConnectionsBrowserAccess`, `lib/admin/environment`, `lib/utils/__tests__`, authz surface guard) | 86 suites, 2,918 tests: **2,917 passed, 1 failed**. The failure is `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` ("only the resolver and the documented exceptions read the variable"), which **fails on the `main` baseline too** (listed below) |
| 5 | `npm run test:authz-guard` (required) | 2 suites, 203 tests, all passed, no edit |
| 6 | `npm run test:bos-entitlements` (G-16) | 330 suites, 9,833 tests, all passed |
| 7 | `npm run lint:hooks` (required) | exit 0 |
| 8 | Full `npm test` against a `main` baseline on the same checkout | **Baseline** = this worktree at `a0804002` before any code edit (docs-only changes): 1,919 suites (1,886 passed, 25 failed), 48,754 tests (48,543 passed, 146 failed, 65 skipped). **After:** 1,898 suites (1,864 passed, 26 failed), 48,196 tests (47,984 passed, 147 failed, 65 skipped). Diff of the failure sets: **0 baseline failures fixed or changed; 1 new failure in the full run**: `components/business-os/settings/__tests__/upgradeModal.um2.qa.render.test.tsx` "StrictMode false: ONE read on mount…". It does not import any touched file (grep: no export, data-export or DownloadMyData reference), it failed in the full run and once more when re-run alone, both times while `next build` was running in parallel; it **passed 3 of 3 re-runs** (15 / 15) once the CPU was free. Recorded as a load-timing flake, not ours. The 21 fewer suites and 558 fewer tests are the deleted ZIP / switch / seam-ZIP suites |
| 9 | `npm run build` with the CI placeholder env from `.github/workflows/build.yml` (`NODE_OPTIONS=--max-old-space-size=6144`, `NEXT_TELEMETRY_DISABLED=1`, the `ci.invalid` Supabase URL and `ci-not-a-real-key` values) | **exit 0**, "Compiled successfully". The route table names `export-requests` and `data-export-modules` and none of the deleted routes. The one warning block ("Compiled with warnings": a Node.js API in the Edge Runtime through `@supabase/realtime-js` → `lib/security/onboardingVerdict.ts`, the middleware) is unrelated to this diff |
| 10 | `console.*` in touched code files | **0** calls. The four grep hits are the word "console" in comments / test names (`dataExportCopy.ts` header; `source.guard.test.ts` test titles) |
| 11 | Frozen files | `git diff --stat` is empty for `BusinessOsDataExportJobRepository.ts`, `app/admin/users/types.ts`, `BusinessDetail.tsx`, `lib/audit/events.ts`, `lib/audit/eventAudience.ts` |
| 12 | Cron recount by hand (C-6) on the merged tree | `vercel.json` `crons`: 24 → **23**; `BOS_CRON_JOBS`: 24 → **23**. Both tests set to 23. Re-check before enqueue stays with RM |
| 13 | No backslash-plus-hex escape added | The new and rewritten code uses `(?![\w-])` in place of a word-boundary escape; every doc line added has no backslash |

**Diff:** 96 files changed, 366 insertions, 11,251 deletions (45 files deleted). Not committed.

**Non-passing suites on the `main` baseline (`a0804002`), for the record:** `bookingNextStep`, `IRToNaturalLanguageTranslator`, `logical-ir validation`, `StructuredTransforms` (+ `.wp33`, `.wp37`), `LogicalIRCompiler`, `servicesAreDraftsWithWords.guard`, `v4-generator`, `theChainHoldsEndToEnd`, `freeSlotsComposesSharedRules.guard`, `TokenBudgetManager`, `ConditionalEvaluator` (+ `.contains_any`), `bookingMailLandsOnTheJourney.guard`, `openaiPricingAdapter`, `jobOverAfterHeldMeeting.guard`, `IntentClassifier`, `bookingsSearchAndPaging.guard`, `supabaseFetch`, `aCancelledMeetingSaysWhetherItWasSent.guard`, `oneAddressPolicy.guard`, `publicEndpointsAreThrottled.guard`, `noIntakeToSendOnADeadJob.guard`, `stripeDecidesConnectStatus.guard`, `enum-drift`, `marketingGate`, plus the 8 `tests/plugins/integration-tests/*` suites that need live credentials. None of them is touched by this slice.

**Not run (by instruction):** T-Q3, the 100,000-row read-time estimate and every live check of §17 (QA's, after P-1 and after deploy).

---

## SA Review Notes

## SA Workplan Review — 2026-10-30

**Reviewed by SA — 2026-10-30**
**Status:** APPROVED WITH CHANGES. The approach is right: one PR, mostly deletion, no migration, frozen files left alone. Dev may start implementing once required changes 1 to 4 are written into §9 / §10 / §13 / T-0 of this workplan. Changes 5 to 8 are applied during implementation and checked at code review.

### What SA checked against the tree

Checked against branch `117979c6` and fresh `origin/main` (`a0804002`, which already holds #569).

| Check | Result |
|---|---|
| Delete list (§5.1): importers of every listed module, by import and by path string, across `app/`, `components/`, `lib/`, `scripts/`, `tests/`, `.github/`, `hooks/` | ✅ Matches. After the deletions, no importer outside the delete set is left for `zipExport`, `zipExportDeps`, `zipEntries`, `zipWriter`, `fileManifest`, `readme`, `exportSweep`, `adminExportAudit`, `downloadName`, `payload`, `fileName`, `ceiling`, `BusinessDataExportFilesRepository`, `ZipDownloadControl`, `useDownloadMyData`, `DataExportNotice`, `downloadMyDataCopy`, `useModuleExportSwitch` or `DataExportReasonDialog`. The `payload` hit in `lib/business-os/bizql/analyse/AnalysisService.ts` is that module's own `./payload` and is not affected. `moduleExportWorkerDeps.ts` names `zipExportDeps` in a comment only |
| Keep list (§5.2) | ✅ `limits.ts`: the nine ZIP-only keys have no reader outside the deleted files, so Q-3 is safe. `formatExportTime.ts` (not listed) stays, because `ExportDrawer.tsx` reads it. `csv.ts` `toCsv` is still tested by `csv.test.ts` |
| Every switch mention | ✅ `grep` finds `isModuleExportEnabled` / `BUSINESS_OS_MODULE_EXPORT_ENABLED` only in the files §6 lists, plus docs outside the AC scope (requirements and workplans: history, leave them) |
| Frozen files | ✅ `BusinessOsDataExportJobRepository.ts`, `app/admin/users/types.ts` (`AdminDataExportRow`, DELETE-owned), `BusinessDetail.tsx` and `DownloadMyDataButton`'s name, path, props and both exports are kept. §7.1 matches the frozen shape |
| DELETE-area tests that render the button | ✅ All ten suites mock `DownloadMyDataButton` (confirmed one by one), so they do not change |
| Admin authz surface guard (required) | ✅ No entry names these routes; the count is a floor (≥ 40). `adminGate.writes` 69 → 66 is correct for 3 removed handlers |
| Entitlements invariants (required) | ✅ No file in scope imports `lib/business-os/entitlements/`. #569 touched `enforcementPoints.test.ts`; this slice does not |
| React hooks guard (required) | ✅ Two hook files deleted, `useExportDrawer` edited, no new `use…` plain function |
| Type check / Build (required) | ✅ No `Record<BosCronJobId, …>` map holds `'data-export'` (only `JobsQueuesView.tsx` uses the type, for another id). `next.config.js` ignores lint during builds |
| Gate tests | ⚠️ Two misses, see required changes 1 and 2. Both would turn the full Jest run red |
| `console.*` in touched files | ✅ None |

### Required changes

1. **Missed asserting test (G-12b).** `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx` l.326 lists `GET /api/admin/users/${id}/data-exports cache=no-store headers=none` in `commonReads`, and READS-1, READS-2 and READS-3 pin the exact request list. With the placeholder making no request, all three fail. Remove that line and its comment. Update the counts in the test names ("ten reads" becomes nine, "eight common reads" becomes seven), and keep each list exact, so no assertion is weakened. It is a DELETE-screen test, so add it to the T-0 / CC-3 claim with G-11 and G-12, and to §10 and §13. The other inert `…/data-exports` mocks (`closeMidDelete`, `money`, `pins.boost`, `pins.credits`, `businessDetail`, `layout` l.228) only answer a request and stay, as Q-6 says.
2. **G-3 (`ownerAuditReads.guard.test.ts`) needs two more edits.**
   - (a) The module-wide non-vacuity at l.222 expects `payload.ts`, which this slice deletes. Replace it with a file that stays (`moduleExportWorker.ts` or `joinedCsv.ts`). Keep `sections.ts` and `classification.ts`.
   - (b) The per-route case has a non-vacuity check, "source matches `AUDIT_EVENTS.DATA_EXPORT_`". `app/api/business-os/export-requests/route.ts` has one such write and passes. `app/api/cron/data-export-modules/route.ts` has none, so the re-point as written in §10 fails. Fix: `DATA_EXPORT_ROUTES` becomes the request route only, and its non-vacuity stays unchanged. Add the cron route as its own case: `readsNoAuditRows` must be true, and its non-vacuity is that it imports the worker. The worker's own audit writes are already covered by the module-wide rule. Do not drop or relax the audit-write non-vacuity for the request route.
3. **Facts moved since the workplan was written. Update §1, §6, §9 and T-1.** #569 has merged (`origin/main` `a0804002`): `bosCronJobs.test` and `vercelCrons.test` pin **24**, so this slice's literal is **23**. The C-6 recount by hand still runs at implementation and again before enqueue. #569 also edited `docs/FEATURE_FLAGS.md` (now **1.16.1**, so bump 1.16.1 → 1.17.0) and `authAccountRepository.callers.guard.test.ts` (G-2). T-1, merging `origin/main` into the branch, must therefore happen **before** any edit to those files.
4. **G-4 check 4: invert the non-vacuity, do not just drop it.** The current test asserts that the seam **does** name `/api/business-os/data-exports`. After the change, assert that the seam does **not** name it, and still names `/api/business-os/export-requests`. The outside-the-seam regex keeps refusing both routes. Add the Q-8 "the ZIP routes and the sweep cron do not exist" check with `existsSync` on the three directories. Re-point the check-4 negative controls as §10 says, and keep a `data-exports` planted case, so the refusal of the old route is still proven.
5. **`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` states a census** (Change History: "census 110 = 104 + 6 + 0, 81 files", plus any current-total line in the body). Strike rows 115 to 117 as §12 says, **re-count from disk** (route files and handlers, HEAD included), and write the new census with its arithmetic in the new Change History row. Do not subtract by hand: other admin routes landed after 2026-10-18.
6. **No auto-merge while the pre-merge gate is open.** P-1 to P-3 are manual pre-merge gates, so CI is not the only gate. RM switches on auto-merge only after P-1 to P-3 are recorded here and in the coordination file, and after the user has reviewed the diff (K-10: no fast-track is recorded for E6.1).
7. **Q-1 follow-on (docs only).** The plan's §3 frozen-interface row says the label lives in `downloadMyDataCopy.ts`. Amend that row in the plan to say it lives in `exportDrawerCopy.entryLabel` from MX-3.1. Do **not** edit the requirement's §11 B.6 line: it is paired text mirrored into DELETE's file, and its parenthetical is not normative. Mention the new location in the interface notice instead.
8. **§16.3 step 1 must cover path strings.** The grep includes `readFileSync` / `join(…)` path segments and the `jest.mock('…')` strings of every deleted path, not only `import` lines. That is how G-8 and required change 2(a) would have been missed. Record the grep output in Implementation Notes. For step 3, record the full `npm test` result **against a `main` baseline run** on the same checkout, so a failure that already exists on `main` (CRLF, Windows) is named and not counted as ours.

### Rulings on Q-1 … Q-9

| # | Ruling |
|---|---|
| Q-1 | **Agree: delete `downloadMyDataCopy.ts` and its test whole.** The frozen interface is the component, not the copy file. A one-string file would duplicate `entryLabel`. See required change 7 for the doc note |
| Q-2 | **Agree: delete `BusinessDataExportFilesRepository.ts` and its test now.** It is ZIP-builder code (the "Your files" folder), not old-table code. R-3 does not hold it, `fileManifest.ts` is its only importer, and it is not exported from the barrel. Leave the stale `index.ts` comment (l.364) for MX-7 (S-16 is add-only), and add that comment to MX-7's list |
| Q-3 | **Agree: remove the nine ZIP-only keys and the DE-8b half of the header.** No reader is left. Optional, not required: add `not.toHaveProperty` for the removed keys to G-4 check 5, as C-11 did for `JSON_BODY_MAX_BYTES` |
| Q-4 | **Agree: leave `toCsv`.** It is three lines, it is tested (`csv.test.ts` l.12, l.31) and it sits in the BC-1 file. Add "`csv.ts` `toCsv` (no production caller since MX-3.1)" to MX-7's removal list, so it is recorded and not forgotten |
| Q-5 | **Keep the 1.15.0 Change History row.** Change History is a record (doc standard). The AC is met when the env-table row and the detail section are gone. The done-when grep in §6 / §16.3 step 5 then expects exactly that one history match, plus the new 1.17.0 row if it names the variable. Write it so the grep result is exact |
| Q-6 | **Agree: leave the inert mocks.** Only the asserting lines change (G-12, and G-12b from required change 1) |
| Q-7 | **No seeding of any kind into the shared database.** No rows, no request rows outside the two real drawer requests in (c)1, no scratch account. Ruled as follows. **(1) T-Q3** (two parts, repeated key, Gmail / Outlook RTL, Excel): use the no-database-write script from MX-3 QA pass 2 ("T-Q3: what TL / the user must do"). Conditions: it lives outside the repo, or in a `.tmp` file deleted after the run. The fixture is generated in memory. It calls only the pure part builders and `sendEmail`. It imports no repository, no `supabaseServer`, no audit service and no start function. The idempotency key uses a fresh random uuid that matches no request row. The only recipient is the owner's `+test` address. Dev confirms at implementation that the `sendEmail` path it uses makes no database call (`emailTransport.ts` has a lazy `supabaseServer` import near l.737; that branch must not be reached). Outlook needs P-1 (domain verified), so T-Q3 runs after P-1. It can run before merge and does not use the account's 2-per-24-h limit. The real worker with real data is covered by the small request in (c)1. **(2) The 100,000-row read time.** The proposal to read "the largest real account" is **rejected**: reading another tenant's rows for a timing run is not allowed, even read-only. Run it instead against the `+test` account or the user's own owner account only. Use the real `runExportSections` / `listOwnedRowsForExport` path (user_id-scoped), read-only, never the worker, with no send and no audit. Rows are discarded in memory, and only row counts and milliseconds are logged. Record ms per full 1,000-row page (p50 / p95 across all pages read, at least 10 reads per table, repeating the first page if a table is small), then extrapolate to 100 pages. Label the result **"estimate (extrapolated), not a 100,000-row measurement"**. Pass: the estimate is ≤ 60 s, which with T-Q1's 3 s build and 180 s worst-case send phase stays inside the 270 s budget. Over 60 s is a finding for TL, **not** a go-live blocker: the failure mode is retry and then the failed email, never a partial send (MX-3 K-1). See the business question below |
| Q-8 | **Yes**, as written in required change 4 |
| Q-9 | **Approved:** "Choose what to export. Each part arrives by email." English only, as the rest of those two pages. The user sees it in the diff |

### Split and effort

**One PR (D-1) is approved.** The work is mostly whole-file deletion. A split would keep the ZIP builder alive only to serve admin routes the user has already agreed to drop, and would mean two go-live reviews. Required changes 1 to 8 add about 0.1 d, which the 0.35 d verification block absorbs, so 🟡 2.5 d stands at the cap.

**Fallback trigger:** if T-0 to T-6 are not finished by the end of day 1.5, stop and split at the §14 boundary (MX-3.1a go-live; then MX-3.1b, opened immediately after, from `main`, not stacked). Record the split in this workplan and tell TL. Do not exceed 2.5 d in one PR.

### Business question (non-blocking, default given)

- **BQ-E6.1-3: a true 100,000-row read time needs a database that is not shared with production.** On 2026-10-29 the user moved "real-database read time for 100,000 rows" into (c). That figure cannot be measured without writing 100,000 rows. Local and production share one database, and no local Supabase stack exists. **Default (SA):** accept the per-page estimate ruled in Q-7(2) as the record. Optional alternative: a temporary Supabase branch or a separate project, seeded there and deleted afterwards. That costs money and about 0.5 d, outside this slice. The question does **not** block workplan approval or implementation. TL asks the user before the go-live check (c) runs.

### Optimisation suggestions (not blocking)

- `DataExportBlock`: keep `accountId` in `Props` (frozen mount), but do not destructure it into an unused binding. Read `props` or name it `_accountId`, with the one-line MX-5 comment.
- G-3: when it is re-pointed, its header comment should say "MX-3.1 (2026-10-30): re-pointed from the deleted ZIP routes to the module export request route and its worker cron". Use the same pattern for G-5, G-7 and G-10, so the history of each guard stays readable.
- §9 vercelCrons header: write "(23 after MX-3.1)" with no date-bound ordinal, as C-6 asks.

### Approval
[x] Workplan approved with changes. Proceed once required changes 1 to 4 are written into this workplan. Changes 5 to 8 are applied during implementation and checked at code review.

## SA Code Review — 2026-10-30

**Code Review by SA — 2026-10-30**
**Status:** APPROVED WITH CHANGES. The diff does what the workplan says and nothing else. Findings CR-1 and CR-2 are small fixes that Dev makes before RM commits. They need no second SA pass, and QA can start in parallel. CR-3 (V-5) is a copy decision for the user at the diff review and does not block.

### What SA re-checked on the worktree (not taken from Dev's notes)

| Check | Result |
|---|---|
| Required change 1 (G-12b) | ✅ `businessDrawer.pins.dangerReads.render.test.tsx`: the admin `GET …/data-exports` line is gone from `commonReads`, and the test names read nine and seven. Every list stays exact |
| Required change 2 (G-3) | ✅ `DATA_EXPORT_ROUTES` holds only the request route, and its `AUDIT_EVENTS.DATA_EXPORT_` non-vacuity is unchanged. The worker cron has its own case: `readsNoAuditRows`, and it imports `moduleExportWorker`. The module-wide non-vacuity expects `moduleExportWorker.ts` in place of `payload.ts`. The OP-3 negative control covers both files |
| Required change 3 (#569 facts) | ✅ HEAD is `a0804002`. `vercel.json` has 23 crons, and the one `data-export*` path left is `data-export-modules`. `bosCronJobs.test` and `vercelCrons.test` pin 23 and pass. `FEATURE_FLAGS.md` goes 1.16.1 → 1.17.0 |
| Required change 4 (G-4) | ✅ Check 4 is inverted: the seam does not name `/api/business-os/data-exports` and does name `/export-requests`. The outside-the-seam regex still refuses both routes. The planted `data-exports` controls are kept, including one planted in the seam itself. Check 6 (`existsSync` on the three retired directories) is added, with a non-vacuity on the request route. The three directories are really gone from disk, so no empty folders are left behind |
| C-5 census | ✅ Recounted from disk: HEAD had 91 `route.ts` files under `app/api/admin`, the tree has 89. Handlers go from 120 to 117, counting the three `HEAD` exports in `dashboard`, `token-usage` and `users`. A GET/POST/PUT/PATCH/DELETE-only count gives 117 → 114, which is why the doc's figure looks off at first glance. Six files have no `requireAdmin`; they are the six inline rows. The only change under `app/api/admin` is the deletion of the two route files and their tests, plus `adminGate.writes` (69 → 66, arithmetic comment correct). No surviving admin handler lost its gate. The doc strikes rows 115–117 following the rows 47–49 / 57–61 precedent |
| C-6 / C-7 | ✅ C-6 is stated in the workplan header. C-7 is applied in the plan §3 frozen-interface row. The requirement B.6 line is not edited |
| C-8 grep | ✅ `git grep` (tracked and untracked) over `app components lib hooks scripts tests .github __mocks__ middleware.ts jest.config* package.json` finds every deleted module name and every removed seam export only in history comments, one negative assertion (`DownloadMyDataButton.test.tsx:112`), the unrelated `downloadName` parameter in the storage repository, and the stale `index.ts` l.364 comment (on MX-7's list). No `import`, `jest.mock('…')`, `readFileSync` or `path.join` reaches a deleted path. The route-path grep finds only the inert drawer mocks (Q-6), G-4's planted and retired strings, the asserting `[]` in the layout test, DELETE-owned `types.ts` doc comments, and history comments |
| Switch grep (AC) | ✅ Exactly one line: `docs/FEATURE_FLAGS.md:17`, the 1.15.0 history row. There are also no hits in `hooks`, `scripts`, `tests`, `.github`, `__mocks__` or `next.config.js` |
| Frozen files | ✅ `git diff --stat` is empty for `BusinessOsDataExportJobRepository.ts`, `app/admin/users/types.ts`, `BusinessDetail.tsx`, `lib/audit/events.ts`, `eventAudience.ts`, plus `lib/repositories/index.ts`, the storage repository, `jobPolicy.ts`, `descriptors.ts` and `supabase/` |
| Jest | ✅ 105 suites / 3,176 tests (export components, request route, seam, `lib/business-os/data-export`, `app/admin/users`, every guard G-1…G-14 and the authz surface guard, `app/api/cron`, `lib/cron`, `lib/admin/environment`, `lib/utils`, purge and settings components): 3,175 pass. The one failure, `oneAddressPolicy.guard` (Windows absolute paths in its list), is in Dev's `main` baseline list and fails the same way on HEAD |
| Type check / build | ✅ Dev's `tsc-mx31.txt` has 105 errors and none in a line this diff wrote. The one in a touched file, `exportClassification.test.ts:2029`, is the same line as HEAD l.2030, so it was already there. `build-mx31.out` shows "Compiled successfully" |
| Lint (not a CI gate) | ⚠️ Two `no-unused-vars` warnings, both from this diff: CR-1 and V-6 |

### Behaviour with the switch gone (review point 3)

- **`app/api/business-os/export-requests/route.ts`**: In both handlers the first statement is now the correlation id, and `getUser()` is the first thing that decides: no session gives 401 before the body, throttle or database. Nothing fails open. The old 404 ran before auth, and its place is now taken by the auth gate, not by anything looser. Everything after the deleted lines is byte-identical to what ran when the switch was on. The `notFound` helper and the import are gone. G-13 pins "no `featureFlags`, no `notFound`, no `, 404)`" and the first statement of each handler.
- **`moduleExportWorker.ts`**: only a comment changed. The worker never read the flag. G-14 still refuses any `featureFlags` import.
- **Browser seam**: the history verdict is `ok` or `error`, and the start refusal no longer has `off`, so a 404 now reads as `failed`. `useExportDrawer` starts at `loading`, and the open effect reads the history. No caller of the removed `off`, `unknown`, `initialHistory` or `isInitiallyOpen` is left; `git grep` finds no reference outside tests.

### CLAUDE.md and security (review point 5)

Rules 1–6 hold. No new DB access, route or repository. The browser seam keeps Zod on every answer. No `any` is added. No model name. Pino only: the one `console` hit in a touched file is the word in a `dataExportCopy.ts` comment. No secret. No new service-role path. No entitlements import (G-16). No backslash+hex sequence in any added line, and none in this workplan. The admin box sends no request, so it has no authz surface.

### Code Review Comments

1. **CR-1** `components/business-os/data-export/__tests__/ModuleExport.render.test.tsx:15`: `waitFor` is imported but no longer used. This diff removed its two uses (the probe and the start waits). Dead import. **Priority: Low.** Fix: drop it from the import.
2. **CR-2** `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md:10`: the plan's top **Status** line still says E6.1 "waits for SA workplan review". The §4.6a row and the Change History are up to date, but the status line is the first thing a reader sees. **Priority: Low.** Fix: say "SA-approved with changes, code complete, in SA code review / QA, uncommitted", in line with the §4.6a row.
3. **CR-3 (= V-5)** `app/admin/users/components/DrawerBox.tsx:55`: the box's purpose line, "This account's exports; admin downloads are recorded with your name and reason.", now sits directly above the new placeholder, "Admin export is coming back as 'Send export to owner'." The two lines contradict each other on the same screen. **Priority: Medium. Not blocking**, because it is approved copy and needs the user (see the V-5 ruling).

### Rulings on V-1 … V-6

| # | Ruling |
|---|---|
| V-1 | **Accepted.** Every case in `lib/client/__tests__/businessOsDataExport.test.ts` (checked on HEAD: `startDataExport`, `downloadDataExportAgain`, `fetchLastDataExport`, `saveSignedDownload`, the signed-URL log check) tests the deleted ZIP half. It is deleted with its subject (XC-16, nothing loosened). The `moduleExport` seam test now expects `error` / `failed` where it expected `off` / `unknown`. That is D-3 / D-4 exactly, and its other cases are unchanged |
| V-2 | **Accepted.** No test names the variable, so the AC grep stays exact. The suite running with it unset, together with the G-13 source rule (no `featureFlags`, no `notFound`, no `, 404)`, first statement = correlation id), is stronger proof than a test that sets and unsets an env var nobody reads |
| V-3 | **Accepted.** `/export/i` still refuses any export button the screen draws itself, since the control is mocked as a `div`. Querying "Export data" would match the new heading |
| V-4 | **Accepted.** `(?![\w-])` is equivalent to a word-boundary escape for these paths, and it avoids a backslash+hex sequence in a scanned file |
| V-5 | **Recommendation below.** It is not this slice's copy to change on its own authority |
| V-6 | **Accepted, with a note.** `_props: Props` keeps the frozen mount compiling with no destructured binding. It still trips `@typescript-eslint/no-unused-vars` (warn; this repo's config has no `argsIgnorePattern`). Lint is not a CI gate, so it does not block. If Dev wants it warning-free, the cleanest form is a typed const, `export const DataExportBlock: React.FC<Props> = () => (…)`. The export name stays the same and `BusinessDetail.tsx` still compiles. Optional |

### V-5 recommendation (DrawerBox purpose line)

- **This needs the user's copy approval.** The line is user-approved wording, and DB-5 in `drawerBox.render.test.tsx:123` pins it word for word. It is owned by the admin layout standard, not by EXPORT. `DrawerBox.tsx` and that test also sit on DELETE's `/admin/users` screen, so a CC-3 claim is posted before either is edited.
- **Do not use Dev's line**, "Owners export their own data; admin export returns soon." It repeats the placeholder directly below it, and it goes stale again at MX-5 ("returns soon").
- **SA's proposal:** "Exports of this account's data, sent to the owner by email." (10 words, within the DB-3 12-word rule.) It is true today, because owner exports arrive by email. It stays true after MX-5, because "Send export to owner" also emails the owner. So it needs no second edit, and the placeholder line alone carries the "until MX-5" message.
- **Route:** TL puts both lines to the user at the diff review. If the user approves one, Dev changes `DrawerBox.tsx:55` and `drawerBox.render.test.tsx:123` in this PR (two lines, after the claim), with no new SA pass. If the user declines or defers, ship as is and put the line on MX-5's list. The stale line is misleading but harmless: no control on the page acts on it.

### Optimisation Suggestions (not blocking)

- `app/business-os/settings/__tests__/accountCard.guard.test.ts:66`: a `for` over a one-element array. A plain `const control = …` reads better. Style only.
- `app/admin/users/__tests__/dataExportBlock.render.test.tsx:19–22`: `global.fetch` is replaced and never restored. It is harmless, because jsdom is per file, but an `afterEach` restore matches the other drawer tests.

### Conditions carried forward (unchanged)

- C-6: no auto-merge before P-1 to P-3 are recorded here and in the coordination file and the user has seen the diff.
- RM recounts `vercel.json` / `BOS_CRON_JOBS` against fresh `main` just before enqueue (C-6). If another admin route lands first, RM recounts `adminGate.writes` too.
- The interface notice to DELETE goes out before the PR opens (§18), and it names `exportDrawerCopy.entryLabel` (C-7).

### Code Approved for QA: Yes
With CR-1 and CR-2 fixed before RM commits. CR-3 is decided by the user at the diff review.

---

## QA Testing Report

## QA Report — 2026-10-30

**QA — 2026-10-30**
**Test mode:** full (pre-deploy part; the go-live checks of §17 are after deploy)
**Strategy used:** A + B (Jest: unit, route integration with mocked repositories, source guards), static greps over the worktree, Dev's build route table. No live run: the DB is the shared production DB, so no export request was made (instruction)
**Focus:** api, ui, security (switch and route removal), regression
**Skipped:** D (browser) and every §17 live check: they need the deploy and the `+test` account. No re-build (Dev's `build-mx31.out` used; jest and build not run together)
**Input source:** TL prompt + workplan §16 + requirement §7 AC MX-3.1
**Worktree:** `neuronforge-mx31`, branch `feature/bos-export-mx3-1-remove-switch-and-zip`, uncommitted. CR-1 / CR-2 ignored as instructed

### Acceptance criteria (requirement §7, MX-3.1)

| # | Criterion | Result | Evidence (re-run by QA, not taken from Dev's notes) |
|---|---|---|---|
| 1 | No `isModuleExportEnabled` / `BUSINESS_OS_MODULE_EXPORT_ENABLED` in `app/`, `components/`, `lib/`, `docs/FEATURE_FLAGS.md`, the catalogue; Vercel var removed after deploy | PASS (code); post-deploy part OPEN | `grep -rn` over `app components lib hooks docs/FEATURE_FLAGS.md` returns exactly one line, `docs/FEATURE_FLAGS.md:17` (the 1.15.0 history row, Q-5). `lib/admin/environment` is inside `lib/`, so the catalogue has no entry. The Vercel removal is go-live step (a), not done yet |
| 2 | Signed in, the request route answers POST and GET with no switch; still refuses auth failure and invalid input; no "off" path in route or browser | PASS | `route.ts` diff: import, `notFound` and both first-statement 404s removed; the first statement of each handler is the correlation id, and `getUser()` decides first. `route.test.ts`: POST 401 (nothing else runs), 9 x 400 cases (blank, bad JSON, `{}`, empty, duplicate, unknown module, switched-off module, `userId` key, non-array), 201 happy path; GET 401, 200 happy path, 500, 429. Source rule: no `featureFlags`, `notFound` or `, 404)`. Jest loads no `.env` (`jest.config.js` setupFiles is the plugins setup only), so the whole suite runs with the variable unset. Seam: `businessOsDataExport.moduleExport.test.ts` maps every 404 to `error` (history) and `failed` (start); no `off` / `unknown` left |
| 3 | Four entry points and DELETE's drawer show "Export data" and open the drawer; no click builds a ZIP; `DownloadMyDataButton` name, path, props unchanged | PASS (Jest + source); live click-through OPEN | `DownloadMyDataButton.tsx` renders only `ModuleExportEntry`; props `{ variant: 'row' or 'button'; className? }` and both exports unchanged, pinned by a source test. Mounted by settings `page.tsx` (row), `DangerZonePanel`, `SecurityTab`, `SecurityTabV2`, `PlanCancelDrawer` (button). `DownloadMyDataButton.test.tsx`: label, click opens the drawer and reads history once, loading state, Escape returns focus, Hebrew label, no ZIP control / probe / flag in source. No code anywhere imports a ZIP function (grep of `startDataExport`, `fetchLastDataExport`, `downloadDataExportAgain`, `DATA_EXPORTS_URL`, `saveSignedDownload` outside tests: 0). The real-browser check is go-live step (c) |
| 4 | Owner and admin ZIP routes and `/api/cron/data-export` gone; cron entry gone from `vercel.json`, worker stays; no ZIP builder; ZIP guards deleted, not loosened | PASS | The three directories do not exist on disk. `build-mx31.out` route table: only `/api/business-os/export-requests` and `/api/cron/data-export-modules` match `data-export`; no owner, admin or sweep route. `vercel.json`: 23 crons, only `/api/cron/data-export-modules` left. `lib/business-os/data-export/` has no zip / readme / manifest / sweep / payload / fileName / ceiling / downloadName / adminExportAudit file. No import or `jest.mock` of any deleted module in `app components lib hooks scripts tests middleware.ts`. Guards G-1..G-14 pass, and G-4 now checks that the three directories do not exist |
| 5 | `findDeletionFacts` and its file unchanged; old table, start function, bucket, `DATA_EXPORT_*` constants still there | PASS | `git diff --stat` is empty for `BusinessOsDataExportJobRepository.ts`, the storage repository, `jobPolicy.ts`, `descriptors.ts`, `lib/audit/events.ts`, `eventAudience.ts`, `BusinessDetail.tsx` and `supabase/`. No migration in the diff. `findDeletionFacts` is at l.276 |
| 6 | Bucket emptied after deploy (object count before and after); one live export on `+test` with request ids | NOT TESTED (post-deploy) | Go-live steps (b) and (c). Needs the deploy, and the DB is shared production |
| 7 | MX-1b deferred live checks (four entries, Danger Zone pointer press, keyboard, screen reader, Hebrew RTL, Gmail date line, history visuals, Pino and audit row) | NOT TESTED (post-deploy) | Moved into go-live step (c), together with MX-3b's T-Q3 |
| 8 | `/admin/users` shows the agreed admin-export state; `BusinessDetail.tsx` not edited | PASS | `DataExportBlock` renders `DrawerBox` (test ids `drawer-box-export` and `drawer-section-export` kept) with one line: "Admin export is coming back as 'Send export to owner'." No fetch and no button (`dataExportBlock.render.test.tsx`). `BusinessDetail.tsx` still mounts `<DataExportBlock key={user.id} accountId={user.id} />`, and its diff is empty |

### TL checklist

| # | Check | Result |
|---|---|---|
| 1 | Acceptance criteria | 1–5 and 8 PASS in code; the post-deploy parts of 1 and 3, and all of 6 and 7, are OPEN (go-live gate) |
| 2 | Request-route failure paths | Covered: happy path (POST 201, GET 200), 401 on both handlers, 400 for nine kinds of bad body, no switch (source rule plus the variable unset in Jest). **No gap, no test added.** A test that sets the variable would break the exact AC grep (V-2), and it would prove less than the source rule |
| 3 | Deleted routes | Not in the route table; the directories are gone; no caller. Greps for `/api/business-os/data-exports`, `/api/admin/users/…data-exports` and `/api/cron/data-export"` in `app components lib hooks` find only G-4's planted and retired strings, the inert `…/data-exports` fetch mocks in 7 admin drawer tests (Q-6), the asserting `[]` in `businessDrawer.layout` l.835, `source.guard` l.633 `not.toMatch`, DELETE-owned `types.ts` doc comments, and history comments (`ownerEventPresentation.ts`, `ownerVisibility.ts`, the frozen job repository l.241). None of them calls a route |
| 4 | UI | Both security tabs: heading "Export data", sub-line "Choose what to export. Each part arrives by email." (diff, and `agentPlatformEntryPoints.render.test.tsx` l.44–45). No ZIP control is mounted anywhere. The admin box shows the placeholder line (finding 3 covers the box's purpose line) |
| 5 | Tests | See outputs below. No new failure caused by this diff |
| 6 | Logging | No `console.*` call in any modified `.ts` / `.tsx` file. The 3 grep hits are two test titles in `source.guard.test.ts` and the word "console" in the `dataExportCopy.ts` header |

### Findings

1. **Go-live gate still open (expected, blocks only the C-6 auto-merge).** AC 6 and 7, the Vercel part of AC 1 and the live click-through of AC 3 need the deploy: (a) remove the variable from Production and Preview, (b) empty the bucket and record the object count before and after, (c) one live `+test` export with request ids, the MX-1b deferred checks and T-Q3. QA records them after deploy.
2. **New failure in the full run is a timing flake, not ours (Edge Case, Low).** `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`, "non-admin with parameters and hung reads: 403 immediately", asserts that the response arrives in under 1,000 ms and took 1,366 ms under full-suite load. It passed 3 of 3 times when run alone (11/11 each time). It does not import any file in the diff. This is the same kind of flake as Dev's `upgradeModal.um2`, which passed in this run.
3. **The admin box shows two lines that contradict each other (CR-3 / V-5, Medium, not blocking).** The `DrawerBox` purpose line, "This account's exports; admin downloads are recorded with your name and reason.", still renders above the new placeholder. The block's own content is only the placeholder, which matches the AC. The purpose line is the user's copy decision at the diff review, as SA ruled.
4. **Some owner-facing copy still says "Download my data" after this merge (Edge Case, Low, DELETE-owned).** `settings.account_delete.warning` in `lib/business-os/translations/en.ts` l.4498 (and in `he.ts` / `es.ts`), with the fallback in `DangerZonePanel.tsx` l.73, tells the owner to "download your data from Settings → Download my data". After the merge that entry reads "Export data". Requirement §11 S-4 gives this fix to DELETE ("when MX-3.1 merges"). Put it in the coordination-file notice that goes out before the PR. It shows only where self-delete is on.
5. **Some comments are stale but not wrong in behaviour (Edge Case, Low, not in diff).** `DangerZonePanel.tsx` l.140–141 ("the same zip, copy, status line and notice") and the comment at `app/business-os/settings/page.tsx` l.1183 ("Download my data … owns its request, status line and notice") still describe the ZIP control. D-12 deliberately leaves these files alone. Consider them for MX-4 or MX-7.
6. **No test was added and nothing in the diff was changed by QA.**

### Test Outputs / Logs

| Run | Result |
|---|---|
| Touched suites + guards (`components/business-os/data-export`, `export-requests`, `lib/client/__tests__`, `lib/business-os/data-export`, `app/admin/users`, `adminGate.writes`, callers guard, `ownerAuditReads`, `accountCard`, `clientPaymentsUsd`, `app/api/cron`, `lib/cron`, `pluginConnectionsBrowserAccess`, `lib/admin/environment`, `lib/utils/__tests__`, `components/settings`, `components/v2/settings`) | 94 suites, 2,949 tests: 2,948 passed, 1 failed. The failure is `oneAddressPolicy.guard`, which is in the baseline |
| `npm run test:authz-guard` | 2 suites, 203 / 203 passed |
| `npm run test:bos-entitlements` (G-16) | 330 suites, 9,833 / 9,833 passed |
| `npm run lint:hooks` | exit 0 |
| Full `npm test` (`--json`, compared with Dev's `baseline-fails.txt` from `a0804002`) | 1,898 suites (1,864 passed, 26 failed), 48,196 tests (47,984 passed, 147 failed, 65 skipped). Compared with the baseline: **0 baseline failures fixed or changed; 1 new failing test**, the timing flake in finding 2, which passed 3 of 3 times alone. `upgradeModal.um2.qa.render` passed in this run |
| Build | Not re-run. Dev's `build-mx31.out`: "Compiled successfully". The route table has no deleted route |

### Final Status
- [x] Every acceptance criterion that can be tested before deploy passes, and there is no open Bug. **Verdict: PASS WITH NOTES.** Ready for the user's diff review and commit after CR-1 / CR-2. Merge waits on the C-6 go-live gate (finding 1)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/bos-export-mx3-1-remove-switch-and-zip` |
| Base | `main` `a0804002` |
| Feature commit | `6cbd72e7` feat(business-os): retire the ZIP export and the module-export switch (MX-3.1) |
| Sync with main | `e0d67b3a` merge of `origin/main` `1fafd0e7` (#570), no conflicts |
| Recount after sync | `vercel.json` 23 crons, `BOS_CRON_JOBS` 23, `bosCronJobs.test` / `vercelCrons.test` literals 23, `adminGate.writes` 66: unchanged, all green |
| PR | opened by RM; NOT on auto-merge (C-6: held until P-1..P-3 are recorded) |
| Merge commit | pending |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created (EXPORT Dev, E6.1) | Workplan for MX-3.1 on `feature/bos-export-mx3-1-remove-switch-and-zip` (off `main` `117979c6`). Plan §4.6a quoted verbatim. Delete / keep list with importers on `main`: `payload.ts`, `fileName.ts`, `ceiling.ts` and `BusinessDataExportFilesRepository.ts` deleted (no non-ZIP importer); `limits.ts` kept (worker, sections, repository). 16 guards listed (G-1…G-16), each deleted with its subject or re-pointed. Cron literal = fresh main's count minus 1 (TL, C-6, #569). Admin box keeps its mount and shows the placeholder line. Go-live gate with Resend checks, (a)–(c), MX-1b deferred checks and T-Q3. 🟡 2.5 d, one PR, fallback split described. Open questions Q-1…Q-9; no new business question |
| 2026-10-30 | SA workplan review: APPROVED WITH CHANGES | 8 required changes: G-12b (dangerReads READS-1..3 pin the admin data-exports GET), G-3 (payload.ts non-vacuity; cron route has no audit write), #569 merged so literal 23 and FEATURE_FLAGS 1.16.1 → 1.17.0, G-4 inverted non-vacuity, admin access census re-count, no auto-merge before P-1..P-3, plan §3 label row, path-string grep plus main baseline. Q-1..Q-9 ruled (Q-7: no seeding; read time only on `+test` / own account, labelled estimate). One PR, with a fallback trigger at day 1.5. Non-blocking BQ-E6.1-3 (true 100k read needs a non-shared DB; default: accept estimate) |
| 2026-10-30 | Implemented (EXPORT Dev, E6.1) | Branch fast-forwarded to `a0804002`. 45 files deleted (ZIP routes, sweep cron, ZIP lib, files repository, ZIP UI, switch hook and tests, the seam's ZIP tests), switch removed, owner entry always opens the drawer (history starts at `loading`), admin box placeholder, guards G-1…G-14 and G-12b edited, cron 24 → 23, FEATURE_FLAGS 1.17.0, admin access census 117 = 111 + 6 + 0 / 89 files. Verification against a `main` baseline: no new failure of ours (one load-timing flake re-run green 3 of 3), scoped tsc clean on touched lines, build exit 0. Deviations V-1…V-6 for SA |
| 2026-10-30 | SA code review: APPROVED WITH CHANGES | Re-checked on the worktree: required changes 1–4 and C-5–C-8 met. Census 120 → 117 handlers (incl. 3 `HEAD`), 91 → 89 files, no gate lost. Switch grep exact (1 history row). Frozen files empty. Cron 23/23. Path-string grep clean. 105 suites / 3,176 tests with only the baseline `oneAddressPolicy` failure. CR-1 unused `waitFor` import, CR-2 stale plan Status line (fix before commit). CR-3 = V-5 DrawerBox purpose line: user copy decision, SA proposes "Exports of this account's data, sent to the owner by email." V-1–V-4 and V-6 accepted |
| 2026-10-30 | QA: PASS WITH NOTES | AC 1–5 and 8 pass in code and Jest; AC 6–7 and the Vercel / live parts wait for deploy. The route covers happy, 401, 400 and no-switch paths, so no test was added. Full `npm test` compared with the baseline: 0 changed; 1 new timing flake (`qa-slice5-pr2`, 3/3 green alone). authz-guard, entitlements and lint:hooks green. Notes: CR-3 purpose line; DELETE's `account_delete.warning` still says "Download my data" (S-4); stale ZIP comments in `DangerZonePanel` / settings `page.tsx` |
| 2026-10-30 | CR-3 resolved | User approved SA's admin purpose line 'Exports of this account's data, sent to the owner by email.' (DrawerBox.tsx + drawerBox.render pin; CC-3 claim cleared by DELETE) |
