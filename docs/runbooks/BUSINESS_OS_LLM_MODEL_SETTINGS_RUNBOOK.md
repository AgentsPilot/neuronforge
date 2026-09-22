# Business OS LLM Model Settings — Operator Runbook

> **Last Updated**: 2026-09-21

## Overview

Every catalogued Business OS AI call — chat, insights, the daily briefing, website copy, intake forms, lead replies, images, onboarding — takes its **provider, model, temperature and on/off switch** from a database row at run time, not from the code. This runbook is how an operator reads those rows, changes one, and switches an area off in an emergency, plus the part that matters most: **what the off switch does not guarantee**.

Eight rows, one per area, live in `system_settings_config` under the keys `bos_llm_area_chat`, `…_insights`, `…_briefing`, `…_website`, `…_intake`, `…_leads`, `…_images`, `…_onboarding`. The code-owned defaults behind them are in `lib/business-os/llm/modelSettingsPolicy.ts` — the only file in Business OS call-site code where a model name or a temperature is written, enforced in CI by `npm run check:bos-llm-literals`.

**Audience:** whoever is on call for Business OS spend or an AI incident. No code change, deploy or PR is needed for anything in this document.

**How you would notice something is wrong,** since nothing here alerts by itself: the **LLM Usage** tab on `/test-business-os` (admin only) shows calls, tokens and cost per area and per business; the `token_usage` query in [§5](#5-what-the-switch-does-not-guarantee) is the same view in SQL; and the instance logs carry the resolver's three failure lines. There is no alerting on any of them yet — that gap is recorded as a follow-up (FU-6), and it is why this runbook starts at "you already suspect something".

---

## Table of Contents

1. [Before you start](#1-before-you-start)
2. [Read what an area is set to](#2-read-what-an-area-is-set-to)
3. [Change a setting](#3-change-a-setting)
4. [Switch an area off in an emergency](#4-switch-an-area-off-in-an-emergency)
5. [What the switch does NOT guarantee](#5-what-the-switch-does-not-guarantee)
6. [Confirm a change actually took effect](#6-confirm-a-change-actually-took-effect)
7. [Rollback](#7-rollback)
8. [Who can change these rows](#8-who-can-change-these-rows)
9. [Reference: areas, calls and locked fields](#9-reference-areas-calls-and-locked-fields)
10. [Change History](#change-history)

---

## 1. Before you start

| Fact | Why it matters |
|---|---|
| **The change script is the only sanctioned writer.** `npm run bos:llm-settings -- set …` | `PUT /api/admin/system-config` **refuses** every `bos_llm_area_*` key (DEC-10) until the admin screen ships. A direct SQL write skips every guardrail below |
| **Run it from the repository root.** `.env.local` is read from the current working directory | `lib/supabaseServer.ts` builds its client at import time; a plain `npx tsx scripts/bos-llm-settings.ts` dies with `supabaseUrl is required` before it can print usage |
| **Every command logs the Supabase host first** (`supabaseHost` on the first line) | You are normally pointed at **production**. Read that line before acting on an exit code |
| **Exit code 0 means "nothing is wrong".** Any other code means stop | The script writes nothing on any rejection |
| **A change reaches running code within ~60 seconds**, not instantly | Each serverless instance caches the settings for `BOS_LLM_SETTINGS_CACHE_MS` = 60 s (10 s after a failed read) and refills in the background |

```bash
npm run bos:llm-settings -- get <area>                                  # read
npm run bos:llm-settings -- set <area> --file row.json [--dry-run]      # change
npm run bos:llm-settings -- set <area> --enabled false [--include-calls] [--dry-run]
npm run bos:llm-settings -- verify-stored        # apply-time pre-check (P-3), read-only
npm run bos:llm-settings -- verify-equivalence   # apply-time post-check (P-5b), read-only
```

---

## 2. Read what an area is set to

```bash
npm run bos:llm-settings -- get website
```

It prints one structured line: `row` (what is stored), `rowUpdatedAt`, `resolved` (what each call in the area would use), `areaEnabled`, and `issues` (anything the resolver would refuse or adjust).

> ⚠️ **`get` reads the ROW, not what the running instances are currently using.** It queries the database directly. A production instance can still be serving the previous values for up to 60 seconds, and — see [§5](#5-what-the-switch-does-not-guarantee) — an instance whose settings read is failing may be serving something else entirely. `get` answers "what is configured", not "what is live".

---

## 3. Change a setting

### 3.1 Write the row

Take the current row from `get`, edit it, save as `row.json`, and set it.

```json
{
  "enabled": true,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "calls": {
    "full_site": { "model": "gpt-4o" },
    "landing_page": { "model": "gpt-4o" },
    "testimonial_enhance": { "temperature": 0.5 }
  }
}
```

- Area-level `provider` / `model` / `temperature` / `enabled` apply to every call in the area.
- `calls.<call_name>` overrides them for one call. Call names are in [§9](#9-reference-areas-calls-and-locked-fields).
- Anything you omit falls back to the area level, then to the **code default** — never to nothing.

```bash
npm run bos:llm-settings -- set website --file row.json --dry-run   # look first
npm run bos:llm-settings -- set website --file row.json
```

`--dry-run` prints `before`, `after` and the `resolved` settings each call would get, and writes nothing. Use it every time.

### 3.2 The guardrails that will refuse a value

The script validates the candidate row with **the resolver's own** schema and guardrails, so a row the resolver would refuse to honour can never be written (RC-9). Every one of these **blocks the write** and nothing is saved:

| Refusal | Meaning |
|---|---|
| `unpriced_model`, `zero_price` | The model has no active `ai_model_pricing` row with input **and** output costs > 0. Price it first, or its spend lands in the ledger at $0 |
| `image_price_missing` | An image model with no price for every configured size at every quality |
| `image_model_on_token_call` / a token model on the image call | The families are not interchangeable |
| `model_rejects_sampling_parameters` | A reasoning model (`gpt-5*`, `o1*`, `o3*`, `o4*`) on a call that must send a temperature or a frequency penalty — that is a 400 the retry does not cover |
| `reasoning_model_sent_max_tokens` | A reasoning model on a call that sends `max_tokens` rather than `max_completion_tokens` |
| `provider_not_allowed` | Only `openai` is allowed (DEC-4). A second provider is a code change with a test, never a settings change |
| `temperature_out_of_range`, `temperature_not_a_number` | Outside 0 … 1 |
| `model_empty`, `model_not_trimmed`, `model_too_long`, `model_not_a_string` | A stray space or quote in a model name is the most common mistake |
| `unknown_call_name`, `unknown_field` | A typo. The row is typed against the call catalog |
| **`locked`** | You set a field the code owns — see [§9](#9-reference-areas-calls-and-locked-fields). The resolver would ignore it, so the script refuses instead, rather than letting your intent silently not happen (RC-W8a) |
| `area_not_switchable` | `onboarding` has no off switch |

`Accepted, with adjustments` (a **warning**, not a refusal) means the row was written but a model rule changed something — for example a temperature not sent to a reasoning model.

### 3.3 When the script fails for a reason that is not the value

| Symptom | Cause | What to do |
|---|---|---|
| `Error: supabaseUrl is required` before any output | `.env.local` is missing, or you ran `npx tsx` directly instead of the npm script | Run from the repository root, through `npm run bos:llm-settings` |
| `Could not read the area row` / `Write failed` (exit 2) | The service-role key is absent, rotated or wrong for this project | Check the `supabaseHost` on the first line, then the key. **Nothing was written** |
| The `supabaseHost` is not the project you meant | You are pointed at the wrong environment | Stop. Every command prints it first precisely so this is caught before a write |
| Exit 1 with a `rejected` list | A guardrail refused the value — §3.2 | Fix the value. Nothing was written |

In every case the script writes nothing unless it prints `Business OS LLM area settings written`.

---

## 4. Switch an area off in an emergency

```bash
npm run bos:llm-settings -- set leads --enabled false --dry-run
npm run bos:llm-settings -- set leads --enabled false
```

Within ~60 seconds each instance stops making that area's model calls. **Off is a real refusal, not a silent failure:** no provider call, no ledger row, no AI audit entry, and the owner sees the area's documented fallback (a fixed-rules lead suggestion, starter website copy, the landing page's default content, or a translated "not available" sentence).

Three things to know before you rely on it:

1. **A call-level `enabled: true` override would survive the area switch.** The script lists those calls by name and **refuses**, telling you to re-run with `--include-calls`, which switches them off too. An emergency switch must do what it says (RC-W8c).
2. **`chat` off also stops chat at the route entry** — `/api/business-os/chat-v4`, `/api/business-os/chat-v2` and `/api/business-os/chat` — so the two chat paths that still choose their own model (chat-v2's `AIDataLayerService`, chat-v1's `IntentParser`) are stopped as well. A **confirmed** pending write still completes with chat off, and if it creates a landing page that is a `website/full_site` call, owned by the **website** switch, not chat's.
3. **`onboarding` cannot be switched off.** A half-built account is worse than an expensive one. To stop onboarding spend you need a code change.

---

## 5. What the switch does NOT guarantee

**The kill switch fails OPEN. A settings-read failure silently re-enables a switched-off area.**

This is FR-6 working as specified, not a bug: a configuration fault must never be worse than today's behaviour, and the alternative — failing closed — turns a database blip into a Business OS outage. It is still the thing to know before you walk away from an incident.

| What happens | What the area does |
|---|---|
| The settings read fails on an instance that **has read them before** | It keeps serving the **last good** values. An area you switched off **stays off** |
| The settings read fails on an instance that has **never** read them (a cold start, a fresh deploy, a Supabase outage at the wrong moment) | It falls back to the **code defaults**, in which **every area is enabled**. A switched-off area comes **back on**, on that instance only |
| `isBosLlmAreaEnabled` throws for any reason | It returns `true` — the area is treated as **enabled** |

**The only signal is the resolver's own log**, which nobody is watching by default. Search for:

- `Could not read Business OS LLM settings; serving the last good values` (warn) — the field `servingLastGood: false` in that line is the dangerous case: nothing good was cached, so the code defaults are in force.
- `Business OS LLM area switch unreadable; treating the area as enabled` (error).
- `Business OS LLM settings resolution failed; using code defaults` (error).

**If you must be certain an area is off — for example to stop a cost runaway — do not rely on the switch alone:**

1. `npm run bos:llm-settings -- get <area>` confirms the **row** says `enabled: false`. It does **not** confirm any instance is honouring it.
2. Check for the three log lines above. If any is firing, the switch is not dependable until the settings read recovers.
3. **Confirm at the ledger, not at the configuration.** No new `token_usage` rows for that area's feature is the only evidence that no call is being made. Run this (read-only) a few minutes after switching off, and again later:

```sql
-- Business OS LLM calls in the last 15 minutes, by area. Expect NO row for the
-- area you switched off. `feature` is always 'business-os-<area>'.
SELECT feature, count(*) AS calls, max(created_at) AS latest, sum(cost_usd) AS usd
FROM token_usage
WHERE feature LIKE 'business-os-%'
  AND created_at > now() - interval '15 minutes'
GROUP BY feature
ORDER BY latest DESC;
```

| Area | `token_usage.feature` |
|---|---|
| chat | `business-os-chat` |
| insights | `business-os-insights` |
| briefing | `business-os-briefing` |
| website | `business-os-website` |
| intake | `business-os-intake` |
| leads | `business-os-leads` |
| onboarding | `business-os-onboarding` |
| images | `business-os-images` |

The same view, without SQL: the **LLM Usage** tab on `/test-business-os` (admin only) renders these per area and per call.

> ⚠️ **One area is invisible to this check.** chat-v2 (`AIDataLayerService`) calls OpenAI directly and writes **no ledger row at all** (requirement F-13 / DEC-11), so an empty `business-os-chat` does not by itself prove chat-v2 is silent. The chat entry gate does stop it; there is simply no ledger evidence. chat-v1 (`IntentParser`) is catalogued and does appear.

> **Open follow-up (FU-6):** a louder signal — an alert on repeated resolver read failures — is a monitoring change and has not been made. Until it exists, the check above is manual.

---

## 6. Confirm a change actually took effect

| Step | What to look for |
|---|---|
| The script's own last line | `Business OS LLM area settings written`, with the `resolved` settings each call will now get |
| Re-read the row | `npm run bos:llm-settings -- get <area>` → `rowUpdatedAt` has moved and `resolved` matches your intent |
| Wait ~60 s, then the instance log | `Business OS LLM settings changed` (info), listing `{ callName, field, from, to }`. It logs **labels only** — never a prompt or owner text |
| Do one action in the area | The ledger records the model that actually ran. Check it: `SELECT created_at, feature, component, model_name, cost_usd FROM token_usage WHERE feature = 'business-os-<area>' ORDER BY created_at DESC LIMIT 5;` — `model_name` must be the model you configured (or the code default, if the retry fell back). The LLM Usage tab on `/test-business-os` shows the same thing without SQL |

If the log line never appears, the instance has not refilled yet or its read is failing — see [§5](#5-what-the-switch-does-not-guarantee).

---

## 7. Rollback

- **A bad value:** re-run `set` with the previous row. Keep the `get` output from before the change; it is your undo.
- **A code revert loses configuration.** Reverting the Layer 2 deploy restores the old readers, so a value that was changed **only in an area row** after the seed is silently lost. Write down any row change made after the seed.
- **Removing the rows entirely** (`DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%'`) is safe **only** while no code that reads them is deployed. With Layer 2 live, deleting a row does not break anything — every call falls back to its code default — but it also discards every operator change.

---

## 8. Who can change these rows

Anyone who can write `system_settings_config` can change six areas' model, temperature or on/off state **within 60 seconds, with no code review, no deploy and no approval step**. Today that is: platform admins through the gated admin routes, anyone running the change script with the service-role key, and anyone with direct database access.

That reach is a **deliberate, recorded decision** (workplan FU-3, parked by the user): Layer 2 delivers the control, and governing who pulls it belongs to the admin-screen layer. Two consequences worth holding:

- The only trail is the audit entry and the resolver's `Business OS LLM settings changed` log line. There is no change request, no second pair of eyes.
- While the leaked service-role key is unrotated, "only admins" is wider than the `admin_users` table.

---

## 9. Reference: areas, calls and locked fields

| Area | Calls | Switchable | Fields the code owns (the script refuses them) |
|---|---|---|---|
| `chat` | `planner`, `analysis` | yes | `planner.enabled`, `planner.temperature` (locked to 0 — the planner is stopped by the area gate, not by its own switch) |
| `insights` | `insight_content`, `correlated_insight`, `health_summary` | yes | — |
| `briefing` | `daily_narration` | yes | — |
| `website` | `full_site`, `landing_page`, `field_regenerate`, `testimonial_enhance`, `hero_content`, `about_content`, `faq_content`, `features_content` | yes (all eight) | — |
| `intake` | `form_generation`, `question_inference` | yes | — |
| `leads` | `reply_recommendation` | yes | — |
| `images` | `image_generation` | yes | `temperature` (an image call has none) |
| `onboarding` | `business_story_extraction`, `client_workflow_extraction`, `client_tracking_extraction`, `adjustment_intent_extraction` | **no** | `enabled` |

Chat's four embeddings are excluded from per-call settings and are stopped by the chat area gate.

> **Onboarding cannot be switched off**, so changing its model is the only lever you have on onboarding spend — which is why its call names are listed above rather than summarised. `client_tracking_extraction` is catalogued but unreachable in today's flow (its step is retired), so only the other three can fire.

**Everything the script will accept, from the script itself:** `npm run bos:llm-settings -- get <area>` prints the resolved settings for every call in that area, and an unknown call name is refused with the valid list.

**Related:**
- Requirement: [BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md)
- Workplan (apply order, per-call snapshot): [BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md)
- Code: `lib/business-os/llm/modelSettings.ts` (resolver), `modelSettingsPolicy.ts` (defaults), `scripts/bos-llm-settings.ts` (this script)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-21 | Created (FR-18, Layer 2 Step 4) | Read / change / emergency-off procedure for the eight area rows, the guardrails that refuse a value, propagation and rollback. §5 records that the kill switch **fails open** (FU-6 / D-61): a settings-read failure on an instance with no cached values re-enables a switched-off area, the only signal is the resolver's log, and `get <area>` reads the row rather than the resolver's live view |
| 2026-09-21 | SA review of Step 4 applied | §5 and §6 now carry a **copy-paste `token_usage` query and the eight `business-os-<area>` feature values** — the switch-independent proof was the one step that was not executable at 2am (SA finding 12), and it names the one area it cannot see (chat-v2 writes no ledger row). New §3.3 for failures that are not value failures (an absent or rotated service-role key), and the Overview says where you would notice a problem at all, since nothing alerts (SA finding 14) |
