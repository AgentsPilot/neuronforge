# Payments Plugin - User Documentation

> **Last Updated**: 2026-08-10

## Overview

The Payments plugin manages your **internal Business OS payment records** — invoices, payment plans/installments, and transaction records — directly from your AgentPilot automations and the AI assistant. Like CRM and Scheduling, it is **internal**: it reads and writes your own AgentPilot payment data, with nothing to connect.

> **Important — the plugin never moves money.** It performs **database-record operations only** (create/manage invoices and plans, and *record* payments that happened externally or offline). All actual charging, checkout, card refunds, and Stripe Connect onboarding stay **external** behind the existing Stripe flow and are **not** part of this plugin. `record_manual_payment` is a bookkeeping entry (cash / check / offline), **not** a fund transfer.

---

## Connection

**No connection required.** The Payments plugin is a built-in internal capability — there is no OAuth login and no token to manage. (Taking card payments still uses your separate Stripe Connect setup, which is unaffected by this plugin.)

It is available to any **active Business OS account**. Access is checked automatically on the server each time an action runs (the `db_active` strategy); a non-tenant account gets `access_denied`. Every operation is automatically scoped to your own account's data.

### Where it appears (visibility)

Payments is a **Business-OS-only** internal module: **hidden by default from the general plugin catalog** (`visibility: business_os`), but fully **resolvable and executable by key** for Business OS surfaces, the AI assistant, and automations. See [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md).

---

## Available Actions

All actions operate only on the current account's payment data.

### Invoices

| Action | Purpose |
|---|---|
| `create_invoice` | Create an invoice (auto-generates the next invoice number). |
| `list_invoices` | List / filter invoices. |
| `get_invoice` | Fetch one invoice by `id`. |
| `update_invoice` | Edit invoice fields. |
| `send_invoice` | Mark an invoice `sent` (status only — email delivery is external). |
| `cancel_invoice` | Cancel an invoice (status → `cancelled`). |
| `mark_invoice_paid` | Mark an invoice `paid` — **status-only reconciliation** (writes no transaction; see the revenue note below). |
| `count_invoices` | Count invoices, optionally by status. |

### Transactions

| Action | Purpose |
|---|---|
| `list_transactions` | List transaction records. |
| `get_transaction` | Fetch one transaction by `id`. |
| `record_manual_payment` | Record a payment received offline (cash/check). **This is the canonical "payment received" path** — it writes a `succeeded` transaction that (via triggers) marks the linked invoice paid and logs a CRM activity, and **counts toward revenue**. |
| `create_refund_record` | Record a refund in the database (no card refund is issued). |
| `get_revenue` | Total recorded revenue from succeeded transactions. |

### Payment plans

| Action | Purpose |
|---|---|
| `create_plan` / `list_plans` / `get_plan` / `update_plan` / `deactivate_plan` | Manage installment payment plans. |
| `create_installments` / `list_installments` / `mark_installment_paid` / `cancel_installments` | Manage the installments within a plan. |
| `get_plan_summary` | Summary of a plan's installments and paid/outstanding amounts. |

---

## Automatic activities

When you **record a succeeded payment** (`record_manual_payment`), the system fans out **automatically** via database triggers — the executor does **not** re-emit these (no double-logging):

| Event | Automatic side-effect |
|---|---|
| A transaction transitions to `succeeded` with a linked contact | A `payment` activity is logged on the contact's CRM timeline (trigger T3). |
| A succeeded transaction is linked to an invoice | That invoice is marked `paid` (trigger T4). |

> **Revenue vs status.** Use `record_manual_payment` for **real payments** — it is revenue-bearing and drives the triggers above. `mark_invoice_paid` (and `mark_installment_paid`) only change status; they write no transaction, so they do **not** count toward `get_revenue` and fire no triggers. Choose one path per intent — never both for the same payment.

---

## Testing

Run Payments operations interactively from the **Modules** tab of `/test-business-os`:

1. **Overview → Account Setup → Seed Profile** to make your account an active tenant.
2. **Modules → Load modules → Payments →** pick an operation → fill the form → **Run**. Try `create_invoice` → `list_invoices`, then `record_manual_payment` referencing that invoice and confirm it flips to `paid`.

Without a seeded profile you'll get `access_denied`. See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.

> **Note:** the plugin registry is cached at server cold-start, so a **dev-server restart** is needed for this plugin to first appear in the Modules list.

---

## Known limitations & open items

- 🔒 **Cross-tenant guard (implemented).** Because the invoice-paid trigger's `UPDATE` is not `user_id`-scoped, `record_manual_payment` verifies ownership of a supplied `invoice_id` / `contact_id` (`findById(id, userId)`) **before** recording — a caller cannot flip another tenant's invoice to paid.
- ⬜ **7 payment tables are out of scope for v1** — `payment_processors`, `saved_payment_methods`, `payment_events`, `payment_reminders`, `payment_automation_rules`, `payment_automation_executions` are service-owned automation/processor infrastructure with no repositories yet; a **phase‑2** would add repos and expose them. `payment_methods` is an orphan legacy table (to be confirmed dead and dropped).
- 🅿️ **External Stripe = leaf (out of scope).** Stripe Connect onboarding, checkout / payment-intent, card refunds, and the Stripe webhook stay external. The webhook remains the legitimate producer of `succeeded` transactions (which fire T3/T4); the plugin does not duplicate that.
- ⛔ **No `delete_invoice`.** Invoices are financial records — the plugin exposes `cancel_invoice` only; hard-deleting an invoice is intentionally not available.
- ℹ️ **`send_invoice` is status-only** — it does not dispatch the invoice email (email delivery is a separate external leaf).
- ℹ️ **Invoice numbering is read-max-then-increment** (non-atomic); a rare concurrent collision is caught by the `UNIQUE(user_id, invoice_number)` constraint. Pre-existing; not changed here.
- ⬜ **Read dashboards / Insights** direct-DB reads of payment tables (`stats`, `my-day`, Insight detectors) fold into the cross-cutting Insights repo-remediation (gap G2).

---

## Notes

- Every action is automatically scoped to your own account.
- The plugin is available to the AI assistant and the V6 agent pipeline (`domain: payments`).
- The `transactions` capability is effectively **write-restricted**: transactions are produced by `record_manual_payment` / `create_refund_record` (and externally by the Stripe webhook) — they are not free-form editable.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Initial documentation | Documented the internal Payments plugin: the "never moves money" boundary, the 23 invoice/transaction/plan operations, the automatic CRM payment activity + invoice-paid triggers (T3/T4, no double-log), the `record_manual_payment` (revenue) vs `mark_invoice_paid` (status-only) distinction, the cross-tenant ownership guard, Modules-tab testing, and v1 known limitations (7 deferred tables, Stripe leaves, no invoice delete). |
