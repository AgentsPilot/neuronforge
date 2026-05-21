# WP-03: Idempotency-Key Adoption Per Plugin

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending per-plugin sessions
> **Effort**: ~2–3h per plugin × ~4 plugins = ~8–12h total
> **Author**: Dev agent

## Problem

Tier 3 Fix #10 (already shipped) plumbs `params._idempotency_key` into every plugin-action call. The key is **stable across retries**, **distinct across iterations**, and **debug-friendly**. But **no plugin executor reads it yet** — the plumbing is dormant.

Result: retries still cause double-sends, duplicate Sheet rows, repeated Slack messages, etc.

## Goal

Wire `params._idempotency_key` into the four plugin executors that support idempotency natively. Each adoption is independent — a separate small session per plugin.

## Per-plugin adoption matrix

| Plugin | API mechanism | Effort | File |
|---|---|---|---|
| **Stripe** | `Idempotency-Key` HTTP header on all write APIs | ~1h | `lib/server/stripe-plugin-executor.ts` (verify path) |
| **Slack** | `client_msg_id` (UUID) in `chat.postMessage` | ~1h | `lib/server/slack-plugin-executor.ts` |
| **Google Sheets** | Use key as a UPSERT primary-key suffix on `append_rows`; check-before-write | ~1.5h | `lib/server/google-sheets-plugin-executor.ts` |
| **Gmail (send)** | No native idempotency; store sent message IDs by key in a small Supabase dedup table; check before sending | ~2h | `lib/server/google-mail-plugin-executor.ts` + new `email_send_dedup` table |

## Generic adoption pattern (applies to every plugin)

```ts
// At the top of the plugin's write action:
const idemKey = params._idempotency_key as string | undefined;

// Strip from params before forwarding to API (some APIs reject unknown fields)
const apiParams = { ...params };
delete apiParams._idempotency_key;

// Use the key as appropriate for the API:
//   - Stripe: pass as Idempotency-Key header
//   - Slack: pass as client_msg_id
//   - Sheets: include in row data or check-before-write
//   - Gmail: dedup via Supabase lookup before send
```

## Non-goals

- Modifying the key-generation logic in `StepExecutor.deriveIdempotencyKey` (already shipped, works).
- Adding new plugins to the matrix beyond the four above.
- Building a generic "client-side dedup table" service — Gmail's case is bespoke for now.

## Design notes per plugin

### Stripe
Trivial — Stripe's SDK accepts `idempotencyKey` as a request option on every write method. One-line additions per action.

### Slack
`client_msg_id` must be a UUID. Our key format is `${executionId}:${stepId}:iter=N` — that's not a UUID. Solution: hash it (SHA-256, take first 36 chars in UUID format) OR generate a v5 UUID derived from the key. Use the same derivation in tests for determinism.

### Google Sheets
No native idempotency for `append_rows`. Strategy: include the key in a hidden column (or as the value of a dedicated `_idem_key` column). On retry, query for the key BEFORE appending; if found, skip the append and return the existing row's reference.

### Gmail (send)
No native idempotency. Need a small Supabase table:
```sql
CREATE TABLE email_send_dedup (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  message_id TEXT,           -- Gmail's message ID after send
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
On send: `SELECT message_id FROM email_send_dedup WHERE idempotency_key = $1`. If found, return that message_id (no send). Otherwise send, insert, return.

## Tests

Per plugin (template):
1. First call with key K → succeeds, key recorded.
2. Second call with same key K (simulates retry) → no double-send, returns same result.
3. Different key K' → new send.
4. No key (e.g. step without the plumbing) → behaves as today (potential double-send — known acceptable as plumbing is widespread).

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Gmail dedup table grows unbounded | Add TTL: rows > 30 days deleted via scheduled cleanup |
| R2 | Sheets hidden column collides with user-managed columns | Use a column name with a reserved prefix (`__agentpilot_idem`) and document it as reserved |
| R3 | Stripe SDK version doesn't support per-request idempotency key | Verify SDK version in plugin definition; bump if needed |

## Estimated effort

- Stripe: ~1h
- Slack: ~1h
- Sheets: ~1.5h
- Gmail: ~2h (+ DB migration)

Total: ~5.5h core + buffer = ~8–12h depending on testing depth.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
