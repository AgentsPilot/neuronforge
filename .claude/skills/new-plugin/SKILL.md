---
name: new-plugin
description: Generates a new V2 plugin (definition JSON + executor class + registry entries + UI list + test-page template + .env.example) or extends an existing plugin with new actions. Use when the user asks to create, generate, add, or scaffold a plugin / integration / connector — e.g. "add a Trello plugin", "generate a plugin for Asana", "add new actions to the HubSpot plugin".
---

# new-plugin

Scaffold a new V2 plugin or extend an existing one. The full procedural spec already lives in **`docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`** — this skill orients you to it and enforces the non-negotiables.

> **Important:** V1 plugins (`lib/plugins/strategies/`, `lib/plugins/pluginRegistry.ts`) are **deprecated**. Never extend them. Everything below is V2.

---

## Step 1 — Read the workflow doc

Before writing anything, read the full workflow:

- **`docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`** — 11-step procedural guide covering OAuth research, action discovery, JSON Schema generation, executor templates, registry updates, and `.env.example` updates.

Also skim **one existing plugin of similar shape** as a reference (do *not* copy blindly — pick the closest match):

| If the new plugin is… | Reference |
|---|---|
| Standard OAuth2 (Slack-style) | `lib/plugins/definitions/slack-plugin-v2.json` + `lib/server/slack-plugin-executor.ts` |
| Google-style OAuth2 | `lib/plugins/definitions/google-mail-plugin-v2.json` + `lib/server/gmail-plugin-executor.ts` |
| HubSpot-style OAuth2 | `lib/plugins/definitions/hubspot-plugin-v2.json` |
| API-key auth | `lib/plugins/definitions/chatgpt-research-plugin-v2.json` |

---

## Step 2 — Confirm scope with the user

Ask before any code is written:

1. **Plugin name** (kebab-case, e.g. `trello`, `asana`)
2. **Mode** — does the plugin already exist? (Check `lib/plugins/definitions/<name>-plugin-v2.json`.)
   - Exists → **extend** mode (add actions only, skip OAuth research, skip registry edits)
   - Missing → **new** mode (full scaffold)
3. **Actions to implement** — present the discovered API surface and let the user pick a subset. Don't generate every endpoint by default.
4. **OAuth/auth research findings** — present `auth_url`, `token_url`, `refresh_url`, scopes, and which existing OAuth flow it most resembles. Wait for confirmation before generating.

---

## Step 3 — Files to create / modify

| Mode | File | Action |
|---|---|---|
| both | `lib/plugins/definitions/<name>-plugin-v2.json` | new: create · extend: add to `actions{}` |
| both | `lib/server/<name>-plugin-executor.ts` | new: create extending `BasePluginExecutor` · extend: add private methods + switch cases |
| new only | `lib/server/plugin-manager-v2.ts` | add filename to `corePluginFiles[]` |
| new only | `lib/server/plugin-executer-v2.ts` | add import + entry in `executorRegistry` |
| new only | `lib/plugins/pluginList.tsx` | add UI metadata entry |
| both | `app/test-plugins-v2/page.tsx` | add entries under `PARAMETER_TEMPLATES` for each new action |
| new only | `.env.example` | append `<NAME>_CLIENT_ID` / `<NAME>_CLIENT_SECRET` |

---

## Step 4 — Non-negotiables (do not skip)

These are the things most likely to be missed and they break the V6 pipeline silently. Verify each before reporting done.

### Definition JSON

- [ ] Every action has a complete `output_schema` — JSON Schema, not just a free-text description. The V6 pipeline binds capabilities by reading this.
- [ ] Every action has `output_guidance` with `success_description`, `sample_output`, and `common_errors`.
- [ ] Every output array item that represents a known entity has **`x-semantic-type`** set (e.g. `email_message`, `file_attachment`, `record`, `row`, `folder`, `message`, `text_content`).
  - Vocabulary lives in `lib/agentkit/v6/capability-binding/input-type-compat.ts`. If you need a new type, add it to `FROM_TYPE_VALUES` and `TYPE_COMPAT` there.
  - Run `validatePluginTypeAnnotations.ts` after generation to catch unknown types.
- [ ] If a parameter conditionally controls which output fields are populated (e.g. `content_level: "metadata"` empties `body`/`snippet`), declare **`output_dependencies`** on the action so the LLM gets the `⚠` warning.
- [ ] Destructive actions (delete, send, post) declare `rules.confirmations`.

### Executor class

- [ ] Extends `BasePluginExecutor` (do not reinvent auth/validation — the base class handles parameter normalisation, schema validation, confirmations, and connection retrieval).
- [ ] Implements `executeSpecificAction(connection, actionName, parameters)` with a `switch` over action names.
- [ ] Each action's private method uses `this.handleApiResponse(...)` for the fetch response — gives you consistent error mapping.
- [ ] No `console.log` — use `this.logger` (inherited from base).
- [ ] Returns a normalised shape that matches the action's `output_schema` exactly (field names, nesting). If they drift, V6 binding will mis-route data.

### Registry

- [ ] Plugin key is identical in three places: filename (`<name>-plugin-v2.json`), `corePluginFiles[]`, and `executorRegistry` key.
- [ ] UI metadata `category` is one of: `communication` · `productivity` · `crm` · `marketing` · `project` · `finance` · `integration` · `ai`.

### CLAUDE.md cross-cutting rules

- [ ] No hardcoded plugin names or operation names in V6 pipeline code or system prompts (per **Platform Design Principles** in CLAUDE.md). Plugin schemas are the source of truth.

---

## Step 5 — Validate

After generation:

1. Run the type-annotation validator: any script that exercises `validatePluginTypeAnnotations.ts` if present, otherwise grep for unknown `x-semantic-type` values.
2. `npm run lint` — TypeScript errors are ignored by `next.config.js` but **must still be fixed**.
3. Manual smoke check on `/test-plugins-v2` once a connection is configured.

---

## Anti-patterns to refuse

| ❌ Don't | ✅ Do |
|---|---|
| Add the plugin to V1 `pluginRegistry.ts` or `lib/plugins/strategies/` | V2 only — JSON definition + executor class |
| Skip `output_schema` because "the action is simple" | V6 binder needs it; missing schema means silent mis-routing |
| Inline auth logic in the executor | Use `BasePluginExecutor` — auth flows through `userConnections.getConnection` |
| Add plugin-specific branches to V6 pipeline code or system prompts | Schemas are the source of truth; let the LLM reason from them |
| Use `console.log` in the executor | Use `this.logger` from the base class |
| Generate every API endpoint the plugin has | Ask the user which actions they want; default to a small set |
