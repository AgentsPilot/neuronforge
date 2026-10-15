# Workplan: Business OS data export, DE-1: honest current export and section model

> **Last Updated**: 2026-10-14

## Overview

DE-1 is the first Phase 1 slice of the Business OS data export. It applies DX-1 and BQ-SA-1 to today's JSON export (`GET /api/user/data-export`). The file keeps only the account's own profile details. Agents, agent settings, runs, Pilot-Credit subscription and transactions, and audit history leave. The payload becomes typed (no `any`). The route is rebuilt on a small **section model** (`{ id, group, gdprRole, reader }`) so that DE-3…DE-7 only add sections. A section that fails to read is marked `failed` in the file (FR-E12) instead of being silently emptied. The `DATA_EXPORTED` audit row is written with `logAndFlush` (WC-7). The Danger zone's plain `<a>` goes through the shared fetch-and-blob helper. The characterization pin is updated deliberately. No DB change, no new dependency, no new route.

| Field | Value |
|---|---|
| **Developer** | Dev |
| **Requirement** | `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.1 (WC-7 note, QA E4), §0.3.1, §0.3.7 (DE-1 row), §0.4 (BQ-SA-1, DX-10), §0.4.1 B / D / E. On main since docs PR #384 (merged into this branch 2026-10-15); DE-1 status recorded in its new §0.5 |
| **Branch** | `feature/data-export-de1` (worktree `neuronforge-de1`, from origin/main `5946145d`) |
| **Date** | 2026-10-14 |
| **Status** | Code Complete (2026-10-15, uncommitted; awaiting SA code review) |
| **Depends on** | DE-0a (merged, `f7301fad`) |

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope rulings applied](#2-scope-rulings-applied)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Tests](#6-tests)
7. [Schema verification](#7-schema-verification)
8. [Risks](#8-risks)
9. [Open questions for SA](#9-open-questions-for-sa)
10. [SA Review Notes](#10-sa-review-notes)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)

---

## 1. Analysis Summary

**As-built on origin/main `5946145d`** (read in this worktree):

| Item | Today | Tier |
|---|---|---|
| Route | `app/api/user/data-export/route.ts`, GET, cookie auth via `createServerClient` + `getUser()`, 401 `{ error: 'Unauthorized' }` | ✅ |
| Reads (8, service role, through repositories) | `profiles` (18 cols, `.single()`), `agents`, `agent_executions` (90 d, ≤ 1,000), `agent_configurations`, `plugin_connections` (13 cols, `profile_data` allow-listed by `accountProfile`), `user_subscriptions`, `credit_transactions` (12 mo, ≤ 5,000), `audit_trail` (`listOwnerEntriesForExport`, BD-26, 90 d, ≤ 10,000) | ✅ |
| Read errors | Destructured away (`const { data } = …`): a failed read gives an empty section with no marker | ✅ |
| Payload | `const exportData: any` (L127), CLAUDE.md rule 6 debt | ✅ |
| Metadata | `data_controller: 'NeuronForge'` | ✅ |
| File name | `neuronforge-data-export-<userId>-<ms>.json` | ✅ |
| Audit | `await auditLog(…)` (only queues, no flush: WC-7 gap noted by SA at DE-0a) | ✅ |
| 500 body | `details` only in development (FU-P2 fixed) | ✅ |
| `console.*` | 0 in `route.ts`, 0 in `DangerZonePanel.tsx` | ✅ |
| Danger zone | `components/business-os/purge/DangerZonePanel.tsx` `ErasureRequestContent` L144: `<a href="/api/user/data-export">`. A signed-out click saves the 401 JSON as "my data" (QA E4) | ✅ |
| Shared helper | `lib/client/downloadUserDataExport.ts`: fetch + blob, returns a typed verdict, filename from `Content-Disposition` | ✅ |
| Tests | `route.test.ts` (391 lines, incl. QA's DE-0a token-free test), `route.characterization.test.ts` (575 lines, the pin), `lib/repositories/__tests__/userDataExportReads.test.ts` (8 cases), `lib/audit/__tests__/ownerAuditReads.guard.test.ts` (asserts the route **uses** `listOwnerEntriesForExport`), `components/business-os/purge/__tests__/DangerZonePanel.test.ts` (C-26: `FALLBACK_COPY` = `en`) | ✅ |

**What this slice touches:** one API route, two repositories (one method changed, six export methods removed, see §3.6), one new server module (the section registry), one client component, and their tests. **No DB tables or columns are added, read newly, or changed.** No provider factory, no LLM, no entitlements import, no service-role write (only the existing service-role reads, keyed on `getUser()`'s id).

**Skills checked:** `business-os-schema-check` (§7). `tenant-isolation-guard`: not triggered, there is no caller-supplied id and no write. `new-api-route` / `new-repository`: not a new route or repository; the route already follows the error format, Pino and correlation id; no new repository. `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`: not touched.

---

## 2. Scope rulings applied

| Ruling | Effect in DE-1 |
|---|---|
| §0.3.1 DX-1d (activity out) | `agent_executions` and `audit_logs` leave the file |
| §0.3.1 DX-1a (billing and credits out) | `subscriptions` (`user_subscriptions`) and `transactions` (`credit_transactions`) leave the file |
| §0.4 BQ-SA-1, §0.4.1 D (Business OS only) | `agents` and `agent_configurations` leave the file |
| §0.3.1 DX-1a (profile details in) | `user_profile` and `plugin_connections` stay. **Their column lists are not changed here**: the explicit DX-1a profile set (`profiles` columns, `user_preferences`, `notification_settings`, `business_profiles`, `business_addresses`) is DE-3. See SA question Q-3 on `profiles.plan` / `hourly_rate_usd` / `role` / `org_id` |
| §0.3.1 FR-E12 | A failed read is written as `status: 'failed'` on its section and listed in `summary.failed_sections`; never an empty-looking section |
| §0.3.7 / §0.1 WC-7 | `DATA_EXPORTED` written with `logAndFlush`, non-blocking, never fails the request |
| §0.4.1 B (DE-8b row) and §E | **DX-10 file naming and per-group controller wording belong to DE-8b**, which builds the zip and has the business name, the timezone and the `Content-Disposition` work. DE-1 makes only the minimal change in §3.4 |
| §0.1 QA E4 | Danger zone link → `downloadUserDataExport()` |
| §0.3.6 (DE-2) | Not built here. DE-1 only creates the `ExportSectionId` union and the section registry that DE-2's `exportClassification.test.ts` will cross-check. Column lists stay in the repositories until DE-2 moves them to the descriptors |

---

## 3. Implementation Approach

### 3.1 The section model (new module)

**File:** `lib/business-os/data-export/sections.ts` (server-only: it imports repositories; never imported by a `'use client'` file)

```typescript
export type ExportGroupId = 'account';            // DE-4+ add 'client_records', 'content'
export type GdprRole = 'controller' | 'processor';
export type ExportSectionId = 'account_identity' | 'user_profile' | 'plugin_connections';

export interface ExportContext {
  userId: string;                                 // always getUser().id, never the request
  authUser: { id: string; email: string | null; created_at: string };
}

export type SectionReadResult<Row> =
  | { ok: true; rows: Row[] }
  | { ok: false };                               // the reason is logged by the repository, never put in the file

export interface ExportSectionDefinition<Row> {
  id: ExportSectionId;
  group: ExportGroupId;
  gdprRole: GdprRole;
  read: (ctx: ExportContext) => Promise<SectionReadResult<Row>>;
}

export type ExportedSection<Row> =
  | { id: ExportSectionId; group: ExportGroupId; gdpr_role: GdprRole; status: 'ok'; row_count: number; rows: Row[] }
  | { id: ExportSectionId; group: ExportGroupId; gdpr_role: GdprRole; status: 'failed'; row_count: 0; rows: [] };
