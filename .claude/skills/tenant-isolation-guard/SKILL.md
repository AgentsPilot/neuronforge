---
name: tenant-isolation-guard
description: Enforce cross-tenant isolation when code runs as the service role (RLS bypassed) and accepts a caller-supplied id — internal plugin executors, service-role write paths, repo methods, and queue runners. Use when building or reviewing any internal plugin operation/executor, a `supabaseServer` write, or a reaction/cron that acts on a row by an id it was handed. Prevents the cross-tenant read/write bugs (M1/G3 class) that a `.eq('user_id')` repo alone does NOT stop when a trigger, upsert, or caller-supplied field defeats the scope.
---

# tenant-isolation-guard

Use this whenever code that runs as the **service role** (`supabaseServer` — RLS bypassed) acts on a row identified by a **caller-supplied id**: internal plugin executors, chat/AI write paths, event-reaction/queue runners, or any `supabaseServer.from(...)` write. In that context a caller-supplied id (`invoice_id`, `contact_id`, `page_id`, `booking_id`, an injected `user_id`) is a **cross-tenant vector** unless the code verifies ownership itself. RLS won't save you — it's bypassed. And a repository being `.eq('user_id', userId)`-scoped is **not sufficient** on its own: a Postgres trigger it fires, an `upsert` conflict target, or a caller-injected field can still reach across tenants.

