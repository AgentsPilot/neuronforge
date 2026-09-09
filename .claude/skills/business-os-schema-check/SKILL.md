---
name: business-os-schema-check
description: Verify database column and table names against the LIVE schema before claiming anything about them — and recognise the silent-failure shapes that hide phantom columns. Use when auditing or fixing Supabase queries, writing or reviewing an insight detector, reading a migration to decide whether a column exists, investigating "this feature returns nothing / a suspicious default", or answering "is X applied?". Prevents the phantom-column class that a code read cannot catch, because the code reads fine and PostgREST rejects the whole select for one unknown name.
---

# business-os-schema-check

Use this whenever you are about to make a claim about **what columns or tables exist**: auditing selects, fixing a detector, reading a migration, or judging whether a feature is broken. The failure mode here is that **the code reads fine**. A phantom column is invisible to review, invisible to `tsc` (there are no generated types), and invisible to the build (`next.config.js` sets `ignoreBuildErrors: true`).

**Canonical rules (read + link):** `CLAUDE.md` § Mandatory Rules (all DB access via `lib/repositories/`; `.eq('user_id', userId)`) and `docs/workplans/business-os-phantom-column-remediation.md` (the live findings, the corrections register, and the failure taxonomy this skill encodes).

---

## Rule 1 — Run the script. Do not reason from migration files.

```bash
npm run schema:check
```

`scripts/schema-check.ts` replays every `.from().select()` in the repo against the live database as a zero-row select. Read-only: no rows returned, nothing written, no DDL.

**Migration files describe intent. The database is fact, and they diverge.** Verified on this project: migrations have been applied **out of order with gaps** — `20260903` applied, `20260904` not, `20260907/08` applied. Nothing in the repo records which have run. A column existing in a migration tells you nothing about whether it exists.

## Rule 2 — State the ref you measured.

Every claim carries the branch and SHA it was checked on. `schema-check` prints this for you.

Two independent audits of this repo reached **opposite conclusions about the same three files** because neither said which tree it ran against — one measured `main`, the other an unmerged feature branch. The disagreement cost more than the bug. `main` is what ships; measure it unless you say otherwise.

## Rule 3 — Read the migration body, never the filename.

`20260909_invoice_online_payment.sql` adds `allow_online_payment`, not `online_payment_enabled`. An audit that inferred the column name from the filename reported the migration unapplied when it was applied — **committing the exact error it was written to find**.

## Rule 4 — The silent failures are the dangerous ones.

A missing column that throws gets noticed. One whose error is discarded does not. Grep for the shape:

```typescript
const { data: profile } = await supabaseServer.from('business_profiles').select('subdomain, user_code');
//            ^ no `error` binding — the 42703 vanishes, `profile` is null, execution continues
```

Three live examples on this project, all of which read fine:

| Site | Symptom |
|---|---|
| `OpsPeakUnutilizedDetector` | selects `price` (real column: `payment_amount`), discards the error, falls through to `: 75` — **reports invented revenue that looks real** |
| `WebMobileIssuesDetector` | first query guarded by `if (err \|\| !x) return null` — reports "nothing detected" for every user, every run |
| `businessSubdomain.ts` | `profile` always null, so `return profile?.user_code` is unreachable — a publish path that can never succeed |

**Wrong output is worse than an error.** When triaging, rank a detector that reports a fabricated number *above* one that reports nothing.

## Rule 5 — Classify before fixing. There are three shapes, and only one is mechanical.

| Shape | Test | Fix |
|---|---|---|
| **Dead select** | The column is selected and **never read** | Remove it from the select. Behaviour-neutral |
| **Identity swap** | The value is used as a key (grouping, dedupe, sets) | Replace with the real identity — usually `contact_id`. **Changes results at the edges**; needs the author's confirmation |
| **Never worked** | The value is **used**, and the column has never existed | **Do not delete the column reference.** That leaves the code running and silently returning empty results — worse than the error. Rebuild or retire; that is a product decision |

Check every query in the file, not just the one you came for. `WebMobileIssuesDetector` has four failing queries; a fix targeting one leaves it just as broken.

## Rule 6 — Right column name, wrong table.

The shape that most reliably survives review. Both of these are true simultaneously:

| Live | Not live |
|---|---|
| `payment_invoices.client_email` | `scheduling_bookings.client_email` — dropped by `20260810` |
| `payment_transactions.metadata` | `scheduling_bookings.metadata` |
| `website_pages.slug` | `website_pages.path` |

A grep for a column name proves nothing without its table. `20260810_remove_client_fields_and_total_amount.sql` dropped `client_first_name`, `client_last_name`, `client_email`, `client_phone` and `total_amount` from `scheduling_bookings` only — the client now lives in `crm_contacts`, reached via the required `contact_id`.

## Rule 7 — Watch for the stale variable name.

```typescript
const email = booking.contact_id;        // the name is now a lie
...
.in('email', [...stuckEmails]);          // matches UUIDs against crm_contacts.email
```

No error. Postgres compares the UUID as text, matches nothing, and the feature silently names nobody. **When you swap what a value holds, rename it** — the stale name is what hides the bug from the next reader.

---

## Blind spots — the script's count is a floor

Not checked by `schema:check`, so verify these by hand:

- `.select('*')` — no column names to validate
- Embedded joins — `.select('a, contact:crm_contacts(email)')`
- Template-literal or multi-line selects
- **`.insert()` / `.update()` payloads** — same risk class, entirely uncovered. Several were found by hand where one side's writer met the other side's schema

---

## When you find something

1. **Fix it** if it is a dead select or a clear wrong-column-name, and the owner is you
2. **Record it** in `docs/workplans/business-os-phantom-column-remediation.md` with the ref you measured, the failing query, and its shape from Rule 5
3. **Do not fix** an identity swap or a never-worked detector without the author or a product call
4. If the column *should* exist, check whether its migration was applied before assuming the code is wrong — see Rule 1