```

- `EXPORT_SECTIONS` is an ordered, `as const`-style array of definitions. The order is the order in the file.
- `runExportSections(ctx, sections)` reads them **sequentially** (same as today; parallel reads are a later optimisation, not a behaviour change worth taking in this slice). A reader that returns `{ ok: false }` **or throws** gives a `failed` section; the throw is logged with `{ err, sectionId }` at `error` and never reaches the file. This is what makes FR-E12 hold even for a reader that forgets to catch.
- Typing: each section's row type is concrete (`AccountIdentityRow`, `UserProfileRow`, `PluginConnectionExportItem`). The registry is typed as a union of the three definitions, so there is no `any` and no `unknown` cast in the route. Where the profile row comes back from the repository as `Record<string, unknown>`, the section's row type is `Record<string, unknown>`. That is honest about what PostgREST returns, without an `any`.

### 3.2 The three DE-1 sections

| id | group | gdprRole | reader | Can it fail? |
|---|---|---|---|---|
| `account_identity` | `account` | `controller` | From `ctx.authUser`: `{ id, email, created_at }` | No (no I/O) |
| `user_profile` | `account` | `controller` | `userProfileRepository.findForUserDataExport(userId)`: 0 or 1 row | Yes |
| `plugin_connections` | `account` | `controller` | `pluginConnectionRepository.listForUserDataExport(userId)`, mapped with the existing `accountProfile` allow-list (moved verbatim from the route into the section; the mapping and output keys stay the same) | Yes |

**Why split `account_identity` from `user_profile`:** today the profile row is spread over the auth fields, so a failed profile read is invisible: the file still shows id, email, created_at. With FR-E12, the profile section must be able to say `failed` while the identity (from the session, which cannot fail once we are past the 401) is still present. That is also what makes "the response is 200 if the account group was read" (FR-E12) always true in DE-1: the account group always holds at least the identity. See Q-2.

**Missing profile row ≠ failure.** `findForUserDataExport` uses `.single()` today, so a person with no `profiles` row gets PGRST116 as an *error*. Under FR-E12 that would be reported as `failed`, which is wrong. The method changes to `.maybeSingle()`: no row → `{ data: null, error: null }` → section `ok` with 0 rows. A real error stays an error. The method has exactly one caller (this route). See Q-4.

### 3.3 The typed payload

**File:** `lib/business-os/data-export/payload.ts` (types and one pure builder, `buildExportPayload`)

```typescript
export interface UserDataExportPayload {
  export_metadata: {
    format_version: 2;
    user_id: string;
    export_date: string;                  // ISO 8601 UTC
    export_format: 'JSON';
    gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)';
    provider: 'AgentPilot';               // replaces data_controller: 'NeuronForge' (see 3.4)
    groups: Record<ExportGroupId, { gdpr_role: GdprRole; description: string }>;
  };
  sections: ExportedSection<…>[];        // ordered as EXPORT_SECTIONS
  summary: {
    section_counts: Record<ExportSectionId, number>;
    failed_sections: ExportSectionId[];
    export_size_kb: number;
    export_duration_ms: number;
  };
}
```

- `format_version: 2` marks the break from the 2025 shape (top-level `agents`, `transactions`, …), so anyone who scripted against the old file can tell.
- `groups.account.description` is one plain sentence ("Your own account details. AgentPilot is the controller of this data."). The full controller wording per group, en/he, is DE-8b's README (§0.4.1 E).
- `export_size_kb` keeps today's two-pass computation (stringify, measure, set).
- The JSON stays 2-space indented, `Content-Type: application/json`, `Cache-Control: no-store, no-cache, must-revalidate`.

### 3.4 File name and controller field: the minimal DE-1 change

§0.4.1 places DX-10 (business-name slug, timezone date, `filename*`, Hebrew, fallback) in **DE-8b**. DE-1 does **not** implement the slug. It makes one minimal change so that today's file stops carrying the stale brand and the user id:

| | Today | DE-1 |
|---|---|---|
| File name | `neuronforge-data-export-<userId>-<ms>.json` | `agentpilot-data-export-<YYYY-MM-DD>.json` (UTC date): the §E **fallback** form, with `.json` instead of `.zip` |
| Controller field | `data_controller: 'NeuronForge'` | `provider: 'AgentPilot'`, plus `gdpr_role` per group and section |

Why the user id leaves the name: the name reaches the downloads folder and is often shared or forwarded, and the id adds nothing the owner needs (it is inside the file). Business name, timezone date and `filename*` stay in DE-8b. If SA prefers zero filename change in DE-1, the alternative is to leave both untouched (Q-1). The shared helper needs no change either way: its own test uses the old name only as a fixture.

### 3.5 Route changes

**File:** `app/api/user/data-export/route.ts`

1. Remove the imports and reads of `agentRepository`, `ExecutionRepository` (and the module-level `new ExecutionRepository(supabaseServer)`), `agentConfigurationRepository`, `userSubscriptionRepository`, `creditTransactionRepository`, `auditTrailRepository`, and `supabaseServer`.
2. Keep auth exactly as is (401 body unchanged, no read before auth).
3. `ctx = { userId: user.id, authUser: { id, email ?? null, created_at } }` → `runExportSections(ctx, EXPORT_SECTIONS)` → `buildExportPayload(…)`.
4. Log `Data export completed` with `{ userId, sectionCounts, failedSections, exportSizeKb, durationMs }`: ids and counts only, never content, never the email. If `failedSections` is non-empty, log `warn` `Data export completed with failed sections` instead of `info` (one line either way).
5. Audit (`logAndFlush`, §3.7).
6. Return 200 with the payload and the headers in §3.4.
7. The `catch` keeps the FU-P2 body and log line unchanged.
8. Header comment rewritten: what is in (DX-1a, two sections) and out (DX-1d, DX-1a billing, BQ-SA-1), FR-E12, WC-7. The BD-26 paragraph goes, because the route no longer reads audit rows.

### 3.6 Dead repository methods

After DE-1, six export methods have no caller: `AgentRepository.listForUserDataExport`, `ExecutionRepository.listForUserDataExport`, `AgentConfigurationRepository.listForUserDataExport`, `UserSubscriptionRepository.findForUserDataExport`, `CreditTransactionRepository.listForUserDataExport`, `AuditTrailRepository.listOwnerEntriesForExport`, plus their column constants (`AGENT_DATA_EXPORT_COLUMNS`, `EXECUTION_DATA_EXPORT_COLUMNS`, `AGENT_CONFIGURATION_DATA_EXPORT_COLUMNS`, `SUBSCRIPTION_DATA_EXPORT_COLUMNS`; `OWNER_COLUMNS` stays, `listOwnerEntries` uses it).

**Plan: delete them** (Q-5), with their `userDataExportReads.test.ts` cases. A purpose-named "for the data export" method that nothing calls invites someone to wire it back in and undo DX-1. Care points:
- `UserSubscriptionRepository` L66–69 comment says `BILLING_SUMMARY_COLUMNS` ⊂ `SUBSCRIPTION_DATA_EXPORT_COLUMNS` "which a live route already selects". That reasoning is now void; rewrite the comment so it stands alone (the columns themselves are unchanged).
- `CreditTransactionRepository` keeps `sumCreditsDeltaByActivityType` and `insertReturningId`. Its `CreditTransactionRepository.webhook.test.ts` scans the class source; re-run it.
- `ownerAuditReads.guard.test.ts`: the three cases that require `listOwnerEntriesForExport` to exist, to apply both exclusions, and to be used by the route are replaced by **one stronger case: the export route reads no audit rows at all** (does not name `audit_trail`, does not call `auditTrailRepository`). The negative controls for the route-side check are adapted. BD-26 itself is unaffected: `listOwnerEntries` and the owner RLS policy keep their own guard cases.

### 3.7 Audit with `logAndFlush`

```typescript
await logAndFlush(
  {
    action: AUDIT_EVENTS.DATA_EXPORTED,
    entityType: 'user',
    entityId: user.id,
    userId: user.id,
    resourceName: user.email || 'User Data',            // unchanged from today
    details: {
      export_timestamp, export_format: 'JSON', format_version: 2,
      data_categories: [...section ids with status ok],
      section_counts, failed_sections,                   // counts, never contents (FR-E15)
      gdpr_basis, ip_address, user_agent,                // unchanged from today
    },
    severity: 'info',
    complianceFlags: ['GDPR', 'SOC2'],
  },
  requestLogger,
  { reason: 'data export', continues: 'the export is still returned' }
);
```

`logAndFlush` never rejects and is bounded by `AUDIT_FLUSH_TIMEOUT_MS`, so the download is never blocked or failed by the audit (CLAUDE.md § Audit Trail). The route's own `Data export audit logged` / `…failed (non-critical)` lines go: `logAndFlush` logs its own timeout and failure lines (`Audit flush on data export timed out; the export is still returned`).

### 3.8 Danger zone through the shared helper

**File:** `components/business-os/purge/DangerZonePanel.tsx`, `ErasureRequestContent`

- The `<a href="/api/user/data-export">` becomes a `<button type="button">` with the same classes and icon. `onClick` → `downloadUserDataExport()`.
- Local state: `exporting` (button `disabled` + `aria-busy`, label unchanged, spinner icon in place of `Download`), and a message line with `role="status"` / `aria-live="polite"`: `settings.security.export_success` on success, `settings.security.export_error` on any failure (401, 500, network). The keys already exist in `en` / `es` / `he` (used by the BOS settings screen since DE-0a). They are added to `FALLBACK_COPY` byte-identical to `en`, so the C-26 test stays green and `/v2/settings` (no provider) shows English.
- The stale comment ("A plain link, not a fetch …") is replaced with the SQ-E2 reason.
- No DB access, no user id, no audit call from the browser (the server writes `DATA_EXPORTED`).
- DE-9 later replaces this with the one shared "Download my data" control. This change is small on purpose.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/data-export/sections.ts` | create | Section model, `ExportSectionId`, the 3 DE-1 sections, `runExportSections` (FR-E12) |
| `lib/business-os/data-export/payload.ts` | create | Typed `UserDataExportPayload`, `buildExportPayload`, file name helper |
| `lib/business-os/data-export/__tests__/sections.test.ts` | create | Unit tests for the model (§6) |
| `app/api/user/data-export/route.ts` | modify | Drop 6 sections, use the model, typed payload, `logAndFlush`, file name |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin (§6.2) |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Drop the audit/BD-26 route cases, keep the token-free test, add failed-section and audit-flush cases |
| `lib/repositories/UserProfileRepository.ts` | modify | `findForUserDataExport`: `.single()` → `.maybeSingle()` (Q-4), doc comment |
| `lib/repositories/AgentRepository.ts` | modify | Delete `listForUserDataExport` + constant (Q-5) |
| `lib/repositories/ExecutionRepository.ts` | modify | Same |
| `lib/repositories/AgentConfigurationRepository.ts` | modify | Same |
| `lib/repositories/UserSubscriptionRepository.ts` | modify | Same; rewrite the `BILLING_SUMMARY_COLUMNS` comment |
| `lib/repositories/CreditTransactionRepository.ts` | modify | Delete `listForUserDataExport`; header comment |
| `lib/repositories/AuditTrailRepository.ts` | modify | Delete `listOwnerEntriesForExport`; header comments that name it |
| `lib/repositories/__tests__/userDataExportReads.test.ts` | modify | Keep the profile (now `maybeSingle`) and plugin cases, drop six |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | modify | Replace the 3 export-read cases with "the export route reads no audit rows" + negative control |
| `components/business-os/purge/DangerZonePanel.tsx` | modify | Link → button through `downloadUserDataExport()` |
| `components/business-os/purge/__tests__/DangerZonePanel.export.test.tsx` | create | jsdom + RTL: success / failure / busy state, no `href` to the route |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify (at code-complete) | Record DE-1 status in §0 and Change History (standing rule: always update the main requirement). Done in the docs worktree or here, as TL directs, since the requirement is not yet on main |

