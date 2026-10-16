# Workplan: Business OS data export, DE-6: intake, leads and consent

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md): §0.2 (DX-1b, DX-1d, DX-8), §0.3.1 (client records incl. intake and consent; `email_sends` out), §0.3.7 (DE-6 row), §0.4 / §0.4.1, §0.6, §0.7 (DE-4 repository E-1…E-6, BC-4 `source_metadata` allow-list), §0.8, §0.9 (DE-5 `pickStringKeys`); §3.1 group B4
**Branch:** `feature/data-export-de6` (worktree `neuronforge-de6`, from origin/main `98735db9`, which holds DE-1 #393, DE-2 #402, DE-4 #419, DE-3 #432 and DE-5 #438)
**Date:** 2026-10-16
**Status:** SA code-approved + QA PASS 2026-10-16; committed by RM

## Overview

DE-6 adds the business's **intake forms, email marketing, newsletter audience and consent records** to "Download my data". These are the 12 tables DE-2 left `planned('DE-6')` in `lib/business-os/purge/descriptors.ts`. This workplan proposes **10 `include`** (explicit columns, a reason for every column left out) and **2 `exclude`** (with reasons). It reuses the DE-4 / DE-3 / DE-5 pattern: one descriptor per table, one section per table, every read through `BusinessDataExportRepository.listOwnedRowsForExport`, keyed on the session user id, paged to the end, inside the Phase 1 row ceiling. jsonb cells with visitor tracking in them go through the DE-5 `pickStringKeys` allow-list.

**One addition to the reader, for SA (SA-Q1).** `marketing_consent_settings` has **no `id` column**: its primary key is `user_id` (migration `20260930_marketing_consent.sql`). The repository pages by `id` and fails such a table closed today. This plan revives the DE-3 SA-Q1 (a) design, which SA left moot in DE-3 because it was not needed then: an optional `rowKey: 'user_id'` on the `include` classification, read as one `.eq('user_id', id).limit(2)` query that fails closed on more than one row. It stays inside E-1…E-6. If SA declines, the table is `exclude`d instead (business call BC-7 tells the user what that loses).

**What is in, in plain terms.** The questions the owner asks clients (every version), the intake on/off settings, the email campaigns and sequences the owner wrote, which clients are in which sequence, the newsletter sign-up list, the do-not-email list, and the **consent record**: who agreed to marketing email, to which exact wording, in which language and version, when, how and on which form; and who withdrew. **Out:** the scrambled IP, its salt, the browser signature and the visit id stored as technical consent evidence (BC-1); the queue of automatic invitations and reminders sent to leads (activity, BC-2); open / click / sent counters (activity, BC-3); the AI-generation details of an intake form (BC-4).

**Client answers to intake forms are already in the file.** They live in `scheduling_bookings.intake_responses` and `intake_completed_at`, exported by DE-4 in the `bookings` section (each answer set carries `form_id`, `version` and its own question snapshot). DE-6 adds the forms themselves, so an answer can be read against the version of the form it was given to.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. The 12 tables: proposals](#3-the-12-tables-proposals)
- [4. JSON columns](#4-json-columns)
- [5. Consent proof: which columns prove what](#5-consent-proof-which-columns-prove-what)
- [6. Files to Create / Modify](#6-files-to-create--modify)
- [7. Task List](#7-task-list)
- [8. Tests](#8-tests)
- [9. CI placement and runtime](#9-ci-placement-and-runtime)
- [10. Risks](#10-risks)
- [11. Live schema verification (SQL for TL)](#11-live-schema-verification-sql-for-tl)
- [12. Open questions for SA](#12-open-questions-for-sa)
- [13. Business calls (for the user, via TL)](#13-business-calls-for-the-user-via-tl)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What DE-6 touches

| Area | Today (origin/main `98735db9`) | After DE-6 |
|---|---|---|
| Descriptors | 12 rows `planned('DE-6')` (`descriptors.ts` §3.6 Email automation lines 890–906, §3.7 Intake lines 910–911, `lead_responses` line 978) | 10 × `include` with `columns` + `excludedColumns`; 2 × `exclude` with reasons. `level`, `order`, `scope`, `snapshot`, `area` and `notes` unchanged on all 12 |
| Classification count | 155 = 23 include + 17 planned (DE-6: 12, DE-7: 5) + 115 exclude | 155 = **33** include + **5** planned (DE-7) + **117** exclude |
| Section ids | 24 (`classificationTypes.ts`) | + 10 (§2.3) |
| Groups | `account` (controller AgentPilot), `client_records` (processor) | unchanged; all 10 new sections in `client_records` / processor (SA-Q2) |
| Reads | 22 tables through `BusinessDataExportRepository`; `profiles` through `UserProfileRepository` (23 selects) | + 9 paged reads through the same method, + 1 single-row read (`rowKey`, SA-Q1). The 23 existing selects are byte-identical |
| Route | `GET /api/user/data-export` runs `EXPORT_SECTIONS` | **unchanged code** |
| Payload | `summary` = section counts, failed sections, size, duration | **unchanged** |
| DB | — | **none** (no migration, no new route, no new dependency, no flag) |

### 1.2 Facts measured in code

Every column claim is ❓ until T-0. Sources: migration bodies (read, not file names), the repositories' row interfaces, and the physical catalog `lib/business-os/catalog/catalog.generated.ts` (live, 2026-09-10), which covers only `business_intake_forms` of the 12.

| # | Fact | Where | Consequence |
|---|---|---|---|
| F-1 | All 12 tables have `user_id uuid NOT NULL`, and every descriptor is `scope: { kind: 'user_id' }`. No DE-6 table is reachable only through a parent | migrations; `descriptors.ts` | Every read is by the table's **own** `user_id` (E-4). No `via` reader is needed |
| F-2 | `marketing_consent_settings`: **no `id`**; `user_id` is the PRIMARY KEY | `20260930_marketing_consent.sql` | The keyset reader fails it closed. SA-Q1 |
| F-3 | `marketing_consent_state`: **no `id`**; PK `(user_id, email_normalized, channel)`. A projection the send gate reads, rebuilt by the `marketing_consent_project()` trigger from every event | same | Derived; exclude (§3.8, SA-Q3, BC-6) |
| F-4 | `marketing_consent_events` is **append-only** (a trigger refuses DELETE and any UPDATE except redaction and the FK's own SET NULL). It holds `ip_hash`, **`ip_hash_salt`**, `user_agent`, `session_id` | same; `lib/consent/recordConsent.ts` | The salt is stored **so the hash can be checked**: hash + salt = a recoverable IP. Both out (BC-1). `ip_hash` is already denied by `/_hash$/`; the salt matches no deny rule today (§2.5) |
| F-5 | `marketing_consent_events.statement_text` is the **server's wording at the moment of consent**, snapshotted per row, with `statement_locale` and `statement_version`. A CHECK forces wording on every grant | `recordConsent.ts` "THE SERVER'S WORDING WINS"; migration CHECK `marketing_consent_grant_has_wording` | The proof of *what* was agreed is self-contained in the event; it does not need the settings table |
| F-6 | `evidence` jsonb is written with exactly three keys by code: `client_statement` (the sentence the visitor's page showed), `confirmed_via` (`email_link` / `confirm_button`), `note` (the owner's typed note, CRM drawer) | `recordConsent.ts:122`, `confirmConsent.ts:96`, `app/api/crm/contacts/[id]/consent/route.ts:157` | Allow-list of those three, strings only (§4, SA-Q4); census Q5 |
| F-7 | `redact()` overwrites `email` with `redacted@invalid`, nulls the tracking columns, stamps `redacted_at` | `MarketingConsentRepository.ts:370` | Redacted rows go out as held (BC-8) |
| F-8 | `recorded_by` is stamped with the owner's own id on owner-entered consent | consent route `recordedBy: user.id` | Out (`ACTOR_ID`, as DE-5 SA-Q15); `method = 'owner_entered'` already says it |
| F-9 | `business_subscribers.attribution` is built by the same `buildAttributionFromRequest` as `crm_contacts.source_metadata` (so it can hold `ip_hash`, `user_agent`, `session_id`) | `app/api/public/newsletter/subscribe/route.ts:119`, `forms/contact/route.ts:157`; the migration backfills it **from** `crm_contacts.source_metadata` | Reuse `SOURCE_METADATA_KEYS` (user BC-4, DE-4) through `pickStringKeys`; no new list |
| F-10 | `lead_responses` is a **durable outbound-message queue** (claim / lease / reaper): invite, chase, invoice_chase, intake_chase, meeting_reminder, meeting_complete, quote_chase; status pending / processing / sent / skipped / failed; `recommendation` jsonb is the recommender's choice | `20260914_lead_responses.sql`, kind widened by 20260916, 20260923, 20261006d, 20261048 | Messages sent = activity (DX-1d), as `payment_reminders` (DE-5 BC-4). Exclude (BC-2). The lead itself (contact, how they found the business) is already in `clients` |
| F-11 | `user_intake_settings` lost `template_id` and `collect_during_booking` (20260910); live shape per the repository: `id, user_id, is_enabled, send_after_booking, created_at, updated_at`; `user_id` UNIQUE | `20260728`, `20260910`, `IntakeRepository.ts:39` | 6 columns ❓ |
| F-12 | `business_intake_forms` (catalog, live 2026-09-10): `id, user_id, version, status, questions, generated_at, generated_from, published_at, created_at, updated_at`. Status draft / published / archived; archived versions are kept **so old answers stay readable** | catalog; migration header | All versions in (BC-4); `generated_from` (`{ source, model, vertical, subVertical, serviceIds }`) out |
| F-13 | Email tables: counters `total_sent/opened/clicked` (sequences), `sent/opened/clicked_count` (steps), `recipients/sent/opened/clicked/failed_count` (campaigns) are delivery statistics; `email_sequence_enrollments.next_send_at` is the next scheduled send | `20260722_create_email_automation_tables.sql`; `EmailAutomationRepository.ts` | Counters out (BC-3); `next_send_at` out (`QUEUE_STATE`, SA-Q6) |
| F-14 | No public-link token is stored in any of the 12 tables: the double-opt-in and unsubscribe links are stateless signed JWTs (`lib/consent/confirmToken.ts`) | code | Nothing to exclude for tokens; Q7 confirms by column-name census |
| F-15 | `smart_links` (and its `code`) is DE-7, not DE-6; `smart_link_clicks` is already `exclude` (visitor tracking) | `descriptors.ts:935–936` | Not in this slice |
| F-16 | `email_unsubscribes` is now **derived** by trigger from the consent ledger (the email-channel mirror) and kept by both purge levels (D8). It has an `id` PK | migration; descriptor notes | Include: it is the owner's do-not-email list, the one a new email tool needs |
| F-17 | Generated columns: `email_normalized` on `marketing_consent_events` and `business_subscribers` (`lower(btrim(email))`) | migrations | Out (`DERIVED_COPY`); `email` is in |

### 1.3 Live schema status

Not measured by Dev (no DB access in this worktree). §11 is the read-only SQL for TL. **Gate:** no descriptor is written before Q1, Q3 and Q7 are back.

---

## 2. Implementation Approach

### 2.1 Reuse, not new

- **Descriptors:** 10 `const …_EXPORT: TableExportClassification` blocks in a new `── DE-6: intake, email marketing and consent ──` block after the DE-5 block. New repeated reasons go in `EXPORT_COLUMN_REASON` / `EXPORT_REASON` (named, not retyped: DE-4 SA-Q4). The 12 `planned('DE-6')` calls are replaced; nothing else on those rows changes.
- **Sections:** `clientRecordsSection(id, mapRow?)` for all 10 (exists). Two mappers, both one line through the existing `pickStringKeys`: `subscriberRow` (`attribution` → `SOURCE_METADATA_KEYS`, reused unchanged) and `consentEventRow` (`evidence` → new `CONSENT_EVIDENCE_KEYS`).
- **Repository:** `listOwnedRowsForExport` unchanged for the 9 tables with an `id`. One new branch, only if SA-Q1 (a): a descriptor with `rowKey: 'user_id'` is read once, not paged (§2.6).
- **Ceiling, paging, failed sections, audit, logging:** unchanged. The new sections draw on the same `maxRows` budget.

### 2.2 Include, exclude: the rule used

| In | Out |
|---|---|
| What the owner wrote: intake questions (every version), campaign and sequence wording, segment filters, consent wording, privacy notice, postal address | AI provenance of a generated form (model name, inputs) |
| Who is on which list: subscribers (any status), sequence enrollments, the do-not-email list | Delivery statistics: sent / opened / clicked / failed counters (activity, DX-1d) |
| The consent record: decision, channel, purpose, method, exact wording, locale, version, privacy notice link, form and page, owner's note, when; redacted rows as held | Technical evidence that tracks a visitor: `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id` (BC-1; DE-4 BC-4) |
| Status and lifecycle dates of the owner's documents (a campaign's `status`, `scheduled_at`, `sent_at`, as DE-5 BC-7 for invoices) | Queues and their machinery: `lead_responses` whole, `next_send_at` |
| | Derived copies: `marketing_consent_state`, `email_normalized` |
| | `user_id` everywhere (`OWNER_ID`); `recorded_by` (`ACTOR_ID`) |

### 2.3 Sections, order and group

Plain words, because DE-8b names each CSV after its section (DE-4 SA-Q3). All `client_records` / processor (SA-Q2), appended after `client_payment_methods` in this order:

| Section id | Table | Note |
|---|---|---|
| `intake_settings` | `user_intake_settings` | one row per owner |
| `intake_forms` | `business_intake_forms` | every version and status |
| `email_campaigns` | `email_campaigns` | |
| `email_sequences` | `email_sequences` | |
| `email_sequence_steps` | `email_sequence_steps` | read by its own `user_id`, never via `sequence_id` |
| `email_sequence_enrollments` | `email_sequence_enrollments` | read by its own `user_id` |
| `newsletter_subscribers` | `business_subscribers` | `attribution` allow-listed |
| `consent_records` | `marketing_consent_events` | `evidence` allow-listed |
| `consent_settings` | `marketing_consent_settings` | single-row read (SA-Q1); dropped if SA declines |
| `email_unsubscribes` | `email_unsubscribes` | the do-not-email list |

`format_version` stays 2 (additive). `payload.ts` needs no change: the `client_records` group description already fits.

### 2.4 Tenant isolation (tenant-isolation-guard)

Read-only, service role, so RLS does not protect these reads (repository E-5). DE-4's rules, unchanged:

- The only id is `ctx.userId = getUser().id`. The route takes no input; the existing test proving a planted `?userId=` and `x-user-id` are ignored is extended to the 10 tables.
- First filter on every query, paged or single-row: `.eq('user_id', ctx.userId)`.
- **Child tables are read by their own `user_id`**, never by following a parent id: steps are not read "for my sequences", enrollments not "for my sequences", consent events not "for my contacts". A crossed pointer (`sequence_id`, `contact_id`, `promoted_contact_id`, `last_event_id`) can therefore only carry a foreign uuid in a cell, never a foreign row. Q9 measures every parent / child edge for crossed owners (expected 0); a non-zero edge goes to SA as a data-integrity finding, not as an export change.
- **Nothing in DE-6 is reachable only through a parent** (F-1), so E-2's "a `via` table needs its own parent-scoped reader" does not arise. `marketing_consent_state` has its own `user_id` too; it is out for being derived (§3.8), not for reachability.
- No find-by-id, no caller-supplied entity id, no write, trigger, upsert or rpc (E-1, scanned by the existing repository test).
- Consent events **outlive the contact** (`contact_id` SET NULL) and are kept by both purge levels. They are still owned by `user_id`, so the export reads exactly the owner's ledger, including rows whose contact is gone.

### 2.5 Deny list

The proposed `columns` in §3 match no exact entry and no pattern of the deny list. Hits on these tables are **excluded, not excepted**: `marketing_consent_events.ip_hash` (`/_hash$/`). `DENY_EXCEPTIONS` stays at one entry.

**Proposed hardening (SA-Q5; no runtime cost, no hit on any current include, checked by grep of `descriptors.ts`):** add a visitor-tracking line to `SECRET_COLUMN_DENY_EXACT`: `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint`; and the pattern `/_salt$/` to `SECRET_COLUMN_DENY_PATTERNS`. Today `ip_hash_salt`, `user_agent` and `session_id` are kept out only by review; this makes a later review mistake fail CI and fail the section at request time. The constant's comment widens from "secrets" to "secrets and visitor tracking" (BD decisions); the name is unchanged so no import moves.

### 2.6 The single-row read (only if SA-Q1 (a))

- `classificationTypes.ts`: `include` gains optional `rowKey?: 'user_id'`. The literal type admits nothing else.
- `classification.ts` `tableExportProblems`: `rowKey` present ⇒ it is `'user_id'`, the descriptor's `scope.kind` is `user_id`, `user_id` is **not** in `columns` (it is `OWNER_ID`), and there is no `rowFilter`. Without `rowKey`, the existing "needs `id`" rule stands.
- `BusinessDataExportRepository.listOwnedRowsForExport`: if `rowKey === 'user_id'`, one query `from(table).select(columns).eq('user_id', userId).limit(2)`; 0 rows → `ok`, empty; 1 → `ok`; **2 → fails closed** (`{ error }`, section `failed`), because a PK on `user_id` makes 2 impossible and a 2 means the classification is wrong. The row counts against `maxRows` like any other. No `.order`, no `.gt`. E-1…E-6 unchanged; the header comment states the branch.
- Live proof that `user_id` is unique comes from Q3 (PK). The test pins 0 / 1 / 2.

### 2.7 Logging and audit

Unchanged: the repository's existing lines (section, table, user id, pages, rows; never content, emails or wording). `DATA_EXPORTED` gains 10 section counts through the generic `sectionCounts` (counts only).

---

## 3. The 12 tables: proposals

❓ = to be confirmed by Q1. "In" = in `columns`, in this order. "Out" = in `excludedColumns` with the reason shown. Every table's `user_id` is Out with `OWNER_ID` and not repeated below. Reason names in `CAPS` are constants (existing or new, §6). **No DE-6 table gets a `rowFilter`**: none soft-deletes (Q10 confirms), and every status is history (DX-8).

### 3.1 `user_intake_settings` → `intake_settings` (expected 6 ❓)

| | Columns |
|---|---|
| **In (5)** | `id`, `is_enabled`, `send_after_booking`, `created_at`, `updated_at` |
| **Out (1)** | `user_id` (`OWNER_ID`) |

### 3.2 `business_intake_forms` → `intake_forms` (expected 10, live 2026-09-10)

| | Columns |
|---|---|
| **In (8)** | `id`, `version`, `status`, `questions`, `generated_at`, `published_at`, `created_at`, `updated_at` |
| **Out (2)** | `user_id` (`OWNER_ID`); `generated_from` (`GENERATION_METADATA`: "how the assistant built the form (model, inputs); not something the owner entered (as DE-4 BC-7)") |

Every status in: `draft`, `published`, `archived` (BC-4). `questions` travels whole (§4). `generated_at` stays: it tells the owner the form was generated, without the model name.

### 3.3 `email_campaigns` → `email_campaigns` (expected 17 ❓)

| | Columns |
|---|---|
| **In (11)** | `id`, `name`, `subject`, `body_html`, `body_text`, `segment_filter`, `status`, `scheduled_at`, `sent_at`, `created_at`, `updated_at` |
| **Out (6)** | `user_id` (`OWNER_ID`); `recipients_count`, `sent_count`, `opened_count`, `clicked_count`, `failed_count` (`DELIVERY_STATS`: "DX-1d: how many emails went out, opened or were clicked is activity (user BC-3)") |

`sent_at` / `status` are the campaign's own lifecycle, as DE-5 BC-7 kept invoice sent dates (BC-3 confirms).

### 3.4 `email_sequences` → `email_sequences` (expected 12 ❓)

| | Columns |
|---|---|
| **In (8)** | `id`, `name`, `description`, `trigger_type`, `trigger_config`, `is_active`, `created_at`, `updated_at` |
| **Out (4)** | `user_id`; `total_sent`, `total_opened`, `total_clicked` (`DELIVERY_STATS`) |

### 3.5 `email_sequence_steps` → `email_sequence_steps` (expected 12 ❓)

| | Columns |
|---|---|
| **In (8)** | `id`, `sequence_id`, `step_number`, `delay_minutes`, `subject`, `body_html`, `body_text`, `created_at` |
| **Out (4)** | `user_id`; `sent_count`, `opened_count`, `clicked_count` (`DELIVERY_STATS`) |

### 3.6 `email_sequence_enrollments` → `email_sequence_enrollments` (expected 9 ❓)

| | Columns |
|---|---|
| **In (7)** | `id`, `sequence_id`, `contact_id`, `status`, `current_step_number`, `enrolled_at`, `completed_at` |
| **Out (2)** | `user_id`; `next_send_at` (`QUEUE_STATE`: "when the next email is scheduled to go: sending machinery, not a record (SA-Q6)") |

All statuses (`active`, `paused`, `completed`, `cancelled`) in. §0.3.1 names this table "which client is in which sequence": that is `sequence_id`, `contact_id`, `status`, `enrolled_at`, `completed_at`.

### 3.7 `email_unsubscribes` → `email_unsubscribes` (expected 6 ❓)

| | Columns |
|---|---|
| **In (5)** | `id`, `contact_id`, `email`, `reason`, `unsubscribed_at` |
| **Out (1)** | `user_id` |

`reason` holds the consent `method` that caused it (written by the projection trigger) or, on legacy rows, whatever was recorded; Q6 checks for free text (counts only).

### 3.8 `marketing_consent_state` → **exclude**

Reason: `exclude(EXPORT_REASON.CACHE, "the current consent per address, rebuilt by trigger from marketing_consent_events, which is exported whole as consent_records; no id column to page on (BC-6)")`. Nothing is lost: the current answer per address is the latest event for it (a withdrawal wins a tie), the email channel's current opt-outs are `email_unsubscribes`, and the newsletter roster's status is `newsletter_subscribers.status`. DE-8b's README says how to read the current state (§10, R-6). Q11 proves the state is derivable on live rows.

### 3.9 `marketing_consent_events` → `consent_records` (expected 24 ❓)

| | Columns |
|---|---|
| **In (17)** | `id`, `contact_id`, `email`, `channel`, `purpose`, `decision`, `method`, `statement_text`, `statement_locale`, `statement_version`, `privacy_policy_url`, `source_surface`, `source_page_url`, `evidence`, `redacted_at`, `occurred_at`, `created_at` |
| **Out (7)** | `user_id` (`OWNER_ID`); `email_normalized` (`DERIVED_COPY`: "generated lower-case copy of email"); `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id` (`VISITOR_EVIDENCE`: "a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (user BC-1; as DE-4 BC-4)"); `recorded_by` (`ACTOR_ID`) |

`evidence` goes through `CONSENT_EVIDENCE_KEYS` (§4). Every decision (`granted`, `withdrawn`), every method, every channel, and redacted rows are in. Why these columns prove consent: §5.

### 3.10 `marketing_consent_settings` → `consent_settings` (expected 14 ❓; SA-Q1)

| | Columns |
|---|---|
| **In (13)** | `capture_enabled`, `statement_en`, `statement_es`, `statement_he`, `statement_version`, `privacy_policy_mode`, `privacy_policy_url`, `privacy_policy_body`, `privacy_policy_updated_at`, `postal_address`, `label_as_advertisement`, `created_at`, `updated_at` |
| **Out (1)** | `user_id` (`OWNER_ID`; also the row key, `rowKey: 'user_id'`) |

No `id` column exists, so `id` is not listed. If SA declines SA-Q1 (a): `exclude`, reason "no id column for the keyset reader; each consent record carries the wording it was given against (SA DE-6)", and BC-7 tells the user the privacy notice text is then not in the file.

### 3.11 `business_subscribers` → `newsletter_subscribers` (expected 14 ❓)

| | Columns |
|---|---|
| **In (12)** | `id`, `email`, `name`, `status`, `source`, `attribution`, `subscribed_at`, `confirmed_at`, `promoted_contact_id`, `promoted_at`, `created_at`, `updated_at` |
| **Out (2)** | `user_id`; `email_normalized` (`DERIVED_COPY`) |

All statuses in, `pending` included (BC-5). `attribution` → `SOURCE_METADATA_KEYS` via `pickStringKeys` (§4).

### 3.12 `lead_responses` → **exclude**

Reason: `exclude(EXPORT_REASON.ACTIVITY, 'queued and sent automatic messages to leads and clients (invitations, chases, reminders) with their claim / lease columns: messages sent are activity (user BC-2; as payment_reminders, DE-5 BC-4)')`. The lead themself, and how they found the business, are in `clients` (DE-4). The descriptor's existing purge note ("Lead data is customer data") is about Reset, not the export, and is left as it is.

If the user overrides BC-2 (in): `id, contact_id, kind, entity_id, status, service_id, skip_reason, sent_at, created_at` in; `recommendation` (`ASSISTANT_OUTPUT`), `claimed_by`, `claimed_at`, `attempts`, `next_attempt_at` (`QUEUE_STATE`), `error_message` (delivery log) out.

---

## 4. JSON columns

| Column | Proposal | Why |
|---|---|---|
| `business_intake_forms.questions` | **Whole** (array of `IntakeQuestion`: `id, label, help, type, required, options[{id,label}], allowOther, maxFiles, showIf{questionId,equals}`) | The owner's own form; no tracking or secret keys by type. Q5 census confirms no extra key; any unexpected key goes to SA before code |
| `email_campaigns.segment_filter` | **Whole** | The owner's audience filter (`tags`, `stage`, …). Q5 census |
| `email_sequences.trigger_config` | **Whole** | The owner's trigger settings (`{ tag }`, `{ source: 'website' }`). The API accepts any keys (`z.record(z.any())`), so Q5 census decides: if a key looks like tracking or a secret, SA-Q4 turns it into an allow-list |
| `business_subscribers.attribution` | **Allow-list = `SOURCE_METADATA_KEYS`** (the user's DE-4 BC-4 list, reused unchanged) via `pickStringKeys` | Same builder as `crm_contacts.source_metadata` (F-9): it can carry `ip_hash`, `user_agent`, `session_id`, `smart_link_id`. One list for one shape |
| `marketing_consent_events.evidence` | **Allow-list = new `CONSENT_EVIDENCE_KEYS = ['client_statement', 'confirmed_via', 'note']`**, strings only, via `pickStringKeys` | The three keys code writes (F-6). Each is consent proof or the owner's note. Any other key is dropped |
| `business_intake_forms.generated_from` | **Out** whole | Model name and generation inputs (BC-4) |

CSV (DE-8b): jsonb cells as JSON text in one cell (DE-4 rule); the two allow-listed cells are already flat string maps.

---

## 5. Consent proof: which columns prove what

The consent record is the owner's legal answer to "did this person agree, to what, and when?" (and to a complaint or a subject access request years later). Each part of that answer and the column that carries it:

| Question | Column(s) in the file |
|---|---|
| Who | `email` (and `contact_id` while the contact exists; the ledger is keyed by address, so it survives the contact) |
| Agreed or withdrew | `decision` |
| To what | `statement_text` (the server's wording at that moment, F-5), `statement_locale`, `statement_version`, `purpose`, `channel` |
| Under which privacy notice | `privacy_policy_url` (the link shown). The hosted notice's **text** is only held in its current version (`consent_settings.privacy_policy_body`, `privacy_policy_updated_at`); earlier versions are not stored anywhere (R-5) |
| How | `method` (`web_form`, `double_optin_confirm`, `owner_entered`, `unsubscribe_link`, `list_unsubscribe`, `imported`, `reply_stop`, `legacy_unsubscribe_import`); `evidence.confirmed_via` for double opt-in |
| Where | `source_surface` (which form), `source_page_url` (which page) |
| What the visitor's page showed, if it differed | `evidence.client_statement` |
| When | `occurred_at` (the decision time), `created_at` (when we recorded it) |
| Owner-entered context | `evidence.note` |
| Erased later | `redacted_at` (the address is then `redacted@invalid`, as held) |

**What is left out and what that costs (BC-1):** `ip_hash` + `ip_hash_salt` let someone check the stored hash against a known IP (that is why the salt is stored, F-4), and `user_agent` / `session_id` identify the browser and visit. They strengthen proof that a particular device ticked the box, and they are visitor tracking (DE-4 BC-4 left the same data out of `clients`). They stay in AgentPilot's records (the ledger is never purged), so a specific complaint can still be answered from them through support. The file proves the wording, the time, the method and the place without them.

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | 10 `include` consts (§3), 2 `exclude`; new reason constants `DELIVERY_STATS`, `QUEUE_STATE`, `GENERATION_METADATA`, `VISITOR_EVIDENCE`, `DERIVED_COPY`, `ACTOR_ID` (reuse DE-5's if it already exists as a constant); the 12 `planned('DE-6')` replaced, nothing else on those rows |
| `lib/business-os/data-export/classificationTypes.ts` | modify | 10 section ids; `rowKey?: 'user_id'` on `include` (SA-Q1 (a) only) |
| `lib/business-os/data-export/classification.ts` | modify | `rowKey` shape check in `tableExportProblems` (SA-Q1 (a)); deny-list hardening (SA-Q5) |
| `lib/business-os/data-export/sections.ts` | modify | 10 registry entries (§2.3); `CONSENT_EVIDENCE_KEYS` + `consentEvidence()`; `subscriberRow`, `consentEventRow` mappers; header comment |
| `lib/repositories/BusinessDataExportRepository.ts` | modify | Single-row branch (SA-Q1 (a)) + header comment |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | DE-6 block (§8); re-plant the "still planned" controls from `lead_responses` to `smart_links` (DE-7); totals 33 / 5 / 117 |
| `lib/business-os/data-export/__tests__/sections.test.ts` | modify | Registry order, group, role; both allow-lists |
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | modify | New sections resolve; cross-tenant; single-row 0 / 1 / 2 |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin: 33 tables read in order; the 23 existing selects byte-identical; 10 new selects literal; audit counts |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Tracking values never in the body; `lead_responses` / `marketing_consent_state` / `email_sends` never read; planted ids ignored; ceiling |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | New §0.10 "DE-6 status" (decisions, as built, SA rulings), per the always-update-main-requirement rule |
| `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md` | this file | Audit trail |

Not touched: the route, `payload.ts`, `limits.ts`, `lib/consent/*`, the domain repositories (`MarketingConsentRepository`, `BusinessSubscriberRepository`, `EmailAutomationRepository`, `IntakeRepository`, `IntakeFormRepository`, `LeadResponseRepository`), any purge file other than `descriptors.ts`, any migration. No entitlements import (the `business-os-entitlements` skill does not apply; `npm run test:bos-entitlements` is run anyway at T-11 as a no-change check).

---

## 7. Task List

- ✅ T-0 TL runs §11 Q1–Q12 on prod (read-only) and pastes results here. **Gate:** no descriptor is written before Q1, Q3 and Q7
- ✅ T-1 SA workplan review: SA-Q1…SA-Q10; TL takes §13 to the user
- ✅ T-2 Finalise §3 from Q1 (every live column in `columns` or `excludedColumns`, nothing else) and §4 from Q5
- ✅ T-3 `descriptors.ts`: 10 include consts, 2 excludes, reason constants
- ✅ T-4 `classificationTypes.ts`: 10 section ids (+ `rowKey` if SA-Q1 (a))
- ✅ T-5 `classification.ts`: `rowKey` check (SA-Q1 (a)); deny-list lines (SA-Q5)
- ✅ T-6 Repository: single-row branch (SA-Q1 (a)); header comment
- ✅ T-7 `sections.ts`: registry entries, `CONSENT_EVIDENCE_KEYS`, two mappers through `pickStringKeys`
- ✅ T-8 Tests per §8, every negative control shown red once by reverting its rule in memory (mutation check; no stash)
- ✅ T-9 Re-plant the "still planned" negative controls from `lead_responses` to `smart_links` (DE-7)
- 🟡 T-10 Drift check (Dev part done: Q12 in the Dev Notes; TL run owed): Dev fills Q12 with the final declared lists; TL runs it. Expect drift 0, missing 0
- ✅ T-11 Run `npm test -- lib/business-os/data-export lib/repositories/__tests__/BusinessDataExportRepository.test.ts app/api/user/data-export lib/business-os/purge` and `npm run test:bos-entitlements`; record runtimes before / after (§9)
- ✅ T-12 Requirement §0.10 and Dev notes here; changes left **uncommitted** for SA code review and QA (RM commits)

---

## 8. Tests

All Jest, in existing files, in the existing required Jest job.

| # | Test | File | Negative control |
|---|---|---|---|
| N-1 | No `planned('DE-6')` left; the 10 tables are `include` with the §2.3 section ids; the 2 are `exclude` with non-empty reasons; totals 33 / 5 / 117; `bySlice` = `{ 'DE-7': 5 }` | `exportClassification.test.ts` | Re-plan `business_subscribers` → reported |
| N-2 | Column pins (`DE6_PINS`): each `columns` list literal and in order; `columns` ∪ `excludedColumns` = the Q1 set | same | Move `ip_hash_salt` into `columns` → pin red (and deny red if SA-Q5) |
| N-3 | **Visitor tracking never selected:** `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id` are in `excludedColumns` of `marketing_consent_events` and in no select string; with SA-Q5 the deny list rejects each at request time (section `failed`) and in the CI report | same + `BusinessDataExportRepository.test.ts` | Plant `user_agent` in the events `columns` → `denied_column`, section `failed` |
| N-4 | **`evidence` allow-list:** a seeded `evidence` holding `client_statement`, `confirmed_via`, `note`, an `ip` key, a nested object and a number yields exactly the three strings, in list order; NULL / array / string → `{}` | `sections.test.ts` | Widen the list by a pattern or add `ip` → red |
| N-5 | **`attribution` allow-list:** a seeded `attribution` with `ip_hash`, `user_agent`, `session_id`, `smart_link_id` and the BC-4 keys yields only the BC-4 keys; the list **is** `SOURCE_METADATA_KEYS` (identity, not a copy) | `sections.test.ts` | Swap in a copied list with one extra key → red |
| N-6 | **Route body has no tracking value:** seed distinctive values (`IPHASH-XYZ`, `SALT-XYZ`, `UA-XYZ`, `SESS-XYZ`) in events and subscriber attribution; the serialised JSON body contains none of them | `route.test.ts` | Remove `consentEventRow` from the registry → red |
| N-7 | **Never read:** the fake client records every `from()` table; the run's set equals exactly the registry's 33 tables (+ the timezone read); `lead_responses`, `marketing_consent_state`, `email_sends` are never touched even when seeded | `route.test.ts` | Add `lead_responses` to the registry in a planted run → red |
| N-8 | **Cross-tenant:** user A and B rows in all 10 tables, incl. B's step under A's sequence, B's enrollment on A's contact, B's consent event naming A's contact, B's subscriber promoted to A's contact; A's export holds only A's rows, each B row absent although it points at A | `BusinessDataExportRepository.test.ts` | Remove the fake's `user_id` filter → B rows appear, red |
| N-9 | **Single-row read (SA-Q1 (a)):** `consent_settings` with 0 / 1 / 2 rows for the user → ok-empty / ok / `failed`; the query is `.eq('user_id')` then `.limit(2)`, no `.order('id')`, no `.gt`; another user's row is never returned | `BusinessDataExportRepository.test.ts` | `rowKey: 'id'` (cast) → `tableExportProblems` reports it; `user_id` in `columns` with `rowKey` → reported |
| N-10 | **All history:** seeded `draft` / `archived` forms, `pending` / `unsubscribed` / `promoted` subscribers, `withdrawn` and redacted events, `cancelled` enrollments, `sent` campaigns are all exported; no DE-6 descriptor has a `rowFilter` | same + `exportClassification.test.ts` | Add a `rowFilter` on `intake_forms.status` → "no rowFilter" pin red |
| N-11 | Registry order, group and role per §2.3: 10 × `client_records` / processor after `client_payment_methods` | `sections.test.ts` | — |
| N-12 | **Characterization re-pin:** tables read in order; the **23 existing select strings** (22 descriptor-driven + `profiles`) byte-identical to today's literals; the 10 new ones literal; audit `sectionCounts` has the 10 ids, counts only | `route.characterization.test.ts` | — |
| N-13 | Purge baseline: `descriptorsForRun` identical for all level × area combinations; `level/order/scope/snapshot/area/notes` unchanged on the 12 rows (`email_unsubscribes`, `marketing_consent_events`, `marketing_consent_state` stay `never`) | existing purge invariant suites | — |
| N-14 | Planted `?userId=<B>` and `x-user-id: <B>` change nothing in the 10 sections | `route.test.ts` (extend) | — |
| N-15 | Ceiling: the 10 new sections draw on the shared row budget; over it → 413, no file | `route.test.ts` (extend existing case) | — |
| N-16 | Re-planted "still planned" controls (unknown section, duplicate include, non-table section, `not_included`) now on `smart_links` and still red for the right reason | `exportClassification.test.ts` | — |

---

## 9. CI placement and runtime

No new job, script or file: the tests extend suites already in the required Jest gate (a few dozen in-memory assertions). No type-check scope change (DE-2 SA-Q1). Not in the `next build` critical path. T-11 records before / after runtimes; DE-5 added about 2 s off the critical path, and DE-6 is expected to be of the same order. Any material increase goes to SA before hand-over (no-added-CI-time rule).

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A declared column that is not live (11 of 12 tables are absent from the catalog; dashboard-only columns have happened before) fails the whole section (42703) | T-0 Q1 before writing; T-10 drift check; a failure is visible (`failed`), never silent |
| R-2 | `trigger_config` / `segment_filter` / `questions` hold an unexpected tracking or secret key | Q5 key census before code; SA-Q4 turns any such column into an allow-list |
| R-3 | `source_page_url` carries a query string with a tracking id or token | Q7b counts URLs with `?`, `token=`, `session`; if non-zero, SA-Q7 decides (strip the query, or keep as held) |
| R-4 | Legacy `email_unsubscribes.reason` holds free text a client typed | Q6 counts non-method values (no content); it is the client's own words to the business, kept as held unless SA says otherwise |
| R-5 | Only the **current** hosted privacy-notice text exists; an old consent's notice text cannot be shown | Stated in DE-8b's README; each consent row keeps its exact wording and the notice link it was shown. A versioned notice is a product change, not an export one (follow-up, not DE-6) |
| R-6 | Reading the current consent from the events is non-trivial (latest event wins; a withdrawal wins a tie) | README note for DE-8b (§13 BC-6 default); `email_unsubscribes` and subscriber `status` give the current answer directly for the email channel |
| R-7 | `marketing_consent_settings` without `rowKey` fails closed | SA-Q1; N-9 |
| R-8 | Email bodies (`body_html`) are large and the 4 MB JSON body cap (DE-4 SA-Q7) is reached sooner | Q8 measures the largest owner's bytes; the cap refuses cleanly (413), never a partial file |
| R-9 | Pinned tests planting on `lead_responses` break | T-9 re-plants deliberately on `smart_links` |
| R-10 | A child row's `user_id` differs from its parent's | Children read by their own `user_id` (§2.4); Q9 measures; non-zero → SA as a data-integrity finding |
| R-11 | Redacted rows look like real addresses to a reader | They read `redacted@invalid`, with `redacted_at` set; README explains |

---

## 11. Live schema verification (SQL for TL)

**Read-only. Run on PROD in the Supabase SQL editor.** Outputs table, column, constraint and key names, types, status and method codes, jsonb key names, counts, sizes and user ids only: no row content, no email, no wording, never a hash, salt or user agent. The editor's known word bug is avoided: no statement below contains that four-letter preposition anywhere.

**File:** (pasted by TL; not committed)

```sql
-- Q1: every live column of the 12 tables (reconcile with §3)
SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences',
                     'email_sequence_steps', 'email_sequence_enrollments', 'email_unsubscribes',
                     'marketing_consent_state', 'marketing_consent_events', 'marketing_consent_settings',
                     'business_subscribers', 'lead_responses')
ORDER BY table_name, ordinal_position;

-- Q2: column count per table, whether each is live, and whether it has user_id / id at all
-- (expected from migrations: user_intake_settings 6, business_intake_forms 10, email_campaigns 17,
--  email_sequences 12, email_sequence_steps 12, email_sequence_enrollments 9, email_unsubscribes 6,
--  marketing_consent_state 8, marketing_consent_events 24, marketing_consent_settings 14,
--  business_subscribers 14, lead_responses 16)
SELECT t.table_name,
       count(c.column_name) AS columns,
       bool_or(c.column_name = 'user_id') AS has_user_id,
       bool_or(c.column_name = 'user_id' AND c.is_nullable = 'NO') AS user_id_not_null,
       bool_or(c.column_name = 'id') AS has_id
FROM (VALUES ('user_intake_settings'), ('business_intake_forms'), ('email_campaigns'), ('email_sequences'),
             ('email_sequence_steps'), ('email_sequence_enrollments'), ('email_unsubscribes'),
             ('marketing_consent_state'), ('marketing_consent_events'), ('marketing_consent_settings'),
             ('business_subscribers'), ('lead_responses')) AS t(table_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = t.table_name
GROUP BY t.table_name ORDER BY t.table_name;

-- Q3: primary keys and unique constraints, plus every index definition
SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences',
                        'email_sequence_steps', 'email_sequence_enrollments', 'email_unsubscribes',
                        'marketing_consent_state', 'marketing_consent_events', 'marketing_consent_settings',
                        'business_subscribers', 'lead_responses')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
ORDER BY 1, 2, 3;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences',
                    'email_sequence_steps', 'email_sequence_enrollments', 'email_unsubscribes',
                    'marketing_consent_state', 'marketing_consent_events', 'marketing_consent_settings',
                    'business_subscribers', 'lead_responses')
ORDER BY 1, 2;

-- Q4: rows per table, NULL user_id rows (expect 0), and max rows per owner on the 1:1 tables (expect <= 1)
SELECT 'user_intake_settings' AS t, count(*) AS rows, count(*) FILTER (WHERE user_id IS NULL) AS null_owner,
       (SELECT max(n) FROM (SELECT count(*) n FROM public.user_intake_settings GROUP BY user_id) x) AS max_per_owner
FROM public.user_intake_settings
UNION ALL SELECT 'marketing_consent_settings', count(*), count(*) FILTER (WHERE user_id IS NULL),
       (SELECT max(n) FROM (SELECT count(*) n FROM public.marketing_consent_settings GROUP BY user_id) x)
FROM public.marketing_consent_settings
UNION ALL SELECT 'business_intake_forms', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.business_intake_forms
UNION ALL SELECT 'email_campaigns', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.email_campaigns
UNION ALL SELECT 'email_sequences', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.email_sequences
UNION ALL SELECT 'email_sequence_steps', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.email_sequence_steps
UNION ALL SELECT 'email_sequence_enrollments', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.email_sequence_enrollments
UNION ALL SELECT 'email_unsubscribes', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.email_unsubscribes
UNION ALL SELECT 'marketing_consent_state', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.marketing_consent_state
UNION ALL SELECT 'marketing_consent_events', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.marketing_consent_events
UNION ALL SELECT 'business_subscribers', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.business_subscribers
UNION ALL SELECT 'lead_responses', count(*), count(*) FILTER (WHERE user_id IS NULL), NULL FROM public.lead_responses
ORDER BY 1;

-- Q5: jsonb shape and key census (key names and counts only, never values)
SELECT 'intake_forms.questions' AS col, jsonb_typeof(questions) AS shape, count(*) FROM public.business_intake_forms GROUP BY 2
UNION ALL SELECT 'intake_forms.generated_from', jsonb_typeof(generated_from), count(*) FROM public.business_intake_forms GROUP BY 2
UNION ALL SELECT 'campaigns.segment_filter', jsonb_typeof(segment_filter), count(*) FROM public.email_campaigns GROUP BY 2
UNION ALL SELECT 'sequences.trigger_config', jsonb_typeof(trigger_config), count(*) FROM public.email_sequences GROUP BY 2
UNION ALL SELECT 'subscribers.attribution', jsonb_typeof(attribution), count(*) FROM public.business_subscribers GROUP BY 2
UNION ALL SELECT 'consent_events.evidence', jsonb_typeof(evidence), count(*) FROM public.marketing_consent_events GROUP BY 2
ORDER BY 1, 2;

-- Q5a: keys of each question object, and the question types used
SELECT 'question_key' AS what, k AS name, count(*)
FROM public.business_intake_forms f,
     jsonb_array_elements(CASE WHEN jsonb_typeof(f.questions) = 'array' THEN f.questions ELSE '[]'::jsonb END) q,
     jsonb_object_keys(CASE WHEN jsonb_typeof(q) = 'object' THEN q ELSE '{}'::jsonb END) k
GROUP BY k
UNION ALL
SELECT 'question_type', q->>'type', count(*)
FROM public.business_intake_forms f,
     jsonb_array_elements(CASE WHEN jsonb_typeof(f.questions) = 'array' THEN f.questions ELSE '[]'::jsonb END) q
GROUP BY q->>'type'
ORDER BY 1, 2;

-- Q5b: top-level keys of the object-shaped jsonb columns
SELECT 'segment_filter' AS col, k, count(*) FROM public.email_campaigns,
  jsonb_object_keys(CASE WHEN jsonb_typeof(segment_filter) = 'object' THEN segment_filter ELSE '{}'::jsonb END) k GROUP BY k
UNION ALL SELECT 'trigger_config', k, count(*) FROM public.email_sequences,
  jsonb_object_keys(CASE WHEN jsonb_typeof(trigger_config) = 'object' THEN trigger_config ELSE '{}'::jsonb END) k GROUP BY k
UNION ALL SELECT 'attribution', k, count(*) FROM public.business_subscribers,
  jsonb_object_keys(CASE WHEN jsonb_typeof(attribution) = 'object' THEN attribution ELSE '{}'::jsonb END) k GROUP BY k
UNION ALL SELECT 'evidence', k, count(*) FROM public.marketing_consent_events,
  jsonb_object_keys(CASE WHEN jsonb_typeof(evidence) = 'object' THEN evidence ELSE '{}'::jsonb END) k GROUP BY k
UNION ALL SELECT 'generated_from', k, count(*) FROM public.business_intake_forms,
  jsonb_object_keys(CASE WHEN jsonb_typeof(generated_from) = 'object' THEN generated_from ELSE '{}'::jsonb END) k GROUP BY k
UNION ALL SELECT 'lead_recommendation', k, count(*) FROM public.lead_responses,
  jsonb_object_keys(CASE WHEN jsonb_typeof(recommendation) = 'object' THEN recommendation ELSE '{}'::jsonb END) k GROUP BY k
ORDER BY 1, 2;

-- Q6: status, method and code values (codes only)
SELECT 'intake_forms.status' AS col, status AS value, count(*) FROM public.business_intake_forms GROUP BY 2
UNION ALL SELECT 'intake_settings.is_enabled', is_enabled::text, count(*) FROM public.user_intake_settings GROUP BY 2
UNION ALL SELECT 'campaigns.status', status, count(*) FROM public.email_campaigns GROUP BY 2
UNION ALL SELECT 'sequences.trigger_type', trigger_type, count(*) FROM public.email_sequences GROUP BY 2
UNION ALL SELECT 'enrollments.status', status, count(*) FROM public.email_sequence_enrollments GROUP BY 2
UNION ALL SELECT 'subscribers.status', status, count(*) FROM public.business_subscribers GROUP BY 2
UNION ALL SELECT 'subscribers.source', source, count(*) FROM public.business_subscribers GROUP BY 2
UNION ALL SELECT 'events.decision', decision, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.method', method, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.channel', channel, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.purpose', purpose, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.source_surface', coalesce(source_surface, '(null)'), count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.redacted', (redacted_at IS NOT NULL)::text, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'events.grant_without_version', (decision = 'granted' AND statement_version IS NULL)::text, count(*) FROM public.marketing_consent_events GROUP BY 2
UNION ALL SELECT 'settings.privacy_policy_mode', privacy_policy_mode, count(*) FROM public.marketing_consent_settings GROUP BY 2
UNION ALL SELECT 'unsubscribes.reason',
       CASE WHEN reason IS NULL THEN '(null)'
            WHEN reason IN ('web_form', 'double_optin_confirm', 'unsubscribe_link', 'list_unsubscribe', 'owner_entered',
                            'imported', 'reply_stop', 'legacy_unsubscribe_import') THEN reason
            ELSE '(other text)' END, count(*)
  FROM public.email_unsubscribes GROUP BY 2
UNION ALL SELECT 'lead_responses.kind', kind, count(*) FROM public.lead_responses GROUP BY 2
UNION ALL SELECT 'lead_responses.status', status, count(*) FROM public.lead_responses GROUP BY 2
ORDER BY 1, 2;

-- Q7: any column on the 12 tables whose NAME looks like tracking, a token, a secret or a code
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences',
                     'email_sequence_steps', 'email_sequence_enrollments', 'email_unsubscribes',
                     'marketing_consent_state', 'marketing_consent_events', 'marketing_consent_settings',
                     'business_subscribers', 'lead_responses')
  AND column_name ~ '(ip|agent|session|fingerprint|device|token|secret|salt|hash|key|code|cookie|visitor|provider_message)'
ORDER BY 1, 2;

-- Q7a: how often the tracking columns on the consent ledger are filled (counts only)
SELECT count(*) AS events,
       count(ip_hash) AS with_ip_hash, count(ip_hash_salt) AS with_salt,
       count(user_agent) AS with_user_agent, count(session_id) AS with_session_id,
       count(recorded_by) AS with_recorded_by,
       count(*) FILTER (WHERE recorded_by IS NOT NULL AND recorded_by <> user_id) AS recorded_by_not_owner
FROM public.marketing_consent_events;

-- Q7b: page URLs with a query string or token-like parameter (counts only)
SELECT count(*) FILTER (WHERE source_page_url LIKE '%?%') AS with_query,
       count(*) FILTER (WHERE source_page_url ~* '(token|session|sid|code)=') AS token_like,
       count(*) FILTER (WHERE privacy_policy_url ~* '(token|session|sid|code)=') AS policy_token_like
FROM public.marketing_consent_events;

-- Q8: largest owners: rows and bytes per owner across the 10 included tables (top 5)
SELECT user_id, sum(n) AS rows, pg_size_pretty(sum(b)) AS bytes
FROM (
  SELECT user_id, count(*) n, sum(pg_column_size(t.*)) b FROM public.user_intake_settings t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.business_intake_forms t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.email_campaigns t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.email_sequences t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.email_sequence_steps t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.email_sequence_enrollments t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.email_unsubscribes t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.marketing_consent_events t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.marketing_consent_settings t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.business_subscribers t GROUP BY 1
) x
GROUP BY user_id ORDER BY sum(b) DESC LIMIT 5;

-- Q9: cross-tenant parent/child integrity (expect 0 on every edge)
SELECT 'steps -> sequences' AS edge, count(*) FROM public.email_sequence_steps c JOIN public.email_sequences p ON p.id = c.sequence_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'enrollments -> sequences', count(*) FROM public.email_sequence_enrollments c JOIN public.email_sequences p ON p.id = c.sequence_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'enrollments -> contacts', count(*) FROM public.email_sequence_enrollments c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'unsubscribes -> contacts', count(*) FROM public.email_unsubscribes c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'consent_events -> contacts', count(*) FROM public.marketing_consent_events c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'consent_state -> events', count(*) FROM public.marketing_consent_state c JOIN public.marketing_consent_events p ON p.id = c.last_event_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'consent_state -> contacts', count(*) FROM public.marketing_consent_state c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'subscribers -> promoted contacts', count(*) FROM public.business_subscribers c JOIN public.crm_contacts p ON p.id = c.promoted_contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'lead_responses -> contacts', count(*) FROM public.lead_responses c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'lead_responses -> services', count(*) FROM public.lead_responses c JOIN public.scheduling_services p ON p.id = c.service_id WHERE p.user_id <> c.user_id
ORDER BY 1;

-- Q10: soft-delete-looking columns on the 12 tables (expect none)
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences',
                     'email_sequence_steps', 'email_sequence_enrollments', 'email_unsubscribes',
                     'marketing_consent_state', 'marketing_consent_events', 'marketing_consent_settings',
                     'business_subscribers', 'lead_responses')
  AND column_name IN ('deleted_at', 'is_deleted', 'archived_at')
ORDER BY 1, 2;

-- Q11: is marketing_consent_state derivable from the events? (expect 0 in both)
-- a) state rows whose last event does not match the key
SELECT count(*) AS key_mismatch
FROM public.marketing_consent_state s
JOIN public.marketing_consent_events e ON e.id = s.last_event_id
WHERE e.user_id <> s.user_id OR e.email_normalized <> s.email_normalized OR e.channel <> s.channel;
-- b) state rows whose consented flag disagrees with the latest event for the key (a withdrawal wins a tie)
WITH latest AS (
  SELECT DISTINCT ON (user_id, email_normalized, channel)
         user_id, email_normalized, channel, decision
  FROM public.marketing_consent_events
  ORDER BY user_id, email_normalized, channel, occurred_at DESC, (decision = 'withdrawn') DESC
)
SELECT count(*) AS state_disagrees
FROM public.marketing_consent_state s
JOIN latest l USING (user_id, email_normalized, channel)
WHERE s.consented <> (l.decision = 'granted');
```

**Q12 (T-10 drift check)** is written by Dev after T-2 from the final declared lists, in the DE-5 §T-10 shape (one `VALUES` list of `(table, column)` declared in `columns` ∪ `excludedColumns`, full-outer-joined against `information_schema.columns` for the 10 included tables; expect 0 rows).

---

## 12. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **SA-Q1** | `marketing_consent_settings` has no `id` (PK `user_id`). (a) Optional `rowKey: 'user_id'` on `include`, read as one `.eq('user_id').limit(2)` that fails closed on 2 (the DE-3 SA-Q1 (a) design, moot then), or (b) `exclude` the table? | **(a)**: it keeps one tested reader, stays inside E-1…E-6, and keeps the owner's consent wording and privacy notice in the file. (b) loses the privacy-notice text (BC-7) |
| SA-Q2 | Group of all 10: `client_records` / processor, including `intake_settings` and `consent_settings` (the business's own configuration around client work, as DE-4 put `services` and `pipeline_stages` there), rather than `account` / controller (as DE-3 put `business_profile`)? | `client_records` for all 10: they exist only to collect and contact clients |
| SA-Q3 | `marketing_consent_state` `exclude` as derived (no id, rebuilt by trigger, Q11 proves derivable), with a DE-8b README line on reading the current state? | Yes |
| SA-Q4 | jsonb: `questions`, `segment_filter`, `trigger_config` whole (on the Q5 census, as DE-3 SA-Q5); `attribution` through `SOURCE_METADATA_KEYS`; `evidence` through new `CONSENT_EVIDENCE_KEYS` (`client_statement`, `confirmed_via`, `note`); `generated_from` out | As stated; any unexpected key in Q5 turns that column into an allow-list before code |
| SA-Q5 | Deny-list hardening: `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint` exact, and `/_salt$/` pattern, in the same constants (comment widened to "secrets and visitor tracking")? | Yes: no hit on any current include; prevention only |
| SA-Q6 | `email_sequence_enrollments.next_send_at` out (`QUEUE_STATE`); `current_step_number` in | Yes |
| SA-Q7 | If Q7b shows query strings on `source_page_url`: keep as held (it is the business's own page, as DE-4 kept `capture_page_url`), or strip the query? | Keep as held unless Q7b shows a token-like parameter; then strip the query string in the mapper |
| SA-Q8 | `email_normalized` out on both tables (`DERIVED_COPY`), although DE-4 kept the generated attribution columns on `crm_contacts`? | Out: here it is a pure lower-case copy of `email`, which is in |
| SA-Q9 | `lead_responses` `exclude` as activity, against the §3.1 B4 list and the descriptor's purge note, on the `payment_reminders` precedent (DE-5 BC-4)? | Exclude; user confirms as BC-2 |
| SA-Q10 | `recorded_by` out (`ACTOR_ID`, as DE-5 SA-Q15), given Q7a shows whether it is ever not the owner | Out |

---

## 13. Business calls (for the user, via TL)

Plain terms. Each has a default; the build follows the default unless the user says otherwise.

| # | Question | Default |
|---|---|---|
| **BC-1** | When someone ticks "yes, email me" on your forms, we keep the **exact sentence they agreed to**, its language and version, the date and time, how they agreed (form, confirmation email, or you typed it in), and which form and page. We **also** keep technical evidence: a scrambled version of their internet address together with the key that lets it be checked, their browser signature and a visit id. Should that technical evidence be in your download? Leaving it out matches what you decided for clients ("how they found you": readable details only). It stays in our records either way, so a specific complaint can still be answered through support | **Out** (the wording, time, method and place are in) |
| **BC-2** | The **automatic messages** the system queued or sent to new leads and clients: booking invitations, follow-up chases, and invoice, intake, quote and meeting reminders. Emails sent are "activity", which you left out (same as payment and booking reminders). The leads themselves, and how they found you, are already in the download | **Out** |
| **BC-3** | For your email campaigns and sequences: **how many emails went out, were opened or clicked**. That is activity. The campaign itself (its wording, who it was for, its status and the date it was sent) is in | **Counts out; the campaign, its status and its sent date in** |
| **BC-4** | Your **intake form**: every version, including drafts not yet published and older versions you replaced (so old answers can be read against the questions they answered). Left out: the technical details of how the assistant generated a draft (which AI model, what it was based on) | **All versions in; the generation details out** |
| **BC-5** | Newsletter sign-ups who **have not yet confirmed** their address, and those who left, each with their status; plus how they found you (the same readable details as for clients) | **In, with status** |
| **BC-6** | The download has the **full history** of every "agreed" and "withdrew", and your **do-not-email list**. Should it also have a third list showing only **each address's current answer**? It can be worked out from the history (the latest answer counts) | **No third list**; the guide in the download explains how to read the current answer |
| **BC-7** | Your **consent settings**: your consent sentence (in each language), your privacy notice (the text, if we host it for you, or its link), your postal address, and the "advertisement" label setting. Note: we keep only the **current** privacy notice; earlier versions are not stored anywhere, though each consent record keeps the exact sentence agreed | **In** |
| **BC-8** | Consent records of people who later asked to be **erased**: the record stays, with their address removed. Include those rows (they show a decision existed and was erased)? | **In, as held** |

---

## SA Review Notes

(SA populates.)

### SA workplan review DE-6 — 2026-10-16

**Reviewed by SA — 2026-10-16**
**Status:** ✅ Approved with conditions (C-1…C-12 below). Dev may start T-2 now. The conditions are checked at SA code review.

**Binding inputs:** requirement §0.2–§0.9; TL defaults §13.1 (BC-1 out, BC-2 out, BC-3 counts out, BC-4 all versions in / `generated_from` out, BC-5 in, BC-6 no third list, BC-7 in, BC-8 in as held); T-0 §11.1.

#### Reconciliation of §3 with T-0 (§11.1)

SA checked every table, column by column, against §11.1. **It matches exactly.** Every live column is in `columns` or in `excludedColumns`, and nothing else is listed.

| Table | Live n | §3 in + out | Result |
|---|---|---|---|
| user_intake_settings | 6 | 5 + 1 | ✅ |
| business_intake_forms | 10 | 8 + 2 | ✅ |
| email_campaigns | 17 | 11 + 6 | ✅ |
| email_sequences | 12 | 8 + 4 | ✅ |
| email_sequence_steps | 12 | 8 + 4 | ✅ |
| email_sequence_enrollments | 9 | 7 + 2 | ✅ |
| email_unsubscribes | 6 | 5 + 1 | ✅ |
| marketing_consent_events | 24 | 17 + 7 | ✅ |
| marketing_consent_settings | 14 | 13 + 1 (no `id`) | ✅ (SA-Q1) |
| business_subscribers | 14 | 12 + 2 | ✅ |
| marketing_consent_state | 8 | exclude | ✅ (no `id`, composite PK) |
| lead_responses | 16 | exclude (the override list in §3.12 also covers all 16) | ✅ |

Totals stay 155 = 33 include + 5 planned (DE-7) + 117 exclude. The two generated columns (`email_normalized` × 2) are confirmed by T-0. `email_unsubscribes.reason` holds method codes only (3 × `unsubscribe_link`), so R-4 does not arise today. F-14 holds: no token column is stored. The evidence keys in use are `client_statement` and `confirmed_via`.

#### Rulings

| # | Ruling |
|---|---|
| **SA-Q1** | **(a) approved**, built exactly as follows. **(1) Type:** `include` gains an optional `rowKey?: 'user_id'`. That literal is the only value allowed. **(2) CI shape check:** if `rowKey` is present, it must be `'user_id'`; the descriptor's `scope.kind` must be `user_id` (the check needs the scope, so pass it in or run a descriptor-level check; do not rely on the runtime check alone); `user_id` must not be in `columns` (`OWNER_ID`); there must be no `rowFilter`. **Also add the converse rule to CI:** an `include` *without* `rowKey` must list `id` in `columns`. Today that rule lives only at runtime (repository line 130). `tableExportProblems` has no such rule, although §2.6 says "the existing rule stands". All 23 current includes already pass it, because the runtime check would fail them otherwise. **(3) Pin the use:** a test pins that exactly one descriptor, `marketing_consent_settings`, carries `rowKey`. A second one needs SA. **(4) Repository:** a branch inside `listOwnedRowsForExport`, using the same signature and the same `ReadInputSchema`, placed **after** the E-2 scope check and the E-3 `exportColumnsOf` deny check. It runs one query, `from(table).select(select).eq('user_id', input.userId).limit(2)`. The tenant filter comes first and is the only filter. There is no `.order`, no `.gt` and no other filter, and the only id used is the session `userId`. **0 rows** → ok, empty. **1 row** → ok. **2 rows** → throw (`{ data: null, error }`, section `failed`), and the log carries counts only, never row content. The ceiling works as on the paged path: `rows.length > maxRows` → `overCeiling: true`, `rows: []`. The success log reports `pages: 1`. There is no new method, no new exported symbol and no caller-supplied id. E-1…E-6 are unchanged, and the header comment names the branch. **(5) Tests (N-9, extended):** 0 / 1 / 2 rows; maxRows 0 with 1 row → over the ceiling; B's settings row never returned to A; the query shape is asserted (`eq('user_id')` then `limit(2)`, with no `order` / `gt`); the E-1 write scan and the E-6 importer scan still pass. T-0 confirms the key is unique (PK `user_id`, max 1 per owner). |
| SA-Q2 | Approved: all 10 sections in `client_records` / processor, in the §2.3 order after `client_payment_methods`. |
| SA-Q3 | Approved: `marketing_consent_state` is excluded as a derived cache (composite PK, no `id`, rebuilt by trigger). The DE-8b README line explains how to read the current answer (BC-6 default). **C-9:** TL did not report Q11 in §11.1. TL runs Q11a/b (expect 0 / 0) before SA code review. A non-zero result goes to SA as a data-integrity finding; it does not change the export. |
| SA-Q4 | Approved. `questions` goes out whole: the live keys (`help, id, label, maxFiles, options, required, showIf, type`) are a subset of `IntakeQuestion`, and the 6 types are all known. `generated_from` is out (its live keys `model, serviceIds, source, subVertical, vertical` confirm it is AI provenance; BC-4). `attribution` goes through `SOURCE_METADATA_KEYS` (by identity, N-5). `evidence` goes through `CONSENT_EVIDENCE_KEYS = ['client_statement', 'confirmed_via', 'note']`. Keeping `note` is correct: the consent route writes it (F-6), it is optional, and it is absent from the 4 live owner-entered rows. `segment_filter` and `trigger_config` go out whole, but T-0 could not census them (0 rows), and `trigger_config` is `z.record(z.any())`. **C-5:** in the Dev notes, Dev lists every writer of these two columns and confirms each is an owner-authenticated route or service (no public or visitor route, no tracking builder). If any writer is not, that column becomes an allow-list before hand-over. |
| SA-Q5 | Approved: `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint` go in `SECRET_COLUMN_DENY_EXACT`, and `/_salt$/` goes in `SECRET_COLUMN_DENY_PATTERNS`. The comment widens to "secrets and visitor tracking"; the names are unchanged. **SA verified** that none of these names (quoted) appears anywhere in `descriptors.ts`, so no DE-1…DE-5 include trips them. `crm_pipeline_stages.stage_key` is unaffected (it does not match `_salt`), and `DENY_EXCEPTIONS` stays at one entry. The exact `session_id` entry does not match `checkout_session_id`, which is excluded in DE-5 anyway. The `ip_address` / `user_agent` in `route.ts` are an audit **write**, not a descriptor column, so they are unaffected. In `marketing_consent_events` they are `excludedColumns`, which the deny check does not apply to. **C-6:** if a test pins the deny constants literally, re-pin it deliberately and show a mutation red. |
| SA-Q6 | Approved: `next_send_at` is out (`QUEUE_STATE`); `current_step_number` is in. |
| **SA-Q7** | **Strip the query string and the fragment** of `source_page_url` in `consentEventRow`. The proposed "keep as held" falls away because T-0 found 2 of 16 URLs with token-like params. Rule: a string value is cut at the first `?` or `#`, whichever comes first, and the scheme + host + path are kept unchanged. A value that is not a string passes through as is (NULL stays NULL). Use plain string slicing, not `new URL()`, so a relative or malformed value never throws or rewrites. **Why not exclude:** the page path is the "where" proof (§5), and dropping it weakens the consent record. **Why not an allow-list of params:** no query parameter on a consent page is consent proof, and the campaign tags are already readable in `attribution`; an allow-list would be one more list to maintain against unknown keys. **C-2:** apply the same helper to `capture_page_url` and `referrer_url` inside `subscriberRow`. The source is the same public forms (`data.page_url`), so the risk is the same, and the section is new (0 rows), so no existing output changes. **C-3:** TL reports Q7b `policy_token_like` (missing from §11.1). If it is non-zero, strip `privacy_policy_url` the same way; if 0, keep it as held. **Tests (C-4):** unit tests on the helper: `?token=`, `?session=`, `?sid=`, `?code=`, `#frag`, `?a=1#b`, no query (unchanged), relative path, NULL, non-string. N-6 is extended: seed `source_page_url = 'https://x.test/p?token=TOK-XYZ&sid=SID-XYZ'` and a subscriber `capture_page_url` with `?code=CODE-XYZ`; the serialised body contains none of `TOK-XYZ`, `SID-XYZ`, `CODE-XYZ`, and does contain `https://x.test/p`. Negative control: remove the strip → red. |
| SA-Q8 | Approved: `email_normalized` is out on both tables (`DERIVED_COPY`). It is a generated lower-case copy of `email`, and `email` is in. DE-4's generated attribution columns were readable derivations, not copies, so the precedent does not conflict. |
| SA-Q9 | Approved: `lead_responses` is excluded as activity (BC-2 default; precedent `payment_reminders`, DE-5 BC-4). The descriptor's purge note is left as it is. |
| SA-Q10 | Approved: `recorded_by` is out (`ACTOR_ID`). T-0: 8 of 8 are the owner. |

#### Tenant isolation (tenant-isolation-guard)

The design passes. Service-role read; the only id is the session `getUser().id`; `.eq('user_id')` is the first filter on both paths; every child table is read by its own `user_id`; there is no find-by-id, no caller id and no write. T-0 Q9 is 0 on every edge. N-8 (cross-tenant on all 10 tables, including the crossed-pointer cases) and N-14 (planted `?userId` / `x-user-id`) are required as written.

#### Conditions (checked at SA code review)

- **C-1** SA-Q1 is built exactly as ruled in (1)–(5), including the new CI rule "include without `rowKey` ⇒ `id` in `columns`" and the single-use pin.
- **C-2 / C-3 / C-4** SA-Q7 as ruled: the strip in `consentEventRow`, the same helper on the subscriber URL keys, the `privacy_policy_url` decision from Q7b, the unit tests, and the N-6 extension.
- **C-5** The writers of `segment_filter` / `trigger_config` are listed in the Dev notes (SA-Q4).
- **C-6** Deny-list hardening; any literal pin is re-pinned with a mutation shown red.
- **C-7 Existing output unchanged:** N-12 compares the **23 existing select strings against literals copied from origin/main `98735db9`**, not against strings regenerated from the changed descriptors. `format_version` stays 2. The DE-1…DE-5 sections' order, group and role are unchanged.
- **C-8** Every negative control in §8 is shown red once by an in-memory revert (no `git stash`, ever).
- **C-9** TL runs Q11 (SA-Q3) and reports it here.
- **C-10** No added CI time on the critical path. All tests go in the existing Jest suites, with no new job and no type-check scope change. T-11 records the before / after runtimes, and anything more than a few seconds goes back to SA.
- **C-11** T-10 drift check (Q12) returns 0 drift / 0 missing before hand-over.
- **C-12** Requirement §0.10 records the DE-6 rulings, as built, **and the user request below**.

#### Finding for TL (not a DE-6 change)

**F-DE6-1:** `crm_contacts.source_metadata.capture_page_url` (and `referrer_url`) come from the same public `page_url` as `source_page_url`, so DE-4's `clients` section may already export the same token-like query strings. DE-6 must not change DE-4 output, so this is not fixed here. TL runs a read-only count, the Q7b shape on `source_metadata->>'capture_page_url'` and `->>'referrer_url'`. If it is non-zero, a small follow-up applies the C-2 helper to `sourceMetadata()`, with a deliberate DE-4 characterization re-pin.

#### User request recorded (2026-10-16), for the requirement

**DE-10a (admin export)** must live in **`/admin/users`, in the business area, placed just ABOVE the Danger Zone**, and it is the **LAST slice of Phase 1**. Dev splices this into the requirement (§0.10 and the Phase 1 slice list / §0.3.7 order) at T-12 (C-12).

### Approval
[x] Workplan approved, with conditions C-1…C-12. Proceed to T-2.

### SA code review DE-6 — 2026-10-16

**Code Review by SA — 2026-10-16**
**Status:** ✅ Code Approved

SA read the full uncommitted diff (12 files, +1695 / −68) against C-1…C-12, §11.1–§11.3, the F-DE6-1 TL decision and §13.1. SA re-ran the data-export, purge, export-repository and route suites: 21 suites, 808 passed.

#### Conditions

| # | Result |
|---|---|
| C-1 | ✅ `rowKey?: 'user_id'` on `include`. `rowKeyProblems` checks the literal, the `user_id` scope (read from the descriptor), `user_id` not in `columns`, and no `rowFilter`. The converse rule ("include without `rowKey` must list `id`") is now in CI. The single-use pin passes. Repository branch: placed after E-2 and E-3; the one query is `.select(select).eq('user_id', input.userId).limit(2)`, with no order, no gt and no other filter, and the only id is the session id. 0 rows and 1 row return ok. 2 rows throw, and the message carries the count only. The ceiling check is the same as on the paged path, and the success log reports `pages: 1`. D-6: a planted non-`user_id` key, or a `rowFilter` beside it, fails closed before any query. No new method, no new export. |
| C-2 / C-3 / C-4 | ✅ `withoutQueryOrFragment` cuts the string at the first `?` or `#` (`search(/[?#]/)` + `slice`), never calls `new URL()`, and passes non-strings through. `consentEventRow` strips `source_page_url`. `subscriberRow` goes through `sourceMetadata`. `privacy_policy_url` is kept as held (Q7b 0/0). Only the two URL keys are cut. D-4 (a `utm_*` value containing `?` is left alone) is pinned. The helper cases and the N-6 extension are present. |
| F-DE6-1 | ✅ This is the only change to DE-1…DE-5 output: `sourceMetadata` cuts `capture_page_url` / `referrer_url`. A dedicated characterization test seeds token-like values and asserts they are absent. `git diff 98735db9 ac674ceb` is empty on every export path. The existing include consts are untouched in `descriptors.ts`. The characterization `SELECTS` diff is insert-only, so the 23 earlier literals stay byte-identical to `98735db9`, and their chains, group and order pass unchanged. |
| Tracking | ✅ `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id` and `recorded_by` are in `excludedColumns`. Raw `evidence` and `attribution` never reach the file: they pass through `pickStringKeys` allow-lists. The N-6 body scan finds no seeded tracking value. |
| C-5 | ✅ The writer list is acceptable: two owner-session routes, one dormant server constant, and two repository methods that nothing calls. No visitor route writes either column, so both go out whole. |
| C-6 | ✅ Five exact names and `/_salt$/` were added. No descriptor names any of them, so no DE-1…DE-5 include trips the deny list (suites green). The literal pins were re-pinned, and M4 shows red. |
| C-7 | ✅ `format_version` is unchanged. The DE-1…DE-5 sections keep their order, group and role. The ten new sections come after `client_payment_methods`. |
| C-8 | ✅ M1–M10 were applied in place and restored, with sha256 verification and no stash. All showed red. |
| C-9 / C-11 | ✅ Q11 returned 0/0/0 (§11.2). Q12 drift over 124 names returned 0/0 (§11.3). |
| C-10 | ✅ Per-suite runtime is about +0.9 s in total. The tests sit in the existing suites, with no new job or script and no type-check scope change, and nothing was added to the `next build` critical path. |
| C-12 | ✅ Requirement §0.10 was added insert-only (70/0). It includes the DE-10a placement (in `/admin/users`, in the business area, just above the Danger Zone, as the last Phase 1 slice) and the note at the §0.4.1 G order. |

**Tenant isolation:** ✅ Both read paths run on the service role, and the only id they use is the session `getUser().id`. `.eq('user_id')` is the first filter on both. Child tables are read by their own `user_id`. N-8 (crossed pointers), N-14 (planted ids) and the two-owner settings plant all pass. **Logging:** Pino only; the diff adds no `console.*`. **Deviations D-1…D-8:** all accepted. D-1 re-plants malformed-column cases next to `id`, so each case still pins one rule. The `lead_responses` plants moved to `smart_links`, which is still planned for DE-7.

#### Optimisation Suggestions (non-blocking)
- In requirement §0.10, the change-history row still says "T-10 drift check … owed". Update it to "done 0/0 (§11.3)" when QA results are spliced in.

### Code Approved for QA: Yes

---

## Dev Notes: implementation (2026-10-16)

Branch `feature/data-export-de6`, merged with origin/main first (fast-forward to `ac674ceb`; no data-export, purge or export-repository file changed since `98735db9`). Nothing committed. T-0 / §11.2 results, the §13.1 TL defaults and SA C-1…C-12 were built as written. **Phase fixed:** none of the V6 pipeline; this slice is data-export classification and its reader only.

### What was built

| Area | Change |
|---|---|
| `descriptors.ts` | New DE-6 block: `MARKETING_COLUMN_REASON` (`DELIVERY_STATS`, `QUEUE_STATE`, `GENERATION_METADATA`, `VISITOR_EVIDENCE`, `DERIVED_COPY`, `ACTOR_ID`) and 10 `*_EXPORT` consts exactly as §3. The 12 `planned('DE-6')` replaced; `lead_responses` → `exclude(ACTIVITY, … BC-2)`, `marketing_consent_state` → `exclude(CACHE, … BC-6)`. `level`, `order`, `scope`, `snapshot`, `area`, `notes` untouched on all 12 rows |
| `classificationTypes.ts` | 10 section ids; `rowKey?: 'user_id'` on `include` |
| `classification.ts` | SA-Q5 deny hardening; `tableExportProblems` reads `scope` and runs `rowKeyProblems`: with `rowKey` → `'user_id'`, `user_id` scope, `user_id` not in `columns`, no `rowFilter`; **without `rowKey` → `id` must be in `columns` (new converse CI rule, SA-Q1 (2))** |
| `BusinessDataExportRepository.ts` | Single-row branch inline in `listOwnedRowsForExport`, after E-2 and E-3, before the `id` check: `.from(table).select(select).eq('user_id', userId).limit(2)`; 0 → ok empty, 1 → ok, 2 → throw (message carries the count only), ceiling as on the paged path, success log `pages: 1`. A planted rowKey other than `user_id`, or a `rowFilter` beside it, fails closed with no query. No new method, no new export. Header comment names the branch |
| `sections.ts` | `withoutQueryOrFragment` (SA-Q7: cut at the first `?` or `#`, plain slicing, non-strings pass through), `SOURCE_METADATA_URL_KEYS`, `CONSENT_EVIDENCE_KEYS` + `consentEvidence`, mappers `subscriberRow` (attribution → `sourceMetadata`) and `consentEventRow` (evidence + `source_page_url`), 10 registry entries after `client_payment_methods`. **F-DE6-1:** `sourceMetadata` now cuts `capture_page_url` / `referrer_url`, marked `DE-6 (F-DE6-1):` |

### C-5: every writer of `segment_filter` / `trigger_config`

| Column | Writer | Who can call it | Verdict |
|---|---|---|---|
| `email_sequences.trigger_config` | `POST /api/email/sequences` → `emailSequenceRepository.create` (Zod `z.record(z.any())`) | `getUser()` session, 401 otherwise; row owner is `user.id` | Owner-authenticated |
| `email_sequences.trigger_config` | `PUT /api/email/sequences/[id]` → `emailSequenceRepository.update(id, user.id, …)` | `getUser()` session, scoped by `user.id` | Owner-authenticated |
| `email_sequences.trigger_config` | `WebsiteEmailSequenceService.createDefaultSequences(userId)` | Server-side service; writes the constant `{ source: 'website' }`. No caller in `app/` or `lib/` today (dormant) | Server constant, no visitor input |
| `email_sequences.trigger_config` | Column default `'{}'` (20260722) | — | — |
| `email_campaigns.segment_filter` | `EmailCampaignRepository.create` / `update` (`lib/repositories/EmailAutomationRepository.ts`) | No route, service or plugin calls them today | No writer reachable |
| `email_campaigns.segment_filter` | Column default `'{}'` (20260722) | — | — |

No public or visitor route writes either column, and neither is built by `buildAttributionFromRequest`. Both stay "whole" (SA-Q4); live T-0 had 0 rows in both tables. Searched `app/`, `lib/`, `components/`, `supabase/`, `scripts/` for `segment_filter|trigger_config|segmentFilter|triggerConfig`.

### T-10 drift check (Q12, for TL: read-only, PROD)

124 declared names (`columns` ∪ `excludedColumns`) of the 10 included tables, one FULL OUTER JOIN. Expect **0 rows**. Generated from the `DE6_PINS` literals, which the classification test proves equal to the descriptors. No statement contains the editor's problem word.

**File:** (pasted by TL; not committed)

```sql
-- Q12 (T-10 drift check, DE-6): the declared names (columns + excludedColumns) of the 10 included
-- DE-6 tables against the live columns. Expect 0 rows (0 drift, 0 missing). 124 declared names.
WITH declared(table_name, column_name) AS (
  VALUES
    ('user_intake_settings','id'), ('user_intake_settings','is_enabled'), ('user_intake_settings','send_after_booking'), ('user_intake_settings','created_at'), ('user_intake_settings','updated_at'), ('user_intake_settings','user_id'),
    ('business_intake_forms','id'), ('business_intake_forms','version'), ('business_intake_forms','status'), ('business_intake_forms','questions'), ('business_intake_forms','generated_at'), ('business_intake_forms','published_at'),
    ('business_intake_forms','created_at'), ('business_intake_forms','updated_at'), ('business_intake_forms','user_id'), ('business_intake_forms','generated_from'),
    ('email_campaigns','id'), ('email_campaigns','name'), ('email_campaigns','subject'), ('email_campaigns','body_html'), ('email_campaigns','body_text'), ('email_campaigns','segment_filter'),
    ('email_campaigns','status'), ('email_campaigns','scheduled_at'), ('email_campaigns','sent_at'), ('email_campaigns','created_at'), ('email_campaigns','updated_at'), ('email_campaigns','user_id'),
    ('email_campaigns','recipients_count'), ('email_campaigns','sent_count'), ('email_campaigns','opened_count'), ('email_campaigns','clicked_count'), ('email_campaigns','failed_count'),
    ('email_sequences','id'), ('email_sequences','name'), ('email_sequences','description'), ('email_sequences','trigger_type'), ('email_sequences','trigger_config'), ('email_sequences','is_active'),
    ('email_sequences','created_at'), ('email_sequences','updated_at'), ('email_sequences','user_id'), ('email_sequences','total_sent'), ('email_sequences','total_opened'), ('email_sequences','total_clicked'),
    ('email_sequence_steps','id'), ('email_sequence_steps','sequence_id'), ('email_sequence_steps','step_number'), ('email_sequence_steps','delay_minutes'), ('email_sequence_steps','subject'), ('email_sequence_steps','body_html'),
    ('email_sequence_steps','body_text'), ('email_sequence_steps','created_at'), ('email_sequence_steps','user_id'), ('email_sequence_steps','sent_count'), ('email_sequence_steps','opened_count'), ('email_sequence_steps','clicked_count'),
    ('email_sequence_enrollments','id'), ('email_sequence_enrollments','sequence_id'), ('email_sequence_enrollments','contact_id'), ('email_sequence_enrollments','status'), ('email_sequence_enrollments','current_step_number'), ('email_sequence_enrollments','enrolled_at'),
    ('email_sequence_enrollments','completed_at'), ('email_sequence_enrollments','user_id'), ('email_sequence_enrollments','next_send_at'),
    ('business_subscribers','id'), ('business_subscribers','email'), ('business_subscribers','name'), ('business_subscribers','status'), ('business_subscribers','source'), ('business_subscribers','attribution'),
    ('business_subscribers','subscribed_at'), ('business_subscribers','confirmed_at'), ('business_subscribers','promoted_contact_id'), ('business_subscribers','promoted_at'), ('business_subscribers','created_at'), ('business_subscribers','updated_at'),
    ('business_subscribers','user_id'), ('business_subscribers','email_normalized'),
    ('marketing_consent_events','id'), ('marketing_consent_events','contact_id'), ('marketing_consent_events','email'), ('marketing_consent_events','channel'), ('marketing_consent_events','purpose'), ('marketing_consent_events','decision'),
    ('marketing_consent_events','method'), ('marketing_consent_events','statement_text'), ('marketing_consent_events','statement_locale'), ('marketing_consent_events','statement_version'), ('marketing_consent_events','privacy_policy_url'), ('marketing_consent_events','source_surface'),
    ('marketing_consent_events','source_page_url'), ('marketing_consent_events','evidence'), ('marketing_consent_events','redacted_at'), ('marketing_consent_events','occurred_at'), ('marketing_consent_events','created_at'), ('marketing_consent_events','user_id'),
    ('marketing_consent_events','email_normalized'), ('marketing_consent_events','ip_hash'), ('marketing_consent_events','ip_hash_salt'), ('marketing_consent_events','user_agent'), ('marketing_consent_events','session_id'), ('marketing_consent_events','recorded_by'),
    ('marketing_consent_settings','capture_enabled'), ('marketing_consent_settings','statement_en'), ('marketing_consent_settings','statement_es'), ('marketing_consent_settings','statement_he'), ('marketing_consent_settings','statement_version'), ('marketing_consent_settings','privacy_policy_mode'),
    ('marketing_consent_settings','privacy_policy_url'), ('marketing_consent_settings','privacy_policy_body'), ('marketing_consent_settings','privacy_policy_updated_at'), ('marketing_consent_settings','postal_address'), ('marketing_consent_settings','label_as_advertisement'), ('marketing_consent_settings','created_at'),
    ('marketing_consent_settings','updated_at'), ('marketing_consent_settings','user_id'),
    ('email_unsubscribes','id'), ('email_unsubscribes','contact_id'), ('email_unsubscribes','email'), ('email_unsubscribes','reason'), ('email_unsubscribes','unsubscribed_at'), ('email_unsubscribes','user_id')
),
live AS (
  SELECT table_name::text, column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences', 'email_sequence_steps', 'email_sequence_enrollments', 'business_subscribers', 'marketing_consent_events', 'marketing_consent_settings', 'email_unsubscribes')
)
SELECT coalesce(l.table_name, d.table_name) AS table_name,
       coalesce(l.column_name, d.column_name) AS column_name,
       CASE WHEN d.column_name IS NULL THEN 'drift: live, not declared'
            ELSE 'missing: declared, not live' END AS problem
FROM live l
FULL OUTER JOIN declared d USING (table_name, column_name)
WHERE l.column_name IS NULL OR d.column_name IS NULL
ORDER BY 1, 2;
```

### Tests (T-8) and mutation checks (C-8)

All in existing suites (no new file, job or script). New cases: `exportClassification.test.ts` DE-6 N-1, N-2 (inline live set from §11.1, Q2 counts), N-9 rowKey CI rules + single-use pin + converse rule, N-3 / SA-Q5 deny pins; `sections.test.ts` C-4 helper cases, N-4, N-5, registry rows, F-DE6-1; `BusinessDataExportRepository.test.ts` nine paged sections, N-9 (0 / 1 / 2 rows, maxRows 0, query shape, PostgREST error, five fail-closed plants), N-3 at request time, N-8 crossed pointers + negative control, N-10; `route.characterization.test.ts` re-pin (33 tables, 10 literal selects, single-row chain, F-DE6-1 test, N-6 body check, 3 never-read tables); `route.test.ts` N-6, N-7, N-14, N-15 (paged and single-row).

Mutation checks, each applied to the source in place, run, then restored and verified (sha256 / diff; never `git stash`). All red:

| # | Mutation | Red tests |
|---|---|---|
| M1 | `consentEventRow` removed from the registry | 41 (incl. N-6 route, sections, characterization) |
| M2 | F-DE6-1 strip removed from `sourceMetadata` | 41 (incl. F-DE6-1 sections + characterization, N-5) |
| M3 | `CONSENT_EVIDENCE_KEYS` + `'ip'` | 5 (N-4, consent row, N-6) |
| M4 | The five SA-Q5 exact names removed | 5 (deny pin, CI and request-time plants) |
| M5 | Single-row read accepts 2 rows | 2 (N-9 two rows, N-8 negative control) |
| M6 | Converse rule (include without rowKey lists `id`) removed | 1 |
| M7 | `subscriberRow` removed | 2 (N-5, N-6) |
| M8 | `source_page_url` strip removed | 2 |
| M9 | `.order('id')` added to the single-row read | 2 (N-9 query shape, N-14) |
| M10 | rowKey "`user_id` not in columns" check removed | 1 |

N-1 / N-2 / N-10 / N-16 negative controls are planted copies inside the tests themselves (re-planned subscribers, `ip_hash_salt` moved into columns, reworded exclude, `rowFilter` on forms, extra and missing live columns, `smart_links` plants).

### T-11 runs and runtimes (C-10)

| Run | Result |
|---|---|
| `npx jest lib/business-os/data-export lib/business-os/purge lib/repositories/__tests__/BusinessDataExportRepository.test.ts app/api/user/data-export lib/client` | 27 suites, **881 passed** (baseline before DE-6: 27 suites, 781) |
| `npm run test:bos-entitlements` | 280 suites, **8520 passed** (baseline 8459) |
| `npm run test:authz-guard` | 2 suites, 203 passed |
| `tsc --noEmit` (whole project, filtered to data-export, purge, export repository) | 0 errors |

Per-suite runtime, `--runInBand`, same machine, origin/main `98735db9` sources vs this branch (the baseline was measured by swapping in the old files and restoring them, sha256-verified):

| Suite | Before | After |
|---|---|---|
| `route.characterization.test.ts` | 2.19 s (92) | 2.79 s (117) |
| `route.test.ts` | 0.93 s (26) | 1.04 s (31) |
| `exportClassification.test.ts` | 1.45 s (117) | 1.31 s (136) |
| `sections.test.ts` | 0.56 s (49) | 0.62 s (69) |
| `SchemaReconciler.test.ts` | 0.62 s (31) | 0.56 s (31) |
| `BusinessDataExportRepository.test.ts` | 7.93 s (60) | 8.22 s (91) |
| **Sum** | **13.69 s (375)** | **14.55 s (475)** |

About **+0.9 s** in total, none of it on the `next build` critical path (the route and repository suites run inside `test:bos-entitlements`, the rest in the sharded Jest gate). Whole-run wall clocks moved by machine load (entitlements 201 s before, 142 s after), so the per-suite table is the comparable number.

### Deviations and items for SA

| # | Item |
|---|---|
| D-1 | **T-3 negative controls re-planted** (`exportClassification.test.ts`): `['*']`, `['a, b']`, `['Id']` became `['id', '*']` etc. The new converse rule would otherwise add a second problem to each and blur which rule the case pins. Same assertions |
| D-2 | **`SchemaReconciler.test.ts` re-pinned** (not in §6's file list): its included-table list gains the 10 DE-6 tables, sorted and commented, as DE-5 D-5 did |
| D-3 | **T-10 extra plants:** `exportColumnsOf` "throws" cases now include `smart_links` (planned DE-7), `lead_responses` and `marketing_consent_state` (excluded) |
| D-4 | **F-DE6-1 also cuts `referrer_url` / `capture_page_url` in subscriber attribution** through the same `sourceMetadata` (C-2): one helper for one shape. A non-URL key holding `?` (e.g. a `utm_source`) is not touched (pinned) |
| D-5 | The `marketing_consent_settings.user_id` reason is `OWNER_ID` plus "; it is also the row key (one row per owner)". The pin checks the reason **starts with** `OWNER_ID` |
| D-6 | The single-row branch is inline in `listOwnedRowsForExport` (no private helper), per SA-Q1 (4) "no new method". It also fails closed at request time on a rowKey other than `user_id` or a `rowFilter` beside it, which CI already reports |
| D-7 | `privacy_policy_url` kept as held (§11.2 Q7b 0 / 0, C-3) |
| D-8 | **Requirement:** §0.10 added and a note inserted under the §0.4.1 G Phase 1 order for the DE-10a placement (insert-only, 70 / 0). The §0.3.7 order line was not edited (insert-only) |
| SA-1 | C-9 (Q11) is reported in §11.2 by TL (0 / 0 / 0) |
| SA-2 | T-10 (C-11) is owed: TL runs Q12 above |
| SA-3 | Touched files with `console.*`: none (all already Pino) |

---

## QA Testing Report

(QA populates.)

### QA — DE-6 — 2026-10-16

**Test mode:** full
**Strategy used:** A + B (Jest unit and integration with a mocked Supabase), plus negative controls (mutations) and an edge-case test, both run only in a scratch copy. Option D does not apply because there is no UI change. The download is checked by hand after deploy (see below).
**Focus:** schema, security, api
**Skipped:** a live DB run (the worktree has no DB; TL's §11.1–§11.3 live results are the source) and a browser check (no UI change)
**Input source:** prompt keywords (TL), checked against N-1…N-16, C-1…C-12, §11.1–§11.3, F-DE6-1 and §13.1
**State tested:** the worktree as Dev left it. `git diff --numstat` was identical before and after QA. Nothing was stashed or committed. The negative controls and the QA edge test ran only in scratch copies under the session scratchpad (`de6qa/`). Each copy's `node_modules` junction was removed with `rmdir` before the copy was deleted, and the shared `node_modules` is intact.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| N-1 classification: 10 include, 2 exclude, 33 / 5 / 117, no `planned('DE-6')` | ✅ | Pass | Pins red under every column mutation below |
| N-2 column pins = §11.1 live set | ✅ | Pass | Moving any excluded column into `columns` is red (a1–a5, f1–f4, j1–j2) |
| N-3 / SA-Q5 visitor tracking never selected | ✅ | Pass | `ip_hash` (73 red), `ip_hash_salt` (76), `user_agent` (73) and `session_id` (73) moved into the events `columns` are each red, in CI (deny list) and at request time. `recorded_by` moved in is red (6) |
| N-4 `evidence` allow-list | ✅ | Pass | Adding `'ip'` to the list is red (43). Returning the raw evidence is red (42) |
| N-5 `attribution` = `SOURCE_METADATA_KEYS` | ✅ | Pass | Covered by the d1 mutation and the QA edge test |
| N-6 / C-4 no tracking value or token in the body; `source_page_url` cut | ✅ | Pass | Removing the `source_page_url` strip is red (41): the seeded `?token=TOK-XYZ&sid=SID-XYZ#frag` appears in the body |
| F-DE6-1 DE-4 `clients` URLs cut | ✅ | Pass | Removing the strip everywhere is red (42). Removing it on `clients` only, with subscribers still cut, is red (2: the F-DE6-1 sections test and the characterization test) |
| N-7 `lead_responses` / `marketing_consent_state` / `email_sends` never read | ✅ | Pass | A planted `from('lead_responses')` read is red (49). A planted `from('marketing_consent_state')` read is red (50) |
| BC-3 / BC-4 counters and `generated_from` out | ✅ | Pass | `generated_from` in is red (5). Campaign `sent_count` in is red (3). Sequence `total_opened` in is red (3). Step `clicked_count` in both lists is red (7) |
| N-9 single-row read | ✅ | Pass | Accepting 2 rows is red (2). Adding `.order` is red (3). An extra filter is red (7). A caller-supplied id in place of the session id is red (7) |
| N-8 / N-14 cross-tenant, planted ids | ✅ | Pass | Dropping `.eq('user_id')` on the paged path is red (69), including the DE-6 N-8 crossed-pointer case, U-6 and DE-5 M-7. Dropping it on the single-row path is red (5) |
| N-12 / C-7 DE-1…DE-5 output unchanged | ✅ | Pass | Reordering the DE-4 `crm_contacts` select is red (3, characterization chain). Dropping a DE-5 `payments` column is red (5). Dropping a DE-3 `preferences` column is red (8). A raw DE-5 `paymentRow` is red (43) |
| SA-Q8 `email_normalized` out | ✅ | Pass | Moving it into the columns is red on events (6) and on subscribers (4) |
| N-10 all history | ✅ | Pass | Dev suites, plus the QA edge test (withdrawn and granted history, redacted rows as held) |
| N-11 order, group and role | ✅ | Pass | The QA edge test confirms all 10 sections are `client_records` / processor |
| N-13 purge baseline | ✅ | Pass | The diff deletes exactly 12 lines in `descriptors.ts`, all of them `export: planned('DE-6')`. With `export:` stripped, the 12 rows are byte-identical before and after. Purge suites are green |
| N-15 ceiling, N-16 re-planted controls | ✅ | Pass | In the Dev suites (green) |
| Entitlements / authz guards | ✅ | Pass | The diff imports nothing from entitlements. Both scripts are green |
| No `.github` change, no `console.*`, no `any` | ✅ | Pass | `git status .github` is empty, and the diff adds neither `console.*` nor `any` |

All 28 negative controls went red. Each was applied to a scratch copy, run against the data-export, purge, export-repository and route suites, then restored (verified by diff against the worktree).

#### Edge cases (QA scratch test, 7 cases, all pass on the unmutated code)

| Case | Result |
|---|---|
| Owner with no `marketing_consent_settings` row (another owner has one) | `consent_settings` is ok with 0 rows |
| Exactly one row | ok, 1 row, no `user_id` key, no other owner's wording |
| Two rows for the owner (seeded) | `consent_settings` is `failed` with 0 rows, and neither row's content is in the body. Other sections are unaffected |
| `source_page_url` = `#frag-only` / `https://x.test/p?` / plain URL / `?token=…#…` / NULL | `''` / `https://x.test/p` / unchanged / `https://x.test/p` / NULL. `privacy_policy_url` with `?v=2` is kept as held |
| A non-URL key holding `?` (`utm_source: 'news?letter#x'`, `utm_campaign: 'spring?2026'`) in `clients.source_metadata` and subscriber `attribution` | Untouched. The URL keys are cut, and `ip_hash`, `user_agent` and `session_id` are dropped |
| Withdrawn and granted history for one address, plus a redacted event | All 3 are exported in order. The redacted row goes out as held (`redacted@invalid`, `redacted_at`, `evidence.note`). Extra evidence key `ip` is dropped. None of the 7 excluded columns appears. Another owner's event is absent |
| Seeded `lead_responses` | Never read. Neither is `marketing_consent_state` or `email_sends` |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The targeted suites run in about the same time as Dev's T-11 numbers (+0.9 s per suite in total), and nothing is added to the `next build` critical path.

#### Edge Cases (nice to fix)
1. **A URL that is only a fragment or a query becomes `''`, not NULL.** For example `#frag` becomes `''`, and so does `?only=query`. Dev pins this, it matches the SA-Q7 rule ("cut at the first `?` or `#`"), and it leaks nothing. It is noted only so DE-8b's README does not promise that an empty page address means none was recorded. Severity: Low.

### Test Outputs / Logs

| Run | Result | Time |
|---|---|---|
| `npx jest lib/business-os/data-export lib/business-os/purge lib/repositories/__tests__/BusinessDataExportRepository.test.ts app/api/user/data-export lib/client` | 27 suites, **881 passed** | Jest 28.3 s (43 s wall) |
| `npx jest lib/repositories/__tests__/userDataExportReads.test.ts` | 1 suite, 11 passed | 3.7 s |
| `npm run test:bos-entitlements` | 280 suites, **8520 passed** | Jest 132 s (2 min 21 s wall) |
| `npm run test:authz-guard` | 2 suites, **203 passed** | 55.6 s |
| `tsc --noEmit` (whole project, scratch copy, filtered to data-export, purge and the export repository) | 0 errors | — |
| Full `npx jest --ci`, DE-6 worktree | 1493 suites, 37664 tests: 37459 passed, **140 failed in 20 suites**, 65 skipped | 17 min 05 s wall |
| Full `npx jest --ci`, baseline (git archive + git init, scratch) | 1500 suites, 37683 tests: 37478 passed, **140 failed in 20 suites**, 65 skipped | 18 min 22 s wall |

**Baseline note.** `origin/main` moved to `fcce705a` (#442, settings drawer Phase C) between the worktree's base `ac674ceb` and the archive. That accounts for the baseline's 7 extra suites (settings / address-book) and for the `MarketingConsentPanel.pickerCall.guard` count. #442 touches no data-export, purge, export-repository or route path (`git diff HEAD origin/main` on those paths is empty), so the comparison is valid.

**The 20 failing suites are the same 20 on both sides (set difference: empty), and there are no new failures.** They are all pre-existing:
- Known / flaky: `oneAddressPolicy.guard`, `publicEndpointsAreThrottled.guard`, `bookingsSearchAndPaging.guard`, `supabaseFetch`.
- Pre-existing elsewhere on main: V4 / V6 / pilot / orchestration suites (`v4-generator`, `LogicalIRCompiler`, `validation`, `IRToNaturalLanguageTranslator`, `StructuredTransforms` ×3, `ConditionalEvaluator` ×2, `TokenBudgetManager`, `IntentClassifier`), `openaiPricingAdapter`, onboarding (`servicesAreDraftsWithWords.guard`, `theChainHoldsEndToEnd`) and contact-drawer guards (`jobOverAfterHeldMeeting`, `noIntakeToSendOnADeadJob`).

`finance.source.guard` did not fail on either side in this run. The only per-suite count changes on DE-6 files are the expected additions: characterization 92→117, route 26→31, classification 117→136, sections 49→69, repository 60→91.

### Manual check for the user after deploy (Business OS)

Download "my data" from a Business OS account that has intake, consent and (if any) newsletter or email data. Then check the following:
1. `client_records` has 10 new sections after `client_payment_methods`: `intake_settings`, `intake_forms` (every version, drafts and archived included), `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `newsletter_subscribers`, `consent_records`, `consent_settings` and `email_unsubscribes`.
2. `consent_records` shows, for each grant or withdrawal, the wording agreed to, its language and version, the time, the method and the form. The page address appears without its `?…` / `#…` part.
3. `consent_settings` shows one row with your consent sentence per language, your privacy notice, your postal address and the advertisement label.
4. No internet address, browser or visit data appears anywhere in the file. Search it for `ip_hash`, `salt`, `user_agent` and `session`.
5. No list of automatic reminders or invitations sent appears, and there are no sent / opened / clicked counts.
6. In `clients`, each contact's lead page and referrer addresses are now shown without their `?…` / `#…` part.

### Final Status
- [x] All acceptance criteria pass — ready for commit (no bug open; one Low edge note)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

(RM populates.)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created (Dev, workplan only) | 12 tables: 10 include, 2 exclude (`marketing_consent_state` derived, `lead_responses` activity); single-row `rowKey` read for `marketing_consent_settings` (SA-Q1); `evidence` and `attribution` allow-lists through `pickStringKeys`; consent-proof column map; SQL Q1–Q11 for TL; SA-Q1…Q10; BC-1…BC-8 |
| 2026-10-16 | Code complete (Dev) | T-2…T-12 per SA review C-1…C-12, §11.2 and TL F-DE6-1; Dev Notes added (C-5 writers, Q12 drift SQL, runtimes, mutation checks M1…M10, deviations D-1…D-8). Uncommitted |

### 11.1 T-0 live results — 2026-10-16 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)

**Q1–Q3 columns and keys** (`!` NOT NULL, `(gen)` generated):
| Table | n | Columns | Keys |
|---|---|---|---|
| business_intake_forms | 10 | id!, user_id!, version!, status!, questions:jsonb!, generated_at, generated_from:jsonb, published_at, created_at!, updated_at! | PK id; UNIQUE (user_id, version) |
| business_subscribers | 14 | id!, user_id!, email!, email_normalized(gen), name, status!, source!, attribution:jsonb!, subscribed_at!, confirmed_at, promoted_contact_id, promoted_at, created_at!, updated_at! | PK id; UNIQUE (user_id, email_normalized) |
| email_campaigns | 17 | id!, user_id!, name!, subject!, body_html!, body_text, segment_filter:jsonb, status, scheduled_at, sent_at, recipients_count, sent_count, opened_count, clicked_count, failed_count, created_at, updated_at | PK id |
| email_sequence_enrollments | 9 | id!, user_id!, sequence_id!, contact_id!, status, current_step_number, next_send_at, enrolled_at, completed_at | PK id; UNIQUE (sequence_id, contact_id) |
| email_sequence_steps | 12 | id!, sequence_id!, user_id!, step_number!, delay_minutes!, subject!, body_html!, body_text, sent_count, opened_count, clicked_count, created_at | PK id; UNIQUE (sequence_id, step_number) |
| email_sequences | 12 | id!, user_id!, name!, description, trigger_type!, trigger_config:jsonb, is_active, total_sent, total_opened, total_clicked, created_at, updated_at | PK id |
| email_unsubscribes | 6 | id!, user_id!, contact_id, email!, reason, unsubscribed_at | PK id; UNIQUE (user_id, email) |
| lead_responses | 16 | id!, user_id!, contact_id!, kind!, status!, recommendation:jsonb, service_id, claimed_by, claimed_at, attempts!, next_attempt_at, skip_reason, error_message, sent_at, created_at!, entity_id! | PK id; UNIQUE (kind, contact_id, entity_id) |
| marketing_consent_events | 24 | id!, user_id!, contact_id, email!, email_normalized(gen), channel!, purpose!, decision!, method!, statement_text, statement_locale, statement_version, privacy_policy_url, source_surface, source_page_url, ip_hash, ip_hash_salt, user_agent, session_id, recorded_by, evidence:jsonb!, redacted_at, occurred_at!, created_at! | PK id |
| marketing_consent_settings | 14 | user_id!, capture_enabled!, statement_en, statement_es, statement_he, statement_version!, privacy_policy_mode!, privacy_policy_url, privacy_policy_body, privacy_policy_updated_at, postal_address, label_as_advertisement!, created_at!, updated_at! | **PK user_id (no `id`)** |
| marketing_consent_state | 8 | user_id!, email_normalized!, channel!, consented!, contact_id, last_event_id!, decided_at!, updated_at! | PK (user_id, email_normalized, channel) — no `id` |
| user_intake_settings | 6 | id!, user_id!, is_enabled, send_after_booking, created_at, updated_at | PK id; UNIQUE user_id |

All 12 have `user_id NOT NULL`. **`marketing_consent_settings` has no `id`** → SA-Q1 one-row read needed (or exclude).

**Q4 rows:** intake_settings 4, intake_forms 4, campaigns 0, sequences 0, steps 0, enrollments 0, unsubscribes 3, consent_state 11, consent_events 16, consent_settings 1, subscribers 0, lead_responses 29. Max per owner on the two settings tables: 1 / 1.

**Q5 jsonb:** question keys = help, id, label, maxFiles, options, required, showIf, type; question types = file, long_text, number, short_text, single_choice, yes_no. segment_filter / trigger_config / attribution: no keys present (0 rows). evidence keys = client_statement, confirmed_via. generated_from keys = model, serviceIds, source, subVertical, vertical.

**Q6 values:** intake forms published 4. Consent events: granted/owner_entered 4, withdrawn/unsubscribe_link 4, granted/web_form 6, granted/double_optin_confirm 2 (all email/marketing). Unsubscribe reasons: unsubscribe_link 3. lead_responses: meeting_reminder/sent 25, invite/skipped 2, invoice_chase/skipped 1, invite/sent 1.

**Q7 tracking:** of 16 consent events: ip_hash 6, ip_hash_salt 6, user_agent 8, session_id 6, recorded_by 8 (all = owner), redacted 0. **`source_page_url`: 4 have a query string, 2 carry token-like parameters (`token|session|sid|code=`)** → SA-Q7 must strip or exclude the query string.

**Q8 size:** largest owner 9 rows across these tables. **Q9 cross-tenant:** 0 on all edges. **Q10:** no soft-delete columns. **recorded_by not the owner:** 0.

### 13.1 Business calls — TL defaults 2026-10-16 (user said run autonomously; user may change)
Following the user's earlier decisions (activity OUT, tracking OUT, AI-generated OUT, everything-we-hold IN):
| BC | TL default |
|---|---|
| BC-1 consent technical evidence (ip_hash, salt, user agent, session id) | **OUT** |
| BC-2 automatic invitations / chases / reminders (lead_responses) | **OUT** (activity) |
| BC-3 campaign / sequence sent / opened / clicked counts | **counts OUT**; campaign, status, sent date IN |
| BC-4 intake form drafts and old versions | **all versions IN**; `generated_from` (AI) OUT |
| BC-5 unconfirmed / left newsletter sign-ups | **IN** with status |
| BC-6 separate "current answer per address" list | **NO** (history + do-not-email list instead) |
| BC-7 consent settings (statements per language, privacy notice, postal address) | **IN** |
| BC-8 consent records of later-erased people (address removed) | **IN as held** |

### 11.2 SA-owed reads — 2026-10-16 (TL, read-only, prod)
- **Q7b:** `privacy_policy_url` token-like 0, with query string 0 → **no strip needed on privacy_policy_url** (SA-Q7).
- **Q11 (C-9):** consent_state key mismatch vs its last event **0**; state disagreeing with the latest event **0**; state rows with no event group **0** → `marketing_consent_state` is fully rebuildable from events; exclusion stands (SA-Q3).
- **F-DE6-1 (DE-4 clients):** `crm_contacts.source_metadata.capture_page_url` with a query string 1, token-like 0; **`referrer_url` token-like on 4 contacts**. Already live in the DE-4 export. **TL decision: fold the fix into DE-6** — apply the same query-string/fragment strip helper to DE-4's `clients.source_metadata` `capture_page_url` and `referrer_url`, as a deliberate DE-4 re-pin with `DE-6 (F-DE6-1):` comments and a test seeding token-like params that must not appear. This is the only permitted change to DE-1..DE-5 output (C-7 otherwise stands).

### 11.3 T-10 / C-11 drift — 2026-10-16 (TL, read-only, prod)
Dev's 124 declared names (include ∪ excluded) for the 10 included tables vs `information_schema.columns`, FULL OUTER JOIN: **0 drift, 0 missing** (124 distinct). T-10 ✅.
