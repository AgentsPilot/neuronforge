# Workplan: Contact inbox to CLAUDE.md standard

> **Last Updated**: 2026-11-28

**Developer:** Dev
**Requirement:** none written. The brief is the user decision of 2026-11-27: keep the admin contact-form inbox (`/admin/messages`) and bring its four routes up to CLAUDE.md standard.
**Branch:** `fix/contact-inbox-standard` (worktree `neuronforge-contact-inbox`, cut from `origin/main` 50033f89)
**Date:** 2026-11-27
**Status:** Committed, PR open (SA code approved, QA passed, user approved the commit + PR on 2026-11-28; the user merges)

## Overview

The admin Messages screen reads and edits rows of `contact_messages` through three admin routes. A fourth admin route (`messages/[id]/replay`) is no longer called by anything. The public route `/api/contact` saves a message and sends email. All four routes call Supabase directly, three use `console.*`, none uses Zod, and the error responses do not follow the CLAUDE.md format. This slice moves every database call into one new repository, validates every input with Zod, puts every route on Pino with a correlation id, and updates the public contact route: input is validated and rate limited, it sends mail only to our own inbox, and it uses the shared email transport. The screen's response shapes stay the same, so no file under `app/admin/messages/` changes. No schema change and no migration.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Decisions for SA](#decisions-for-sa)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Rollback](#rollback)
- [Out of Scope and Flagged](#out-of-scope-and-flagged)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

### What exists today

| File | Handler | Current problems |
|---|---|---|
| `app/api/contact/route.ts` | `POST` (public) | Module-level service-role `createClient` (rule 1). Checks fields by hand, no Zod, no length caps (rule 2). No rate limit. Builds its own nodemailer Gmail transport from `GMAIL_*` env vars instead of using `lib/notifications/emailTransport.ts`. Sends two emails: a confirmation to the submitted address, and a notification to `CONTACT_FORM_INBOX`. Errors are `{ error }` only. No correlation id. |
| `app/api/admin/messages/route.ts` | `GET` | Direct client (rule 1). 2 × `console.error` (rule 3). `filter` and `search` are not validated (rule 2). The raw `search` text is put straight into a PostgREST `.or()` string, so commas, parentheses and quotes in it change the filter. One replies query per message (N+1). `select('*')`, no row limit. |
| `app/api/admin/messages/[id]/route.ts` | `PATCH`, `DELETE` | Direct client (rule 1). 4 × `console.error` (rule 3). `PATCH` passes the whole request body to `.update(body)`, so any column can be written. `[id]` is not checked as a uuid. A missing row on `PATCH` comes back as a 500. No audit. |
| `app/api/admin/messages/[id]/replay/route.ts` | `POST` | No caller (Reply was removed from the page, D-14 (b)). Inserts a hardcoded fake `admin_id`. Its "send email" is a TODO `console.log`. 2 × `console.error` + 1 × `console.log`. |

`console.*` in scope: **9 calls in 3 files** (GET 2, `[id]` 4, replay 3). `/api/contact` already uses Pino. All 9 are removed by this slice (CLAUDE.md § Logging: flag → propose → convert; the brief already approves the conversion).

### Tables (verified by the main session against the dev DB; no change in this slice)

| Table | Notes |
|---|---|
| `contact_messages` | `id` uuid pk, `name`, `email`, `message` (text, not null), `status` text default `'unread'` (no CHECK), `email_sent` bool, `created_at` timestamptz, `subject`/`phone`/`company` varchar, `priority` varchar CHECK low/normal/high/urgent, `source` varchar CHECK contact_form/email/phone/chat, `updated_at` **timestamp without time zone**, `admin_notes` text. |
| `message_replies` | `id` uuid pk, `message_id` FK → `contact_messages` **ON DELETE CASCADE**, `sender` CHECK admin/user, `content`, `created_at`, `admin_id`. |

Both are server-only (RLS on, all grants revoked from `anon` / `authenticated`, migration 20261056). Both hold 0 rows. Neither has a `user_id`: they are platform-level data, not tenant data. The service role is therefore intentional and the CLAUDE.md rule 4 exemption is written down in the repository header (the `ExchangeRatesRepository` precedent).

### What the UI depends on (must not change)

Read from `app/admin/messages/page.tsx` and `app/admin/components/layout/readAdminResponse.ts`:

| Request the page sends | What it reads back |
|---|---|
| `GET /api/admin/messages?filter=<all\|unread\|read\|replied>&search=<text, often empty>` | On 200: `body.messages`, trusted only when it is an array. On non-200: `readAdminResponse` shows the route's `error` string verbatim, or "Your admin session has ended" for 401/403. |
| `PATCH /api/admin/messages/{id}` with `{ status, updated_at }` | `response.ok` only. |
| `PATCH /api/admin/messages/{id}` with `{ admin_notes, updated_at }` | `response.ok` only. |
| `DELETE /api/admin/messages/{id}` | `response.ok` only. |

Two things follow:

1. **The page sends `updated_at` in both PATCH bodies.** A plain `.strict()` schema would reject every save from the page. The schema must accept `updated_at` and throw it away (the server sets the time). See D-3.
2. **The list 200 must keep `messages` at the top level.** Adding `success: true` next to it is harmless (the page does not look for it). The page's F-111 comment ("the 200 is `{ messages }` with no `success`") becomes slightly out of date; the page file is not edited, per the brief.

`MessageDetail` and `MessagesTable` still read `message.replies` (through `repliesOf`, array-only). The list keeps returning `replies: []` per row, now from one embedded query.

### Existing infrastructure this slice reuses (no new pattern)

| Need | Reused from |
|---|---|
| Rate limit | `lib/security/rateLimit.ts` (`rateLimit`, `RATE_LIMITS`, `tooManyRequests`) over `lib/repositories/RateLimitRepository.ts` (atomic `rate_limit_hit` RPC, hashed caller key, fails open). Already used by the `/api/book/manage/**` and account routes. **No new rate-limit pattern is needed.** |
| Email | `sendEmail` in `lib/notifications/emailTransport.ts`: Resend → SMTP → Gmail, the recipient allow-list guard built in, never throws. |
| Safe search text in `.or()` | `quoteFilterValue` (`lib/repositories/AdminJobsQueuesRepository.ts`: double-quotes a PostgREST logic-tree value, escaping `"` and `\`) plus `ilikeContainsPattern` / `matchesLiterally` (`lib/repositories/BusinessProfileRepository.ts`: escapes `\`, `%`, `_`, sends `*` as `_` and drops the extra rows afterwards). |
| Admin gate | `requireAdmin` (`lib/admin/requireAdminRoute.ts`), first statement, unchanged. |
| Audit before responding | `logAndFlush` (`lib/audit/boundedAuditFlush.ts`), the precedent used by the exchange-rate and queue-action admin routes. |
| Admin-only, no-`user_id` repository header | `ExchangeRatesRepository.ts` and `AdminTokenUsageAnalyticsRepository.ts`. |

---

## Implementation Approach

### 1. `ContactMessagesRepository` (new, `lib/repositories/ContactMessagesRepository.ts`)

Built from the `new-repository` skill: optional injected `SupabaseClient`, default `supabaseServer`, `createLogger({ service: 'ContactMessagesRepository' })`, every method returns `{ data, error }` and never throws, singleton `contactMessagesRepository` at the bottom, types in `lib/repositories/types.ts`, class + singleton + types exported from `lib/repositories/index.ts`.

**Header comment** (stated, as `ExchangeRatesRepository` does): why there is no `.eq('user_id', …)` (the tables have no owner column; they are platform data); why `supabaseServer` is intentional (server-only tables, no browser grants); authorisation is the caller's job; the only permitted callers are `app/api/admin/messages/**` (behind `requireAdmin`) and `app/api/contact/route.ts` (insert + mark-sent only); never import from a `'use client'` file. A small importer guard pins that caller list (see Test Plan).

**Columns are listed, never `*`:**

- `CONTACT_MESSAGE_COLUMNS = 'id, name, email, message, status, email_sent, created_at, subject, phone, company, priority, source, updated_at, admin_notes'` (every column the UI type `ContactMessage` declares, which is every column of the table).
- `MESSAGE_REPLY_COLUMNS = 'id, message_id, sender, content, created_at, admin_id'`.

**Methods:**

| Method | Query | Returns |
|---|---|---|
| `listForAdmin(ctx, { status, search, limit })` | `from('contact_messages').select(\`${CONTACT_MESSAGE_COLUMNS}, replies:message_replies(${MESSAGE_REPLY_COLUMNS})\`)`, `.order('created_at', { ascending: false })`, `.order('created_at', { referencedTable: 'message_replies', ascending: true })`, `.eq('status', status)` when not `'all'`, the safe search below, `.limit(limit)`. **One query**: the N+1 is gone. | `ContactMessageWithReplies[]` (`replies` always an array) |
| `updateForAdmin(ctx, id, patch)` | `patch` is typed `{ status?: ContactMessageStatus; admin_notes?: string }` only. `.update({ ...picked, updated_at: new Date().toISOString() }).eq('id', id).select(CONTACT_MESSAGE_COLUMNS).maybeSingle()`. The method copies the two known keys by name, so even a caller passing extra keys cannot widen the write. No `.or()`, so the mutation-plus-select guard is not touched. | the updated row, or `null` when no row has that id |
| `deleteForAdmin(ctx, id)` | `.delete().eq('id', id).select('id')`. Replies go with it (FK cascade). | `{ deleted: boolean }` |
| `createFromContactForm(input)` | `.insert({ name, email, message, status: 'unread', email_sent: false, source: 'contact_form' }).select('id').single()`. `created_at` is left to the column default. | `{ id }` |
| `markEmailSent(id)` | `.update({ email_sent: true, updated_at: … }).eq('id', id)`, no select. | `true` on success |

`ctx` is `{ correlationId, adminId }`, required and first on every admin method, and goes on each log line (the `AdminTokenUsageAnalyticsRepository` rule: an admin read or write is attributable). Log lines carry counts, ids, the status filter and `hasSearch`; **never** a name, email, message text, notes or the search text (the page's own SA M-4 rule).

`updated_at` is `timestamp without time zone`: an ISO string with `Z` is stored as the UTC wall time. That matches what the page sends today, so stored values do not change meaning.

**Safe search.** The search text never reaches the filter string raw:

```typescript
const pattern = quoteFilterValue(ilikeContainsPattern(search));
query = query.or(SEARCH_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(','));
// then, only when search contains '*': rows.filter(row => SEARCH_COLUMNS.some(c => matchesLiterally(row[c], search)))
```

`SEARCH_COLUMNS = ['name', 'email', 'message', 'subject', 'company']` (today's five). The two helpers are imported from the files that own them; nothing is copied. Zod has already trimmed the text and capped it at 100 characters (D-5).

### 2. Zod schemas (new, `lib/validation/contactMessages.ts`)

| Schema | Rule |
|---|---|
| `contactFormBodySchema` | `name` trimmed, 1–200; `email` trimmed (case kept as typed), `.email()`, max 254; `message` trimmed, 1–5000. Unknown keys stripped (default Zod behaviour; there is no caller to break). |
| `adminMessagesListQuerySchema` | `filter`: enum `all \| unread \| read \| replied`, default `all`. `search`: string, trimmed, max 100, default `''`. Built from `request.nextUrl.searchParams`. |
| `adminMessagePatchSchema` | `.strict()` object of `status` (enum `unread \| read \| replied`), `admin_notes` (string, max 5000, `''` allowed so notes can be cleared), and `updated_at` (optional string, **accepted and discarded**: the page sends it, the server sets the time). `.refine`: at least one of `status` / `admin_notes`. Any other key is a 400. |
| `adminMessageIdParamSchema` | `z.string().uuid()`. |

The status values are one exported `CONTACT_MESSAGE_STATUSES` tuple, also used for the repository type.

### 3. The routes (Pino, correlation id, CLAUDE.md error format)

Every handler starts with `const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID(); const requestLogger = logger.child({ correlationId });`. Admin handlers keep `requireAdmin(requestLogger)` as their first statement (unchanged, and the surface guard checks it). Errors are `{ success: false, error, details }` with `details` only when `NODE_ENV === 'development'`. A `ZodError` (or invalid JSON) is a 400 `{ success: false, error: 'Invalid input', details: dev-only flatten() }`.

| Route | Success body | Failures |
|---|---|---|
| `GET /api/admin/messages` | `{ success: true, messages }` (same `messages` key and row shape as today) | 400 invalid query; 500 `'Failed to fetch messages'` (same string the page shows today) |
| `PATCH /api/admin/messages/[id]` | `{ success: true, message: row }` (today's `message` key kept) | 400 bad id or body; 404 `'Message not found'`; 500 `'Failed to update message'` |
| `DELETE /api/admin/messages/[id]` | `{ success: true }` (unchanged) | 400 bad id; 500 `'Failed to delete message'`; already gone → see D-7 |
| `POST /api/contact` | `{ success: true, emailSent, message }` (see D-8 for `messageId`) | 429 throttled; 400 invalid input; 500 `'Failed to save message'` / `'Internal server error'` |

### 4. `/api/contact`: what changes

Order inside the handler:

1. correlation id + `requestLogger`;
2. `rateLimit(request, 'contact-form', RATE_LIMITS.create)` before reading the body; refused → `tooManyRequests(RATE_LIMITS.create.windowSeconds)` (429). `create` is 10 per 15 minutes per caller, the shape the limiter documents for "creating something from a stranger";
3. parse JSON + `contactFormBodySchema`;
4. `contactMessagesRepository.createFromContactForm(...)`; error → 500 `'Failed to save message'`;
5. **one** `sendEmail({ kind: 'transactional', to: [CONTACT_FORM_INBOX], replyTo: email, subject, html, text })`. The confirmation email to the submitted address is removed (D-1). The recipient allow-list check is now done by the shared transport, so the route's own `checkOutboundRecipients` / `mayEmail` code goes;
6. `emailSent = result.sent`; when true, `markEmailSent(id)` (a failure there is logged, not returned);
7. respond.

The notification HTML stays in the route, unchanged apart from the subject (D-9): same `escapeHtml(...)` calls, same escape-then-`<br>` order, so the `emailIsInlineStyled` guard's escaping tests still pass on this file. The confirmation HTML (the gradient header, the viewport meta) is deleted with the confirmation send, which breaks two assertions in that guard; they are amended (D-2).

No audit entry on the public route: there is no signed-in actor and the row itself is the record. (SA may rule otherwise; see D-6.)

### 5. Delete the replay route

`app/api/admin/messages/[id]/replay/route.ts` is deleted (D-4). After this, nothing in `app/` or `lib/` writes `message_replies`; the list still reads it through the embed, so the screen behaves the same. The table is kept (the brief: no schema change).

### 6. Audit trail on PATCH and DELETE

Proposed (D-6): two new events, one new entity type, written with `logAndFlush` after the write succeeded, never before, never failing the request.

| Item | Value |
|---|---|
| Events (`lib/audit/events.ts`) | `CONTACT_MESSAGE_UPDATED` (severity `info`, `SOC2`), `CONTACT_MESSAGE_DELETED` (severity `warning`, `SOC2`: irreversible, replies go with it) |
| Entity type (`lib/audit/types.ts`) | `'contact_message'`, entity id = the message uuid |
| `userId` / `actorId` | the admin's own id (`gate.user.id`) for both, as the exchange-rate routes do. The row has no owner account |
| Owner visibility (`lib/audit/ownerVisibility.ts`) | `'owner'`, with the `exchange_rate` / `archive_run` reason: written with the admin's own id, so it hides nothing from anyone but that admin, and the owner-policy `NOT IN` list is unchanged → **no migration** |
| Audience (`lib/audit/eventAudience.ts`) | `'shared'` (admin/system events) |
| `changes` / `details` | `changes.after: { status }` when status changed; `details: { fields: ['status' \| 'admin_notes'], correlationId }`. **Never** the name, email, message text or the notes themselves |

No extra read for a `before` value (D-6 asks whether SA wants one).

---

## Decisions for SA

| # | Question | Dev recommendation |
|---|---|---|
| D-1 | The public contact route sends mail only to our own inbox (`CONTACT_FORM_INBOX`), with `replyTo` = the submitted address. The confirmation email to the submitted address is removed. | **Yes.** Also removes the only reason for a second send and for the route's own recipient checks. The success `message` text drops "and sent you a confirmation email". |
| D-2 | Dropping the confirmation breaks two assertions in `lib/email/__tests__/emailIsInlineStyled.guard.test.ts` ("the gradient header has a solid colour behind it" and the `contact` half of "both declare a viewport"), which pin markup that only the confirmation had. | Amend: drop the contact half of both (the approval half stays), and keep the file in `SENDERS` plus both escaping tests, which still apply to the notification. Alternative: wrap the notification in a full HTML document with a viewport meta so only the gradient assertion goes. Dev prefers the first (smaller). |
| D-3 | PATCH body: `.strict()` with `updated_at` accepted and discarded, versus editing the page to stop sending `updated_at`. | Accept-and-discard. Keeps `app/admin/messages/**` untouched, as the brief prefers. |
| D-4 | Delete `messages/[id]/replay` (no caller, fake `admin_id`, stub email). | **Delete.** Adjust: `adminGate.writes.test.ts` (import, case row, `CASES` length 68 → 67, the D2 comment "(5 files)" and its mention of `replay`); `rls-disabled-tables-slice2` allow-list; `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` row 38 struck through and named in the "Struck-through rows" sentence. |
| D-5 | Length caps: name 200, email 254, message 5000, search 100, admin notes 5000. | As listed. |
| D-6 | Audit: add `CONTACT_MESSAGE_UPDATED` / `CONTACT_MESSAGE_DELETED` + entity type `contact_message` (owner-visibility `'owner'`, audience `'shared'`), via `logAndFlush`? Record a `before` status (one extra read per PATCH) or `after` only? Audit the public POST? | Add both events, `logAndFlush`, `after` only, no audit on the public POST. |
| D-7 | DELETE of an id that no longer exists: 404, or 200 (idempotent)? | **200** (`{ success: true }`), logged with `deleted: false`. A 404 would show "Could not delete" on the page for a row that is already gone. PATCH on a missing id is a 404 (it has no row to return). |
| D-8 | The public response includes `messageId` today. Keep it? | Drop it: the caller has no use for our row id. Keep `success`, `emailSent`, `message`. |
| D-9 | Notification subject is `New Contact: ${name}` today. The shared transport logs the first 50 characters of a subject, so the submitter's name would go into our logs. | Fixed subject: `New contact form message`. The name is in the body. |
| D-10 | Add `'app/api/contact'` to `ROOTS` in `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts`, so the throttle on this route is pinned like the other public routes. | **Yes.** One extra directory walk, milliseconds. |
| D-11 | List row cap. Today the list is unbounded. | `.limit(500)` newest first, as a constant in the repository. Table holds 0 rows; this only bounds the future. No paging UI in this slice. |
| D-12 | Safe search: reuse `quoteFilterValue` + `ilikeContainsPattern` + `matchesLiterally` (keeps every character searchable), or refuse the PostgREST reserved characters in Zod (simpler, but a search for a comma becomes a 400)? | Reuse the helpers, imported from the two repositories that own them (no copy, no move). Unit tests pin the built filter string for `,` `(` `)` `"` `\` `%` `_` `*` `.` `:`; QA runs those searches once against the dev DB (see QA-3), because no Jest test reaches PostgREST. |
| D-13 | Body size: `request.json()` reads the whole body before Zod sees it. Add a `content-length` check (e.g. > 32 KB → 413) before parsing? | Optional; Dev leans **no** for this slice (the rate limit bounds the volume and Zod the stored size). SA rules. |

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/ContactMessagesRepository.ts` | create | The only DB access for both tables (rule 1) |
| `lib/repositories/types.ts` | modify | `ContactMessageStatus`, `ContactMessageRow`, `MessageReplyRow`, `ContactMessageWithReplies`, `CreateContactMessageInput`, `UpdateContactMessageInput` |
| `lib/repositories/index.ts` | modify | Export class, singleton, types |
| `lib/repositories/__tests__/ContactMessagesRepository.test.ts` | create | One block per method, injected client double |
| `lib/repositories/__tests__/contactMessagesRepository.callers.guard.test.ts` | create | Pins the importer list (admin messages routes + the contact route) |
| `lib/validation/contactMessages.ts` | create | The four Zod schemas + `CONTACT_MESSAGE_STATUSES` |
| `lib/validation/__tests__/contactMessages.test.ts` | create | Schema unit tests |
| `app/api/contact/route.ts` | modify | Repository, Zod, rate limit, shared transport, one send, error format |
| `app/api/contact/__tests__/route.allowList.test.ts` | delete | Tested the route's own transport and recipient checks, which are removed. Replaced by `route.test.ts` |
| `app/api/contact/__tests__/route.test.ts` | create | Happy path, 400, 429, save failure, send-not-delivered |
| `app/api/admin/messages/route.ts` | modify | Repository, Zod query, Pino, error format |
| `app/api/admin/messages/__tests__/route.test.ts` | create | Happy, 401/403, 400, 500 |
| `app/api/admin/messages/[id]/route.ts` | modify | Repository, uuid + strict body, Pino, error format, audit |
| `app/api/admin/messages/[id]/__tests__/route.test.ts` | create | PATCH + DELETE: happy, 401/403, 400, 404, 500, audit shape |
| `app/api/admin/messages/[id]/replay/route.ts` | delete | D-4 |
| `lib/audit/events.ts` | modify | Two events + metadata (D-6) |
| `lib/audit/types.ts` | modify | `'contact_message'` entity type |
| `lib/audit/ownerVisibility.ts` | modify | `contact_message: 'owner'` with the reason |
| `lib/audit/eventAudience.ts` | modify | Both events `'shared'` |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | SA C-2: count pin 79 → 81 shared, 236 → 238 registered, and the test title |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | Remove replay import and case; `CASES` 68 → 67; D2 comment |
| `supabase/migrations/__tests__/rls-disabled-tables-slice2.migration.test.ts` | modify | `contact_messages` → `['lib/repositories/ContactMessagesRepository.ts']`; `message_replies` → `[]` (the embed is not a `.from('message_replies')` call) |
| `lib/email/__tests__/emailIsInlineStyled.guard.test.ts` | modify | D-2 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | Remove the `app/api/contact/route.ts` entry from `EMAIL_SEND_SITES` (G-7): the file no longer has a provider import, a `sendMail` or a recipient check, and the G-7 test fails on a listed file that no longer sends |
| `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` | modify | D-10 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Row 38 struck through (D-4); Change History row |
| `docs/workplans/contact-inbox-standard-workplan.md` | create | This file |

**Not modified:** everything under `app/admin/messages/`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (it reads `messages/[id]/route.ts` and expects handlers `DELETE` and `PATCH`, each containing `requireAdmin(`: still true; its `>= 40` route floor is not affected by one deletion), `lib/notifications/emailTransport.ts`, `lib/security/rateLimit.ts`, any migration.

---

## Task List

- [x] T-0: ✅ SA approves this workplan; answers D-1 to D-13 recorded below.
- [x] T-1: ✅ `lib/validation/contactMessages.ts` + its tests.
- [x] T-2: ✅ types in `lib/repositories/types.ts`; `ContactMessagesRepository.ts`; barrel exports; repository unit tests; caller guard.
- [x] T-3: ✅ audit registrations (`events.ts`, `types.ts`, `ownerVisibility.ts`, `eventAudience.ts`); run `lib/audit/__tests__` (eventAudience, ownerVisibility, filterOptions, stepZeroRegistrations).
- [x] T-4: ✅ rewrite `app/api/admin/messages/route.ts` + route test.
- [x] T-5: ✅ rewrite `app/api/admin/messages/[id]/route.ts` + route test.
- [x] T-6: ✅ delete the replay route; update `adminGate.writes.test.ts` and the access doc.
- [x] T-7: ✅ rewrite `app/api/contact/route.ts`; delete `route.allowList.test.ts`; add `route.test.ts`.
- [x] T-8: ✅ guard updates: rls slice 2 allow-list, `emailIsInlineStyled`, `envConfigHardening` G-7, `publicEndpointsAreThrottled`.
- [x] T-9: ✅ grep the four route files and the repository for `console.`, `createClient`, `@supabase/supabase-js`: zero hits.
- [x] T-10: ✅ run the suites in the Test Plan; typecheck the touched files (filtered to them, and confirm the command did not die with an out-of-memory trace); `npm run lint` on touched files.
- [ ] T-11: hand to SA for code review.

---

## Test Plan

No test reaches the network: the repository tests inject a Supabase double through the constructor and mock `@/lib/supabaseServer` to `undefined` (the `ExchangeRatesRepository.test.ts` pattern); the route tests mock the repository singleton, `@/lib/admin/requireAdminRoute`, `@/lib/security/rateLimit`, `@/lib/notifications/emailTransport` and `@/lib/audit/boundedAuditFlush` (`logAndFlush` as `jest.fn().mockResolvedValue(undefined)`, so no hand-rolled audit sink is needed: a sink without `log` crashes inside the flush helper while the test still passes).

### Unit: repository (`ContactMessagesRepository.test.ts`)

| Method | Cases |
|---|---|
| `listForAdmin` | one `from('contact_messages')` call only (N+1 gone); select string contains the column list and the `replies:message_replies(...)` embed; `status` `'all'` adds no `.eq`; `'unread'` adds `.eq('status','unread')`; empty search adds no `.or`; search `a,b)` builds five `col.ilike."%a,b)%"` operands joined by commas, no raw text outside quotes; `"` and `\` escaped; `%` and `_` escaped; `*` sent as `_` and rows without a literal `*` dropped; `.limit(500)`; a row whose `replies` is null comes back as `[]`; Supabase error → `{ data: null, error }`; `from` throwing → `{ data: null, error }` |
| `updateForAdmin` | only `status`, `admin_notes`, `updated_at` reach `.update()` even when extra keys are passed; `.eq('id', id)`; `maybeSingle` null → `{ data: null, error: null }`; error path |
| `deleteForAdmin` | `.delete().eq('id', id)`; one row → `deleted: true`; none → `deleted: false`; error path |
| `createFromContactForm` | the inserted object is exactly name, email, message, status `unread`, `email_sent` false, source `contact_form`; returns `{ id }`; error path |
| `markEmailSent` | `.update({ email_sent: true, updated_at })` with no `.select`; error path |
| logging | no log call receives the name, email, message, notes or search text (spy on the injected logger mock) |

### Unit: schemas (`contactMessages.test.ts`)

Trimming; each cap at the limit and one over; bad email; PATCH with an extra key → fails; PATCH with only `updated_at` → fails; PATCH with `admin_notes: ''` → passes; unknown `filter` → fails; missing `search` → `''`; non-uuid id → fails.

### Route tests

| Route | Happy | Auth | Invalid input | Other |
|---|---|---|---|---|
| `GET /api/admin/messages` | 200 `{ success: true, messages }`, repository called with the parsed query and `ctx` | 401 and 403 from the gate; repository not called | `filter=bogus` → 400 `success:false` | repository error → 500 `'Failed to fetch messages'`; no `details` outside development |
| `PATCH /api/admin/messages/[id]` | page body `{ status: 'read', updated_at }` → 200 `{ success: true, message }`; `logAndFlush` called once with `CONTACT_MESSAGE_UPDATED`, no message text in the entry | 401 / 403, nothing read or written | non-uuid id → 400; `{ email: 'x' }` → 400; invalid JSON → 400 | not found → 404; repository error → 500; audit rejecting does not change the 200 |
| `DELETE /api/admin/messages/[id]` | 200 `{ success: true }`; `CONTACT_MESSAGE_DELETED` audited | 401 / 403 | non-uuid id → 400 | already gone → 200, no audit (D-7); error → 500 |
| `POST /api/contact` | 200; `sendEmail` called **once**, `to` is exactly `[CONTACT_FORM_INBOX]`, `replyTo` is the submitted address, `kind: 'transactional'`; `markEmailSent` called; `emailSent: true` | n/a (public) | missing field / bad email / over-long message → 400, nothing saved or sent | throttled → 429 and the body is never read; save error → 500 and nothing sent; `sendEmail` returns `sent: false` → 200 `emailSent: false`, `markEmailSent` not called; the submitted address never appears in a log line |

### Existing suites that must stay green

`app/admin/messages/__tests__/*` (5 files), `app/api/admin/__tests__/adminGate.writes.test.ts`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `supabase/migrations/__tests__/rls-disabled-tables-slice2.migration.test.ts`, `lib/email/__tests__/emailIsInlineStyled.guard.test.ts`, `lib/__tests__/envConfigHardening.guard.test.ts`, `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts`, `lib/audit/__tests__/*`, `lib/repositories/__tests__/mockedRepositoryMethods.guard.test.ts` (route-test mocks must name real repository methods), `lib/repositories/__tests__/mutationOrSelect.guard.test.ts`, `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`.

### QA manual checks (dev environment)

- QA-1: `/admin/messages` loads, filters, searches, opens a message, marks read and unread, saves notes, deletes, Mark All Read, after a test message is inserted through `POST /api/contact`.
- QA-2: `POST /api/contact` with valid input saves one row and delivers one notification to our inbox; nothing is sent to the submitted address.
- QA-3: on the dev DB, the list search returns 200 (not a PostgREST 400) for each of `,` `(` `)` `"` `\` `%` `_` `*` `.` `:` and finds a test row containing that character. This is the one check no Jest test can make.
- QA-4: the 11th `POST /api/contact` from one address inside 15 minutes answers 429.
- QA-5: an audit row for the PATCH and the DELETE appears under the admin's id with no message content in it.

---

## Rollback

One PR, no migration, no data change (both tables hold 0 rows; nothing is backfilled). Rollback is a revert of the merge commit. The deleted replay route had no caller, so reverting or not makes no difference to the screen. The two new audit event names would remain in any audit rows written in the meantime; they are plain text values and the rows stay in `audit_trail` after a revert (whether the admin audit page's Action filter still lists them after a revert is not checked; the rows are reachable under "All Actions").

---

## Out of Scope and Flagged

| Item | Note |
|---|---|
| `AgentRepository.ts:171` and `CRMTaskRepository.ts:218` | Put raw search text into `.or()` the same way the messages GET did. Not touched here; flagged for a follow-up. |
| `message_replies` | Nothing writes it after the replay route goes. Dropping the table is a schema change and is not in this slice. |
| Page comment F-111 | Becomes slightly out of date once the list 200 also carries `success: true`. Left as is, so no screen file changes. |
| Merge risk | `lib/audit/events.ts`, `lib/audit/eventAudience.ts` and `lib/audit/__tests__/eventAudience.test.ts` are also modified, uncommitted, by another stream (the plugin OAuth callback fix in the main checkout). Whichever merges second will need a small conflict resolution in those two registries. |

---

## SA Review Notes

**Reviewed by SA — 2026-11-27**
**Status:** ✅ Approved with conditions (one round; the conditions below are folded into implementation, no re-review of the plan)

### Rulings on D-1 to D-13

| # | Ruling | Note |
|---|---|---|
| D-1 | ✅ Approve | One send, to `CONTACT_FORM_INBOX` only. `replyTo` must be the Zod-parsed email (`.email()` rejects CR/LF, so no header can be added through it); never log it. |
| D-2 | ✅ Approve (Dev's first option) | Delete the gradient `it` whole (its only subject was the confirmation), drop only the `contact` line from the viewport `it`, keep the file in `SENDERS` and both escaping tests unchanged. Update the header comment (line 18) that describes the auto-reply. This removes assertions about deleted markup only; nothing the notification ships loses coverage. |
| D-3 | ✅ Approve | `updated_at` accepted as `z.string().optional()` and never passed to the repository. The repository picks `status` / `admin_notes` by name as well (belt and braces). |
| D-4 | ✅ Approve | `adminGate.writes.test.ts`: remove the import and the one case; `CASES` 68 → 67 is the only count change; rewrite the D2 comment so it no longer names `replay`. Access doc row 38 struck through with the date. |
| D-5 | ✅ Approve | Search 100 is fine (the page has no input cap, so a 101-character search shows "Invalid input"; acceptable). |
| D-6 | ✅ Approve | Matches the exchange-rate precedent exactly: `logAndFlush` after the write succeeded (bounded to 2 s, never rejects, so it satisfies the non-blocking rule; it is the WC-7 pattern for serverless), `userId` = `actorId` = the admin, `after` only, no audit on the public POST. Add `'contact_message'` to `AUDIT_ENTITY_TYPES`; `ownerVisibility` `'owner'` with the exchange-rate reason keeps `OWNER_HIDDEN_ENTITY_TYPES` and the owner-policy migration unchanged. **See C-2 for the count pin the plan missed.** |
| D-7 | ✅ Approve | DELETE of a missing id → 200, `deleted: false` logged, no audit. PATCH missing → 404. |
| D-8 | ✅ Approve | Drop `messageId`. Note: no in-repo caller of `/api/contact` exists (only the route and its tests), so the kept keys protect any external form only. |
| D-9 | ✅ Approve | Fixed subject; the transport logs the first 50 characters of a subject. |
| D-10 | ✅ Approve | Adding `'app/api/contact'` to `ROOTS` widens the guard. |
| D-11 | ✅ Approve | `.limit(500)` as a named constant. The `*` post-filter runs after the limit; acceptable at this volume. |
| D-12 | ✅ Approve | Verified both helpers. Order of escaping is correct: `ilikeContainsPattern` first (`\`→`\\`, `%`→`\%`, `_`→`\_`, `*`→`_`, wrapped in `%…%`), then `quoteFilterValue` (`\`→`\\`, `"`→`\"`, wrapped in `"…"`). PostgREST's logic-tree parser treats `,` `(` `)` `.` `:` as literal inside a double-quoted value and un-escapes `\x` to `x`, so Postgres receives the ILIKE pattern with its own escapes intact. `*` cannot be escaped in a PostgREST like operand, which is exactly why it is sent as `_` and post-filtered with `matchesLiterally`. Import the helpers, do not copy. QA-3 stays mandatory: it is the only live proof. |
| D-13 | ✅ Approve "no" | The rate limit runs before the body is read and the platform caps the body size; a `content-length` check is not proportionate here. |

### Conditions (blocking, folded into implementation)

1. **C-1 Embedded order uses the alias.** The embed is aliased `replies:message_replies(...)`, and PostgREST addresses an aliased embed by its alias in `<embed>.order`. Use `.order('created_at', { referencedTable: 'replies', ascending: true })` (or drop the reply ordering). A wrong name makes PostgREST reject the whole list request even with 0 rows. Pin the `referencedTable` value in the repository unit test; QA-1 is the live proof.
2. **C-2 `lib/audit/__tests__/eventAudience.test.ts` pins counts** ("73 Business OS, 79 shared, 84 AgentsPilot", `registered` 236). Two new `'shared'` events make it 81 shared and 238 registered. Add the file to "Files to Create / Modify", change the two numbers and the test title only, and leave the exhaustiveness tests alone. The other stream also edits this file and the two registries (already in the merge-risk row; add this file to that row).
3. **C-3 Guard edits narrow, never widen.**
   - `rls-disabled-tables-slice2`: `contact_messages` → `['lib/repositories/ContactMessagesRepository.ts']`, `message_replies` → `[]` with a one-line comment that it is read only as an embed in that repository. That test's "no allowlisted route uses a browser or cookie client" check stops seeing the admin message routes (they no longer name the tables), so the new caller guard must also assert that no importer of the repository contains `'use client'` or imports `@/lib/supabaseClient`.
   - `envConfigHardening` G-7: removing the `app/api/contact/route.ts` entry is correct only because the file no longer matches any provider or dispatch pattern (it calls `sendEmail`). Do not change the E-1 transport entry's counts. If the scan still finds the file, the route is wrong, not the guard.
   - `adminGate.writes`, `emailIsInlineStyled`: as ruled in D-4 and D-2, nothing else.
4. **C-4 Rate limiter is reused unchanged.** `rateLimit(request, 'contact-form', RATE_LIMITS.create)` as the first call after the logger, `tooManyRequests(...)` on refusal. Keying: the first `x-forwarded-for` entry, hashed. On Vercel the platform sets that header, so a client cannot choose its own key there; outside Vercel it is caller-controlled, which is accepted. A degraded limiter fails open (its documented contract); the route proceeds and does not add its own fail-closed branch. Do not edit `lib/security/rateLimit.ts` or its repository.
5. **C-5 Route tests mock `logAndFlush` itself** (as planned), and include "audit rejecting / hanging does not change the status". No hand-rolled `AuditTrail` sink.
6. **C-6 Neutral wording.** The workplan text is clean. Keep new test names and comments to plain behaviour ("sends one notification to the team inbox", "throttles after the allowance", "validates input"). Do not copy the shared limiter's own phrasing into new files, and do not describe what the previous route allowed.

### Checked and confirmed (no change needed)

- **UI needs no change.** The page reads the list 200 itself (`body.messages`, array-only), and calls `readAdminResponse` only on non-ok, where it takes `error` verbatim or the 401/403 copy; PATCH/DELETE read `response.ok` only. Adding `success: true` and the `{ success: false, error }` shape are both compatible. `app/admin/messages/__tests__/source.guard.test.ts` pins only the page's fetch targets.
- **Audit non-blocking:** `logAndFlush` never throws or rejects; this is the established admin-route pattern (exchange rates, queue actions, reconciles).
- **Repository header and caller guard** follow `ExchangeRatesRepository` / `AdminTokenUsageAnalyticsRepository`; service role justified (no `user_id`, server-only tables).
- **`mutationOrSelect` guard** is not touched (no `.or()` on a mutation).

### Approval
[x] Workplan approved — proceed to implementation, with C-1 to C-6

---

### Implementation Notes (Dev, 2026-11-28)

- **C-1:** replies are ordered with `referencedTable: 'replies'` (the alias, `REPLIES_ALIAS`), pinned in `ContactMessagesRepository.test.ts`.
- **C-2:** the `eventAudience.test.ts` numbers and title are changed (81 shared, 238 registered). **Small deviation:** one `// +2 shared (...)` history line was added above the `it`, following the file's own convention for every earlier count change.
- **C-3:** the RLS slice 2 allow-list is the repository alone, and `message_replies` is `[]` with an embed comment. To make the guard see the table, the repository writes `.from('contact_messages')` literally, not through a constant. The new callers guard checks the importer list, the absence of `'use client'` and `@/lib/supabaseClient`, and that the admin callers call `requireAdmin`. G-7: only the contact entry was removed. In `emailIsInlineStyled`, beyond removing the gradient `it` and the contact viewport line, the now-unused `contact` read in that `describe` was removed and the viewport test was renamed to name the approval email only.
- **C-4:** `rateLimit(request, 'contact-form', RATE_LIMITS.create)` is the first call after the logger. The limiter files are unchanged.
- **C-5:** `logAndFlush` is mocked directly. Both audit calls also chain `.catch(...)` (CLAUDE.md § Audit Trail), so a rejecting audit leaves the 200 in place, which the tests assert for PATCH and DELETE.
- **Contact route:** the notification subject is a module constant that is **not exported**, because a Next.js route file may export only route fields.
- **Pre-existing, Windows only:** `publicEndpointsAreThrottled.guard.test.ts` fails 3 tests locally on Windows (backslash paths compared with the `/`-keyed `UNGATED` list). An unchanged `HEAD` copy of the file fails the same 3. The contact route's own case passes.
- **QA-1 and QA-3 (live PostgREST) are still owed.**

---

### Code review

**Code Review by SA — 2026-11-28**
**Status:** ✅ Code Approved (one round; no blocking items)

Reviewed against `HEAD` (50033f89, the branch base), staged deletions and untracked files included. Note: `origin/main` has moved past the branch base, so `git diff origin/main` also shows unrelated changes from other merges; those are not part of this slice. 34 suites run locally (the new tests, every guard this slice edits, `lib/audit/__tests__`, `app/admin/messages/__tests__`, `admin-authz-surface`, `mockedRepositoryMethods`, `mutationOrSelect`): 34 passed, 1165 tests.

#### Conditions

| # | Met | Evidence |
|---|---|---|
| C-1 | ✅ | `.order('created_at', { referencedTable: REPLIES_ALIAS })` with `REPLIES_ALIAS = 'replies'`, the same constant used in the select alias; pinned in the repository test. Live proof is QA-1 |
| C-2 | ✅ | 81 shared / 238 registered, title changed, exhaustiveness tests untouched |
| C-3 | ✅ | RLS slice 2 allow-list narrowed to the repository; `message_replies: []` with the embed comment (the guard matches `.from('<table>'`, and the repository names that table only in the embed, so `[]` is exact). The "no browser client" check moved into the new callers guard, which also asserts `requireAdmin` on the admin callers. G-7: only the contact entry removed, E-1 counts unchanged, and the route has no provider import or own dispatch left. `emailIsInlineStyled` and `adminGate.writes` changed only as ruled |
| C-4 | ✅ | `rateLimit(request, 'contact-form', RATE_LIMITS.create)` is the first call after the logger, before the body is read; `tooManyRequests` on refusal; limiter files unchanged; no fail-closed branch added |
| C-5 | ✅ | `logAndFlush` mocked directly; reject and hang cases assert the status is unchanged for PATCH and DELETE. No hand-rolled sink |
| C-6 | ✅ | Code, tests, comments and doc edits use plain behaviour wording. Nothing describes what the earlier route allowed |

#### Dev deviations

All 5 accepted: the `// +2 shared` history line follows the file's convention; the literal `.from('contact_messages')` is what keeps the RLS guard able to see the table; the extra `requireAdmin` assertion in the callers guard widens protection; removing the unused `contact` read and renaming the viewport test only follow from D-2; the subject constant is correctly not exported from a route file. The `.catch(...)` on `logAndFlush` is redundant (it never rejects) but harmless and matches CLAUDE.md § Audit Trail.

#### Standards (all 3 routes + the repository)

- Rule 1: no Supabase client in any route; the repository is the only file that names either table.
- Rule 2: Zod runs before any business logic: query schema in GET, uuid param then strict body in PATCH, uuid in DELETE, body in POST. Invalid JSON is a 400 with the same shape.
- Rule 3: Pino via `createLogger` everywhere, `logger.child({ correlationId })` in every handler, errors as `{ err }`; zero `console.*` in the 3 routes, the repository and the schemas. Log lines carry ids, counts, the filter and `hasSearch` only; the contact route test asserts the address and text never reach a log line.
- Rule 4 exemption: documented in the repository header and at the constructor (no owner column, server-only tables, authorisation is the caller's job, caller list pinned by a guard).
- Rule 6: no `any`; the casts are on Supabase rows to declared row types.
- Error format: `{ success: false, error, details }` with `details` only under `NODE_ENV === 'development'` on every path.
- Admin gate: `requireAdmin(requestLogger)` is the first statement inside the `try` in GET, PATCH and DELETE; only the correlation id and the child logger come before it (the existing pattern). `admin-authz-surface` passes.
- Security: no secrets or keys; PATCH writes at most `status`, `admin_notes`, `updated_at` (strict schema plus pick-by-name in the repository); `replyTo` is the Zod-parsed email; the subject is fixed; the search text is escaped by the two owning helpers and never reaches the filter raw (QA-3 is the live proof).
- Each guard edit keeps or narrows protection (C-3 above; D-10 adds `app/api/contact` to the throttle guard's roots).

#### Optional nits (not blocking)

1. `lib/repositories/ContactMessagesRepository.ts:43`: `AdminReadContext` is also used for the two write methods. The type fits; the name reads oddly on a write. Leave it or alias it locally.
2. `lib/repositories/types.ts`: `ContactMessageRow.status` is `string`, not `ContactMessageStatus`. Correct for what the column can hold (no CHECK); a comment saying so would stop a later "tightening".
3. For RM: the branch needs a sync from `main` before the PR, and the merge-risk row still applies: `eventAudience.test.ts` count pins will need re-counting, not a text merge, if the OAuth callback stream lands first.

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-11-28**
**Test mode:** full (for the scope the brief gave QA: Jest suites, the Windows-only claim, live QA-1 list reads and QA-3, and a read-through of the critical path)
**Strategy used:** A + B (Jest: repository, schemas, routes, guards), C (a throwaway read-only tsx script against the dev DB for QA-1 list reads and QA-3), and a source read-through instead of D (no browser pass was asked for)
**Focus:** api, schema, security
**Skipped:** browser click-through of `/admin/messages` (QA-1 UI half), QA-2 (live send), QA-4 (live 429), QA-5 (live audit rows). These need writes or a signed-in browser session, and this pass was read-only by brief. The Jest route tests cover each of them with mocks.
**Input source:** prompt (TL brief) + workplan Test Plan

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Repository: one query, embed, status filter, safe search, limit, update picks 2 fields, delete, create, markEmailSent, no PII in logs | ✅ | Pass | `ContactMessagesRepository.test.ts` 29/29 |
| Caller guard (importer list, no `'use client'`, no `supabaseClient`, admin callers use `requireAdmin`) | ✅ | Pass | 5/5 |
| Zod schemas (caps, trim, strict PATCH with `updated_at` discarded, uuid) | ✅ | Pass | 16/16 |
| `GET /api/admin/messages`: 200 `{ success, messages }`, 401/403, 400, 500 | ✅ | Pass | 8/8 |
| `PATCH`/`DELETE /api/admin/messages/[id]`: happy, auth, 400, 404, 500, audit, audit-rejecting keeps 200, DELETE of missing id 200 | ✅ | Pass | 21/21 |
| `POST /api/contact`: one send to the inbox only, `replyTo`, 400, 429 before body, save error, not-sent path, no address in logs | ✅ | Pass | 13/13 |
| Existing suites stay green | ✅ | Pass, except a known Windows-only failure | See the suite table. The only red is the 3 `publicEndpointsAreThrottled` cases, which also fail on unchanged `origin/main` |
| C-1: aliased replies order is accepted by live PostgREST | ✅ | Pass | Live: `replies.order=created_at.asc` returns 200 (see QA-1/QA-3 below) |
| QA-1 (list half): list with no filter and with each status works live | ✅ | Pass | 4/4 live calls succeed, 0 rows |
| QA-1 (UI half): page loads, filters, opens, marks, saves notes, deletes | ⚠️ | Not run live | Read-through only (below). No file under `app/admin/messages/` changed, and the 5 page suites (153 tests) pass |
| QA-3: hostile search characters do not break the PostgREST filter | ✅ | Pass (parse level) | 15/15 live calls succeed. The table holds 0 rows, so the check proves "no parse error and no filter injection in the URL", not "finds the row" |
| QA-2 / QA-4 / QA-5 | ⚠️ | Not run live | Need writes or a session; covered by mocked route tests only |

### Jest results (run by QA from the worktree)

New suites:

| Suite | Result |
|---|---|
| `lib/repositories/__tests__/ContactMessagesRepository.test.ts` | 29/29 |
| `lib/repositories/__tests__/contactMessagesRepository.callers.guard.test.ts` | 5/5 |
| `lib/validation/__tests__/contactMessages.test.ts` | 16/16 |
| `app/api/contact/__tests__/route.test.ts` | 13/13 |
| `app/api/admin/messages/__tests__/route.test.ts` | 8/8 |
| `app/api/admin/messages/[id]/__tests__/route.test.ts` | 21/21 |

Existing suites:

| Suite | Result |
|---|---|
| `app/admin/messages/__tests__` (5 files) | 153/153 (baseline 15, confirmDialog 22, layout 47, messagesFormat 6, source.guard 63) |
| `lib/audit/__tests__` (17 files) | 214/214 (incl. eventAudience 21, ownerVisibility 23, filterOptions 22, stepZeroRegistrations 14) |
| `lib/security/__tests__` (8 files) | 151/154. Only `publicEndpointsAreThrottled` is red, at 24/27 (see below); the other 7 pass |
| `lib/email/__tests__` (22 files) | 337/337 (incl. emailIsInlineStyled 36/36) |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | 338/338 |
| `supabase/migrations/__tests__/rls-disabled-tables-slice2.migration.test.ts` | 103/103 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | 114/114 |
| Also run: `admin-authz-surface.guard`, `mockedRepositoryMethods.guard`, `mutationOrSelect.guard`, `layoutFolder.guard` | all pass |

Combined run: 63 suites, 2026 passed, 3 failed (all 3 in `publicEndpointsAreThrottled`).

### Windows-only claim (`publicEndpointsAreThrottled.guard.test.ts`): confirmed

- The only diff from `origin/main` is the added `'app/api/contact'` root (D-10).
- QA ran the `origin/main` copy of the file (`git show` into scratch, run with `--roots <scratch>` from the worktree). It fails the **same 3** cases: 23/26.
- Cause: `routeFiles()` returns `path.relative(...)`, which gives backslash paths on Windows, and the `UNGATED` keys are `/`-separated. The 3 failing files are exactly the 3 `UNGATED` keys (calendar, consent-copy, invoice pay). On Linux CI they match.
- `app\api\contact\route.ts is throttled, or named as deliberately open`: **passed**. The worktree run is 24/27: the 23 that pass on main, plus the new contact case.

### QA-1 / QA-3 live results (dev DB, read-only)

Script: `C:\Users\Barak\AppData\Local\Temp\claude\a881acd60cb2c56a\873ffa54-d51b-43f8-a0df-4842ce8b7235\scratchpad\qa-live\qa-contact-list.ts`. It loads `.env.local` without printing it (key names checked only), confirms the project ref starts `jgccgk` (it does), builds a service-role client whose `fetch` refuses any non-GET request, and calls `new ContactMessagesRepository(client).listForAdmin(...)` from the worktree.

| Call | Result |
|---|---|
| (a) `status: 'all'`, `search: ''` | ✅ success, 0 rows. Query: `order=created_at.desc&replies.order=created_at.asc&limit=500` |
| (b) `unread`, `read`, `replied` | ✅ 3/3 success, 0 rows |
| (c) `,` `(` `)` `.` `:` `*` `%` `_` `"` `\` | ✅ 10/10 success, 0 rows, no PGRST error |
| (c) `a,status.eq.read`, `x),(id.not.is.null`, `a"b\c,(d).e:f*g%h_i`, `a*b`, and `unread` + `a,status.eq.read` | ✅ 5/5 success, 0 rows. The built filter keeps the text inside one quoted operand per column: `or=(name.ilike."%a,status.eq.read%",email.ilike."%a,status.eq.read%",…)`, so no extra condition is injected |
| Control: a raw unquoted `name.ilike.%a,b)%` | PGRST100. This shows the probe can fail: unquoted text would have been caught |
| Control: `referencedTable: 'message_replies'` (the un-aliased name) | **No error** on 0 rows. So C-1's "a wrong name rejects the whole list" did not happen here. The alias form that was shipped is accepted, so C-1 passes either way. Whether PostgREST actually applies the reply ordering cannot be seen with 0 rows (see Edge Cases) |

Writes made: none. The fetch guard refused all non-GET methods, and none was attempted.

### Critical path (read-through)

- `git diff origin/main -- app/admin/messages` is empty, and `git status` shows nothing under that path.
- List: the page reads `body.messages` (array only) on 200 and `readAdminResponse` on non-ok. The route returns `{ success: true, messages: data }` on 200 and `{ success: false, error }` on 400 and 500. Compatible.
- Filters: the page sends `filter` ∈ `all|unread|read|replied` (`messagesFilters.ts:15`) and `search`. The schema accepts exactly that set.
- PATCH: the page sends `{ status: 'read'|'unread', updated_at }` (`page.tsx:223`, `:303`, `:321`, `:329`) and `{ admin_notes, updated_at }` (`page.tsx:248-251`), and reads `response.ok` only. The strict schema accepts both bodies and drops `updated_at`. DELETE: `response.ok` only, and the route returns 200 `{ success: true }`. Compatible.
- `console.` count in the 3 routes and the repository: 0. The only remaining mention of `replay` in `app/` or `lib/` is a negative assertion in `source.guard.test.ts:139` and a comment in `adminGate.writes.test.ts:548`.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **The live proof of reply ordering is weak.** Both the alias and the raw table name are accepted by PostgREST when the table is empty, so the live check proves only that the request is accepted. Whether replies come back ascending is shown by neither the live check (0 rows) nor Jest. Low: nothing writes `message_replies` any more. File: `lib/repositories/ContactMessagesRepository.ts:127`.
2. **Notes over 5000 characters fail silently.** The page's notes textarea has no `maxLength`, so a save over 5000 characters gets a 400 and the page shows its generic save failure. The same applies to a search over 100 characters (SA accepted that case under D-5). Low. Files: `lib/validation/contactMessages.ts:47`, `app/admin/messages/` (not editable in this slice).
3. **QA-1 UI, QA-2, QA-4 and QA-5 still need a live pass.** They need a signed-in admin session or writes to dev (one contact POST, one PATCH, one DELETE, 11 POSTs for the 429). They are covered by mocked route tests only.

### Final Status
- [x] All acceptance criteria in this pass's scope pass. No bugs. The 3 red throttle-guard cases are Windows-only and also fail on unchanged `origin/main`. SA has approved the code, so this is ready for commit, subject to the user's decision on the remaining live checks (QA-1 UI, QA-2, QA-4, QA-5).
- [ ] Issues found — Dev must address before commit

---

## Commit Info

| Item | Value |
|---|---|
| Branch | `fix/contact-inbox-standard` (cut from `50033f89`) |
| `58980fbe` | feat(repositories): add ContactMessagesRepository and contact-message Zod schemas |
| `fb2cd4b4` | feat(audit): register contact_message update/delete events |
| `1c38b0a8` | fix(contact-inbox): bring contact and admin message routes to standard |
| Docs commit | docs: contact inbox standard workplan and admin access row (this commit) |
| Sync | `origin/main` merged into the branch after these commits (merge, not rebase) |
| PR | opened to `main` after the push; no auto-merge, the user merges |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Workplan for SA review: repository, Zod, Pino, `/api/contact` changes, replay route removal, audit proposal, 13 decisions for SA |
| 2026-11-28 | Implemented | T-1 to T-10 done under SA C-1 to C-6; Implementation Notes added below the SA notes. Waiting for SA code review |
| 2026-11-28 | Committed | RM: 4 commits on `fix/contact-inbox-standard`, Commit Info filled, PR opened (no auto-merge) |