Not touched: `lib/client/downloadUserDataExport.ts` (works with any name; its test fixture is unaffected), the three settings screens (already on the helper), the DB, migrations, `businessOwnedTables.ts`, `descriptors.ts` (DE-2).

---

## 5. Task List

- ✅ **T1** Confirm branch `feature/data-export-de1`; re-run the §7 probe on the final column strings (unchanged, but re-checked at code-complete) and record the ref. Done: branch `feature/data-export-de1` confirmed; `origin/main` merged in (merge, not rebase) after docs PR #384. Re-probe 2026-10-15, service role, zero rows, project `jgccgkyhpwirgknnceoh`: `profiles` final 17-column string (without `plan`) ✅ OK; `plugin_connections` 13 columns ✅ OK.
- ✅ **T2** Create `lib/business-os/data-export/sections.ts`: types, `accountProfile` + `ACCOUNT_PROFILE_KEYS` moved verbatim from the route, the 3 sections, `runExportSections` (catches throws → `failed`, logs `{ err, sectionId }`). Done.
- ✅ **T3** Create `lib/business-os/data-export/payload.ts`: payload types, `buildExportPayload`, `exportFileName(now)` → `agentpilot-data-export-YYYY-MM-DD.json` (UTC). Done.
- ✅ **T4** `UserProfileRepository.findForUserDataExport` → `.maybeSingle()`; update its doc comment and its `userDataExportReads` case. Done, plus `plan` removed from `PROFILE_DATA_EXPORT_COLUMNS` (SA Q-3 / C-1), return type `RepositoryResult<Record<string, unknown> | null>`.
- ✅ **T5** Rewrite `route.ts` per §3.5 / §3.7. Zero `any`, zero `console.*`. Done.
- ✅ **T6** Delete the six dead export methods and constants (§3.6) and their `userDataExportReads` cases; fix the comments that name them. Done. Also C-5: `PluginConnectionRepository` comments now point at `sections.ts` for `accountProfile`; `CreditTransactionRepository.test.ts` L6 fixed; `grep ForUserDataExport|listOwnerEntriesForExport` finds only the two kept methods, their tests, the section readers and one history sentence in the guard header.
- ✅ **T7** Update `ownerAuditReads.guard.test.ts` (§3.6). Done.
- ✅ **T8** Write `sections.test.ts` (§6.1). Done (12 cases).
- ✅ **T9** Re-pin `route.characterization.test.ts` deliberately (§6.2), every changed expectation carrying a `DE-1:` comment naming this workplan. Done (23 cases; 6 new "never reads" cases).
- ✅ **T10** Update `route.test.ts` (§6.3); keep the DE-0a token-free test as is. Done. Deviation: see §5.1.
- ✅ **T11** Danger zone button (§3.8) + `FALLBACK_COPY` keys + `DangerZonePanel.export.test.tsx` (§6.4). Done (5 RTL cases).
- ✅ **T12** Run the targeted suites (§6.5), `npx eslint` on changed files, `npx tsc --noEmit` filtered to changed files (0 new errors), and confirm `grep -n "any" route.ts sections.ts payload.ts` finds no type `any`. Done, see §5.1.
- ✅ **T13** `git diff --stat` / `--numstat` check (no file blanked: deletion-only hunks only in the six removed methods and the dropped test cases). Done, see §5.1.
- ✅ **T14** Update the main requirement with DE-1 status; set this workplan to Code Complete; notify TL for SA code review. **Do not commit.** Done: requirement §0.5 + header status line + B-9 waiver note + AC-E7 note + two Change History rows, insert-only (31 / 0).


