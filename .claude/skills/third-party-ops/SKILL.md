---
name: third-party-ops
description: How to plan, check and verify settings on the external platforms this repo depends on, where DO holds no tool and the user operates the dashboard — Stripe (API keys, test or live mode, webhook endpoints and signing secrets, endpoint API version, Connect client and OAuth redirect URIs, customer portal configuration, plan prices) first, then email, Google Cloud, LLM providers, DNS, queues, messaging and plugin OAuth apps as each is covered. Use when the user asks about Stripe, a payment key, a webhook endpoint or signing secret, test or live mode, a Connect setting, a customer portal configuration, an OAuth redirect URI or client, a vendor API key, Resend, SMTP, a sender address, an email delivery webhook, a Gmail refresh token, a sending domain, "Continue with Google" or Google sign-in, a Google OAuth client, a redirect URI mismatch, an OAuth consent screen, Authorised JavaScript origins, a Google API key, a Places key, Custom Search, a vendor dashboard, or "is the integration configured". Used by the main session and by the DevOps (DO) agent. Prevents a credential in the wrong mode or account, a probe that moves money, values passing through chat, and vendor IDs or open weaknesses leaking into tracked text.
---

# third-party-ops

This repo's procedure for external platforms. It holds only what is specific to each platform: what must differ between environments, where the code reads it, the dashboard step the user performs, the app-side probe, and the gotchas. Everything else is a pointer:

| For | Read |
|---|---|
| The eight steps, tiers, approval, order against the deploy, change-record template, public-repo rule | `.claude/skills/env-change-protocol/SKILL.md` — mandatory for every change; not repeated here |
| DO holds no third-party tool; what DO may write; § Report Format; read-only SQL rules (a)–(d) | `.claude/agents/devops.md`: § What You Own ("Platforms without a tool"), § Permission Tiers ("What you may write"), § Tool Rules ("Supabase (plugin server only)", rules (a)–(d)), § Report Format |
| Env var names by target, value-bearing responses, which deployment holds a value, the `NEXT_PUBLIC_` rebuild, who probes what | `.claude/skills/vercel-ops/SKILL.md` §2–§4 |
| Any SQL evidence | `.claude/skills/supabase-ops/SKILL.md` §1–§2, under `devops.md` rules (a)–(d) |
| Where the third-party drift checks join an audit | `.claude/skills/env-drift-audit/SKILL.md` §1, §3, §7 |

---

## 1. Scope

- A **third party** is any external service the code calls, imports an SDK of, or reads an env var for.
- **The list of names is `lib/admin/environment/catalogue.ts` at `origin/main`**, by group (`payments`, `email`, `ai`, `plugins`, `external`, `jobs`, …), each with its `expectedIn` (required / optional / forbidden) for production, preview and local. Its drift guard (`lib/admin/environment/__tests__/catalogueDrift.guard.test.ts`) fails the Jest gate when code reads a name the catalogue lacks, so **DO never searches the code for names**. The catalogue holds no values, so DO may read it in full. The guard sees the read forms it recognises, not a computed name.
- **Our own shared secrets are not third parties:** the cron secret, the link-signing secrets, the agent-run webhook secret and the IP salt follow `env-change-protocol` and `vercel-ops` only.
- The admin Environment page (`app/api/admin/environment/route.ts`) shows Set / Not set for each name **on the deployment it is served from**. It never shows a value.

## 2. Who does what

| Step | Who |
|---|---|
| Read the repo: names, callback paths, event types, pinned versions | DO or the main session |
| Read or change anything in a vendor dashboard | **The user.** DO gives the step by dashboard area name and asks for a report of presence, mode, status and last-updated time: never a value |
| Move a value from the dashboard to Vercel | The user, per `vercel-ops` and `env-change-protocol`. **The value never passes through chat or a file** |
| A script that needs a vendor key | The key holder (the user), with the key in a file outside every git checkout |
| Probe the deployed surface | Browser or HTTP probe: the main session or the user (`vercel-ops` §4, "Who probes what"). Server-side evidence: DO, from that deployment's runtime logs, by counts and message class |

