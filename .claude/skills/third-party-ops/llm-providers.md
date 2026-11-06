# LLM providers (OpenAI, Anthropic, Groq, Kimi)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to the LLM providers, in the template's six parts plus tiers and order. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

Before each use, confirm the credentials below are still live (`SKILL.md` §5): a code path that runs (for Kimi, a code path that runs **when selected**), and the names set on Vercel. Drop any that is not.

**Four keys, four accounts.** Each key is a separate vendor account with its own bill, spend limit and model access. A working OpenAI path proves nothing about Anthropic, and the reverse. Never treat them as "the AI key".

| # | Credential | Names | Kind |
|---|---|---|---|
| L1 | OpenAI: chat, embeddings and image generation share it | `OPENAI_API_KEY` | Server secret; catalogue required on production and preview |
| L2 | Anthropic | `ANTHROPIC_API_KEY` | Server secret; catalogue required on production and preview |
| L3 | Groq (the help bot) | `GROQ_API_KEY` | Server secret; catalogue optional, effectively required wherever the help bot is served |
| L4 | Kimi | `KIMI_API_KEY` | Server secret; catalogue optional; covered when selected |
| L5 | Mistral | none | Not wired: not a gap. When a change wires it, that change adds the catalogue name and a row here before merge |
| M | Model-name overrides | `OPENAI_MODEL`, `OPENAI_CHAT_MODEL` | Server config identifiers, not secrets; unset means the code default |

**Boundary.** DO owns the four keys, the two model-name names, and which provider account or project each environment's key belongs to. Which model or provider a feature uses, when a database row holds it, is app data owned by the admin screens that edit those rows (found at use time; for example the Business OS LLM and AIS config screens) and by `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md`. Model prices belong to the model price review stream. DO reads those rows read-only for one purpose: which providers they select (T-LLM-4). DO never writes them.

---

## 1. What must differ between environments

The **current** setup (which accounts, organisations, projects or workspaces exist, which key each environment uses, where each value lives, what limits are set) is recorded in the private inventory by role, and that record is the expected state an audit compares with. Where the value lives is found at run time and reported by name and target only.

| Setting | Rule per environment |
|---|---|
| Account, organisation, project or workspace per key | As recorded. Every key on one target belongs to the recorded account for that environment. **Recommended shape:** production keys in their own project or workspace with their own spend limit; preview and local keys in a separate one, so a preview run cannot spend against production's limit. This file states the shape, never whether it is in place |
| L1, L2 keys | Set on production and preview (catalogue required) |
| L3 key | Set wherever the help bot is served (the help bot constructs the Groq provider directly; its settings rows choose the model only), and wherever a settings row selects Groq |
| L4 key | Covered when selected: set wherever a settings row selects Kimi; otherwise optional |
| Spend limit, budget and alerts | Per project or workspace, as recorded; set by the user in the provider dashboard; never written into the repo |
| Model-name names | Unset (code default), or a model available to the recorded project that has a pricing row |
| SDK-implicit names (§5) | Not set on any target unless recorded with a reason |

"Local" is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check; a local key never belongs to the production project.

## 2. Where the code reads it

| Credential | Read in |
|---|---|
| L1 | `getProviderFactory()` / `getProvider` in `lib/ai/providerFactory.ts` (one instance per provider, key read at first use); `lib/ai/providers/openaiProvider.ts`. Embeddings: `lib/services/EmbeddingService.ts` (its key argument is ignored; it calls the factory). Images: `lib/services/GeneratedImageService.ts` (through the factory) |
| L2 | The factory; `lib/ai/providers/anthropicProvider.ts` |
| L3 | `app/api/help-bot-v2/route.ts` constructs `GroqProvider` directly from `GROQ_API_KEY` in both its model calls; the factory also holds a Groq instance for settings-selected paths; `lib/ai/providers/groqProvider.ts` (plain `fetch`, no SDK client) |
| L4 | The factory; `lib/ai/providers/kimiProvider.ts` (an OpenAI SDK client given its own base URL) |
| L5 | `lib/ai/providers/mistralProvider.ts`: nothing constructs it, and `PROVIDERS` in the factory does not list it |
| M | `OPENAI_MODEL`: `app/api/orchestration/run-step/route.ts`. `OPENAI_CHAT_MODEL`: `lib/business-os/ai-data-layer/AIDataLayerService.ts`. Each reader falls back to a code default |
| Settings rows | `system_settings_config`: Business OS areas (`lib/business-os/llm/modelSettings.ts`, policy in `modelSettingsPolicy.ts`), orchestration routing (`lib/orchestration/RoutingService.ts`, with `ais_system_config`), the help bot model, and the V6 admin config (read by `lib/agentkit/v6/config/AgentGenerationConfigService.ts`, used by `V6PipelineOrchestrator.ts`) |
| Ledger and cost | `callWithTracking` in `lib/ai/providers/baseProvider.ts` writes `token_usage` through `lib/analytics/aiAnalytics.ts`; cost from `lib/ai/pricing.ts`; Business OS credits from `lib/business-os/llm/aiChargeRecorder.ts` |
| Expected names | `lib/admin/environment/catalogue.ts`, group `ai`; effective requiredness for L3 and L4 comes from code and the settings rows (T-LLM-4) |

