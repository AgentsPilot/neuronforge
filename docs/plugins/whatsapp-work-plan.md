# WhatsApp Plugin — Work Plan

**Created**: 2026-02-13
**Status**: Paused — testing outgoing messages before continuing P1
**Goal**: Make the WhatsApp plugin fully functional end-to-end
**Delete this file**: Once all tasks are implemented and verified

---

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Canonical plugin key | **`whatsapp-business`** — all references must use this |
| 2 | Where to store incoming WhatsApp messages? | **Deferred** — see options below. Revisit after outgoing messages are tested. |
| 3 | Should incoming messages auto-trigger agent workflows? | **Deferred** — requires a platform-level trigger/event system that doesn't exist yet. Not WhatsApp-specific. |
| 4 | Do we need an OAuth callback route for `/oauth/callback/whatsapp`? | **No** — generic handler at `app/oauth/callback/[plugin]/route.ts` covers this, including `extractPluginProfileData()` for `phone_number_id` and `waba_id` |

### Decision #2 — Options Discussed

**Context**: User does not want to store personal message content in the DB.

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Event-only / passthrough** | No storage. Webhook receives message, triggers agent workflow, discards content. | Zero privacy liability, simplest | Requires a trigger system that doesn't exist yet. No conversation history, no retry on failure. |
| **B. Metadata-only** | Store message_id, sender hash, timestamp, type, direction, status — no text/media content. | Status tracking works (sent→delivered→read), usage metrics | Can't display conversations, limited debugging |
| **C. Short-lived cache** | Full messages in TTL-based cache (e.g. Upstash Redis, 24h expiry). Auto-deletes after conversation window closes. | Supports conversation context during 24h window | Adds Redis dependency, not queryable long-term |
| **D. Forward to user's sink** | Route messages to user's chosen destination (Slack, Google Sheet, Notion, etc.) via agent workflow. | User controls their own data | Requires trigger system + connected destination plugin |

**Recommended approach**: **B (metadata-only)** for outgoing message status tracking now. Defer incoming message persistence until the platform trigger system is built. The webhook plumbing (`findUserByPhoneNumberId`, message parsing, structured logging) is ready for when that happens.

---

## Task List

### P0 — Standardize plugin key to `whatsapp-business`

**Change `'whatsapp'` → `'whatsapp-business'`** in these files:

- [x] `lib/plugins/definitions/whatsapp-plugin-v2.json:3` — `"name": "whatsapp"` → `"whatsapp-business"`
- [x] `lib/server/whatsapp-plugin-executor.ts:8` — `const pluginName = 'whatsapp'` → `'whatsapp-business'`
- [x] `lib/server/plugin-executer-v2.ts:40` — `'whatsapp': WhatsAppPluginExecutor` → `'whatsapp-business'`
- [x] `app/oauth/callback/[plugin]/route.ts:180` — `'whatsapp': 'whatsapp'` → `'whatsapp-business': 'whatsapp-business'`
- [x] `app/oauth/callback/[plugin]/route.ts:193` — `pluginKey === 'whatsapp'` → `'whatsapp-business'`
- [x] `app/api/plugins/schema-metadata/route.ts:34` — `'whatsapp'` → `'whatsapp-business'`
- [x] `components/settings/PluginsTab.tsx:48` — icon key `'whatsapp'` → `'whatsapp-business'`
- [x] `components/settings/PluginsTab.tsx:66` — gradient key `'whatsapp'` → `'whatsapp-business'`

**Remove duplicate `'whatsapp'` entries** (keep only `'whatsapp-business'`):

- [x] `components/v2/templates/TemplatePreviewModal.tsx:62` — removed `'whatsapp'` icon entry
- [x] `components/v2/templates/TemplatePreviewModal.tsx:86` — removed `'whatsapp'` label entry
- [x] `components/v2/Footer.tsx:494` — removed `'whatsapp'` label entry
- [x] `components/v2/Footer.tsx:527` — removed `'whatsapp'` icon entry

**Already correct (no change needed):**

- `lib/plugins/pluginList.tsx:119` — already `'whatsapp-business'`
- `lib/plugins/pluginDescriptions.ts:18` — already `'whatsapp-business'`

**Uses `.includes('whatsapp')` — will match `'whatsapp-business'`, no change needed:**

- `app/v2/agents/[id]/page.tsx:82`
- `app/(protected)/agents/[id]/page.tsx:216`

**NOT plugin keys — these are WhatsApp API payload values, do NOT change:**

- `whatsapp-plugin-executor.ts` lines 91, 144, 257, 355 — `messaging_product: 'whatsapp'` (Meta API requirement)

### P0 — Fix wrong icon

- [x] **Fix icon in plugin definition JSON**
  - File: `lib/plugins/definitions/whatsapp-plugin-v2.json:7`
  - Changed `<Calendar>` → `<MessageCircle className='w-5 h-5 text-green-600'/>`

### P0 — Rename files to match `whatsapp-business` key