DO holds no vendor tool or key. A future read-only, mode-scoped vendor MCP server would be a `claude-harness-ops` change with its own SA review.

## 3. Common rules

- **Mode and account per environment.** When a vendor has test and live modes, or separate accounts, which one each environment uses is recorded in the private inventory by role. Every credential of that vendor in one environment is the same mode and the same account.
- **One webhook secret per endpoint.** A signing secret belongs to one endpoint at one address. Each environment that receives webhooks has its own endpoint and secret; a local listener has its own secret too.
- **Redirect URIs come from the app address.** Each environment's address (`NEXT_PUBLIC_APP_URL`, read through `platformOrigin()` in `lib/utils/origins.ts`) plus the redirect exactly as the code builds it is registered with the vendor, per environment. Preview deployment URLs change per deployment, so only a stable address can be registered.
- **Rotation overlaps.** Set the new credential, wait for the deploy that carries it to be Ready, probe it, and only then revoke the old one (after deploy). Whether and how long a vendor keeps the old one valid is checked in the vendor's docs at use time, never hardcoded. A probe that passes while the old credential is still valid may prove nothing; each platform file says when.
- **Verify the deployed value, never the key in hand.** A script run with a key file is a pre-check. The post-change probe goes through the deployed surface (protocol steps 4 and 5).
- **Never a live money event as a probe.** In production, probe with a replay the code treats as a duplicate, or with a page that loads without paying. A probe with a precondition is "not probed" when the precondition fails, never a pass.
- **Vendor facts that may change** (a click-path, an error code, an overlap window) are confirmed in the vendor's docs or dashboard at use time.
- **Public repo.** Tracked text names vendors and environments by role. Never an account, client, endpoint, configuration or price identifier, an endpoint URL, a key prefix beyond the generic test/live concept, or which setting is wrong today. Findings from a run go to the private docs only.

## 4. The per-platform template

Every reference file has the same six parts, so a later slice only adds a file:

1. **What must differ between environments**
2. **Where the code reads it** (names and files, confirmed at use time)
3. **Dashboard steps** (by area name; the user performs them)
4. **Probes**, each with who runs it, what it returns when the setting is wrong, and its preconditions
5. **Gotchas**, each grounded in a repo file
6. **Drift checks** (T- rows, in the `env-drift-audit` §7 column format)

A platform file may add a tiers section and an order-against-the-deploy section when the protocol's tables need a platform reading.

## 5. Platform index

Until a family is covered, its drift checks are **"not audited"**. Each later slice starts by confirming its services are live (a code path that runs, and the names set on Vercel) and drops any that are not. It adds one file and one row here and edits no other family's file; a correction to §1–§4 gets its own SA pass.

| Family | Reference |
|---|---|
| Stripe (platform and Connect) | [stripe.md](stripe.md) |
| Email: Resend, SMTP, the Gmail system sender | [email.md](email.md) |
| Google Cloud: sign-in, the plugin OAuth client, Places, Custom Search | [google.md](google.md) |
| LLM providers | not covered yet (DO-6d) |
| Domains, registrar and DNS | not covered yet (DO-6e) |
| Queues, AWS and small API-key providers | not covered yet (DO-6f) |
| Messaging apps (Meta, Slack) | not covered yet (DO-6g) |
| Plugin OAuth apps | not covered yet (DO-6h) |

## 6. Checklist

- [ ] `env-change-protocol` followed for the change; this skill only adds the platform part
- [ ] Names taken from the catalogue at `origin/main`, never searched for in code
- [ ] Every dashboard step done by the user, reported as presence, mode, status and time; no value in chat or a file
- [ ] Mode and account recorded per environment by role, in the private inventory only
- [ ] The probe goes through the deployed surface, can fail, and moves no money; a failed precondition is "not probed"
- [ ] Old credential revoked only after the new one's deploy is Ready and probed; overlap checked in vendor docs
- [ ] No vendor identifier, endpoint URL, domain or open weakness in tracked text