### 5.1 Implementation notes (Dev, 2026-10-15)

**Deviations from the plan**

| # | Deviation | Why |
|---|---|---|
| D-1 | The DE-0a QA test in `route.test.ts` ("a connection row carrying access_token / …") is **not byte-identical**: its two `body.plugin_connections` accessors now read `sectionOf(body, 'plugin_connections').rows`, with a `DE-1:` comment. The seed, the forbidden keys and the forbidden secrets are unchanged | The payload shape changed (§3.3), so `body.plugin_connections` no longer exists. C-7's byte-for-byte rule cannot hold for an accessor into the old shape; everything the test asserts is kept. The characterization pin's own token-free line (`expect(text).not.toContain('never-exported')`) is unchanged |
| D-2 | `summary.section_counts` is typed `Partial<Record<ExportSectionId, number>>`, not `Record<…>` | It is built from the sections that ran; honest typing, no cast |
| D-3 | `route.test.ts` runs the **real** `logAndFlush` with the `AuditTrail` singleton mocked (`log` / `flush`), so a rejecting flush is shown to be logged by `logAndFlush` and still give 200. The characterization pin mocks `logAndFlush` itself to pin the entry and context exactly | Covers both the exact entry and the never-rejects contract end to end |
| D-4 | `route.test.ts`'s mock now honours the select on the profile read (returns only selected columns), so "no `plan` in the body" (C-1) is a real test rather than an artefact of the seed | C-1 |
| D-5 | `DangerZonePanel` handler also has a `catch` that shows the error message if the helper ever throws (it is not expected to) | Never a false success; covered by an RTL case |
| D-6 | Requirement `> **Last Updated**` left at 2026-10-05: the T14 instruction was insert-only | TL may bump it in the same PR |

**Results**