- [x] `lib/plugins/definitions/whatsapp-plugin-v2.json` → `whatsapp-business-plugin-v2.json`
  - Updated filename in `lib/server/plugin-manager-v2.ts:20`
- [x] `lib/server/whatsapp-plugin-executor.ts` → `whatsapp-business-plugin-executor.ts`
  - Updated import in `lib/server/plugin-executer-v2.ts:16`
  - Updated comment on line 1 of the file
- [x] `app/api/plugins/webhooks/whatsapp/` → `app/api/plugins/webhooks/whatsapp-business/`
  - Updated `endpoint_path` in `whatsapp-business-plugin-v2.json:31`
  - Updated comment on line 1 of the route file

### P1 — Webhook Route (Core Functionality)

- [x] **Implement `findUserByPhoneNumberId`**
  - Added `findActiveConnectionByProfileData()` method to `UserPluginConnections` (`lib/server/user-plugin-connections.ts`)
  - Uses Supabase `.contains()` for efficient JSONB matching (PostgreSQL `@>` operator)
  - Updated webhook route to call the new method with `{ phone_number_id: phoneNumberId }`

- [ ] **Implement incoming message persistence** *(deferred)*
  - File: `app/api/plugins/webhooks/whatsapp-business/route.ts`
  - Issue: `handleIncomingMessage()` logs but doesn't store anything
  - Blocked by: Decision #2 (deferred) + platform trigger system not yet built
  - Webhook plumbing is ready — message parsing, user lookup, structured logging all in place
  - **Next step**: Revisit after outgoing messages are tested and trigger system is designed

- [ ] **Implement message status persistence** *(deferred)*
  - File: `app/api/plugins/webhooks/whatsapp-business/route.ts`
  - Issue: `handleMessageStatus()` logs but doesn't update anything
  - Needs: Metadata-only table for outgoing message status (sent → delivered → read → failed)
  - **Next step**: Revisit after outgoing messages are tested end-to-end

### P2 — Cleanup & Alignment

- [x] **Add test page parameter templates**
  - File: `app/test-plugins-v2/page.tsx`
  - Added templates for all 5 actions

- [x] **Align Meta API version in OAuth URLs**
  - File: `lib/plugins/definitions/whatsapp-business-plugin-v2.json`
  - Updated `v18.0` → `v23.0` in auth_url, token_url, refresh_url

- [x] **Update plugin documentation**
  - File: `docs/plugins/whatsapp-plugin.md`
  - Added `WHATSAPP_VERIFY_TOKEN` env var
  - Updated API version references to `v23.0`
  - Updated plugin key, file paths, endpoint path, redirect URI
  - Added version history entry for v1.0.1

### P3 — Code Quality

- [x] **Replace console.log with Pino logger in webhook route**
  - File: `app/api/plugins/webhooks/whatsapp-business/route.ts`
  - Replaced all `console.log`/`console.error` with structured Pino logging
  - Added `correlationId` via `logger.child()` in POST handler
  - Passed logger instance to helper functions
  - Removed unused `NextResponse` import

---

## Files Involved

| File | Changes |
|------|---------|
| `lib/plugins/definitions/whatsapp-plugin-v2.json` | Fix name to `whatsapp-business`, fix icon, update API version |
| `lib/server/whatsapp-plugin-executor.ts` | Fix pluginName to `whatsapp-business` |
| `lib/server/plugin-executer-v2.ts` | Fix registry key to `whatsapp-business` |
| `app/oauth/callback/[plugin]/route.ts` | Fix key references to `whatsapp-business` |
| `app/api/plugins/schema-metadata/route.ts` | Fix key to `whatsapp-business` |
| `components/settings/PluginsTab.tsx` | Fix keys to `whatsapp-business` |
| `components/v2/templates/TemplatePreviewModal.tsx` | Remove duplicate `'whatsapp'` entries |
| `components/v2/Footer.tsx` | Remove duplicate `'whatsapp'` entries |
| `app/api/plugins/webhooks/whatsapp/route.ts` | Implement webhook handlers, add logging |
| `app/test-plugins-v2/page.tsx` | Add parameter templates |
| `docs/plugins/whatsapp-plugin.md` | Update env vars and API version |

---

## Progress Log

| Date | What was done |
|------|---------------|
| 2026-02-13 | Audit completed, work plan created |
| 2026-02-13 | Decided canonical key = `whatsapp-business`, full usage audit done |
| 2026-02-13 | P0 complete — all key renames, duplicate removals, and icon fix applied |
| 2026-02-13 | P0 file renames complete — definition JSON, executor, and webhook directory |
| 2026-02-13 | P2 complete — API version aligned, test templates added, docs updated |
| 2026-02-13 | P3 complete — Pino logger with correlation ID in webhook route |
| 2026-02-13 | P1 findUserByPhoneNumberId — added `findActiveConnectionByProfileData()` to UserPluginConnections, JSONB @> query |
| 2026-02-13 | P1 decisions discussed — incoming message persistence deferred, status persistence deferred. Test outgoing first. |
