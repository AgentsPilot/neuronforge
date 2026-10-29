# Workplan: Business OS Export MX-3 (E6) — Cron worker and email splitting

> **Last Updated**: 2026-10-28

**Developer:** Dev (EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §3, §4.3, §4.4, §7 (AC MX-3), §8 X-1…X-8, §9 (BQ-28, BQ-42, BQ-43 answered 2026-10-28), §10 XC-8, XC-9, XC-13, §11 S-9, S-10, S-11
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §4.6 (quoted in §2), §4.6a R-6
**Earlier slices this builds on:** [MX-1a](/docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md) (tables, claim / reap RPCs, migration `20261095`), [MX-1b](/docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md) (request route, "requested" email), [MX-2b](/docs/workplans/BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md) (`columnLabels.ts`, labels required)
**Branch:** MX-3a on `feature/bos-export-mx3a-transport-parts` (worktree `neuronforge-mx3`, off `main` `415f726e`, which holds MX-2b #558; renamed by RM from `feature/bos-export-mx3-worker`). MX-3b gets its own branch from `main` after MX-3a merges (proposed `feature/bos-export-mx3b-worker`, SA split ruling: sequential, not stacked). Not `main`.
**Date:** 2026-10-28
**Status:** MX-3a Code Complete (waits for SA code review); MX-3b Planning

---

## Overview

MX-3 builds the first export worker. A cron route runs every 5 minutes. It reaps stale module jobs first, then claims module jobs one at a time on the MX-1a claim RPC. For each job it reads the module's sections through the existing classified section readers (`runExportSections`, paged by `listOwnedRowsForExport`, `ROW_CEILING` per module), builds the module's joined CSV with the MX-2 builder and the MX-2b labels, cuts the lines into parts of at most 7 MB at row boundaries (header and BOM in each part), fixes `parts_total` before the first send, and sends the parts one after another to the owner's login email, each with the Resend idempotency key `export:{module_job_id}:{n}`. Each part is marked `sending` before the call and `accepted` with the Resend id after it. A job that fails before any part reached `sending` is retried; after that, it ends `interrupted`. Failed, interrupted and too-large jobs get exactly one notice email, keyed `export-notice:{job_id}`. The worker writes `DATA_EXPORT_MODULE_SENT` and `DATA_EXPORT_MODULE_FAILED`, whose constants, definitions and audience entries land here (SA-P5, binding).

MX-3 also adds the shared `idempotencyKey` option to `emailTransport.ts` (S-10, EXPORT owns it; DELETE's DL-3 and D4b reuse it) and fixes F-7 (the transport logs attachment filenames at `info`). There is **no migration**: the MX-1a schema already holds every column the worker writes. The export switch stays off in every environment, so after merge the production worker has nothing to claim until MX-3.1 removes the switch (R-6). MX-3 adds no reader of the switch.

**Effort:** the full scope measures about 3 days, over the 2.5-day cap. §11 proposes a split into **MX-3a** (transport, constants, part cutter, email templates, repository writes; no cron) and **MX-3b** (worker, route, cron entry, audit, guards, QA measurement). SA to rule.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Approved scope (plan §4.6, verbatim)](#2-approved-scope-plan-46-verbatim)
3. [Decisions](#3-decisions)
4. [State machine of a module job and of each part](#4-state-machine-of-a-module-job-and-of-each-part)
5. [The run](#5-the-run)
6. [The transport change (S-10 and F-7)](#6-the-transport-change-s-10-and-f-7)
7. [Repository writes](#7-repository-writes)
8. [Emails](#8-emails)
9. [Audit, cron registry and coordination](#9-audit-cron-registry-and-coordination)
10. [Files to create / modify](#10-files-to-create--modify)
11. [Effort and proposed split](#11-effort-and-proposed-split)
12. [Task list](#12-task-list)
13. [Test plan](#13-test-plan)
14. [Carry-overs: where each one is met](#14-carry-overs-where-each-one-is-met)
15. [Risks](#15-risks)
16. [Open questions for SA](#16-open-questions-for-sa)
17. [Business questions](#17-business-questions)
18. [Implementation Notes (MX-3a)](#implementation-notes-mx-3a) · [SA Review Notes](#sa-review-notes)
19. [QA Testing Report](#qa-testing-report)
20. [Commit Info](#commit-info)
21. [Change History](#change-history)

---

## 1. Analysis summary

| Area | What is on `main` today (checked in this worktree) | What MX-3 does with it |
|---|---|---|
| Queue table | `business_os_export_module_jobs` (migration `20261095`): `status` waiting / working / sent / failed / interrupted; `parts_total`; `parts` jsonb array of `{n, state, resend_id, at}`; `row_count`; `failure_code`; `notice_state` none / due / sent / given_up, `notice_attempts`, `notice_sent_at`, `notice_resend_id`; claim columns `claimed_by`, `claimed_at`, `attempts`, `next_attempt_at`, `last_error_code`; `started_at`, `sent_at`, `finished_at` | Writes them through new compare-and-set methods (§7). No column added |
| Row CHECKs the writes must satisfy | `waiting` ⇒ `parts = []` and `parts_total` NULL (D-10); `sent` ⇔ `sent_at`, and every part accepted with `jsonb_array_length(parts) = parts_total`; `failed` / `interrupted` ⇔ `failure_code`, `interrupted` ⇒ `failure_code = 'interrupted'` and at least one part; `failed` / `interrupted` ⇔ `notice_state <> 'none'`; terminal ⇔ `finished_at`; `sent` and `waiting` ⇒ no claim; codes match `^[a-z][a-z0-9_]{1,39}$` | Each write in §7 is shaped to pass them in one update |
| Claim RPC | `business_os_export_module_jobs_claim_due(p_runner, p_batch)`: waiting jobs past backoff become `working` (attempts + 1), and `notice_state = 'due'` rows under 5 notice attempts whose claim is free or older than 420 s get claimed (notice_attempts + 1). Batch clamp 1..10. `SECURITY INVOKER`, service_role only | Reused unchanged through `claimDue` |
| Reap RPC | `…_reap()`: stale `working` (claim older than 420 s) → `sent` if all parts accepted; `interrupted` (notice due) if any part; `failed` `attempts_exhausted` (notice due) after 3 attempts; else back to `waiting` with backoff 60 s × attempts. A notice claimed 5 times → `given_up` | Reused unchanged through `reapStale`, first in every run |
| Repository | `BusinessOsExportModuleJobRepository`: `listForRequestsOfUser`, `claimDue`, `reapStale`. Not in the barrel; callers pinned by `exportRequestRepositories.callers.guard.test.ts` | Adds the worker writes (§7); `ReapedModuleJob` gains `rowCount`, `partsTotal`, `partsAccepted`, `requestId` (additive) for the reaped-job audit |
| Policy mirror | `moduleExportPolicy.ts`: `LEASE_SECONDS 420`, `WORKER_MAX_DURATION_SECONDS 300`, `WORKER_BUDGET_SECONDS 270`, `BUILD_MAX_ATTEMPTS 3`, `NOTICE_MAX_ATTEMPTS 5`, `CLAIM_BATCH_MAX 10`. Its keys are pinned against SQL literals by the 20261095 migration test | Read, not edited. MX-3's own constants go in a new file (D-3) so the mirror test is untouched |
| Section readers | `sections.ts`: `EXPORT_SECTIONS`, `runExportSections(ctx, sections, logger, { rowCeiling })` (reads in order, stops the moment the total passes the ceiling, a failed reader is `status: 'failed'`). Service role, `server-only` | Called with the module's sections (from `EXPORT_SECTIONS`, filtered by the module map: switches only remove) and, separately, with `lookupSectionsFor(moduleId)` |
| Builder | `buildJoinedCsv({ moduleId, language, rowsBySection, lookupRowsBySection, labels })` → `{ header, lines, rowCountBySection }`; labels required (MX-2b) | Called with `EXPORT_COLUMN_LABELS` from `columnLabels.ts` |
| CSV framing | `csv.ts`: `CSV_BOM`, `CSV_EOL`, `csvPartText(header, lines)` | One part = `csvPartText(header, linesOfPart)` |
| Transport | `emailTransport.ts` `sendEmail`: Resend first, then SMTP, then Gmail on any Resend error; no idempotency key; a Resend 429 is a thrown generic error and the status and `retry-after` are lost; filenames logged at `info` in four places (F-7) | §6 |
| Owner facts | `authAccountRepository.findUserIdentity(id)` (login email, `created_at`; null only on a definite 404); `userPreferencesRepository.findPreferredLanguage`; `ownerClock(userId, log)` (timezone, `isSet`) | Read per request (D-6) |
| Request row | `BusinessOsExportRequestRepository.findByIdForUser(requestId, userId)` → `requested_at`, `origin` | Read with the claimed row's `user_id` |
| Cron conventions | `withCronRunRecord(id, runJob)`, fail-closed `CRON_SECRET`, `logAndFlush` for audit (WC-7). `lib/cron/bosCronJobs.ts` registry pinned to `vercel.json` byte for byte (`bosCronJobs.test.ts` count 22, `vercelCrons.test.ts` ordered list) | New route + one registry entry + one `vercel.json` entry, at EXPORT's anchor |
| Audit | `events.ts` / `eventAudience.ts` hold six `DATA_EXPORT_*` constants; `dataExportSeverity.guard.test.ts` says "exactly six". Owner visibility is by `entity_type` (`ownerVisibility.ts`), and MX-1b's `DATA_EXPORT_REQUESTED` uses `entity_type 'user'` | Two new constants at the EXPORT anchor; the guard grows to eight. `entity_type 'user'`, so no owner-policy migration |
| History status lists (E-1) | DB CHECK, `MODULE_JOB_STATUSES` (`moduleExportPolicy.ts`), `ExportHistoryStatus` (`exportHistory.ts`), `HISTORY_STATUSES` (`lib/client/businessOsDataExport.ts`): all five words, same order | MX-3 adds no status. A new pin test keeps the four in step (T-E1) |
| Migrations | `origin/main` (`abe9fd64`, fetched 2026-10-28) ends at `20261098`; `20261099` is reserved by DELETE D4b | **None needed.** Nothing reserved |

**Phase note (rule 8 does not apply):** no file under `lib/agentkit/v6/`, `lib/pilot/` or the plugin system is touched.

**Skills followed:** `durable-queue-drain` (reap first, claim, guardrails at the point of effect, terminal status as the dedupe marker plus a provider idempotency key for the external send, cron wired last, fail-closed auth), `tenant-isolation-guard` step 6 (every effect scoped to the claimed row's `user_id`; no caller-supplied id: the route takes no input), `new-api-route` (cron variant: no user input, so no Zod body; Pino child logger with `correlationId`; error format; bounded audit flush), `business-os-schema-check` (every column named here was checked against `20261095_business_os_export_requests.sql`). `business-os-entitlements`: not applicable, nothing imports `lib/business-os/entitlements/` (XC-19). `bos-llm-call-standards`: no LLM.

---

## 2. Approved scope (plan §4.6, verbatim)

> | Field | Value |
> |---|---|
> | Goal | Cron-only claim-pattern worker every 5 min (XC-8): `maxDuration = 300`, lease 420 s, 270 s internal budget checked before each part, reaper first; reads the module's sections through `listOwnedRowsForExport` paging (`ROW_CEILING` per module); MX-2 builder; cut parts by byte budget at row boundaries, header + BOM per part, `parts_total` fixed before the first send; each part marked `sending` then `accepted` with the Resend id; idempotency key `export:{module_job_id}:{n}`; retry only while no part reached `sending`, else `interrupted`; failed / interrupted / too-large emails; sequential sends ≥ 600 ms apart, `retry-after` on 429 inside the budget; `DATA_EXPORT_MODULE_SENT` / `DATA_EXPORT_MODULE_FAILED` writes |
> | Touches | New `app/api/cron/<export-worker>/route.ts` + tests; worker module in `lib/business-os/data-export/`; module-job repository claim/complete methods (`⟨unscoped-by-design⟩`); `lib/notifications/emailTransport.ts` (additive optional `idempotencyKey` on `SendEmailParams`, Resend only, **plus the F-7 fix**: stop logging the attachment filename at `info`); `vercel.json` (worker entry directly after `/api/cron/data-export`); `lib/audit/events.ts` / `eventAudience.ts` constants if writes start here (EXPORT anchors; definitions can wait for MX-4, open item SA-P5) |
> | Lock / migration | No / none. **S-10 claim:** check the coordination file; if DELETE's DL-3 already built the idempotency key, reuse it and do not build a second; otherwise claim it before starting |
> | Switches | Worker runs regardless of `isModuleExportEnabled()` (XC-15); with the switch off there are no jobs to claim. **Unchanged by the 2026-10-27 decision (SA ruling R-6):** MX-3 still merges while the switch exists and is off in every environment, so the worker is deployed but has nothing to claim, and MX-3 does **not** need to land together with MX-3.1. MX-3 adds no new reader of the switch; MX-3.1 starts on the `main` that holds MX-3 and is the go-live. **SA-P5 is now binding:** the `DATA_EXPORT_MODULE_SENT` / `_FAILED` constants, definitions and `eventAudience` entries land in MX-3 with the first write, because live writes begin at MX-3.1, before MX-4 |
> | Effort | 🟡 2.5 d |
> | Business questions | **BQ-42** (7 MB vs 10 MB), **BQ-43** (interrupted → "export again" email), BQ-28 (max 10 emails per module) before the workplan ✅ all three answered 2026-10-28 (user): "BQ-28: max 10 emails per module. BQ-42: 7 MB per email. BQ-43: one 'interrupted, please export again' email." |
> | Done when | AC MX-3; QA's local measurement of a 100,000-row module inside 270 s recorded (local only: preview and prod share one DB); **C-10 / MX-1b K-4 gate:** before merge, QA confirms that `business_os_export_requests` holds no row from MX-1b or MX-3 testing, or that each such row is gone through the test-account cleanup. MX-1b's QA recorded none, so this is a confirmation, not a cleanup |
> | Open | What a job does if its module was switched off between request and claim (SA-P4) |
>
> **Coordination checklist (MX-3):** CC-1; S-10 claim/announce (`[EXPORT→DELETE] MX-3 idempotencyKey claim taken` or "reusing DL-3's"); CC-6 for `vercel.json`, `events.ts`, `eventAudience.ts`; note in the log that the worker's 5-min schedule also runs at :50, beside DELETE's lifecycle job, on one shared Resend team limit (2/s).

**Acceptance criteria (requirement §7, MX-3), verbatim:**

- [ ] Each module arrives in its own email with the CSV attached, module name, requested-at and produced-at in the owner's timezone.
- [ ] A module larger than the byte budget arrives as several emails marked "1 of X" … "X of X", each under the budget, each with the header row and BOM.
- [ ] One module forced to fail sends the failed email; the others arrive.
- [ ] A worker killed before any part reached `sending` is retried; a worker killed after a part reached `sending` ends the module as `interrupted` with one email, and no part is ever sent twice.
- [ ] Over 10 emails the module fails with the "too large" email.
- [ ] A module at the 100,000-row ceiling finishes inside the 270 s budget locally (QA measurement, local only).
- [ ] (2026-10-27) Before merge, no export request row from testing is left in the shared database (C-10); the `DATA_EXPORT_MODULE_SENT` / `_FAILED` definitions and audience entries ship with the first write.

**User answers that fix the constants (2026-10-28):** "BQ-28: max 10 emails per module. BQ-42: 7 MB per email. BQ-43: one 'interrupted, please export again' email."

**S-10 status:** DELETE confirmed on 2026-10-28 that DL-3 is not built. EXPORT took the claim the same day (coordination log). DELETE's D4b will pass the key later, and DELETE does not edit `emailTransport.ts`.

---

## 3. Decisions

| # | Decision | Why | Approved by |
|---|---|---|---|
| D-1 | **Route `/api/cron/data-export-modules`, registry id `data-export-modules`.** Schedule `*/5 * * * *`. `export const runtime = 'nodejs'`, `export const maxDuration = 300` | `bosCronJobs.test.ts` requires `path === /api/cron/{id}`. The name sits beside its neighbour `/api/cron/data-export`, which MX-3.1 deletes. `*/5` never fires at :53 (DELETE D4b's reminder slot) | SA |
| D-2 | **One job per claim** (`claimDue(runnerId, 1)` in a loop), not a batch | One job at the 100,000-row ceiling fills most of the budget (MX-1a §3.4 expected this). A batched claim would hold jobs a run cannot reach; they would sit `working` until the reaper and then cost a retry attempt | SA |
| D-3 | **MX-3's own constants live in a new pure file `moduleExportSending.ts`**, not in `moduleExportPolicy.ts` | The migration test pins every key of `MODULE_EXPORT_POLICY` to a SQL literal (one site per constant). None of MX-3's numbers is in SQL | SA |
| D-4 | **Byte budget `PART_BYTES_MAX = 7_000_000`** (decimal MB), counted in UTF-8 bytes of the whole part: BOM (3) + header + 2 + each line + 2 | BQ-42: "7 MB per email". Decimal is the conservative reading: 7,000,000 bytes is 9,333,336 after base64, inside a 10 MB limit whichever way a mail server counts a megabyte. Each line is sized with `Buffer.byteLength(line, 'utf8') + 2` (carry-over) | User (BQ-42), SA for the reading |
| D-5 | **`MAX_PARTS_PER_MODULE = 10`.** The parts are cut in full **before** `parts_total` is written; more than 10 parts, or one line that alone cannot fit in a part with its header, ends the job `failed` with `too_large` and no part sent | BQ-28. `parts_total` is fixed before the first send (XC-9), so "1 of X" is always true | User (BQ-28) |
| D-6 | **Owner facts are resolved once per request per run** and cached by `request_id`: language (`findPreferredLanguage`, `'en'` + warn `language_unreadable`, the MX-1b route pattern), clock (`ownerClock`), login email (`findUserIdentity`), `requested_at` and `origin` (`findByIdForUser`). Every read passes the claimed row's `user_id` | MX-2b SA note MX2B-11: two modules of one request must not differ in language. Storing the language on the job row would need a migration, which this slice does not have. Residual: modules of one request handled in **different** runs could differ if the owner changes language between those runs (minutes apart). §16 Q-2 asks SA to accept this or to rule a column later |
| D-7 | **SA-P4 proposal: a module that is switched off (or unknown) at claim time fails closed.** The worker checks `isModuleEnabled(job.module)` before any read or `buildJoinedCsv` (carry-over). If false: `failed`, code `module_switched_off` (or `module_unknown` for an id not in the map), the generic failed email, no rows read | A switch-off is the emergency stop for a module (switches only remove; for example a privacy fault found in a section). Sending it anyway would defeat the stop. The plan's earlier proposal ("still runs") honours the "requested" email's promise, but the failed email keeps the owner told. The drawer no longer offers the module, so "please try again" leads nowhere. §16 Q-1 asks SA to choose, and whether the failed copy should say "not available right now" instead | SA (SA-P4) |
| D-8 | **Retry only while no part reached `sending`** (XC-9). Before the first `markPartSending`, any failure (a section read failed, the owner identity unreadable, the budget spent before part 1, a send refused before part 1 was marked) releases the job to `waiting` with backoff, or ends it `failed` `attempts_exhausted` when `attempts ≥ BUILD_MAX_ATTEMPTS`. After the first `markPartSending`, any failure the run cannot finish ends it `interrupted` | The DB already enforces half of this: `waiting` requires `parts = []` (D-10 of MX-1a), so a buggy release after a part was marked is refused by the row CHECK |
| D-9 | **Inside one run, a part that is `sending` may be re-sent with the same idempotency key and the same bytes** after a timeout, a 5xx, a 429 (after `retry-after`) or a 409 `concurrent_idempotent_requests`, up to `PART_SEND_TRIES = 3` and only inside the budget | This is not a rebuild: the bytes are the ones already cut, so the boundaries cannot shift (the reason XC-9 forbids a retry across runs). Resend answers a repeated key with the first send's result, so a send that timed out but was accepted is not delivered twice (K-7). Across runs, a `sending` part is never re-sent: the reaper makes it `interrupted`. §16 Q-3 asks SA to confirm |
| D-10 | **Budget.** `WORKER_BUDGET_SECONDS = 270` (policy) is checked before each part. A new **build** claim is taken only while elapsed < `BUILD_CLAIM_CUTOFF_SECONDS = 90`; a new **notice** claim only while elapsed < `NOTICE_CLAIM_CUTOFF_SECONDS = 250`. Budget spent before part 1 → release for retry (`budget_spent`). Budget spent after a part was marked → `interrupted` now, with the notice due and the claim cleared, so the next run (or this one) sends the notice instead of waiting 420 s for the reaper | A job claimed late in a run is the likeliest to be cut in half. With 180 s or more left for a fresh job, a ceiling-size module fits (F-9: build 3.6 s for 100,000 rows; the DB read time is the measured unknown, QA T-Q1). Ending it `interrupted` at once is what the reaper would do anyway, minus the wait |
| D-11 | **Sends are sequential, at least `SEND_GAP_MS = 600` apart across the whole run** (parts and notices), through one pacer. On a 429, wait `retry-after` (seconds, default 1 when absent, capped at the remaining budget); if the wait does not fit, the budget rule of D-10 applies | XC-8: Resend's default team limit is 2 per second, shared with every platform email, including DELETE's lifecycle job at :50 and D4b's 05:53 reminder |
| D-12 | **Send timeout `PART_SEND_TIMEOUT_MS = 45_000`** for a part (up to about 9.4 MB of base64 upload), `NOTICE_SEND_TIMEOUT_MS = 10_000` for a notice (the MX-1b value). The worker races the send against a timer, as the MX-1b route does; a timeout is "unknown, maybe accepted" and is retried under D-9 with the same key | The transport has no timeout of its own. A hung upload would otherwise eat the whole budget. §16 Q-4 offers the alternative of an additive `timeoutMs` on the transport (cancels the request instead of abandoning it) |
| D-13 | **Notices are their own claimable effect** (MX-1a D-11). When the worker ends a job `failed` / `interrupted`, the same update sets `notice_state = 'due'` and **clears the claim** (carry-over MX-1a code review 3), so this run or the next can claim the notice at once. The notice is sent with key `export-notice:{job_id}` (MX-1a SA MX1A-5). Success → `notice_state = 'sent'`, `notice_sent_at`, `notice_resend_id`, claim cleared. A refusal that retrying cannot change (`.invalid` recipient, no login email) → `given_up` at once. Any other failure → claim cleared, retried next run until the reaper gives up after 5 claims | One notice per job, at least once, never twice inside Resend's key window |
| D-14 | **No retry of the "Export requested" email** (MX1B-6, SA's leaning). `requested_email_sent_at` is not read by the worker | The module emails themselves confirm the export. A retry would be a second queue, and MX-1b's sends carried no key, so a keyed retry could not dedupe against them (K-7) |
| D-15 | **A failed own section fails the read** (released for retry, code `section_read_failed`); **a failed or over-ceiling lookup section keeps the ids** (warn `lookup_unreadable`). Lookup rows are read with their own `ROW_CEILING` and do not count toward the module's ceiling | A partial module would look complete to the owner; FR-E12 never writes a silent hole. Lookups only turn ids into labels (XC-10), and the id is the documented fallback |
| D-16 | **Over the row ceiling** (`runExportSections` returns `overCeiling`) ends the job `failed` with `over_ceiling` and the **too-large** email ("This part is too large to email. Please contact support") | Retrying cannot help, and support is the right next step. §16 Q-5 |
| D-17 | **A keyed send never falls back to SMTP or Gmail after a Resend attempt** (§6) | SMTP and Gmail cannot honour the key. A Resend timeout followed by an SMTP send is exactly the duplicate the key exists to prevent |
| D-18 | **Audit on every terminal transition the worker sees**, written with `logAndFlush` (bounded, never rejects) after each job ends, plus one flush for the reaped rows: `DATA_EXPORT_MODULE_SENT` for `sent`, `DATA_EXPORT_MODULE_FAILED` for `failed` and `interrupted`. `entity_type 'user'`, `entity_id` and `user_id` = the owner. `details`: `request_id`, `job_id`, `module`, `origin`, `rows`, `parts` (parts_total, or 0), `parts_accepted`, `failure_code` (FAILED only), `interrupted` (boolean, FAILED only). Never an address, a file name or content (XC-13) | XC-13 lists exactly these. `entity_type 'user'` is already owner-visible, so no RLS policy change. A run killed between a transition and its flush loses that audit row: accepted, as for every non-blocking audit |
| D-19 | **The worker runs regardless of `isModuleExportEnabled()`** and never imports `featureFlags.ts` (R-6). A guard test pins this (T-W17) | With the switch off, the route refuses new requests, so nothing is queued |
| D-20 | **The part file name is `{module_id}_{YYYY-MM-DD}_part-{n}-of-{X}.csv`**, the ASCII module id and the business date of the produced-at time in the owner's timezone (UTC when not set) | Requirement §4.3. The id is ASCII, carries no user data and needs no RFC 5987 encoding. The localised module name is in the subject and body |
| D-21 | **The recipient is read at send time**, once per request per run (D-6), from `findUserIdentity(job.user_id)`; never from the request row | Requirement §4.3 "To". A locked (banned) account still gets its export (stage D, admin-started). A tombstone (`.invalid`) is refused by the transport and ends the job `failed` `recipient_unavailable`, notice `given_up` |

---

## 4. State machine of a module job and of each part

### 4.1 Module job

| From | Event | To | Written in the same update | Who |
|---|---|---|---|---|
| `waiting` | claimed (backoff passed) | `working` | `claimed_by`, `claimed_at`, `attempts + 1`, `started_at` (first time) | claim RPC |
| `working` | parts cut, fits (≤ 10 parts) | `working` | `parts_total = X`, `row_count`, `parts` still `[]` | worker `setPartsTotal` |
| `working` | part n about to be sent | `working` | `parts` gains `{n, state:'sending', resend_id:null, at}` | worker `markPartSending` |
| `working` | part n accepted, n < X | `working` | that part becomes `{n, state:'accepted', resend_id, at}` | worker `markPartAccepted` |
| `working` | part X accepted | `sent` | last part accepted, `sent_at`, `finished_at`, claim cleared | worker `markSent` |
| `working` | transient failure, no part marked, attempts < 3 | `waiting` | `parts_total` NULL, `parts []`, `last_error_code`, `next_attempt_at = now + 60 s × attempts`, claim cleared | worker `releaseForRetry` |
| `working` | transient failure, no part marked, attempts ≥ 3 | `failed` | `failure_code 'attempts_exhausted'`, `notice_state 'due'`, `finished_at`, claim cleared | worker `markFailed` |
| `working` | too large / over ceiling / switched off / unknown module / recipient unavailable | `failed` | `failure_code` (`too_large`, `over_ceiling`, `module_switched_off`, `module_unknown`, `recipient_unavailable`), `notice_state 'due'` (or `'given_up'` for `recipient_unavailable`), `finished_at`, claim cleared | worker `markFailed` |
| `working` | any failure after a part was marked (budget, send refused, tries spent) | `interrupted` | `failure_code 'interrupted'`, `notice_state 'due'`, `finished_at`, claim cleared | worker `markInterrupted` |
| `working` | claim older than 420 s (worker died) | `sent` / `interrupted` / `failed` / `waiting` | as the reap RPC decides (§1) | reaper |
| `failed` / `interrupted` | notice claimed | same | `claimed_by`, `claimed_at`, `notice_attempts + 1` | claim RPC |
| `failed` / `interrupted` | notice accepted | same | `notice_state 'sent'`, `notice_sent_at`, `notice_resend_id`, claim cleared | worker `markNoticeSent` |
| `failed` / `interrupted` | notice failed (retryable) | same | claim cleared | worker `releaseNotice` |
| `failed` / `interrupted` | notice refused for good | same | `notice_state 'given_up'`, claim cleared | worker `markNoticeGivenUp` |
| `failed` / `interrupted` | notice claimed 5 times | same | `notice_state 'given_up'` | reaper |

`sent`, and `failed` / `interrupted` with the notice `sent` or `given_up`, are final: no claim selects them again.

### 4.2 One part

| State | Meaning | Next |
|---|---|---|
| (absent) | Cut but not yet handed to Resend | `sending` |
| `sending` | Written to the row **before** the HTTP call. From here the job can never be retried (XC-9, D-8) | `accepted` (same run, possibly after in-run re-sends with the same key, D-9); otherwise the job ends `interrupted` (this run or the reaper) |
| `accepted` | Resend answered 200 with an id; `resend_id` stored | final |

Every part entry is written with all four keys (`n`, `state`, `resend_id`, `at`) and an integer `n` from 1 (carry-over: MX-1a QA edge case 1). The `n` values are 1..k with no gap or duplicate; the worker checks `parts.length === n - 1` before marking part n.

---

## 5. The run

**File:** `lib/business-os/data-export/moduleExportWorker.ts` (pseudocode; all I/O through injected deps so the run is unit-testable; the clock and `sleep` are injected).

```text
runModuleExportWorker(deps, log):
  start = deps.now(); runnerId = deps.uuid(); counts = {}
  reaped = deps.jobs.reapStale()                       # reaper FIRST
  audit(reaped terminal rows)                          # D-18, one bounded flush
  facts = new Map<requestId, OwnerFacts>()             # D-6
  pacer = new SendPacer(SEND_GAP_MS, deps.now, deps.sleep)
  loop:
    elapsed = deps.now() - start
    if elapsed >= NOTICE_CLAIM_CUTOFF: stop
    claimed = deps.jobs.claimDue(runnerId, 1)
    if claimed is error or empty: stop
    job = claimed[0]
    if job.status == 'working':
      if elapsed >= BUILD_CLAIM_CUTOFF: releaseForRetry(job, 'budget_spent', no attempt refund); stop builds
      else runBuild(job)
    else: runNotice(job)                               # failed / interrupted with notice due
  return counts

runBuild(job):
  if not isModuleEnabled(job.module): markFailed(module_switched_off | module_unknown); return
  owner = facts.get(job.request_id) or resolve(job.request_id, job.user_id)
  if owner unreadable: retryOrFail(job, 'owner_unreadable'); return
  if owner.email missing or .invalid: markFailed(recipient_unavailable, notice given_up); return
  ctx = { userId: job.user_id, authUser: owner.identity }
  own = runExportSections(ctx, sectionsOf(job.module), log, { rowCeiling: ROW_CEILING })
  if own.overCeiling: markFailed(over_ceiling); return
  if any own section failed: retryOrFail(job, 'section_read_failed'); return
  lookups = runExportSections(ctx, lookupSectionsFor(job.module), log, { rowCeiling: ROW_CEILING })  # D-15
  csv = buildJoinedCsv({ moduleId, language: owner.language, rowsBySection, lookupRowsBySection, labels: EXPORT_COLUMN_LABELS })
  producedAt = deps.now()
  cut = cutCsvParts(csv.header, csv.lines, PART_BYTES_MAX)    # ranges only, no copies
  if cut.tooLarge or cut.parts.length > MAX_PARTS_PER_MODULE: markFailed(too_large); return
  setPartsTotal(job, cut.parts.length, rowCount)
  for n in 1..X:
    if deps.now() - start >= WORKER_BUDGET: end(job, n, 'budget_spent'); return   # D-10
    bytes = utf8(csvPartText(csv.header, lines of part n))            # built per part, dropped after
    email = buildModulePartEmail({ language, module, n, X, requestedAt, producedAt, clock })
    markPartSending(job, n)
    result = sendPartWithTries(email, bytes, key = 'export:' + job.id + ':' + n)   # D-9, D-11, D-12
    if result.accepted: (n < X ? markPartAccepted : markSent)(job, n, result.resendId)
    else: markInterrupted(job); return
  audit SENT

end(job, n, code): n == 1 and no part marked ? retryOrFail(job, code) : markInterrupted(job)
retryOrFail(job, code): job.attempts >= BUILD_MAX_ATTEMPTS ? markFailed('attempts_exhausted') : releaseForRetry(job, code)
```

**Memory (XC-8):** the CSV stays an array of lines (`buildJoinedCsv` already returns that). `cutCsvParts` returns index ranges and byte totals only. Each part's string and `Buffer` exist only for its own send and are dropped before the next. Peak is roughly the rows read, the lines and one part (F-9: 100,000 rows ≈ 62 MB of CSV), well under 1 GB.

**Every write after the claim** carries `.eq('id', job.id).eq('user_id', job.user_id).eq('claimed_by', runnerId)` plus the expected status or notice state (tenant-isolation-guard step 6; §7). A write that changes 0 rows means the claim was lost (lease expired and reaped): the worker logs `claim_lost` at `error`, sends nothing more for that job and moves on.

**Logging:** one `createLogger({ module: 'ModuleExportWorker' })` child per run with `correlationId` and `runnerId`. Lines carry job ids, request ids, module ids, counts, byte totals, durations and codes. Never an address, subject, file name or cell value. The run log ends with the counts the cron record keeps (§9.2).

---

## 6. The transport change (S-10 and F-7)

**File:** `lib/notifications/emailTransport.ts` (0 `console.*` calls today). All changes are additive; no existing caller changes, and with no key set every path behaves exactly as today (pinned by T-T1).

| # | Change | Detail |
|---|---|---|
| T-1 | `SendEmailBase.idempotencyKey?: string` | Doc-comment: honoured by Resend only (`Idempotency-Key` request header); Resend accepts 1 to 256 characters and answers a repeated key with the first send's result for its key window (24 h per Resend's documentation; to be confirmed in QA, §16 Q-6). Callers build a stable key from a durable id (`export:{job}:{n}`, `export-notice:{job}`; DELETE's DL-3 / D4b will use their own prefix). A key outside 1..256 characters is refused before any transport (`sent: false`, `error: 'invalid_idempotency_key'`), never silently dropped |
| T-2 | **No fallback after Resend for a keyed send** (D-17) | When `idempotencyKey` is set and Resend is configured, a Resend failure returns at once with `provider: 'resend'`, `sent: false`; SMTP and Gmail are not tried. When Resend is **not** configured (local dev), the keyed send goes to SMTP / Gmail as today and logs `idempotency_unsupported` at `warn` once per send. §16 Q-7 asks SA whether dev should refuse instead |
| T-3 | `SendEmailResult.providerStatus?: number`, `SendEmailResult.retryAfterSeconds?: number` (additive, optional) | Set from Resend's HTTP status and its `retry-after` header (whole seconds; absent or unparseable → undefined). Needed for XC-8 (429) and to tell 409 `concurrent_idempotent_requests` (retry later) from 409 `invalid_idempotent_request` (the key was used with other bytes: treated by the worker as already sent for a notice, and as `interrupted` for a part). `providerErrorCode?: string` carries Resend's `name` field from the error body, codes only |
| T-4 | `sendViaResend` throws an internal `ResendSendError` carrying `status`, `retryAfterSeconds` and `name` | The thrown message keeps today's text, so un-keyed callers and their logs are unchanged |
| T-5 | **F-7:** the four `info` lines that log `filename` (`Preparing attachment for Resend`, the SMTP and Gmail "Preparing attachments" lines, and `attachmentDetails` on "Attempting to send email") log `attachmentCount`, `contentType` and `size` only. No filename anywhere in the transport's logs | Requirement §12 privacy; the SA Split Review's suggestion that whoever builds S-10 also fixes F-7. Every caller gains this, which is the intent |
| T-6 | The key itself is logged (`idempotencyKey` on the attempt line) | It holds only ids, which is what an operator needs to match a Resend event to a job |

Because the key is optional and Resend-only, **DL-3 and D4b reuse it by passing the field**; no signature changes. Its contract is pinned by T-T1…T-T9 so a later caller cannot loosen it without a red test.

---

## 7. Repository writes

**File:** `lib/repositories/BusinessOsExportModuleJobRepository.ts` (0 `console.*`). All new methods are `⟨unscoped-by-design⟩` in the claim sense (the worker acts across accounts), **and** each one also filters on the claimed row's `user_id` (tenant-isolation-guard step 6). Each is a compare-and-set: `.update(patch, { count: 'exact' })` with `.eq('id', jobId).eq('user_id', userId).eq('claimed_by', runnerId).eq(<expected status or notice_state>)`, and **no** `.select()` (the PostgREST update + `.or()` + `.select()` 42703 hazard). Success is `count === 1`; `count === 0` is `{ data: { updated: false } }` (claim lost); an error is `{ error }`. Inputs are Zod-checked (uuids, `n` an integer 1..10, codes against `CODE_SHAPE`, `resend_id` 1..128 characters). Never throws.

| Method | Expected state | Patch |
|---|---|---|
| `setPartsTotal(jobId, userId, runnerId, { partsTotal, rowCount })` | `status 'working'`, `parts_total IS NULL` | `parts_total`, `row_count` |
| `markPartSending(jobId, userId, runnerId, parts)` | `status 'working'` | `parts` = the full new array (all four keys per part). Only the claim holder writes `parts`, so the claim CAS is the lock; the worker builds the array from its own in-memory copy |
| `markPartAccepted(jobId, userId, runnerId, parts)` | `status 'working'` | `parts` |
| `markSent(jobId, userId, runnerId, parts)` | `status 'working'` | `parts` (all accepted), `status 'sent'`, `sent_at`, `finished_at`, `claimed_by` / `claimed_at` NULL |
| `releaseForRetry(jobId, userId, runnerId, { errorCode, nextAttemptAt })` | `status 'working'` | `status 'waiting'`, `parts []`, `parts_total` NULL, `last_error_code`, `next_attempt_at`, claim NULL. The row CHECK refuses it if a part exists |
| `markFailed(jobId, userId, runnerId, { failureCode, noticeState: 'due' \| 'given_up' })` | `status 'working'` | `status 'failed'`, `failure_code`, `notice_state`, `finished_at`, claim NULL |
| `markInterrupted(jobId, userId, runnerId, parts)` | `status 'working'` | `parts` (as they stand), `status 'interrupted'`, `failure_code 'interrupted'`, `notice_state 'due'`, `finished_at`, claim NULL |
| `markNoticeSent(jobId, userId, runnerId, resendId)` | `notice_state 'due'` | `notice_state 'sent'`, `notice_sent_at`, `notice_resend_id`, claim NULL |
| `releaseNotice(jobId, userId, runnerId)` | `notice_state 'due'` | claim NULL |
| `markNoticeGivenUp(jobId, userId, runnerId)` | `notice_state 'due'` | `notice_state 'given_up'`, claim NULL |

`reapStale` gains `requestId`, `module`, `rowCount`, `partsTotal`, `partsAccepted` in each `ReapedModuleJob` (additive; read from the rows it already returns) so the worker can audit reaped terminals. The "Stale module export jobs reaped" log line is unchanged.

**Callers guard:** `exportRequestRepositories.callers.guard.test.ts` adds the worker deps file and its test to the class rule of both repositories (the request repository for `findByIdForUser`). The worker module itself imports no repository (deps are injected), so it is not on the list.

---

## 8. Emails

**File:** `lib/business-os/data-export/moduleExportEmails.ts` (new, pure, no I/O), the MX-1b `exportRequestedEmail.ts` shape: `en` / `he` / `es` copy tables (Spanish a draft for native review), HTML-escaped interpolation, `dir="rtl"` for Hebrew, the date and time isolated in right-to-left text (`<bdi>` in HTML, the FSI / PDI isolate characters in text, as MX-1b's SA CR-4), the date and time through `formatRequestedAt` (MX-1b), "(UTC)" when no timezone is set. No business name, owner name, row count or file name in the body (requirement §12). The support address is `PLACEHOLDER_ERASURE_CONTACT`, the same one the "requested" email uses (§16 Q-9 notes it reads `support@agentspilot.ai` while BQ-E6.1-2 named `notifications@agentspilot.ai`). `kind: 'transactional'`, `from: platformSenderAddress()`.

### 8.1 Part email (one per part, CSV attached)

| | en | he | es (draft) |
|---|---|---|---|
| Subject | `Your data export: {module} (email {n} of {X})` | `ייצוא הנתונים שלך: {module} (מייל {n} מתוך {X})` | `Tu exportación de datos: {module} (correo {n} de {X})` |
| Body 1 | `Attached is {module} from your AgentPilot data, email {n} of {X}.` | `מצורף {module} מנתוני ה-AgentPilot שלך, מייל {n} מתוך {X}.` | `Adjuntamos {module} de tus datos de AgentPilot, correo {n} de {X}.` |
| Body 2 | `Requested on {requestedDate} at {requestedTime}. Produced on {producedDate} at {producedTime}.` | `התבקש בתאריך {requestedDate} בשעה {requestedTime}. הופק בתאריך {producedDate} בשעה {producedTime}.` | `Solicitado el {requestedDate} a las {requestedTime}. Generado el {producedDate} a las {producedTime}.` |
| Body 3 (only when X > 1) | `This part comes in {X} emails. Each file has the column headings, so each opens on its own.` | `החלק הזה נשלח ב-{X} מיילים. בכל קובץ יש את כותרות העמודות, כך שאפשר לפתוח כל אחד בנפרד.` | `Esta parte llega en {X} correos. Cada archivo tiene los encabezados, así que cada uno se abre por separado.` |
| Body 4 | `Files (client documents, website pictures) are not included.` | `קבצים (מסמכי לקוחות, תמונות האתר) אינם כלולים.` | `Los archivos (documentos de clientes, imágenes del sitio web) no se incluyen.` |
| Body 5 | `If you did not ask for this, contact us at {support}.` | (MX-1b `notYou`) | (MX-1b `notYou`) |
| Attachment | `{module_id}_{YYYY-MM-DD}_part-{n}-of-{X}.csv`, `text/csv; charset=utf-8` | same | same |

### 8.2 Notice emails (no attachment; key `export-notice:{job_id}`)

| Notice | Chosen by `failure_code` | en subject | en body (he / es follow the same lines) |
|---|---|---|---|
| Failed | `attempts_exhausted`, `module_switched_off`, `module_unknown`, any other | `Your data export: {module} failed` | `This part of your export failed. Please try again.` + requested-at line |
| Interrupted | `interrupted` | `Your data export: {module} was interrupted` | `This part was interrupted. Please export it again.` + `Some emails of this part may already have arrived; the new export replaces them.` + requested-at line |
| Too large | `too_large`, `over_ceiling` | `Your data export: {module} is too large to email` | `This part is too large to email. Please contact support at {support}.` + requested-at line |

Hebrew: Failed `החלק הזה של הייצוא נכשל. אפשר לנסות שוב.`; Interrupted `החלק הזה נקטע. יש לייצא אותו שוב.` + `ייתכן שחלק מהמיילים של החלק הזה כבר הגיעו; הייצוא החדש מחליף אותם.`; Too large `החלק הזה גדול מדי לשליחה במייל. אפשר לפנות לתמיכה בכתובת {support}.` Spanish: Failed `Esta parte de tu exportación ha fallado. Inténtalo de nuevo.`; Interrupted `Esta parte se ha interrumpido. Vuelve a exportarla.` + `Puede que ya hayan llegado algunos correos de esta parte; la nueva exportación los sustituye.`; Too large `Esta parte es demasiado grande para enviarla por correo. Escribe a soporte en {support}.`

The notice body uses only stored facts (module, `requested_at`) plus the language and clock, so a re-sent notice has the same bytes unless the owner changed language or timezone in between (§6 T-3 handles that answer).

A copy-parity test (T-M1) checks the three languages have the same keys and placeholders, and that no copy string holds a backslash.

---

## 9. Audit, cron registry and coordination

### 9.1 Audit (SA-P5, binding)

**Files:** `lib/audit/events.ts`, `lib/audit/eventAudience.ts` (0 `console.*` each). One contiguous block **directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN`** in `AUDIT_EVENTS`, in `EVENT_METADATA`, and in `AUDIT_EVENT_AUDIENCE` (EXPORT's SR-10 anchor; DELETE's D4a adds its pair after `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`, a different place).

| Constant | Severity | Compliance | Audience | Description |
|---|---|---|---|---|
| `DATA_EXPORT_MODULE_SENT` | `info` | `GDPR`, `SOC2` | `shared` | `One module of a data export was emailed to the owner in full (every part accepted by the mail provider)` |
| `DATA_EXPORT_MODULE_FAILED` | `warning` | `GDPR` | `shared` | `One module of a data export failed, was too large, or was interrupted while sending; the owner was sent a notice` |

`dataExportSeverity.guard.test.ts` grows from six to eight `DATA_EXPORT_*` events with these rows. MX-4 adds only the owner presentation.

### 9.2 Cron entry and registry

| File | Change | Anchor |
|---|---|---|
| `vercel.json` | `{ "path": "/api/cron/data-export-modules", "schedule": "*/5 * * * *" }` | Directly after `/api/cron/data-export` (B.7). D4b appends its 05:53 entry elsewhere |
| `lib/cron/bosCronJobs.ts` (0 `console.*`) | `'data-export-modules'` in `BosCronJobId` after `'data-export'`; one entry after the `data-export` entry: `EVERY_5`, `timeLimitSeconds: 300` with `timeLimitSource: 'maxDuration'`, `drainsQueue: null` (no admin queue view in this slice; §16 Q-8), label `Data export worker`, counts `reaped`, `claimed`, `modulesSent`, `partsSent`, `modulesFailed`, `modulesInterrupted`, `retried`, `noticesSent`, `noticesFailed`, `budgetStops` (keys under the 1,024-byte record cap) | After `data-export` |
| `lib/cron/__tests__/bosCronJobs.test.ts` | count 22 → 23, comment line for the 23rd | — |
| `lib/cron/__tests__/vercelCrons.test.ts` | one row after the `data-export` row | — |

**Merge note:** DELETE's D4b also adds one cron (registry, `vercel.json`, both tests). Whoever lands second rebases and keeps both entries; the count becomes 24.

### 9.3 Coordination (CC-1, CC-5, CC-6, S-10)

| Step | Done / to do |
|---|---|
| CC-1 | Coordination file read 2026-10-28 (S-10 claim taken by EXPORT; D4a / D4b anchors; `20261099` reserved by D4b) |
| S-10 | Claim taken 2026-10-28 (log line 203). At PR open: `[EXPORT→DELETE] MX-3 idempotencyKey built — optional, Resend-only, no fallback after Resend for keyed sends, providerStatus / retryAfterSeconds on the result` |
| CC-6 | Claims for `vercel.json`, `bosCronJobs.ts` (+ its two tests), `events.ts`, `eventAudience.ts`, `emailTransport.ts` posted after SA approval, before code |
| Shared Resend limit | Log note at PR open: the worker runs every 5 minutes including :50, beside DELETE's lifecycle job, and near D4b's 05:53 reminder, on one Resend team limit (2 per second). The worker spaces its own sends 600 ms apart and honours `retry-after`; D4b should do the same |
| CC-5 | Workplan approved, PR opened, merged |

---

## 10. Files to create / modify

| File | Action | Reason | Slice (§11) |
|---|---|---|---|
| `lib/notifications/emailTransport.ts` | modify | S-10 key, no fallback for keyed sends, status / `retry-after` on the result, F-7 | 3a |
| `lib/notifications/__tests__/emailTransport.idempotency.test.ts` | create | T-T1…T-T9 | 3a |
| `lib/business-os/data-export/moduleExportSending.ts` | create | Constants (D-3…D-12) and the two key builders | 3a |
| `lib/business-os/data-export/csvParts.ts` | create | Pure part cutter (ranges, byte totals, `tooLarge`) | 3a |
| `lib/business-os/data-export/moduleExportEmails.ts` | create | Part and three notice templates, file name | 3a |
| `lib/business-os/data-export/__tests__/csvParts.test.ts`, `moduleExportEmails.test.ts`, `moduleExportSending.test.ts` | create | T-P, T-M, T-S | 3a |
| `lib/repositories/BusinessOsExportModuleJobRepository.ts` | modify | §7 writes; `ReapedModuleJob` additive fields | 3a |
| `lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts` | modify | T-R1…T-R12 | 3a |
| `lib/business-os/data-export/moduleExportWorker.ts` | create | The run (§5), deps injected | 3b |
| `lib/business-os/data-export/moduleExportWorkerDeps.ts` | create | `server-only` wiring of repositories, readers, transport, clock | 3b |
| `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts` | create | T-W1…T-W20 | 3b |
| `app/api/cron/data-export-modules/route.ts` | create | Cron route, `maxDuration = 300`, fail-closed auth, `withCronRunRecord` | 3b |
| `app/api/cron/data-export-modules/__tests__/route.test.ts` | create | T-C1…T-C6 | 3b |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify | §9.1 | 3b |
| `lib/audit/__tests__/dataExportSeverity.guard.test.ts` | modify | six → eight | 3b |
| `vercel.json`, `lib/cron/bosCronJobs.ts`, `lib/cron/__tests__/bosCronJobs.test.ts`, `lib/cron/__tests__/vercelCrons.test.ts` | modify | §9.2 | 3b |
| `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` | modify | Worker deps file + test allowed | 3b |
| `lib/business-os/data-export/__tests__/historyStatuses.pin.test.ts` | create | E-1 pin (T-E1) | 3b |
| `.claude/skills/durable-queue-drain/SKILL.md` | modify | The two-model note MX-1a's SA asked for when MX-3 lands (a reaper that judges a build by its parts; a notice branch with the lease in the claim predicate) | 3b |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` | modify (done) | BQ-28 / 42 / 43 ticked, §4.3 rows, X-2, X-6, Change History | workplan |
| `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` | modify (done) | §4.6 and §6 answered, workplan link, Change History | workplan |

**Not touched:** `moduleExportPolicy.ts` and its migration test; any migration; `lib/utils/featureFlags.ts`; `lib/client/businessOsDataExport.ts`; `exportHistory.ts`; `BusinessOsDataExportJobRepository.ts` (frozen); every file in plan §7. `limits.ts` gains a non-ZIP importer here (`ROW_CEILING`, `PAGE_SIZE`), which MX-3.1 must count when it decides which ZIP-era files to delete.

**`console.*` check (CLAUDE.md § Logging):** every file to be modified was counted on 2026-10-28: `emailTransport.ts` 0, `events.ts` 0, `eventAudience.ts` 0, `bosCronJobs.ts` 0, `BusinessOsExportModuleJobRepository.ts` 0, `BusinessOsExportRequestRepository.ts` 0, `AuthAccountRepository.ts` 0, `sections.ts` 0, `csv.ts` 0, `exportRequestedEmail.ts` 0, and the four tests 0. Nothing to flag. New files use Pino only.

---

## 11. Effort and proposed split

| Block | Estimate |
|---|---|
| Transport S-10 + F-7 + tests | 0.4 d |
| Constants, part cutter, email templates (3 languages) + tests | 0.6 d |
| Repository writes (10 CAS methods) + tests | 0.4 d |
| Worker run (build, notices, pacer, tries, budget) + tests | 0.9 d |
| Route, cron registry, `vercel.json`, audit constants, guards, skill note | 0.4 d |
| QA support: local 100,000-row fixture run, C-10 confirmation | 0.3 d |
| **Total** | **≈ 3.0 d**, over the 2.5 d cap |

**Proposal: two numbered slices, each its own PR from `main`, not stacked** (user preference: small numbered slices).

| Slice | Contents | Ships to production | Effort |
|---|---|---|---|
| **MX-3a (E6a)** | Transport S-10 + F-7; `moduleExportSending.ts`; `csvParts.ts`; `moduleExportEmails.ts`; the §7 repository writes. All unit-tested. No caller of the new writes yet, no cron | The F-7 log fix and the optional key (no caller passes it yet). Nothing else changes behaviour | 🟢 1.4 d |
| **MX-3b (E6b)** | Worker + deps, cron route, `vercel.json` + registry, audit constants / definitions / audience (SA-P5: with the first write), callers guard, E-1 pin, skill note, QA measurement, C-10 gate | The worker, with nothing to claim while the switch is off (R-6) | 🟡 1.6 d |

MX-3a lets DELETE's D4b use the key earlier. If SA prefers one PR, the 3.0 d estimate stands and the cap is exceeded by about half a day.

---

## 12. Task list

**MX-3a**
- [ ] 1. Post CC-6 claims (`emailTransport.ts`) after SA approval. **Not done by Dev:** the coordination log is TL's to post (SA C-7: before the MX-3a code, and the S-10 "built" announcement at the MX-3a PR). Flagged to TL in the hand-over.
- ✅ 2. Transport: T-1…T-6 (§6) plus `timeoutMs` (SA C-8) and the production refusal (SA Q-7); tests T-T1…T-T9 and the timeout cases.
- ✅ 3. `moduleExportSending.ts` with `PART_BYTES_MAX`, `MAX_PARTS_PER_MODULE`, `SEND_GAP_MS`, `PART_SEND_TRIES`, `PART_SEND_TIMEOUT_MS`, `NOTICE_SEND_TIMEOUT_MS`, `BUILD_CLAIM_CUTOFF_SECONDS`, `partIdempotencyKey(jobId, n)`, `noticeIdempotencyKey(jobId)`, plus the frozen send payloads, `classifyKeyedSend` and `ownerFactsKey` (see Implementation Notes); T-S1…T-S4. `NOTICE_CLAIM_CUTOFF_SECONDS` deliberately not defined (C-1, MX-3b).
- ✅ 4. `csvParts.ts`; T-P1…T-P9.
- ✅ 5. `moduleExportEmails.ts` with the "not available" variant (SA Q-1); T-M1…T-M8.
- ✅ 6. Repository writes with `updated_at` (SA C-2); T-R1…T-R12.
- ✅ 7. Typecheck the touched files, `npm test` for the touched suites; hand to SA code review.

**MX-3b**
- [ ] 8. Post CC-6 claims (`vercel.json`, `bosCronJobs.ts`, `events.ts`, `eventAudience.ts`).
- [ ] 9. Audit constants, definitions, audience; severity guard 6 → 8.
- [ ] 10. `moduleExportWorker.ts` + deps; T-W1…T-W20.
- [ ] 11. Route; T-C1…T-C6.
- [ ] 12. Registry + `vercel.json` + both cron tests (cron wired **last**, skill step 8).
- [ ] 13. Callers guard; E-1 pin T-E1; skill two-model note.
- [ ] 14. Typecheck and tests for the touched files; `npm run build` before hand-over (ship drill step 1).
- [ ] 15. QA: T-Q1 (local 100,000 rows inside 270 s), T-Q2 (C-10 confirmation), the live-free checks in §13.4.

---

## 13. Test plan

All Jest, pure or with mocked repositories and a mocked `fetch`; small fixtures; inside the existing job (no added CI time). No test touches the shared database.

### 13.1 Transport (`emailTransport.idempotency.test.ts`)

| # | Case |
|---|---|
| T-T1 | No key: request body, headers, fallback order and result are byte-identical to today (snapshot of the fetch call; SMTP still tried after a Resend 500) |
| T-T2 | Key set: the Resend call carries `Idempotency-Key: export:{job}:{n}` |
| T-T3 | Key set, Resend 500: `sent: false`, `provider: 'resend'`, `providerStatus: 500`; SMTP and Gmail mocks never called |
| T-T4 | Key set, Resend 429 with `retry-after: 3`: `providerStatus 429`, `retryAfterSeconds 3`; no fallback |
| T-T5 | Key set, 409 with `name: concurrent_idempotent_requests` and with `invalid_idempotent_request`: `providerErrorCode` carries each |
| T-T6 | Key of 0 or 257 characters: refused before `fetch`, `error: 'invalid_idempotency_key'` |
| T-T7 | Key set, Resend not configured, SMTP configured: SMTP sends, one `idempotency_unsupported` warn |
| T-T8 | F-7: with an attachment named `secret-client-name.csv`, no log line from the transport contains the filename (Pino destination captured), on the Resend, SMTP and Gmail paths |
| T-T9 | Un-keyed 429 keeps today's fallback (behaviour unchanged for existing callers) |

### 13.2 Pure parts (`csvParts`, `moduleExportEmails`, `moduleExportSending`)

| # | Case |
|---|---|
| T-P1 | A small module: one part; bytes = BOM + header + CRLF + lines with CRLF, as `csvPartText` |
| T-P2 | Lines sized `Buffer.byteLength + 2`: a Hebrew line (2-byte letters) and an emoji line are measured in bytes, not characters |
| T-P3 | A module just over the budget: two parts, each ≤ `PART_BYTES_MAX` **including** BOM and header, cut only between lines, every line in exactly one part, order kept |
| T-P4 | Exactly at the budget: one part (inclusive) |
| T-P5 | 25 MB fixture of synthetic lines (built in the test, not stored): 4 parts (X-2) |
| T-P6 | 11 parts needed: `tooLarge` (BQ-28) |
| T-P7 | One line bigger than budget minus header: `tooLarge` |
| T-P8 | Zero rows: one part with the header only |
| T-P9 | Ranges only: the cutter returns indices, never copies of lines (memory, XC-8) |
| T-M1 | Copy parity en / he / es: same keys, same placeholders, no backslash in any string |
| T-M2 | Part subject and body say "email {n} of {X}" in each language; body 3 only when X > 1 |
| T-M3 | Requested-at and produced-at in the owner's timezone; "(UTC)" when not set; Hebrew isolates the date and time |
| T-M4 | File name `clients_2026-10-28_part-2-of-3.csv`; the date is the owner's business date (a UTC evening that is the next day in Asia/Jerusalem) |
| T-M5 | Notice chosen by code: `interrupted` → interrupted; `too_large`, `over_ceiling` → too large; anything else → failed |
| T-M6 | Every interpolated value HTML-escaped |
| T-M7 | No row count, business name, owner name or address other than the support contact in any template |
| T-M8 | Notice bytes are identical for identical inputs (key reuse safety) |
| T-S1…T-S4 | Cutoffs < budget < `maxDuration` < lease − 60; key builders produce `export:{id}:{n}` and `export-notice:{id}`; the 7,000,000 and 10 values |

### 13.3 Repository (`BusinessOsExportModuleJobRepository.test.ts`)

| # | Case |
|---|---|
| T-R1 | Every write sends `.eq('id')`, `.eq('user_id')`, `.eq('claimed_by')` and its expected status / notice state, with `{ count: 'exact' }` and no `.select()` |
| T-R2 | `count 0` → `{ data: { updated: false }, error: null }` (claim lost) |
| T-R3 | `markSent` patch holds `status 'sent'`, `sent_at`, `finished_at`, claim NULL and every part accepted |
| T-R4 | `markFailed` / `markInterrupted` set `notice_state` and clear the claim in the same patch (carry-over) |
| T-R5 | `markInterrupted` sets `failure_code 'interrupted'` |
| T-R6 | Every part written has `n`, `state`, `resend_id`, `at`, with integer `n` |
| T-R7 | `releaseForRetry` sets `parts []`, `parts_total` NULL, `next_attempt_at`, `last_error_code`, claim NULL |
| T-R8 | Invalid inputs (bad uuid, `n` 0 or 11, a code with a capital, a 129-character Resend id) refused with no DB call |
| T-R9 | A DB error is returned, never thrown, and its `details` never logged |
| T-R10 | Notice writes check `notice_state 'due'` |
| T-R11 | `reapStale` returns the additive fields; the log line unchanged |
| T-R12 | Cross-tenant: a write called with another account's `user_id` sends that `user_id` in the filter (so the row is not touched; `count 0`) |

### 13.4 Worker (`moduleExportWorker.test.ts`, fake clock, fake `sleep`, in-memory job store that enforces the §1 row CHECKs)

| # | Case | Covers |
|---|---|---|
| T-W1 | Happy path, 3 modules of one request: 3 part emails, each to the login email, module name, requested-at, produced-at; history rows `sent`; 3 SENT audit rows | AC 1, X-1 |
| T-W2 | Large module: X parts, keys `export:{id}:1..X`, each part's attachment ≤ budget with header and BOM; `parts_total` written before the first send | AC 2 |
| T-W3 | Sends ≥ 600 ms apart (fake clock), across parts and notices | XC-8 |
| T-W4 | 429 with `retry-after: 2` on part 2: waits 2 s, re-sends the same key and bytes, accepted once | XC-8, D-9 |
| T-W5 | 429 whose `retry-after` does not fit the budget on part 2: `interrupted`, notice due, claim cleared | D-10 |
| T-W6 | Timeout mid-send on part 2, then the re-send (same key) returns the first send's id: one `accepted`, no second part | K-7, D-9 |
| T-W7 | Timeout on all tries of part 2: `interrupted`, parts 1 accepted + 2 sending; part 3 never sent | AC 4, BQ-43 |
| T-W8 | 5xx before part 1 was marked is impossible by construction; a section read failure before part 1: released to `waiting` with backoff; third attempt → `failed attempts_exhausted` + failed email | AC 4 (first half), D-8 |
| T-W9 | Lease expiry / reap: a job left `working` with part 2 `sending` by a killed run is reaped next run → `interrupted`; the run then claims its notice and sends one interrupted email; the FAILED audit row has `interrupted: true` | AC 4, X-6 |
| T-W10 | Reaped with no part: back to `waiting`; next run builds it from scratch | AC 4 |
| T-W11 | Too large (11 parts): `failed too_large`, too-large email, no part email | AC 5 |
| T-W12 | Over the row ceiling: `failed over_ceiling`, too-large email | D-16 |
| T-W13 | Module switched off between request and claim (injected map): `failed module_switched_off`, no section read, `buildJoinedCsv` never called, failed email | SA-P4, carry-over |
| T-W14 | Unknown module id (renamed): `failed module_unknown` | MX-1a SA MX1A-10 |
| T-W15 | One module forced to fail among three: the other two arrive | AC 3, X-3 |
| T-W16 | Cross-tenant: two accounts' jobs in one run; every read and write for a job carries that job's `user_id`; the email goes to that account's login email; a mocked identity lookup for account B never feeds account A's send | tenant-isolation-guard step 6 |
| T-W17 | The worker and its deps import neither `featureFlags.ts` nor `lib/business-os/entitlements/` (source scan) | R-6, XC-19 |
| T-W18 | Language and clock resolved once per request: two modules of one request in one run share one language even if the mocked preference changes between calls; a language read error → `'en'` + `language_unreadable` warn | MX2B-11 |
| T-W19 | Labels: `buildJoinedCsv` receives `EXPORT_COLUMN_LABELS` (identity check), never a constructed set | MX-2b D-3 |
| T-W20 | Notice path: notice keyed `export-notice:{id}`; accepted → `sent`; 500 → claim released; `.invalid` recipient → `given_up`; 409 `invalid_idempotent_request` → treated as sent | D-13 |
| T-W21 | Build claim cutoff: after 90 s elapsed a claimed build is released without being built; notices still claimed until 250 s | D-10 |
| T-W22 | Claim lost (`count 0` on `markPartAccepted`): no further send for that job, `claim_lost` error logged, run continues | §5 |
| T-W23 | Logs: no address, subject, file name or cell value in any captured line | §12 privacy |
| T-W24 | Audit `details` keys exactly `request_id, job_id, module, origin, rows, parts, parts_accepted` (+ `failure_code, interrupted` on FAILED) | XC-13 |

### 13.5 Route (`route.test.ts`)

| # | Case |
|---|---|
| T-C1 | Production without `CRON_SECRET`: 401, worker not called (fail closed) |
| T-C2 | Wrong bearer: 401 |
| T-C3 | Correct bearer: 200 with the counts; `maxDuration === 300`, `runtime === 'nodejs'` |
| T-C4 | The worker throws: 500 with no details outside development |
| T-C5 | Audit entries flushed with `logAndFlush` |
| T-C6 | Wrapped by `withCronRunRecord('data-export-modules', …)` |

### 13.6 Guards

| # | Case |
|---|---|
| T-E1 | E-1: the status words of the DB CHECK (read from `20261095`), `MODULE_JOB_STATUSES`, `ExportHistoryStatus` (`exportHistory.ts`, source read) and `HISTORY_STATUSES` (`lib/client/businessOsDataExport.ts`, source read) are the same five in the same order; a planted sixth word fails it (negative control) |
| — | `dataExportSeverity.guard` (eight events), `bosCronJobs.test` (23), `vercelCrons.test`, callers guard |

### 13.7 QA (manual and measured)

| # | Check |
|---|---|
| T-Q1 | **Local only** (`supabase start` or a local fixture account; never the shared database): a module with 100,000 rows, run the worker with Resend mocked or pointed at a test key, record read time, build time, part count, send time and total; must finish inside 270 s. Record peak RSS |
| T-Q2 | **C-10 merge gate:** confirm `business_os_export_requests` holds no row from MX-1b or MX-3 testing (read-only query by QA, ids recorded), or that each is gone through the test-account cleanup |
| T-Q3 | A two-part fixture sent through Resend's test mode to a `+test` address from a local run: the two emails open in Gmail and Outlook, Hebrew renders right to left, both CSVs open in Excel with the header and Hebrew intact |

---

## 14. Carry-overs: where each one is met

| Carry-over | Source | Met by |
|---|---|---|
| Write all four part keys | MX-1a QA edge 1, SA comment 2 | §4.2, §7, T-R6 |
| Clear the claim on fail | MX-1a SA code review 3 | D-13, §7, T-R4 |
| Notice key `export-notice:{job_id}` | MX-1a SA MX1A-5 | D-13, T-W20 |
| Check `isModuleEnabled` before `buildJoinedCsv` | MX-2a / MX-2b | D-7, T-W13 |
| Size parts with `Buffer.byteLength + 2` | MX-2a / MX-2b | D-4, T-P2 |
| E-1: client history status list in step with the DB | MX-1b QA | T-E1 (no status added) |
| MX1B-6: no retry of the "requested" email | MX-1b SA | D-14 |
| K-7: duplicate risk on email timeout | MX-1b | D-9, D-12 (same key, same bytes), T-W6 |
| Pass `EXPORT_COLUMN_LABELS`, never build a label set | MX-2b D-3 | §5, T-W19 |
| Language once per request, `findPreferredLanguage`, `'en'` + `language_unreadable` | MX-2b MX2B-11 | D-6, T-W18; residual in §16 Q-2 |
| Requested-at and produced-at in the owner's timezone; "1 of X" | Requirement §3.5, §4.3 | §8, T-M2, T-M3 |
| Two-model note in the `durable-queue-drain` skill | MX-1a SA | Task 13 |
| Comma separator for Spanish-region Excel (MX2B-9) | MX-2b | Not in MX-3: no `sep=` line (it defeats the BOM). Left for MX-4's contents doc |
| Shared Resend limit at :50 | Plan §4.6 | §9.3, D-11 |
| DELETE's anchors in `events.ts`, `eventAudience.ts`, `vercel.json` | Coordinator 2026-10-28 | §9 |

---

## 15. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | The DB read time of a 100,000-row module is unmeasured (F-9) and could exceed the budget | T-Q1 measures it before merge. If it does not fit, the build cutoff and the budget mean the job is retried, then failed after 3 attempts with the failed email, never sent half (no part is marked until all reads and the cut are done) |
| K-2 | A run cut off after part 1 always ends `interrupted`, even when nothing crashed | The 90 s build cutoff leaves at least 180 s for a fresh job; T-Q1 checks the margin |
| K-3 | Resend's key window is shorter than assumed | Every keyed re-send happens inside one run (minutes) or one notice retry chain (at most 5 runs, about 25 minutes plus backoff). §16 Q-6 |
| K-4 | Production worker deployed with the switch off | Nothing to claim (R-6). The reaper still runs every 5 minutes on an empty table: two cheap RPCs |
| K-5 | Language differs between modules of one request handled in different runs | Minutes apart and only if the owner changes language meanwhile. §16 Q-2 |
| K-6 | DELETE D4b and MX-3b both add a cron entry and edit the registry counts | Own anchors; the second to land rebases and keeps both (count 24) |
| K-7 | A Resend accepted part whose `markPartAccepted` write fails | The part stays `sending`; the run treats the write failure as claim lost and stops; the reaper makes the job `interrupted` and the owner gets one interrupted email. The part arrived, but the history counts it as not sent: honest, since the record could not be written |

---

## 16. Open questions for SA

| # | Question | Proposal |
|---|---|---|
| Q-1 | **SA-P4:** a module switched off between request and claim | Fail closed: `failed module_switched_off`, failed email (D-7). Optionally a dedicated sentence "This part is not available for export right now" instead of "please try again" |
| Q-2 | Language per request without a column | Accept the per-run cache (D-6) now; if SA wants a hard guarantee, a `language` column on `business_os_export_requests` written by the request route is a later migration (MX-4 or MX-7 manual gate). MX-3 does **not** add a migration |
| Q-3 | In-run re-send of a `sending` part with the same key and bytes (D-9) | Allowed inside one run, never across runs |
| Q-4 | Send timeout: worker-side race (D-12) or an additive `timeoutMs` on the transport | Worker-side race (no wider transport change); the abandoned upload is harmless because the re-send carries the same key |
| Q-5 | `over_ceiling` uses the too-large email | Yes (D-16) |
| Q-6 | Resend's key window (24 h per its docs) | Accept; QA confirms once in T-Q3 by re-sending a key and seeing the same id |
| Q-7 | A keyed send with Resend not configured (local dev): fall back to SMTP / Gmail with a warning, or refuse | Fall back with a warning (dev only; production always has Resend) |
| Q-8 | Should the worker appear as a queue on the admin jobs page (`BosQueueId`, `drainsQueue`) | Not in MX-3 (`drainsQueue: null`); a follow-up if wanted |
| Q-9 | Support address in the emails: `PLACEHOLDER_ERASURE_CONTACT` reads `support@agentspilot.ai`, while BQ-E6.1-2 named `notifications@agentspilot.ai` as the support address | Reuse the constant as MX-1b does, and raise the mismatch with TL (it is the constant's value, not MX-3's) |
| Q-10 | Split into MX-3a / MX-3b (§11) | Split |
| Q-11 | Byte budget read as 7,000,000 bytes (decimal) | Yes (D-4) |

---

## 17. Business questions

BQ-28, BQ-42 and BQ-43 are answered (2026-10-28) and recorded in requirement §9 and plan §6.

✅ **Answered 2026-10-28 by the user (recorded as BQ-44 in requirement §9, plan §6, open item SA-P8 in plan §8):** "Too-large does not count toward the daily limit for now; revisit later." No migration. MX-3 records `too_large` and `over_ceiling` as their own failure codes (`MODULE_JOB_FAILURE_CODES`), so the later change loses nothing.

The question as it was put (raised by MX-1a's SA review, never numbered until now): **should a "too large" module count toward the 2-a-day export limit?** Today a request where every module failed does not count (BQ-29), and "too large" is a failure, so an owner whose only module is too large can ask again every few minutes and get a "too large" email each time. MX-1a's suggested answer: count "too large" only, because retrying cannot help. A "yes" is a one-line change in the start function's "not counted" rule, which is a migration, so it is **not** in MX-3; MX-3 writes the distinct codes (`too_large`, `over_ceiling`) so the rule can tell them apart later.

---

## Implementation Notes (MX-3a)

**Branch:** `feature/bos-export-mx3a-transport-parts`, off `main` `415f726e`. Not committed (RM, after SA code review, QA and the user's diff review).

### Files

| File | Action | What |
|---|---|---|
| `lib/notifications/emailTransport.ts` | modify | S-10 `idempotencyKey` (Resend `Idempotency-Key` header only when set), `timeoutMs` (AbortController on the Resend `fetch`, `signal` only when set; SA C-8), result fields `providerStatus` / `retryAfterSeconds` / `providerErrorCode` on a failed **keyed** send only, internal `ResendSendError` (same message text as before), key 1..256 and `timeoutMs` 1..300,000 refused before any transport (`invalid_idempotency_key`, `invalid_timeout_ms`), keyed send never falls back after Resend (D-17), keyed send without Resend refused when `VERCEL_ENV === 'production'` (`idempotency_unsupported`) and falls back with one warn elsewhere (SA Q-7), the key on the attempt line (T-6), F-7: no attachment filename in any of the four log sites. Exports `IDEMPOTENCY_KEY_MAX_LENGTH`, `SEND_TIMEOUT_MS_MAX` |
| `lib/business-os/data-export/moduleExportSending.ts` | create | Constants (D-3…D-12), failure and retry codes (incl. `request_mismatch`, C-4), `partIdempotencyKey` / `noticeIdempotencyKey` (with the Q-6 one-hour bound comment), `ownerFactsKey(userId, requestId)` (C-4), `buildPartSend` / `buildNoticeSend` (Q-3 / C-3), `classifyKeyedSend` |
| `lib/business-os/data-export/csvParts.ts` | create | `cutCsvParts` (ranges + byte totals, `tooLarge` with a reason), `csvPartTextOf`, `partOverheadBytes`, `lineBytes` |
| `lib/business-os/data-export/moduleExportEmails.ts` | create | Part email, notices (failed / not available / interrupted / too large), `partFileName`, `businessDate`, `noticeKindFor`; en / he / es |
| `lib/repositories/BusinessOsExportModuleJobRepository.ts` | modify | The ten §7 compare-and-set writes, every patch with `updated_at` (C-2); `ReapedModuleJob` additive fields |
| `lib/notifications/__tests__/emailTransport.idempotency.test.ts` | create | T-T1…T-T9, timeout cases, production refusal |
| `lib/business-os/data-export/__tests__/csvParts.test.ts`, `moduleExportEmails.test.ts`, `moduleExportSending.test.ts` | create | T-P1…T-P9, T-M1…T-M8, T-S1…T-S4 + payloads + `classifyKeyedSend` |
| `lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts` | modify | T-R1…T-R12; the existing reap expectation gains the additive fields |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` | modify | §4.3 "Not available" row (SA Q-1, BA duty delegated), §9 BQ-44 (user's too-large decision), Change History |
| `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` | modify | §6 BQ-44 row, §8 SA-P8 (revisit later), Change History |

### SA changes folded in

| Change | Where |
|---|---|
| C-2 `updated_at` on every write | `compareAndSet` callers; T-R1 asserts it for all ten |
| C-3 `redactRecipientInLogs: true` | `buildPartSend` / `buildNoticeSend` set it, and `ExportSendParams` types it as the literal `true`, so a worker cannot build a payload without it. T-W23 (capture of the transport's own lines) stays with MX-3b |
| C-4 owner cache by user + request | `ownerFactsKey(userId, requestId)` and the `request_mismatch` code here. The cache itself and the null-lookup → `failed request_mismatch` branch live in the worker: **MX-3b** (no repository change is needed: `findByIdForUser(requestId, userId)` already returns null for a mismatch) |
| C-8 / Q-4 transport `timeoutMs` | Transport; abort → `providerErrorCode 'timeout'`, no fallback when keyed |
| Q-1 "not available" copy | `noticeKindFor` → `not_available` for `module_switched_off` / `module_unknown`; failed subject, body "… failed. This part is not available for export right now."; requirement §4.3 row |
| Q-3 payload built once | `buildPartSend` / `buildNoticeSend` return frozen objects (arrays and the attachment record frozen; the Buffer cannot be frozen and is documented as never written). `classifyKeyedSend` maps 409 `invalid_idempotent_request` to `key_conflict` (part → `interrupted`, notice → treated as sent: worker, MX-3b) |
| Q-7 production refusal | Transport; T-T7 covers production and non-production |

### Deviations from the workplan text

1. **`NOTICE_CLAIM_CUTOFF_SECONDS` not defined.** SA C-1 prefers option (a), which drops it; C-1 is MX-3b. Defining it now would ship a constant 3b is likely to delete. `BUILD_CLAIM_CUTOFF_SECONDS = 90` is defined.
2. **D-12's worker race is replaced** by the transport `timeoutMs` (SA C-8), as ruled.
3. **`resend_id` may be null on an accepted part and on `markNoticeSent`.** Resend can accept a send whose body cannot be read (the transport then returns no id, an existing behaviour), and the row CHECK allows it. The repository refuses an empty or over-128-character id, not a null one.
4. **`markFailed` refuses the code `interrupted`** (that is `markInterrupted`'s), an extra guard beyond §7.
5. **`timeoutMs` on an un-keyed send** (no caller today) keeps the old fallback: the abort is a Resend failure like any other. Only keyed sends stop at Resend.
6. **Extra helpers in `moduleExportSending.ts`** (`buildPartSend`, `buildNoticeSend`, `classifyKeyedSend`, `ownerFactsKey`, the code lists) were added to make Q-3, C-3 and C-4 enforceable from this slice; all are pure and unit-tested.
7. **`VERCEL_ENV`** is newly read by the transport. It is already in the environment catalogue; the drift guard and `catalogue.test.ts` pass.

### Verification

- Jest: `emailTransport.idempotency` 30, the other six `lib/notifications` suites unchanged and green (108 in the folder); repository 53 (20 before + 33); `csvParts` + `moduleExportEmails` + `moduleExportSending` 59. `npm run test:gate` config over `lib/notifications`, `lib/business-os/data-export`, the repository suite, the callers guard and `lib/admin/environment`: 37 suites, 1,097 tests, all pass. Transport callers re-run green: `app/api/business-os/export-requests` (route + QA), `inviteEmail`.
- Typecheck: full `tsc --noEmit` (8 GB heap, completed, no OOM): the only error in a touched file was a mock type in the new transport test, fixed; a scoped `tsc` over every touched file then reports 0 errors. The repo's pre-existing errors elsewhere are unchanged.
- No backslash + hex digit sequence in any new file or added line (scanned).
- `console.*`: 0 in every touched file.

### Carried to MX-3b

C-1 (stop claiming at the build cutoff, or refund the attempt; rewrite T-W21), C-3's T-W23 log capture, C-4's cache and `request_mismatch` branch (+ T-W16 case), C-5 (single awaited caller pin + `maxDuration = 300`), C-6 (count literal 23, no ordinals, D4b rebase), C-7's CC-6 claims for `vercel.json` / `bosCronJobs.ts` / `events.ts` / `eventAudience.ts`, the worker, deps, route, registry, audit constants (SA-P5), callers guard, E-1 pin, skill note, T-Q1 / T-Q2 / T-Q3, and the optional K-7 one-retry of `markPartAccepted` / `markSent`. **For TL now (C-7):** the CC-6 claim for `emailTransport.ts` and, at the MX-3a PR, the S-10 `[EXPORT→DELETE] … built` announcement (including `timeoutMs` and the production refusal).

---

## SA Review Notes

See [SA Workplan Review — 2026-10-28](#sa-workplan-review--2026-10-28) below.

## SA Workplan Review — 2026-10-28

**Reviewed by SA — 2026-10-28**
**Status:** APPROVED WITH CHANGES. Required changes C-1…C-8 are to be folded into the workplan before Task 2 of MX-3a (C-1, C-4, C-5, C-6) or before that slice's code (C-2, C-3, C-7, C-8). No re-review is needed if they are folded in as written.

### What SA verified against the code and the documents

- **Plan §4.6 quote**: matches the plan text, including R-6, SA-P5 binding and the C-10 gate. AC MX-3 matches requirement §7. The user answers BQ-28, BQ-42 and BQ-43 are recorded correctly in requirement §4.3 and §9. XC-8 (cron only, `maxDuration = 300`, lease 420 s, 270 s budget, 600 ms spacing, `retry-after`) and XC-9 (`sending` before the call, `accepted` with the id, retry only while no part is `sending`, key `export:{job}:{n}`) are each met by D-2…D-12.
- **No migration needed (confirmed).** Every column §7 writes exists in `20261095`. `service_role` holds UPDATE on `business_os_export_module_jobs` (it is also a post-condition of that migration). Every new code (`module_switched_off`, `recipient_unavailable`, `section_read_failed`, `owner_unreadable`, `budget_spent`, `over_ceiling`, `too_large`, plus `request_mismatch` from C-4) fits `^[a-z][a-z0-9_]{1,39}$`. Each §7 patch satisfies the row CHECKs: `waiting_has_no_parts`, `parts_shape`, `sent_shape`, `failure_shape` (an interrupted row needs at least one part, and `markInterrupted` only runs after a part was marked), `notice_shape` (`given_up` directly from `markFailed` is legal), `finished_shape` and `claim_shape`.
- **`durable-queue-drain`**: the MX-1a claim and reap RPCs are reused unchanged. The runner order is reap → claim → guardrails → effect → terminal, all on the claimed row. Two dedupe markers are used: the terminal status, and the provider key for the external send. The cron is wired last and auth fails closed. `maxDuration = 300` against lease 420 is the ruled XC-8 exception. The purge descriptors already exist from MX-1a. Compliant, apart from C-1 and C-5.
- **`tenant-isolation-guard` step 6**: the ten compare-and-set writes filter on `id` (the primary key), the row's `user_id` and `claimed_by` (this runner's own uuid). No value in that filter comes from a caller, because the route takes no input. **For the writes this is sufficient.** Read on its own, `user_id` adds nothing to a primary-key match. Its value is that it pins the write to the tenant the effects were scoped to (T-R12). The real tenant risk is in the **reads and effects**: section reads, the identity lookup that gives the recipient, and the request facts. All three take `job.user_id`. One gap: the table has **no composite FK** tying `job.user_id` to `request.user_id`, and that is the reason for C-4.
- **S-10**: the change is additive. `idempotencyKey`, `providerStatus`, `retryAfterSeconds` and `providerErrorCode` are all optional. With no key set, every existing caller takes today's path (T-T1 and T-T9 pin it). The no-fallback rule applies to keyed sends only, and no keyed caller exists today. DL-3 and D4b reuse the key by passing the field, and the result fields give them the same 429 handling XC-8 asks of EXPORT. F-7: the `filename` log sites are confirmed at the Resend, SMTP and Gmail attachment mappers and the attempt line.
- **CC-6 anchors**: `DATA_EXPORT_DOWNLOADED_BY_ADMIN` is in `events.ts` (constant and definition) and `eventAudience.ts`. DELETE's `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL` is in different hunks, so the two do not touch. The `vercel.json` anchor is the `/api/cron/data-export` entry.
- **CLAUDE.md**: Pino child logger with `correlationId` and 0 `console.*` in every touched file (the counts were re-checked for `emailTransport.ts`, `events.ts`, `eventAudience.ts` and `bosCronJobs.ts`). No route body, so no route Zod; Zod covers the repository inputs. Cron auth is fail-closed `CRON_SECRET`, the `data-export` route pattern. Audit is non-blocking through `logAndFlush`. No LLM, so no model names. The timezone comes from `ownerClock` → `userPreferencesRepository.findTimezone`, so `user_preferences.timezone` is the authority. Severity `warning` is valid.

### Rulings on the open questions

1. **Q-1 / SA-P4: fail closed, as D-7 proposes.** A per-module switch is an emergency stop and must win over the "requested" email's promise. The `isModuleEnabled` check stays after MX-3.1, because MX-3.1 removes `isModuleExportEnabled`, not the module map. **Copy:** use the failed notice, but for `module_switched_off` and `module_unknown` replace "Please try again" with "This part is not available for export right now." It is a copy variant of the failed email, not a fourth email kind. BA adds the row to requirement §4.3 (en / he / es), and T-M5 covers it.
2. **Q-2: accept the per-run cache. No column and no migration.** The residual (modules of one request could differ in language when they are handled in different runs and the owner changes language in between) is recorded as accepted. Revisit only if MX-4's QA sees it. C-4 changes the cache key.
3. **Q-3: approved, on one condition.** The complete send payload for a part (to, from, subject, html, text, attachment bytes, key) is built **once** per part. `producedAt` is fixed once per job. The payload is re-sent by reference, never rebuilt. T-W6 asserts deep equality across tries. A part answered 409 `invalid_idempotent_request` ends `interrupted`. Never across runs.
4. **Q-4: use the transport, not the worker race (C-8).** Add an additive optional `timeoutMs` that aborts the Resend `fetch` (an `AbortSignal` timeout). An abandoned 9 MB upload still running inside the same function would make the in-run re-send collide with it (a guaranteed 409 `concurrent_idempotent_requests`), and it holds memory and a socket. An abort returns `sent: false` with `providerErrorCode: 'timeout'`, which means "outcome unknown", and D-9 then re-sends with the same key. DL-3 reuses it. MX-1b's own race is left as it is.
5. **Q-5:** yes. `over_ceiling` uses the too-large email.
6. **Q-6: accept the unconfirmed 24 h window.** The design must not depend on more than one hour. The longest keyed re-send span is one run (≤ 300 s) for a part, and five notice claims (about 25–30 min) for a notice. Put that bound in a comment beside the key builders. T-Q3 confirms only that a repeated key returns the same id. If Resend documents a window under one hour, reopen.
7. **Q-7: fall back only outside production.** When `VERCEL_ENV === 'production'`, a keyed send with Resend not configured is refused with `error: 'idempotency_unsupported'`, and SMTP and Gmail are never called. Elsewhere it falls back with the warn, as proposed. Add the production case to T-T7.
8. **Q-8:** `drainsQueue: null` is approved. An admin queue view is a follow-up if one is wanted.
9. **Q-9:** reuse `PLACEHOLDER_ERASURE_CONTACT`, with no new address literal in MX-3. TL raises the support-versus-notifications mismatch under BQ-E6.1-2. It does not block MX-3.
10. **Q-10: split approved** (see below).
11. **Q-11:** decimal 7,000,000 bytes is approved, measured as D-4 describes (BOM, header and every line, with `Buffer.byteLength + 2`).

### Required changes

- **C-1 (High): the build-claim cutoff burns attempts.** `claim_due` cannot be asked for notices only. A claim after 90 s therefore still turns a waiting job into `working`, adds 1 to `attempts` and sets backoff. The loop then keeps claiming. Three late claims end a job `attempts_exhausted` without it ever having been built. The fix is one of these two, stated in D-10:
  - (a) stop claiming anything at `BUILD_CLAIM_CUTOFF_SECONDS` and drop the separate notice cutoff (any notice left waits ≤ 5 min), **or**
  - (b) release a build claimed after the cutoff with the attempt **refunded** (`attempts = job.attempts - 1`, `next_attempt_at` NULL, `last_error_code 'budget_spent'`), then stop claiming.

  SA prefers (a). Rewrite T-W21 to prove that `attempts` is unchanged by a late run.
- **C-2 (High): every compare-and-set patch sets `updated_at`.** The table has no trigger. The RPCs set `updated_at` by hand, and the worker writes must do the same. Add the assertion to T-R1.
- **C-3 (High): every worker `sendEmail` passes `redactRecipientInLogs: true`**, the MX-1b route pattern. Without it, the transport's own "Email sent" line logs the address. T-W23 must capture the transport's log lines as well, not only the worker's.
- **C-4 (Medium): key the owner-facts cache by `user_id` + `request_id`.** A null from `findByIdForUser(job.request_id, job.user_id)` ends the job `failed` with code `request_mismatch`: no send, an `error` log line and no retry. It means the job's `user_id` and its request's owner disagree, which no FK prevents. Add the case to T-W16.
- **C-5 (Medium): pin the worker's caller.** A source-scan test in the route suite must show that `runModuleExportWorker` has exactly one runtime caller (the route), that the call is awaited, and that the route exports `maxDuration = 300`. Lease 420 > 300 is only safe if the platform kill ends the run (the `drainLeaseInvariant` pattern).
- **C-6 (Medium): the cron count and the DELETE merge.** Keep the literal `toHaveLength(23)`. Write the new comments in `bosCronJobs.ts` and in the test **by name, with no ordinal** ("the data export worker", not "the 23rd"), so that the count literal is the only line both slices edit. That line then gives a textual conflict, which is the tripwire. Never resolve it automatically, and never replace it with a derived count.
  - Whoever lands second rebases onto the current `main`, sets 24, and runs `bosCronJobs.test` and `vercelCrons.test` locally before pushing.
  - At the MX-3b PR, check D4b's state under CC-1 before auto-merge is switched on.
- **C-7 (Low): coordination timing.** Post the CC-6 claim for `emailTransport.ts` before the MX-3a code. The S-10 `[EXPORT→DELETE] … built` announcement goes out at the **MX-3a** PR, not MX-3b.
- **C-8 (Medium):** the transport `timeoutMs` from Q-4. Replace D-12's worker race with it, and add a T-T case (abort → `providerErrorCode 'timeout'`, no fallback when keyed).

### Optimisation suggestions (non-blocking)

- K-7: retry the `markPartAccepted` / `markSent` write once before treating the failure as a lost claim. The write is idempotent under the CAS, so one transient DB error does not turn a fully delivered module into `interrupted`.

### Split: MX-3a then MX-3b, sequential from `main`, not stacked

| | Approved content | Independently mergeable and useful? | Gates |
|---|---|---|---|
| **MX-3a** (≈ 1.4 d + C-2, C-7, C-8) | Transport S-10 + F-7 + `timeoutMs`; `moduleExportSending.ts`; `csvParts.ts`; `moduleExportEmails.ts`; the §7 writes | **Yes.** It changes live behaviour only through F-7, a privacy fix for every caller. The key is dormant until someone passes it. The cutter, templates and writes are exported with no caller until 3b, which is acceptable for a one-slice gap (nothing wired, no cron). It unblocks D4b's key | T-T1 (an un-keyed send is byte-identical to today) and T-T9; typecheck of the touched files; Jest for the touched suites; SA code review and QA. **No C-10, no 100k measurement** |
| **MX-3b** (≈ 1.6 d + C-1, C-3…C-6) | Worker, deps, route, registry and `vercel.json` (wired last), audit constants, definitions and audience (SA-P5), callers guard, E-1 pin, skill note | Ships the worker, which has nothing to claim while the switch is off (R-6) | **C-10 confirmation (T-Q2), the 100,000-row local measurement inside 270 s (T-Q1), T-Q3**, `npm run build`, C-6 rebase check |

MX-3b branches from `main` after MX-3a merges. Both slices use this workplan, with 3a and 3b sub-sections in the SA, QA and Commit sections. This branch can carry MX-3a.

### Business question (user's decision; technical cost and risk only)

**Should "too large" count toward the 2-a-day limit?**

- **Cost of a "yes":** one new migration that runs `CREATE OR REPLACE` on `business_os_export_request_start`. Its "not counted" predicate would treat failed jobs whose `failure_code` is `too_large` or `over_ceiling` as counted.
  - It needs the next free migration number (`20261099` is DELETE's) and the manual prod gate every migration needs.
  - The XC-7 migration test needs updating.
  - It has to decide how mixed requests count (one module too large and another failed for some other reason).
  - The function is shared with the admin origin, so the same rule applies to admin sends unless it is scoped to the owner.
  - About 0.5 d. It can ride on MX-4's or MX-7's migration rather than add a gate of its own.
- **Risk of a "no":** beyond repeated emails, every retry re-reads the module up to the 100,000-row ceiling and rebuilds it. That is one heavy DB job per owner per 5 minutes, bounded by the one-in-progress rule. It is a load and abuse cost, not a correctness one. MX-3 already writes the distinct codes, so the change can be made later without data loss.

## SA Code Review — MX-3a — 2026-10-28

**Reviewed by SA — 2026-10-28** (uncommitted diff on `feature/bos-export-mx3a-transport-parts` against `415f726e`)
**Status:** APPROVED. Two Low findings below; neither blocks QA. Comment 1 may be fixed now or carried to MX-3b; comment 2 is a comment fix.

### What SA verified

- **Backward compatibility (32 non-test importers of `emailTransport`; none passes `idempotencyKey` or `timeoutMs`).** Un-keyed: the `Idempotency-Key` header and `signal` are added only when set, `ResendSendError` keeps the old message text, the catch path and the fallback chain are unchanged, and no new result field appears (the spreads are conditional). The only un-keyed change is F-7 (filename removed at the Resend, SMTP, Gmail and attempt-line log sites). The transport does not mutate `p`, so frozen payloads are safe. T-T1 / T-T9 pin it.
- **Q-7:** `VERCEL_ENV === 'production'` refuses only a keyed send with Resend not configured (an invalid non-`re_` key counts as not configured). Preview, development and local (`VERCEL_ENV` unset) fall back with one warn. An un-keyed send in production keeps its fallback (tested). `VERCEL_ENV` is already catalogued; the `lib/admin/environment` suites are green.
- **C-8 / Q-4:** the `AbortController` timer is cleared in `finally` on every path; an abort during `fetch` becomes `providerErrorCode 'timeout'`, no fallback when keyed; no unhandled rejection. `timeoutMs` is bounded 1..300,000 and refused before any transport.
- **C-2:** all ten writes set `updated_at`. **Tenant isolation:** every write filters `id` + `user_id` + `claimed_by` + the expected state, uses `{ count: 'exact' }` and no `.select()`; Zod on every input; service-role use documented in the file header (rule 4, `tenant-isolation-guard` step 6). Each patch matches the §7 table and the row CHECKs.
- **C-3:** `ExportSendParams` types `redactRecipientInLogs` as the literal `true`, set by both builders. **Q-3:** both payloads are built once and frozen; `classifyKeyedSend` maps 409 `invalid_idempotent_request` to `key_conflict`, and `concurrent_idempotent_requests` / 429 / 5xx / timeout / no status to `retry`. **C-4 (partial):** `ownerFactsKey(userId, requestId)` and `request_mismatch` present. **Q-1:** `not_available` variant in en / he / es; requirement §4.3 row added.
- **Part cutter:** the budget counts BOM + header + CRLF + each line + CRLF in UTF-8 bytes, matching the `csv.ts` framing (`CSV_BOM`, `CSV_EOL` imported, `csvPartText` reused); cuts at row boundaries; budget inclusive; a line that cannot fit beside the header is `line_too_large`; exactly 10 parts pass, an 11th is `part_count`; zero rows give one header-only part; ranges only, no copies.
- **Templates:** pure and deterministic; the owner clock is passed in (timezone source `user_preferences.timezone` via `ownerClock`, wired in MX-3b); UTC fallback; values HTML-escaped; RTL isolation built from code points; no owner data in any log (the new files have no logger).
- **CLAUDE.md:** 0 `console.*`, no `any` in new code, no backslash + hex in any added line. **Tests rerun by SA:** `lib/notifications`, `lib/business-os/data-export`, the repository suite, the callers guard and `lib/admin/environment`: 37 suites, 1,097 tests, all pass.

### Code Review Comments

1. `lib/business-os/data-export/moduleExportSending.ts` `classifyKeyedSend` — outside production, a keyed send that fell back to SMTP returns `sent: true` with SMTP's message id, which is classified `accepted` and would be stored as a `resend_id`. Take the id only when `result.provider === 'resend'` (null otherwise), here or in the MX-3b worker. Dev / Preview only. — Priority: Low
2. `lib/business-os/data-export/moduleExportEmails.ts` header — "No backslash escape anywhere in this file" is not accurate (`'\n'`, the `fill` regex). The Tailwind hazard is backslash + hex only; reword to say that. — Priority: Low

### Rulings on the declared deviations

1. `NOTICE_CLAIM_CUTOFF_SECONDS` not defined: **accepted**, consistent with C-1 option (a). MX-3b must still state C-1 in D-10 and rewrite T-W21.
2. Null `resend_id` on an accepted part or notice: **accepted** (the row CHECK allows it; an unreadable Resend body is existing behaviour). See comment 1 for the non-Resend id.
3. `markFailed` refuses `interrupted`: **accepted**, a correct extra guard.
4. Un-keyed `timeoutMs` keeps the fallback: **accepted**; no caller today, documented on the field.
5. Extra pure helpers: **accepted**; they make Q-3, C-3 and C-4 enforceable and are unit-tested.
6. D-12 race replaced by `timeoutMs`; `VERCEL_ENV` newly read: **accepted**, as ruled.

### Carried to MX-3b (confirmed as recorded in Implementation Notes)

C-1, C-3's T-W23 transport log capture, C-4's cache and `request_mismatch` branch (+ T-W16), C-5, C-6, C-7's remaining CC-6 claims, the worker, deps, route, registry, audit (SA-P5), callers guard, E-1 pin, skill note, T-Q1 / T-Q2 / T-Q3, K-7. **For TL before the MX-3a PR (C-7):** the `emailTransport.ts` CC-6 claim and the S-10 `[EXPORT→DELETE] … built` announcement.

### Code Approved for QA: Yes

---

## QA Testing Report

## QA Report — MX-3a — 2026-10-28

**QA — 2026-10-28** (uncommitted diff on `feature/bos-export-mx3a-transport-parts` against `415f726e`, after TL applied SA comments 1 and 2)
**Test mode:** full
**Strategy used:** A (Jest unit: transport with mocked fetch / nodemailer, pure cutter, templates, classifier) + B (repository with a mocked Supabase client) + C (a throwaway 25 MB split test, deleted after the run). No DB writes, no live sends (those are MX-3b / E6.1).
**Focus:** api, schema, security
**Skipped:** live Resend sends and DB writes (out of scope by instruction); browser check (no UI in this slice)
**Input source:** prompt keywords (TL brief: SA's MX-3a gates)

### Test Coverage

| Acceptance criterion / SA gate | Tested? | Result | Notes |
|---|---|---|---|
| Un-keyed callers of `emailTransport.ts` unchanged apart from F-7 | ✅ | Pass | T-T1 / T-T9 pin the request (URL, method, headers, body, no key header, no signal), the Resend 500 to SMTP fallback, an un-keyed 429 fallback with no new result field, and the log lines (attempt line has no `idempotencyKey`). Callers' own suites run: 440 suites, 433 pass; the 7 failures are unrelated and pre-existing (see Test Outputs) |
| F-7: no attachment filename in any transport log; file still sent under its name | ✅ | Pass | T-T8 |
| Keyed send never falls back after a Resend failure | ✅ | Pass | T-T3 (500), T-T4 (429), timeout abort: SMTP and Gmail never called |
| Q-7 refusal only when `VERCEL_ENV=production` and Resend unconfigured | ✅ | Pass | T-T7: production refuses `idempotency_unsupported`; outside production SMTP sends with one warn; un-keyed in production still falls back |
| Timeout aborts and clears its timer | ✅ | Pass | Abort gives `providerErrorCode 'timeout'`, a signal is passed; timer count 0 after an in-time answer; invalid `timeoutMs` refused before fetch. See Edge Case 1 |
| 409 `invalid_idempotent_request` to `key_conflict`; 429 retry with `retry-after` | ✅ | Pass | `classifyKeyedSend` table: 429 with retry-after 2 waits 2, without waits 1; 409 concurrent retries; 409 invalid reuse is `key_conflict` |
| SA comment 1: `resendId` only when `provider === 'resend'` | ✅ | Pass | **Test added by QA** to `moduleExportSending.test.ts`: accepted via SMTP gives `resendId: null`, via Gmail null, via Resend keeps `re_kept` |
| SA comment 2: emails header comment reworded | ✅ | Pass | Header now reads "No backslash + hex escape anywhere in this file" |
| Part cutter: 7,000,000-byte budget incl. BOM + header + CRLF, row boundaries, oversized row, 10 ok / 11 too large | ✅ | Pass | T-P1…T-P9 |
| Real ~25 MB CSV split (QA throwaway) | ✅ | Pass | 25,000,049 bytes, 412,440 rows (Hebrew, emoji, quoted cells): **4 parts** of 6,999,955 / 6,999,958 / 6,999,936 / 4,000,272 bytes; each ≤ 7,000,000, each equal to its range's `bytes`, each starting with the BOM and the header + CRLF; header + concatenated bodies equals the original byte for byte. File deleted after the run |
| Repository CAS writes: id + user_id + claimed_by + expected state, `{ count: 'exact' }`, no select, `updated_at` set | ✅ | Pass | T-R1 across all ten writes; `setPartsTotal` adds `parts_total IS NULL`; T-R2 count 0 is `{ updated: false }`; T-R12 cross-tenant filter |
| Emails: en / he / es, owner timezone, HTML-escaped values, "not available for export right now" variant | ✅ | Pass | T-M1…T-M8; owner-zone business date in the file name (T-M4); `notAvailable` copy for switched-off / unknown modules (T-M5) |
| No backslash + hex in any added line | ✅ | Pass | Scanned every changed and new file; the only hits are `C:\Users\Barak…` paths already on `main` in the two plan / requirement docs, not added by this slice |
| Happy path + at least one failure path (CLAUDE.md) | ✅ | Pass | Every new module has both |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Timer cleanup is asserted on the success path only** — `lib/notifications/__tests__/emailTransport.idempotency.test.ts`. The `finally` clears the timer on every path (code read), but no test asserts `jest.getTimerCount() === 0` after a Resend 4xx / 5xx with `timeoutMs` set. A one-line addition would pin it. Severity: Low.

### Test Outputs / Logs

- `npm run test:gate -- lib/notifications lib/business-os/data-export lib/repositories lib/admin/environment`: **161 suites, 4,062 tests, all pass** (before the QA test was added). One "worker process has failed to exit gracefully" line; the five slice suites re-run with `--detectOpenHandles` show no open handle (145 / 145 pass), so it is not from this slice.
- After adding the SA comment 1 test: `moduleExportSending.test.ts` passes (35 tests across it and the throwaway run).
- Callers of `emailTransport` (every directory with an importer: invites, account delete / deletion-check, export-requests, public invites, billing, bizql, leads, insight, entitlements, payments, services, calibration, consent, email, scheduling, pilot): 440 suites, 433 pass, 7 fail. All 7 are pre-existing and unrelated: 5 `lib/pilot/__tests__` suites are in `.github/ci/jest-quarantine.json`; `bookingMailLandsOnTheJourney.guard` and `aCancelledMeetingSaysWhetherItWasSent.guard` are source-text scans that split on a blank line and break on CRLF checkouts on Windows (`recordEmailSend.ts` / `BookingEmailService.ts` are CRLF here and untouched by this slice).
- `tsc --noEmit` (8 GB heap): completed, no OOM, 1,864 pre-existing errors in the repo, **0 in any touched file** (`emailTransport`, `moduleExport*`, `csvParts`, `BusinessOsExportModuleJobRepository`).

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

---

## Commit Info

(RM to populate.)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-28 | Created (EXPORT Dev, E6) | Workplan for MX-3 written against `main` `415f726e`. Plan §4.6 quoted. User answers BQ-28 / BQ-42 / BQ-43 recorded in requirement §9 (with §4.3, X-2, X-6 and its Change History) and plan §4.6 / §6. Decisions D-1…D-21, state machines, transport S-10 + F-7 design, ten compare-and-set writes, en / he / es templates, test plan, carry-over map. No migration. Proposed split MX-3a / MX-3b (≈ 3.0 d total). Open questions Q-1…Q-11 for SA; one business question (does "too large" count toward the daily limit) for the user |
| 2026-10-28 | SA workplan review (SA) | APPROVED WITH CHANGES. Q-1…Q-11 ruled: SA-P4 fails closed, with a "not available" copy variant (BA adds it to requirement §4.3); per-run language cache accepted, no column; in-run re-send by reference with the same key; transport `timeoutMs` instead of the worker race; 24 h key window accepted with a one-hour design bound; keyed send refused in production when Resend is not configured. Required changes: C-1 (the build cutoff burns attempts), C-2 (`updated_at` on every write), C-3 (`redactRecipientInLogs`), C-4 (cache key + `request_mismatch`), C-5 (worker caller pin), C-6 (count literal and no ordinals, so a merge with D4b conflicts on that line), C-7 (S-10 announced at MX-3a), C-8. No migration needed (confirmed). Split MX-3a / MX-3b approved, sequential from `main`; C-10 and the 100k measurement gate MX-3b only. Too-large business question: technical cost and risk recorded, left for the user to decide |
| 2026-10-28 | MX-3a implemented (EXPORT Dev, E6a) | Branch line updated (MX-3a on `feature/bos-export-mx3a-transport-parts`; MX-3b on its own branch from `main`). Transport S-10 + `timeoutMs` + Q-7 + F-7; `moduleExportSending.ts`, `csvParts.ts`, `moduleExportEmails.ts`; ten compare-and-set writes with `updated_at`; tests. C-2, C-3, C-8, Q-1, Q-3, Q-7 folded in; C-4 partly (key + code), rest with C-1, C-5, C-6, C-7 carried to MX-3b. User decision on the too-large question recorded (§17; requirement §9 BQ-44; plan SA-P8). Implementation Notes (MX-3a) added. Not committed |
| 2026-10-28 | SA code review MX-3a (SA) | APPROVED. Un-keyed transport behaviour unchanged apart from F-7; Q-7 production-only refusal, `timeoutMs` abort and timer cleanup, ten CAS writes with `updated_at` and id + user_id + claimed_by filters, part cutter and templates verified; 37 suites / 1,097 tests rerun green. Two Low comments (an SMTP message id classified as a Resend id outside production; an inaccurate "no backslash" comment). All six deviations accepted. C-1, the rest of C-4, C-5, C-6 and the rest of C-7 confirmed carried to MX-3b. Code approved for QA |