| Check | Result |
|---|---|
| Targeted Jest (§6.5 list + `adminReadMethods.guard`) | ✅ 17 suites, 235/235 |
| `npm run test:authz-guard` | ✅ 2 suites, 203/203 |
| `npx eslint` on every changed file | 0 errors; 2 pre-existing `any` warnings in untouched lines of `AgentRepository.ts` L110 and `AgentConfigurationRepository.ts` L229 |
| `npx tsc --noEmit -p .` (full, `--max-old-space-size=10240`) | 0 errors in any changed or new file. 1,856 errors elsewhere, all pre-existing (the repo baseline; `next.config.js` ignores them) |
| `grep any` in `route.ts`, `sections.ts`, `payload.ts` | No type `any` |
| `console.*` | 0 in `route.ts`, `sections.ts`, `payload.ts`, `DangerZonePanel.tsx` |
| C-8 `git diff --numstat` | Deletion-only files: `AgentRepository.ts` (0/49), `ExecutionRepository.ts` (0/47), `AgentConfigurationRepository.ts` (0/33): exactly the removed methods and constants, boundaries checked by hand. Every other file has insertions. No file blanked |
| Full `npm test` | Not run (the targeted list covers every file that names the changed code; QA's run) |

---

## 6. Tests

All are Jest in the existing job. No new job, no DB, no network: **no added CI time** (a handful of fast unit cases; the route suites get smaller, because six table pins go).

### 6.1 `lib/business-os/data-export/__tests__/sections.test.ts` (new)

| Case | Path |
|---|---|
| All readers ok → sections in registry order, `status: 'ok'`, `row_count` = rows | happy |
| A reader returns `{ ok: false }` → that section `failed`, `rows: []`, `row_count: 0`; the others unaffected | failure |
| A reader **throws** → `failed`, logged `error` with `{ err, sectionId }`, the error text not in the output | failure |
| `account_identity` is `ok` with the auth fields even when every other section fails | failure |
| Registry invariants: ids unique; every id in `ExportSectionId` has exactly one definition; every section has group + gdprRole (DE-2 will extend this against the descriptors) | guard |
| `accountProfile`: allow-listed strings only; `sub`, token keys, nested objects dropped (moved test, same cases as today) | safety |
| `exportFileName`: `agentpilot-data-export-2026-07-15.json` for a frozen clock; no user id | happy |

### 6.2 `route.characterization.test.ts`: deliberate re-pin

- **Reads:** exactly `service:profiles` then `service:plugin_connections`, once each, nothing on the anon client. The six removed tables are asserted **never read**.
- **Chains:** `profiles` → `select(SELECTS.profiles)`, `eq('id', …)`, **`maybeSingle`** (was `single`); `plugin_connections` unchanged.
- **Body:** exact text (key order, 2-space indent) of the new payload: `format_version: 2`, `provider: 'AgentPilot'`, `groups`, three sections, `summary`.
- **Failed marker (AC-E9):** `it.each(['profiles', 'plugin_connections'])`: a PostgREST error on that table gives a 200 with that section `status: 'failed'` and listed in `failed_sections`. Replaces today's "empty section" pin, which is exactly the behaviour FR-E12 forbids.
- **Missing profile row:** `{ data: null, error: null }` → `user_profile` `ok`, 0 rows, not failed.
- **Every read failing** → 200, `account_identity` ok, two failed sections.
- **Headers:** `Content-Disposition: attachment; filename="agentpilot-data-export-2026-07-15.json"`, `Content-Type`, `Cache-Control` unchanged.
- **Audit:** `logAndFlush` called once with the §3.7 entry and context; a flush that resolves after a logged failure still gives 200 with the full body.
- **Logs:** `Data export started`, `Data export completed` with counts only; no email in any log field.
- **401** (no session; auth error): unchanged, reads nothing, no audit.
- **500** (FU-P2, production): body `{ success: false, error: 'Data export failed' }`, no details; unchanged.
- **Token-free:** the seeded `access_token: 'never-exported'` and the token inside `profile_data` never reach the body (kept).

### 6.3 `route.test.ts`

- Keep: 401, Pino with correlation id (header and generated), 500 body in production / development, `profile_data` allow-list cases, "reads nothing on the anon client", and **the DE-0a QA test "a connection row carrying access_token / refresh_token / credentials / token-bearing profile_data exports none of them" unchanged**.
- Remove: the BD-26 audit-query cases and "exports the audit rows" (the route no longer reads audit rows; BD-26 stays covered by `ownerAuditReads.guard.test.ts` and the `listOwnerEntries` tests).
- Add: the body has no key `agents`, `agent_executions`, `agent_configurations`, `subscriptions`, `transactions`, `audit_logs`, and no section with those ids; a failed `plugin_connections` read is marked `failed`.

### 6.4 `DangerZonePanel.export.test.tsx` (new, `@jest-environment jsdom`, RTL)

| Case | Path |
|---|---|
| The export control is a button; there is no element with `href="/api/user/data-export"` | guard |
| Click → `downloadUserDataExport` (mocked) called once; button disabled while pending; success message in a `role="status"` region | happy |
| Helper returns `{ success: false, code: 'unauthorized' }` → error message, no success message | failure |
| Helper returns `network` → error message | failure |

`DangerZonePanel.test.ts` (C-26) keeps passing with the two new `FALLBACK_COPY` keys.

### 6.5 Targeted run (T12)

```bash
npx jest app/api/user/data-export lib/business-os/data-export lib/repositories/__tests__/userDataExportReads.test.ts lib/audit/__tests__/ownerAuditReads.guard.test.ts components/business-os/purge lib/client/__tests__/downloadUserDataExport.test.ts lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts lib/repositories/__tests__/CreditTransactionRepository
```

Plus the full `npm test` once, compared against the known pre-existing failures listed in QA's DE-0a report.

**AC mapping:** AC-E7 (no `*`: the two remaining reads use named constants, pinned literally in the characterization test; the BD-26 half of AC-E7 is moot because the audit section leaves under §0.3.1, and the guard proves the route reads no audit rows), AC-E8 (500 test), AC-E9 (failed-marker tests).

---

## 7. Schema verification

DE-1 adds no column and no table. It keeps two reads and removes six. The two kept column strings were verified live (business-os-schema-check Rule 1/2):

| Check | Ref | Result |
|---|---|---|
| `npm run schema:check -- --json` | main checkout `e49a4719` (dirty working tree; the two repository files are byte-identical to origin/main `5946145d`) | 663 selects replayed; **no finding on `profiles` or `plugin_connections`**. The 25 findings are elsewhere and pre-existing |
| Blind spot: the export reads pass a **constant** to `.select()`, which the script does not extract, so a targeted zero-row probe (`.select(<exact string>).limit(0)`, service role, read-only, project `jgccgkyhpwirgknnceoh`) | same strings as origin/main | `profiles` (18 columns) ✅ OK; `plugin_connections` (13 columns) ✅ OK |

Incidental, for DE-8b's workplan: a probe of `business_profiles.business_name` returned **42703, the column does not exist**. DE-8b must find the real business-name column with this skill before writing the slug (§0.4.1 E "Source").

T1 re-runs the targeted probe at code-complete.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| An agent-platform user loses agents/runs/credits from their export | 🟡 | Decided by the user (BQ-SA-1, DX-1). `format_version: 2` marks the change. The README stating "agents are not part of this export" is DE-8b (§0.4.1 D); DE-1's `groups.account.description` does not mention it. Q-6 asks whether DE-1 should carry that line now |
| Something outside the route parses the 2025 shape | 🟢 | Searched: the only consumers are the shared helper (opaque blob) and humans. No code reads the keys |
| `.maybeSingle()` changes behaviour for another caller | 🟢 | One caller (this route), confirmed by grep |
| Deleting the export methods breaks a test that scans repository source | 🟢 | Known: `ownerAuditReads.guard`, `userDataExportReads`, `CreditTransactionRepository.webhook` (class scan). All in T12's run |
| The `logAndFlush` adds up to `AUDIT_FLUSH_TIMEOUT_MS` to the download | 🟢 | Bounded, and the same trade-off every WC-7 route already makes; the export is a rare, user-initiated action |
| The Danger zone button changes behaviour on three surfaces | 🟢 | Same helper and messages as the BOS settings screen since DE-0a; RTL test; QA manual click on `/business-os/settings` and `/v2/settings` |
| The characterization pin is weakened rather than re-pinned | 🟡 | Every changed expectation carries a `DE-1:` comment; the exact-text body pin stays; the "removed tables never read" assertion is new. SA reviews the pin diff on its own |
| Logs or audit carry content | 🟢 | Counts and ids only; `resourceName` = email as today (pinned, unchanged) |

---

## 9. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| **Q-1** | File name and controller field in DE-1: is the minimal change (`agentpilot-data-export-<YYYY-MM-DD>.json` in UTC, no user id; `data_controller: 'NeuronForge'` → `provider: 'AgentPilot'` + per-group `gdpr_role`) acceptable, or should DE-1 leave both untouched and let DE-8b make the whole DX-10 change at once? | Make the minimal change (§3.4) |
| **Q-2** | FR-E12 "200 if the account group was read": OK to split `account_identity` (from `getUser()`, cannot fail) from `user_profile`, so the response is always 200 and a failed profile read is visible as `failed`? | Yes, split |
| **Q-3** | `profiles` today exports `plan`, `hourly_rate_usd`, `role` and `org_id`. Under DX-1a ("no plan or billing data") `plan` arguably should go, and `role` is a legacy, user-writable field. Trim them in DE-1, or leave the profile column list to DE-3, which owns "profiles (explicit columns)"? | Leave to DE-3, no column change in DE-1 |
| **Q-4** | `findForUserDataExport` `.single()` → `.maybeSingle()`, so that "no profile row" is `ok` with 0 rows, not `failed`. Acceptable as part of DE-1? | Yes |
| **Q-5** | Delete the six now-dead export methods and constants (§3.6), and replace the `ownerAuditReads` export-read cases with "the export route reads no audit rows". Or keep them in place, unused, until DE-2? | Delete |
| **Q-6** | Should `groups.account.description` already say that agents, billing, credits and activity are not part of the export (one sentence), or wait for the DE-8b README? | Wait for DE-8b; keep DE-1 to one neutral sentence |
| **Q-7** | Disconnected plugin connections (`status = 'disconnected'`, `disconnected_at` set) are exported today. Is that a "soft-deleted row" under SQ-E5 (excluded everywhere), or a status (kept)? | Status, kept; DE-3 can revisit |
| **Q-8** | Location `lib/business-os/data-export/`, with the section registry being the "export section registry" DE-2's `exportClassification.test.ts` cross-checks. OK, or should it sit under `lib/business-os/purge/` next to the descriptors? | `lib/business-os/data-export/` (the purge executor must stay blind to export, §0.3.6) |

---

## 10. SA Review Notes

_SA populates._

### SA workplan review — 2026-10-14

**Reviewed by SA — 2026-10-14, against origin/main `5946145d` (this worktree) and the requirement in `neuronforge-export-docs` §0.1, §0.2, §0.3, §0.4, §0.4.1 (§0.4 wins over §0.3).**
**Status:** ✅ **Approved with conditions** (C-1 … C-8 below). No second workplan round needed; the conditions are checked at code review.

#### Architectural fit

| Check | Result |
|---|---|
| Scope vs §0.3.7 / §0.4.1 B DE-1 row | ✅ Drops `subscriptions`, `transactions`, `agent_executions`, `audit_logs` (DX-1a/d) and `agents`, `agent_configurations` (BQ-SA-1). Typed payload, section model, FR-E12 marker, `logAndFlush`, Danger zone via the helper, deliberate re-pin: all present |
| Repository rule (CLAUDE.md rule 1, 4) | ✅ Both remaining reads stay in repositories, keyed on `getUser().id`; no caller-supplied id, no write, so `tenant-isolation-guard` is correctly not triggered |
| Client used by the reads (DE-0b check) | ✅ Verified: `userProfileRepository` and `pluginConnectionRepository` are the default singletons on `supabaseServer` (service role). DE-0b's column grant (authenticated: 13 columns, no `profile_data`) does not affect them, and the route needs **no change for DE-0b**. See C-2: it must stay that way |
| Zod | ✅ N/A: GET with no query, body or path params. No input to validate. If DE-1 adds any query param, Zod is required |
| `any` / rule 6 | ✅ Plan removes the `any`; `Record<string, unknown>` for the profile row is acceptable |
| Logging | ✅ Both touched source files have 0 `console.*` (re-checked). Logs carry ids and counts only |
| Audit | ✅ `logAndFlush(entry, logger, { reason, continues })` matches the signature in `lib/audit/boundedAuditFlush.ts` L187; it never rejects, so it is non-blocking per CLAUDE.md § Audit Trail and closes the DE-0a WC-7 note |
| No DB change, no dependency, no new route | ✅ No migration, no `business-os-schema-check` new-column claim; §7 probe recorded |
| Over-engineering | ✅ Proportionate. The registry is the hook DE-2/DE-3 need, not speculative |
| CI time | ✅ Jest only, existing job; suites shrink |

#### Rulings on Q-1 … Q-8

| # | Ruling |
|---|---|
| **Q-1** | **Approved: the minimal change.** DX-10 is now decided (§0.4): the business-name slug, owner-timezone date and `filename*` are DE-8b. DE-1's `agentpilot-data-export-<YYYY-MM-DD>.json` is exactly the §E **fallback** form (with `.json`), and dropping the user id from the file name is a privacy gain. UTC date is accepted for DE-1 (it is §E's NULL-timezone rule); DE-8b moves it to `user_preferences.timezone`. Controller field: replace `data_controller: 'NeuronForge'` as planned, but see C-4 so the key name lines up with §E's `meta.controller` and DE-8b does not rename it again |
| **Q-2** | **Approved: split `account_identity` from `user_profile`.** It is the only way a failed profile read can be visible (FR-E12) while the identity, which cannot fail past the 401, is still present. FR-E12's "200 if the account group was read" therefore always holds in DE-1 |
| **Q-3** | **Changed: remove `plan` in DE-1. Leave `hourly_rate_usd`, `role` and `org_id` to DE-3.** DX-1a (user decision, §0.2) says profile details **only, no plan or billing data**, and DE-1 is the slice that "applies DX-1 to today's JSON". Shipping `profiles.plan` in the slice named "honest current export" would knowingly ship a value the user excluded, and DE-1 already has to re-pin the profile select (`maybeSingle`), so the cost is one column out of `PROFILE_DATA_EXPORT_COLUMNS` plus its doc comment and the pinned literal. The other three are not plan/billing data: `hourly_rate_usd` is the owner's own ROI setting (agent value per hour), `role` and `org_id` are fields held about the person. Whether they belong in a Business-OS-only profile set is DE-3's explicit-column decision; record them there as open (C-6). The schema probe needs no re-run for a removed column, but T1's re-probe uses the final string |
| **Q-4** | **Approved: `.maybeSingle()`.** One caller (verified by grep). No row → section `ok`, 0 rows. Update the repository doc comment (it currently says "A missing row is an error here … the route ignores it"), and the return type becomes `RepositoryResult<Record<string, unknown> \| null>` or equivalent, handled without a cast in the section |
| **Q-5** | **Approved: delete the six methods and the four constants.** Verified: the only callers are the route and `userDataExportReads.test.ts` (and the guard). A purpose-named unused export reader is an invitation to undo DX-1. Also fix the stale comment in `lib/repositories/__tests__/CreditTransactionRepository.test.ts` L6 (`listForUserDataExport is covered by userDataExportReads.test.ts`), which the workplan does not list (C-5). Replace the three `ownerAuditReads` export cases with "the export route reads no audit rows", with a negative control that flags a synthetic route source calling `auditTrailRepository` or naming `audit_trail` |
| **Q-6** | **Approved: wait for the DE-8b README.** One neutral sentence in `groups.account.description`; `format_version: 2` marks the shape change. This is an interim machine file that DE-9 retires |
| **Q-7** | **Approved: a disconnected connection is a status, kept.** SQ-E5 is about soft-deleted rows (rows the owner deleted that we keep). A disconnected `plugin_connections` row is data we still hold about the person's connected account (username, email, profile fields), so excluding it would under-report under Art. 15. DE-2 records this on the descriptor ("status, not soft delete") |
| **Q-8** | **Approved: `lib/business-os/data-export/`.** The purge executor must stay blind to the export (§0.3.6); DE-2's classification test imports this registry, not the other way round |

