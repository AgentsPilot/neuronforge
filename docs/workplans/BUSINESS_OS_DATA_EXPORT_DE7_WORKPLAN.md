# Workplan: Business OS data export, DE-7: content records (website and content)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) (the DE-6 branch version): §0.2 (DX-1c content incl. website, images, documents; DX-1d; DX-8), §0.3.1 (content row), §0.3.7 (DE-7 row: flips `PLANNED_ALLOWED` to false), §0.4.1 (Phase 1, ceiling §C), §0.6 (SA-Q11: `website_blocks` through an owner-scoped parent), §0.7 (repository E-1…E-6, `DOCUMENT_STORAGE`, notes for DE-8b), §0.8 (DE-3 SA-Q3: `user_code` / `subdomain` in), §0.9 (`pickStringKeys`), §0.10 (DE-6: `rowKey`, `withoutQueryOrFragment`, deny-list hardening, `GENERATION_METADATA`)
**Branch:** `feature/data-export-de7` (worktree `neuronforge-de7`, from origin/main `fcce705a`). **Written against DE-6's end state** (PR #443, `origin/feature/data-export-de6` `6f309f39`, auto-merging, not yet on main). Implementation starts only after #443 is on main and this branch is rebased on it (T-0a)
**Date:** 2026-10-17
**Status:** SA code-approved + QA PASS 2026-10-17 (QA-B1 fixed + re-verified); committed by RM. Branch merged up to origin/main `16cb2a1f` (DE-6 PR #443) by `git merge` (T-0a)

## Overview

DE-7 adds the business's **website, landing pages, smart links and picture library** to "Download my data". These are the last five tables DE-2 left `planned('DE-7')` in `lib/business-os/purge/descriptors.ts`: `website_pages`, `website_blocks`, `website_content`, `smart_links` and `user_media`. This plan proposes **5 `include`** (explicit columns, a written reason for every column left out) and **0 `exclude`**. After DE-7 **no table is `planned`**, so `PLANNED_TABLES_ALLOWED` flips to `false` and the CI forbids `planned` on any table from then on. Buckets keep their own flag (`PLANNED_FILES_ALLOWED`, flipped by DE-8b).

**These are the records, not the files.** The picture files themselves (and the client documents) arrive in DE-8b's "Your files". DE-7 exports each picture's details: its public web address, where it is used, its size and its description. Our internal storage key (`storage_path`) stays out, as DE-4 did for `contact_documents` (§2.8 says how DE-8b maps files).

**One new pattern, for SA (SA-Q1).** `website_blocks` has **no `user_id`**: a block belongs to a page, and the page to the owner. The repository refuses `via`-scoped tables today (E-2). This plan adds a **parent-scoped read** inside the same repository method: the owner's own page ids are read first (`.eq('user_id', session id)`), then the blocks with `.in('page_id', thoseIds)`, and every returned block is checked against that set before it is accepted. No id ever comes from a caller. §2.6 has the full design, its rules V-1…V-9 and the rejected alternatives.

**What is in, in plain terms.** Every page of the website and every landing page (draft, live and archived), with its title, web address, SEO text, design and language; the content of every block on those pages (including hidden blocks); the website text the owner wrote or the assistant drafted; every smart link (its short code, where it goes, its campaign tags, on or off); and the list of pictures in the owner's library. **Out:** click, conversion and attributed-revenue counters on smart links (activity, BC-1), the reuse key behind a picture (`source_ref`), our storage key, and `user_id` everywhere.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. The 5 tables: proposals](#3-the-5-tables-proposals)
- [4. JSON columns](#4-json-columns)
- [5. The planned flip](#5-the-planned-flip)
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

### 1.1 What DE-7 touches

| Area | DE-6 end state (`origin/feature/data-export-de6` `6f309f39`) | After DE-7 |
|---|---|---|
| Descriptors | 5 rows `planned('DE-7')`: `website_pages`, `website_blocks`, `website_content` (§3.3 Website), `smart_links` (§3.10 Conversion), `user_media` (§3.9 end of IN_SCOPE) | 5 × `include` with `columns` + `excludedColumns`. `level`, `order`, `scope`, `snapshot`, `area` and `notes` unchanged on all 5. The `planned()` helper is removed (no caller left, §5) |
| Classification count | 155 = 33 include + 5 planned (DE-7) + 117 exclude | 155 = **38** include + **0** planned + **117** exclude |
| `PLANNED_TABLES_ALLOWED` (test constant) | `true` | **`false`** (§5) |
| Section ids | 34 (`classificationTypes.ts`) | + 5 (§2.3) |
| Groups | `account` (controller AgentPilot), `client_records` (processor) | + **`content`** (processor; the account holder the controller; SA-Q3). `sections.ts` already says "DE-7 adds 'content'" |
| Reads | 32 tables through `BusinessDataExportRepository` (31 keyset + 1 single-row), `profiles` through `UserProfileRepository` (33 selects) | + 4 keyset reads, + **1 parent-scoped read** (`website_blocks`, 1 parent-id query + 1 or more child queries). The 33 existing selects are byte-identical |
| Payload | `export_metadata.groups` = `account`, `client_records` | + `content` (one neutral sentence, `payload.ts`). `format_version` stays 2 (additive). `summary` unchanged |
| Route | `GET /api/user/data-export` runs `EXPORT_SECTIONS` | **unchanged code** |
| DB | — | **none** (no migration, no new route, no new dependency, no flag) |

### 1.2 Facts measured in code

Every column claim is ❓ until T-0. Sources: migration bodies (read, not file names), the repositories' row interfaces, and the physical catalog `lib/business-os/catalog/catalog.generated.ts` (live, generated 2026-09-10), which covers `website_pages`, `website_blocks` and `smart_links` but **not** `website_content` or `user_media`.

| # | Fact | Where | Consequence |
|---|---|---|---|
| F-1 | `website_pages`, `website_content`, `smart_links`, `user_media` have `user_id uuid NOT NULL` and a uuid `id` PK; their descriptors are `scope: { kind: 'user_id' }` | migrations; `descriptors.ts` | The normal keyset reader, by the table's **own** `user_id` (E-4) |
| F-2 | `website_blocks` has **no `user_id`**. `page_id uuid NOT NULL REFERENCES website_pages(id) ON DELETE CASCADE`; `UNIQUE(page_id, position)`. Descriptor: `scope: { kind: 'via', parent: 'website_pages', fk: 'page_id' }` | `20260721_create_website_tables_fixed.sql`; `descriptors.ts:1045` | The repository refuses it today (`not_user_scoped`). Needs the parent-scoped read (§2.6, SA-Q1). Ownership = `page_id → website_pages.user_id`, the same rule `website-plugin-executor.ts` `resolveBlockOwnedPage` uses (tenant-isolation-guard worked reference) |
| F-3 | Catalog (live 2026-09-10): `website_pages` 23 columns (`id, user_id, page_type, slug, title, meta_description, seo_keywords, published, published_at, template_id, theme, created_at, updated_at, subdomain, custom_domain, custom_domain_verified, status, last_published_at, favicon_url, og_image_url, client_flow, website_language, content_generated_at`); `website_blocks` 9 (`id, page_id, block_type, position, content, styles, created_at, enabled, capability_config`); `smart_links` 17 (`id, user_id, code, name, destination_url, destination_type, source, medium, campaign, content, click_count, conversion_count, revenue_cents, is_active, created_at, updated_at, metadata`) | `catalog.generated.ts:3893`, `:4239` | Expected counts for Q2; T-0 Q1 is the authority |
| F-4 | `website_content` (migration): `id`, `user_id UNIQUE NOT NULL`, **19 jsonb section columns** (`hero, about, services, testimonials, faq, team, contact, process, features, stats, pricing, gallery, cta, newsletter, logo_cloud, video, booking_widget, payment_button, intake_form`), `created_at`, `updated_at` = 23. `WebsiteContentRepository.WebsiteContent` lists 18 sections (no `intake_form`). Since 20260902 a section the owner never edited is `{}`: "Holds only what the business actually authored" | `20260726_create_website_content.sql`, `20260902_website_content_empty_defaults.sql` | 1:1 table with an `id` PK: the normal keyset read (no `rowKey`). Whether `intake_form` is live is a Q1 question |
| F-5 | `user_media` (migration): `id, user_id, storage_path NOT NULL, public_url NOT NULL, source NOT NULL DEFAULT 'stock', source_ref, section, aspect, description, width, height, created_at` = 12. `source` ∈ `stock` / `generated` / `upload` (repository type). UNIQUE `(user_id, source_ref)` | `20260925_user_media.sql`, `20260926_user_media_conflict_target.sql`; `UserMediaRepository.ts` | 12 ❓ |
| F-6 | `user_media.source_ref` is **our reuse key**: `pexels:<photo id>` for stock, `openai:<hash of prompt and crop>` for generated, NULL for uploads. Its sole job is "never fetch or pay for the same picture twice" | `StockImageService.ts:316`, `GeneratedImageService.ts:309` | Out (`REUSE_KEY`, SA-Q6). `source` already says where the picture came from |
| F-7 | `user_media.description`: for **generated** pictures it is the **request the owner typed** (`app/api/website/media/generate/route.ts`: `prompt: z.string().trim().min(3).max(300)` from the editor, stored verbatim); for **stock** the photo's alt text or the search query; for **uploads** the file name (≤ `DESCRIPTION_MAX_CHARS`). It is also handed back as the picture's alt text | `GeneratedImageService.ts:445`, `StockImageService.ts:321`, `app/api/website/upload/route.ts:226` | In (the owner's own words, and the alt text the website shows). It is not system generation metadata (unlike DE-6 `generated_from`: model, vertical, service ids). BC-5 confirms |
| F-8 | `user_media.storage_path` is `{user_id}/stock/<id>.jpg`, `{user_id}/generated/<hash>.png`, or the upload path under `{user_id}/`. `public_url` is the **public** address of the same object in the **public** `website-images` bucket (`getPublicUrl(path)`; the bucket stays public after the 20261071 lockdown), so it carries the same path | the three writers; `20261071_website_images_bucket_lockdown.sql` | `storage_path` out (`DOCUMENT_STORAGE`, as DE-4). `public_url` in: it is already on the owner's live website and in the block content (§2.8, SA-Q5) |
| F-9 | `smart_links.code` is the public short code of the link (`findByCode` resolves the public redirect; UNIQUE). It is printed on the owner's Instagram bio, flyers and so on | `SmartLinkRepository.ts:261` | In: the owner's public address, like `business_profiles.user_code` and `subdomain` (DE-3 SA-Q3). Not a secret: matches no deny rule |
| F-10 | `smart_links.click_count`, `conversion_count`, `revenue_cents` are running totals the public redirect and the conversion tracker write (`recordClick`, `markConversion`). `revenue_cents` is a **bare amount with no currency column**; the payments it sums are already in the `payments` section | `20260824_add_conversion_layer.sql`; `SmartLinkRepository.ts:410`, `:507` | All three out: counters are activity / visitor tracking (DX-1d, BC-1); `revenue_cents` also could not travel with a currency (CLAUDE.md § Currency, DE-5 M-4) |
| F-11 | Smart links are **hard-deleted** (`SmartLinkRepository.delete`, "A real delete, not a deactivation"); `is_active` is an on/off switch, and some links are created by the system already off (`getOrCreateDefaultLinks`, booking link). Pages are hard-deleted too; `archive` is a status (`status = 'archived'`, slug renamed). Blocks and pictures are hard-deleted | repositories | **No `rowFilter` anywhere in DE-7**: every status and on/off state is history (DX-8). Q13 confirms no soft-delete column |
| F-12 | `website_pages.subdomain` is the per-page copy the public routes resolve by, kept in step with `business_profiles.subdomain` (20260904); `custom_domain` / `custom_domain_verified` are the owner's own domain and whether its DNS was confirmed | `20260904_business_subdomain.sql`, `20260726_enhance_website_tables.sql` | In: public addresses (DE-3 SA-Q3); the verified flag is a fact about the owner's domain |
| F-13 | `website_pages.content_generated_at`: "When AI last wrote this page's content. NULL means never". A timestamp only; the page stores no model or inputs | `20260902_website_pages_content_generated_at.sql` | In, as DE-6 kept `business_intake_forms.generated_at` and dropped only `generated_from` (the inputs). No generation inputs exist on any DE-7 table (Q6b confirms by key census) |
| F-14 | `website_blocks.capability_config` holds service ids, a Stripe price id and similar wiring ("service_ids, price_id, etc."); block `content` can hold `serviceId` / `services` (20260923 indexes) | `20260726_enhance_website_tables.sql`, `20260923_website_blocks_service_lookup.sql` | References, not credentials (DE-5 SA-Q5): in whole, on the Q6 key census |
| F-15 | `website_templates` is `never` / global / `exclude(PLATFORM)`; `website_pages.template_id` points at it | `descriptors.ts:1250` | `template_id` in as a bare id (as DE-3 kept `business_profiles.template_id`); the template row is platform data and is never read |
| F-16 | `website_page_views` (has `user_id` and `page_id`) and `smart_link_clicks` (via `smart_links`) are already `exclude(VISITOR)` | `descriptors.ts:1049`, `:1130` | Not in this slice; pinned as never read (D-11) |
| F-17 | No DE-7 table holds an email-confirm, preview or share token by column name (catalog + migrations); the deny list matches no DE-7 column name | grep of the column lists against `SECRET_COLUMN_DENY_EXACT` / `_PATTERNS` | `DENY_EXCEPTIONS` stays at one entry. Q7 confirms by column-name census |

### 1.3 Live schema status

Not measured by Dev (no DB access in this worktree). §11 is the read-only SQL for TL. **Gate:** no descriptor is written before Q1, Q3, Q4 and Q6 are back.

---

## 2. Implementation Approach

### 2.1 Reuse, not new

- **Descriptors:** 5 `const …_EXPORT: TableExportClassification` blocks in a new `── DE-7: website and content ──` block after the DE-6 block, with a `CONTENT_COLUMN_REASON` map (named, not retyped: DE-4 SA-Q4). The 5 `planned('DE-7')` calls are replaced; nothing else on those rows changes.
- **Sections:** a `contentSection(id)` helper on top of the existing `ownedRowsSection(id, 'content', 'processor')`, exactly as `clientRecordsSection` / `accountTableSection`. **No row mapper** in DE-7 unless Q9 finds token-like query strings (SA-Q8).
- **Repository:** `listOwnedRowsForExport` unchanged for the 4 `user_id` tables. One new branch for a `via` descriptor that carries the export opt-in `viaParent` (§2.6).
- **Ceiling, paging, failed sections, audit, logging:** unchanged. The 5 new sections draw on the same `maxRows` budget.

### 2.2 Include, exclude: the rule used

| In | Out |
|---|---|
| What the owner published or wrote: page titles, slugs, SEO text, keywords, block content and styles, the website text per section, smart-link names, destinations and campaign tags, picture descriptions | Visit and conversion counters, attributed revenue (activity, DX-1d; BC-1) |
| AI-drafted website copy and pictures in the owner's library: the owner's content, whoever drafted it (BC-4, BC-5) | AI generation inputs: none exist on these tables (Q6b); `source_ref` holds a hash of one, and is out as our reuse key |
| The owner's public addresses: `slug`, `subdomain`, `custom_domain`, `smart_links.code`, a picture's `public_url` (DE-3 SA-Q3) | Our internal storage key: `user_media.storage_path` (`DOCUMENT_STORAGE`, as DE-4) |
| Status and lifecycle: draft / live / archived, `published_at`, `last_published_at`, `is_active`, `enabled`, `content_generated_at` | `user_id` everywhere (`OWNER_ID`) |
| Wiring the owner set up, as bare ids: `template_id`, service ids and price ids in `capability_config`, `client_flow.intake_form_id` | Platform rows those ids point at (`website_templates`) |

### 2.3 Sections, order and group

Plain words, because DE-8b names each CSV after its section (DE-4 SA-Q3). All in the new group **`content`** (processor; SA-Q3), appended after `email_unsubscribes` (the last DE-6 section) in this order:

| Section id | Table | Read | Note |
|---|---|---|---|
| `website_content` | `website_content` | keyset | one row per owner (UNIQUE `user_id`); 19 jsonb sections |
| `website_pages` | `website_pages` | keyset | every page: website pages and landing pages, every status |
| `website_blocks` | `website_blocks` | **parent-scoped** (§2.6) | after `website_pages`, its parent; hidden blocks in with `enabled` |
| `smart_links` | `smart_links` | keyset | every link, on or off |
| `images` | `user_media` | keyset | the picture library (records only; files in DE-8b) |

`format_version` stays 2 (additive: a new group and new sections, as DE-4 added `client_records`). `payload.ts` gains the `content` group entry (`EXPORT_GROUPS` is `Record<ExportGroupId, …>`, so the compiler requires it):

> `content`: `gdpr_role: 'processor'`, `controller: EXPORT_ACCOUNT_HOLDER`, description *"Your website, landing pages, smart links and picture library. You, the account holder, are the controller of this content. AgentPilot hosts it on your behalf, as its processor."*

### 2.4 Tenant isolation (tenant-isolation-guard)

Read-only, service role, so RLS does not protect these reads (repository E-5). Step 1 of the skill applies because of `website_blocks` (no `user_id`; ownership via a parent).

- The only id is `ctx.userId = getUser().id`. The route takes no input; the existing test proving a planted `?userId=` and `x-user-id` are ignored is extended to the 5 tables, and a planted `?pageId=<B's page>` is added (D-13).
- The four `user_id` tables: first filter `.eq('user_id', ctx.userId)`, as today.
- `website_blocks`: **no caller-supplied id exists anywhere in the path.** The parent ids are gathered by the repository itself from the owner's own `website_pages` rows (`.eq('user_id', ctx.userId)`), and every returned block is re-checked against that set (V-6). This is the skill's "ownership via a parent" rule, done set-wise: the page-ownership oracle runs first, and nothing is accepted that it did not vouch for.
- Bare pointers: `template_id`, service ids in `capability_config` / `metadata.serviceIds`, `client_flow.intake_form_id` and picture URLs inside block content go out as stored values. They are never followed, so a crossed pointer can carry a foreign id or URL in a cell, never a foreign row. Q12 measures crossed pointers (expected 0); a non-zero edge goes to SA as a data-integrity finding, not as an export change.
- No find-by-id, no write, trigger, upsert or rpc (E-1, scanned by the existing repository test; `.in` is a read filter).

### 2.5 Deny list

The proposed `columns` in §3 match no exact entry and no pattern of the deny list (checked against `SECRET_COLUMN_DENY_EXACT` and `SECRET_COLUMN_DENY_PATTERNS` as of DE-6: `code` is not `token`, `source_ref` matches nothing, and it is out anyway). `DENY_EXCEPTIONS` stays at one entry (`crm_pipeline_stages.stage_key`). No hardening is proposed.

### 2.6 The parent-scoped read (`website_blocks`; SA-Q1, SA-Q2, new pattern)

**Why a new reader at all.** Ruling `website_blocks` out would drop the actual content of every page that is built from blocks (headlines, text, testimonials, pricing, FAQs): `website_content` holds only the owner's edits, merged **over** the block content ("Block content is the base and this is merged over it", 20260902). Without blocks, the file cannot reproduce a page. Adding a `user_id` column to `website_blocks` is a migration with a backfill and a write-path change in five places: out of DE-7's scope (no migration).

**The opt-in (SA-Q2).** The `include` classification gains an optional field:

```typescript
/** DE-7: a `via` table read through its owner-scoped parent. Must equal the descriptor's `scope`. */
viaParent?: { parent: string; fk: string };
```

Both keys are needed: the purge `scope` must be `{ kind: 'via', parent, fk }` **and** the export classification must restate the same `{ parent, fk }`. A descriptor whose purge scope is changed to `via` without the export opt-in still fails closed with no query, exactly as today (the existing "a via-scoped descriptor" control in `BusinessDataExportRepository.test.ts` keeps its meaning). Changing the purge scope alone can therefore never change what the export reads.

**The read, inside `listOwnedRowsForExport`** (after Zod, after E-2 resolves the descriptor from the section id, after E-3 `exportColumnsOf`):

1. **Rules checked first; any failure fails closed with no query (`{ error }`, section `failed`):**
   - **V-1** `scope.kind === 'via'` and `export.viaParent` deep-equals `{ parent: scope.parent, fk: scope.fk }`.
   - **V-2** The parent descriptor exists, its `scope.kind` is `user_id` (one hop only: no via-of-via), its export is `include`, it has no `rowKey` and no `rowFilter` (a filtered parent is an SA item: its children would have to follow the same filter), and its `columns` list `id`.
   - **V-3** The child's `columns` list `id` (keyset) and the `fk` (so V-6 can run and the file links each block to its page); the child has no `rowKey` and no `rowFilter`.
2. **Parent ids (the ownership oracle).** `from(parent).select('id').eq('user_id', userId)`, keyset paged on `id` with the existing loop (empty-page stop, C-8 non-advance check). `'id'` is asserted to be in `exportColumnsOf(parent)` at call time (E-3 holds: nothing outside the declared lists is ever selected). **V-4** every parent id is a canonical lowercase uuid (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`); anything else fails closed, so nothing odd can reach the `in.(...)` filter. Zero parent ids: the section is `ok` with 0 rows after this one query; no child query is issued.
3. **Children, per chunk of parent ids.** Parent ids in chunks of `EXPORT_LIMITS.VIA_PARENT_CHUNK` (**100**: 100 uuids ≈ 3.7 kB of URL, well inside PostgREST and Vercel limits; SA-Q10). For each chunk: `from(child).select(columns).in(fk, chunk)`, keyset paged on `id` with the same loop. **V-5** the `.in(fk, chunk)` filter is the first filter of every child query, and the chunk is always a non-empty subset of the ids from step 2.
4. **V-6 the post-check (defence in depth).** Every returned child row's `fk` value must be a member of the owned parent-id set. Any row that is not fails the **whole section** closed (`{ error }`; the log carries the section, table, user id and the count of such rows, never the row). A PostgREST or fake that ignored `.in` therefore cannot leak a block: it fails the section instead.
5. **Ceiling.** Child rows are counted across all chunks against `maxRows`; past it the read stops at once, no further query is issued, and it returns `overCeiling: true` with **no** rows (as today). Parent ids do not count (they are not rows of this section; the pages themselves count in `website_pages`).
6. **Order (SA-Q8, SA-Q10).** The collected rows are sorted by `id` (string order, which is uuid byte order for PostgREST's lowercase canonical text, the C-8 note), so the section is in `id` order like every other section and the DE-8b README sentence ("rows are in `id` order") stays true.
7. **Logging.** One `info` line as today (section, table, user id, pages = number of queries, rows, plus `parents` = parent-id count); never content.

**V-7** Only `website_blocks` carries `viaParent` (a test pins it; a second one is an SA item, as `rowKey` in DE-6). **V-8** The CI check (`classification.ts`) enforces V-1…V-3 statically over the real descriptors, so a bad descriptor fails CI before it can fail a section at request time. **V-9** E-1…E-6 still hold, with E-2's text amended: "Accepts only an `include` descriptor whose `scope.kind` is `user_id`, or `via` with a matching `viaParent` opt-in whose parent is a `user_id`-scoped `include` (V-1…V-6). Anything else fails closed with `{ error }` and issues no query."

**Rejected alternatives (for SA):**

| Alternative | Why rejected |
|---|---|
| PostgREST embedded filter: `select('…, website_pages!inner(user_id)').eq('website_pages.user_id', userId)` | One query, but the tenant boundary then rests on one character: without `!inner` the filter applies only to the embedded object and **every tenant's blocks come back** with a null embed. The select string would no longer come from `exportColumnsOf` alone (E-3), and the nested object must be stripped from every row. A silent cross-tenant leak from a typo is the failure this repository exists to make impossible |
| A view or a `SECURITY DEFINER` RPC joining blocks to pages | Breaks E-1 (no rpc), needs a migration, and moves the tenant filter out of the one tested place |
| Add `user_id` to `website_blocks` | Migration + backfill + five write paths; not DE-7 scope. Worth a follow-up if more `via` tables ever need exporting |
| Exclude `website_blocks` | Loses the page content (see above) |
| Read blocks per page id one query at a time | Same safety, N queries for N pages; the chunked `in` gives the same guarantee with ⌈N/100⌉ |

### 2.7 Logging and audit

Unchanged: the repository's existing lines (section, table, user id, pages, rows; never content, URLs or names), plus `parents` on the parent-scoped read. `DATA_EXPORTED` gains 5 section counts through the generic `sectionCounts` (counts only).

### 2.8 Storage paths and how DE-8b maps files

| Question | DE-7 ruling (proposed) |
|---|---|
| Do records carry `storage_path` / `storage_bucket`? | **No.** `user_media.storage_path` is out with the existing `DOCUMENT_STORAGE` reason (byte-identical text, so DE-4's pins are untouched). Consistent with DE-4's `contact_documents` |
| Does a record carry any location? | `user_media.public_url`: the picture's **public** web address, which is already on the owner's live website and inside block content and website text. Excluding it from `images` while the same URLs travel in `website_blocks.content` would be incoherent (SA-Q5) |
| How does DE-8b build the manifest? | As ruled in §0.3.7 / §0.7: from `STORAGE_DESCRIPTORS` `include` buckets listed under `{user_id}/` (`website-images` and `contact-documents`). The zip entry is the object name **with the `{user_id}/` prefix removed**, under the bucket's folder |
| How does a reader link a picture row to its file? | DE-8b binding note (proposed for the requirement): DE-8b may add a **computed** column (e.g. `file_in_export`, the zip-relative path) to `images` and `client_documents`, from its own internal, non-exported read of `storage_path` (it already needs that read for the §0.7 C-11 orphan rule). It never writes our raw storage key. Until then the link is visible by eye: `public_url` ends with `/website-images/<user id>/<path>` and the file sits at `<website-images folder>/<path>` |
| Files with no `user_media` row (logos before F-27, older uploads) | Still in "Your files" (the bucket listing is the inventory, not the table). Q10b counts them for DE-8b's README |

---

## 3. The 5 tables: proposals

❓ = to be confirmed by Q1. "In" = in `columns`, in this order (live column order, `id` first). "Out" = in `excludedColumns` with the reason shown. Reason names in `CAPS` are constants (existing, or new in `CONTENT_COLUMN_REASON`, §6). **No DE-7 table gets a `rowFilter` or a `rowKey`.**

### 3.1 `website_content` → `website_content` (expected 23 ❓; 22 if `intake_form` is not live)

| | Columns |
|---|---|
| In (22) | `id, hero, about, services, testimonials, faq, team, contact, process, features, stats, pricing, gallery, cta, newsletter, logo_cloud, video, booking_widget, payment_button, intake_form, created_at, updated_at` |
| Out (1) | `user_id` (`OWNER_ID`) |

The 19 jsonb sections travel whole (§4). `contact` holds the business's own email, phone and address as shown on the site: the owner's content. `testimonials` and `team` hold names the owner published.

### 3.2 `website_pages` → `website_pages` (expected 23 ❓; catalog 2026-09-10)

| | Columns |
|---|---|
| In (22) | `id, page_type, slug, title, meta_description, seo_keywords, published, published_at, template_id, theme, created_at, updated_at, subdomain, custom_domain, custom_domain_verified, status, last_published_at, favicon_url, og_image_url, client_flow, website_language, content_generated_at` |
| Out (1) | `user_id` (`OWNER_ID`) |

Every `page_type` (homepage and landing pages) and every `status` (draft, live, archived) in (BC-3). `published` (legacy boolean) and `status` both go out as held. `theme` and `client_flow` whole (§4).

### 3.3 `website_blocks` → `website_blocks` (expected 9 ❓; catalog 2026-09-10)

| | Columns |
|---|---|
| In (9) | `id, page_id, block_type, position, content, styles, created_at, enabled, capability_config` |
| Out (0) | — (no `user_id` column: ownership is the parent page, §2.6) |

Descriptor gains `viaParent: { parent: 'website_pages', fk: 'page_id' }`. Hidden blocks (`enabled = false`) in (BC-7; SA C-9, was "BC-8"). `excludedColumns` is omitted (nothing to exclude; `columns` = the live set).

### 3.4 `smart_links` → `smart_links` (expected 17 ❓; catalog 2026-09-10)

| | Columns |
|---|---|
| In (13) | `id, code, name, destination_url, destination_type, source, medium, campaign, content, is_active, created_at, updated_at, metadata` |
| Out (4) | `user_id` (`OWNER_ID`); `click_count`, `conversion_count` (`VISIT_STATS`, new: "DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)"); `revenue_cents` (`ATTRIBUTED_REVENUE`, new: "a running total derived from payments already in the file, with no currency of its own (DX-1d; CLAUDE.md § Currency)") |

`source` / `medium` / `campaign` / `content` are the UTM tags the owner set on the link (not visitor data). `code` in (F-9). `metadata` whole (§4).

### 3.5 `user_media` → `images` (expected 12 ❓)

| | Columns |
|---|---|
| In (9) | `id, public_url, source, section, aspect, description, width, height, created_at` |
| Out (3) | `user_id` (`OWNER_ID`); `storage_path` (`DOCUMENT_STORAGE`, reused unchanged); `source_ref` (`REUSE_KEY`, new: "our lookup key that stops the same picture being fetched or paid for twice (a stock library id, or a hash of a picture request); `source` says where the picture came from (DE-7 SA-Q6)") |

Every `source` (stock, generated, upload) in (BC-5). `description` in (F-7; BC-5).

### 3.6 Totals

| Table | Expected live | In | Out |
|---|---|---|---|
| `website_content` | 23 | 22 | 1 |
| `website_pages` | 23 | 22 | 1 |
| `website_blocks` | 9 | 9 | 0 |
| `smart_links` | 17 | 13 | 4 |
| `user_media` | 12 | 9 | 3 |
| **Total** | **84** | **75** | **9** |

---

## 4. JSON columns

All jsonb columns go out **whole**, on the Q6 key census (as DE-3 SA-Q5 / DE-6 SA-Q4), because each holds what the owner built or chose: page and block content, design tokens, a client flow, link configuration. **If the census shows any key whose name looks like a secret, a token, visitor tracking or AI generation inputs** (Q6b: `token`, `secret`, `key`, `password`, `credential`, `session`, `ip`, `user_agent`, `hash`, `salt`, `prompt`, `model`), that column turns into a `pickStringKeys` allow-list (DE-5 SA-Q3) before code, and SA rules it.

| Column | Expected shape (code) | Plan |
|---|---|---|
| `website_content.*` (19) | objects: `title`, `subtitle`, `items[]`, `headline`, `cta_text`, `cta_url`, `images[]`, `fields[]`, `amount` + `currency` (`payment_button`), … | whole |
| `website_pages.theme` | colours, fonts, spacing | whole |
| `website_pages.client_flow` | `{ steps[], booking_url, payment_required?, intake_form_id? }` | whole |
| `website_pages.seo_keywords` | text[] | as held (array) |
| `website_blocks.content` | per block type (`BlockContent`): headlines, texts, `services[]`, `testimonials[]`, `faqs[]`, `team_members[]`, image URLs, `serviceId` | whole |
| `website_blocks.styles` | alignment, padding, colours | whole |
| `website_blocks.capability_config` | `service_ids`, `serviceId`, `price_id`, … | whole (references) |
| `smart_links.metadata` | `{ journeyType, serviceIds[], flow[], destinationType }` | whole |

`website_content.payment_button` holds an `amount` with its own `currency` key inside the same object (the 2026-07 default was `"USD"`). It goes out exactly as held, never converted or filled in (CLAUDE.md § Currency). The DE-5 M-4 pairing check is about columns and is unaffected (no amount column is added).

---

## 5. The planned flip

After DE-7 every one of the 155 table descriptors is `include` or `exclude`.

| Item | Change |
|---|---|
| `exportClassification.test.ts` | `PLANNED_TABLES_ALLOWED = false` (the comment says DE-7 flipped it). `PLANNED_FILES_ALLOWED` stays `true` until DE-8b |
| T-7 "planned rows name a known slice" | Rewritten: **no table descriptor is `planned`** (non-vacuous: counts all 155). Negative control: a planted `planned('DE-7')` on `website_page_views` is reported `still planned (DE-7); every table must be include or exclude by now` |
| T-7 "with the table flag false, every planned table is reported" | Now the default path: T-1's `tableProblems(PURGE_DESCRIPTORS)` runs with the flag `false` and is `[]`. The control keeps a planted planned row and asserts it is reported with the flag false and passes with the flag true (shows the flag is the only difference) |
| Re-plants | Every negative control that planted on `smart_links` "because it is still planned" (T-6 unknown section, duplicate include, non-table section; T-10 `not_included`) moves to an **excluded** table, `website_page_views` (visitor tracking, never exported). T-10's expected code stays `not_included` (now "classified exclude") |
| `descriptors.ts` | The `planned()` helper has no caller left and is removed with its comment, so the next table added must be classified on the spot. The `TableExportClassification` `planned` variant and `PlannedTableSlice` type **stay** (the CI rule and its negative controls still need to name them; SA-Q9). Their doc comments say "forbidden on tables since DE-7" |
| `PLANNED_TABLE_SLICES` (`classification.ts`) | Unchanged (the type-to-runtime mirror). A future `planned` row is still reported, now always as "still planned" |
| Classification totals test | 155 = 38 include + 0 planned + 117 exclude; `bySlice` = `{}` |
| Skill rule | No change needed: the DE-2 skill rule already says a new table needs an `export` value; with the flag false, `planned` is no longer an escape hatch. Dev notes this in the requirement |

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | DE-7 block: `CONTENT_COLUMN_REASON` (`VISIT_STATS`, `ATTRIBUTED_REVENUE`, `REUSE_KEY`), 5 `include` consts (§3), `viaParent` on `WEBSITE_BLOCKS_EXPORT`; the 5 `planned('DE-7')` replaced, nothing else on those rows; `planned()` helper removed (§5) |
| `lib/business-os/data-export/classificationTypes.ts` | modify | 5 section ids; `viaParent?: { parent: string; fk: string }` on `include`; doc comments on `planned` / `PlannedTableSlice` |
| `lib/business-os/data-export/classification.ts` | modify | `viaParentProblems(descriptors)`: V-1…V-3 statically over the descriptor set (pure; the parent is looked up in the same array); `tableExportProblems` reports a `viaParent` on a non-`via` scope and a `via` include without `viaParent`. No new import (C-2 cycle rule holds) |
| `lib/business-os/data-export/limits.ts` | modify | `VIA_PARENT_CHUNK: 100` |
| `lib/business-os/data-export/sections.ts` | modify | `ExportGroupId` + `'content'`; `contentSection(id)`; 5 registry entries (§2.3); header comment |
| `lib/business-os/data-export/payload.ts` | modify | `EXPORT_GROUPS.content` (§2.3) |
| `lib/repositories/BusinessDataExportRepository.ts` | modify | Parent-scoped branch (§2.6) + header: E-2 amended, V-1…V-9 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | DE-7 block (§8); flip and re-plants (§5); totals 38 / 0 / 117 |
| `lib/business-os/data-export/__tests__/sections.test.ts` | modify | Registry order, group `content`, role; payload groups |
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | modify | Fake gains `in` (+ a negative-control option that ignores it); parent-scoped read cases; cross-tenant; the existing "a via-scoped descriptor" control kept (no opt-in → no query) |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin: 38 tables read in order (+ the parent-id read); the **33 existing selects byte-identical** to the DE-6 literals; 6 new select strings literal (5 sections + `id` on `website_pages`); `export_metadata.groups` gains `content`; audit counts |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Counters / `source_ref` / `storage_path` never in the body; excluded tables never read; planted ids ignored; ceiling |
| `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` | modify | The included-table list + 5 (`smart_links`, `user_media`, `website_blocks`, `website_content`, `website_pages`) |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | New §0.11 "DE-7 status" (decisions, as built, SA rulings, notes for DE-8b incl. §2.8), per the always-update-main-requirement rule |
| `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md` | this file | Audit trail |

Not touched: the route, `lib/website-builder/*`, the domain repositories (`WebsitePageRepository`, `WebsiteBlockRepository`, `WebsiteContentRepository`, `SmartLinkRepository`, `UserMediaRepository`), any purge file other than `descriptors.ts`, any migration, `STORAGE_DESCRIPTORS` (DE-8b). No entitlements import (the `business-os-entitlements` skill does not apply; `npm run test:bos-entitlements` runs anyway at T-11 as a no-change check). No `console.*` in any touched file today (checked at T-3; if one is found it is flagged per CLAUDE.md § Logging).

---

## 7. Task List

- ✅ T-0 TL runs §11 Q1–Q13 on prod (read-only) and pastes results in §11.1. **Gate:** no descriptor is written before Q1, Q3, Q4 and Q6 (done, §11.1)
- ✅ T-0a After PR #443 merges: bring `feature/data-export-de7` up to origin/main and confirm the DE-6 files equal `origin/feature/data-export-de6`. Done by `git merge origin/main` (project rule: merge, never rebase; fast-forward to `16cb2a1f`); `git diff 6f309f39 HEAD` of the export / purge / repository / route files is empty. No stash
- ✅ T-1 SA workplan review: SA-Q1…SA-Q12; TL applied the §13 defaults (§13.1)
- ✅ T-2 §3 final from Q1 (22 / 22 / 9 / 13 / 9 in, 84 live names); §4 from Q6 (all jsonb whole)
- ✅ T-3 `descriptors.ts`: reason constants, 5 include consts, `viaParent`; `planned()` removed
- ✅ T-4 `classificationTypes.ts`: section ids, `viaParent`; `limits.ts`: `VIA_PARENT_CHUNK`
- ✅ T-5 `classification.ts`: `viaParentProblems` + the `tableExportProblems` checks (+ request-time `viaParentOf`, C-5)
- ✅ T-6 Repository: parent-scoped branch (§2.6, C-1…C-6) and header (E-2 amended, V-1…V-6)
- ✅ T-7 `sections.ts` + `payload.ts`: group `content`, 5 registry entries
- ✅ T-8 Tests per §8; negative controls shown red by in-place mutation (12 mutations, all red, all restored byte-identical; Dev notes)
- ✅ T-9 The planned flip and re-plants (§5, C-7)
- ✅ T-10 (Dev half) Q14 written from the real descriptors (Dev notes). **TL runs it** (read-only, prod); expect 0 rows
- ✅ T-11 Suites, `test:bos-entitlements`, `test:authz-guard`, `lib/client` green; runtimes before / after recorded (Dev notes)
- ✅ T-12 Requirement §0.11 and Dev notes here; changes left **uncommitted** for SA code review and QA (RM commits)

---

## 8. Tests

All Jest, in existing files, in the existing required Jest job.

| # | Test | File | Negative control |
|---|---|---|---|
| D-1 | No `planned` table anywhere; the 5 tables are `include` with the §2.3 section ids; totals 38 / 0 / 117; `bySlice` = `{}` | `exportClassification.test.ts` | Re-plan `smart_links` → reported "still planned" (flag false) |
| D-2 | Column pins (`DE7_PINS`): each `columns` list literal and in order; `columns` ∪ `excludedColumns` = the Q1 set (inline live set, DE-5 / DE-6 shape) | same | Move `click_count` into `columns` → pin red; `storage_path` into `columns` → pin red |
| D-3 | The planned flip (§5): flag false is the default path; a planted planned row is reported with false and accepted with true; re-planted T-6 / T-10 controls on `website_page_views` red for the right reason | same | — |
| D-4 | `viaParent` CI rules (V-1…V-3, V-7): only `website_blocks` carries it, and it equals its scope | same | Planted: `viaParent` with a different fk; `viaParent` on a `user_id` scope; a `via` include without `viaParent`; parent not `include`; parent `via`-scoped; parent with a `rowFilter`; child without the fk in `columns`; child with a `rowKey` → each reported |
| D-5 | **Parent-scoped read, shape:** query 1 is `from('website_pages').select('id').eq('user_id', A)` then keyset; child queries are `select(<declared>)` with `.in('page_id', chunk)` first, then keyset on `id`; rows come back sorted by `id`; `parents` logged, no content | `BusinessDataExportRepository.test.ts` | — |
| D-6 | **Chunks and paging:** 0 pages → one query, ok-empty, no child query; 101 pages → 2 chunks (100 + 1); a chunk with more blocks than the page size pages to an empty page; a short-page `max-rows` still yields every block | same | — |
| D-7 | **Ceiling across chunks:** exactly `maxRows` blocks → ok; `maxRows + 1` (split across two chunks) → `overCeiling`, no rows, no further query | same | — |
| D-8 | **Cross-tenant (tenant-isolation-guard):** A has pages and blocks; B has pages and blocks; B's block content names A's page id and A's picture URL; A's export holds every A block and **no B block** (a block whose page belongs to B never appears), no B page id in the parent query's results | same | (a) fake ignores `.eq('user_id')` on the parent read → B's blocks appear (the test can see a leak); (b) fake ignores `.in` → **V-6 fails the section** (`failed`, no B row in the body); (c) V-6 reverted in memory + fake ignoring `.in` → leak visible (shows V-6 is load-bearing) |
| D-9 | **Fails closed with no query:** a malformed parent id (not a uuid) → section failed after the parent query only; a PostgREST error on either query → failed; the existing "a via-scoped descriptor" plant (no `viaParent`) still issues no query | same | — |
| D-10 | **No caller id:** `listOwnedRowsForExport`'s signature is unchanged (section id, user id, budget); a source scan finds no `pageId` / `page_id` parameter reaching the method from `sections.ts` | same | Planted parameter → flagged |
| D-11 | **Never read:** the fake records every `from()` table; the run's set equals exactly the registry's 38 tables (+ the timezone read), `website_pages` read twice; `website_page_views`, `smart_link_clicks`, `website_templates` never touched even when seeded | `route.test.ts` | Add `website_page_views` to a planted registry → red |
| D-12 | **Out columns never in the body:** seed distinctive values in `click_count`, `conversion_count`, `revenue_cents`, `source_ref`, `storage_path`; the serialised body contains none; `public_url` is in | `route.test.ts` | Move `source_ref` into `columns` in a planted descriptor → red |
| D-13 | Planted `?userId=<B>`, `x-user-id: <B>`, `?pageId=<B's page>` change nothing in the 5 sections | `route.test.ts` (extend) | — |
| D-14 | **All history:** draft / live / archived pages, landing pages, hidden blocks, inactive smart links (incl. a system default), every picture `source` are all exported; no DE-7 descriptor has a `rowFilter` | `BusinessDataExportRepository.test.ts` + `exportClassification.test.ts` | Add a `rowFilter` on `website_pages.status` → "no rowFilter" pin red |
| D-15 | Registry order, group `content` and role per §2.3; `EXPORT_GROUPS.content` = processor / `account_holder` / the §2.3 sentence; `format_version` 2 | `sections.test.ts` | — |
| D-16 | **Characterization re-pin:** tables read in order; the **33 existing select strings** byte-identical to the DE-6 literals (`origin/feature/data-export-de6` `6f309f39`); the 6 new ones literal; `export_metadata.groups` gains exactly `content`; audit `sectionCounts` has the 5 ids, counts only; no other byte of DE-1…DE-6 output changes | `route.characterization.test.ts` | — |
| D-17 | Purge baseline: `descriptorsForRun` identical for all level × area combinations; `level/order/scope/snapshot/area/notes` unchanged on the 5 rows; the reconciler's included list + 5 | existing purge suites, `SchemaReconciler.test.ts` | — |
| D-18 | Ceiling end to end: the 5 new sections draw on the shared row budget; over it → 413, no file | `route.test.ts` (extend existing case) | — |
| D-19 | E-1 / E-6 scans still green with the new branch (`.in` is not a write; sole importer unchanged) | `BusinessDataExportRepository.test.ts` (existing) | existing controls |

---

## 9. CI placement and runtime

No new job, script or file: the tests extend suites already in the required Jest gate (in-memory fakes; the largest new case seeds ~200 blocks). No type-check scope change (DE-2 SA-Q1). Not in the `next build` critical path. T-11 records before / after runtimes; DE-5 and DE-6 each added about 2 s off the critical path, and DE-7 is expected to be of the same order. Any material increase goes to SA before hand-over (no-added-CI-time rule).

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A declared column that is not live (`website_content`, `user_media` are absent from the catalog; `intake_form` may never have shipped) fails the whole section (42703) | T-0 Q1 before writing; T-10 drift check; a failure is visible (`failed`), never silent |
| R-2 | The parent-scoped read is a new pattern in the one tenant-boundary file | Two-key opt-in (SA-Q2), static CI rules (V-8), the V-6 post-check, three cross-tenant negative controls (D-8), SA review (rule 7) |
| R-3 | Block content or website text holds a secret-looking or tracking key | Q6 / Q6b key census before code; any hit turns the column into an allow-list (§4) |
| R-4 | `destination_url`, `og_image_url`, `favicon_url` or URLs inside content carry token-like query strings | Q9 counts; if non-zero, SA-Q8 decides (cut with `withoutQueryOrFragment`, as DE-6 SA-Q7) |
| R-5 | Block and website-text jsonb are the biggest cells in the file; the 4 MB JSON body cap (DE-4 SA-Q7) is reached sooner | Q11 measures the largest owner's bytes; the cap refuses cleanly (413), never a partial file; DE-8b's zip removes the cap |
| R-6 | An owner with many pages: ⌈pages/100⌉ child chunk queries | Q5 measures max pages per owner (expected tens); each chunk is one indexed `in` on `page_id` (UNIQUE `(page_id, position)` index) |
| R-7 | `in.(…)` with a huge chunk breaks the URL limit | Fixed chunk of 100 (≈ 3.7 kB); V-4 refuses anything that is not a uuid |
| R-8 | Pinned tests planting on `smart_links` break at the flip | T-9 re-plants deliberately on `website_page_views` (§5) |
| R-9 | A picture URL inside a block points at another owner's folder (copied block, template seed) | Never followed: a URL in a cell. Q12 counts; DE-8b's file listing is by the owner's own prefix, so another owner's file can never enter the zip |
| R-10 | `website_pages.subdomain` and `business_profiles.subdomain` disagree | Both exported as held; Q12 counts for the DE-8b README (the business profile one is the authority, 20260904) |
| R-11 | Removing `planned()` breaks a later slice that wanted it | By design (§5): from DE-7 on, a new table is classified on the spot. DE-8b uses the bucket shape, which keeps its own `planned` |

---

## 11. Live schema verification (SQL for TL)

**Read-only. Run on PROD in the Supabase SQL editor.** Outputs table, column, constraint and key names, types, status and code values, jsonb key names, counts, sizes and user ids only: no row content, no URL, no page text, never a code value. The editor's known word bug is avoided: no statement below contains that four-letter preposition anywhere.

**File:** (pasted by TL; not committed)

```sql
-- Q1: every live column of the 5 tables (reconcile with section 3)
SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
ORDER BY table_name, ordinal_position;

-- Q2: column count per table, and whether each has user_id / id
-- (expected: website_pages 23, website_blocks 9, website_content 23, smart_links 17, user_media 12)
SELECT t.table_name,
       count(c.column_name) AS columns,
       bool_or(c.column_name = 'user_id') AS has_user_id,
       bool_or(c.column_name = 'user_id' AND c.is_nullable = 'NO') AS user_id_not_null,
       bool_or(c.column_name = 'id') AS has_id
FROM (VALUES ('website_pages'), ('website_blocks'), ('website_content'), ('smart_links'), ('user_media')) AS t(table_name)
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
  AND tc.table_name IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
ORDER BY 1, 2, 3;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
ORDER BY 1, 2;

-- Q4: every foreign key on the 5 tables, with its delete rule (the via edge website_blocks.page_id above all)
SELECT cl.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class cl ON cl.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = cl.relnamespace
WHERE con.contype = 'f'
  AND ns.nspname = 'public'
  AND cl.relname IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
ORDER BY 1, 2;

-- Q5: rows per table, NULL owners (expect 0), max rows per owner; blocks: NULL page_id and orphans (expect 0),
--     max pages per owner and max blocks per page (sizes the parent-id chunks)
SELECT 'website_pages' AS t, count(*) AS rows, count(*) FILTER (WHERE user_id IS NULL) AS null_owner,
       (SELECT max(n) FROM (SELECT count(*) n FROM public.website_pages GROUP BY user_id) x) AS max_per_owner
FROM public.website_pages
UNION ALL SELECT 'website_content', count(*), count(*) FILTER (WHERE user_id IS NULL),
       (SELECT max(n) FROM (SELECT count(*) n FROM public.website_content GROUP BY user_id) x)
FROM public.website_content
UNION ALL SELECT 'smart_links', count(*), count(*) FILTER (WHERE user_id IS NULL),
       (SELECT max(n) FROM (SELECT count(*) n FROM public.smart_links GROUP BY user_id) x)
FROM public.smart_links
UNION ALL SELECT 'user_media', count(*), count(*) FILTER (WHERE user_id IS NULL),
       (SELECT max(n) FROM (SELECT count(*) n FROM public.user_media GROUP BY user_id) x)
FROM public.user_media
UNION ALL SELECT 'website_blocks', count(*), count(*) FILTER (WHERE page_id IS NULL),
       (SELECT max(n) FROM (SELECT count(*) n FROM public.website_blocks GROUP BY page_id) x)
FROM public.website_blocks
UNION ALL SELECT 'website_blocks_orphans', count(*), NULL, NULL
FROM public.website_blocks b
WHERE NOT EXISTS (SELECT 1 FROM public.website_pages p WHERE p.id = b.page_id)
UNION ALL SELECT 'blocks_per_owner_max', NULL, NULL,
       (SELECT max(n) FROM (SELECT count(*) n FROM public.website_blocks b
                             JOIN public.website_pages p ON p.id = b.page_id GROUP BY p.user_id) x)
ORDER BY 1;

-- Q6: jsonb shape census per jsonb column (shape and count only)
SELECT 'pages.theme' AS col, jsonb_typeof(theme) AS shape, count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.client_flow', jsonb_typeof(client_flow), count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'blocks.content', jsonb_typeof(content), count(*) FROM public.website_blocks GROUP BY 2
UNION ALL SELECT 'blocks.styles', jsonb_typeof(styles), count(*) FROM public.website_blocks GROUP BY 2
UNION ALL SELECT 'blocks.capability_config', jsonb_typeof(capability_config), count(*) FROM public.website_blocks GROUP BY 2
UNION ALL SELECT 'smart_links.metadata', jsonb_typeof(metadata), count(*) FROM public.smart_links GROUP BY 2
UNION ALL SELECT 'content.' || e.key, jsonb_typeof(e.value), count(*)
FROM public.website_content wc,
     jsonb_each(to_jsonb(wc) - 'id' - 'user_id' - 'created_at' - 'updated_at') e
GROUP BY 1, 2
ORDER BY 1, 2;

-- Q6a: key names at every depth (up to 6), per column; arrays are walked, values never shown
WITH RECURSIVE src(col, j) AS (
  SELECT 'pages.theme', theme FROM public.website_pages
  UNION ALL SELECT 'pages.client_flow', client_flow FROM public.website_pages
  UNION ALL SELECT 'blocks.content', content FROM public.website_blocks
  UNION ALL SELECT 'blocks.styles', styles FROM public.website_blocks
  UNION ALL SELECT 'blocks.capability_config', capability_config FROM public.website_blocks
  UNION ALL SELECT 'smart_links.metadata', metadata FROM public.smart_links
  UNION ALL SELECT 'content.' || e.key, e.value
  FROM public.website_content wc,
       jsonb_each(to_jsonb(wc) - 'id' - 'user_id' - 'created_at' - 'updated_at') e
),
walk(col, k, v, depth) AS (
  SELECT s.col, c.key, c.value, 1
  FROM src s
  CROSS JOIN LATERAL (
    SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(s.j) = 'object' THEN s.j ELSE '{}'::jsonb END) o
    UNION ALL
    SELECT '[]', a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.j) = 'array' THEN s.j ELSE '[]'::jsonb END) a
  ) c
  UNION ALL
  SELECT w.col, c.key, c.value, w.depth + 1
  FROM walk w
  CROSS JOIN LATERAL (
    SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) o
    UNION ALL
    SELECT '[]', a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v ELSE '[]'::jsonb END) a
  ) c
  WHERE w.depth < 6
)
SELECT col, k AS key_name, min(depth) AS depth, count(*) AS occurrences
FROM walk
WHERE k <> '[]'
GROUP BY col, k
ORDER BY col, min(depth), k;

-- Q6b: only the key names that look like a secret, tracking or AI generation input (expect none, or a short reviewed list)
-- Run Q6a again with this final SELECT in place of its last four lines:
--   SELECT col, k AS key_name, count(*) FROM walk
--   WHERE k ~* '(token|secret|key|password|passwd|credential|session|^ip$|ip_|user_?agent|hash|salt|prompt|model|api)'
--   GROUP BY col, k ORDER BY col, k;

-- Q7: any column on the 5 tables whose NAME looks like tracking, a token, a secret, a code, a path or a URL
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
  AND column_name ~ '(ip|agent|session|fingerprint|device|token|secret|salt|hash|key|code|cookie|visitor|ref|path|bucket|url|file|storage|prompt|model|count|revenue)'
ORDER BY 1, 2;

-- Q8: status, type and code values (codes only, never a slug, code or URL)
SELECT 'pages.page_type' AS col, page_type AS value, count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.status', coalesce(status, '(null)'), count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.published', coalesce(published::text, '(null)'), count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.status_vs_published', coalesce(status, '(null)') || '/' || coalesce(published::text, '(null)'), count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.website_language', coalesce(website_language, '(null)'), count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.custom_domain_set', (custom_domain IS NOT NULL)::text, count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.content_generated', (content_generated_at IS NOT NULL)::text, count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'pages.template_set', (template_id IS NOT NULL)::text, count(*) FROM public.website_pages GROUP BY 2
UNION ALL SELECT 'blocks.block_type', block_type, count(*) FROM public.website_blocks GROUP BY 2
UNION ALL SELECT 'blocks.enabled', coalesce(enabled::text, '(null)'), count(*) FROM public.website_blocks GROUP BY 2
UNION ALL SELECT 'smart_links.destination_type', coalesce(destination_type, '(null)'), count(*) FROM public.smart_links GROUP BY 2
UNION ALL SELECT 'smart_links.is_active', coalesce(is_active::text, '(null)'), count(*) FROM public.smart_links GROUP BY 2
UNION ALL SELECT 'smart_links.code_length', length(code)::text, count(*) FROM public.smart_links GROUP BY 2
UNION ALL SELECT 'user_media.source', source, count(*) FROM public.user_media GROUP BY 2
UNION ALL SELECT 'user_media.section', coalesce(section, '(null)'), count(*) FROM public.user_media GROUP BY 2
UNION ALL SELECT 'user_media.aspect', coalesce(aspect, '(null)'), count(*) FROM public.user_media GROUP BY 2
UNION ALL SELECT 'user_media.source_ref_prefix', coalesce(split_part(source_ref, ':', 1), '(null)'), count(*) FROM public.user_media GROUP BY 2
UNION ALL SELECT 'user_media.description_set', source || '/' || (description IS NOT NULL)::text, count(*) FROM public.user_media GROUP BY 2
ORDER BY 1, 2;

-- Q9: counters on smart_links (counts of non-zero values, and totals; no per-link figure)
SELECT count(*) AS links,
       count(*) FILTER (WHERE coalesce(click_count, 0) <> 0) AS with_clicks,
       count(*) FILTER (WHERE coalesce(conversion_count, 0) <> 0) AS with_conversions,
       count(*) FILTER (WHERE coalesce(revenue_cents, 0) <> 0) AS with_revenue
FROM public.smart_links;

-- Q9b: URLs with a query string or a token-like parameter (counts only)
SELECT 'smart_links.destination_url' AS col,
       count(*) FILTER (WHERE destination_url LIKE '%?%') AS with_query,
       count(*) FILTER (WHERE destination_url ~* '(token|session|sid|code|key|secret|sig)=') AS token_like
FROM public.smart_links
UNION ALL SELECT 'pages.og_image_url', count(*) FILTER (WHERE og_image_url LIKE '%?%'),
       count(*) FILTER (WHERE og_image_url ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_pages
UNION ALL SELECT 'pages.favicon_url', count(*) FILTER (WHERE favicon_url LIKE '%?%'),
       count(*) FILTER (WHERE favicon_url ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_pages
UNION ALL SELECT 'pages.client_flow', count(*) FILTER (WHERE client_flow::text LIKE '%?%'),
       count(*) FILTER (WHERE client_flow::text ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_pages
UNION ALL SELECT 'blocks.content', count(*) FILTER (WHERE content::text ~ 'https?://[^" ]*\?'),
       count(*) FILTER (WHERE content::text ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_blocks
UNION ALL SELECT 'blocks.capability_config', count(*) FILTER (WHERE capability_config::text ~ 'https?://[^" ]*\?'),
       count(*) FILTER (WHERE capability_config::text ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_blocks
UNION ALL SELECT 'website_content', count(*) FILTER (WHERE to_jsonb(wc)::text ~ 'https?://[^" ]*\?'),
       count(*) FILTER (WHERE to_jsonb(wc)::text ~* '(token|session|sid|code|key|secret|sig)=') FROM public.website_content wc
UNION ALL SELECT 'user_media.public_url', count(*) FILTER (WHERE public_url LIKE '%?%'),
       count(*) FILTER (WHERE public_url ~* '(token|session|sid|code|key|secret|sig)=') FROM public.user_media
ORDER BY 1;

-- Q10: storage paths on user_media (counts only): path under the owner's own folder (expect all),
--      public_url carrying the same path (expect all), and the first sub-folder used
SELECT count(*) AS media,
       count(*) FILTER (WHERE split_part(storage_path, '/', 1) <> user_id::text) AS path_not_under_owner,
       count(*) FILTER (WHERE position(storage_path IN public_url) = 0) AS url_without_path,
       count(*) FILTER (WHERE public_url NOT LIKE '%/website-images/%') AS url_not_website_images
FROM public.user_media;

SELECT split_part(storage_path, '/', 2) AS sub_folder, source, count(*)
FROM public.user_media
GROUP BY 1, 2 ORDER BY 1, 2;

-- Q10b: website-images objects vs user_media rows (for DE-8b): objects without a row, rows without an object
SELECT
  (SELECT count(*) FROM storage.objects o
    WHERE o.bucket_id = 'website-images'
      AND NOT EXISTS (SELECT 1 FROM public.user_media m WHERE m.storage_path = o.name)) AS objects_without_row,
  (SELECT count(*) FROM public.user_media m
    WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'website-images' AND o.name = m.storage_path)) AS rows_without_object,
  (SELECT count(*) FROM storage.objects o
    WHERE o.bucket_id = 'website-images'
      AND (storage.foldername(o.name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS objects_outside_owner_folders;

-- Q11: largest owners: rows and bytes per owner across the 5 tables (blocks counted through their page; top 5)
SELECT user_id, sum(n) AS rows, pg_size_pretty(sum(b)) AS bytes
FROM (
  SELECT user_id, count(*) n, sum(pg_column_size(t.*)) b FROM public.website_pages t GROUP BY 1
  UNION ALL SELECT p.user_id, count(*), sum(pg_column_size(b.*)) FROM public.website_blocks b
            JOIN public.website_pages p ON p.id = b.page_id GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.website_content t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.smart_links t GROUP BY 1
  UNION ALL SELECT user_id, count(*), sum(pg_column_size(t.*)) FROM public.user_media t GROUP BY 1
) x
GROUP BY user_id ORDER BY sum(b) DESC LIMIT 5;

-- Q12: cross-tenant integrity of bare pointers (expect 0 on every row; report-only)
SELECT 'blocks capability serviceId -> service of another owner' AS edge, count(*)
FROM public.website_blocks b
JOIN public.website_pages p ON p.id = b.page_id
JOIN public.scheduling_services s ON s.id::text = b.capability_config->>'serviceId'
WHERE s.user_id <> p.user_id
UNION ALL SELECT 'blocks content serviceId -> service of another owner', count(*)
FROM public.website_blocks b
JOIN public.website_pages p ON p.id = b.page_id
JOIN public.scheduling_services s ON s.id::text = b.content->>'serviceId'
WHERE s.user_id <> p.user_id
UNION ALL SELECT 'smart_links metadata serviceIds -> service of another owner', count(*)
FROM public.smart_links l
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(l.metadata->'serviceIds') = 'array' THEN l.metadata->'serviceIds' ELSE '[]'::jsonb END) sid(v)
JOIN public.scheduling_services s ON s.id::text = sid.v
WHERE s.user_id <> l.user_id
UNION ALL SELECT 'pages client_flow intake_form_id -> form of another owner', count(*)
FROM public.website_pages p
JOIN public.business_intake_forms f ON f.id::text = p.client_flow->>'intake_form_id'
WHERE f.user_id <> p.user_id
UNION ALL SELECT 'blocks content -> picture in another owner folder', count(*)
FROM public.website_blocks b
JOIN public.website_pages p ON p.id = b.page_id
CROSS JOIN LATERAL regexp_matches(b.content::text, '/website-images/([0-9a-f-]{36})/', 'g') m
WHERE m[1] <> p.user_id::text
UNION ALL SELECT 'website_content -> picture in another owner folder', count(*)
FROM public.website_content wc
CROSS JOIN LATERAL regexp_matches(to_jsonb(wc)::text, '/website-images/([0-9a-f-]{36})/', 'g') m
WHERE m[1] <> wc.user_id::text
UNION ALL SELECT 'pages subdomain differs from business_profiles subdomain', count(*)
FROM public.website_pages p
JOIN public.business_profiles bp ON bp.user_id = p.user_id
WHERE p.subdomain IS NOT NULL AND bp.subdomain IS NOT NULL AND p.subdomain <> bp.subdomain
ORDER BY 1;

-- Q13: soft-delete-looking columns on the 5 tables (expect none)
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('website_pages', 'website_blocks', 'website_content', 'smart_links', 'user_media')
  AND column_name IN ('deleted_at', 'is_deleted', 'archived_at', 'deleted')
ORDER BY 1, 2;
```

**Q14 (T-10 drift check)** is written by Dev after T-2 from the final declared lists, in the DE-5 / DE-6 §T-10 shape (one `VALUES` list of `(table, column)` declared in `columns` ∪ `excludedColumns`, full-outer-joined against `information_schema.columns` for the 5 tables; expect 0 rows).

---

## 12. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **SA-Q1** | **New pattern (rule 7):** read `website_blocks` through its owner-scoped parent inside `listOwnedRowsForExport` (§2.6: owner's page ids by `.eq('user_id')`, chunked `.in('page_id', …)`, V-6 post-check, sort by id), rather than an embedded `!inner` filter, an RPC / view, a migration adding `user_id`, or excluding the table? | **Yes, §2.6.** Every alternative either moves the tenant filter out of the tested place, rests it on one character, needs a migration, or loses the page content |
| **SA-Q2** | The two-key opt-in: `include.viaParent: { parent, fk }` must equal the purge `scope`; a `via` scope without it still fails closed with no query; only `website_blocks` carries it (a second one is an SA item) | Yes: a purge-scope edit alone can never change what the export reads |
| **SA-Q3** | New group `content`, `gdpr_role: 'processor'`, controller `account_holder` (we host the owner's website for them; it holds names of their clients and team), not `account` / controller. `format_version` stays 2 | `content` / processor; additive, so 2 |
| SA-Q4 | Section ids `website_content`, `website_pages`, `website_blocks`, `smart_links`, `images`, in that order after `email_unsubscribes` | As stated (`images`, not `user_media`, because DE-8b names the CSV after it) |
| **SA-Q5** | `user_media.storage_path` out (`DOCUMENT_STORAGE`, unchanged text, as DE-4); `public_url` in (public, already on the site and inside block content); the §2.8 DE-8b mapping note (manifest from `STORAGE_DESCRIPTORS`; zip path = object name minus `{user_id}/`; an optional computed `file_in_export` column from DE-8b's own internal read, never the raw key) | Yes |
| SA-Q6 | `user_media.source_ref` out (`REUSE_KEY`): a stock id or a hash of a picture request, used only for reuse; `source` stays in | Out |
| SA-Q7 | jsonb whole (§4) on the Q6 census; any Q6b hit turns that column into a `pickStringKeys` allow-list before code | As stated |
| SA-Q8 | URLs (`destination_url`, `og_image_url`, `favicon_url`, URLs in jsonb): keep as held unless Q9b shows token-like parameters; then cut with `withoutQueryOrFragment` (DE-6 SA-Q7) on the named column(s) only. A smart link's own UTM query string on `destination_url` is the owner's setting, not visitor data | Keep as held if Q9b token-like = 0 |
| SA-Q9 | The flip (§5): `PLANNED_TABLES_ALLOWED = false`; remove the `planned()` helper; keep the `planned` type variant and `PlannedTableSlice` (the CI rule and its controls need them); re-plant the controls on `website_page_views` | Yes |
| SA-Q10 | Chunk size 100 parent ids per `in` (`EXPORT_LIMITS.VIA_PARENT_CHUNK`); rows sorted by `id` after collection so the README's "rows in id order" holds | Yes |
| SA-Q11 | `smart_links` counters out: `click_count`, `conversion_count` (`VISIT_STATS`), `revenue_cents` (`ATTRIBUTED_REVENUE`: derived and currency-less). `code` in (public address, as DE-3 SA-Q3) | As stated (BC-1) |
| SA-Q12 | `user_media.description` in, although for a generated picture it is the request the owner typed (F-7): the owner's own words and the site's alt text, not system generation metadata like DE-6 `generated_from`. `website_pages.content_generated_at` in (a timestamp, as DE-6 `generated_at`) | In (BC-5, BC-4) |

---

## 13. Business calls (for the user, via TL)

Plain terms. Each has a default; TL applies the default (the user authorised an autonomous run) and the user may change it.

| # | Question | Default |
|---|---|---|
| **BC-1** | For your **smart links**: how many people **clicked** each link, how many **signed up or booked**, and how much **money** the link is credited with. That is activity (like the email open and click counts you left out), and the money figure is a running total of payments that are already in your download, with no currency of its own. The link itself is in: its short code, its name, where it goes, its campaign tags, and whether it is on | **Counts and money total out; the link in** |
| **BC-2** | Smart links that are **switched off**, including the ones the system created for you automatically | **In, each with its on/off state** |
| **BC-3** | Website pages and landing pages that are **drafts, unpublished or archived** | **In, each with its status** |
| **BC-4** | Website and landing-page **text the assistant drafted** for you (and you may have edited) | **In**: it is your website's content, whoever drafted it. The date the assistant last wrote a page is in; nothing else about how it was generated is stored |
| **BC-5** | Your **picture library**: every picture you uploaded, every stock photo chosen for your site, and every picture the assistant made for you, each with its public web address, where it is used, its size and its description. For a picture the assistant made, the description is **the request you typed** ("a calm therapy room with plants"). The picture files themselves come with the "Your files" part of the download (a later step) | **All in, descriptions included** |
| BC-6 | Your **web addresses**: your site's address (subdomain), your own domain if you connected one, page addresses and smart-link short codes. They are already public | **In** |
| BC-7 | **Hidden** sections (blocks you switched off on a page) | **In, marked hidden** |
| BC-8 | Page **view counts and visitor details** (already decided out as visitor tracking; restated so nothing is assumed) | **Out** (unchanged) |

---

## Dev implementation notes (2026-10-17)

### As built

| Area | What landed |
|---|---|
| Descriptors | `── DE-7: website and content ──` block after DE-6: `CONTENT_COLUMN_REASON` (`VISIT_STATS`, `ATTRIBUTED_REVENUE`, `REUSE_KEY`), `WEBSITE_CONTENT_EXPORT`, `WEBSITE_PAGES_EXPORT`, `WEBSITE_BLOCKS_EXPORT` (with `viaParent`), `SMART_LINKS_EXPORT`, `USER_MEDIA_EXPORT`, exactly §3. The 5 `planned('DE-7')` calls replaced; nothing else on those rows changed (pinned, D-17). `planned()` removed, with a comment saying why |
| Types / limits | 5 section ids; `viaParent?: { parent; fk }` on `include`; `planned` / `PlannedTableSlice` comments "forbidden on tables since DE-7"; `EXPORT_LIMITS.VIA_PARENT_CHUNK = 100` |
| Classification | `viaShapeProblems` (V-1 / V-3, inside `tableExportProblems`), `viaParentProblems(descriptors)` (V-2, exported, CI), `viaParentOf(child, descriptors)` (request time, C-5; throws `invalid_via_parent`, a new error code). No new import (C-2 cycle rule holds) |
| Repository | `listOwnedRowsForExport`: `via` + `viaParent` goes to the new private `readThroughParent`, after V-1…V-3 and E-3 for child AND parent; `via` without the opt-in keeps `not_user_scoped` unchanged. Header: E-2 amended, E-4 note, a V-1…V-6 block |
| Sections / payload | `ExportGroupId` + `'content'`; `contentSection(id)`; 5 entries after `email_unsubscribes`; `EXPORT_GROUPS.content` (§2.3 sentence) |
| Not touched | the route, `lib/client`, every domain repository, any migration, `STORAGE_DESCRIPTORS`. No `console.*` in any touched source file; no entitlements import |

### Deviations from the plan (for SA)

| # | Deviation | Why |
|---|---|---|
| DV-1 | T-0a by `git merge origin/main` (fast-forward), not a rebase | Project rule (TL instruction): merge, never rebase |
| DV-2 | New request-time helper `viaParentOf` in `classification.ts` and a new error code `invalid_via_parent` | C-5 asks for V-1…V-3 at runtime; one pure function shared by CI and the repository keeps the two halves from drifting |
| DV-3 | Three extra fail-closed checks: a `viaParent` beside a `user_id` scope; repeated parent ids inside the oracle read; `VIA_PARENT_CHUNK` not a positive integer | Jest does not type-check; each fails the section with no (further) query. The third surfaced in `route.test.ts`, whose mocked limits lacked the new key (now added there) |
| DV-4 | D-8 (c) is a test that records the RAW child responses of a fake ignoring `.in` and shows B's blocks are in them (so V-6 is the only thing between them and the file); the source-level revert is mutation M1 below | A test cannot revert a private method's line in memory without re-compiling the module; both halves together show V-6 is load-bearing |
| DV-5 | `route.test.ts` seeds no other-owner rows | That mock does not apply `.eq`; cross-tenant is proven in the repository test (D-8). The route test seeds a block on a page id that is not the owner's, and the `.in` drops it |
| DV-6 | With no page, `website_blocks` is never queried: a no-seed route run touches 37 tables, a run with pages 38 | By design (§2.6 step 2: zero parent ids, no child query); pinned both ways |
| DV-7 | Characterization: a PostgREST error on `website_pages` fails both its reads, so `website_blocks` is `failed` too | Realistic (one broken table); the mock queues two errors |
| DV-8 | Two DE-6 expectations changed: N-9 "every include without rowKey lists id" 32 → 37; its via-scope control now also reports the V-1 message | The new rule fires on that plant, correctly |
| DV-9 | D-17 compares each row's `order` band with a sibling (`crm_contacts` ROOT, `website_page_views` LEAF), not a literal number | `ORDER` is module-private |
| DV-10 | Requirement: one line replaced (`Last Updated`), everything else inserted | Doc standard |

### Q14 (T-10 drift check, for TL: read-only, PROD)

Generated from the real descriptors (`tsx`, `PURGE_DESCRIPTORS`), 84 distinct names. No statement contains the editor's problem word.

**File:** (pasted by TL; not committed)

```sql
-- Q14 (T-10 drift check, DE-7): the declared names (columns + excludedColumns) of the 5 included
-- DE-7 tables against the live columns. Expect 0 rows (0 drift, 0 missing). 84 declared names.
WITH declared(table_name, column_name) AS (
  VALUES
    ('website_content','id'), ('website_content','hero'), ('website_content','about'), ('website_content','services'), ('website_content','testimonials'), ('website_content','faq'),
    ('website_content','team'), ('website_content','contact'), ('website_content','process'), ('website_content','features'), ('website_content','stats'), ('website_content','pricing'),
    ('website_content','gallery'), ('website_content','cta'), ('website_content','newsletter'), ('website_content','logo_cloud'), ('website_content','video'), ('website_content','booking_widget'),
    ('website_content','payment_button'), ('website_content','intake_form'), ('website_content','created_at'), ('website_content','updated_at'), ('website_content','user_id'),
    ('website_pages','id'), ('website_pages','page_type'), ('website_pages','slug'), ('website_pages','title'), ('website_pages','meta_description'), ('website_pages','seo_keywords'),
    ('website_pages','published'), ('website_pages','published_at'), ('website_pages','template_id'), ('website_pages','theme'), ('website_pages','created_at'), ('website_pages','updated_at'),
    ('website_pages','subdomain'), ('website_pages','custom_domain'), ('website_pages','custom_domain_verified'), ('website_pages','status'), ('website_pages','last_published_at'), ('website_pages','favicon_url'),
    ('website_pages','og_image_url'), ('website_pages','client_flow'), ('website_pages','website_language'), ('website_pages','content_generated_at'), ('website_pages','user_id'),
    ('website_blocks','id'), ('website_blocks','page_id'), ('website_blocks','block_type'), ('website_blocks','position'), ('website_blocks','content'), ('website_blocks','styles'),
    ('website_blocks','created_at'), ('website_blocks','enabled'), ('website_blocks','capability_config'),
    ('smart_links','id'), ('smart_links','code'), ('smart_links','name'), ('smart_links','destination_url'), ('smart_links','destination_type'), ('smart_links','source'),
    ('smart_links','medium'), ('smart_links','campaign'), ('smart_links','content'), ('smart_links','is_active'), ('smart_links','created_at'), ('smart_links','updated_at'),
    ('smart_links','metadata'), ('smart_links','user_id'), ('smart_links','click_count'), ('smart_links','conversion_count'), ('smart_links','revenue_cents'),
    ('user_media','id'), ('user_media','public_url'), ('user_media','source'), ('user_media','section'), ('user_media','aspect'), ('user_media','description'),
    ('user_media','width'), ('user_media','height'), ('user_media','created_at'), ('user_media','user_id'), ('user_media','storage_path'), ('user_media','source_ref')
),
live AS (
  SELECT table_name::text, column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('website_content', 'website_pages', 'website_blocks', 'smart_links', 'user_media')
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

### Tests (T-8) and mutation checks

All in existing suites (no new file, job or script). `exportClassification.test.ts`: flip + re-plants (T-6 ×2 cases, T-7 rewritten, T-10), totals 38 / 0 / 117, DE-7 D-1 / D-2 (pins, reasons, inline live set 84, drift / missing, deny), D-4 (V-1…V-3 eight shape controls + rowKey control, V-2 six parent controls each also refused by `viaParentOf`, V-7 single-use pin), D-14, D-17 (purge fields, helper gone, type kept). `sections.test.ts`: D-15 (order, group, role, `EXPORT_GROUPS.content`, no mapper, failed section, budget). `BusinessDataExportRepository.test.ts`: fake gains `in` + `ignoreInFilter`; four keyset content tables; D-5, D-6 (0 pages, 101 pages = 100 + 1, C-3 reset, paging, short pages), D-7 (exact, +1 across chunks, C-4), D-8 (cross-tenant + controls a, b, c), D-9 (bad parent ids, repeated ids, PostgREST errors, C-1 non-string / wrong chunk / repeated id, ten bad-descriptor plants with no query), D-10, D-14, C-2 source pin. `route.characterization.test.ts`: re-pin (38 tables, 6 new literals, the 33 earlier selects untouched: `git diff 6f309f39` shows no removed `SELECTS` line). `route.test.ts`: D-11, D-12, D-13, D-18.

Mutation checks, each applied to the source in place, run, restored and verified by sha256 (never `git stash`). **All 12 red:**

| # | Mutation | Red |
|---|---|---|
| M1 | V-6 post-check disabled | 3 (D-8 b, C-1 wrong chunk, C-1 non-string) |
| M2 | final sort by `localeCompare` | 1 (C-2 source pin) |
| M3 | `lastId` carried across chunks | 1 (C-3) |
| M4 | parent-id bound removed | 1 (C-4) |
| M5 | uuid check on parent ids removed | 1 (D-9) |
| M6 | repeated-id check removed | 1 (C-1) |
| M7 | unknown-section rule (T-6 re-plant on `website_page_views`) | 1 |
| M8 | one-include-per-section rule (T-6 re-plant) | 1 |
| M9 | `not_included` rule (T-10 re-plant) | 1 |
| M10 | planned-flag rule (T-7 re-plant, D-1) | 2 |
| M11 | `viaParent` equals-scope rule | 2 |
| M12 | one-hop parent rule | 1 |

### Runs and runtimes (T-11, C-10)

| Run | Result |
|---|---|
| `lib/business-os/data-export`, `lib/business-os/purge`, `BusinessDataExportRepository.test.ts`, `app/api/user/data-export` | 21 suites, 894 tests, all pass (was 808) |
| `lib/client` | 73 / 73 |
| `npm run test:bos-entitlements` (includes all of `lib/repositories/__tests__`) | 280 suites, 8,575 tests, all pass |
| `npm run test:authz-guard` | 2 suites, 203 tests, all pass |
| ESLint on the 13 touched files; scoped `tsc` on the touched source files | clean (the touched test files carry one pre-existing TS error, a DE-6 line, `exportClassification.test.ts` N-9 `scope` in an object literal; Jest does not type-check) |

Runtimes of the six touched suites, summed, local, warm, 3 runs each, the 13 files swapped to `HEAD` from backups for "before" and restored (sha256-verified): **before 14.0 / 14.1 s, after 16.8 / 17.0 s (first, cold run 22.7 / 22.5 s): about +2.8 s**, mostly the characterization suite (+1.6 s: its `it.each` over 5 more tables) and the repository suite (+1 s). Jest runs suites in parallel, so the wall-clock effect on the required job is smaller; not in the `next build` path. Near the C-10 ≈ 3 s line: SA's call.

### Items for SA code review

1. The new pattern, as built: `readThroughParent` and `viaParentOf` (C-1…C-6, DV-2, DV-3).
2. DV-4: D-8 (c) as a raw-response test plus mutation M1.
3. C-10: +2.8 s summed over six suites (above).
4. The new error code `invalid_via_parent` (only a log / `{ error }` value; never in the file).

---

## SA Review Notes

(SA populates.)

### SA workplan review DE-7 — 2026-10-17

**Reviewed by SA — 2026-10-17** (against `origin/feature/data-export-de6` `6f309f39`: `BusinessDataExportRepository.ts`, `limits.ts`, `payload.ts`, `sections.ts`, `exportClassification.test.ts`, requirement §0.6 SA-Q11; T-0 §11.1; TL defaults §13.1)
**Status:** ✅ Approved with conditions C-1…C-10 (binding at implementation; SA code review checks each)

**Reconciliation with T-0 (§11.1).** §3 matches the live set exactly: 23 / 23 / 9 / 17 / 12; `intake_form` is live, so §3.1 stands at 22 in / 1 out (the "22 if not live" fallback is dead). §3.6 totals 84 = 75 in + 9 out stand. `website_blocks.page_id → website_pages ON DELETE CASCADE`, no `user_id`, 0 orphans: F-2 confirmed. Q6 census clean (no secret / tracking / prompt keys, 0 token-like values): every jsonb column goes out whole, no `pickStringKeys` (SA-Q7). Q9 token-like 0: no row mapper (SA-Q8). Q10/Q12: 0 crossed pointers, every media path under `{user_id}/`; the one subdomain mismatch is same-owner and exported as stored (R-10). Q13: no soft-delete column, so no `rowFilter` anywhere is correct. Q10b and Q11 were not reported in §11.1: not blocking DE-7 (volumes are tiny: max 3 pages, 113 blocks platform-wide); Q10b is owed to DE-8b's workplan.

**New pattern (rule 7): the `viaParent` reader. Approved as designed in §2.6, with C-1…C-6.** Assessment:
- *Tenant isolation.* The only id is the session `userId`; the parent set is produced by the same E-4 boundary (`.eq('user_id', userId)` as first filter) that every other section relies on, so the oracle is no weaker than today. Children are accepted only if their `fk` is in that set (V-6), so an ignored or mis-built `.in` fails the section instead of leaking. No caller id exists in the path (signature unchanged, D-10). Snapshot races are benign: a page deleted between the two reads cascades its blocks (fewer rows, never foreign); a page created between them is simply missed, as with any non-transactional section.
- *Rejected alternatives.* Agreed on every row. The `!inner` embed is rejected on the right ground: a one-character omission turns the filter into an embed filter and returns every tenant's blocks with no error, and it breaks E-3. RPC/view breaks E-1 and needs a migration. Per-page reads are equally safe but pointless given chunking.
- *Chunk size.* 100 canonical uuids ≈ 3.7 kB plus a 9-column select string: well under the PostgREST/gateway URL limits (≈ 8 kB conservative). Live max is 3 pages per owner, so production issues one chunk. 100 approved (SA-Q10).
- *Paging.* Per-chunk keyset on `id` with the existing empty-page stop and C-8 check is correct; `lastId` must reset per chunk (C-3).

**Conditions**
- **C-1 (V-6, stricter).** The post-check is against the **current chunk** (not only the whole owned set), and `row[fk]` and `row.id` must be `typeof === 'string'`; a non-string or out-of-chunk value fails the section. This also guarantees no row can be collected twice. After the final sort, a duplicate `id` fails the section closed (cheap invariant, one pass).
- **C-2 (sort).** Final sort uses plain code-unit comparison (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`), **never** `localeCompare` (locale collation is not uuid byte order). A source pin in `BusinessDataExportRepository.test.ts` asserts no `localeCompare` in the file; D-5 asserts the final order across chunks.
- **C-3 (paging).** `lastId` resets to `null` at each chunk; the C-8 non-advance check applies within a chunk. D-6 includes a two-chunk case where chunk 2's ids sort **before** chunk 1's last id (proves the reset and the final sort).
- **C-4 (parent-id bound).** The parent-id loop is bounded: past `EXPORT_LIMITS.ROW_CEILING` parent ids it stops and returns `overCeiling: true` with no rows (no child query). Parent ids still do not count against `maxRows` (agreed, §2.6 step 5); this bound only stops an unbounded id list from building in memory or in queries.
- **C-5 (order of checks).** Branch order in `listOwnedRowsForExport`: Zod → E-2 resolve → if `scope.kind === 'via'`: V-1…V-3 at runtime (including that `viaParent.parent` / `fk` are non-empty strings: Jest does not type-check) → E-3 `exportColumnsOf` for child **and** parent → reads. A `via` descriptor without `viaParent` keeps the existing `not_user_scoped` code and message shape, so the existing control is unchanged. The parent descriptor is resolved from the same `this.descriptors` set by the table name **on the child descriptor** (code constant), never from any input.
- **C-6 (V-4 placement).** The uuid regex runs on every parent id before it is added to the set (not only before the `.in`), and a failure fails the section after the parent query only (D-9). Values go to `.in()` as a plain string array (no hand-built `in.(…)` string).
- **C-7 (flip, SA-Q9).** Approved as §5: `PLANNED_TABLES_ALLOWED = false`; `planned()` helper removed; `planned` variant and `PlannedTableSlice` kept with "forbidden on tables since DE-7" comments; `PLANNED_FILES_ALLOWED` stays `true`. Every control that planted on `smart_links` "because still planned" (T-6 ×3, T-10) moves to `website_page_views` (user_id-scoped, `exclude(VISITOR)`) and keeps its asserted message/code; T-10 now reads "classified exclude" with code `not_included`. Each re-planted control is shown red once (T-8 mutation check) so none goes vacuous after the move.
- **C-8 (byte-identical).** The 33 existing select strings and every DE-1…DE-6 section's output are byte-identical to `6f309f39` (D-16 compares against literals copied from that commit, not regenerated). `format_version` stays 2. The only `export_metadata` change is the added `content` group.
- **C-9 (doc fixes, no behaviour).** §3.3 cites BC-8 for hidden blocks: should be **BC-7**. §2.8 / F-4 "22 if not live" lines may stay as history but §3 is final at 22/22/9/13/9.
- **C-10 (CI time).** T-11 before/after runtimes recorded; anything beyond ≈ 3 s on the Jest job comes back to SA before hand-over. Not in the `next build` path (confirmed, §9).

**Rulings SA-Q1…SA-Q12**
| # | Ruling |
|---|---|
| SA-Q1 | ✅ Parent-scoped read inside `listOwnedRowsForExport`, per §2.6 + C-1…C-6. Alternatives rejected for the reasons in §2.6. A `user_id` column on `website_blocks` remains a reasonable future follow-up, not DE-7 |
| SA-Q2 | ✅ Two-key opt-in. `viaParent` must deep-equal `{ parent, fk }` of the purge scope (statically in `classification.ts`, and again at runtime, C-5); only `website_blocks` carries it (pinned, V-7). A second `viaParent`, or any via-of-via, is an SA item |
| SA-Q3 | ✅ New group `content`: `gdpr_role: 'processor'`, `controller: EXPORT_ACCOUNT_HOLDER`, the §2.3 sentence. Consistent with `client_records` (we host the owner's site on their behalf; it holds their clients' and team's names). Additive, `format_version` 2 |
| SA-Q4 | ✅ `website_content`, `website_pages`, `website_blocks`, `smart_links`, `images`, after `email_unsubscribes`. `website_blocks` after its parent is required (D-11 "read twice" order) |
| SA-Q5 | ✅ `storage_path` OUT (`DOCUMENT_STORAGE`, text byte-identical, DE-4 pins untouched); `public_url` IN (already public on the site and inside block content). The §2.8 DE-8b note is accepted **as a proposal recorded in §0.11**, not a DE-8b decision: zip path = object name minus `{user_id}/` under the bucket folder; any link column DE-8b adds is computed from its own internal read and never writes the raw key. DE-8b's workplan rules the column name and whether it exists, and carries Q10b |
| SA-Q6 | ✅ `source_ref` OUT (`REUSE_KEY`); `source` IN |
| SA-Q7 | ✅ All jsonb whole: Q6 census clean, no allow-list needed |
| SA-Q8 | ✅ Keep URLs as held: token-like = 0. The 3 `destination_url` query strings are the owner's own UTM settings. No row mapper |
| SA-Q9 | ✅ As C-7 |
| SA-Q10 | ✅ Chunk 100, `EXPORT_LIMITS.VIA_PARENT_CHUNK`; final sort by `id` per C-2 |
| SA-Q11 | ✅ `click_count`, `conversion_count` OUT (`VISIT_STATS`), `revenue_cents` OUT (`ATTRIBUTED_REVENUE`: derived, currency-less, CLAUDE.md § Currency); `code` IN (public, matches no deny rule). Matches BC-1 |
| SA-Q12 | ✅ `description` IN (owner's own words and the site's alt text; not system generation metadata); `content_generated_at` IN (timestamp only, as DE-6 `generated_at`). Matches BC-5 / BC-4 |

**Other checks.** Tenant-isolation-guard: satisfied (ownership via parent, set-wise, oracle first, nothing accepted it did not vouch for; D-8 has the three right negative controls, (c) proves V-6 is load-bearing). E-1 holds (`.in` is a read filter). No entitlements import, no LLM call, no queue, no migration, no new route: those skills do not apply. Deny list: no DE-7 column hits it; `DENY_EXCEPTIONS` stays at one. No `console.*` expected in touched files; flag per CLAUDE.md § Logging if T-3 finds any.

### Approval
[x] Workplan approved — proceed to implementation after T-0a (PR #443 on main, rebase, six DE-6 files diff-empty), with C-1…C-10 binding

### SA code review DE-7 — 2026-10-17

**Code Review by SA — 2026-10-17** (worktree `neuronforge-de7`, `feature/data-export-de7` at origin/main `16cb2a1f` + uncommitted changes; 14 modified files + this workplan; 1,752 insertions / 73 deletions)
**Status:** ✅ Code Approved

**Re-run by SA.** `npx jest lib/business-os/data-export lib/business-os/purge lib/repositories/__tests__/BusinessDataExportRepository.test.ts app/api/user/data-export`: 21 suites, 894 tests, all pass (matches Dev's notes). Read line by line: `readThroughParent` and the new branch of `listOwnedRowsForExport` (`BusinessDataExportRepository.ts`), `viaShapeProblems` / `viaParentLinkProblems` / `viaParentProblems` / `viaParentOf` (`classification.ts`), the 5 descriptors and the `planned()` removal (`descriptors.ts`), `classificationTypes.ts`, `limits.ts`, `payload.ts`, `sections.ts`, and the test diffs.

**The new pattern (rule 7), against C-1…C-6**
| Condition | As built | Verdict |
|---|---|---|
| C-1 V-6 per chunk, string ids, duplicate after sort | Each child page is filtered against `inChunk` (the current chunk, not the whole owned set); `typeof row.id !== 'string'` and `typeof row[fk] !== 'string'` both count as unowned; any unowned row throws with a count-only message. After the final sort, one pass compares neighbours and throws on a repeated `id`. Tests: wrong chunk (chunk size 1, fake ignoring `.in`), non-string id / NULL `page_id`, repeated id across two chunks | ✅ |
| C-2 code-unit sort + pin | `x < y ? -1 : x > y ? 1 : 0`; no `localeCompare` in the file; source pin with a negative control (planted call flagged, a comment ignored); M2 red | ✅ |
| C-3 `lastId` reset per chunk | `let lastId = null` inside the chunk loop; the C-8 non-advance check within the chunk; the test has chunk 2's ids sort before chunk 1's last id; M3 red | ✅ |
| C-4 parent-id bound | `parentIds.length > EXPORT_LIMITS.ROW_CEILING` after each parent page returns `overCeiling` before any child query. Parent ids do not count against `maxRows`. The list can overshoot the bound by at most one page (≤ `PAGE_SIZE`) before the stop: acceptable. M4 red | ✅ |
| C-5 check order | Zod → `exportDescriptorOfSection` (E-2) → `via` + `viaParent` → `viaParentOf` (V-1…V-3, non-empty strings, exactly two keys, `id` and `fk` declared, parent resolved by the table name on the child descriptor) → `exportColumnsOf` for the child AND the parent (+ the parent lists `id`) → reads. A `via` without the opt-in keeps `not_user_scoped` with the DE-4 message (pinned). The ten bad-descriptor plants each assert no query (`log` length 0) and the right code (`denied_column` for E-3 on either side) | ✅ |
| C-6 uuid per parent id; `.in()` gets an array | `CANONICAL_UUID` is tested on every id before it joins `owned` / `parentIds`; a failure throws after the parent query only (the test asserts the log holds `website_pages` only, for three bad shapes incl. uppercase and a number). The chunk is `parentIds.slice(...)`, a plain string array; the fake throws if `.in` gets anything else | ✅ |
| No caller id | Signature unchanged `(sectionId, userId, { maxRows })`; `fk` comes from `descriptor.scope.fk` (proven equal to `viaParent.fk`), the parent table from the child descriptor; `userId` is the Zod-parsed session id. D-10 source scan of `sections.ts` + planted control; D-13 planted `?userId=`, `x-user-id`, `?pageId=` | ✅ |

**Tenant isolation (tenant-isolation-guard).** The oracle is `from(parent).select('id').eq('user_id', userId)` with the tenant filter first, the same E-4 boundary as every other section; children are accepted only if their `fk` is in the current chunk of oracle ids. D-8 holds all three controls: (a) ignored `.eq` → B's blocks visible (the test can see a leak); (b) ignored `.in` → section `failed`, no B id or content in the body or the log, the other content sections `ok`; (c) the raw responses carry B's blocks, so V-6 is the only thing between them and the file. No write, rpc or upsert (E-1 scan green). Snapshot races remain benign (CASCADE).

**DV-2 / DV-3.** `invalid_via_parent` appears only as an `ExportClassificationError` code, in the repository's `{ error }` and in its `logger.error` line; `ownedRowsSection` maps any error to `{ ok: false }`, and the section shows `failed` with no error text (the sections.test "no error text" case). Never in the file: ✅. DV-3 extras accepted: the `viaParent` beside a `user_id` scope (the explicit throw after `viaParentOf` is unreachable today, since `viaShapeProblems` already reports "viaParent needs a via scope", but it is a correct belt-and-braces fail-closed; keep it), repeated parent ids (M6 red), and the `VIA_PARENT_CHUNK` positive-integer guard (catches a mocked or lowered limit that would otherwise loop or slice wrongly).

**Rulings asked by TL**
| # | Item | Ruling |
|---|---|---|
| 1 | C-10 runtime +2.8 s summed (characterization +1.6 s, repository +1.0 s) | **Accept, no trim.** Inside the ≈ 3 s line set in C-10; it is summed serial time, so the wall-clock effect on the parallel Jest job is smaller; none of these suites is on the `next build` critical path (no-added-CI-time rule satisfied). The characterization `it.each` over the five tables is the deliberate re-pin and is worth its cost |
| 2 | DV-4: D-8 (c) as a raw-response test + mutation M1 | **Accept.** A test cannot re-compile a private method; the raw-response test proves the leak exists upstream of V-6, and M1 (V-6 disabled → 3 red, incl. D-8 b) proves the check is what stops it. Together they satisfy D-8 (c) as written |
| 3 | The planned flip | **Accept as built (C-7 met).** `PLANNED_TABLES_ALLOWED = false`, pinned; `PLANNED_FILES_ALLOWED` still `true`; `planned()` helper removed with a comment saying why (grep: no caller left); the `planned` variant and `PlannedTableSlice` kept with "forbidden on tables since DE-7" comments; totals 38 / 0 / 117, `bySlice` `{}`. The T-6 ×3 and T-10 controls moved to `website_page_views` (excluded) with their messages and codes kept (`not_included`); T-7 rewritten with a planted `planned('DE-7')` reported with the flag false and accepted with it true. Each re-plant shown red (M7…M10) |
| 4 | DV-8 DE-6 expectation changes | **Accept.** N-9 32 → 37 is the five new includes (none has `rowKey`); the via-scope plant on `marketing_consent_settings` now also reports the V-1 "needs viaParent" line, which is the new rule firing correctly on that plant. No DE-6 behaviour changed |
| 5 | Pre-existing TS error in `exportClassification.test.ts` N-9 (`scope` in an object literal passed to `tableProblems`) | **Leave it for DE-7.** It is on `6f309f39` (DE-6), Jest does not type-check, and no TS gate covers this test file; fixing it is unrelated churn in a privacy-pinned suite. Follow-up (🟢, the next slice that touches the file): widen the test helper's parameter to `{ table: string; export?: unknown; scope?: unknown }` (matching `tableExportProblems`' own signature) and drop the `as never` |

**Other confirmations**
- **DE-1…DE-6 byte-identical vs `6f309f39`.** `git diff 6f309f39` of `route.characterization.test.ts` removes no `SELECTS` line: the 33 earlier select strings are the DE-6 literals, untouched; the only removed lines are aggregators extended by `DE7_*` and the 33 → 38 count. The full-body `toBe(JSON.stringify(...))` comparison therefore pins every DE-1…DE-6 section byte for byte. 6 new literals (5 sections + the parent `id`) ✅
- **`content` group metadata.** `EXPORT_GROUPS.content` = `processor`, `EXPORT_ACCOUNT_HOLDER`, the §2.3 sentence verbatim; pinned in the characterization body and in `sections.test.ts`. `ExportGroupId` + `'content'`; five sections after `email_unsubscribes`, `website_blocks` after its parent ✅
- **`format_version` 2** (additive; unchanged in the payload) ✅
- **Descriptors** equal §3 and the live set (§11.1; Q14 0 drift / 0 missing over 84 names, §11.2). Only the `export` field changed on the 5 rows (purge fields untouched, D-17). Reasons named in `CONTENT_COLUMN_REASON`; `DOCUMENT_STORAGE` and `OWNER_ID` reused unchanged ✅
- **No `console.*`** in any touched source file (grep). No entitlements import, no LLM call, no migration, no route change ✅
- **Requirement §0.11 insert-only except Last Updated.** `git diff --numstat`: 66 / 1; the single removed line is `> **Last Updated**: 2026-10-16` ✅

**Optimisation suggestions (non-blocking)**
- `owned` (a `Set`) now serves only the repeated-parent-id check, because V-6 runs against `inChunk`; a one-line comment saying so would stop a later reader "simplifying" V-6 back to the whole set.
- The follow-up in ruling 5.

### Code Approved for QA: Yes

---

## QA Testing Report

(QA populates.)

### QA — DE-7 — 2026-10-17

**Test mode:** full
**Strategy used:** A + B (Jest unit and in-memory integration through the real repository, registry and route), plus mutation testing in a scratch copy, plus a scratch edge-case probe. No live DB access in QA; the live schema facts are TL's §11.1 / §11.2.
**Focus:** security (tenant isolation of the new `viaParent` reader), schema (classification and the planned flip), api (route body)
**Skipped:** e2e (Playwright is not installed; the browser check is owed by the user after deploy, below)
**Input source:** prompt keywords (TL), workplan §8 / SA C-1…C-10
**Hygiene:** no stash, no commit. Every mutation and probe ran in scratch copies under the session scratchpad `de7qa/`, never in the worktree. Worktree `git diff --numstat` and `git status --short` were identical before and after. The scratch `node_modules` junctions were removed with `rmdir` only; the shared `node_modules` was intact afterwards (842 entries). Worktree HEAD is `16cb2a1f`. origin/main has since moved to `b160102d` (#444, #445), and neither touches a DE-7 file.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| 5 tables `include`, 0 `planned`, totals 38 / 0 / 117, planned flip (D-1, D-3, C-7) | ✅ | Pass | n1 (planted `planned` row) and n2 (flag set back to true) both red |
| Column pins = live set, 75 in + 9 out (D-2, §11.2) | ✅ | Pass | l1, l2, m1, m2, m3 each red in 3 suites (classification pins, route D-12, characterization) |
| `viaParent` CI and runtime rules V-1…V-3, V-7 (D-4, C-5) | ✅ | Pass | k1…k6 all red |
| Parent-scoped read: shape, chunks, paging, ceiling, sort (D-5…D-7, C-2…C-4, C-6) | ✅ | Pass | a, d, f, g, g2, h all red |
| Cross-tenant (D-8, C-1, tenant-isolation-guard) | ✅ | Pass | b, c, i, j red. With `.in` dropped (a), the section fails, and the existing control (b) "no B row in body" stays green: no other owner's block reaches the body |
| No caller id reaches the reader (D-10) | ⚠️ | Partial | e1 (a 4th parameter) red. **e2 (caller ids through the options object) stays green: QA-B1** |
| Never read; out columns never in the body; planted ids; ceiling 413 (D-11…D-13, D-18) | ✅ | Pass | route suite green. l1 and m1…m3 turn D-12 red |
| All history: drafts, archived, hidden blocks, inactive links, every media source (D-14) | ✅ | Pass | plus probe E4…E6 |
| Group `content`, order, `EXPORT_GROUPS.content`, `format_version` 2 (D-15) | ✅ | Pass | probe E8: the 5 sections come right after `email_unsubscribes`, all ok |
| DE-1…DE-6 selects byte-identical (D-16, C-8) | ✅ | Pass | o1 (DE-3 `business_profiles` reordered) and o2 (DE-6 `email_unsubscribes` column dropped) each red in characterization |
| Purge baseline and reconciler (D-17) | ✅ | Pass | purge suites green |
| E-1 / E-6 (D-19) | ✅ | Pass | existing scans green |
| No regression elsewhere | ✅ | Pass | full `jest --ci`: 0 new failures (below) |

#### Runs

| Run | Result | Time |
|---|---|---|
| `lib/business-os/data-export`, `lib/business-os/purge`, `BusinessDataExportRepository.test.ts`, `app/api/user/data-export`, `lib/client` | 27 suites, 967 tests, all pass (= Dev's 894 + 73) | 38.5 s Jest / 65 s wall |
| `npm run test:bos-entitlements` | 280 suites, 8,575 tests, all pass | 150.5 s Jest / 165 s wall |
| `npm run test:authz-guard` | 2 suites, 203 tests, all pass | 49.7 s Jest / 64 s wall |
| Six touched suites, before (`16cb2a1f`) and after, 2 runs each | 475 → 561 tests. Summed suite time: 39.0 / 32.7 s before, 31.8 / 34.3 s after. Wall time: 17.3 / 15.1 s before, 16.6 / 15.6 s after | Within run-to-run variation. Consistent with Dev's +2.8 s summed and C-10. Not on the `next build` path |
| `.github` | no change | — |

**Full `npx jest --ci`: DE-7 worktree against a baseline** (`git archive 16cb2a1f` + `git init`, the branch's base):

| | Suites | Failed suites | Tests | Failed | Pending |
|---|---|---|---|---|---|
| Baseline | 1,500 | 21 | 37,783 | 141 | 65 |
| DE-7 | 1,500 | 20 | 37,869 | 140 | 65 |

- **Failing only in DE-7:** none.
- **Failing only in the baseline:** `tailwind-css-escape.guard`. It scans tracked files, so it is an artefact of the bare `git init` copy.
- **Failing in both, same tests:** V4, V6, pilot, orchestration, pricing-research, onboarding guards, contact-drawer guards, `supabaseFetch`, `oneAddressPolicy.guard`, `publicEndpointsAreThrottled.guard`, `bookingsSearchAndPaging.guard`. All are on the known pre-existing list.

#### Negative controls

Each mutation was applied in the scratch copy, run against the 7 data-export / repository / route / purge suites, then restored; sha256 was verified after every restore. **26 of 27 went red.**

| # | Mutation | Red | Key red test(s) |
|---|---|---|---|
| a | drop `.in('page_id', chunk)` | 10 | D-5, D-6, D-7, D-8 positive, route D-12/D-18, characterization `website_blocks`. D-8 (b) "section failed, no B row in body" stays green, as it should |
| b | V-6 post-check disabled | 4 | D-8 (b), (c); C-1 non-string; C-1 wrong chunk |
| c | V-6 against the whole owned set, not the chunk | 1 | C-1 wrong chunk |
| d | non-uuid parent id accepted | 1 | D-9 malformed parent id |
| e1 | caller id as a 4th parameter | 1 | D-10 arity |
| **e2** | **caller `parentIds` through `opts`, used instead of the oracle; `sections.ts` passes `ctx.parentIds`** | **0** | **survives: QA-B1** |
| f | parent-id ceiling (C-4) removed | 1 | C-4 |
| g | `localeCompare` sort | 1 | C-2 source pin, the only test that catches it (QA-E1) |
| g2 | final sort removed | 1 | C-3 |
| h | `lastId` carried across chunks | 2 | C-3; C-1 repeated id |
| i | duplicate-id check removed | 1 | C-1 repeated id |
| j | parent read without `.eq('user_id')` | 6 | D-5, D-6 0 pages, D-8 positive, (b), (c), characterization `website_pages` |
| k1 | CI: `viaParent` on a non-via scope not reported | 1 | D-4 |
| k2 | the "`viaParent` must equal scope" rule removed | 3 | D-4 ×2, D-9 |
| k3 | repository: `viaParent` beside a `user_id` scope not refused | 1 | D-9 |
| k4 | plant: `viaParent` on `smart_links` (`user_id` scope) | 71 | many |
| k5 | plant: `website_blocks` `viaParent.fk` = `id` (mismatch) | 84 | many |
| k6 | one-hop parent rule removed | 2 | D-4 V-2, D-9 via-of-via |
| l1 / l2 | `storage_path` / `source_ref` into the `user_media` columns | 7 / 7 | D-1/D-2 pins, live set, route D-12, characterization `user_media` |
| m1 / m2 / m3 | `click_count` / `conversion_count` / `revenue_cents` into the `smart_links` columns | 7 each | same, characterization `smart_links` |
| n1 | new `planned` table descriptor | 7 | T-1, T-7, T-8, totals, D-1 |
| n2 | `PLANNED_TABLES_ALLOWED = true` | 3 | T-7, D-1 |
| o1 | DE-3 `business_profiles` select reordered | 6 | DE-3 pins, characterization `business_profiles` |
| o2 | DE-6 `email_unsubscribes` select changed | 4 | DE-6 pins, characterization `email_unsubscribes` |

#### Edge cases (scratch probe through the real repository with a fake PostgREST: 8 / 8 pass)

| # | Case | Result |
|---|---|---|
| E1 | Owner with no pages (B has pages and blocks) | ok, 0 rows. Only `website_pages` is queried; blocks are never queried |
| E2 | Pages but 0 blocks | ok, 0 rows |
| E3 | 250 pages, so 3 chunks (100 / 100 / 50). Every 3rd page has 0 blocks, hidden blocks mixed in, 30 B pages interleaved, page size 50 | Every A block, in `id` order. No B block, no `user_id`. Distinct chunks 100 / 100 / 50 |
| E4 | Draft / live / archived, homepage and landing; hidden blocks | All exported; `enabled: false` kept |
| E5 | Inactive smart link with large counters | Exported with `is_active: false`. No counter value or column name in the select or the rows. Select = the 13 declared columns, in order |
| E6 | Media: `stock`, `generated` (with description), `upload` | All three exported, generated description present. Select = the 9 declared columns. No `storage_path`, no `source_ref`, no path or reuse-key value |
| E7 | A block whose `page_id` is the owner's page id in uppercase | Not matched, not exported |
| E8 | Whole registry for A, with B seeded | The 5 content sections follow `email_unsubscribes`, each ok with 1 row. No B id, B marker or excluded value |

#### Issues Found

##### Bugs (must fix before commit)

1. **QA-B1: D-10 does not catch caller-supplied parent ids passed through the options object.** File: `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` (D-10). Severity: **Medium**. This is a gap in a test on the tenant boundary. The code as written is correct.
   - **Steps to reproduce** (mutation e2, scratch copy only):
     1. Widen `opts` to `{ maxRows: number; parentIds?: string[] }`.
     2. Hand `opts.parentIds` to `readThroughParent`, which uses them in place of the oracle ids.
     3. Make `sections.ts` pass `parentIds: ctx.parentIds`.
   - **Expected:** D-10, or some other test, goes red.
   - **Actual:** all 7 suites stay green.
   - **Cause:** D-10 checks two things, and neither catches this.
     - The arity is `=== 3`, and an options object keeps it at 3.
     - The `sections.ts` scan uses `\b(pageId|page_id|parentId|parent_id|blockId)\b`. The word boundary misses plurals: `parentIds`, `pageIds`, `page_ids` and `ownedPageIds` all return `null` (checked).
   - **Suggested fix** (test-only; any requirement-level decision is SA's):
     1. Widen the scan to plurals, e.g. `/\b(page|parent|block)_?[Ii]ds?\b/`.
     2. Add a runtime case that calls `listOwnedRowsForExport('website_blocks', A, { maxRows, parentIds: [B's page id] } as any)` and asserts no B block comes back.
     3. Optionally, pin `ReadInputSchema` as `.strict()` and test that an extra `opts` key fails closed.
   - QA re-runs e2 after the fix.

##### Performance Issues (should fix)

None. The runtime change is within run-to-run variation. In prod each owner needs one chunk (max 3 pages, §11.1).

##### Edge Cases (nice to fix)

1. **QA-E1: only the C-2 source pin catches the `localeCompare` sort (mutation g).** For lowercase canonical uuids, locale order and code-unit order appear to agree, so a behavioural test cannot tell them apart. The source pin is the right guard. No action needed; this is recorded so nobody removes the pin as redundant.
2. **QA-E2: line endings.** `sections.ts` and `payload.ts` are CRLF in the worktree; the other touched files are LF. This is harmless under git normalisation. It matters only for future in-place source edits or scans that match on `\n`.

#### Manual check for the user after deploy (Business OS, "Download my data")

Sign in as a business that has a website and run the download. In the file:

1. `export_metadata.groups` has a new **`content`** group (AgentPilot the processor, you the controller) with the sentence "Your website, landing pages, smart links and picture library…". `format_version` is still 2.
2. **`website_content`**: one row with your website text sections (hero, about, services…, `intake_form`). No `user_id`.
3. **`website_pages`**: every page, **drafts and archived pages included**, each with its `status`, `slug`, `title`, `subdomain` / `custom_domain` and `theme`. No `user_id`.
4. **`website_blocks`**: only the blocks of your own pages. Each block's `page_id` matches a page in `website_pages`. **Hidden blocks are there, with `enabled: false`.** Rows are in `id` order.
5. **`smart_links`**: every link with its `code`, `destination_url` and on/off state (`is_active`), switched-off links included. **There are no `click_count`, `conversion_count` or `revenue_cents` columns, and no click, sign-up or money figures anywhere.**
6. **`images`**: every picture with its `public_url`, `source` (stock, generated or upload) and `description`. For a picture the assistant made, the description is the request you typed. **No `storage_path`, no `source_ref`.**
7. **No page views** anywhere: no `website_page_views` section and no link-click rows.
8. The earlier sections (account, client records) look exactly as before.

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **QA-B1** (Medium; a test-only gap in D-10). No High bug is open. Every other criterion passes, 26 of 27 negative controls go red, and the full suite shows 0 new failures. QA re-runs mutation e2 once D-10 is widened.

#### QA-B1 fixed — 2026-10-17 (Dev)

Fixed by Dev. QA re-runs e2.

1. **D-10 scan widened.** The pattern is now `/\b\w*?(?:page|parent|block)_?ids?\b/gi`. It catches singular and plural, snake and camel case, and prefixed names (`pageId`, `page_ids`, `parentIds`, `ownedPageIds`, `blockIDs`). It runs on the whole of `sections.ts`. In the repository it runs only on three slices that a caller's value can pass through: the `listOwnedRowsForExport` signature, the `readThroughParent` parameter type, and the one `this.readThroughParent({...})` call. The oracle's own local `parentIds`, inside the `readThroughParent` body, is correct code and is not scanned. A test asserts that the unscoped file does contain it, which shows why the scan is scoped. Each slice must be found, so the scan cannot pass vacuously. A second check flags any `opts.<key>` read other than `opts.maxRows`. The negative controls cover plurals and prefixes, legitimate names (not flagged), and an e2-style plant in the signature and the call.
2. **Runtime case.** `listOwnedRowsForExport('website_blocks', A, { maxRows, parentIds: [B's page id] })` returns `{ data: null, error }`, issues no query, and the result carries no B block and no B page id.
3. **`ReadInputSchema` is `.strict()` at both levels:** `{ userId, opts: { maxRows } }`. An undeclared key in `opts` fails the section closed before any query. The tests cover an unknown key, `pageId` and `userId` in `opts`, plus a control showing that `{ maxRows }` alone still reads. **This is a production code change** in `BusinessDataExportRepository.ts`: the schema, and the parse call, which now validates the whole `opts` object instead of picking out `opts.maxRows`. The only production caller is `sections.ts` `ownedTableSection`, which passes `{ maxRows: budget.maxRows }`. Every test call passes `{ maxRows }` only, and `sections.test.ts` mocks the method. Nothing else changes.
4. **Proof in a scratch copy** (`scratchpad/de7dev/e2c`, removed afterwards; the `node_modules` junction was removed with `rmdir`; the shared `node_modules` was intact afterwards). Suites: the repository test, `lib/business-os/data-export`, and `app/api/user/data-export`.
   - **e2 as QA wrote it:** 123 red. These include every D-10 scan test and D-8. The strict schema also rejects the `parentIds` key, so every section fails.
   - **e2b, which is e2 plus `parentIds` allowed in the schema** (so only D-10 can catch it): 4 red, all D-10. These are the scans, plus the runtime case: with the schema widened, B's block comes back.
   - **The unmutated copy:** 537/537 green.
   - The worktree's sha256, `git diff --numstat` and `git status` were identical before and after.
5. **Runs in the worktree:** 5 suites, 537/537 green.


#### SA delta review DE-7 (QA-B1) — 2026-10-17

**Status:** Approved. This is a delta on the earlier DE-7 code approval and covers only the QA-B1 fix.

1. **Fails closed.** `ReadInputSchema.parse({ userId, opts })` is the first statement inside the `try`. On an undeclared key at either level it throws, and the `catch` returns `{ data: null, error }` before descriptor resolution or any query. The runtime case and the three `it.each` cases assert `log` has length 0.
2. **One production caller.** `sections.ts` `ownedTableSection` passes exactly `{ maxRows: budget.maxRows }`, so valid calls behave the same. `input` is still `{ userId, maxRows }`, and the control case shows that `{ maxRows }` alone still reads.
3. **`{ maxRows, foo: undefined }` is rejected.** Zod `.strict()` checks which keys are present, not their values. This is acceptable and in fact preferred at the tenant boundary. No caller builds `opts` by spreading. If one ever does, it fails closed with a section `failed`, which is visible and not a leak.
4. **The scan cannot pass vacuously.** `callerFacingSlices` throws if any of the three anchors is missing. The unscoped-file assertion (`toContain('parentIds')`) shows the regex matches real source. The planted e2 negative control proves that both the slices and `undeclaredOptReads` flag the attack. The Dev's e2b run (schema widened, so only D-10 catches it: 4 red) shows the scan and the runtime case each stand on their own, independent of the strict schema.
5. Optimisation, does not block: if a future option is added to `opts`, it must go in the schema and in the `undeclaredOptReads` allow-list together. The test failing when only one is updated is the intended prompt.

QA re-runs e2 as planned.

#### QA re-verify QA-B1 — 2026-10-17

**Result: PASS. QA-B1 is closed.** I wrote my own mutation script (I did not reuse Dev's). It ran in a scratch copy at `scratchpad/qa7/c`, with `node_modules` linked by junction. The junction was removed with `rmdir` and the copy was deleted. The shared `node_modules` was intact afterwards. The worktree's `git diff --numstat` sha256 (`0865a448…`) and `git status` were the same before and after. The suites were the repository test, `lib/business-os/data-export` and `app/api/user/data-export`.

| Run | Mutation | Result |
|---|---|---|
| e2 | Exactly as written in QA-B1: `opts` widened to `parentIds`, the ids handed to `readThroughParent` in place of the oracle, and `sections.ts` passing `ctx.parentIds` | **Red: 123 / 537.** All 4 D-10 scan tests failed, and every section failed closed because of the strict schema |
| e2b | e2, plus `parentIds` allowed in `ReadInputSchema` | **Red: 4 / 537, all D-10:** the arity / `sections.ts` scan, the slice scan with `opts` reads, the negative control, and the runtime case (B's block came back) |
| control | The copy with no mutation | 537 / 537 green |
| e2c (extra probe) | e2b with a neutral key name (`scopeRef`), read as `(opts as any).scopeRef` | 1 red, and only by accident: the negative control's plant string no longer matched. Details in edge case 1 below |

**Worktree runs** (the first run overlapped the scratch copy, and jest's path patterns picked up the mutated copy's tests too, so I re-ran these after the copy was removed):
- The repository test, `lib/business-os/data-export`, `app/api/user/data-export` and `lib/client`: **11 suites, 610 / 610 green.**
- `npm run test:bos-entitlements`: **280 suites, 8,582 / 8,582 green.**

**Valid and invalid `opts`:** D-10 passed 9 of 9 in the worktree. The control `{ maxRows: 10 }` reads 1 row with no error. Unknown key, `pageId` and `userId` in `opts`, and the runtime `parentIds` case each return `{ data: null, error }` with `log` length 0, so no query is issued.

**Edge cases (nice to fix, not blocking):**
1. **QA-E3: a caller id with a neutral name, read through a cast, is not caught by a dedicated check.** For it to get through, someone must make three deliberate changes: widen the strict schema, rename the field to avoid the `page|parent|block` pattern, and read it as `(opts as any).x`. `undeclaredOptReads` (`\bopts\??\.\w+`) does not match `(opts as any).x`, and the destructuring form `const { x } = opts` is not matched either. The schema widening would be visible in review. Optional hardening: also flag `(opts as …)` and destructuring of `opts`. Or assert that the parsed `opts` shape is exactly `['maxRows']` by pinning `ReadInputSchema.shape.opts.keyof()`. A shape pin would also go red on e2b and e2c without depending on names.
2. **QA-E4: scratch copies under the worktree's `scratchpad/` are visible to jest.** Running jest with path patterns from the worktree root while a copy exists also runs the copy's tests, and their results get mixed into the worktree's. Run worktree suites only when no copy exists, or add `/scratchpad/` to `testPathIgnorePatterns` (needs SA review).

---

## Commit Info

(RM populates.)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan created | Dev; written against DE-6's end state (PR #443, `6f309f39`); 5 include, 0 exclude, the planned flip, the parent-scoped read for `website_blocks` (SA-Q1, new pattern), SQL Q1–Q13 for TL, BC-1…BC-8 with defaults |
| 2026-10-17 | Code complete (Dev) | T-0a by merge (`16cb2a1f`); T-2…T-12 done per SA C-1…C-10; C-9 doc fix (§3.3 BC-7); Dev implementation notes: as built, deviations DV-1…DV-10, Q14 for TL (84 names), 12 mutation checks all red, runtimes (+2.8 s summed over six suites). Requirement §0.11 written. Uncommitted for SA code review and QA |
| 2026-10-17 | SA code review | ✅ Code Approved for QA: C-1…C-10 met; rulings on C-10 runtime (accept), DV-4 (accept), the planned flip (accept), DV-8 (accept), the N-9 TS error (leave, follow-up) |
| 2026-10-17 | QA (DE-7) | Full mode. Targeted suites 967/967, test:bos-entitlements 8,575/8,575, test:authz-guard 203/203. Full jest: 0 new failures against base `16cb2a1f`. 27 negative controls, 26 red. QA-B1 (Medium, test gap): D-10 misses caller ids passed through `opts` (plural names). Edge-case probe 8/8. Manual post-deploy check listed |
| 2026-10-17 | QA re-verify QA-B1 | PASS, QA-B1 closed. e2 red (123), e2b red (4, all D-10), control 537/537. Worktree: 11 suites 610/610, test:bos-entitlements 8,582/8,582. QA-E3 (neutral-name cast evasion; optional shape pin) and QA-E4 (scratch copies visible to jest) noted, not blocking |

### 11.1 T-0 live results — 2026-10-17 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)

**Q1–Q4 columns, keys, FKs** (`!` NOT NULL). Counts match expectations exactly (23, 23, 9, 17, 12); `website_content.intake_form` **exists**.
| Table | n | Columns | Keys | FKs (delete rule) |
|---|---|---|---|---|
| website_content | 23 | id!, user_id!, hero, about, services, testimonials, faq, team, contact, process, features, stats, pricing, gallery, cta, newsletter, logo_cloud, video, booking_widget, payment_button, intake_form (all jsonb), created_at, updated_at | PK id; UNIQUE user_id | user_id→business_profiles CASCADE; →users NO ACTION |
| website_pages | 23 | id!, user_id!, page_type!, slug!, title!, meta_description, seo_keywords:_text, published, published_at, template_id, theme:jsonb, created_at, updated_at, subdomain, custom_domain, custom_domain_verified, status, last_published_at, favicon_url, og_image_url, client_flow:jsonb, website_language, content_generated_at | PK id; UNIQUE (user_id, slug) | user_id→business_profiles CASCADE; →users NO ACTION |
| website_blocks | 9 | id!, page_id!, block_type!, position!, content:jsonb!, styles:jsonb, created_at, enabled, capability_config:jsonb | PK id; UNIQUE (page_id, position) | **page_id→website_pages CASCADE** (no user_id) |
| smart_links | 17 | id!, user_id!, code:varchar!, name, destination_url!, destination_type, source, medium, campaign, content, click_count, conversion_count, revenue_cents, is_active, created_at, updated_at, metadata:jsonb | PK id; UNIQUE code | user_id→business_profiles, users CASCADE |
| user_media | 12 | id!, user_id!, storage_path!, public_url!, source!, source_ref, section, aspect, description, width, height, created_at! | PK id | user_id→business_profiles, users CASCADE |

**Q5 rows:** content 5, pages 12, blocks 113, smart_links 12, media 37. Orphan blocks **0**. Max pages/owner 3; max blocks/page 13; max content rows/owner 1.

**Q6 jsonb (recursive census to depth 7 over website_content, blocks content/styles/capability_config, pages theme/client_flow, smart_links.metadata):** **no key matching token/secret/password/api key/credential/private/salt/hash/session/cookie/ip/user agent/fingerprint/prompt/system message/model**. String values with token-like query parameters: **0**. smart_links.metadata keys = destinationType, excludedServiceIds, journeyType, serviceIds. capability_config: no keys present. client_flow keys = steps.

**Q8 values:** page status live 4 / draft 8. Block types: footer, features, header, testimonials, faq, about, contact_form, services, gallery, cta, process, stats, booking_widget, hero, pricing. Media source stock 6 / upload 24 / generated 7.

**Q9:** smart links active 10 / inactive 2; clicks > 0 on 8. destination_url with a query string 3, token-like **0** → SA-Q8: no strip needed today.

**Q10/Q12:** user_media storage_path outside `{user_id}/` **0**; public_url not containing the owner id **0**; block content image URLs in another owner's folder **0**; smart_link serviceIds owned by another owner **0**. Subdomain mismatch page vs business_profile: **1** (both rows are the same owner's — informational, export as stored).
**Q13:** no soft-delete-like columns.

### 13.1 Business calls — TL defaults 2026-10-17 (user authorised an autonomous run; user may change)
| BC | TL default |
|---|---|
| BC-1 smart-link click / conversion / revenue totals | **OUT** (activity / derived) |
| BC-2 switched-off smart links (incl. system-created) | **IN** with on/off |
| BC-3 draft / unpublished / archived pages | **IN** with status |
| BC-4 website text the assistant drafted | **IN** (it is the owner's published content) |
| BC-5 picture library incl. descriptions (for AI pictures = the owner's typed request, also used as alt text) | **IN** (owner-typed, not system metadata) |
| BC-6 public web addresses and short codes | **IN** |
| BC-7 hidden blocks | **IN**, marked hidden |
| BC-8 page views / visitor data | **OUT** (already decided) |

### 11.2 Q14 / T-10 drift — 2026-10-17 (TL, read-only, prod)
Dev's 84 declared names (include ∪ excluded) for the 5 DE-7 tables vs `information_schema.columns`, FULL OUTER JOIN: **0 drift, 0 missing** (84 distinct). T-10 ✅.