**Derive, never list.** Setting keys, model names and the providers each row selects are read at use time from those files and rows at `origin/main`. This file names none.

**Never a probe target.** The deprecated V1 research strategy (`lib/plugins/strategies/chatgptResearchStrategy.ts`) and the `backups/` copies of old readers. A pass or a failure on them says nothing about the live path.

## 3. Dashboard steps (the user)

By area name, because the consoles move: confirm the path at use time. Per provider:

- **API keys:** create, name, restrict to a project where offered, revoke; last-used time where shown.
- **Organisation, project or workspace settings:** which one the key belongs to.
- **Billing, limits or budgets:** spend limit, alert thresholds, current-period spend.
- **Usage:** per day, per key or project where offered.
- **Model access:** per project, where the vendor gates it.
- **Setting the value on Vercel:** `vercel-ops` and `env-change-protocol`. The value never passes through chat or a file.

The user reports presence, "belongs to the recorded project: yes/no", "limit and alert set as recorded: yes/no", "usage shown for the probe window: yes/no", "model available: yes/no" and the last-updated time. Never a key or key fragment, an organisation or project id, an invoice amount or a limit value.

## 4. Probes

Each fails when the setting is wrong. No probe needs DO to hold a key, and none targets a §2 "never a probe target" reader. Every functional probe is a **real provider call: it spends real money and writes ledger rows**. It is optional, user-approved, one run, never in a loop; if the user declines it is "not probed (declined)". A probe that meets deployment protection is "not probed". No probe runs `eval:chat`, `bos:llm-settings` or any key-reading script.

**Ledger reads** (DO, read-only SQL under `devops.md` rules (a)–(d), counts only). The select list holds only `provider`, `feature`, `success`, `error_code` or a derived class, and `count(*)`, filtered by `created_at` after the probe or Ready time. `error_message`, `request_payload`, `response_metadata` and `user_id` are never selected, grouped, ordered or returned; `error_message` appears only inside the fixed class match below.

- **Groq class** (from our code, `groqProvider.ts`): `error_message` starting "Groq API error: " then the status; `401` is the auth class, `429` the quota/rate class.
- **Anthropic class:** the status number at the start of the SDK's message; confirm against the installed SDK at use time.
- **OpenAI:** `error_code` carries the SDK's code; the code names are vendor facts, confirmed at use time.
- Anything unmatched is class "other". An "other" > 0 is reported as "unclassified failures", never folded into 0.

**The shared-ledger rule.** A ledger read is usable only where that environment writes to its own database, as recorded. Where another deployment writes to the same ledger, a count cannot say which deployment wrote it: "not conclusive (shared ledger)".

**The ledger-write rule.** A missing row is a fail only when "Failed to insert token_usage row" and "AI call tracking threw; row not written" (service `AIAnalyticsService`) are both 0 in the window; otherwise "not conclusive (ledger write failed)".