#### Conditions (checked at code review)

- **C-1 Q-3:** `plan` leaves `PROFILE_DATA_EXPORT_COLUMNS` in DE-1; the repository doc comment says why (DX-1a); the characterization pin's literal select changes with a `DE-1:` comment; a route test asserts the body has no `plan` key under `user_profile`.
- **C-2 Service role only (DE-0b):** every section reader uses the default service-role repository singletons. The cookie-auth `supabase` client is used for `getUser()` only and is **never** passed to a reader. Under DE-0b, `authenticated` cannot read `profile_data`, so a reader on that client would make `plugin_connections` fail. The re-pin keeps "nothing read on the anon client". `sections.ts` is server-only: add `import 'server-only'` if the Jest config already resolves it (it is used in `lib/admin/jobs/`), otherwise a header comment plus the existing browser guard is enough.
- **C-3 FR-E12 never leaks:** a `failed` section carries no error text, code or message in the body, and none in the audit `details`. `runExportSections` catches throws. The repository's own `logger.error` stays the only place the reason is recorded.
- **C-4 Controller key:** `groups.account` carries `controller: 'AgentPilot'` next to `gdpr_role: 'controller'`, matching §E's `meta.controller` per group. `provider: 'AgentPilot'` at the top level is fine as well; choose one name for the provider and keep it in DE-8b.
- **C-5** Stale comment in `CreditTransactionRepository.test.ts` L6 fixed, and every header comment that names a deleted method (`route.ts`, `AuditTrailRepository.ts`, `UserSubscriptionRepository.ts` L66–69, `CreditTransactionRepository.ts`) rewritten. `grep -rn "ForUserDataExport\|listOwnerEntriesForExport"` afterwards finds only the two kept methods, their tests and the route.
- **C-6 Requirement notes for later slices** (written at T14, see housekeeping): DE-3 decides `hourly_rate_usd`, `role`, `org_id` explicitly. DE-8b: **`business_profiles.business_name` does not exist (42703, §7 probe)**; DE-8b's workplan must find the real business-name column with `business-os-schema-check` before writing the slug. DE-2: `plugin_connections` disconnected rows = status (Q-7).
- **C-7 Re-pin discipline:** the characterization diff is reviewed on its own at code review. Every changed expectation carries `DE-1:`; the exact-text body pin stays exact; the "six removed tables are never read" assertion is new and required; the DE-0a token-free test is unchanged byte for byte.
- **C-8 T13:** `git diff --numstat` per file; deletions only in the six removed methods/constants, the dropped test cases, the route body and the replaced comments. Any file with deletions and no insertions where none was planned is a stop (truncation hazard).

#### Housekeeping ruling for T14