**Canonical rules (read + link):** `CLAUDE.md` § Security Rules (`.eq('user_id', userId)`; service-role only when RLS bypass is intentional + documented) and `docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md` §8.1 (queue runners run as service role → scope every effect to the row's `user_id`).

**Worked references (copy their shape):**
- **Ownership pre-check** — `lib/server/payments-plugin-executor.ts` (`record_manual_payment` calls `paymentInvoiceRepository.findById(invoice_id, userId)` **before** delegating, because trigger T4's `UPDATE payment_invoices … WHERE id = NEW.invoice_id` has **no `user_id`** filter). Full analysis: `docs/workplans/BUSINESS_OS_PAYMENTS_INTERNAL_PLUGIN_WORKPLAN.md` §9 (M1).
- **Ownership pre-check via a parent** — `lib/server/website-plugin-executor.ts` (`assertPageOwned` / `resolveBlockOwnedPage`, because `website_blocks` has no `user_id` column — ownership is `page_id → website_pages.user_id`). `docs/workplans/BUSINESS_OS_WEBSITE_INTERNAL_PLUGIN_WORKPLAN.md` (G3, §4.2).
- **Explicit field allow-list** — `lib/server/intake-plugin-executor.ts` (`update_intake_settings` builds the patch field-by-field; `IntakeRepository.upsertSettings` places `user_id` **after** the `...settings` spread). `docs/workplans/BUSINESS_OS_INTAKE_INTERNAL_PLUGIN_WORKPLAN.md` §4.2 (M1). Website page `create`/`update` use the same allow-list.

---

## The rule

When you run as the service role and take a caller-supplied id, **the executor/runner is the tenant-isolation boundary — not RLS, not the repo's `.eq('user_id')` alone.** Two defenses, applied together:

1. **Ownership pre-check** — resolve the target's owner with a **user-scoped** `findById(id, userId)` and **fail closed** (`access_denied`) *before* any write, mutation, or trigger-firing operation.
2. **Explicit field allow-list** — on `create`/`update`, build the payload field-by-field; **never forward raw `params`.** `user_id` is always the authenticated id; never accept `user_id`/`id`/privileged fields (`status`, `verified`, price/amount overrides) from the caller.

`userId` comes from the authenticated context (`connection.user_id` / `getUser()`), **never** from caller data.

---

## Step 1 — Recognize when this applies

All of these must hold to *not* need the guard; if any is present you **do** need it:

- The client is `supabaseServer` (service role → **RLS is bypassed**), OR the op runs from a plugin executor / chat / reaction runner / cron.
- The row is chosen by an **id the caller supplied** (not derived solely from the authenticated `userId`).
- **Any** of: the target table has no `user_id` column (ownership via a parent); a **trigger** fires an unscoped write; an **`upsert`** has an `onConflict` the caller could hit; or the write payload could carry caller-controlled `user_id`/`id`.

If it's a plain `repo.method(id, userId)` that is `.eq('id',id).eq('user_id',userId)` end-to-end with no trigger/upsert/raw-payload, the repo scope already covers it — don't over-guard.

## Step 2 — Ownership pre-check (before the effect)

```ts
// direct-owned entity:
const { data: owned } = await repo.findById(id, userId);   // user-scoped oracle
if (!owned) throw accessDenied();                          // fail closed: not-found OR not-owned

// parent-owned entity (no user_id on the row) — resolve the owner up the FK:
const { data: block } = await blockRepo.findById(blockId); // read to learn the parent
if (!block) throw accessDenied();
const { data: page } = await pageRepo.findById(block.page_id, userId);
if (!page) throw accessDenied();
```

- Branch on **`!data`**, not on a rethrowing `unwrap` — a `.single()` not-found returns `{ data:null, error:<PGRST116> }`; treat both null-data and error as **not-owned**, and surface `access_denied`, never a raw 500.
- Do the check **before** the mutating call / before inserting a row that a trigger reacts to.
- Apply it to **every** caller-supplied id the op consumes (e.g. both `invoice_id` **and** `contact_id`).

## Step 3 — Explicit field allow-list (create / update)

```ts
// NEVER: repo.update(id, userId, params)        // caller can inject user_id/id/status…
const patch = pick(params, ['title','slug','content','seo_fields']);  // editable set only
await repo.update(id, userId, patch);            // user_id from auth, id from the checked target
```

- `create` sets `user_id: userId` explicitly and **never** takes `id` from params.
- Exclude privileged/system fields (`status`, `*_verified`, `published`, amounts) from the allow-list — those move via dedicated ops, not a generic update.
- Add a test asserting an injected `params.user_id` / `params.id` is dropped and the repo receives the authenticated id (see Step 6).

## Step 4 — Beware the scope-defeating three

A repo scoped by `.eq('user_id', userId)` is still exploitable if:

- **An unscoped trigger** fires: `UPDATE other_table … WHERE id = NEW.fk` with no `user_id` (e.g. payments T4 flips an invoice by id). → the *executor* must pre-check ownership of `NEW.fk` (Step 2), because the trigger can't.
- **An `upsert` conflict target** + spread order: `{ user_id: userId, ...settings }` lets a `settings.user_id` override the authenticated id and, via `onConflict:'user_id'`, overwrite another tenant's row. → allow-list the patch (Step 3) **and** put `user_id` **after** the spread in the repo.
- **A caller-supplied field in the insert/update payload** shadows a scoped one. → allow-list (Step 3).

## Step 5 — Global-catalog exception (don't over-engineer)

Read-only, cross-tenant **catalog** tables (e.g. `intake_form_templates`) have **no `user_id`** by design. Do **not** invent a phantom `user_id` filter on them and do **not** add a defensive ownership check — pass no `userId` to those reads. The guard is for *owned* rows a caller could reach across; a global catalog isn't one.

## Step 6 — Queue runners / cron (service role, cross-user claim, per-row scope)

A drain runner (see the `durable-queue-drain` skill) claims rows **cross-user** by id — that's `⟨unscoped-by-design⟩`. But when it **executes the effect**, it must scope to **that row's** `user_id` (`.eq('user_id', row.user_id)`), because RLS won't protect the service-role effect query. Same rule for event-reaction runners: each reaction runs scoped to its event's `user_id`.

## Step 7 — Test the invariant

The required test: **a foreign id is rejected before the effect runs.** Mock the ownership oracle to return `{data:null}` for a foreign id and assert the op throws `access_denied` **and the mutating repo method was never called**. For allow-list ops, inject `params.user_id:'ATTACKER'` (+ `params.id`) and assert the repo received the authenticated id with none of the injected fields. Cover the PGRST116 not-found path too.

---

## Checklist

- [ ] Identified service-role + caller-supplied-id → guard required (Step 1)
- [ ] Ownership pre-check (`findById(id, userId)` / parent resolve), fail-closed on `!data`, before the effect
- [ ] Every caller-supplied id checked (not just the primary one)
- [ ] `create`/`update` build the payload from an explicit allow-list; `user_id` from auth; `id` never from params
- [ ] Checked the scope-defeating three: unscoped trigger, `upsert` conflict/spread order, payload injection
- [ ] Global catalog reads take no `userId` (no phantom filter)
- [ ] Queue/reaction runner scopes each effect to the row/event `user_id`
- [ ] Test: foreign id → `access_denied` before the write; injected `user_id`/`id` dropped

## Anti-patterns (probable cross-tenant bugs)

- Relying on RLS in a `supabaseServer` (service-role) path — RLS is bypassed.
- A `.eq('user_id')` repo whose **trigger** does an unscoped `UPDATE … WHERE id = NEW.fk` (invoice flip, cascade).
- `repo.create/update(…, params)` forwarding raw caller params → injected `user_id` (row hand-off) / `id` / `status`.
- `upsert({ user_id, ...settings })` — spread after `user_id` lets the caller override it.
- `findById(id)` with no `userId` on a service-role path; acting on a row before verifying its owner.
- Over-correction: adding a `user_id` filter (or an ownership check) to a global catalog table that has none.