| Change | Probe | Pass | Fails when | Who | Side effects |
|---|---|---|---|---|---|
| Any of the six names | `/admin/environment` on that deployment | Shows Set (or Not set, for an intended unset) | Shows the other state; or `required-not-set` is flagged | Main session or user (admin session) | None |
| L1 and L3: one help bot question | Signed in (a normal session, not admin) on that deployment, after it is Ready, ask the floating help button on a V2 page one harmless question that is **new** (it must miss both the FAQ and the answer cache, and must not ask to find an agent), with the help bot's semantic search setting on, as read at use time on the help bot config screen | **L3:** the answer appears with the **Groq** source badge, **and** a `help_bot_v2` row with `success = true` for provider groq. **L1:** ≥ 1 `helpbot` row with `success = true` for provider openai, and 0 openai failure rows. Both after the probe time | **L3:** an error answer, or a groq failure row. **L1:** an openai failure row, or 0 rows while both ledger-write classes are 0. The visible answer is **not** evidence for L1: a failed lookup logs "Cache search error" (module `HelpBotV2API`) and Groq still answers | User (trigger); DO (ledger counts) | Three real provider calls (an OpenAI embedding, a Groq chat call, a second embedding), ledger rows on the **platform's own account**, no credits charged. One shared answer-cache row holding the question and the answer, reused for later matching questions; the app has no route that removes it. One support-analytics counter increment. A FAQ or Cache badge, or an agent-search answer, is "not probed (answered from FAQ or cache)", never a fail |
| L2 key | No app-side probe. `/admin/environment` Set, plus the user's dashboard read (key present, belongs to the recorded project, last used) | Set, and "belongs to the recorded project: yes" | Not set, or "no" | Main session or user; user | None |
| L4 key | As L2, only where a settings row selects Kimi | As L2 | As L2 | As L2 | None. Where no row selects it: "not probed (not selected)" |
| Any key: traffic read (optional, never a substitute for a failing probe) | After the deployment is Ready, DO counts that provider's ledger rows by `success` and class from Ready time onward | ≥ 1 success and 0 auth-class rows: "pass (from traffic)" | An auth class > 0 | DO | None. No rows: "not probed (no traffic)", never 0. Shared-ledger rule applies |
| Key belongs to the recorded account | After a call probe or traffic, the user opens the recorded project's usage view | Usage shown for the window (allowing the vendor's reporting delay, confirm at use time) | No usage on the recorded project | User | None |
| Model-name name | No functional probe. Set / Not set on `/admin/environment`, plus the user's "model available to the recorded project: yes/no", plus "a pricing row exists for that model" (read-only, in the price review stream's admin screen) | All three | Any one fails | Main session; user | None |
| Key rotation | The probes above on the new deployment, then revoke the old key, then repeat them | Pass after revoke | Any failure after revoke | User; DO | As the probes used |

**Rotation overlap.** Until the old key is revoked, a pass may have used the old key (for example if the new value never reached the target), so it is "pass, not conclusive (overlap)" until the old key is revoked and the probe repeated.

## 5. Gotchas

