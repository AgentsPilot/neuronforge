# Workplan: Notification Service test tab + configurable calibration-email model

> **Last Updated**: 2026-06-27

**Developer:** Dev
**Date:** 2026-06-27
**Branch:** `feature/notification-test-page` (off `main`)
**Status:** 🔨 Part A + B implemented (2026-06-28), tsc clean. Default model `gpt-4o-mini` (user-chosen). Part C deferred. Live verification pending.

---

## Overview

Two related pieces of work:

1. **Notification Service test tab** — add a new tab to the **existing** plugin test page (`app/test-plugins-v2/page.tsx`, *not* a new page) that lets us send a test email (To / Subject / Body) through the **provider-agnostic email transport** we built (Resend → env Gmail → owner's google-mail plugin connection → console). Purpose: **verify the environment email settings** used for system emails to end users, and see *which* provider actually delivered.
2. **Configurable calibration-email model/provider** — the calibration result email currently hardcodes `ProviderFactory.getProvider('anthropic')` + `'claude-sonnet-4-5-20250929'`. Make these config-driven (CLAUDE.md rule #5: no hardcoded model names).

---

## Requirements

### Part A — Notification Service test tab

| # | Requirement |
|---|---|
| A1 | New tab **"Notification Service"** on `/test-plugins-v2` (extend the existing `TabType` union + tab bar + panel). No new page/route surface. |
| A2 | Form fields: **To** (email), **Subject**, **Body**. A **Send** button posts to a test API route that sends via the transport and shows the result. |
| A3 | The result panel shows: **provider used** (`resend` / `gmail` / `gmail-plugin` / `none`), **sent** (true/false), and any **error** — so we can tell which environment path delivered. |
| A4 | **Defaults from env**: `To` defaults to the configured default email; the owner userId (for the plugin-connection fallback) defaults to `NEXT_PUBLIC_TEST_PAGE_USER_ID`. Body/Subject have sensible placeholder defaults. |
| A5 | Sends through the **same logic as production system emails** (`NotificationService` / `emailTransport.sendEmail`) — this is the whole point: test the real env-driven path. |

### Part B — DB-configurable calibration-email model/provider

| # | Requirement |
|---|---|
| B1 | Replace the hardcoded `'anthropic'` + `'claude-sonnet-4-5-20250929'` in `lib/calibration/calibrationResultEmail.ts` with **DB-config-driven** values, following the existing admin-config pattern (`SystemConfigService` on the `system_settings_config` table, like `helpbot-config`). |
| B2 | Config keys: **`agent_calibration_notification_email_provider`** + **`agent_calibration_notification_email_model`**. |
| B3 | **Default to the cheapest** sensible model among the factory-supported providers (openai / anthropic / kimi). Per `lib/ai/pricing.ts`, the cheapest reliable option is an OpenAI mini/nano — proposed default **`openai` + `gpt-4o-mini`** (very cheap + reliable; `gpt-5-nano` is the absolute cheapest if preferred). DB-overridable. |
| B4 | Admin GET/PUT route to read/update the two keys, mirroring `app/api/admin/helpbot-config/route.ts`. |

### Additional (from earlier scoping — phase 2 of this tab)

| # | Requirement |
|---|---|
| C1 | **Agent calibration status** element in the same tab: enter an `agentId` → show `calibration_status`, `is_calibrated`, `calibration_prompt_decision` / `_at`, `last_successful_calibration_id`. |
| C2 | Optional **"Run background calibration"** button for that agent (fires the existing `POST /api/v2/calibrate/batch` with `background:true`). |

---

## Design / approach

**Test-page auth model:** the page uses an explicit `userId` (from `NEXT_PUBLIC_TEST_PAGE_USER_ID`, passed via `x-user-id`/body) — *not* cookie auth. New test routes follow that: accept `userId` in the body/query, no `getUser`.

**A — Send test email**
- New route `POST /api/test/notification/route.ts`: body `{ userId?, to?, subject, body }`.
  - `to` defaults server-side to `SIMULATOR_USER_EMAIL` when omitted (server-only env; the client can't read it).
  - Calls `sendEmail({ to: [to], subject, html: body, ownerUserId: userId })` from `lib/notifications/emailTransport.ts` and returns the structured `{ sent, provider, error }`.
  - (Reuses the exact production transport — no duplicate logic.)
- Tab UI prefills `To` from a client-readable default. Since `SIMULATOR_USER_EMAIL` is server-only, **add `NEXT_PUBLIC_TEST_PAGE_USER_EMAIL`** for the form prefill (falls back to blank; the route still defaults server-side). `ownerUserId` prefills from `NEXT_PUBLIC_TEST_PAGE_USER_ID`.

**B — DB-configurable model/provider** (mirrors `helpbot-config`)
- Store two keys in `system_settings_config` via `SystemConfigService`: `agent_calibration_notification_email_provider`, `agent_calibration_notification_email_model`.
- **Read at the batch-route tail** (it already has the `supabase` client): `SystemConfigService.getString(supabase, 'agent_calibration_notification_email_provider', 'openai')` + `...email_model', 'gpt-4o-mini')`. Pass the resolved values into `sendCalibrationResultEmail({ ..., summaryProvider, summaryModel })`. This keeps `calibrationResultEmail.ts` free of a DB dependency.
- `calibrationResultEmail.ts`: use the passed `summaryProvider`/`summaryModel` (validate provider against the `ProviderName` union — openai/anthropic/kimi; fall back to the cheap default if unknown). LLM summary stays best-effort (deterministic fallback unchanged).
- **Admin route** `app/api/admin/calibration-email-config/route.ts` (GET/PUT) mirroring `helpbot-config`: GET returns `{ provider, model }` (with cheap defaults), PUT upserts the two keys via `SystemConfigService.set`.
- Default = **cheapest** (proposed `openai` / `gpt-4o-mini`).

**C — Agent calibration status (additional)**
- New route `GET /api/test/agent-calibration-status?agentId=&userId=` → `AgentRepository.findById(agentId, userId)` → return the calibration subset. Tab section renders it; the "Run" button is a client `fetch` to `/api/v2/calibrate/batch` (browser session cookies).

---

## Files (anticipated)

| File | Action |
|---|---|
| `app/api/test/notification/route.ts` | **New** — POST: send test email via `emailTransport.sendEmail`; returns `{ sent, provider, error }`; `to` defaults to `SIMULATOR_USER_EMAIL`. |
| `app/api/test/agent-calibration-status/route.ts` | **New** (Part C) — GET calibration fields for an agent. |
| `app/test-plugins-v2/page.tsx` | Add `'notification-service'` to `TabType`, a tab button, and the panel (send-email form + result; Part C status block). |
| `lib/calibration/calibrationResultEmail.ts` | Use passed `summaryProvider`/`summaryModel` instead of hardcoded (Part B). |
| `app/api/v2/calibrate/batch/route.ts` | Read the two DB config keys via `SystemConfigService` and pass them to `sendCalibrationResultEmail` (Part B). |
| `app/api/admin/calibration-email-config/route.ts` | **New** — GET/PUT the provider/model keys (mirrors `helpbot-config`). |
| `.env.example` | Document `NEXT_PUBLIC_TEST_PAGE_USER_EMAIL` (Part A prefill). |
| `docs/V2_TEST_PAGE_SCOPE.md` | Document the new tab. |

| `supabase/SQL Scripts/20260628_calibration_email_config.sql` | **New** — seeds the two `system_settings_config` keys (JSON-encoded values, `ON CONFLICT DO NOTHING`), mirroring `20251219_agent_generation_config.sql`. |

**DB:** `system_settings_config` is an existing key-value table — no schema migration. The seed script above inserts the two keys (category `calibration`, default `openai`/`gpt-4o-mini`); it's idempotent (`ON CONFLICT DO NOTHING`). Reads fall back to the same cheap defaults if the rows are absent, and the admin PUT auto-creates them — but the seed makes the defaults explicit/visible, matching how `agent_generation_ai_*` is handled.

---

## Decisions (resolved 2026-06-28)

1. **`To` prefill:** add **`NEXT_PUBLIC_TEST_PAGE_USER_EMAIL`** for the client form prefill; route still defaults to `SIMULATOR_USER_EMAIL` server-side. ✅
2. **Scope:** ship **Part A + B now**; **Part C** (agent status + trigger) is a **follow-up**. ✅
3. **Model config:** **DB config** via `SystemConfigService` keys `agent_calibration_notification_email_provider` / `_model`, **default cheapest**, mirroring the existing admin-config pattern (`helpbot-config`). ✅

### One detail to confirm
- The cheapest default model: proposed **`openai` / `gpt-4o-mini`** (cheap + reliable). `gpt-5-nano` is the absolute cheapest in `pricing.ts` if you'd rather go lowest. Either way it's DB-overridable.

---

## Testing

- `npx tsc --noEmit` clean on touched files.
- Manual: open `/test-plugins-v2` → Notification Service tab → send to your address → confirm the provider shown matches the env config (e.g. `gmail-plugin` when Resend/env-Gmail aren't set), and the email arrives.
- Part B: set `CALIBRATION_EMAIL_MODEL` to a different model → confirm the calibration summary uses it (log/inspect); unset → defaults to sonnet.

---

## Future enhancement — centralize ALL system-config defaults (Tier 2)

Tier 1 (done) gives the **calibration email** a single source of truth (`CalibrationEmailConfigService.CALIBRATION_EMAIL_DEFAULTS`). The broader issue remains: every feature (`agent-generation`, `ais`, `helpbot`, `memory`, …) re-declares its defaults inline in its admin route and/or service, and the seed SQL restates them again. A future initiative: a **global config registry** (`lib/config/systemConfigRegistry.ts`) declaring each key once (`{ key, category, default, description, type }`), with `SystemConfigService.get` falling back to it, admin routes rendering from it, and the seed SQL **generated** from it (eliminating the SQL duplication too). Larger refactor across existing config services/routes — own initiative, not bundled here.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-27 | Created | Notification Service test tab (send test email via the transport, env-driven) + configurable calibration-email provider/model + (additional) agent calibration status element. Awaiting approval. |
| 2026-06-30 | Tier 1: centralized defaults | New `lib/calibration/CalibrationEmailConfigService.ts` is the single source of truth (`CALIBRATION_EMAIL_DEFAULTS` + keys + `getCalibrationEmailConfig`). Batch route, `calibrationResultEmail`, and the admin route now import from it (removed 3 duplicated inline defaults; seed SQL points to it as source of truth). Logged Tier 2 (global config registry) as a future enhancement. tsc clean. |
| 2026-06-28 | Seed script added | `supabase/SQL Scripts/20260628_calibration_email_config.sql` seeds the two config keys (default `openai`/`gpt-4o-mini`), mirroring the `agent_generation_config` seed (JSON-encoded values, `ON CONFLICT DO NOTHING`). |
| 2026-06-28 | Part A + B implemented | Notification Service tab on `/test-plugins-v2` (To/Subject/Body → `POST /api/test/notification` → real transport, shows provider/sent/error; To prefills from `NEXT_PUBLIC_TEST_PAGE_USER_EMAIL`, server default `SIMULATOR_USER_EMAIL`). Part B: calibration email model/provider now DB-config (`agent_calibration_notification_email_*`, default `openai`/`gpt-4o-mini`), read at the batch-route tail via `SystemConfigService` and passed into `sendCalibrationResultEmail`; new admin `GET/PUT /api/admin/calibration-email-config`. Doc updated. tsc clean. |
| 2026-06-28 | Decisions + DB-config design | Resolved: add `NEXT_PUBLIC_TEST_PAGE_USER_EMAIL` prefill; ship A+B now (C deferred); Part B is **DB config** via `SystemConfigService` (keys `agent_calibration_notification_email_provider`/`_model`, default cheapest) + an admin GET/PUT route, mirroring `helpbot-config`. Read at the batch-route tail and passed into `sendCalibrationResultEmail`. |