The requirement is not on main yet (docs PR #384). **No requirement edits in DE-1 until #384 merges.** Then merge `origin/main` into `feature/data-export-de1` (merge, not rebase; never `git stash`) and record DE-1's status, the Q-3 ruling, the AC-E7 note (BD-26 half moot: the audit section leaves under §0.3.1) and the C-6 notes in the requirement on this branch. Until then T14 sets the workplan to Code Complete and notifies TL only.

#### Business decision needed

None blocking. The Q-3 change applies the user's own DX-1a decision (no plan data). One point for TL to tell the user in business terms: from DE-1, someone who uses only the agent platform downloads a much smaller file (account details and connected apps only, no agents, runs or credits) until the DE-8b README explains it. The user already decided this (BQ-SA-1, DX-1), so nothing needs to be asked.

### Approval
[x] Workplan approved with conditions C-1 … C-8: proceed to implementation

### SA code review DE-1 — 2026-10-15

**Code Review by SA — 2026-10-15**, worktree `neuronforge-de1`, branch `feature/data-export-de1` (HEAD `7a63446a`, includes origin/main after #384), uncommitted diff + untracked files.
**Status:** ✅ **Code Approved for QA.** No blocking item. Targeted re-run by SA: 16 suites, 189/189 green (route + characterization, sections, userDataExportReads, ownerAuditReads.guard, AuditTrailRepository, CreditTransactionRepository + webhook, downloadUserDataExport, all of `components/business-os/purge`).

#### Conditions

| # | Result |
|---|---|
| **C-1** `plan` out | ✅ Removed from `PROFILE_DATA_EXPORT_COLUMNS` with the DX-1a reason in the doc comment; pinned literal changed with `DE-1:`; `route.test.ts` asserts no `plan` key and no `"plan"` text, and the mock honours the select (D-4), so it is a real test. `userDataExportReads` asserts `hourly_rate_usd` / `role` / `org_id` still present (DE-3) |
| **C-2** service role only | ✅ Both readers use the default singletons (`supabaseServer`); the cookie client is used for `getUser()` only and never reaches `runExportSections`. `sections.ts` has `import 'server-only'` (Jest maps it). Only importer is the route. "Nothing read on the anon client" kept in both suites |
| **C-3** no leak | ✅ `SectionReadResult` `{ ok: false }` carries no reason by type; throws are caught in `runOne` and logged `{ err, sectionId }`. Characterization asserts error text and code absent from body and from audit `details` |
| **C-4** controller key | ✅ `groups.account = { gdpr_role, controller: 'AgentPilot', description }`; top-level `provider` from the same `EXPORT_PROVIDER_NAME` constant. Keep both names in DE-8b |
| **C-5** stale comments | ✅ All named comments rewritten (route header, `AuditTrailRepository`, `UserSubscriptionRepository` `BILLING_SUMMARY_COLUMNS`, `CreditTransactionRepository` header + test L6, `PluginConnectionRepository`) |
| **C-6** requirement notes | ✅ §0.5 + notes inserted (31/0) |
| **C-7** re-pin discipline | ✅ with D-1 accepted (below). Every changed expectation in the pin carries `DE-1:`; exact-text body pin kept (`JSON.stringify(expectedBody(...), null, 2)`); `it.each(REMOVED_TABLES)` "never reads %s, on any client" present |
| **C-8** numstat | ✅ Deletion-only files are exactly the three planned (`AgentRepository` 0/49, `ExecutionRepository` 0/47, `AgentConfigurationRepository` 0/33); hunks checked, only the methods + constants. No file blanked |

#### Rulings

- **D-1 vs C-7: accepted.** Only the two accessor lines changed (`body.plugin_connections` → `sectionOf(body, 'plugin_connections').rows`), forced by the shape change. Seed, the 7 forbidden keys and the 7 forbidden secrets are byte-identical to `HEAD`. The token-free assertions still run against the **whole raw response text** (`expect(text).not.toContain(...)`), so the test still fails if a token appears anywhere in the body, under any section or key. `sectionOf` also throws if the section is missing, so the test cannot pass vacuously. At least as strong as before.
- **ownerAuditReads.guard: accepted, BD-26 coverage unchanged.** The three removed checks guarded only the deleted `listOwnerEntriesForExport`. What enforces BD-26 is untouched: the allow-list scan (any `audit_trail` literal outside the allow-list fails), the stale-entry and not-blind checks, the "names audit_trail even with both exclusions" negative control, and `AuditTrailRepository.test.ts`, which pins both exclusions on `listOwnerEntries` (re-run, green). The new `routeReadsNoAuditRows` has four negative controls (repository call, table name, comment-only, the `logAndFlush` write). See S-1 for one gap in scope.
- **Deletions: no other caller.** Whole-repo grep (`.ts/.tsx/.js/.mjs/.cjs/.json/.sql`, incl. `scripts/`, `app/`, `lib/`, `components/`, `hooks/`, `tests/`; excluding `node_modules`, `.next`, `.claude` worktrees) for the six methods and five constants finds only the two kept methods (`UserProfileRepository.findForUserDataExport`, `PluginConnectionRepository.listForUserDataExport`), their tests, `sections.ts` and one history sentence in the guard header. Import types still used in every trimmed file (no dead import).
- **Security: ✅.** Readers only through service-role repository singletons, every read keyed on `getUser().id` (`.eq('id', …)` / `.eq('user_id', …)`, pinned); no request-supplied id; no error text in body or audit; credentials never selected, `profile_data` allow-listed. Logs carry ids and counts only (pinned: no email in any log field). 500 body unchanged (FU-P2).
- **DE-0b: unaffected.** The export reads with the service role, so the `authenticated` column revoke on `plugin_connections.profile_data` does not apply; no change needed.
- **D-2…D-5: accepted.** `Partial<Record<…>>` is the honest type; real `logAndFlush` in `route.test.ts` plus a mocked one in the pin covers both the contract and the exact entry; the extra `catch` in `DangerZonePanel` can only prevent a false success.
- **D-6:** SA bumped the requirement `Last Updated` to 2026-10-15 (one line).
- Standards: zero `any` and zero `console.*` in `route.ts`, `sections.ts`, `payload.ts`, `DangerZonePanel.tsx`. Zod N/A (GET, no input). No new pattern beyond the approved section registry.

#### Optimisation Suggestions (non-blocking)

- **S-1 (Low)** `routeReadsNoAuditRows` checks only `route.ts`, but reads now live in `sections.ts`. A future `auditTrailRepository.listOwnerEntries(...)` added to a section would not trip it (BD-26 would still hold, since that method applies the exclusions, and the characterization pin's runtime "never reads audit_trail" would catch it). Cheap hardening: run the same check over `lib/business-os/data-export/**`. Can ride DE-2.
- **S-2 (Low)** The route calls `new Date()` three times (payload `export_date`, audit `export_timestamp`, file name). Across midnight UTC the file name date can differ from `export_date`. Take one `now` and pass it to all three. DE-8b reworks the name anyway.

### Code Approved for QA: Yes

## 11. QA Testing Report

_QA populates._

**Manual checks owed (QA, signed in):** (1) `/business-os/settings` → Danger zone → Export: the file is named `agentpilot-data-export-<date>.json` and holds `account_identity`, `user_profile`, `plugin_connections` only, with no token, no agents, no audit rows; the success message shows. (2) Signed out (cookie removed): the Danger zone shows the error message and nothing downloads (QA E4 closed). (3) `/v2/settings` Danger zone: the same, English copy. (4) One `DATA_EXPORTED` row per export in `audit_trail`, with `section_counts` and `failed_sections`.

### QA — DE-1 — 2026-10-15

**Test mode:** full
**Strategy used:** A (unit: section model, payload, Danger zone RTL) + B (route with mocked Supabase, characterization pin, guards) + negative controls (planted in source, restored byte-identical) + a read-only live column probe. E2E is manual (Playwright not installed).
**Focus:** api, security, schema, ui
**Skipped:** browser checks (owed by the user, below). Agent-platform surfaces (`/v2/settings`, `components/settings/SecurityTab.tsx`): no manual check, waived by the user, so items (3) above and the `/v2/settings` half of the list are dropped.
**Input source:** TL prompt

#### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Notes |
|---|---|---|---|
| Six removed sections gone (DX-1a/d, BQ-SA-1) | ✅ | Pass | route.test "holds none of the parts DE-1 removed"; characterization "never reads %s" x6; sections.test registry guard |
| Token-free export (DE-0a) | ✅ | Pass | NC (a) below proves the test bites |
| C-1 `plan` not exported | ✅ | Pass | NC (b) below proves 3 tests bite |
| C-2 service role only, nothing on the anon client | ✅ | Pass | route.test + characterization pin |
| C-3 / FR-E12 / AC-E9: failed section gives 200, `status: 'failed'`, listed in `failed_sections`, no error text in body or audit | ✅ | Pass | characterization `it.each` on both tables, all-failing case, audit-details case; NC (d) for a throwing reader |
| Missing profile row → `ok`, 0 rows (Q-4) | ✅ | Pass | characterization + sections.test |
| Signed out → 401, no read, no audit | ✅ | Pass | both route suites (no session; auth error) |
| AC-E8 production 500 hides details; development shows them | ✅ | Pass | route.test FU-P2 block, characterization pin |
| File name `agentpilot-data-export-YYYY-MM-DD.json`, no user id | ✅ | Pass | characterization headers + sections.test `exportFileName` |
| WC-7 `logAndFlush`; a failing flush still returns 200 | ✅ | Pass | real `logAndFlush` in route.test; mocked and pinned entry in characterization |
| The route reads no audit rows (guard) | ✅ | Pass | NC (c) below, two variants |
| Danger zone: button, no link; success; signed-out; network; helper throws → never a false success; no second download while busy | ✅ | Pass | DangerZonePanel.export.test.tsx (5 cases); `export_success` / `export_error` present in en / es / he and in `FALLBACK_COPY` |
| C-5 stale names | ✅ | Pass | grep finds only the two kept methods, their tests, the section readers and one history sentence in the guard header |
| No `any`, no `console.*` in new / changed source | ✅ | Pass | 0 / 0 in route.ts, sections.ts, payload.ts, DangerZonePanel.tsx |
| Live columns (read-only, zero rows, project `jgccgkyhpwirgknnceoh`, service role) | ✅ | Pass | `profiles` final 17-column string OK; `plugin_connections` 13 columns OK; control: a bogus column gives 42703 |
| No new full-suite failure | ✅ | **Fail** | Bug QA-DE1-1 |
| Business OS Danger zone in the browser | ⚠️ | Owed | M-1 … M-3 below |

#### Issues Found

##### Bugs (must fix before commit)

1. **QA-DE1-1: the new `plan` test trips the tier-literal guard** — File: `app/api/user/data-export/__tests__/route.test.ts` L362 — Severity: **High** (turns the required Jest gate and the BOS Entitlements check red; no product effect).
   - Steps to reproduce: `npm run test:bos-entitlements` (or full `npm test`).
   - Expected: green, as on origin/main `7a63446a` (the same suite passes there).
   - Actual: `lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts` › "has no occurrence outside the config folder that is not baselined" fails with `app/api/user/data-export/__tests__/route.test.ts: 1 (baseline 0)`. The C-1 seed `mockSeeds.profiles = [{ …, plan: 'pro', … }]` holds the literal `'pro'`, which FR-12 forbids outside the entitlements config.
   - Fix for Dev: seed `plan` with a non-tier sentinel (e.g. `'qa-plan-value'`) and assert the sentinel is absent from the body; do not add a baseline entry. Re-run `npm run test:bos-entitlements`.

##### Performance Issues (should fix)

None.

##### Edge Cases (nice to fix)

1. Three `new Date()` calls in one request (file name vs `export_date` can differ across midnight UTC). Same finding as SA **S-2**; not a separate item.

#### Negative controls (each restored; md5 of every planted file and `git diff --numstat` identical to before)

| # | Plant | Result |
|---|---|---|
| a | `access_token: conn.access_token` added to the `plugin_connections` mapping in `sections.ts` | 5 tests fail, including the DE-0a token-free test and 4 characterization body pins ✅ |
| b | `plan` re-added to `PROFILE_DATA_EXPORT_COLUMNS` | 3 fail: `userDataExportReads` "does not select plan", route.test "never exports profiles.plan", characterization "query chain on profiles" ✅ |
| c1 | `await auditTrailRepository.listOwnerEntries(user.id, {})` in the route | guard "the data export route reads no audit rows at all" fails ✅ |
| c2 | `const auditTable = 'audit_trail'` in the route | that case plus "no file outside the allow-list names the table" fail ✅ |
| d | `userProfileSection.read` throws `QA-PLANTED-THROW`, checked by a temporary QA probe test (removed after) | Unplanted, the probe fails (control). Planted, it passes: 200; `user_profile` `failed` with `row_count: 0, rows: []`; `account_identity` ok; `failed_sections: ['user_profile']`; the text absent from the body and the audit entry; logged at `error` with `{ err, sectionId }`; no "Data export failed" ✅ |

#### Test Outputs / Logs

| Run | Result |
|---|---|
| Targeted (§6.5 list + `adminReadMethods.guard`) | 17 suites, 235/235 pass |
| `npm run test:authz-guard` | 2 suites, 203/203 pass |
| `npm run test:bos-entitlements` | 266/267 suites, 7,956/7,957 tests: **1 fail = QA-DE1-1** |
| Full `npm test` (worktree) | 1,377 suites: 1,351 pass, 18 fail, 8 skipped. 33,524 tests: 33,327 pass, 132 fail, 65 skipped |
| Baseline: the same 18 suites on an export of origin/main `7a63446a` | 17 fail identically (131 tests: v4 / v6 compiler and translator, pilot StructuredTransforms / ConditionalEvaluator, orchestration TokenBudgetManager / IntentClassifier, `finance.source.guard` CRLF, `oneAddressPolicy.guard`, `bookingsSearchAndPaging.guard`, `heldPaymentOffer.admin`, `supabaseFetch`, `publicEndpointsAreThrottled.guard`): pre-existing. **1 passes on main and fails here: `tierLiteral.forbidden` → QA-DE1-1** |

#### Manual checks owed (user, Business OS only)

| # | Where | Check |
|---|---|---|
| M-1 | `/business-os/settings` → Danger zone → Export Data, signed in | A file `agentpilot-data-export-<today>.json` downloads; it holds only `account_identity`, `user_profile`, `plugin_connections`; no `plan`, no token, no agents, credits or audit rows; the button shows a spinner while busy, then "Data exported successfully!" (Hebrew / Spanish copy when that language is set) |
| M-2 | Same screen, after signing out in another tab, then click | The error message shows and nothing is saved |
| M-3 | `/admin` audit view or SQL | One `DATA_EXPORTED` row per export, with `section_counts` and `failed_sections: []` |

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **QA-DE1-1 (High, test-only fix)**. Everything else passes. After the fix: re-run `npm run test:bos-entitlements` and the §6.5 list (QA re-check of that one suite is enough).

## 12. Commit Info

_RM populates. Dev does not commit._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (Dev, workplan only) | DE-1 plan against origin/main `5946145d`: 6 sections removed (DX-1, BQ-SA-1), section model with FR-E12 `failed`, typed payload, `logAndFlush`, Danger zone via the shared helper, deliberate re-pin. Live column probe recorded (§7). 8 SA questions |
| 2026-10-14 | SA workplan review | Approved with conditions C-1…C-8. Q-3 changed: `profiles.plan` leaves in DE-1 (DX-1a); the rest of Q-1…Q-8 at the Dev default. Requirement updates wait for docs PR #384 |
| 2026-10-15 | Code Complete (Dev) | T1…T14 done, uncommitted. origin/main merged after #384. Deviations D-1…D-6 and results in §5.1. Requirement §0.5 written |
| 2026-10-15 | QA (full) | 1 High bug (QA-DE1-1: `'pro'` literal in route.test trips `tierLiteral.forbidden`); 4 negative controls bite; full suite otherwise matches origin/main; live probe OK; 3 Business OS manual checks owed |

**QA-DE1-1 fixed — 2026-10-15 (TL).** `route.test.ts` C-1 seed uses the sentinel `'qa-plan-value'` (not a tier name) and asserts it never reaches the body; no baseline entry added. `tierLiteral.forbidden` passes. SA S-2 also applied: one `exportedAt` clock reading feeds the payload, the audit `export_timestamp` and the file name. Re-run: 5 suites, 58/58 pass. SA S-1 (scan `lib/business-os/data-export/**` for audit reads) carried to DE-2.