- **One OpenAI key serves chat, embeddings and images** (`EmbeddingService.ts`, `GeneratedImageService.ts`). Revoking or mis-setting L1 breaks all three together. One key, one rotation.
- **The factory keeps the key it first read** (`providerFactory.ts`). A change takes effect on the next deployment; warm instances of an older one keep the old key. Revoke the old key only after the new deployment is Ready and probed. Older Preview deployments built before a rotation fail once it is revoked; redeploy any still needed.
- **An unset key fails the call** on that path ("environment variable is not configured"); the caller's own log line, if any, carries it. It is not a counted class.
- **Groq does not depend on a selection** (`app/api/help-bot-v2/route.ts`): the help bot builds its own Groq provider. An unset Groq key there reaches the vendor and comes back as "Groq API error: " plus the status (`groqProvider.ts`), not as "not configured".
- **The factory's availability helpers never report Groq** (`isProviderAvailable`, `getAvailableProviders`, `getStatus` in `providerFactory.ts`). An availability result is never evidence about Groq.
- **A settings row can make an optional key required** (§2 settings rows): check the key before a row selects a provider.
- **SDK-implicit names.** The SDK clients read some env names on their own when the constructor does not pass them. The app never reads them, so the catalogue and its drift guard cannot see them, and set on a target they can re-route or re-bill calls. Per client: OpenAI (`openaiProvider.ts`, passes the key only): its base-URL, organisation and project names can apply. Anthropic (`anthropicProvider.ts`, key only): its base-URL and auth-token names. Kimi (`kimiProvider.ts`, base URL explicit): only the OpenAI organisation and project names, and they are sent to Kimi's vendor. Groq: no SDK-implicit names. The names themselves come from each SDK's docs at use time, for the version in `package.json`.
- **Wrong organisation or project looks healthy in the app** (`pricing.ts`, `aiChargeRecorder.ts`). Ledger cost and customer credits are priced in-app from our own pricing table, so they look normal while the bill and the spend limit land on the other account. Only the provider dashboard shows it (T-LLM-7, T-LLM-8).
- **A model with no pricing row records $0**: "No pricing found; recording $0 for this call" (module `AiPricing`). A model-name change needs its pricing row first.
- **Model access differs by project** (`lib/business-os/llm/modelFallback.ts`). When the configured model differs from the code default and the provider refuses it, Business OS retries once with the default and logs "Provider rejected the configured model; retrying once with the code default" (module `BosLlmModelFallback`). After a key change, that line points at the key's project or the setting.
- **The ledger needs the service-role key too** (`getAnalytics` in `providerFactory.ts`, `aiAnalytics.ts`). Set but wrong: the call succeeds, the ledger write fails, and one of the two `AIAnalyticsService` lines appears; the probe is "not conclusive (ledger write failed)". Unset: every factory call fails before reaching the provider. That is a database-credential fault for `supabase-ops`, not a provider fault.
- **Scripts spend for real** (`scripts/env-preload.ts`). `eval:chat` and `bos:llm-settings` load the local env file and call the real provider with whatever key it holds. They are key-holder runs (`SKILL.md` §2), pre-checks at most, never the post-change probe, and run only with the user naming the script and the account it charges. Unit tests set stub keys (`tests/plugins/jest-setup.ts`), so a green Jest run proves nothing about any key.
- **Mistral is not wired** (`mistralProvider.ts`): not a gap.
- **Spend limits, budgets and alerts are dashboard facts** the user operates; never written into the repo. Calls are refused once a limit is hit (vendor fact, confirm at use time).

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-LLM-1 | On each **Vercel target**, the `ai` group names match the catalogue's `expectedIn` (L1, L2 set on production and preview). Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-LLM-2 | No `NEXT_PUBLIC_` name holds an LLM key or model name: every `NEXT_PUBLIC_` name on the target is a `NEXT_PUBLIC_` name in the catalogue, and no `ai` group name appears with the prefix. Derived, not a typed list | Catalogue at `origin/main` | `vercel-ops` §3 (names only) | Critical | DO |
| T-LLM-3 | No SDK-implicit name (§5) is set on any target unless recorded with a reason | SDK docs at use time; private inventory | `vercel-ops` §3 (names only) | High | DO |
| T-LLM-4 | Every provider that a settings row selects, or that a code path constructs outside the factory (derived from code at `origin/main`), has its key Set on that environment's deployment | Code at `origin/main` (setting keys and direct constructions derived); settings rows (provider values only) | `supabase-ops` §2 read-only SQL; `/admin/environment` or `vercel-ops` §3 | High | DO |
| T-LLM-5 | Per provider, `token_usage` failure rows since the last run, counted by `error_code` (OpenAI) or the §4 class (Anthropic, Groq). An auth class > 0: High. A quota or rate class > 0: Medium. "Other" > 0: "unclassified failures". A provider with no rows: "not read (no traffic)", never 0. Shared-ledger rule applies | Change records | Read-only SQL, counts only | High / Medium | DO |
| T-LLM-6 | 0 "Provider rejected the configured model; retrying once with the code default" (module `BosLlmModelFallback`) since the last run. 0 does not prove model access when the configured model is the code default; at most one line per instance per settings-cache period | Change records | Runtime logs | Medium | DO |
| T-LLM-7 | Each key on each target belongs to the recorded organisation, project or workspace for that environment; preview and production separation as recorded | Private inventory | User report (API keys, project settings) | High | User |
| T-LLM-8 | Spend limit, budget and alerts set per project as recorded; current-period spend below the alert threshold; the recorded project shows usage on the days the ledger shows traffic for that provider | Private inventory; ledger counts by day (DO) | User report (Billing, Usage) | High | User; DO |
| T-LLM-9 | 0 "No pricing found; recording $0 for this call" (module `AiPricing`, level `warn`) since the last run; each set model-name name names a model available to the recorded project | Change records; private inventory | Runtime logs; user report | Medium | DO; User |
| T-LLM-10 | `PROVIDERS` in `providerFactory.ts` at `origin/main` lists exactly the providers this file covers; a new one means this file needs a row before its key is set | Code at `origin/main` | Repo read | Low | DO |

## 7. Tiers and order against the deploy

**Tiers.** Any key create, rotation or revoke for a key production uses; any change of organisation, project or workspace for it; any spend limit, budget or alert change on production's project; and any production model-name change (it changes cost) are production tier: SA reviews the plan, the user executes. Removing a key is a hard off for every feature on that provider, so it is production tier on any target where the catalogue, a settings row or a direct construction requires it. A change to a key used **only** by non-production environments, as recorded, is reversible: the user applies it after the approval in chat. Where one key or project serves several environments, every change to it is production tier.

| Change | When |
|---|---|
| A settings row will select Groq or Kimi on an environment | That key Set on that environment's deployment and probed before the row is changed |
| A model-name value, or a row choosing a new model | Model available to the recorded project, and a pricing row present, before the change |
| A newly wired provider (for example Mistral) | Catalogue name, key on every target the catalogue requires, and a row here, before merge |
| Key rotation | Create new in the recorded project → set → deploy Ready → probe → revoke old **after deploy** → probe again; overlap per §4 |
| Lowering a spend limit | After the user compares current-period spend with the new limit |
| Removing a key | Only after no settings row or code default selects that provider, no code path constructs it directly, and the catalogue does not require it on that target |
