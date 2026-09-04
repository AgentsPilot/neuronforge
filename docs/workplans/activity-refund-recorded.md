# Activity: a refund is recorded

> **Last Updated**: 2026-09-02
> **Status**: ⬜ Open
> **Area**: `lib/payments/RefundService.ts`, `app/api/payments/refunds/route.ts`

## Context

Money coming in is on the contact's timeline; money going back is not. `RefundService` and `/api/payments/refunds` write no activity, so a refund — the financial event most worth auditing — leaves no trace beside the client it belongs to. An owner asking "did we refund this client, when, and how much?" has to leave the drawer.

## Work

Write one activity when a refund succeeds, following the pattern every other event uses:

- `activity_type: 'refund_issued'`
- `title` composed by `activitySentence` in **the business's language**, resolved from `business_profiles.language` — never English
- amount formatted with `Intl.NumberFormat` in the refund's own currency
- `description` carries the facts for the drill-down: `{ kind, amount, currency, reason, invoiceNumber }`
- `auto_logged: true`, `source_capability: 'payments'`, `source_entity_id` = the transaction
- non-blocking `.catch()`, like every other writer

## UI

- sentence in `lib/business-os/activityText.ts` for en/es/he
- an icon in `ACTIVITY_ICONS`
- reachable from the **payments** filter — add `refund_issued` to its `types`
- drill-down rows: amount, reason, invoice

## Verification

1. Issue a refund; a row appears on the contact, in the business's language.
2. It is reachable under the payments chip, not only "all".
3. It expands to show amount, reason and invoice.
4. The coverage guard reports no unreachable type.
