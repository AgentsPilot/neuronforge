# Requirement: DevOps (DO) Agent

> **Last Updated**: 2026-10-31

**Created by:** BA
**Date:** 2026-10-30
**Status:** Draft

## Overview

The user does a lot of environment work: GitHub repo and org settings, Supabase projects, Vercel projects, and the Claude Code harness. No agent owns it today, and the know-how lives only in the user's private session memory. This requirement adds a **DevOps (DO)** agent that owns the configured state of everything outside application code. It also adds a set of skills that hold the environment knowledge, so the main session can use them as well as the agent. This is a team and tooling change. It adds no application code.

---

## Table of Contents

- [0. Status](#0-status)
- [1. Background and Findings](#1-background-and-findings)
- [2. User Stories](#2-user-stories)
- [3. Decided Design](#3-decided-design)
- [4. DO-1 Functional Requirements](#4-do-1-functional-requirements)
- [5. Later Slices (DO-2 to DO-5)](#5-later-slices-do-2-to-do-5)
- [DO-2 Specification — supabase-ops skill](#do-2-specification--supabase-ops-skill)
- [DO-3 Specification — vercel-ops skill](#do-3-specification--vercel-ops-skill)
- [DO-4 Specification — github-ops skill](#do-4-specification--github-ops-skill)
- [DO-5 Specification — claude-harness-ops and env-drift-audit skills](#do-5-specification--claude-harness-ops-and-env-drift-audit-skills)
- [SA Review — DO-5](#sa-review--do-5)
- [SA Review — DO-5b (short pass)](#sa-review--do-5b-short-pass)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
- [7. Acceptance Criteria (DO-1)](#7-acceptance-criteria-do-1)
- [8. Out of Scope / Future Roadmap](#8-out-of-scope--future-roadmap)
- [9. Open Questions](#9-open-questions)
- [10. Notes on Integration Points](#10-notes-on-integration-points)
- [Change History](#change-history)
- [SA Review — DO-2](#sa-review--do-2)
- [DO-2 implementation notes](#do-2-implementation-notes)
- [SA Code Review — DO-2](#sa-code-review--do-2)
- [SA Code Review — DO-3](#sa-code-review--do-3)

---

## 0. Status

| Slice | Scope | Status |
|---|---|---|
| DO-1 | Agent definition, `env-change-protocol` skill, CLAUDE.md row, TL handshake rows, RM boundary note, SA plan-review note | ✅ MERGED 2026-10-30 (PR #578). Fresh-session tool-list smoke test still owed. See [DO-1 implementation notes](#do-1-implementation-notes) |
| DO-2 | `supabase-ops` skill | ✅ MERGED 2026-10-30 (PR #579). See [DO-2 implementation notes](#do-2-implementation-notes). Follow-ups FU-1 to FU-3 logged in [SA Review — DO-2](#sa-review--do-2): FU-1 ✅ MERGED 2026-10-30 (PR #584); FU-2 ⬜ (next migration that ships a checker); FU-3 ⬜ (DO-5) |
| DO-3 | `vercel-ops` skill | ✅ MERGED 2026-10-31 (PR #589). See [DO-3 Specification](#do-3-specification--vercel-ops-skill), [SA Review — DO-3](#sa-review--do-3), [DO-3 implementation notes](#do-3-implementation-notes) and [QA Report — DO-3](#qa-report--do-3). Follow-up FU-4 ⬜ (DO-5) |
| DO-4 | `github-ops` skill | ✅ MERGED 2026-10-31 (PR #590). See [QA Report — DO-4](#qa-report--do-4), [DO-4 Specification](#do-4-specification--github-ops-skill), [SA Review — DO-4](#sa-review--do-4), [DO-4 implementation notes](#do-4-implementation-notes) and [SA Code Review — DO-4](#sa-code-review--do-4) |
| DO-5 | `claude-harness-ops` skill + `env-drift-audit` skill | 🟡 SA APPROVED WITH CHANGES 2026-10-31, split into **DO-5a** (`claude-harness-ops`, FU-3 plan, FU-4 and ClickUp closed) ✅ DO-5a MERGED 2026-10-31 (PR #592; see [DO-5a implementation notes](#do-5a-implementation-notes), [SA Code Review — DO-5a](#sa-code-review--do-5a) and [QA Report — DO-5a](#qa-report--do-5a); the `tools:` swap is not in it, so it is FU-3b), and **DO-5b** (`env-drift-audit`) 🟡 spec re-checked by BA 2026-10-31 (FU-5: H10, the Q-D5-9 note, the H3 boundary, the check list §D5.2.2(g), Q-D5b-1 to Q-D5b-4); SA short pass 2026-10-31 **APPROVED WITH CHANGES** (see [SA Review — DO-5b (short pass)](#sa-review--do-5b-short-pass)); DO-5b built (see [DO-5b implementation notes](#do-5b-implementation-notes)); **SA code review 2026-10-31: Code Approved for QA**, with four small skill fixes (repo reads use `origin/main:./<path>` from the worktree root; `devops.md` unchanged beyond the pointer line); **QA 2026-10-31: QA passed**, with two small non-blocking items, both fixed (see [QA Report — DO-5b](#qa-report--do-5b)); **user approved the diff 2026-11-01**, PR open with auto-merge. The FU-3 `tools:` swap lands only after the user's read-only server passes the H1 probe; otherwise it is follow-up FU-3b. Q-D5-2 (untrack the local settings file): ✅ PR #593 MERGED 2026-10-31; `origin/main` shows the file untracked and the `.gitignore` line. See [DO-5 Specification](#do-5-specification--claude-harness-ops-and-env-drift-audit-skills) and [SA Review — DO-5](#sa-review--do-5) |
| DO-6 | `third-party-ops` skill — Stripe, Resend/SMTP, Google Cloud, LLM providers, QStash, AWS, messaging, DNS | 🟡 Inventory pass 2026-11-01; spec by BA, split into DO-6a..6h (see [DO-6 Specification](#do-6-specification--third-party-ops-skill)); **SA 2026-11-01: APPROVED WITH CHANGES** (7 required changes, see [SA Review — DO-6 (spec)](#sa-review--do-6-spec)); user decided Q-D6-1..3 (§D6.6). DO-6a built (see [DO-6a implementation notes](#do-6a-implementation-notes)); **SA code review 2026-11-01: Code Approved for QA**, 3 small SA fixes, one condition before commit (§D6.6 wording, see [SA Code Review — DO-6a](#sa-code-review--do-6a)). **QA 2026-11-01: QA passed with one Medium item to fix before commit** (see [QA Report — DO-6a](#qa-report--do-6a)): every §D6.4 criterion and SA change 1(f) pass, and §D6.6 already carries the corrected wording, but SA Code Review — DO-6a quotes the removed current-state phrases verbatim, so they were still in tracked text. **Main session 2026-11-01: quotes scrubbed** (SA review, QA report, §D6.5 Q-D6-3 "Suggested" reworded to "would use"); **user approved the diff 2026-11-01**; RM commit + PR. **DO-6a MERGED (#604). DO-6b (email) spec + SA short pass approved with changes; built 2026-11-01; SA code review approved, QA passed; main session fixed the QA Medium item (contact-route wording) and Lows 1, 3, 4; user approved the diff 2026-11-01. DO-6b MERGED (#605). DO-6c (Google) spec + SA short pass approved with changes; built 2026-11-02 (see [DO-6c implementation notes](#do-6c-implementation-notes)); SA code review approved, QA passed; main session fixed QA Lows 1 and 2; user approved the diff 2026-11-02. DO-6c MERGED (#608). DO-6d (LLM providers) spec + SA short pass approved with changes; built 2026-11-02 (see [DO-6d implementation notes](#do-6d-implementation-notes)); SA code review approved, QA passed (20 checks, 3 Lows); main session fixed Low 1; user approved the diff 2026-11-02; commit + PR.** |

This section is the single source of truth for slice status. Update it at every stage: scoping, SA review, PR, merge.

---

## 1. Background and Findings

| Finding | Consequence |
|---|---|
| The agents in `.claude/agents/` (TL, BA, Dev, SA, QA, RM, TS, peer-report-auditor) cover the build cycle and diagnostics. None of them lists the Supabase or Vercel MCP tools. | No agent can read environment state or check a change against it. |
| RM owns branches, commits, PRs and auto-merge. | Nobody owns repo **settings**: branch protection, merge queue, secret scanning, Actions. |
| Nobody owns Vercel config (env vars, crons, domains, deployments) or Supabase project config (migration application, advisors, auth settings, backups). | Post-merge environment steps, such as applying a migration or setting an env var, have no owner and no gate. |
| Environment know-how lives only in the user's private session memory. | The know-how is lost between sessions and cannot be reviewed. |

**Decided with the user. Not re-opened here.** Sections 3 to 5 record those decisions.

---

## 2. User Stories

- As the **user**, I want one agent to own environment and repo-settings work, so that it stops falling between RM and Dev.
- As the **user**, I want every production or irreversible change prepared for me as one exact step, then verified afterwards, so that I stay the only one who executes it.
- As the **TL**, I want a rule for when DO is triggered, so that a requirement or workplan with environment impact gets an environment change plan, and a post-merge environment step gets a gate.
- As the **main session**, I want the environment knowledge in skills, so that I can guide the user through dashboard work step by step. A background subagent cannot hold that dialogue.
- As a **reviewer (SA)**, I want risky environment plans to come to me before they are applied.

---

## 3. Decided Design

### 3.1 Role

DO owns the **configured state of everything outside app code, on every platform the system needs to operate** (user decision 2026-10-30: "any platform needed to operate the system needs to be included in the DevOps (DO) agent's scope").

| Area | DO owns |
|---|---|
| GitHub | Repo and org settings, branch protection, merge queue, secret scanning, Actions configuration |
| Vercel | Projects, env vars, crons, domains, deployments |
| Supabase | Projects, migration **application**, advisors, auth settings, backups |
| Claude Code harness | `.claude/settings*.json`, permissions, MCP servers, hooks, worktrees |
| Third-party platforms | Account, API key, webhook, test/live mode, domain and sender settings for every external service the code depends on: Stripe (incl. Connect), Resend and SMTP, Google Cloud (OAuth app, APIs, verification), LLM providers, QStash, AWS, WhatsApp and Slack apps, image and FX-rate providers, registrar and DNS |

The table is categories, not a closed list: a platform the code reads env vars for or imports an SDK of is in scope even when unlisted. DO holds tools only for Supabase and Vercel; for every other platform the user operates the dashboard, DO plans from the repo and verifies from the app side.

**Boundaries:**

| Agent | Owns | DO's relation |
|---|---|---|
| RM | Code reaching `main`: branch, commit, PR, auto-merge | DO makes sure environments and repo settings are correct. DO does not commit or open PRs for app work. |
| Dev | Application code, migration **files** | DO never writes application code. DO applies (or has the user apply) the migrations Dev wrote. |
| SA | Architecture and review | SA reviews DO's risky change plans. DO does not make architectural decisions. |

### 3.2 Skills carry the knowledge; the agent does bounded jobs

A subagent runs in the background and cannot hold the step-by-step dialogue that dashboard work needs. So:

- **Skills** hold the procedures and the gotchas. They must be written so the **main session** can follow them directly.
- **The agent** does bounded jobs only:
  - read-only audits and inventories
  - drift reports
  - change plans
  - post-change verification

### 3.3 Permission tiers

| Tier | Examples | Who acts |
|---|---|---|
| **Read** | Advisors, env var **names**, deploy logs, branch protection state, read-only pre-check and post-check SQL | DO, autonomously |
| **Reversible write** | A Preview-only env var, a ClickUp task status | DO plans → the user approves in chat → DO applies → DO verifies |
| **Production or irreversible** | Production DDL, key rotation, branch-protection changes, deleting a project or env var, production env vars | **The user executes.** DO prepares the exact step and verifies afterwards. |

Standing rules:
- DO may run read-only pre-check and post-check SQL itself. It **never applies DDL**.
- DO **never prints or decrypts secret values**.

### 3.4 Public-repo constraint (hard rule)

The repository is public. The agent file, every skill and this requirement must **never** contain:
- project refs or IDs (Supabase, Vercel, GitHub org or app IDs)
- where secrets are stored
- open security weaknesses

These facts are referred to by role, for example "the production Supabase project" or "the Preview environment". The concrete values live in untracked docs and the user's private memory.

### 3.5 Change protocol (core skill `env-change-protocol`)

This protocol comes from a real production outage. A key swap was "verified" against a sibling key, using a probe that could not fail, seconds before the deploy landed. Every environment change follows these steps:

1. **Snapshot the before-state.**
2. **Apply one change**, or have the user apply it.
3. **Wait** for the deploy or apply to report done before testing.
4. **Verify the exact value deployed.** Never verify a sibling created in the same sitting.
5. **Use a probe that fails when the change is wrong.** For example, for a service-role key: read an RLS-enabled table that has zero policies and rows in it. A read of a permissive table proves nothing. Prefer server-side timestamped evidence over "the page loaded".
6. **When a later step misbehaves, re-test the earlier steps.** Do not trust a recorded ✅.
7. **Record** what changed, where, and the evidence.
8. **Pace bulk actions on GitHub.** An account was once suspended by abuse detection after a high volume of PRs and pushes from parallel sessions.

### 3.6 Agent tools

| Tool | Purpose |
|---|---|
| Read, Write, Edit, Glob, Grep | Read config, write change plans and drift reports |
| Bash | `gh`, and the `vercel` CLI once it is installed |
| Supabase MCP tools | Advisors, logs, read-only SQL, migration list |
| Vercel MCP tools | Projects, deployments, env var names, logs |
| ClickUp tools (optional) | Status sync of the DevOps task list |

The MCP tool names must be **listed explicitly** in the agent frontmatter. Two Supabase MCP servers are connected. **SA picks one** (see [Open Questions](#9-open-questions)).

### 3.7 Team integration

- Add DO to the CLAUDE.md **Agent Team** table: initials **DO**, triggered by **User or TL**.
- Add TL handshake rules:
  - A requirement or workplan with environment impact (env var, cron, migration to apply, repo setting, MCP or permission change) → **DO produces the environment change plan**.
  - A risky plan (production or irreversible tier) → **SA reviews it** before it is executed.
  - After a PR merges, any post-merge environment step (migration applied, env var set) is **DO's gate**. DO verifies it per the change protocol.
- Do **not** change the Ship drill numbering.

---

## 4. DO-1 Functional Requirements

**Branch:** `feature/devops-agent-do-1`

| # | Requirement |
|---|---|
| FR-1 | Create `.claude/agents/devops.md` with frontmatter (`name: devops`, a `description` stating role and triggers, an explicit `tools:` list per §3.6). |
| FR-2 | The agent body states: the role and owned areas (§3.1); the boundaries with RM, Dev and SA; the bounded jobs (§3.2); the permission tiers (§3.3); the public-repo rule (§3.4); a pointer to the `env-change-protocol` skill as mandatory for every change; and a **What You Must NOT Do** section. |
| FR-3 | The "What You Must NOT Do" section includes at least: never write application code; never apply DDL; never execute a production or irreversible change; never print or decrypt secret values; never write project refs, IDs, secret locations or open weaknesses into a tracked file; never commit or open PRs for app work (that is RM); never make architectural decisions (that is SA); never bulk-act on GitHub without pacing. |
| FR-4 | Create `.claude/skills/env-change-protocol/SKILL.md` with frontmatter `name` and `description` in the same format as the existing skills (for example `tenant-isolation-guard`). The description must make it fire on any environment or settings change: env var, cron, domain, deploy, migration application, auth setting, branch protection, repo setting, Actions, MCP server, permission or hook change. |
| FR-5 | The skill body holds the eight steps of §3.5, the permission tiers of §3.3, and a short **change record** template (what, where, before-state, evidence, who executed). It is written so the main session can follow it directly. |
| FR-6 | CLAUDE.md: add one row to the Agent Team table (`DevOps \| DO \| User or TL`). Optionally add one pointer line naming the `env-change-protocol` skill for environment changes. Rules and pointers only: no counts, statuses or dates. |
| FR-7 | `team-leader.md`: add the handshake rows of §3.7 to the Handshake Rules table, and add DO to the description line listing the agents TL delegates to. |
| FR-8 | `release-manager.md`: add one line stating the boundary. RM gets code to `main`; repo settings, environment config and post-merge environment steps belong to DO. |

---

## 5. Later Slices (DO-2 to DO-5)

Each later slice gets its own short scoping pass before build. Every skill follows the `env-change-protocol` skill and the public-repo rule.

### DO-2 `supabase-ops` skill ✅

Specified in detail in [DO-2 Specification](#do-2-specification--supabase-ops-skill). Original scope:

How to read and verify Supabase state: advisors, logs, migration list against repo migration files, auth settings, backups. How to prepare a migration for the user to apply (pre-check SQL, the exact apply step, post-check SQL) without DO applying DDL. Must carry the gotcha: **the Supabase SQL editor misreads the word "into" even inside string literals**, so pre-check and post-check SQL must avoid it.

### DO-3 `vercel-ops` skill ✅

Specified in detail in [DO-3 Specification](#do-3-specification--vercel-ops-skill). Original scope:

How to read and change Vercel state: projects, env vars by name and target (Production, Preview, Development), crons, domains, deployments and their logs. How to wait for a deploy to report done before testing, and how to find which deployment holds a given value. Must carry the gotchas: **the Vercel CLI is not installed yet** (MCP first, CLI only once installed), and **docs-only changes skip CI and the Vercel deploy via `.github/ci/non-deploying-change.sh` (exit 0 means skip)**, so a quick green on a docs PR is correct.

### DO-4 `github-ops` skill ✅

Specified in detail in [DO-4 Specification](#do-4-specification--github-ops-skill). Original scope:

How to read and plan changes to repo and org settings: branch protection, required checks, merge queue, auto-merge setting, secret scanning, Actions permissions and workflows. Branch-protection changes are in the user-executes tier. Must carry the gotchas: **auto-merge only when CI is the sole gate**; **pace bulk PR and push activity** (abuse-detection suspension); **never `git stash`** (the stash list is shared across parallel sessions and worktrees).

### DO-5 `claude-harness-ops` skill + `env-drift-audit` skill 🟡

Specified in detail in [DO-5 Specification](#do-5-specification--claude-harness-ops-and-env-drift-audit-skills). Original scope:

`claude-harness-ops`: how to read and change `.claude/settings*.json`, permissions, MCP servers, hooks and worktrees safely. Must carry the gotcha: **worktrees share `node_modules` through a Windows junction, and `git worktree remove --force` deletes the shared contents. Unlink the junction first.**

`env-drift-audit`: a read-only audit that compares the expected state (repo files, recorded change records, untracked private inventory) with the live state across GitHub, Vercel, Supabase and the harness. It outputs a drift report by area and severity, with no secret values and no IDs in any tracked output.

### DO-6 `third-party-ops` skill 🟡

One skill, one section per platform the system needs to operate: Stripe (platform + Connect, test vs live keys, webhook endpoints and signing secrets, API version), Resend and SMTP (sending domain, DNS records for SPF/DKIM, sender addresses, API key per environment), Google Cloud (OAuth consent screen and verification, redirect URIs per environment, enabled APIs), LLM providers (keys and spend limits per environment), QStash, AWS (Textract), WhatsApp and Slack apps, image and FX-rate providers, registrar and DNS. For each: what must differ between environments, where the code reads it (env var names only), the dashboard step the user performs, and an app-side probe that fails when the setting is wrong. Scope it with an inventory pass first (env var prefixes and SDK imports), since the list is expected to grow. May split into smaller slices per platform group if the scoping pass shows it is large.

---

## DO-2 Specification — supabase-ops skill

**By BA — 2026-10-30.** Branch `feature/devops-agent-do-2`. Config/docs-only slice: no application code, no CI job, no CI time.

DO-2 builds on `devops.md` and the `env-change-protocol` skill and **does not repeat them**. The eight steps, the tiers, the approval channel, the order-against-deploy table, the read-only SQL rules (a)–(d), the change-record template and the public-repo rule stay where they are. `supabase-ops` holds only what is specific to Supabase, and points back to those two files for the rest.

### D2.1 Deliverables

| # | File | Action | What |
|---|---|---|---|
| D2-1 | `.claude/skills/supabase-ops/SKILL.md` | New | The skill (§D2.2). Target ≤ ~200 lines. |
| D2-2 | `.claude/skills/supabase-ops/*.md` (reference files) | New, optional | Only if SKILL.md would exceed ~200 lines. Natural split: a checker/pre-check pattern reference and a paste-safety checklist. SKILL.md links to each. |
| D2-3 | `.claude/agents/devops.md` | Edited | One line in `### Supabase (plugin server only)`: "Procedures and gotchas for reading state and preparing migrations: the `supabase-ops` skill." Nothing else in the agent file changes. |
| D2-4 | `CLAUDE.md` | **Not edited** | The Common Gotchas `env-change-protocol` row already routes migration-apply work to the protocol, and the protocol's own description is where users land. CLAUDE.md stays pointer-only; one more row would duplicate the route. |
| D2-5 | This requirement | Edited | Status, implementation notes, reviews. |

### D2.2 What the skill must teach

Each item says what the skill states. The repo evidence each one is grounded in is named so Dev can check it; the skill itself carries the rule, not the history.

**(a) Reading state** (Read tier, plugin server tools from `devops.md` only)

| Topic | The skill states |
|---|---|
| Advisors as a gate | Run `get_advisors` for **both** `security` and `performance` before and after any migration apply, and before calling a new project ready. A finding that is new after the apply and names an object the migration touched is a **stop**: report it, do not close the step. Report counts by severity and lint name. Open findings are open weaknesses: they go to the untracked private docs only, never into a workplan, PR or chat summary that is later pasted into a tracked file. |
| Logs | `query_logs` for counts, status codes and error classes over a stated time window, bracketing the deploy or apply time. Never copy a log line that names a person (rule (c) in `devops.md`). |
| Migration drift | `list_migrations` reads the platform's migration history table. That table records only migrations applied through the CLI or the MCP apply tool. This repo applies by pasting in the SQL editor, so the ledger is **expected to be incomplete** and is never evidence on its own (grounded: `scripts/check-migrations-applied.ts` header, "no migration ledger reachable"). Drift is decided by **catalog evidence**: `to_regclass`, `to_regprocedure`, `pg_attribute`, `pg_constraint`, `pg_policies`, `has_table_privilege`, `has_function_privilege`, `pg_get_functiondef` (hashed with carriage returns stripped). `scripts/check-migrations-applied.ts` sees tables and columns only and needs a service-role env, so it is a main-session tool, not DO's. |
| Repo layout | `supabase/migrations/` is the apply path. File names are `<number>_<slug>.sql`: an eight-digit running number that is reserved before use and is **not** a calendar date; two files can share a number; a letter suffix exists. `supabase/SQL Scripts/` holds rollbacks (`<number>_<slug>_rollback.sql`) and older hand-applied scripts. `supabase/held/` holds reviewed migrations that must **not** be applied yet; they live outside the apply path because `supabase/config.toml` makes a bulk `supabase db push` apply everything in `migrations/` — a "do not apply" comment is not a control. `supabase/seeds/` is test data, never applied to production. Pre-checks and checkers live in `scripts/` as `precheck-*.sql` and `check-*-migration.sql`. Migration text tests live in `supabase/migrations/__tests__/`. The skill states the pattern, never a count. |
| Extensions, edge functions, branches | `list_extensions`, `list_edge_functions` / `get_edge_function` (source in `supabase/functions/`, config in `supabase/config.toml`), `list_branches`. Read only; deploying a function or creating a branch is excluded from DO's tools. |
| What the MCP cannot read | Auth settings (site URL, redirect URLs, providers, email templates and SMTP, JWT expiry, password and sign-up rules), backup and PITR status, network restrictions, API key management, billing. These are a **user dashboard step**: the skill gives the dashboard path, the user reports what it shows, and the record names the environment by role. |

**(b) The migration application flow** (standing user rule)

| # | Step | Who |
|---|---|---|
| 1 | Dev wrote the migration, its rollback, a pre-check and a checker; SA reviewed the DDL. | Dev, SA |
| 2 | **Pre-check:** DO or the main session runs the read-only pre-check itself through `execute_sql` (SELECT-only, read-only wrapper, counts/booleans/catalog facts). Every row `ok`, or stop and apply nothing. The pre-check proves the shape the migration expects (column count, absent names, existing dependencies), so a surprise production shape refuses instead of half-applying. | DO / main session |
| 3 | **Hand over only the migration file** — its repo path and the instruction to paste its full contents in the SQL editor of the named environment (by role) and run it once. Not the pre-check, not the checker. | User executes |
| 4 | Wait for the user to say it ran, and the result shown (success or error text). | User |
| 5 | **Checker:** DO or the main session runs the checker itself and reports each row. Any `FAIL` → the rollback file is pasted by the user **in the same sitting**, then the checker is re-run to prove the rollback. | DO / main session; user for rollback |
| 6 | Advisors re-run (item (a)); change record written per `env-change-protocol`. | DO / main session |

**When**, against merge and deploy (the protocol's table, applied to schema):

- Additive schema the merging code reads (new table, column, function, grant): **before merge**, so the deploy never lands ahead of its schema.
- Destructive or narrowing schema (drop, rename, revoke, tighter constraint) that old code still depends on: **after the deploy that stops using it** is Ready.
- A migration header that says "apply before the merge deploy" or similar is the plan's source of truth; the plan copies it.

**What a good checker proves** — presence **and** behaviour, with rows that can fail:

- Numbered rows with a check name and `ok`/`FAIL`; info-only rows marked as never a gate.
- A policy exists **and** the right role is refused: e.g. `has_table_privilege('anon', '<table>', 'select')` is false, rather than "a policy row exists". Catalog functions only — `SET ROLE` is forbidden by rule (a).
- A function exists **and** its body has the critical clause (`pg_get_functiondef` contains it) **and** grants are exactly as reviewed.
- Exact shape where it matters (column count, types, nullability, defaults), so an extra or missing piece fails.
- A header naming the migration, what to do on `FAIL`, and — when a later migration makes an older checker stale — a note that the older one must not be re-run.

**(c) Writing SQL the user pastes** (migration and rollback files)

- The SQL editor misreads the word **"into"** anywhere in the pasted text — inside string literals and comments too — and fails with an error like relation "a" (or "it") does not exist. Never use that word in a pasted file; in `DO` blocks use a direct boolean test instead of `SELECT … INTO`.
- Keep it boring: ASCII only, no BOM, LF line endings (a per-file `text eol=lf` rule in `.gitattributes`, because Windows checkouts otherwise turn files CRLF); no psql meta-commands (`\i`, `\set`, `\gexec`); one explicit `BEGIN; … COMMIT;`; idempotent guards (`if not exists`, `create or replace`) where the statement allows; post-conditions inside the transaction where useful, so a wrong shape aborts the whole apply.
- These rules are enforced for Dev by the migration text tests; the skill states them so the person preparing the paste can check the file before handing it over.

**(d) Key and credential facts** (generic only)

- Two key families: the legacy JWT pair (anon, service role) and the newer publishable and secret keys. Anon/publishable keys respect RLS; service-role/secret keys bypass it.
- Verify that a deployed service-role credential works with a probe only a BYPASSRLS credential passes: read an RLS-enabled table with **zero policies** and rows in it. Never a permissive table. The probe runs through the deployed surface (protocol step 5); DO never holds, reads or prints a key, and never calls the key-returning MCP tools.
- Rotation is user-executed, production tier. A switch of key family can change the env var **name** the code reads, so the plan greps the code for the old name first.
- Facts about rotation scope (which keys a rotation invalidates) are checked with `search_docs` at use time, not hardcoded in the skill.

**(e) Project lifecycle facts** (generic only)

- Plan tier decides backups and PITR, pausing on inactivity, and how many active projects are allowed. The free tier has no PITR and pauses idle projects. Check current limits with `search_docs` at use time.
- A project's region is fixed at creation and must match the Vercel function region, or every query pays cross-region latency.
- A new project built from a schema baseline inherits the baseline's advisor findings: run advisors as a gate before calling it ready.
- Creating, pausing and restoring projects are excluded from DO's tools: user-executed.

**(f) PostgREST gotchas**

- Naming one non-existent column in `.select()` makes PostgREST reject the **whole** query (42703). The skill **points at** the `business-os-schema-check` skill and does not repeat it.
- UPDATE + `.or()` + `.select()` fails with 42703 in production; use `{ count: 'exact' }` with no `.select()` instead (grounded: `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`). One line, as a gotcha for checkers and probes that go through PostgREST.

### D2.3 Boundaries

| Neighbour | Owns | `supabase-ops` relation |
|---|---|---|
| `env-change-protocol` | The eight steps, tiers, approval, order, SQL rules (a)–(d), record template | Referenced, never repeated |
| `business-os-schema-check` | Verifying column and table names against the live schema; phantom-column shapes | Referenced for (f) and for any "does this column exist" question |
| `supabase:supabase`, `supabase:supabase-postgres-best-practices` (plugin skills) | Generic Supabase and Postgres guidance: RLS design, indexes, migration authoring | Referenced; the skill adds only this repo's operating procedure |
| Dev | Migration, rollback, pre-check and checker **files**; migration text tests | The skill tells DO what a good checker proves so it can reject a weak one in its plan; it never writes them |
| SA | DDL review; review of production-tier plans | Unchanged |

### D2.4 Acceptance criteria (DO-2)

- [ ] `.claude/skills/supabase-ops/SKILL.md` exists; frontmatter has `name: supabase-ops` (matching the folder) and a `description` in the existing skills' format, parsed cleanly by a YAML parser.
- [ ] The description fires on: applying or checking a migration, pre-check/checker, Supabase advisors, Supabase logs, migration drift, Supabase auth or project settings, key verification, project creation/pausing. It says it is used by the main session and DO. It names no project, URL or ID.
- [ ] The skill covers (a)–(f) of §D2.2 and the boundaries of §D2.3, and links to `env-change-protocol` instead of restating the eight steps, tiers or template (QA reads for duplication).
- [ ] SKILL.md is ≤ ~200 lines, or the overflow is in reference files under `.claude/skills/supabase-ops/` that SKILL.md links to.
- [ ] `devops.md` has the one pointer line (D2-3) and no other change.
- [ ] The finding-11 regex from §7 over the added lines of the diff returns zero hits, or each hit is explained in the QA report.
- [ ] No tracked text in the diff contains a project ref or ID, org ID, which project is on which plan, a key prefix, where a secret is stored, or an open advisor finding or other open weakness of the live system. Only generic platform facts. QA reads the diff for this.
- [ ] Every repo path the skill names exists in the worktree; the skill states no file counts.
- [ ] The diff touches only `.claude/skills/supabase-ops/**`, `.claude/agents/devops.md` and this requirement.
- [ ] The read-only wrapper form the skill prescribes for `execute_sql` was tried once at build time and returned rows with `current_setting('transaction_read_only') = 'on'` (Q-D2-1). Evidence in the implementation notes, by role.

### D2.5 Open questions for SA

- [ ] **Q-D2-1: Which read-only wrapper does the skill prescribe for `execute_sql`?** R1(b) asked DO-2 to confirm `begin read only; …; commit;` works through the tool. Risk: the tool may return only the last statement's result (the `commit`), so the select's rows are lost. The repo's checkers start with `SET default_transaction_read_only = on;` instead.
  *Suggested:* Dev tries both once at build with `select current_setting('transaction_read_only')` as the payload; the skill prescribes the first form that returns that row as `on`. If only the `SET` form works, R1(b) is read as satisfied by it.
- [ ] **Q-D2-2: Is the migration ledger ever used as evidence?** It is incomplete by construction in this repo (SQL-editor applies are not recorded).
  *Suggested:* never on its own — catalog evidence decides "applied". No ledger backfill (that is a write and out of DO's tier).
- [ ] **Q-D2-3: The stale apply READMEs.** `supabase/migrations/README.md`, `supabase/migrations/APPLY_MIGRATIONS.md` and `supabase/SQL Scripts/README.md` recommend `supabase db push` / `psql`, which contradicts the paste-and-check flow and the `supabase/held/` rule.
  *Suggested:* out of DO-2's file list. The skill states the flow; a follow-up docs fix replaces those sections with a pointer to the skill.
- [ ] **Q-D2-4: Older workplans say the operator runs the checker.** Going forward DO or the main session runs it.
  *Suggested:* the skill states the new rule; old workplans are not edited.

---

## DO-3 Specification — vercel-ops skill

**By BA — 2026-10-31.** Branch `feature/devops-vercel-ops`. Config/docs-only slice: no application code, no CI job, no CI time.

DO-3 builds on `devops.md` and the `env-change-protocol` skill and **does not repeat them**. The eight steps, the tiers, the approval channel, the order-against-deploy table, the change-record template, the public-repo rule, the Vercel tool list, the `decrypt` ban and the forbidden Bash families stay where they are. `vercel-ops` holds only what is specific to Vercel, and points back to those two files for the rest. It should read like `supabase-ops`: a pointer table first, numbered sections, a closing checklist.

### D3.1 Deliverables

| # | File | Action | What |
|---|---|---|---|
| D3-1 | `.claude/skills/vercel-ops/SKILL.md` | New | The skill (§D3.2). Target ≤ ~200 lines. |
| D3-2 | `.claude/skills/vercel-ops/*.md` (reference files) | New, optional | Only if SKILL.md would exceed ~200 lines. Natural split: a "which deployment holds this value" walkthrough, and the dashboard-only settings table. SKILL.md links to each. |
| D3-3 | `.claude/agents/devops.md` | Edited | One line in `### Vercel`: "Procedures and gotchas for reading state, waiting for a deploy and verifying a value: the `vercel-ops` skill." Nothing else in the agent file changes (unless SA rules otherwise on Q-D3-1). |
| D3-4 | `CLAUDE.md` | **Not edited** | Same reasoning as D2-4: the Common Gotchas `env-change-protocol` row already routes env-var, cron, domain and deploy work to the protocol, which is where users land. One more row would duplicate the route. |
| D3-5 | This requirement | Edited | Status, implementation notes, reviews. |

### D3.2 What the skill must teach

Each item says what the skill states. The repo evidence each one is grounded in is named so Dev can check it; the skill itself carries the rule, not the history.

**(a) Reading state** (Read tier, the Vercel tools in `devops.md` only)

| Topic | The skill states |
|---|---|
| Scope first | Resolve the team and the project with `list_teams` / `list_projects` at the start of each job, and reuse that scope for every later call. Never guess a project; if two could match, ask. IDs and slugs are held only in the call, never written into a file, a report or a chat summary. |
| More than one project | The team has **more than one Vercel project** (the web app project and a marketing-site project, by role; resolve the current list with `list_projects`, and report any project with no known role as "an unrecognised project"). Each project holds its own env vars, so a value one project uses may also exist in another. Any "where does this value live" or "is this var set" answer covers **every** project, named **by role** ("the web app project", "the marketing-site project"). A check of one project is reported as one project, not as "Vercel". |
| Projects | `get_project` for framework, Node version, root directory and the linked Git repo — facts only. Settings it does not show are dashboard-only (item (e)). |
| Deployments | `list_deployments` (filter by project, `target`, `state`, `sha`, `branch`, `since`) and `get_deployment` for state, target (production or preview), the **commit SHA it was built from**, and its created and ready times. `list_deployment_events` for the build log of one deployment — read for the error class and the failing step, never copied whole (build logs can echo env var names and paths). |
| Runtime logs and errors | `get_runtime_errors` first for a production problem, then `get_runtime_logs`. Prefer `group_by` (path, level, source, deployment) for counts, and scope to one deployment and a stated window that brackets the change. Report counts, status codes and error classes. Never copy a log line that names a person (rule (c) in `devops.md`). Log retention is plan-limited: an empty window older than retention proves nothing. |
| Env vars | `filter_project_envs` for **names, targets (Production, Preview, Development) and Git-branch scope only**. A Preview var can be scoped to one Git branch (`gitBranch`), so "set on Preview" and "set for this branch's preview" are different facts. Never pass `decrypt`. If the response carries a value field for any variable, it is not read, copied or summarised (see Q-D3-2). The value itself is a user dashboard step. |
| Domains | `list_domains`, `get_domain`, `get_domain_config`, `list_project_domains`, `get_project_domain` for which project and target a domain points at, and whether its DNS config is valid. Facts only; domain and DNS writes are excluded. |
| Crons | The source of truth is `vercel.json` `crons` in the repo (path + schedule). Vercel runs crons on **production deployments only**: a Preview never fires them, so a cron change is verified against production. Confirm a cron ran by reading runtime logs for its path in a window after its schedule time (`group_by` path, status), not by its presence in the file. There is no cron tool; whether crons are enabled for a project is dashboard-only. |
| Docs | `search_vercel_documentation` for any platform fact that may change (limits, retention, cron behaviour, build-time env handling). The skill does not hardcode such facts beyond what is stated here. |

**(b) Which deployment holds this value** (the core procedure)

The skill states the rule and the steps, grounded in the incident behind `env-change-protocol` (a check that raced the deploy, tested a sibling key, and used a probe that could not fail):

- An env var change applies **only to deployments built after the save**. A running deployment keeps the value it was built with. Saving a variable is not a deploy.
- `NEXT_PUBLIC_*` values are **inlined into the client bundle at build time** (grounded: "the value is fixed at build time: setting or changing it on Vercel needs a redeploy" in `docs/feature_flags.md`; the readers in `lib/utils/featureFlags.ts` use literal `process.env.NEXT_PUBLIC_*` reads, which is what lets Next.js inline them). A change to one needs a rebuild of the deployment that serves it; a server-only var also needs a new deployment to be picked up.
- Steps, each with its evidence:
  1. Record the time of the save (the user reports it, or the dashboard shows it), the project by role and the target.
  2. Trigger or wait for a new deployment of that project and target (a push, or a dashboard "Redeploy" by the user — a user step).
  3. Find the **first deployment of that project and target created after the save time** (`list_deployments` with `since`, `target`, and the expected `sha` when it is a code deploy).
  4. Wait for that deployment to report READY (item (c)).
  5. Probe **that** deployment — its own URL or a server-side, timestamped output that names it — never the alias's previous deployment, never another project, never the other target. The probe is chosen per `env-change-protocol` step 5; the skill does not restate it.
- For a production alias: confirm the production domain now points at the deployment from step 3 before probing through the domain. `get_project_domain` shows a domain's settings, not which deployment serves it; read the step-3 deployment with `get_deployment` and check that its aliases include the production domain. A READY production deployment does **not** always receive the domain (after an Instant Rollback, or when production domains are not auto-assigned); see SA Review — DO-3, V3.

**(c) Waiting for a deploy to report done**

- Poll `get_deployment` (or `list_deployments` filtered by `sha` and `target`) until the state is READY **for the expected SHA**. A READY deployment of a different SHA is not the one being waited for.
- ERROR: read `list_deployment_events` for the failing step and error class; report it and stop — nothing is verified. CANCELED or BLOCKED: report it; never treat it as done.
- Docs-only changes are skipped by the Ignored Build Step: `vercel.json` `ignoreCommand` runs `.github/ci/non-deploying-change.sh`, where **exit 0 means SKIP**. It skips `docs/**`, root-level `*.md`, `scripts/**` (minus the Jest suites and the CI gate scripts it carves back out) and `.claude/**`. Nested `.md` is **not** skipped: it is production code, because the V6 pipeline reads prompts from disk. Renames are counted on both sides (`--no-renames`). So on a docs-only PR, "no new deployment" or a canceled/skipped build is the **expected** outcome, not a failure, and a quick green check is correct. An ignored build is recorded as a **CANCELED** deployment: it is the expected outcome only when its build events show the script's `SKIP:` line; any other CANCELED is the stop case in the bullet above.
- The consequence for verification: an env var saved while the only change merging is docs-only gets **no** new deployment from that merge. The plan must name the deployment that will carry the change (a code push or a user "Redeploy"), not assume the merge produces one.
- `vercel.json` disables deployments for merge-queue branches (`gh-readonly-queue/**`), so a queue run is never a deployment to wait for.

**(d) The Vercel CLI**

- The Vercel CLI is **not installed**. MCP first, always. The MCP tool descriptions name CLI fallbacks; they are not used while the CLI is absent.
- Installing it is out of DO-3 (§8). If it is installed later: read commands only, and **`vercel env pull` is forbidden outright** — it writes decrypted values to disk (SA finding 1; the Vercel CLI row in `devops.md`). The skill points to that row and does not restate the family list.

**(e) Dashboard-only settings** — a user step, by area name only

A table like `supabase-ops` §2. The user opens the area in the project (named by role) or team settings, reports what it shows, and the record names the environment by role. If the dashboard has moved, find the current path with `search_vercel_documentation`.

| Setting | Dashboard area |
|---|---|
| Deployment protection (Vercel Authentication, password, bypass) | Project → Settings → Deployment Protection |
| Production branch, Git connection, ignored build step override | Project → Settings → Git |
| Build and development settings (framework, commands, Node version, root directory) | Project → Settings → Build and Deployment |
| Function region, max duration, memory | Project → Settings → Functions |
| Cron jobs enabled/disabled, run history | Project → Settings → Cron Jobs |
| Env var **values** | Project → Settings → Environment Variables |
| Team members and roles | Team → Settings → Members |
| Plan, usage, billing | Team → Settings → Billing |
| Firewall rules, attack challenge mode | Project → Firewall |
| Log drains | Team → Settings → Drains |

The function region should match the Supabase project's region (`supabase-ops` §6); the skill points there and does not restate it.

**(f) What the skill does not change**

- Every env var write, redeploy, promote, rollback, domain or cron change is planned per `env-change-protocol` and executed by the user (production) or by the main session with the user (reversible, Preview only). DO's Vercel tools stay read-only in DO-3 unless SA rules otherwise on Q-D3-1.
- A cron added or changed in `vercel.json` is a code change (Dev, through a PR); the skill covers only how to verify it ran after the production deploy.

### D3.3 Boundaries

| Neighbour | Owns | `vercel-ops` relation |
|---|---|---|
| `env-change-protocol` | The eight steps, tiers, approval, order against deploy, record template, public-repo rule | Referenced, never repeated |
| `devops.md` | DO's Vercel tool list, the `decrypt` ban, the forbidden Bash/CLI families, where plans go | Referenced; one pointer line added |
| `supabase-ops` | Supabase state, the migration apply flow, region note | Referenced for the region match and for any value that lives in a Supabase project |
| `vercel:*` plugin skills (`vercel:env-vars`, `vercel:deployments-cicd`, `vercel:vercel-cli`) | Generic Vercel guidance | Referenced for generic facts; the skill adds only this repo's operating procedure. Where a plugin skill suggests a write or `vercel env pull`, this repo's rules win |
| `.github/ci/non-deploying-change.sh` | What counts as non-deploying | Referenced as the source of truth; the skill does not copy its path list beyond the summary in §D3.2(c) |
| Dev | `vercel.json` (crons, `ignoreCommand`, `git.deploymentEnabled`, rewrites) and app code reading env vars | DO reads them; never edits them |
| SA | Review of production-tier plans | Unchanged |

### D3.4 Acceptance criteria (DO-3)

- [ ] `.claude/skills/vercel-ops/SKILL.md` exists; frontmatter has `name: vercel-ops` (matching the folder) and a `description` in the existing skills' format, parsed cleanly by a YAML parser.
- [ ] The description fires on: checking or setting a Vercel env var, which deployment has a value, waiting for a deploy, a deploy that failed or was skipped, build logs, runtime logs or errors, a cron that did not run, a domain, deployment protection or another Vercel project setting. It says it is used by the main session and DO. It names no project, team, URL or ID.
- [ ] The skill covers (a)–(f) of §D3.2 and the boundaries of §D3.3, and links to `env-change-protocol` instead of restating the eight steps, tiers, template or probe. QA greps the new files for `Snapshot the before-state`, `| **Read** |` and `zero policies`: 0 hits expected.
- [ ] The skill states: changes apply only to deployments built after the save; `NEXT_PUBLIC_*` is baked at build; the probe targets the first deployment created after the save, once READY, for the expected SHA.
- [ ] The skill states that more than one Vercel project exists and every "where does this live" answer covers each, by role.
- [ ] The skill states the CLI is not installed, MCP first, and `vercel env pull` is forbidden outright (by pointer to `devops.md`).
- [ ] SKILL.md is ≤ ~200 lines, or the overflow is in reference files under `.claude/skills/vercel-ops/` that SKILL.md links to.
- [ ] `devops.md` has the one pointer line (D3-3) and no other change (unless Q-D3-1 is ruled otherwise, in which case SA states the allowed change).
- [ ] The finding-11 regex from §7 over the added lines of the diff returns zero hits, or each hit is explained in the QA report.
- [ ] No tracked text in the diff contains a project or team ID, a project or team slug, a deployment URL, a key prefix, an env var value, where a secret is stored, or an open weakness of the live system. Projects named by role only. QA reads the diff for this.
- [ ] Every repo path the skill names exists in the worktree; the skill states no counts (crons, projects, env vars).
- [ ] The diff touches only `.claude/skills/vercel-ops/**`, `.claude/agents/devops.md` and this requirement.

### D3.5 Open questions for SA

- [ ] **Q-D3-1: Does DO-3 add a Preview-only env-var write tool (R5)?** R5 allowed DO-3 to propose `create_project_env` / `edit_project_env` with a hard rule that the target is exactly `preview`.
  *Suggested:* **no — keep DO's Vercel tools read-only in DO-3.** The tools take the target as a parameter, so the tool list cannot enforce "Preview only"; the rule would rest on prose alone, which is the gap R5 named. A Preview var can also be branch-scoped, so a mis-set `gitBranch` is a second unenforced field. The main session applies reversible writes with the user in the loop, as today; DO plans and verifies. Revisit only if a read-only-style enforcement appears (e.g. a scoped token or a harness permission rule that matches the target argument) — log it for DO-5 next to FU-3.
- [ ] **Q-D3-2: Can `filter_project_envs` return a value without `decrypt`?** The tool's own description says `decrypt` "requests decrypted values"; it does not say what the response holds for a plain-type (non-sensitive) variable.
  *Suggested:* Dev checks the response **shape** once at build time — field names only, reporting whether a value-bearing field is present and for which variable types, never its contents — and cites it by role in the implementation notes. Whatever the result, the skill says any value field in a list response is never read, copied or summarised.
- [ ] **Q-D3-3: Is confirming a cron ran a Read-tier job DO may run on its own?** It uses `get_runtime_logs` on production.
  *Suggested:* yes — counts by path and status in a stated window, no log lines copied (rule (c)).
- [ ] **Q-D3-4: Does the skill name the marketing-site project's role in more detail** (what it holds, which values it shares with the web app)?
  *Suggested:* only that it exists and holds its own Supabase configuration. Which variables it holds is an inventory fact for the untracked private docs and DO-5's `env-drift-audit`, not tracked text.

---

## DO-4 Specification — github-ops skill

**By BA — 2026-10-31.** Branch `feature/devops-github-ops`. Config/docs-only slice: no application code, no CI job, no CI time.

DO-4 builds on `devops.md` and the `env-change-protocol` skill and **does not repeat them**. The eight steps (pacing is step 8), the tiers, the approval channel, the order-against-deploy table, the change-record template, the public-repo rule, the Bash/`gh` allowed list and the forbidden families stay where they are. RM's procedure for getting code to `main` (branch, commit, push, PR, `gh pr merge --auto --merge`, the merge queue, the "Auto merge is not allowed" fallback, conflict handling) stays in `release-manager.md`. `github-ops` holds only what is specific to GitHub settings, Actions and workflow runs, and how to read and verify them, and points back to those files for the rest. It should read like `supabase-ops` and `vercel-ops`: a pointer table first, numbered sections, a closing checklist.

### D4.1 Deliverables

| # | File | Action | What |
|---|---|---|---|
| D4-1 | `.claude/skills/github-ops/SKILL.md` | New | The skill (§D4.2). Target ≤ ~200 lines. |
| D4-2 | `.claude/skills/github-ops/*.md` (reference files) | New, optional | Only if SKILL.md would exceed ~200 lines. Natural split: a read-commands reference (each read with its named-field `--json` / `--jq` selector, field names checked at build, §D4.2(h)) and the dashboard-only settings table. SKILL.md links to each. |
| D4-3 | `.claude/agents/devops.md` | Edited | One line in `### Bash and gh`: "Procedures and gotchas for reading repo settings, branch protection, rulesets, the merge queue, Actions and workflow runs: the `github-ops` skill." Nothing else changes, unless SA rules otherwise on Q-D4-3, Q-D4-5 or Q-D4-6. |
| D4-4 | `.claude/agents/release-manager.md` | **Not edited**, unless SA rules otherwise on Q-D4-7 | RM's merge procedure is RM's. The stacked-PR rule (§D4.2(d)) is the one candidate pointer line. |
| D4-5 | `CLAUDE.md` | **Not edited** | Same reasoning as D2-4 and D3-4: the Common Gotchas `env-change-protocol` row already routes "change branch protection or another repo setting, change Actions" to the protocol. Git Conventions and the Ship drill are unchanged. |
| D4-6 | This requirement | Edited | Status, implementation notes, reviews. |

### D4.2 What the skill must teach

Each item says what the skill states. The repo evidence each one is grounded in is named so Dev can check it; the skill itself carries the rule, not the history.

**(a) Reading state** (Read tier, the allowed `gh` and `git` forms in `devops.md` only)

| Topic | The skill states |
|---|---|
| Scope | Run from a checkout of this repo. `gh` fills `{owner}` and `{repo}` in a `gh api` path from the checkout; use those placeholders in every path, so no owner or org name is typed, logged or written. An owner, org, app or installation ID never goes into a file, a report or a chat summary. |
| Named fields only (hard rule) | Several GitHub read responses carry actor logins (owner accounts included), team and app IDs, ruleset bypass actors, or values. Select named fields on **every** read: `--jq '<selector>'` on `gh api`, `--json <fields>` on `gh pr|run|repo view` and the list commands. Never print a whole response. `--jq` and `--json` filter output only; they are not field flags and do not turn the call into a POST. Grounded in the DO-3 ruling (SA Review — DO-3, Q-D3-2) that a call's full response reaches the session context and the local transcript, so "I read it but did not copy it" is not a control. |
| Repo settings | `gh api repos/{owner}/{repo} --jq …` for: Allow auto-merge, Automatically delete head branches, which merge methods are allowed (merge commit, squash, rebase), the default branch and visibility. `gh repo view --json …` covers all of these except Allow auto-merge, for which it has no field. The secret scanning and push protection states are under `security_and_analysis` in the same `gh api` response, which GitHub returns only to a caller with admin rights: an absent object is "not read", never "off". Field names checked at build (§D4.2(h)). *(SA-corrected.)* |
| Branch protection **and** rulesets | Read **both** every time (Q-D4-1): the classic protection of `main` (`gh api repos/{owner}/{repo}/branches/main/protection --jq …`) and rulesets, through `gh api` only: `repos/{owner}/{repo}/rulesets --jq …` and the effective rules for `main`, `repos/{owner}/{repo}/rules/branches/main --jq …` (repo and org rulesets). `gh ruleset list` and `gh ruleset view` have no `--json` and print ruleset IDs, the source owner and bypass details, so they are not used. In the classic response, select required checks by `context` only, never with their app ID. Report: the required status check names, whether branches must be up to date (strict), whether rules apply to admins, the required review count, linear history, whether force-push and deletion are allowed, and whether a merge queue is required (a ruleset shows it as a `merge_queue` rule; the classic response has no merge-queue field, so for a classic rule the evidence is recent `merge_group` runs, `gh run list --event merge_group --json …`, plus the dashboard). An error from either read (no admin rights, 404) is "not read", never "not protected". Actor lists (users, teams, apps, bypass actors) are reported as a count only, never by login or ID. *(SA-corrected.)* |
| Required checks | **Read, never assumed.** The current required list comes from the read above, at the time of the job. The skill names no required check and no count: the list changes, and CLAUDE.md keeps counts and statuses out of standing text. `gh pr checks <n> --required` shows a PR's required checks only. |
| Actions | `gh api repos/{owner}/{repo}/actions/permissions --jq …` and `…/actions/permissions/workflow --jq …` for which actions are allowed, the default `GITHUB_TOKEN` permission, and whether Actions may approve PRs. `gh workflow list --json …` for what exists, and the file in `.github/workflows/` for its definition (`gh workflow view` has no `--json`; SA-corrected); `gh run list|view --json …` for status, conclusion, event, head SHA and jobs. |
| Secrets and variables | `gh secret list`: names and updated time only. `gh variable list` **prints values by default**, so the skill prescribes `gh variable list --json name,updatedAt` (Q-D4-5). Repo, environment and org scopes follow the same rule. A value is never read, by DO or by the main session. |
| Workflow run logs | `gh run view <id> --json jobs` first, for the failing job and step. A log is read only through a narrow filter, and only its error class is reported (Q-D4-3). Actions masks registered secrets only: a value printed some other way (a variable, a test fixture, PII in test data) shows in clear in the log of a public repo. |
| Security alerts | The secret scanning alerts endpoints return the detected secret **in clear**: never called, by any route. Dependabot and code scanning alerts are open weaknesses (Q-D4-4). |
| Platform facts | No GitHub documentation tool is in DO's list. A fact that may change (an endpoint, a field, a setting's behaviour) is checked at use time against `gh <command> --help`, and the skill does not hardcode it beyond what it states. |

**(b) When a check actually protects `main`** (the core procedure; a read-only audit DO can run on its own)

A check protects `main` only when every one of these holds. DO reads the required list (item (a)) and the workflow files, and reports each failure as drift, by check name. Check names are not secret: they are in the public workflow files.

1. **It is required.** A red check that is not required never blocks a merge. Two PRs, each green on its own base, can break `main` together (a semantic merge conflict). The merge queue re-tests each PR on top of the latest `main`, but it waits only for **required** checks.
2. **Its name equals a job `name:` exactly.** Renaming a required job breaks the gate unless the protection is updated in the same change (grounded: the verdict-job header of `.github/workflows/tests.yml`).
3. **Its workflow triggers on `pull_request` and on `merge_group`.** Without `merge_group` the check never reports on the queue's `gh-readonly-queue/main/…` commit, and every queued PR times out (grounded: the trigger comment on every required workflow in `.github/workflows/`, and `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md`).
4. **No `paths:` or `paths-ignore:` filter on those triggers.** A path-filtered required workflow never reports on a PR it filters out, so the merge waits forever, and `merge_group` does not support `paths:`. The skip is decided **inside** the job by `.github/ci/non-deploying-change.sh` (or `.github/ci/jest-gate-scope.sh` for the Jest gate), and the job still reports (grounded: the "NO `paths:` FILTER, ON PURPOSE" headers). `plugin-tests.yml` uses `paths:` and has no `merge_group` trigger: it is not required, and cannot become required as written.
5. **It cannot be skipped into a pass.** GitHub counts a SKIPPED required check as passing. A matrix leg, a job with a skippable job-level `if:`, or a job with `needs:` and no `if: always()` (it is skipped when a job it needs fails) is never required; a matrix gates through one verdict job with `if: always()` (grounded: `.github/workflows/tests.yml` header and `gate` job).
6. **It reports on every PR.** The Vercel deployment status is never made required: `vercel.json` disables deployments for the queue's `gh-readonly-queue/**` branches, so it never reports on a queue commit and every queued PR would time out; docs-only changes also skip the build (`vercel-ops` §5), so docs-only PRs would become unmergeable (SA-corrected). The same goes for any check that does not report on every PR.
7. **Which checks are required is SA's call, not DO's.** DO reports a guarding workflow that is not required, or a required name with no matching job, as drift. It never decides the fix.

Order against the merge, for a change to the required set (the protocol's `When` field, applied to GitHub):

- **Adding a required check:** the workflow change merges first, and the check reports once on a real PR; the setting is changed after. The other order stalls every PR and the queue.
- **Removing or renaming a required check:** the setting changes first (or in the same sitting as the merge), then the workflow change merges. The other order leaves every PR waiting for a name that never reports.

**(c) Merge queue and auto-merge** (facts for planning and verification; the procedure is RM's)

- `main` has a merge queue. `gh pr merge <n> --auto --merge` on a queue-protected branch **enqueues** the PR, and `gh` says the merge strategy is set by the merge queue. Merge commit only, never squash or rebase. The procedure is in `release-manager.md` § Merging the PR; the skill points there.
- **Allow auto-merge** is a repo setting DO owns. When it is off, `--auto` fails with "Auto merge is not allowed". Reading it: item (a). Turning it on: production tier, the user executes.
- **Auto-merge only when CI is the sole remaining gate.** When a DO plan has a step that must land or be checked before the merge (a migration apply, a setting, a user demo or live check), the plan says "do not put the PR on auto-merge until step N is verified". The standing preference itself is in `team-leader.md`; the skill points there.
- Queue runs use `gh-readonly-queue/main/pr-<n>-<sha>` branches and the `merge_group` event. Vercel does not deploy them (`vercel-ops` §5). A failed queue run removes the PR from the queue; the PR shows why.
- **Verifying a PR landed on `main`:** `gh pr view <n> --json state,baseRefName,mergeCommit,mergedAt` shows MERGED **with base `main`**, and the merge commit is contained in `main`: `gh api repos/{owner}/{repo}/compare/main...<sha> --jq .status` returns `identical` or `behind`. This is the read-only equivalent of `git merge-base --is-ancestor <sha> origin/main`, which is not in DO's allowed list and needs a fresh fetch (Q-D4-6). "MERGED" alone is never the evidence (item (d)).

**(d) Stacked PRs**

- GitHub retargets an open child PR to the parent's base only when the parent's head branch is **deleted** after the merge, by the "Automatically delete head branches" setting or by hand. When it is not deleted (read the setting, item (a); do not assume), the child is **not** retargeted (SA-corrected). Merging the child then lands it in the parent's branch, not in `main`, and the PR still says MERGED.
- Rule: avoid stacking. If it is unavoidable: after the parent merges, the child's base is changed to `main` (`gh pr edit <n> --base main`, an RM action; forbidden for DO), and the landing is verified per item (c) before anything is called merged.
- DO's part, in a verification job: check each PR's `baseRefName` and the compare result. Whether the repo should delete head branches on merge is Q-D4-7.

**(e) Pacing and accounts**

- Protocol step 8 holds the rule; the skill adds the GitHub specifics. Abuse detection judges the **account**, across every session and worktree that uses its token, so parallel sessions add up. The account was once suspended for days after a burst of PR and push activity from many parallel sessions. (Grounding for the spec, not for the skill: about 200 merged PRs in 10 days, peaking near 35 a day, then a suspension of about three days.)
- Concrete rules: one session at a time opens PRs or pushes; a wait for CI or for a setting polls with pauses, never in a tight loop; before a batch of PRs, count the account's PRs opened today with a read (`gh pr list --author "@me" --state all --search "created:>=<date>" --limit 1000 --json number --jq length`; without `--limit` it stops at 30 (SA-corrected)) and report it. The skill gives no numeric limit (Q-D4-8).
- **Recovery accounts.** Any account kept for recovery never runs an AI session, is never logged in to `gh` in a session, and is never named, or said to exist, in tracked text (SA-corrected). No session switches `gh` accounts (`gh auth` commands are not on DO's allowed list; `gh auth token` is forbidden outright).

**(f) Git hazards in a shared repo**

- **Never `git stash`.** The stash list is shared by every worktree and session of the repo, so a pop can take another session's work. It is already in `devops.md`'s forbidden git writes; the skill states it with the reason, because the main session uses the skill too.
- The worktree `node_modules` junction hazard is DO-5's (`claude-harness-ops`); a pointer only.

**(g) Public-repo specifics for GitHub**

- The repo is public: workflow files, logs of its workflow runs, PR text, commit messages and check names are readable by anyone.
- Never in tracked text or in a chat summary that may be pasted into one: an owner or org ID, an app or installation ID, a ruleset or bypass-actor ID, token scopes, an owner account's login, the state of a security setting that is off, or an open alert. Those are open weaknesses or identifiers, and go to the untracked private docs only.
- A secret is set by the user, in the dashboard or the user's own terminal. Its value never passes through a chat or a session.
- Workflows: a workflow never gains a secret it does not need; the required workflows declare `permissions: contents: read`, and a plan that widens `permissions:` is reviewed by SA. A PR from a fork gets no secrets on `pull_request`; `pull_request_target` combined with checking out the PR's code is never proposed.
- Push protection blocks a push carrying a recognised secret. Bypassing it is the user's call only, and a bypassed secret is treated as leaked: rotate it per `env-change-protocol`.

**(h) Dashboard-only settings, and checking field names**

A table like `vercel-ops`' `dashboard-settings.md`. The user opens the area, reports what it shows (never a value), and the record names the setting, not an account.

| Setting | Dashboard area |
|---|---|
| Merge queue configuration (method, group size, timeout) | Repo → Settings → Branches (classic rule) or Rules → Rulesets |
| Allow auto-merge, delete head branches, allowed merge methods | Repo → Settings → General → Pull Requests |
| Secret scanning, push protection, Dependabot, code scanning | Repo → Settings → Code security |
| Allowed actions, fork PR workflow approval, workflow permissions | Repo → Settings → Actions → General |
| Secret and variable values | Repo → Settings → Secrets and variables (values are never read back) |
| Collaborators and roles | Repo → Settings → Collaborators |
| Org member privileges, two-factor requirement, org Actions policy, org rulesets | Org → Settings |

Field names (V13 in SA Review — DO-3, applied to GitHub): Dev checks every `--json` field and every `--jq` path the skill names against `gh <command> --help` (and, for a `gh pr|run|repo view`, the list of available fields `gh` prints) and the REST reference, and drops any name that does not exist. Any read Dev makes to check a name uses a named-field selector (item (a)). The implementation notes list each name checked and how, without quoting a response.

**(i) What the skill does not change**

- Every settings change — branch protection, rulesets, the required set, merge-queue configuration, Allow auto-merge, delete head branches, merge methods, secret scanning, push protection, Actions permissions, secrets, variables, collaborators — is **production tier**. DO plans it per `env-change-protocol` (the before-state from item (a), the exact dashboard path, how to undo as the before-state value, the probe), SA reviews it, the user executes it, and DO verifies it.
- **Verifying a settings change:** first a read of the changed field after the user saves, compared with the planned value (a probe that fails when the change did not land). Where behaviour matters (a new required check, a queue setting), the behaviour evidence is the **next real PR**, watched by the main session with the undo ready, not a probe PR (Q-D4-2).
- Workflow files and `.github/ci/**` are code: Dev writes them through a PR, SA reviews them. DO checks item (b) against the diff in its plan, and verifies after the merge.

### D4.3 Boundaries

| Neighbour | Owns | `github-ops` relation |
|---|---|---|
| `env-change-protocol` | The eight steps (incl. pacing), tiers, approval, order against the deploy, record template, public-repo rule | Referenced, never repeated |
| `devops.md` | The Bash/`gh` allowed list, the forbidden families (incl. `git stash`, `gh auth token`, GitHub writes), the public-repo rule, where plans go | Referenced; one pointer line added |
| RM (`release-manager.md`) | Branch, commit, push, PR, `--auto --merge`, the merge-queue procedure, the enqueue fallback, conflicts, retargeting a child PR | Referenced, never restated. A setting that blocks RM is DO's to plan |
| TL (`team-leader.md`) | The auto-merge standing preference and when a PR goes on auto-merge | Referenced; the skill adds only the "CI is the sole remaining gate" line in DO's plans |
| `vercel-ops` | Docs-only skipped builds, merge-queue branches not deployed | Referenced for why the Vercel status is never required |
| `.github/ci/non-deploying-change.sh`, `jest-gate-scope.sh`, `jest-gate-check.mjs`, `jest-quarantine.json` | What is skippable; the Jest gate's scope and checks; the quarantine (removals only, SA-reviewed) | Source of truth, referenced; not copied |
| Dev | Workflow files and CI scripts | DO reads them; never edits them |
| SA | Which checks are required; review of production-tier plans | Unchanged |
| DO-5 `claude-harness-ops` | Worktrees, the `node_modules` junction, harness permissions | Referenced only |

### D4.4 Acceptance criteria (DO-4)

- [ ] `.claude/skills/github-ops/SKILL.md` exists; frontmatter has `name: github-ops` (matching the folder) and a `description` in the existing skills' format, parsed cleanly by a YAML parser.
- [ ] The description fires on: branch protection, rulesets, required checks, a merge queue that is stuck or a check that never reports, "Auto merge is not allowed", deleting head branches, a stacked PR, "did my PR land on main", secret scanning or push protection, Actions permissions, a failed workflow run, GitHub secret or variable names, PR volume or an account suspension. It says it is used by the main session and DO. It names no owner, org, account, app, installation or ID.
- [ ] The skill covers (a)–(i) of §D4.2 and the boundaries of §D4.3, and links to `env-change-protocol`, `devops.md` and `release-manager.md` instead of restating them. QA greps the new files for `Snapshot the before-state`, `| **Read** |`, `zero policies` and `enqueuePullRequest`: 0 hits expected.
- [ ] The skill names no required check and states no count: QA greps the new files for each job `name:` in `.github/workflows/*.yml`; 0 hits, or each hit is explained as an example that is not a list of what is required.
- [ ] The skill states the seven rules of §D4.2(b) and both order rules for a change to the required set.
- [ ] The skill states the named-fields rule (`--jq` / `--json` on every read), that secret scanning alerts are never called, and the `gh variable list` form ruled on Q-D4-5.
- [ ] The skill states the "landed on `main`" check (base `main` plus the compare read, never MERGED alone) and the stacked-PR rule.
- [ ] The skill states the pacing specifics and the recovery-account rule, without naming or asserting any account and without a numeric limit (unless Q-D4-8 is ruled otherwise).
- [ ] The skill states "never `git stash`" with its reason.
- [ ] SKILL.md is ≤ ~200 lines, or the overflow is in reference files under `.claude/skills/github-ops/` that SKILL.md links to.
- [ ] `devops.md` has the one pointer line (D4-3) and no other change, unless SA rules otherwise on Q-D4-3, Q-D4-5 or Q-D4-6 (then SA states the allowed change).
- [ ] The finding-11 regex from §7 over the added lines of the diff returns zero hits, or each hit is explained in the QA report.
- [ ] No tracked text in the diff contains an owner, org or account login, an owner, org, app, installation or ruleset ID, a token scope, a security setting that is off, an open alert, or another open weakness of the live system. QA reads the diff for this.
- [ ] Every repo path the skill names exists in the worktree; the skill states no counts (checks, workflows, PRs).
- [ ] The implementation notes list each `--json` field and `--jq` path checked (§D4.2(h)) and how, with no response quoted.
- [ ] The diff touches only `.claude/skills/github-ops/**`, `.claude/agents/devops.md` and this requirement (plus `release-manager.md`, only if SA rules so on Q-D4-7).

### D4.5 Open questions for SA

- [ ] **Q-D4-1: Branch protection and rulesets — which is authoritative?** GitHub has both, and both can protect `main`. The effective-rules read covers rulesets (repo and org level) but not classic protection; classic protection has its own endpoint. The merge queue was turned on through classic protection (`docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md`, the "Queue enabled" row), and its configuration may not be readable through REST for a classic rule.
  *Suggested:* neither alone. DO reads **both** every time, and reports the effective state as the union, with each rule's source. The skill does not say which mechanism is in use today, since it can change. A setting no read shows (the queue's configuration) is a dashboard step (§D4.2(h)), not a GraphQL read (Q-D4-9).
- [ ] **Q-D4-2: How does DO verify a settings change landed?**
  *Suggested:* a read of the changed field after the user saves is the evidence for the stored state, and it can fail. The behaviour evidence is the **next real PR**, watched by the main session with the undo ready. No probe PR by default: it costs CI time and adds PR volume (pacing, §D4.2(e)). SA may allow one docs-only probe PR when a change could block every merge and cannot wait for a real PR. A docs-only PR still exercises reporting, because the required jobs skip inside the job and still report.
- [ ] **Q-D4-3: Can `gh run view --log` output carry secrets or PII, and how is it reported?** Yes: masking covers registered secrets only. Values printed some other way, variables, and PII in test data show in clear, and the whole log enters the session.
  *Suggested:* never `--log` whole. `--json jobs` first, for the failing job and step; then `--log-failed` only through a narrow filter (e.g. `| grep -n -m 40 -E "error|Error|FAIL"`), reporting the error class, never copying a line into a file, and never one that names a person. DO does not read the logs of any job whose steps reference `secrets.*` (SA-corrected). SA rules whether this becomes an allowed-list line in `devops.md` (today `gh run view` is allowed without qualification) or stays in the skill only.
- [ ] **Q-D4-4: Does the skill cover Dependabot and code scanning alerts?** Neither `.github/dependabot.yml` nor a code scanning workflow exists in the repo today. An open alert is an open weakness.
  *Suggested:* DO-4 covers only whether each feature is **enabled** (a named-field read). Alerts are not read in DO-4. Secret scanning alerts are never read, because they return the secret. If alert triage is wanted later, it is its own slice, with output to the untracked private docs only, and counts by severity at most in any chat summary.
- [ ] **Q-D4-5: `gh variable list` prints values.** `devops.md` allows it as "names only; never copy a value into a file", but the values already enter the session.
  *Suggested:* change that allowed-list entry in `devops.md` to `gh variable list --json name,updatedAt` (and `gh secret list --json name,updatedAt` for symmetry). This is one more line edit in `devops.md` beyond D4-3, so SA rules on it.
- [ ] **Q-D4-6: Verifying a merge is on `main` without `git merge-base` or `git fetch`.** Neither is on DO's allowed list.
  *Suggested:* use the compare read (`gh api repos/{owner}/{repo}/compare/main...<sha> --jq .status`) plus `gh pr view --json state,baseRefName,mergeCommit`. No allowed-list change. The alternative (allow `git fetch origin main` and `git merge-base --is-ancestor`) is equivalent but adds a local ref write.
- [ ] **Q-D4-7: Stacked PRs — change the setting, and does RM carry the rule?**
  *Suggested:* DO-4 changes no setting. Turning on "Automatically delete head branches" (so GitHub retargets a child PR) is a production-tier settings change for the user to decide, planned separately; side effect: a session still pushing to a merged branch recreates it on the remote. Because retargeting a child PR is RM's action, add one line to `release-manager.md` § Merging the PR pointing to `github-ops` §(d). SA rules whether that line is in DO-4's file list.
- [ ] **Q-D4-8: Does the skill give a numeric pacing limit?** GitHub publishes no threshold for abuse detection.
  *Suggested:* no number. The rules in §D4.2(e) (one session pushing at a time, polling with pauses, counting today's PRs before a batch) carry it. The incident figures stay in the user's private memory and in this spec as grounding.
- [ ] **Q-D4-9: Read-only GraphQL.** `gh api graphql` always POSTs, and its query is passed with a field flag (`-f query=…`), so `devops.md` forbids it today. Some state (merge-queue entries and configuration) may be visible only through GraphQL.
  *Suggested:* it stays forbidden for DO, read queries included. The field-flag rule is simple and checkable; an exception for "queries but not mutations" would rest on prose reading of the query text. Whatever only GraphQL shows is a main-session read with the user, or a dashboard step.

---

## DO-5 Specification — claude-harness-ops and env-drift-audit skills

**By BA — 2026-10-31.** Branch `feature/devops-harness-ops`. Config/docs-only slice: no application code, no CI job, no CI time.

DO-5 builds on `devops.md`, `env-change-protocol`, `supabase-ops`, `vercel-ops` and `github-ops`, and **does not repeat them**. The eight steps, the tiers, the approval channel, the change-record template, the public-repo rule, the Bash/`gh` allowed list, the read-only SQL rules (a)–(d) and every platform's read procedure stay where they are. `claude-harness-ops` holds only what is specific to the Claude Code harness. `env-drift-audit` holds only how to compare expected with live state and how to report it; every live read it needs is a pointer to the platform skill that owns it. DO-5 also settles three deferred items: **FU-3** (a read-only Supabase connection for DO), **FU-4** (a Preview-only Vercel env write) and the **ClickUp tools** decision (R3).

**Recommended split (Q-D5-1):**

| Slice | Scope | Why separate |
|---|---|---|
| **DO-5a** | `claude-harness-ops` skill; FU-3 (plan + `devops.md` tool-list change); FU-4 and ClickUp decisions recorded | Small, self-contained. FU-3 is a harness change, so it belongs with the harness skill. |
| **DO-5b** | `env-drift-audit` skill | Depends on all four platform skills and on FU-3's SQL connection. Its design (expected-state sources, severity, report location) needs its own SA pass. |

The rest of this section specifies both, so SA can rule on everything at once. If SA accepts the split, Dev builds DO-5a first; DO-5b gets a short re-check before its build.

### D5.1 Context and findings

| # | Finding (checked 2026-10-31) | Consequence for DO-5 |
|---|---|---|
| F1 | `.claude/settings.json` is tracked. It holds one Bash allow rule and nothing else: no deny rules, no hooks, no MCP settings. No `.mcp.json` exists in the repo. | The project's harness config is almost empty. Most harness state is in user scope (`~/.claude/settings.json`, `~/.claude.json`), plugins, and the local settings file. |
| F2 | **`.claude/settings.local.json` is also tracked** (`git ls-files`), and has been changed in many commits. It holds only `permissions.allow` (Bash and Read rules). A BA pattern scan (counts only) of its current content and its git history found no secret-shaped string. Some entries carry an absolute personal path. *(SA-added)* | Claude Code documents this file as personal and says it keeps it out of git when it creates it. Here it is tracked in a **public** repo, so every "Yes, and don't ask again" approval can be committed and published. Q-D5-2. |
| F3 | Claude Code treats a **tracked** local settings file as repository-supplied: its allow rules wait until the folder is trusted ([permissions § When your local settings file needs trust](https://code.claude.com/docs/en/permissions)). On Windows, the local file stays next to `.claude/settings.json` in the starting directory instead of the repo root ([settings § Where Claude Code keeps the local file](https://code.claude.com/docs/en/settings)). | In this repo each worktree reads **its own checked-out copy**. An approval given in a worktree edits a tracked file on that branch, and can ride along in a PR. |
| F4 | Settings precedence: managed → command line → project local → shared project → user. List keys such as `permissions.allow` **merge** across files. Deny beats ask beats allow; an allow rule cannot carve an exception out of a deny ([settings § Settings precedence](https://code.claude.com/docs/en/settings), [permissions](https://code.claude.com/docs/en/permissions)). | The skill states this once, so a harness plan reads every scope, not one file. |
| F5 | MCP servers have three scopes: local and user (stored in `~/.claude.json`, untracked) and project (`.mcp.json`, tracked). `.mcp.json` supports `${VAR}` expansion in `url` and `headers`. Project servers need approval in interactive sessions. Plugin servers are named `mcp__plugin_<plugin>_<server>__<tool>` ([mcp](https://code.claude.com/docs/en/mcp)). Local-scope servers are stored under the project's path. | A server URL that carries a project ref must never go in `.mcp.json` as a literal. Whether a local-scope server loads in a worktree (a different path) is not stated in the docs; Dev checks it (Q-D5-4). |
| F6 | **FU-3 research.** The hosted Supabase MCP server takes a `read_only=true` URL parameter that "execute[s] all queries as a read-only Postgres user", plus `project_ref` (one project, no account tools) and `features` (tool groups). Supabase recommends project scoping ([Supabase MCP guide](https://supabase.com/docs/guides/getting-started/mcp); [supabase-mcp README](https://github.com/supabase-community/supabase-mcp)). Neither page lists every tool that read-only mode disables. | Read-only mode enforces rule (a) **in the database**, not in prose. Which other tools it removes is checked at build, not assumed. |
| F7 | A project subagent can declare `mcpServers` (by name, or inline), its own `hooks`, and `disallowedTools`. Inline servers and frontmatter hooks of a **project** agent load only after the folder is trusted; until then Claude Code skips the hooks and logs an error ([sub-agents](https://code.claude.com/docs/en/sub-agents)). An entry in `tools:` that does not resolve is dropped silently (R2). | A subagent hook **fails open** when the folder is not trusted. A tool-list entry for a server that is not configured **fails closed** (the tool is simply missing). |
| F8 | **FU-4 research.** Settings-file permission rules match MCP tools by **name only**: Claude Code skips any `mcp__` rule with parentheses in a settings file. A parameter rule for an MCP tool works only as a deny rule passed with `--disallowedTools` for one session, and only on a top-level scalar parameter, never a field inside an array or object ([permissions § Match by input parameter](https://code.claude.com/docs/en/permissions)). A `PreToolUse` hook receives `tool_name` and the full `tool_input`, and can deny with exit code 2 or `permissionDecision: "deny"`; MCP matchers need a regex such as `mcp__server__.*` ([hooks](https://code.claude.com/docs/en/hooks)). Vercel tokens can be scoped to an account, a team or a project; BA found no token scoped to one environment ([Vercel access tokens](https://vercel.com/docs/accounts/access-tokens), [project-scoped tokens](https://vercel.com/changelog/project-scoped-tokens)). | No **permission rule** can enforce "target is exactly Preview": the env tools' target is a list, which parameter rules cannot match. Only a hook can, and a hook is a new pattern (CLAUDE.md rule 7) that fails open when untrusted (F7). Q-D5-6. |
| F9 | Worktree hazards already learned in this repo: the shared `node_modules` junction; the shared stash list (`github-ops` §8); local test results are authoritative only while both trees' dependency sets agree, and CI's `npm ci` is the authority (`docs/workplans/admin-authz-unification.md`, SA ruling (c)); never kill processes by image name (`docs/retrospectives/STRIPE_CONNECT_REFUND_WEBHOOK_RETROSPECTIVE.md`, lesson 4). `.claude/worktrees/` is gitignored. | The skill gathers these in one place, as rules with the reason, and points to `github-ops` for the stash. |

### D5.2 What the skills must teach

#### D5.2.1 `claude-harness-ops` (DO-5a)

Each item says what the skill states. It reads like the other ops skills: a pointer table first, numbered sections, a closing checklist.

**(a) Where harness state lives, and how to read it** (Read tier)

| Source | Tracked? | How to read it |
|---|---|---|
| Managed settings | No | `/status` → `Setting sources` (main session). DO reports "managed: present / absent", never its content. |
| `~/.claude/settings.json` (user) | No | Keys and counts only (`jq 'keys'`, `jq '.permissions.allow \| length'`). Never print the file. |
| `.claude/settings.json` (shared project) | Yes | Read in full; it is public. |
| `.claude/settings.local.json` (project local) | **Yes, today** (F2) | Keys and counts first. Read entries only to check a planned change; never paste them into chat. |
| `~/.claude.json` | No | **Never printed or read in full, and never opened by DO.** It holds account details, MCP server configs (URLs, headers) and trust decisions. Server **names** and status only, in the main session. `claude mcp list` prints each server's URL, so the session reports names and status from it and never repeats a URL; `claude mcp get` prints headers and is not used. *(SA-corrected)* |
| `.mcp.json` | Would be | None exists. If one is added, it uses `${VAR}` for any ref or token (F5). |
| Plugin servers and agents | No | Server names from the tool names (`mcp__plugin_…`). |
| Subagent frontmatter (`.claude/agents/*.md`) | Yes | `tools:`, `disallowedTools`, `mcpServers`, `hooks`, `permissionMode`. |

- Precedence and merging (F4) in one short table. Lists merge; deny wins; a hook never overrides a deny rule.
- Checks that only the main session can run: `/status`, `/permissions`, `/mcp`, `claude doctor` (rejected entries). DO asks the main session for them in its report.

**(b) Changing settings and permissions**

- Every harness change follows `env-change-protocol`. The skill gives the harness tier table (Q-D5-3): adding or widening an allow rule, an MCP server, a hook, or a `permissionMode` is a **production-tier** plan (SA reviews, the user executes); removing an allow rule or adding a deny rule is **reversible**.
- **Who edits the file.** Tracked harness files (`.claude/settings.json`, `.claude/agents/*.md`) change through a PR like any repo file. User-scope files and `~/.claude.json` are changed by the user only. DO never edits any of them (`devops.md` § What you may write).
- **Before-state and probe.** The before-state is the keys and counts from (a). The probe is the behaviour: a new deny rule is proven by a call that it blocks; a new allow rule by a call that no longer prompts; a removed rule by a call that prompts again. Settings reload live, except a few keys read at start ([settings § When edits take effect](https://code.claude.com/docs/en/settings)). Agent files and tool lists load at **session start**, so a change to them is verified in a fresh session.
- **The tracked local file (F2, F3).** Until Q-D5-2 is settled: before any commit, check whether `.claude/settings.local.json` is in the diff, and never commit it by accident. Never approve "don't ask again" for a command that embeds a secret, a token, a URL with an ID, or an absolute personal path, because the rule is written to a tracked file in a public repo.

**(c) MCP servers**

- Scopes and where each is stored (F5). A server URL with a project ref or a token goes only into user or local scope, never into a tracked file. A tracked config uses `${VAR}`.
- Server names: a name the user chooses (stable, by role, for example a read-only Supabase server) may be written in tracked text. A claude.ai connector's instance ID never may (R1).
- **After any server change:** a fresh-session check that every name in DO's `tools:` still resolves (R2 smoke test). An unresolved name is dropped silently, so "the agent loaded" proves nothing.
- Adding a server is production tier: it gives every session in that scope new tools.

**(d) Hooks**

- What a hook can do: run any command, with the user's credentials, before or after a tool call; deny a call (F8).
- A new hook is a **new pattern** (CLAUDE.md rule 7): SA reviews it before it is added.
- **A hook must fail closed to count as a guard.** A project subagent's frontmatter hook is skipped when the folder is not trusted (F7), so it is never the only guard on a write.

**(e) Worktrees** (the gotchas, with the reason for each)

- **The `node_modules` junction.** A worktree's `node_modules` is a Windows junction to the main checkout's. `git worktree remove --force` follows the junction and **deletes the shared contents**, breaking every worktree and the main checkout. Safe removal, verified (PowerShell, main session with the user):
  1. `$j = Get-Item '<wt>/node_modules'; $j.LinkType; $j.Target` — note the target. There can be more than one shared folder, so the target is read, never assumed to be the main checkout's. If `LinkType` is `SymbolicLink` or anything else not empty and not `Junction`, stop and ask the user. *(SA-corrected)*
  2. `if ($j.LinkType -eq 'Junction') { $j.Delete() }`. This removes the link only.
  3. Check that `Test-Path '<wt>/node_modules'` is now `False`, and that `<target>/next/package.json` still exists, where `<target>` is the folder noted in step 1. *(SA-corrected)*
  4. Only then run `git worktree remove '<wt>'`, without `--force`. If it refuses, report why; never add `--force`, `rm -rf` or `Remove-Item -Recurse` to get past it while any link may remain. *(SA-corrected)*
- `cmd /c rmdir` is not a fallback: the PowerShell tool blocks it, and Git Bash mangles quoted paths with spaces.
- **Baseline comparisons** (for example "was this test red before my change?") use `git archive <base>` extracted into a scratch directory, not a temporary worktree, so no junction is created or removed.
- **Never `git stash`.** Pointer to `github-ops` §8; not restated.
- **Shared dependencies.** Local test results count only while the worktree's and the main checkout's dependency sets agree. CI's `npm ci` is the authority (F9).
- **Shared machine.** Never kill processes by image name (`taskkill /IM`, `pkill`); that reaches every session. Identify a hung process by PID and working directory, and ask the user (F9).
- DO's part: `git worktree list` only. `git worktree remove` is already forbidden in `devops.md`.

**(f) Public-repo specifics for the harness**

- Never in tracked text: a project ref, a connector instance ID, a URL with an ID, a token, an absolute personal path, or the content of `~/.claude.json` or user settings.
- An allow rule is a public statement of what the session may run without asking. Keep tracked rules narrow.

**(g) FU-3: a read-only Supabase connection for DO** (Q-D5-4)

- **What the user does (production tier, a harness change):** add one HTTP MCP server, in user or local scope (never `.mcp.json`), named by role (for example `supabase-readonly`), pointing at the hosted Supabase MCP server with `read_only=true`, `project_ref` of the production project, and `features` limited to the groups DO needs. Then log it in with `/mcp`. The project ref is typed only into the user's own config.
- **What Dev changes:** in `devops.md`'s `tools:` list, replace the plugin server's `execute_sql` with the read-only server's `execute_sql`. Dev confirms each name in a fresh session before the change merges. The other plugin read tools stay, unless SA rules that DO moves to the new server for all of them.
- **What stays the same:** rules (a)–(d) and the `begin read only; …; commit;` wrapper stay, as defence in depth. The skill states that read-only mode makes rule (a) enforced by the database for that server.
- **Fail-safe:** if the server is not configured, its tool name does not resolve and DO has no SQL tool at all (F7). That fails closed.
- **Build check (main session, with the user, before the `tools:` swap merges):** a write inside the `begin read only` wrapper fails on **any** server (measured in Q-D2-1), so it cannot prove read-only mode. The probe runs **without** the wrapper, as a one-time exception to rule (b) made by the main session, never by DO: `select current_setting('transaction_read_only')` returns `on` through the new server and `off` through the plugin server (the control that shows the probe can fail); an unwrapped `create temp table` through the new server is rejected; and a catalog fact that only the intended project has comes back, so the server is pinned to the right project. The record names the project by role and the error by class. *(SA-corrected; see SA Review — DO-5, H1)*

**(h) FU-4 and ClickUp decisions** (Q-D5-6, Q-D5-7)

- The skill states what was decided, in one line each, so a later session does not reopen them without new facts.

#### D5.2.2 `env-drift-audit` (DO-5b)

A **read-only** audit. It changes nothing and fixes nothing. Each finding becomes a change plan in a later job.

*(BA re-check, FU-5, 2026-10-31.)* Re-checked against H10, the Q-D5-9 ruling, the Q-D5-1 ruling that 5b does not wait for FU-3b, the `claude-harness-ops` skill as merged (its §1 who-reads-what rule, H3), the other ops skills as merged, and the untracking of the local settings file (pending merge). What changed is marked *(BA re-check)*. The new check list is (g); the new questions are Q-D5b-1 to Q-D5b-4 in §D5.5.

**(a) Expected state: three sources, by what they may hold**

| Source | Tracked? | What it supplies |
|---|---|---|
| Repo files | Yes | Workflow files and their job names; `vercel.json` (crons, ignore command, disabled branches); `supabase/migrations/**` and checkers; `.claude/settings.json` and agent `tools:` lists; env var **names** the code reads (feature flags, `.env.example`). *(BA re-check, H10:)* the two name sources are `lib/utils/featureFlags.ts` and `.env.example`. BA confirmed both exist on `main` at this re-check; Dev confirms again at build. `.env.example` is read for names only (Q-D5b-2). `.claude/settings.local.json` is **not** an expected-state source: it is being untracked, and once that lands the expected state is "untracked" (check CH-3). *(SA-corrected:)* `.env.example` names are a main-session read (Q-D5b-2 ruling); DO reads `featureFlags.ts` only. Neither file is a complete list of the names the code reads, so V-2 checks the names these two sources hold and the full report says so; it is not a completeness check. The untrack has landed on `origin/main` as last fetched, so CH-3 applies now. |
| Change records | Yes, by role | Each cycle workplan's `## Environment changes` section: what a recorded step said the end state is. |
| Private inventory | **No** | Everything that is an ID, a value location or a weakness: which project holds which env var names, the expected settings of security features, the project for each role. *(BA re-check)* Also the last recorded advisor lists (`supabase-ops` §2 puts them there) and earlier full drift reports. |

The skill says: an expected value that is an ID, a secret location or a security setting lives only in the private inventory. The audit reads it there and **never copies it** into tracked text or chat.

*(BA re-check)* **Repo files are read as they are on `main`**, not the current branch (`git show main:<path>` or `git log`, both on DO's allowed list), and the report names the `main` commit it read. Whether local `main` is current is Q-D5b-4. *(SA-corrected, Q-D5b-4 ruling:)* "`main`" here means **`origin/main`** (`git show origin/main:<path>`, `git log -1 origin/main`), never the local `main` branch, which nothing in this repo keeps current.

*(BA re-check)* **When the private inventory is not reachable.** It is untracked, so it is absent from every worktree. Its location comes from the brief (the main session reads it from the user's private memory); the skill never writes the location, and DO does not search the disk for it. When it is not reachable, every check whose expected state lives there is **not read (expected state missing)**: never "no drift", and never compared against a guess or an earlier report. The checks whose expected state is in the repo still run. Where the full report goes in that case is Q-D5b-1.

**(b) Live state: pointers, not procedures**

| Area | Live read | Owned by |
|---|---|---|
| GitHub | Repo settings, protection and rulesets, required checks against job names (the seven rules), Actions permissions, secret and variable **names** | `github-ops` *(BA re-check: §2 and §4; the commands are in its `read-commands.md`)* |
| Vercel | Projects by role, env var names by target, crons, production deployment against `main` | `vercel-ops` *(BA re-check, H10: §3, §4 step 5 and §6; whether the production deployment's SHA is on `main` is `github-ops` §6)* |
| Supabase | Migrations by catalog evidence (never the ledger), advisor counts, auth settings | `supabase-ops` *(BA re-check: §2. SQL goes through the plugin `execute_sql` under `devops.md` rules (a)–(d) and the wrapper. Once FU-3b lands it goes through the read-only server, under the same rules. 5b does not wait for FU-3b (Q-D5-1 ruling). Auth settings are a user dashboard step, so they are "not read" unless the user reports them)* |
| Harness | Settings scopes by keys and counts, DO's tool names resolve, MCP server names, worktrees and junctions | `claude-harness-ops` *(BA re-check, H3, H10: DO reads only the tracked harness files, its own loaded tools and `git worktree list`. User and managed settings, `~/.claude.json`, MCP server names and status, and every junction read are **main-session reads** (§1, §2, §6). DO reports them as "main-session check owed" and never opens those files)* |

Third-party platforms join when DO-6 exists. Until then the audit lists them as "not audited".

*(BA re-check)* The audit **points** to each skill by section. It never copies a command, a tool parameter or a procedure from them, and never restates `env-change-protocol` or `devops.md`. Which checks run is listed in (g).

**(c) Comparison rules**

- Every area reports one of: **no drift**, **drift** (with a severity), or **not read** (no access, error, retention passed). "Not read" is never "no drift" (the rule of every ops skill).
- Names are compared, never values. An env var is "present in Production and Preview", never its value.
- A change record that disagrees with live state is drift, even if the live state looks right: the record or the platform is wrong.
- *(BA re-check)* The audit works **per check**, not per area. Each check in (g) reports one of the three states. "Not read" always carries its reason: no access, error, retention passed, expected state missing (the private inventory is not reachable), or main-session check owed (H3).
- *(BA re-check)* A "main-session check owed" counts as "not read" in DO's report. It turns into a result only when the main session runs it and adds it to the full report.

**(d) Severity scale** (Q-D5-9)

| Severity | Meaning | Example (by kind) |
|---|---|---|
| **Critical** | Security exposure now, or production broken or at risk on the next deploy | A required gate that cannot fail; a security feature expected on and found off; a value-bearing permission wider than recorded |
| **High** | Will break the next merge, deploy or migration | A required check name with no job; an env var the code needs missing from a target; a migration not applied that merged code reads |
| **Medium** | Wrong but not harmful today | A cron in the repo not on the platform; a stale record; an unresolved tool name in an agent file |
| **Low** | Cosmetic or informational | A leftover worktree; an unused allow rule |

*(BA re-check, Q-D5-9 examples confirmed.)* Each example maps to a check in (g): a gate that cannot fail is G-1; a security feature found off is G-4, S-3 or V-5; a value-bearing permission wider than recorded is G-5 or CH-2. Each check carries a fixed **class**, the highest severity its drift can have. A single finding may be rated lower, never higher, with the reason given in the full report. A check is **Critical-class** when its class is Critical. Every area has at least one, so a "not read" anywhere can hide a Critical finding. Per the Q-D5-9 ruling, every **Critical-class check that is "not read"** is listed **first** in the chat summary, by check ID.

**(e) Output**

| Output | Where | Holds |
|---|---|---|
| Full drift report | **Untracked private docs only** | Findings by area and severity, with what to compare. A Critical finding is an open weakness, so the report is never tracked. *(BA re-check)* One dated file per run. Per check: ID, result, severity, the expected-state source, the evidence by role, and the reason for any "not read". It also records the `main` commit read and which main-session checks are owed. |
| Chat summary | DO's report | **Counts** by area and severity, plus "not read" areas. No setting names for Critical findings, no IDs, no values. *(BA re-check)* The layout, in this order: (1) "Critical-class checks not read:" with the check IDs, or "none"; (2) one row per area (GitHub, Vercel, Supabase, Harness) with counts for Critical, High, Medium, Low, no drift and not read; (3) "Third-party: not audited"; (4) the main-session checks owed, by check ID; (5) the `main` commit read. Check IDs come from the public skill, so naming one reveals only that it was not read. A drift finding is never named in chat, only counted. The rest of the report follows `devops.md` § Report Format. *(SA-added)* A non-zero Critical or High count signals an open weakness, so the chat summary is never pasted into tracked text (`github-ops` §9). |
| Fix plans | Per finding, a later DO change-plan job | A fix for a security finding is planned in the private docs until it lands (Q-D5-10). |

**(f) When it runs:** on demand by the user or TL, and as a suggested step at the end of a DO stream. No scheduled run (a schedule would be a new pattern; Q-D5-11). *(BA re-check)* **On demand only.** DO never starts a run itself. A report may suggest one, for example at the end of a DO stream or after a production-tier change lands. A run covers all four areas unless the brief names fewer, and a partial run lists the other areas as "not audited". Each run compares against the expected state, never against the previous report.

**(g) The checks** *(BA re-check: new)*

The skill holds this list as one table. Dev may merge or split rows to fit about 150 lines, but may not lower a class or drop a check without SA. "Who reads" follows H3: **DO** means DO reads it in the run; **main session** means DO reports "main-session check owed"; **user** means a dashboard step the user reports.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| G-1 | Every required check protects `main` (all seven rules) | Workflow files on `main` (job `name:`, triggers, `paths:`, `if:`, `needs:`) | `github-ops` §2 Required checks, §4 | Critical (a required gate that cannot fail); High (a required name with no job) | DO |
| G-2 | Protection and rulesets of `main`, read together | Private inventory; change records | `github-ops` §2 Branch protection and rulesets, What to report | Critical | DO; user if DO's read is refused *(SA-corrected: admin rights needed; dashboard area in `github-ops` `dashboard-settings.md`)* |
| G-3 | Repo settings: auto-merge allowed, delete head branches, merge methods, default branch | Change records; private inventory | `github-ops` §2 Repo settings | Medium | DO |
| G-4 | Secret scanning and push protection enabled | Private inventory | `github-ops` §2 Repo settings (an absent object is not read), §3 | Critical | DO; user if DO's read is refused *(SA-corrected, as G-2)* |
| G-5 | Actions permissions: allowed actions, default token permission, whether Actions may approve PRs | Private inventory | `github-ops` §2 Actions | Critical | DO; user if DO's read is refused *(SA-corrected, as G-2)* |
| G-6 | Every secret and variable name a workflow on `main` references exists in its scope | Workflow files on `main` | `github-ops` §2 Secrets and variables (names only) | High | DO |
| V-1 | Each project by role: linked repo, production branch, framework, Node version, root directory | Private inventory (which project holds which role) | `vercel-ops` §1, §3 Projects | High | DO |
| V-2 | Env var names by target: each name the code reads is on every target that needs it, with the Git-branch scope recorded | `lib/utils/featureFlags.ts`, `.env.example` (names); private inventory (which project and target) | `vercel-ops` §3 Env vars | High | DO (`featureFlags.ts` names, the live read); main session (`.env.example` names) *(SA-corrected, Q-D5b-2)* |
| V-3 | Production serves `main`: the current production deployment's SHA is on `main` and holds the production aliases | `main` head | `vercel-ops` §3 Deployments, §4 step 5; SHA on `main`: `github-ops` §6 | High (Medium if the only gap is docs-only commits, `vercel-ops` §5) *(SA-corrected: "docs-only" is shown only by a CANCELED deployment with the `SKIP:` line for each later commit, `vercel-ops` §5; DO never judges it from file names)* | DO |
| V-4 | Crons: the `vercel.json` set matches the production deployment's set, and each is enabled | `vercel.json` on `main` *(SA-corrected: at the production deployment's SHA, `vercel-ops` §6; a gap from `main` is V-3's finding, not a second one)* | `vercel-ops` §6 | Medium | DO |
| V-5 | Domains on the right project and target, DNS valid; deployment protection as recorded | Private inventory | `vercel-ops` §3 Domains; protection: `vercel-ops` `dashboard-settings.md` | Critical | DO (domains); user (protection) |
| S-1 | Every migration on `main` is applied, by catalog evidence | `supabase/migrations/**` on `main` and its checker, where one exists *(SA-corrected: bounded to the migrations after the last one the private inventory records as verified; one with no checker and no named objects is "not read (no checker)", never "applied")* | `supabase-ops` §2 Migration drift, Catalog evidence | High | DO |
| S-2 | Advisors: no security or performance finding beyond the last recorded lists | Private inventory (last recorded lists) | `supabase-ops` §2 Advisors, Where advisor results go | Critical (security); Medium (performance) | DO |
| S-3 | RLS (enabled and forced) and grants as the migrations set them | Migrations on `main` | `supabase-ops` §2 Catalog evidence | Critical | DO |
| S-4 | Auth settings and backups as recorded | Private inventory | `supabase-ops` §2 What the tools cannot read | Critical | User |
| S-5 | Edge functions and extensions match the repo | `supabase/functions/`, `supabase/config.toml`, migrations on `main` | `supabase-ops` §2 Extensions, functions, branches | Medium | DO |
| CH-1 | DO's loaded tools equal the `tools:` line; exactly one `execute_sql`; no write tool *(SA-corrected: no **platform** write tool; Write, Edit and Bash are on the line by design)* | `devops.md` on `main` | DO compares its own loaded tools with the line (`claude-harness-ops` §4, §8) | Critical (a write tool, or two `execute_sql`); Medium (a name that does not resolve) | DO |
| CH-2 | Tracked harness files: no allow rule, key, `hooks`, `mcpServers` or `permissionMode` beyond a change record; no tracked rule with a secret, a URL with an ID or a personal path | `.claude/settings.json`, `.claude/agents/*.md` on `main`; change records | `claude-harness-ops` §2, §3, §7 | Critical | DO |
| CH-3 | The local settings file is untracked | The `.gitignore` line on `main`. Before the untrack lands: "not applicable" | `claude-harness-ops` §3 (`git ls-files` is not on DO's allowed list) | Medium | Main session *(SA-corrected: now **DO**. `git show origin/main:.claude/` lists the tree's entry names with no content and is on the allowed list; never `git show` of the local file itself. The untrack has landed on `origin/main`, so "not applicable" no longer applies)* |
| CH-4 | No `.mcp.json`, or every ref and token in it is a `${VAR}` | Repo on `main` | `claude-harness-ops` §2, §4 | Critical | DO |
| CH-5 | User and managed settings, MCP server names and status; once FU-3b lands, the read-only server has its three settings and H1 was re-run after any re-add (H2) | Change records; private inventory | `claude-harness-ops` §1, §2, §8 | Critical | Main session |
| CH-6 | No leftover worktree; each worktree's `node_modules` is a junction with an intact target | Active work named in the brief | `git worktree list` (DO); junctions: `claude-harness-ops` §6 | Low | DO (list); main session (junctions) |

Notes for Dev:
- The table holds **sources and pointers only**: no expected value, no setting value, no project, no folder or path.
- The Supabase checks are counts, booleans and catalog facts only (rule (c)); S-2's lint names go to the full report, never to chat.
- CH-1 and CH-5 together cover H2: CH-1 sees which server name DO is bound to, and CH-5 is the only check that can see whether that server is really read-only.
- *(SA-added)* CH-6: `git worktree list` prints absolute paths. The report gives counts only (worktrees, leftovers), never a worktree name or path (`claude-harness-ops` §7).
- *(SA-added)* S-3: a table that the migrations leave without RLS is drift unless the private inventory records it as intended. DO does not decide that a missing policy is "on purpose".

### D5.3 Files to change

| # | File | Slice | Action | What |
|---|---|---|---|---|
| D5-1 | `.claude/skills/claude-harness-ops/SKILL.md` | 5a | New | §D5.2.1. Target ≤ ~200 lines; reference files only if needed. |
| D5-2 | `.claude/agents/devops.md` | 5a | Edited | (1) One pointer line to `claude-harness-ops` for harness reads. (2) FU-3: `tools:` swap of `execute_sql` (only after the user's server exists and names resolve; Q-D5-4). Nothing else, unless SA rules otherwise. *(SA-corrected:)* (1) also says DO never opens `~/.claude.json` or user-scope settings (H3). (2) replaces the plugin entry, never joins it, and goes in only after the H1 probe passed; otherwise it is follow-up FU-3b (H4). |
| D5-3 | `.claude/skills/github-ops/SKILL.md` | 5a | Edited | The pointer row "DO-5's `claude-harness-ops` skill (not built yet)" loses "(not built yet)" and links the file. |
| D5-4 | `.claude/settings.local.json`, `.gitignore` | 5a | Only if SA and the user decide so on Q-D5-2 | Untrack the file and ignore it. |
| D5-5 | `.claude/skills/env-drift-audit/SKILL.md` | 5b | New | §D5.2.2. Target ≤ ~150 lines. *(BA re-check)* SKILL.md only, no reference files: a pointer table first, then (a)–(f), the check table (g) and a closing checklist, like the other ops skills. |
| D5-6 | `.claude/agents/devops.md` | 5b | Edited | One pointer line: drift reports follow `env-drift-audit`. *(BA re-check)* The line goes with job 2 ("Drift report") in § Your Jobs. Nothing else in `devops.md` changes: not `tools:`, not the allowed list (CH-3's `git ls-files` stays a main-session read), and not the Secret-exposure row (Q-D5b-2). |
| D5-7 | `CLAUDE.md` | — | **Not edited** | The Common Gotchas `env-change-protocol` row already routes MCP, permission and hook changes. |
| D5-8 | This requirement | both | Edited | Status, implementation notes, reviews. |

### D5.4 Acceptance criteria

**DO-5a**

- [ ] `.claude/skills/claude-harness-ops/SKILL.md` exists; frontmatter `name: claude-harness-ops` (matching the folder) and a `description` that parses cleanly. It fires on: settings files, permissions or allow rules, "don't ask again", an MCP server, a hook, a subagent tool list, a worktree to create or remove, `node_modules` missing or broken, and the tracked local settings file. It says it is used by the main session and DO, and names no server ID or ref.
- [ ] The skill covers §D5.2.1 (a)–(h) and points to `env-change-protocol`, `devops.md` and `github-ops` instead of restating them. QA greps the new file for `Snapshot the before-state`, `| **Read** |` and `zero policies`: 0 hits.
- [ ] The junction procedure is stated with all four steps in order (read the target, delete the link, check the link is gone and the target intact, remove without `--force`) *(SA-corrected)*, the `cmd /c rmdir` warning and the `git archive` baseline rule. `git stash` appears only as a pointer to `github-ops`.
- [ ] The skill states that `~/.claude.json` is never printed, and that harness reads are keys and counts.
- [ ] FU-3: the change record for the user's server is in the implementation notes, by role, with the tool names checked in a fresh session. No URL, ref or connector ID in the diff. Or, if SA rules FU-3 out of 5a, the notes say so. *(SA-corrected:)* the record includes the H1 probe results with the plugin-server control; if the probe has not passed, the swap is not in the diff and the notes name FU-3b.
- [ ] `devops.md` changes only as D5-2 states.
- [ ] The finding-11 regex from §7 over the added lines of the diff returns zero hits, or each hit is explained in the QA report. QA also reads the diff for absolute personal paths and server URLs.
- [ ] The diff touches only the files in D5.3 for 5a.

**DO-5b**

- [ ] `.claude/skills/env-drift-audit/SKILL.md` exists with valid frontmatter; the description fires on "drift", "audit the environments", "is everything configured as expected", "what is out of sync".
- [ ] It names the three expected-state sources and what each may hold; the four live areas as pointers only; the three result states (no drift, drift, not read); the severity scale; and the output table, with the full report in the private docs only.
- [ ] It contains no read procedure owned by another skill. QA greps it for `--jq`, `filter_project_envs` and `begin read only`: 0 hits, or each hit is a pointer.
- [ ] The finding-11 regex returns zero hits; the diff touches only the 5b files in D5.3.
- [ ] *(BA re-check)* The skill has the check table (g). Every row names its expected-state source, its live-read pointer **by skill and section**, its class and who reads it. No row holds an expected value, a setting value, a project, a folder or a path.
- [ ] *(BA re-check)* It states the per-check "not read" reasons, including "expected state missing" and "main-session check owed". It states that a Critical-class check that is "not read" is listed first in the chat summary, by check ID (Q-D5-9).
- [ ] *(BA re-check)* It states that expected IDs, secret locations and security settings come only from the untracked private inventory. When that inventory is not reachable, those checks are "not read (expected state missing)", never "no drift". The skill names no location for the private docs.
- [ ] *(BA re-check)* It states the report split: the full report goes to the untracked private docs only (per Q-D5b-1 when they are not reachable), and the chat summary follows the five-part layout in (e), with counts only.
- [ ] *(BA re-check, H3)* The user-scope, managed, MCP-server and junction checks (CH-3, CH-5, CH-6 junctions) are "main-session check owed". *(SA-corrected: CH-5, the CH-6 junctions and the V-2 `.env.example` names; CH-3 is now DO's.)* QA greps the skill for `node -p`, `Get-Item`, `claude mcp` and `jq`: 0 hits. `.claude.json` appears only in a "never opened by DO" sentence or a pointer to `claude-harness-ops` §1.
- [ ] *(BA re-check)* No restatement: QA greps the skill for `Snapshot the before-state`, `| **Read** |`, `gh api`, `list_deployments` and `get_advisors`: 0 hits, or each hit is a pointer.
- [ ] *(BA re-check)* The skill does not expect `.claude/settings.local.json` in the repo: it appears only in CH-3.
- [ ] *(BA re-check)* The `devops.md` diff is exactly the one pointer line (D5-6). `tools:` is unchanged.
- [ ] *(BA re-check)* It states "on demand only" and "no schedule" (Q-D5-11). The skill is at most about 150 lines.
- [ ] *(SA-added)* Repo files are read at `origin/main`, never the local `main` branch: QA greps the skill for `main:` and each hit is `origin/main:`. The staleness test counts only `identical` as current (Q-D5b-4 ruling).
- [ ] *(SA-added)* The `.env.example` names read is a main-session check owed, with the `-E` form and the guard count from the Q-D5b-2 ruling. QA greps the skill for `grep -o '` (the BRE form): 0 hits.

### D5.5 Open questions for SA

- [ ] **Q-D5-1: Split DO-5?**
  *Suggested:* yes. DO-5a = `claude-harness-ops` + FU-3 + the FU-4 and ClickUp decisions. DO-5b = `env-drift-audit`, after 5a merges, so it can point to every skill and use FU-3's connection. This matches the small-numbered-slices preference.
- [ ] **Q-D5-2: The tracked `.claude/settings.local.json`.** Claude Code documents it as a personal file kept out of git (F2). Tracked in a public repo, each standing approval can be committed and published, and on Windows each worktree edits its own tracked copy (F3).
  *Suggested:* untrack it: `git rm --cached` plus a `.gitignore` line, through a normal PR (Dev writes, RM commits). The user decides, because it changes their own permissions in every worktree created after that (a new worktree starts with no local file). History keeps the old content; the BA scan found nothing secret-shaped in it, so no rewrite is needed. Until then, the skill's "check the diff before commit" rule applies.
- [ ] **Q-D5-3: Tiers for harness changes.**
  *Suggested:* adding or widening an allow rule, an MCP server, a hook or a `permissionMode` = production tier (SA reviews, the user executes). Removing an allow rule or adding a deny rule = reversible. A change to DO's own `tools:` list = SA review always.
- [ ] **Q-D5-4: FU-3 — build it, and how?**
  *Suggested:* build it in 5a. A server the user adds in **user scope** (local scope is stored per project path, and may not load in a worktree; Dev or the main session checks this before choosing), named by role, with `read_only=true`, `project_ref` and a narrow `features` list. Not `.mcp.json` (tracked, and it would give every session the server). Not an inline `mcpServers` entry in `devops.md` (the URL would be in a tracked file, and inline servers need folder trust). Only `execute_sql` moves to the new server at first. Rules (a)–(d) and the wrapper stay. SA rules whether other Supabase projects (by role) get their own read-only server, or DO keeps no SQL tool for them.
- [ ] **Q-D5-5: Does read-only mode remove other tools?** The docs do not list them (F6).
  *Suggested:* do not rely on it. DO's `tools:` list stays the guard for every non-SQL tool. Dev records which tools the new server exposes, by name, in the implementation notes.
- [ ] **Q-D5-6: FU-4 — Preview-only Vercel env write.**
  *Suggested:* **do not build; close FU-4.** No permission rule can match the env tools' target list (F8). A `PreToolUse` hook could check `tool_input`, but it is a new pattern, it fails open when the folder is not trusted (F7), and it would have to parse the target list and the Git-branch scope correctly to be safe. No Preview token scope exists (F8). The demand is low: the main session can set a Preview variable with the user today. Reopen only if Vercel offers an environment-scoped token, or Claude Code lets a settings rule match an MCP argument.
- [ ] **Q-D5-7: ClickUp tools.**
  *Suggested:* **keep deferred, and close it as "not needed".** R3's reasons still hold: no DO job needs it, the update-task tool cannot be limited to the status field, and the list ID is private. The same hook limits as FU-4 apply. Reopen if a DO job appears that needs task status.
- [ ] **Q-D5-8: Who checks `/status`, `/mcp` and `claude doctor`?** These are interactive.
  *Suggested:* the main session, at the user's request. DO's report lists them as "main-session checks owed".
- [ ] **Q-D5-9: Severity scale.**
  *Suggested:* the four levels in §D5.2.2(d). "Not read" is a separate state, not a severity.
- [ ] **Q-D5-10: Can a fix plan for a security drift sit in a tracked workplan?** A plan names the setting that is wrong, which is an open weakness until fixed.
  *Suggested:* no. It stays in the private docs until the fix is verified. Afterwards the tracked record may say what changed, by role, as closed history.
- [ ] **Q-D5-11: Scheduled drift audit?**
  *Suggested:* not in DO-5. On demand only. A scheduled run would need its own SA review (a new pattern, and an unattended session holding platform tools).

**Re-check questions for DO-5b** *(BA re-check)*

- [ ] **Q-D5b-1: Where does the full report go when the private docs are not reachable?** DO may write only to a cycle workplan's `## Environment changes` section and to the untracked private docs. A drift report is standalone and holds open weaknesses.
  *Suggested:* DO writes **no** full report anywhere else: not a tracked file and not a scratch file. It returns the chat summary with "full report not written: private docs not reachable", and every private-sourced check is already "not read (expected state missing)". The main session re-runs the audit with the location in the brief.
- [ ] **Q-D5b-2: May DO read `.env.example` for check V-2?** `devops.md` forbids printing `.env*` files (the Secret-exposure row). The file is tracked and public, and some of its lines carry a value.
  *Suggested:* yes, **names only**: one Grep with `-o` on the pattern `^[A-Z0-9_]+=`, which returns the name and the `=` and never the value. Never Read, `cat` or `git show` of the file. If the current branch's copy differs from `main` (`git diff --stat main -- .env.example`, which prints no content), V-2's repo source is "not read". `devops.md` stays unchanged, because this form prints no value. If SA prefers, V-2 uses `lib/utils/featureFlags.ts` alone.
  *(SA ruling: names only is compatible, but it is a main-session read; see SA Review — DO-5b.)*
- [ ] **Q-D5b-3: Are the checks and classes in (g) right?**
  *Suggested:* yes. Dev may merge or split rows to fit about 150 lines, but may not lower a class or drop a check without SA. SA confirms in particular: CH-3 is Medium (a tracked local file publishes future approvals, but exposes nothing today); V-3 is High, falling to Medium when the gap is docs-only commits; and S-4 and the V-5 protection setting are user dashboard steps, so they are usually "not read" and listed first.
- [ ] **Q-D5b-4: Is local `main` current?** DO cannot `git fetch`, so the repo files it reads on `main` can be stale.
  *Suggested:* DO takes local `main`'s head (`git log -1` on `main`) and runs the `github-ops` §6 step 2 compare read on it. `identical` means local `main` is current. Anything else (`behind` is the usual case, or a 404) means it is not: every repo-sourced check is then "not read (local `main` stale)", and the main session fetches and re-runs. The report names the commit read. (No new command: this is the existing landed-on-`main` read.)
  *(SA ruling: accepted with one change. The ref is `origin/main`, not local `main`; see SA Review — DO-5b.)*

---

## DO-6 Specification — third-party-ops skill

**By BA — 2026-11-01.** Branch `feature/devops-third-party-ops`. Config/docs-only slice: no application code, no CI job, no CI time.

DO-6 builds on `devops.md`, `env-change-protocol`, `vercel-ops`, `supabase-ops` and `env-drift-audit`, and **does not repeat them**. The eight steps, the tiers, the approval channel, the order against the deploy, the change-record template, the public-repo rule, DO's tool list, the read-only SQL rules (a)–(d), how to set and verify a Vercel env var, and which deployment holds a value all stay where they are. `third-party-ops` holds only what is specific to each external platform: what must differ between environments, where the code reads it, the dashboard step the user performs, the app-side probe, and the platform's gotchas.

**DO holds no third-party tool** (`devops.md` § What You Own, "Platforms without a tool"; its `tools:` line has only Supabase and Vercel MCP tools). For every platform in this skill the user operates the dashboard. DO plans from the repo and verifies from the app side. DO-6 changes nothing in `devops.md` except one pointer line.

### D6.0 Recommended split (Q-D6-2)

The inventory pass (names only, no `.env*` file opened) found about 12 platform-core vendors and about 10 plugin OAuth apps. One slice is too large. Each slice below adds one reference file to the skill and one row to its platform index. Order: the platform whose misconfiguration costs money or blocks customers first.

| Slice | Platform family | Scope (one line) |
|---|---|---|
| **DO-6a** | Skill skeleton + **Stripe** (platform and Connect) | The shared rules and the per-platform template; Stripe keys and mode, webhook endpoints and signing secrets, endpoint API version, Connect client and OAuth redirect URIs, portal configuration, plan prices. **Fully specified below.** |
| DO-6b | Email: Resend, SMTP, Gmail system sender | Resend key and sending domain (SPF, DKIM, DMARC records), sender address, Resend webhook and its subscribed events; SMTP relay settings; the Gmail fallback sender; the transport's fallback order. |
| DO-6c | Google Cloud | Sign-in client and plugin OAuth client, consent screen and verification, redirect URIs per environment, enabled APIs, browser-key restrictions for Places, the Search key. |
| DO-6d | LLM providers | OpenAI, Anthropic, Groq and Kimi keys and spend limits per environment; the model-name env vars; Mistral noted as not wired (below). |
| DO-6e | Domains, registrar and DNS | The three address names (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, `NEXT_PUBLIC_PUBLIC_SITE_HOST`), the wildcard public-site host, registrar renewal and lock, which DNS records belong to which platform (pointers to `vercel-ops` and DO-6b). |
| DO-6f | Queues, AWS and small API-key providers | QStash token, URL and the current/next signing keys (rotation), callback address per environment; AWS Textract credential and region; Pexels; the two FX-rate providers. |
| DO-6g | Messaging apps (Meta, Slack) | WhatsApp Business app (client, configuration, webhook verify token), Meta Ads app on the same developer platform, Slack app redirect URIs; the tunnel names that are local-only. |
| DO-6h | Plugin OAuth apps | Airtable, Discord, Dropbox, HubSpot, LinkedIn, Microsoft, Notion, Salesforce: one table, since each is "client ID and secret per environment, redirect URI from the app address". |

Each later slice gets a short BA scoping pass and an SA short pass before build, like DO-5b.

**Inventory points the BA confirmed from code:**

- **SendGrid is not a transport.** `lib/notifications/emailTransport.ts` returns `provider: 'resend' | 'smtp' | 'gmail' | 'none'` and tries Resend, then SMTP, then Gmail. SendGrid appears there only in a comment listing SMTP relays the SMTP path can use. The other two mentions the inventory found (`EmailAutomationRepository`, the replay route) were not re-read; DO-6b re-checks them.
- **Mistral has no key name.** `lib/ai/providers/mistralProvider.ts` takes its key through its constructor, and `lib/ai/providerFactory.ts` never constructs it (`PROVIDERS` lists openai, anthropic, kimi, groq). Nothing reads a Mistral key, so there is nothing to configure until a caller wires it. DO-6d records this as "not wired"; it is not a gap.
- **The repo already has a complete env-var name catalogue.** `lib/admin/environment/catalogue.ts` lists every name the application reads, with its group (`payments`, `email`, `ai`, `plugins`, `external`, `jobs`, …), sensitivity class, and an `expectedIn` of required / optional / forbidden for production, preview and local. A drift guard (`lib/admin/environment/__tests__/catalogueDrift.guard.test.ts`) fails the Jest gate when code reads a name the catalogue lacks. This is a better expected-names source than the two `env-drift-audit` V-2 uses (Q-D6-6). The admin Environment page (`/admin/environment`, route `app/api/admin/environment/route.ts`) shows, **on the deployment it is served from**, each name as Set / Not set (secrets) and flags `required-not-set` and `should-not-be-set`. It never shows a secret value.

### D6.1 Context and findings (Stripe, checked 2026-11-01)

| # | Finding | Consequence for DO-6a |
|---|---|---|
| F1 | `lib/business-os/billing/stripeMode.ts` takes the mode from the secret key's prefix (test or live) and fails closed on anything else. Test-mode and live-mode billing rows share one database, and code reads the row of the current mode. | The key's **mode** is configuration, not only a credential. A key in the wrong mode makes the app read the other mode's billing rows. The skill states the generic `sk_test_` / `sk_live_` concept only. |
| F2 | `app/api/stripe/webhook/route.ts` tries `STRIPE_WEBHOOK_SECRET`, then `STRIPE_CONNECT_WEBHOOK_SECRET`, against every delivery. Its comment says Connect events may arrive at the same endpoint or a separate one, "a dashboard setting nobody here controls". No secret set → 500 "Webhook secret not configured"; no secret matches → 400 "Invalid signature" and **no claim row is written**. | Which endpoint layout is in use is a dashboard fact for the private inventory. The two outcomes give a probe that can fail. |
| F3 | The route records each verified event in `processed_webhook_events` (`lib/repositories/ProcessedWebhookEventRepository.ts`): `processing` → `completed`, or `failed` so a retry reclaims it. A delivery of an event already `completed` returns 200 with `duplicate: true` and runs no handler. Every line after verification carries the event's `livemode`. | **Re-sending an already-delivered event from the Stripe dashboard is a safe production probe:** it proves the signing secret and moves no money. A `failed` event would be reprocessed, so the probe uses only an event shown as delivered with 2xx. |
| F4 | The SDK is pinned: `STRIPE_API_VERSION` in `lib/business-os/billing/stripeClient.ts`, kept equal to the version in `lib/stripe/StripeService.ts` by a guard test. `lib/payments/invoiceSubscription.ts` records a real defect: a field moved between API versions, casts hid it, and plan periods were charged in Stripe and recorded as nothing. Webhook payloads follow the **endpoint's** API version, which is set in the dashboard. | Endpoint API version ≠ the pin is drift with money impact. The skill names the file to read the pin from, never the value. |
| F5 | The production event list in `docs/STRIPE_WEBHOOK_SETUP_GUIDE.md` (Part 2, five events) is behind the route, which also acts on refund, dispute, payment-intent, checkout-expiry and Connect subscription events. The retrospective `docs/retrospectives/STRIPE_CONNECT_REFUND_WEBHOOK_RETROSPECTIVE.md` (FU-7, A-11) requires the Connect endpoint to be subscribed to the three `refund.*` events. The route now ignores `charge.refunded`. | The skill **derives** the event list from code at `origin/main` and never copies a list. The stale guide is a follow-up (Q-D6-10). |
| F6 | Connect OAuth: `app/api/payments/stripe-connect/oauth-link/route.ts` reads `STRIPE_CLIENT_ID` and builds its redirect from `platformOrigin()` (`lib/utils/origins.ts`), which refuses a loopback address on Vercel. The plugin path uses `app/oauth/callback/[plugin]/route.ts` and `NEXT_PUBLIC_STRIPE_CLIENT_ID` (placeholder in `lib/plugins/definitions/stripe-plugin-v2.json`). `docs/STRIPE_CONNECT_SETUP_GUIDE.md` §2.2 registers both callback paths. | Each environment's address needs **both** callback paths registered in the Connect OAuth settings of the matching mode. |
| F7 | `lib/business-os/billing/portalConfiguration.ts` refuses to open the customer portal when `STRIPE_BOS_PORTAL_CONFIGURATION_ID` is missing, unreadable, in the other mode, inactive, or allows more than card and invoices. Each refusal logs `bos_billing_portal_configuration_missing`, `_unreadable` or `_mismatch` with `alert: true`. It is created by `scripts/setup-bos-portal-configuration.ts`, which stops on drift. | An existing app-side probe that fails when the setting is wrong. |
| F8 | `lib/business-os/billing/planPriceCatalog.ts`: plan prices are found by lookup keys that are the same in both modes. `BUSINESS_OS_PLAN_PRICES_ENABLED` is turned on per environment only after `scripts/check-bos-plan-prices.ts` passes against that environment's Stripe account. The script is read-only, takes the key from a file **outside every git checkout** (`scripts/lib/stripe-script-guards.ts`), never prints the key, and stops if the key belongs to another account than the one the operator names. | A readiness check the user (key holder) runs before a flag is turned on. It checks a key file, not the deployed value, so it is a **pre-check**, never the post-change probe (protocol step 4). |
| F9 | `lib/client/stripeJs.ts` checks only the publishable key's **shape**, and the key is a `NEXT_PUBLIC_` name, so it is inlined at build. | A publishable key from the other mode or another account passes the shape check. Changing it needs a new build (`vercel-ops` §4). |
| F10 | Older scripts such as `scripts/check-stripe-webhook-status.ts` pin an older API version and print object IDs, endpoint URLs and metadata. | They are not probes for this skill. Only the guarded Business OS scripts (F8) are named. |
| F11 | `lib/admin/environment/catalogue.ts` group `payments` expects: secret key and publishable key required in production and preview; platform webhook secret required in production, optional in preview; Connect webhook secret, client IDs and portal configuration optional everywhere. | The expected **names** per environment come from the catalogue at `origin/main`. The expected **values and modes** come from the private inventory. |

### D6.2 What the skill must teach

#### D6.2.1 Shared rules (`SKILL.md`, every platform)

Each item says what the skill states. It reads like the other ops skills: a pointer table first, numbered sections, a closing checklist.

**(a) Pointer table.** `env-change-protocol` (steps, tiers, approval, order against deploy, record template, public-repo rule); `devops.md` (no third-party tools, what DO may write, § Report Format); `vercel-ops` §2–§4 (env var names by target, value-bearing responses, which deployment holds a value, `NEXT_PUBLIC_` rebuild, who probes what); `supabase-ops` §2 and `devops.md` rules (a)–(d) (any SQL evidence); `env-drift-audit` (where the third-party checks join).

**(b) Scope.** A third party is any external service the code calls, imports an SDK of, or reads an env var for. The list of names is `lib/admin/environment/catalogue.ts` at `origin/main`, by group. A name in code that the catalogue lacks fails the drift guard, so DO never searches the code for names. Our own shared secrets (the cron secret, the link-signing secrets, the agent-run webhook secret, the IP salt) are **not** third parties: they follow `env-change-protocol` and `vercel-ops` only (Q-D6-11).

**(c) Who does what.**

| Step | Who |
|---|---|
| Read the repo (names, callback paths, event types, pinned versions) | DO or the main session |
| Read or change anything in a vendor dashboard | **The user.** DO gives the exact step by area name and asks for a report of presence, mode, status and last-updated time: never a value. |
| Move a value from the dashboard to Vercel | The user, per `vercel-ops` and `env-change-protocol`. **The value never passes through chat or a file.** |
| Probe the deployed surface | Browser or HTTP probe: the main session or the user (`vercel-ops` §4, "Who probes what"). Server-side evidence: DO, from that deployment's runtime logs, by counts and message class. |

**(d) The per-platform template.** Every reference file has the same six parts, so later slices only add a file: (1) what must differ between environments, (2) where the code reads it (names and files), (3) the dashboard steps, (4) probes, (5) gotchas with their repo grounding, (6) its drift checks (Q-D6-5).

**(e) Common rules.**

- **Mode and account per environment.** When a vendor has test and live modes or separate accounts, which one each environment uses is recorded in the private inventory by role. Every credential of that vendor in one environment must be the same mode and the same account.
- **One webhook secret per endpoint.** A signing secret belongs to one endpoint at one address. Each environment that receives webhooks has its own endpoint and its own secret. A local listener has its own secret too.
- **Redirect URIs come from the app address.** Each environment's address (`NEXT_PUBLIC_APP_URL`, read through `platformOrigin()`) plus the callback path must be registered with the vendor, per environment. Preview deployment URLs change per deployment, so only a stable address can be registered.
- **Rotation overlaps.** Set the new credential, wait for the deploy that carries it to be Ready, probe it, and only then revoke the old one (after deploy). Whether and how long a vendor keeps the old one valid is checked in the vendor's docs at use time, not hardcoded.
- **Verify the deployed value, never the key in hand.** A script the user runs with a key file is a pre-check. The post-change probe goes through the deployed surface (protocol steps 4 and 5).
- **Never a live money event as a probe.** In production, probe with a replay the code treats as a duplicate, or with a page that loads without paying.
- **Public repo.** Tracked text names vendors and environments by role. Never an account, client, endpoint, configuration or price identifier, an endpoint URL, a key prefix beyond the generic test/live concept, or which setting is wrong today.

**(f) Platform index.** One row per platform family: its reference file, or "not covered yet (DO-6x)". Until a family is covered, its drift checks are "not audited".

#### D6.2.2 Stripe (`stripe.md`, DO-6a)

**(1) What must differ between environments**

| Setting | Production | Preview | Local | Why (finding) |
|---|---|---|---|---|
| Secret key mode | live | test | test | F1. Suggested; the user confirms (Q-D6-1). |
| Publishable key | Same mode **and** same account as that environment's secret key | same rule | same rule | F9 |
| Connect client (both client-ID names) | The client of that mode | same rule | same rule | F6 |
| Connect OAuth redirect URIs | That environment's address + both callback paths, in that mode's Connect settings | Only a stable Preview address, if Preview runs Connect (Q-D6-3) | Loopback + both paths, test mode | F6 |
| Webhook endpoint and signing secret(s) | An endpoint at the production address, in live mode; secret(s) per the recorded layout (one endpoint or two) | Only if Preview receives webhooks (Q-D6-3) | The Stripe CLI listener and its own secret | F2, F11 |
| Endpoint subscribed events | Every event type the route acts on, derived from code at `origin/main`; the Connect side includes the three `refund.*` events | same rule | the CLI's `--events` list in the setup guide, which lags too (F5) | F5 |
| Endpoint API version | Equal to `STRIPE_API_VERSION` at `origin/main` | same | the CLI's version, checked at use time | F4 |
| Portal configuration | One created in that mode by the setup script | same rule, test mode | same | F7 |
| Plan prices | Present in that account with the lookup keys, before `BUSINESS_OS_PLAN_PRICES_ENABLED` is on there | same | same | F8 |
| Which Stripe account | Private inventory | Private inventory | Private inventory | Public-repo rule |

**(2) Where the code reads it**

| Name | Read in |
|---|---|
| `STRIPE_SECRET_KEY` | `lib/stripe/StripeService.ts`, `lib/business-os/billing/stripeClient.ts`, `lib/business-os/billing/stripeMode.ts` (and many callers through them) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `lib/client/stripeJs.ts` (build-inlined) |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | `app/api/stripe/webhook/route.ts` |
| `STRIPE_CLIENT_ID` | `app/api/payments/stripe-connect/oauth-link/route.ts` |
| `NEXT_PUBLIC_STRIPE_CLIENT_ID` | `lib/plugins/definitions/stripe-plugin-v2.json` (placeholder) |
| `STRIPE_BOS_PORTAL_CONFIGURATION_ID` | `lib/business-os/billing/portalConfiguration.ts` |
| Event types the route acts on | the `switch` in `app/api/stripe/webhook/route.ts`, plus the Business OS resolvers it calls first (`lib/business-os/billing/webhookDispatcher.ts`, `planCheckoutSessionEvents.ts`, the boost resolver) |
| API version pin | `STRIPE_API_VERSION` in `lib/business-os/billing/stripeClient.ts` |
| Expected names per environment | `lib/admin/environment/catalogue.ts`, group `payments` |

The flags `BUSINESS_OS_PLAN_PRICES_ENABLED`, `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` and `BUSINESS_OS_CREDITS_BOOST_ENABLED` are ours, not Stripe's. The skill names them only as "depends on the Stripe state above", and points to `docs/feature_flags.md`.

The skill gives each file path once and the reader confirms it at use time. If a path has moved, the catalogue names the variable and the reader finds where it is now read.

**(3) Dashboard steps (the user)**

By area name, because the vendor's UI moves; the skill says "confirm the path in the dashboard at use time":

- API keys area, in the right mode: create, roll or restrict a key. A key roll is production tier.
- Webhooks area: the endpoint's address, mode, "events on your account" or "on connected accounts", subscribed events, API version, recent deliveries, roll secret, resend an event.
- Connect settings, OAuth: the client ID of that mode, and the redirect URI list.
- Customer portal configuration: created and checked by `scripts/setup-bos-portal-configuration.ts`, never edited by hand.
- Setting the value on Vercel: `vercel-ops` and `env-change-protocol`; not restated.

Existing setup docs (`docs/STRIPE_WEBHOOK_SETUP_GUIDE.md`, `docs/STRIPE_CONNECT_SETUP_GUIDE.md`, `docs/STRIPE_ENV_SETUP.md`) are linked for click-paths, with the warning that their event lists lag the code (F5).

**(4) Probes** (each fails when the setting is wrong)

| Change | Probe | Fails when | Who | Evidence |
|---|---|---|---|---|
| Webhook signing secret (set, rolled, layout changed) | The user resends an event from the endpoint's delivery list that already shows a 2xx delivery, after the deploy is Ready (F3) | Wrong or missing secret: 400 "Invalid signature" or 500 "Webhook secret not configured" in the dashboard delivery row | User (dashboard); DO (logs) | The dashboard's status for that delivery (user reports it), and that deployment's runtime logs on the webhook path in a window after the resend: counts by level, plus the message class ("Received event" / "Signature verification failed" / "No Stripe webhook secret configured"). Never a copied line. |
| Endpoint subscribed events | DO derives the expected types from code (§2); the user reads the endpoint's list | A type the route acts on is not subscribed | DO + user | Names compared, in the change record by count ("all N present", or the missing type names, which are public code facts) |
| Endpoint API version | The user reports the endpoint's version; DO reads the pin at `origin/main` | They differ | DO + user | Both by role ("equals the pin": yes/no) |
| Secret key mode / account | The main session or user opens the plan checkout on **that** deployment without paying. The vendor marks test mode in the checkout. | Production shows test mode, or a non-production deployment does not | Main session or user | Screenshot-free report: "test mode badge shown: yes/no", the deployment by role, the time |
| Publishable key | Same checkout: the frame loads | Not configured (the app shows its "not configured" line), or wrong mode or account (the frame fails to load; expected Stripe error class) | Main session or user | Loaded: yes/no, error class only |
| Connect client and redirect URIs | The main session or user starts "connect an existing Stripe account" on that deployment and **stops at the vendor's authorise page** | The vendor's page shows an error for an unknown client or unregistered redirect URI (Dev confirms against the vendor's docs at build) | Main session or user | Page loaded without error: yes/no; mode shown |
| Portal configuration | The user opens Settings → Plan → Update card on that deployment | Refused: "not available right now", and a `bos_billing_portal_configuration_*` line with `alert: true` (F7) | User; DO (logs) | DO: count of those event names in that deployment's logs after the probe time = 0 |
| Plan prices before the flag | `npm run check-bos-plan-prices` with the key file outside every checkout and the expected account named (F8) | Any FAIL row, or a refusal | User (key holder) | VERDICT row only. It is a pre-check; after the flag is on, the post-change evidence is that deployment's logs showing no new `bos_billing_event_denied` with reason `unknown_price` for a test-mode plan invoice |

Supporting SQL evidence (DO, rules (a)–(d), counts only): `processed_webhook_events` rows after the change time, grouped by `status` and by the `livemode` in its metadata. Because the table is shared by whichever deployments use that database, it is **supporting** evidence only; the per-deployment runtime logs are primary (Q-D6-8).

**(5) Gotchas** (each with its grounding)

- **The mode is in the key** (F1). A test key on production does not fail loudly: the app reads test-mode billing rows.
- **The publishable key's shape check passes a key from the wrong mode or account** (F9). It is build-inlined: a change needs a new build (`vercel-ops` §4).
- **A signature failure writes nothing** (F2). An empty `processed_webhook_events` window does not prove "no events"; read the deployment's logs and the dashboard's delivery status too.
- **Resend only a delivered event** (F3). A resend of a `failed` event reprocesses it, which can move money.
- **Never send a synthetic test event to production.** It runs the handlers with fabricated objects. Synthetic events are for a test-mode endpoint.
- **The endpoint's API version decides the payload shape** (F4). A version change is a code change first (Dev moves the pin, SA reviews). The endpoint follows **after** the deploy with the new pin is Ready. Whether the vendor allows a parallel endpoint for the overlap is checked in its docs at use time.
- **The setup guides' event lists are stale** (F5). Derive from code at `origin/main`. `charge.refunded` is ignored by the route; refunds come from `refund.*` on the Connect side.
- **Two callback paths, two client-ID names** (F6). Registering one path leaves the other flow broken.
- **The portal never falls back to the vendor's default** (F7). A missing configuration closes Update card on purpose. Create it with the script per mode; never hand-edit it.
- **Key files stay outside every checkout** (F8). The guarded scripts refuse otherwise. The other Stripe scripts in `scripts/` print identifiers and are not used here (F10).
- **Preview addresses change per deployment** and Preview is behind deployment protection (Q-D6-3). A webhook or OAuth redirect can only target a stable address. A probe that meets the protection page is "not probed" (`vercel-ops` §4).

**(6) Tiers** (Q-D6-9). Adding or changing a **test-mode** webhook endpoint is reversible (`devops.md` already lists it). Anything in live mode, any key creation, roll or revoke, Connect OAuth settings, and a live portal configuration are production tier: SA reviews the plan, the user executes.

**(7) Order against the deploy** (the protocol's table, applied to Stripe)

| Change | When |
|---|---|
| A new Stripe name the merging code requires | Before merge (set on every target the catalogue marks required) |
| A webhook endpoint or event type the merging code starts to handle | Before merge (an unsubscribed type is simply never delivered) |
| Key or secret roll | Set new → deploy Ready → probe → revoke old **after deploy** |
| API version change | After the deploy that moves the pin |
| `BUSINESS_OS_PLAN_PRICES_ENABLED` on | After `check-bos-plan-prices` passes for that environment's account |

#### D6.2.3 How it plugs into `env-drift-audit`

Third-party checks join as a fifth area, **Third-party**, one platform at a time. A platform not yet covered stays "not audited". For DO-6a (rows held where Q-D6-5 decides; IDs are new):

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-ST-1 | Every `payments`-group name the catalogue marks required for an environment is on that Vercel target; none it marks forbidden is present | `lib/admin/environment/catalogue.ts` at `origin/main`; private inventory (project per role) | `vercel-ops` §3 Env vars | High | DO |
| T-ST-2 | No Stripe name beyond the publishable key and the two client-ID names carries the `NEXT_PUBLIC_` prefix | Catalogue at `origin/main` | `vercel-ops` §3 Env vars (names only) | Critical | DO |
| T-ST-3 | Mode and account per environment: secret key, publishable key, Connect client and portal configuration all in the recorded mode and account | Private inventory | User report (dashboard); the checkout probe; portal-refusal log count | Critical | User; DO (log count) |
| T-ST-4 | Each recorded webhook endpoint: enabled, right address and mode, account / connected-accounts side as recorded, subscribed to every type the code acts on, API version equal to the pin | Code at `origin/main` (types, pin); private inventory (layout) | User report (dashboard) | High | User; DO (the code side) |
| T-ST-5 | Webhook delivery health: no signature failures and no handler failures on the webhook path since the last recorded run | Change records | That deployment's runtime logs (`vercel-ops` §3); supporting `processed_webhook_events` counts by status (`supabase-ops` §2, rule (c)) | High | DO |
| T-ST-6 | Connect OAuth redirect URIs: both callback paths registered for each environment's address in the matching mode | Code at `origin/main` (paths); private inventory (addresses) | User report (dashboard) | High | User |
| T-ST-7 | Portal configuration passes the setup script's check, and plan prices pass where the plan-price flag is on | Scripts at `origin/main`; private inventory (where the flag is on) | `scripts/setup-bos-portal-configuration.ts`, `scripts/check-bos-plan-prices.ts`, run by the key holder | High | User |

`env-drift-audit` edits for DO-6a: §1, "Third-party platforms are 'not audited' until a skill for them exists" becomes "…until `third-party-ops` covers them; see its platform index". §3 gains a Third-party row pointing to `third-party-ops`. §6 summary item 3 becomes "Third-party: per platform, audited or not audited". §7 gains the rows above, or one pointer line to them (Q-D6-5). Nothing else changes.

### D6.3 Files to change (DO-6a)

| # | File | Action | What |
|---|---|---|---|
| D6-1 | `.claude/skills/third-party-ops/SKILL.md` | New | §D6.2.1. Target ≤ ~120 lines. Frontmatter `name: third-party-ops`. The description fires on: Stripe, a payment key, a webhook endpoint or signing secret, test or live mode, a Connect setting, a customer portal configuration, an OAuth redirect URI or client, a vendor API key, a sending domain, a vendor dashboard, "is the integration configured", and each later family's names as it is added. It says it is used by the main session and DO. |
| D6-2 | `.claude/skills/third-party-ops/stripe.md` | New | §D6.2.2. Target ≤ ~170 lines. |
| D6-3 | `.claude/agents/devops.md` | Edited | One pointer line after the "Platforms without a tool" paragraph: "Procedures, probes and gotchas per third-party platform: the `third-party-ops` skill." **`tools:` unchanged; nothing else changes.** |
| D6-4 | `.claude/skills/env-drift-audit/SKILL.md` | Edited | The four edits in §D6.2.3, per the Q-D6-5 ruling. |
| D6-5 | `.claude/skills/env-change-protocol/SKILL.md` | **Not edited** | It already names third-party platforms in its scope line and description. |
| D6-6 | `CLAUDE.md` | **Not edited** | The DO row and the env-change-protocol route already cover it. |
| D6-7 | This requirement | Edited | Status, implementation notes, reviews. |

### D6.4 Acceptance criteria (DO-6a)

- [ ] `.claude/skills/third-party-ops/SKILL.md` exists. Frontmatter `name: third-party-ops` matches the folder, and the `description` parses cleanly and fires on the D6-1 triggers.
- [ ] SKILL.md holds (a)–(f) of §D6.2.1 and links `stripe.md` from its platform index. Every other family shows "not covered yet" with its slice number.
- [ ] `stripe.md` holds the seven parts of §D6.2.2. Every file path it names exists in the worktree.
- [ ] No restatement. QA greps both new files for `Snapshot the before-state`, `| **Read** |`, `begin read only`, `filter_project_envs` and `decrypt`: 0 hits, or each hit is a pointer.
- [ ] No copied lists. The skill holds no Stripe event-type list and no API version value. It names the files they are derived from. QA greps `stripe.md` for a dated version string (`20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]\.`): 0 hits.
- [ ] Probes. Each row of the probe table names who runs it and what it returns when the setting is wrong. No probe needs DO to hold a secret. The production webhook probe is the resend of an already-delivered event, never a synthetic event.
- [ ] Public repo. The finding-11 regex from §7 over the added lines returns zero hits, or each hit is explained in the QA report. QA also greps the added lines for vendor identifier prefixes other than the generic `sk_test_` / `sk_live_` concept (account, client, endpoint, signing-secret, portal-configuration, price and publishable-key prefixes): 0 hits. QA reads the diff for an endpoint URL, a domain, an account or a weakness.
- [ ] `devops.md` diff is exactly the one pointer line (D6-3). `tools:` is unchanged.
- [ ] `env-drift-audit` diff is exactly the D6-4 edits. Its other checks, classes and summary order are unchanged.
- [ ] The diff touches only the D6.3 files.

### D6.5 Open questions

**For the user (business):**

- [ ] **Q-D6-1: Which Stripe mode does each environment use?**
  *Suggested:* production live; Preview and local test, always. A live key never sits on a non-production target. The account each mode belongs to stays in the private inventory.
- [ ] **Q-D6-2: Is the slice order right?**
  *Suggested:* the order in §D6.0: Stripe, email, Google, LLM providers, domains and DNS, then queues/AWS/small providers, messaging apps, plugin OAuth apps. Money and customer-facing mail first. Plugin apps last, because a broken one affects one plugin, not the platform.
- [ ] **Q-D6-3: Should payments work end to end on Preview?** Today the catalogue marks the platform webhook secret optional on Preview, and Preview addresses change per deployment.
  *Suggested:* no, for now. Preview would use test keys for checkout and the portal. Webhooks and Connect OAuth are tested locally with the Stripe CLI listener and the loopback redirect. If end-to-end Preview testing is wanted, SA designs it (a stable Preview address, and how a vendor reaches it through deployment protection).

**For SA (technical):**

- [ ] **Q-D6-4: Skill layout.**
  *Suggested:* one `SKILL.md` (shared rules + platform index) and one reference file per platform family. Each later slice adds a file and an index row, and never edits another family's file.
- [ ] **Q-D6-5: Where do the T- drift checks live?**
  *Suggested:* in each platform's reference file, in `env-drift-audit` §7's column format, with one pointer line in §7 ("T- checks: `third-party-ops`, each platform's drift section"). This keeps `env-drift-audit` near its ~150-line target, and later slices do not edit it again. The alternative is all rows in `env-drift-audit` §7.
- [ ] **Q-D6-6: Use the environment catalogue as the expected-names source.**
  *Suggested:* yes for T-ST-1 and T-ST-2. `lib/admin/environment/catalogue.ts` is complete by its drift guard and carries `expectedIn` per environment. It holds no values, so DO may read it. Whether `env-drift-audit` V-2 should also move from `featureFlags.ts` + `.env.example` to the catalogue is a separate follow-up for SA. It is not in DO-6a.
- [ ] **Q-D6-7: Does DO get any Stripe access?**
  *Suggested:* no, not in DO-6a. DO holds no Stripe tool or key. Stripe reads are the user's dashboard reports, plus the guarded scripts run by the key holder. Revisit only if a vendor MCP with a read-only, mode-scoped credential exists. That would be a harness change under `claude-harness-ops`.
- [ ] **Q-D6-8: SQL evidence from `processed_webhook_events`.**
  *Suggested:* allowed for DO, as counts by `status` and by metadata `livemode` in a stated window (rules (a)–(c)). It is not a rule (d) table: it holds event IDs and status, no credential. It is supporting evidence only, because more than one deployment may write to the same database. The primary evidence is that deployment's runtime logs.
- [ ] **Q-D6-9: Tiers for Stripe changes.**
  *Suggested:* §D6.2.2(6). A test-mode endpoint is reversible. Live mode, keys, Connect OAuth settings and a live portal configuration are production tier.
- [ ] **Q-D6-10: The stale setup guides (F5).**
  *Suggested:* not fixed in DO-6a, which stays inside `.claude/`. Log a follow-up (Dev, docs-only) to replace the event lists in `docs/STRIPE_WEBHOOK_SETUP_GUIDE.md` with a pointer to how the list is derived. The skill already derives the list from code and copies none.
- [ ] **Q-D6-11: Our own shared secrets.**
  *Suggested:* out of DO-6. The cron secret, the link-signing secrets, the agent-run webhook secret and the IP salt follow `env-change-protocol` and `vercel-ops`. The QStash signing keys are third-party (DO-6f).
- [ ] **Q-D6-12: Deriving the event list.** The route is long, and the Business OS resolvers decide some types before its `switch`.
  *Suggested:* the skill names the files (§D6.2.2(2)), and Dev records the derivation steps at build, checked once against the current code. If deriving the list proves unreliable, a code-side constant is a later Dev change, not part of DO-6a.

---

### D6.6 User decisions (2026-11-01)

| Q | Decision |
|---|---|
| Q-D6-1 | Target: production live, Preview and local test. DO-6a records the **current** setup as found and changes nothing; the per-environment key mode is checked by T-ST-3 and the checkout probe. What the live check found is recorded privately, not here. Any change is a later decision by the user. |
| Q-D6-2 | Order accepted. The user asked to confirm every service is still in use. The main session checked QStash (the one the user doubted): it is still in use, so it stays in DO-6f. **Each later slice starts by confirming its services are live** (a code path that runs, and the names set on Vercel) and drops any that are not. |
| Q-D6-3 | The user does not want Preview's payment setup changed now. DO-6a records Preview as it is; no slice in DO-6 changes Preview's Stripe setup. |

---

## DO-6b Specification — email (third-party-ops)

**By BA — 2026-11-01; SA changes 1–12 applied by Dev, 2026-11-01.** Short scoping pass, like DO-5b. Config/docs-only slice: no application code, no CI job, no CI time. It adds one reference file and one index row to `third-party-ops`, under SKILL.md §1–§4 and SA Review — DO-6 (changes 1–7 apply to every DO-6 slice: a probe has a precondition or it is "not probed", a roll overlap makes a pass "not conclusive", per-side derivation from code, no copied lists, T- rows live in the platform file).

**Services live (Q-D6-2 rule):** the main session confirmed on 2026-11-01 that all three are still in use, so all three stay.

### D6b.1 Context and findings from code

Read in the DO-6b worktree at `origin/main` (merge of #604). Line numbers are pointers for SA; the skill names files and functions only, never line numbers.

| # | Finding | Where | Consequence for `email.md` |
|---|---|---|---|
| E1 | **One transport, three providers, fixed order.** `sendEmail` tries Resend, then SMTP, then Gmail, then returns `provider: 'none'`. Each provider is used only when all its names are set: Resend needs the key and a prefix shape check; SMTP needs host, port, user and pass; Gmail needs user, client ID, client secret and refresh token. A partial set leaves no "skipped" line, but "Attempting to send email" carries `resendConfigured`, `smtpConfigured` and `gmailConfigured` as booleans. | `lib/notifications/emailTransport.ts`: `resendConfigured` / `smtpConfigured` / `gmailConfigured` (375–396), the chain (1033–1131) | All-or-none per provider (T-EM-3). DO reads the boolean fields. |
| E2 | **A broken Resend key fails silently over to the next provider.** A key with the wrong shape logs one warn and skips Resend. A key with the right shape that Resend refuses logs "Resend API error" and "Resend send failed — trying next transport", then SMTP or Gmail sends it and the caller sees `sent: true`. The invalid-key line holds the vendor's key prefix, so only the substring "not a valid Resend key" is quoted. | 1039–1068 | "Mail is going out" does not prove Resend works. The probe checks which **provider** sent it. |
| E3 | **Keyed sends never fall back.** A keyed send that fails at Resend logs "Resend keyed send failed — no fallback for a keyed send" on every deployment and stops. In production (`VERCEL_ENV === 'production'`) a keyed send with no Resend is refused (`idempotency_unsupported`). Elsewhere it goes out through SMTP or Gmail without the key, with one warn. | 885–908, 1042–1074 | In production, Resend is effectively required for keyed mail. See E9. |
| E4 | **The sender address comes from `RESEND_FROM_EMAIL` for all three providers.** `sendEmail` sets `from` before any provider runs. So `SMTP_FROM` and `SMTP_FROM_NAME` never take effect, and on SMTP fallback mail carries the Resend-domain From through another relay, which may be refused or fail alignment. Gmail is handed that `from` as well, but the vendor overwrites From with the authenticated account unless the address is a verified send-as alias (vendor fact, confirm at use time). The `sendViaGmail` comment says the code ignores the caller's `from`, and the code does not. | 1027–1031, 688–692, 740, `resolveSender` | Gotcha split by provider. FU-D6b-b. |
| E5 | **`platformSenderAddress()` gates many senders, fail closed.** It reads only `RESEND_FROM_EMAIL`. Fail-closed callers: the admin invitation, the friend invite, the inviter notification, the invite redemption system emails (the signup code and the existing-account notice), and the plan-cancel emails including their reminder cron. The data-export callers pass the result as `from` and are **not** gated: an unset value falls through to the transport's default. The header comment "read by nobody else" is stale. | 549–556; `lib/business-os/invites/*`; `lib/business-os/billing/planCancelEmailDeps.ts` | A missing or malformed sender address stops invite-only signup, invitations and the plan-cancel mail; logged and audited, never a failed request. Callers found at use time. |
| E6 | **Resend webhook: one secret, fail closed, Svix format.** `RESEND_WEBHOOK_SECRET` missing → 401 and an error line, on every deployment (the header says "in production", the code checks everywhere). Bad or missing signature → 401, "Webhook signature did not verify"; same body as a missing secret, so only the log class tells them apart. A timestamp outside `MAX_AGE_SECONDS` logs "Webhook rejected: timestamp outside the replay window" before the signature line. The check accepts any one of several signatures (vendor rotation overlap). | `app/api/webhooks/resend/route.ts`: `POST`, `verify` | The 401 gives a probe that can fail; timestamp and overlap results in the probe. |
| E7 | **Event types are derived from the route, never listed.** The acted-on set is the `toDeliveryEvent` cases that return non-null, minus those the header marks not subscribed. The `ResendEventType` union is not the list: it holds a type that returns null. Resend has one side only, so DO-6 change 5 (per side) does not apply. | route header, `toDeliveryEvent` | Derived at `origin/main` each time. The skill names no type. |
| E8 | **Webhook outcomes, all logged by class.** Unparseable → 200, "Webhook body was not JSON". No id or type, or an unacted type → 200, no line. Unmatched message id → 200, info "No email_sends row carries this message id". Nothing new → 200, **debug** "Delivery event added nothing new". Written → 200, info "Email delivery event recorded". Write error → 500, "Could not record the delivery event". | route `POST`; `lib/business-os/emailSendStatus.ts` | At the default production log level a duplicate's line is not visible, so a pass is "200, and 0 failure classes". |
| E9 | **The catalogue marks every `email` name optional everywhere**, while E3 and E5 make Resend and its sender address needed in production. `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` is in group `features`, so T-EM-1 does not see it. | `lib/admin/environment/catalogue.ts` group `email` | Expected names per environment come from the private inventory (FU-D6b-a). The skill names the flag in part (2). |
| E10 | **`email_sends.provider` records which provider sent each recorded mail.** `sendgrid` is only the column's historic default: no code writes it. Only mail tied to a contact is recorded. The table also holds recipient, subject and body columns. | `lib/repositories/EmailAutomationRepository.ts`; `lib/notifications/recordEmailSend.ts` | Supporting SQL: counts by `provider` and `status`, filtered on `created_at`; no other column. |
| E11 | **SendGrid re-check (D6.0): not a transport anywhere.** The admin messages replay route's defects are already tracked (ADMIN_BOS_CLEANUP NF-6, V-12). | — | Not configuration, so not in `email.md`. No new follow-up. |
| E12 | **Two `GMAIL_*` readers.** `lib/plugins/google-mail/sendEmailDraft.ts` is the user's own plugin connection, not the system sender. The four `GMAIL_*` names are read by the transport (fallback) **and** by `app/api/contact/route.ts`, which builds its own Gmail transport and skips the transport's order, Resend and `email_sends`. Its callers are tracked as V-14 in `ADMIN_BOS_CLEANUP_REQUIREMENT.md`. | — | Part (2) and (5) name the contact route; T-EM-3 and T-EM-8 cover it. **Never a probe.** |

### D6b.2 What `email.md` teaches (the six-part template)

**(1) What must differ between environments.** One "Rule per environment" column plus a target sentence, as in `stripe.md` §1. The current setup is a private-inventory pointer. Rows: which providers have their names set (as recorded; order fixed by code; production target Resend set); which Resend account (private inventory; one endpoint receives events for every key on its account; no test/live split to rely on, confirm at use time); Resend API key (one per environment, sending-only if offered); sending domain and sender address (verified domain, never `RESEND_DEFAULT_FROM` in production); webhook endpoint and secret (per environment, stable address; no endpoint means no secret, and the route refuses); subscribed events (derived per E7); SMTP relay (all-or-none, port 465 always TLS, else `SMTP_SECURE`); Gmail system sender (all-or-none; OAuth client in DO-6c). Local: guidance only. Preview: no endpoint (Q-D6b-2 ruling).

**(2) Where the code reads it:** `emailTransport.ts` (all sending names, order, `platformSenderAddress()`), the webhook route and `recordDeliveryEvent`, the contact route (second `GMAIL_*` reader), `email_sends.provider`, and the catalogue group `email`. The plan-cancel flag is ours and needs the sender address (`docs/feature_flags.md`). The existing scripts, as SA ruled: `resend-webhook-smoke.ts` local or non-production stable address, default arguments only, never production; `validate-resend.mjs` (never `--to`) and `validate-gmail.mjs` key-holder pre-checks outside every checkout for non-local values, verdict only; `generate-gmail-token.js` the rotation tool, value from terminal straight into Vercel, loopback redirect a DO-6c fact.

**(3) Dashboard steps (the user),** by area name: Resend Domains (record kinds only; records are DO-6e's; DMARC is DO-6e; tracking off), API keys, Webhooks, Emails (sent log), SMTP relay console, Gmail token via the rotation tool (Google Cloud: DO-6c), Vercel via `vercel-ops` and `env-change-protocol`.

**(4) Probes.** Failure classes, verbatim, for module `EmailTransport`: "Resend API error", "Resend send failed — trying next transport", "Resend keyed send failed — no fallback for a keyed send", "SMTP send failed — trying next transport", "Gmail send failed", "No email transport delivered the message (preview only)", the "not a valid Resend key" substring, and the two lines carrying `idempotency_unsupported`. "Email sent" is counted by `provider` for module `EmailTransport` only (`NotificationService` logs the same class). Classes and counts only, never a copied line.

| Change | Probe | Pass | Fails when | Who |
|---|---|---|---|---|
| Resend key, sender address, domain | Send probe | `resendConfigured` true; "Email sent" provider `resend`; sent log from the verified domain; SPF/DKIM/DMARC pass (pass/fail only) | Provider `smtp`/`gmail`/`none`; any failure class; `sender_not_configured` | User; DO |
| Resend key roll | Send probe after deploy Ready | As above and new key's "last used" after the probe | Same; overlap → "pass, not conclusive (overlap)" | User; DO |
| Webhook secret | Replay probe | 200; 0 signature, 0 secret, 0 timestamp lines, outside an overlap | 401 with a signature or secret line | User; DO |
| Subscribed events | DO derives; user reports list | All present | One missing | DO + user |
| SMTP / Gmail | Send probe, only where that provider is the recorded first sender | Expected provider | Differs, or "relay refused" | User; DO |
| Fallback health | DO counts | Matches recorded first provider; 0 failure classes | Any | DO |

**Send probe conditions (SA change 8):** goes through `sendEmail`; gated on `platformSenderAddress()`; to an address the user owns; no money, no customer data. The admin invitation to the user's own address meets all four: its create path does not check for an existing account (confirmed in `adminInviteOps.ts`). Side effects: an invite row and its audit entries; cleanup: never open the link, revoke. No qualifying trigger → "not probed".

**Replay probe (SA change 2):** precondition, an event whose type per `toDeliveryEvent` carries no `status` (derived, never named) — `recordDeliveryEvent` then writes nothing or one missing timestamp; an unmatched event is also safe; never replay a status-carrying type (always patched). Timestamp: a 401 with the timestamp line is "not probed (timestamp)" (whether the vendor re-signs a replay is confirmed at use time). Overlap: during rotation, "pass, not conclusive (overlap)". Otherwise a 200 is conclusive (every 200 is after `verify`).

Supporting SQL (DO, `devops.md` rules (a)–(c)): `email_sends` counts by `provider` and by `status`, filtered on `created_at` after the change time; no other column selected or grouped. Shared by every deployment on that database: supporting only.

**(5) Gotchas:** silent fallback (E2); all-or-none without a line (E1); keyed sends never fall back (E3); From by provider, SMTP vs Gmail (E4, FU-D6b-b); sender address stops invite signup, invitations and plan-cancel mail (E5); two Gmail readers — a working Resend proves nothing about contact-route mail, a broken Gmail token stops it alone (E12); no secret refuses on every deployment (E6); duplicates log at debug (E8); shared Resend account (change 10); tracking stays off (E7); authentication is not the inbox (the comment on `unsubscribeUrl`); Gmail token expiry for an unpublished OAuth app (`validate-gmail.mjs`, confirm at use time); Preview addresses change per deployment (`vercel-ops` §4). The "rotation may have no overlap" gotcha is replaced by the replay probe's overlap step.

**(6) Drift checks:**

| ID | Check | Expected state from | Live read | Class | Who reads |
|---|---|---|---|---|---|
| T-EM-1 | On each Vercel target, the `email`-group names match the recorded provider set. Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-EM-2 | No `email`-group name carries `NEXT_PUBLIC_` | Catalogue | `vercel-ops` §3 (names only) | Critical | DO |
| T-EM-3 | Each provider's names all present or all absent; the `GMAIL_*` set also serves the contact route | `emailTransport.ts`, contact route at `origin/main` | `vercel-ops` §3 (names only) | High | DO |
| T-EM-4 | Mail goes out through the recorded first provider: 0 failure classes since the last run | Private inventory; change records | Runtime logs, module `EmailTransport`; supporting `email_sends` counts | High | DO |
| T-EM-5 | Sending domain verified, all records verified, sender address on it, open and click tracking off | Private inventory; route header | User report (Resend Domains) | High | User |
| T-EM-6 | Each recorded endpoint enabled, right address, subscribed to every derived type, no failing deliveries | Code at `origin/main`; private inventory | User report (Resend Webhooks) | High | User; DO (code side) |
| T-EM-7 | Webhook health: 0 signature, 0 secret (where an endpoint is recorded), 0 "Could not record the delivery event" | Change records | Runtime logs | High | DO |
| T-EM-8 | Gmail system sender and the contact route, where recorded in use: refresh token valid; consent-screen status per DO-6c | Private inventory | `validate-gmail.mjs` verdict (key holder); user report | Medium | User |

**(7) Tiers and order.** Production tier: any key create, scope or delete; any domain or DNS change; the production endpoint and its secret; SMTP or Gmail credentials. A non-production endpoint is reversible: the user applies it after approval in chat. Order: domain verified before `RESEND_FROM_EMAIL` moves to it; a newly acted-on type subscribed before merge; key, secret or token roll set new → deploy Ready → probe → delete old; `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` on only after the send probe has passed on that deployment with a sender-gated trigger (it also turns on the reminder cron). Pointer to `env-change-protocol`; nothing restated.

### D6b.3 Files to change

| # | File | Action |
|---|---|---|
| D6b-1 | `.claude/skills/third-party-ops/email.md` | New, §D6b.2, target ≤ ~170 lines |
| D6b-2 | `.claude/skills/third-party-ops/SKILL.md` | §5 index row → `[email.md](email.md)`. Add "Resend, SMTP, a sender address, an email delivery webhook" to the description triggers. Nothing else |
| D6b-3 | This requirement | §0 row, these sections, notes, reviews |
| — | `stripe.md`, `devops.md`, `env-drift-audit`, `env-change-protocol`, `CLAUDE.md` | **Not edited** |

### D6b.4 Acceptance criteria

- [ ] `email.md` has the six parts plus tiers/order; every file path it names exists; it states the Q-D6-2 live check by role, not by environment.
- [ ] No copied lists: no Resend event-type name, no key or secret prefix, no line number. QA greps `email.md` for `email\.[a-z_]+` (excluding `email\.md` itself) and for the vendor's key and secret prefixes: 0 hits, or each hit is a log-message string.
- [ ] Every quoted log string is verbatim in the cited file (`grep -cF`).
- [ ] Each probe row says who runs it, what pass is, and what it shows when wrong. The webhook probe has its precondition, its timestamp and overlap results, and never replays a status-carrying type. No probe disables Resend to reach a fallback. The contact route is never a probe.
- [ ] The restatement grep from §D6.4 over `email.md`: 0, or each hit is a pointer.
- [ ] Public repo: the finding-11 regex over the added lines is 0. No domain, sender address, endpoint URL, relay host or account appears; the built-in default sender is named only as `RESEND_DEFAULT_FROM`. No line states which environment has which name.
- [ ] The SKILL.md diff is only D6b-2; the diff touches only D6b.3 files.

### D6b.5 Questions — all settled

- **Q-D6b-1 (settled by SA):** the send order is fixed in code, so "which provider sends first" follows from which names are set. Production target: Resend set. Which fallbacks exist where is current state, in the private inventory. Keeping SMTP and Gmail fallbacks in production is settled in FU-D6b-b with SA.
- **Q-D6b-2 (settled by SA):** no Resend endpoint for Preview (no stable address, deployment protection, the route correctly refuses without a secret).
- **S-1 accepted:** FU-D6b-a (Dev, code, Low): mark `RESEND_API_KEY` and `RESEND_FROM_EMAIL` required in production in the catalogue, with its tests; `RESEND_WEBHOOK_SECRET` stays optional, raised with SA in the FU workplan.
- **S-2 accepted, widened:** FU-D6b-b (Dev, code): decide the From for SMTP and Gmail; fix the `from` field comment, the `sendViaGmail` comment, "read by nobody else", the `NotificationService` order comments, and the catalogue role text for `SMTP_FROM`.
- **S-3 accepted:** counts by `provider` and `status`, filtered on `created_at`.
- **S-4 confirmed:** a status-free type replays as `duplicate` or one timestamp write; a status-carrying type always writes.
- **S-5:** E11 already tracked (ADMIN_BOS_CLEANUP NF-6, V-12). FU-D6b-c dropped.

---

## DO-6c Specification — Google (third-party-ops)

**By BA — 2026-11-01.** Short scoping pass, like DO-6b. Config/docs-only slice: no application code, no CI job, no CI time. It adds one reference file and one index row to `third-party-ops`, under SKILL.md §1–§4 and SA Review — DO-6 (changes 1–7 apply to every DO-6 slice: a probe has a precondition or it is "not probed", a roll overlap makes a pass "not conclusive", derivation from code, no copied lists, T- rows live in the platform file). **[SA Review — DO-6c (short pass)](#sa-review--do-6c-short-pass) changes 1–13 override this section wherever they differ; `google.md` follows them** (see [DO-6c implementation notes](#do-6c-implementation-notes)).

**Services live (Q-D6-2 rule):** the main session confirmed on 2026-11-02 that each of G1–G5 still has a code path that runs, so all five stay. Whether each one is configured is not recorded here; DO checks it at use time with T-GO-1..11. G5 needs that check most: see GO-12.

**Boundary with DO-6h (plugin OAuth apps).** The Google plugin client (G3) is covered here, because its client, its consent screen and its enabled APIs are managed in the Google Cloud console, like G1, G2, G4 and G5. DO-6h covers the other vendors' plugin apps and points to `google.md` for Google. SA to confirm (Q-D6c-1).

### D6c.1 Context and findings from code

Taken from the main session's DO-6c inventory at `origin/main` (names and readers only; no value read, no `.env*` opened). Line numbers are pointers for SA; the skill names files and functions only, never line numbers. Where the inventory does not settle a fact, the row says "SA to confirm". Where each value lives today is not derivable from the repo: DO finds it at run time and reports it by name and target only, in the private docs.

**Five separate credentials, plus one cross-link.** Each has its own console page and its own failure. The skill treats them as five, never as "the Google key".

| # | Credential | Env names | Kind of setting (not where it is set today) |
|---|---|---|---|
| G1 | App sign-in ("Continue with Google" on the main login) | none in the app env | A Google OAuth client whose id and secret are entered in Supabase Auth → Providers → Google |
| G2 | Invite-signup Google ID token (Business OS champion invite) | `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | An app env name, build-time. Must name the same client as the Supabase provider of G1 |
| G3 | Plugin OAuth client (the Google plugins) and their redirect URIs | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | App env names (the public one build-time); a Google OAuth client |
| G4 | Places address autocomplete (browser key) | `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | An app env name, build-time; a Google API key |
| G5 | Custom Search (research plugin web search) | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | App env names; a Google API key; a Programmable Search Engine |
| G6 | Gmail system sender | `GMAIL_*` | Covered by `email.md`. A separate OAuth client and refresh token, not G3. DO-6c only cross-links |

| # | Finding | Where | Consequence for `google.md` |
|---|---|---|---|
| GO-1 | **G1 runs through Supabase, not the app env.** `signInWithOAuth` (PKCE) sends the browser to Supabase's Google provider; `redirectTo` is the window origin plus a path, and the browser lands on the auth callback page. With the provider off or misconfigured, Supabase rejects the provider. | `lib/client/auth-actions.ts` (`signInWithOAuth`); `app/auth/callback/page.tsx` | The Supabase half (provider settings, redirect allow list including the callback path, the nonce setting) is `supabase-ops`'s: `google.md` points there and restates none of it. The Google half is the OAuth client's authorised redirect URI, which is the callback **Supabase's provider page shows** (not an app path), per Supabase project. |
| GO-2 | **G2 has one accessor and never falls back to the plugin client.** `googleSignInConfig.ts` is the only reader of `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`. Unset: the invite page hides the Google button and the signup route answers 404 `google_signin_not_configured`. | `lib/business-os/invites/googleSignInConfig.ts`; `app/invite/page.tsx`, `app/invite/GoogleSignupButton.tsx`, `app/invite/useGoogleIdentity.ts`; `app/api/public/invites/signup/google/route.ts` | Two probes that can fail with no secret: the button shows, and the route does not answer `google_signin_not_configured`. A gotcha: the fallback is forbidden on purpose; "set it to the plugin client id" is never the fix. |
| GO-3 | **G2 must equal the Supabase provider's client id.** The server verifies the ID token (`OAuth2Client.verifyIdToken`, audience = this id, issuer, nonce, maximum age), then the browser calls `signInWithIdToken`, which Supabase checks against its provider's client. If the two ids differ, the route accepts a token the browser step then refuses. | `lib/business-os/invites/googleIdToken.ts`; `lib/client/auth-actions.ts` (`signInWithIdToken`) | A drift check the user reads in two dashboards and reports as "same client: yes/no", never the id. What the route has already written when the browser step fails: **SA to confirm** (it decides whether a mismatch strands a half-done signup). Whether Supabase's provider accepts more than one client id: vendor fact, confirm at use time. |
| GO-4 | **G2 needs Authorised JavaScript origins.** The Google Identity button runs on the invite page, so each environment origin that serves that page must be an Authorised JavaScript origin on the sign-in client. | inventory; `app/invite/useGoogleIdentity.ts` | Per environment origin, stable addresses only. A Preview deployment URL changes per deployment, so the button cannot work there unless a stable address is registered (gotcha). |
| GO-5 | **G3: the V2 plugin manager keeps a literal placeholder when a name is unset.** `processEnvironmentVariables` substitutes `${GOOGLE_CLIENT_ID}` / `${GOOGLE_CLIENT_SECRET}` in each `google-*-plugin-v2.json`; a missing name logs a warn ("Environment variable not found, keeping placeholder") and leaves the literal text in the definition. The literal reaches Google, which shows **its own** invalid-client page, not our error. | `lib/server/plugin-manager-v2.ts` (`processEnvironmentVariables`, ~line 150); `lib/plugins/definitions/google-*-plugin-v2.json` | Probe: read the `client_id` in the Google authorisation URL and check it is not a placeholder. Log evidence: the warn class, counted. The exact log string and module are quoted only after QA's `grep -cF` (SA to confirm the string). |
| GO-6 | **G3 has two client-id names.** `GOOGLE_CLIENT_ID` (server, through the definitions) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (build-time). Which one builds the authorisation URL on the V2 path, and whether the two must hold the same client: **SA to confirm**. | inventory | If both are read on the live path, a drift check "both name the same client: yes/no" (user report). If only one is live, the other is noted, not checked. |
| GO-7 | **G3 redirect URIs are per plugin and per environment origin.** Built from `NEXT_PUBLIC_APP_URL` plus `/oauth/callback/<plugin key>`, served by one dynamic route. One redirect per Google plugin definition; each must be registered on the plugin client for each environment's stable address, or Google answers `redirect_uri_mismatch`. Whether it goes through `platformOrigin()` (SKILL.md §3): **SA to confirm**. | `app/oauth/callback/[plugin]/route.ts`; the Google plugin definitions | The skill never lists the plugin keys: DO derives them at use time from the `google-*-plugin-v2.json` files at `origin/main`. A new Google plugin adds one redirect per environment before merge (order row). |
| GO-8 | **Deprecated V1 readers exist and are never probe targets.** `lib/plugins/strategies/gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`, `gmailDataStrategy.ts`, `lib/plugins/v2/configs/google-drive.json`, `app/oauth/[plugin]/start/route.ts` and `app/oauth/token/route.ts` (through `lib/plugins/pluginRegistry.ts`), and for G5 `lib/plugins/strategies/chatgptResearchStrategy.ts`. | CLAUDE.md § Deprecated | A probe goes through the V2 path only. A pass or failure on a V1 route says nothing about V2. The V2 start entry point to probe from: **SA to confirm** (the inventory names only the V1 start route). |
| GO-9 | **G4 is a browser key by design.** `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` is build-inlined; the reader falls back to `''`, so an unset key shows no suggestions, silently. Its protection is the Google-side restriction (HTTP referrer + API), not secrecy. | `lib/geo/placesAutocomplete.ts`; `docs/ADDRESS_AUTOCOMPLETE_SETUP.md` | Drift check: key restricted by referrer to each environment's stable origins and by API to what the loader uses. Which Places product the loader uses (and so which API the restriction must allow): **SA to confirm** from the loader; the setup doc is a pointer, its list confirmed against code. |
| GO-10 | **G5's key travels in a query string.** The research executor calls Google's Custom Search endpoint with the key and the engine id as URL parameters. That URL must never be logged, pasted, copied from a log, or put on a command line. | `lib/server/chatgpt-research-plugin-executor.ts` (~lines 255–271) | Evidence is counts by log class only; whether any current log line in that path carries the URL: **SA to confirm** (if one does, it is a follow-up, not in the skill). No key-holder script exists for G5; the skill forbids an ad-hoc one that puts the key in a URL on a command line (shell history). |
| GO-11 | **Catalogue rows exist for every name.** Sign-in id in group `admin`, the plugin client in `plugins`, Search and Places in `external`. Places is marked `secret` though it ships in the bundle. | `lib/admin/environment/catalogue.ts` | T-GO rows read names from the catalogue at `origin/main`. The `secret` marking is Q-D6c-6, not a skill rule. |
| GO-12 | **Custom Search availability (vendor fact).** Google's Custom Search JSON API documentation carries a notice about its availability; read Google's notice at use time before any G5 rotation or new project (wording per SA change 10). | vendor docs | G5 rotation is "rotate within the existing project; if the notice says new projects or keys are refused, plan the rotation with that risk named". Whether G5 stays in scope at all is the live check above and Q-D6c-5. |
| GO-13 | **Gmail system sender (G6) is a separate OAuth client.** Its refresh token, loopback redirect and consent-screen expiry are already in `email.md` (§2 scripts, T-EM-8). | `email.md` | `google.md` cross-links; it adds only the console facts `email.md` deferred to DO-6c: the loopback redirect on that client and the consent-screen publishing status. |

### D6c.2 What `google.md` teaches (the six-part template)

Same intro sentence as `stripe.md` and `email.md`, plus the live-check line. Each part is organised by credential G1–G5, so a reader working on one never has to read the others.

**(1) What must differ between environments.** One "Rule per environment" column plus a target sentence, as in `stripe.md` §1. The current setup (which Google Cloud projects exist, which clients and keys each environment uses, where each value lives) is a private-inventory pointer: "Where the value lives is found at run time, reported by name and target only." Rows:

| Setting | Rule per environment |
|---|---|
| Google Cloud project per environment | As recorded. The consent screen, enabled APIs and quota are per project, so every client and key in one project shares them (vendor fact, confirm at use time) |
| G1/G2 sign-in client | One OAuth client per Supabase project that uses it. Its redirect URI is the one Supabase's provider page shows; its Authorised JavaScript origins are the environment's stable origins that serve the invite page. `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` equals that Supabase provider's client id |
| G2 never the plugin client | The sign-in name never holds the plugin client's id, on any target |
| G3 plugin client | Its own OAuth client, separate from the sign-in client and from the Gmail system sender. Redirect URIs: each Google plugin's callback, exactly as the code builds it, for each environment's stable address |
| G3 secret | Set wherever the id is set; the pair all-or-none |
| G4 Places key | A browser key restricted by HTTP referrer (that environment's stable origins) and by API; one key per environment or one shared key, as recorded |
| G5 Search key and engine id | A server key restricted by API to Custom Search; the engine id of the recorded search engine; the pair all-or-none |
| Consent screen | User type, publishing status and declared scopes as recorded. Production target: published, never relying on a test-user list. Every scope the code requests is declared, and verified where Google requires it |
| Local | Guidance only. DO reads no `.env*` file; a loopback origin or redirect is registered only on a non-production client |

**(2) Where the code reads it.** The GO-1 to GO-11 files, per credential, named as files and functions. The Google plugin keys and their scopes are derived at use time from the `google-*-plugin-v2.json` definitions at `origin/main`, never listed. Expected names per environment: the catalogue (groups `admin`, `plugins`, `external`); requiredness the catalogue cannot give comes from the private inventory. Deprecated V1 readers are listed once, under "never a probe target". G6: pointer to `email.md` §2.

**(3) Dashboard steps (the user),** by area name, because the console moves (confirm at use time). Newer consoles group the OAuth pages under **Google Auth Platform** (Branding, Audience, Clients, Data access, Verification centre); older ones under **APIs & Services → OAuth consent screen / Credentials**.

- **OAuth consent screen / Audience:** user type, publishing status (Testing or In production), test users. **Data access / scopes:** declared scopes; **Verification centre:** verification status for sensitive or restricted scopes.
- **Credentials / Clients:** per client, the Authorised JavaScript origins and Authorised redirect URIs; add or reset a client secret.
- **Credentials / API keys:** per key, Application restrictions (HTTP referrers for G4) and API restrictions (G4, G5); create, rotate or delete.
- **APIs & Services → Enabled APIs:** each API the code calls is enabled in that project; **Quotas** for Places and Custom Search.
- **Programmable Search Engine console:** the engine exists and searches what the research plugin expects (G5).
- **Supabase Auth → Providers → Google and URL configuration:** `supabase-ops`, not restated.
- **Setting the value on Vercel:** `vercel-ops` and `env-change-protocol`. Every `NEXT_PUBLIC_` change needs a new build (`vercel-ops` §4).

The user reports presence, status (published / testing, verified / not), "same client: yes/no", "origin or redirect registered: yes/no" and the last-updated time. Never a client id, a secret, a key, a project id, an origin, a redirect URI or an engine id.

**(4) Probes.** Each fails when the setting is wrong. No probe needs DO to hold a secret, and none is run against a deprecated V1 route. Browser probes are the main session or the user (`vercel-ops` §4, "Who probes what"); log evidence is DO, from that deployment's runtime logs after the probe time, counts by class only. A probe that meets deployment protection is "not probed".

| Change | Probe | Pass | Fails when | Who | Quota / side effects |
|---|---|---|---|---|---|
| G1 sign-in client, Supabase provider | On that deployment, click "Continue with Google" on the login page; stop at Google's account chooser | Google's account chooser loads, no error page | Supabase refuses the provider, or Google shows a client or `redirect_uri_mismatch` error | Main session or user | None. Completing sign-in is optional and only by the user, on their own existing account |
| G2 name set and built | Open the invite page on that deployment (SA to confirm the page renders the button without a valid invite) | The Google button is shown | No button | Main session or user | None |
| G2 route configured | A request to the signup route that carries no token (SA to confirm the config check runs before body validation and writes nothing) | Any answer other than 404 `google_signin_not_configured` | 404 `google_signin_not_configured` | Main session | None, if SA confirms; otherwise "not probed" |
| G2 JavaScript origin | On the invite page, the Google button renders and opens Google's chooser | Chooser opens | Google shows an origin-not-allowed error (vendor message, confirm at use time) | User | None. A full invite signup is **not** a probe by default (it creates an account): SA to rule (Q-D6c-3) |
| G2 equals Supabase's client | User compares the two dashboards | "Same client: yes" | "No" | User | None |
| G3 client id and redirect URI | Start connecting one Google plugin from the V2 connect UI on that deployment; **stop at Google's consent page**; read the authorisation URL (address bar, or the `Location` header of the start response) | `client_id` is a real value (not a `${…}` placeholder, raw or URL-encoded) and `redirect_uri` is that deployment's stable address plus that plugin's callback path; Google shows consent, not an error | Placeholder in `client_id`; Google's invalid-client page; `redirect_uri_mismatch`; DO counts the placeholder warn class > 0 | Main session or user; DO (logs) | None. The URL holds the client id and a `state` value: report yes/no per field, never paste the URL |
| G3 secret | Completing consent and the token exchange | The connection is recorded | Token exchange fails after consent | User only, on their own account, if they choose; otherwise "secret not probed" | Creates a plugin connection; cleanup is disconnecting it (what disconnect does on Google's side: SA to confirm) |
| G3 per-plugin redirect | The G3 probe, once per Google plugin whose redirect changed | As above, per plugin | As above | Main session or user | None |
| G4 Places key and restriction | On an allowed origin, type a partial address into an address field that uses the autocomplete (field found at use time) | Suggestions appear | No suggestions; the browser console shows a referrer or API-not-activated error class (vendor message, confirm at use time) | Main session or user | **Costs quota:** each suggestion request or session is billable Maps usage (pricing and free allowance: vendor docs at use time). Keep to one short query |
| G4 restriction holds | Optional, by the user: the same field from an origin not on the referrer list | Refused | Suggestions appear | User | One billable-or-refused request |
| G5 key and engine id | One research-plugin action that performs a web search, on that deployment | DO counts 0 search-failure classes for that window; the result shows web results | Failure class > 0, or no results | User (trigger); DO (logs) | **Costs one Custom Search query** from the daily quota, plus real LLM provider cost and usage records (SA ruling). One run, user-approved. Never repeated in a loop |
| Consent screen | User reports publishing status, user type, scope verification | As recorded; production published | Testing in production; a code scope not declared | User; DO (code-side scope derivation) | None |

Rotation overlap: a client secret or API key that Google keeps valid alongside the new one (two secrets on one client, or an old key not yet deleted) makes a pass "pass, not conclusive (overlap)" until the old one is deleted and the probe repeated. Whether Google supports two active secrets on one client: vendor docs at use time.

**(5) Gotchas,** each grounded in a repo file or marked vendor fact:

- **Five credentials, five failures** (D6c.1 table): a working plugin connect proves nothing about sign-in, and the reverse.
- **G2 never falls back to the plugin client** (`googleSignInConfig.ts`). Copying the plugin id into the sign-in name is never the fix.
- **G2 must equal Supabase's provider client** (`googleIdToken.ts`, `auth-actions.ts`): a mismatch passes the server and fails in the browser (GO-3).
- **`NEXT_PUBLIC_` is build-time** (`vercel-ops` §4): G2, G4 and the public G3 name need a new deployment; a changed value on Vercel alone changes nothing.
- **Placeholder, not our error** (`plugin-manager-v2.ts`): an unset G3 name shows Google's invalid-client page. Read the `client_id` in the URL and the warn count before suspecting the Google console.
- **Redirect URIs and JavaScript origins are per environment origin**, exactly as the code builds them; Preview URLs change per deployment, so only a stable address can be registered (SKILL.md §3).
- **G1's Google redirect is Supabase's callback**, not an app path; the app's `redirectTo` belongs to Supabase's allow list (`supabase-ops`).
- **Consent screen in Testing:** only listed test users can consent, and refresh tokens expire within days (vendor fact, confirm at use time; the same note grounds T-EM-8 in `validate-gmail.mjs`). It is per project, so it affects every client in that project.
- **Scopes and verification:** a sensitive or restricted scope the code adds needs declaring, and verification, before real users see consent without an unverified-app warning or a block (vendor fact). Plugin scopes are derived from the definitions at use time.
- **Browser key protection is the restriction** (`placesAutocomplete.ts`): referrer list and API list.
- **Search key in the URL** (`chatgpt-research-plugin-executor.ts`): never log, paste or command-line that URL; evidence is counts.
- **Custom Search availability** (GO-12, vendor fact): read Google's notice at use time; rotate within the existing project.
- **Deprecated V1 readers are never probe targets** (CLAUDE.md § Deprecated).
- **G6 is not G3:** the Gmail system sender's client, token and loopback redirect are `email.md`'s.

**(6) Drift checks** (in `env-drift-audit` §7 format and under its rules):

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-GO-1 | On each **Vercel target**, the Google names (catalogue groups `admin`, `plugins`, `external`) match the recorded set. Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-GO-2 | The only Google names with `NEXT_PUBLIC_` are `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`; no secret or server key carries it | Catalogue at `origin/main` | `vercel-ops` §3 (names only) | Critical | DO |
| T-GO-3 | Pairs all-or-none on a target: `GOOGLE_CLIENT_ID` with `GOOGLE_CLIENT_SECRET` (and the public id, per GO-6); `GOOGLE_SEARCH_API_KEY` with `GOOGLE_SEARCH_ENGINE_ID` | Code at `origin/main` | `vercel-ops` §3 (names only) | High | DO |
| T-GO-4 | 0 placeholder warns (GO-5) on each deployment since the last run | Change records | Runtime logs | High | DO |
| T-GO-5 | The sign-in name equals the Supabase provider's client, per environment; never the plugin client | `googleSignInConfig.ts`, `googleIdToken.ts`; private inventory | User report (Google Cloud Clients; Supabase provider via `supabase-ops`) | High | User |
| T-GO-6 | Sign-in client: Supabase's callback registered as redirect URI; each stable origin serving the invite page registered as JavaScript origin | Private inventory (addresses) | User report (Clients) | High | User |
| T-GO-7 | Plugin client: every Google plugin's callback, derived from the definitions at `origin/main`, registered for each environment's stable address | Code at `origin/main`; private inventory | User report (Clients) | High | User; DO (code side) |
| T-GO-8 | Consent screen per project: publishing status and user type as recorded (production target: published); every scope the code requests declared, verified where required | Code at `origin/main` (scopes derived); private inventory | User report (Audience, Data access, Verification centre) | High | User; DO (code side) |
| T-GO-9 | Places key restricted by HTTP referrer (stable origins as recorded) and by API (as the loader requires); Search key restricted by API to Custom Search | `placesAutocomplete.ts`, the executor at `origin/main`; private inventory | User report (API keys) | High | User |
| T-GO-10 | Every API the code calls is enabled in the recorded project, with no quota-exceeded errors since the last run | Code at `origin/main` | User report (Enabled APIs, Quotas); runtime-log counts for the search path | Medium | User; DO |
| T-GO-11 | Custom Search still served for the recorded project, per Google's notice at use time (GO-12) | Vendor docs at use time; private inventory | User report | Medium | User |

**(7) Tiers and order.** Pointer to `env-change-protocol`; nothing restated.

**Tiers.** Anything on the consent screen, any scope or verification action, any API enable or disable, any client secret reset, any key create, restrict or delete, and any edit to a client or key that production uses, are **production tier**: SA reviews the plan, the user executes. Adding an origin or redirect to a client used **only** by non-production environments, as recorded, is reversible: the user applies it after the approval in chat. Where one client serves several environments, every edit to it is production tier.

| Change | When |
|---|---|
| A new Google plugin, or a changed callback path | Its redirect registered on the plugin client for every environment's stable address before merge |
| A scope the merging code starts to request | Declared on the consent screen (and verification started where required) before merge |
| A new environment origin | Origins and redirects registered before it serves the invite page or plugin connect |
| A `NEXT_PUBLIC_` Google value | Set → new build → deploy Ready → probe |
| Client secret or API key rotation | Create new → set → deploy Ready → probe → delete old **after deploy**; overlap per (4) |
| Tightening a key's restriction | After the probe passes on every allowed origin |
| An origin or redirect removed | Only after no deployment builds or serves it |

### D6c.3 Files to change

| # | File | Action |
|---|---|---|
| D6c-1 | `.claude/skills/third-party-ops/google.md` | New, §D6c.2, target ≤ ~190 lines (five credentials; SA to confirm, Q-D6c-7) |
| D6c-2 | `.claude/skills/third-party-ops/SKILL.md` | §5 row "Google Cloud" → `[google.md](google.md)`. Add to the description triggers: "Google sign-in, a Google OAuth client, an OAuth consent screen, Authorised JavaScript origins, a Google API key, Places autocomplete, Custom Search". Nothing else |
| D6c-3 | This requirement | §0 row, these sections, notes, reviews |
| — | `stripe.md`, `email.md`, `devops.md`, `env-drift-audit`, `env-change-protocol`, `supabase-ops`, `CLAUDE.md` | **Not edited.** `email.md`'s "DO-6c" pointers resolve to `google.md` through the index row; a link edit there is a follow-up only if SA wants one (Q-D6c-8) |

### D6c.4 Acceptance criteria

- [ ] `google.md` has the six parts plus tiers/order, organised by G1–G5 with G6 a cross-link; every file path it names exists; it states the Q-D6-2 live check by role, not by environment.
- [ ] Each of G1–G5 has at least one probe row naming who runs it, the pass, what it shows when wrong, and its quota or side effects. The G4 and G5 rows say they cost quota. No probe completes consent or sign-in except by the user on their own account; no probe targets a deprecated V1 reader.
- [ ] The G3 probe reads `client_id` and `redirect_uri` from the authorisation URL and reports yes/no only; the URL is never pasted.
- [ ] G2's no-fallback rule and its equality with the Supabase provider's client are each stated, with their files.
- [ ] The Supabase-side settings are a pointer to `supabase-ops`; the grep for "Skip nonce", "URL configuration" and "Redirect URLs" over `google.md` is 0, or each hit is a pointer.
- [ ] No copied lists: no Google plugin key list, no scope string, no line number. QA greps `google.md` for `googleapis\.com/auth`, `/oauth/callback/google-` and line references: 0 hits.
- [ ] Every quoted log string or error code is verbatim in the cited file (`grep -cF`); vendor messages are marked "confirm at use time".
- [ ] The restatement grep from §D6.4 over `google.md`: 0, or each hit is a pointer.
- [ ] Public repo: the finding-11 regex over the added lines is 0. No client id, key or key prefix, project id or number, engine id, origin, redirect URI with a host, domain, address or personal path. No line states which environment has which name, which project exists, or whether anything is configured today.
- [ ] The SKILL.md diff is only D6c-2; the diff touches only D6c.3 files.

### D6c.5 Open questions for SA

- [ ] **Q-D6c-1** Boundary: Google's plugin client in DO-6c (`google.md`) rather than DO-6h. *Suggested:* yes; DO-6h points here for Google. (raised by: BA | status: open)
- [ ] **Q-D6c-2** GO-6: which of `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` builds the V2 authorisation URL, must they hold the same client, and what is the V2 start entry point to probe from? *Suggested:* SA reads it at build; T-GO-3 includes the public name only if it is on the live path. (raised by: BA | status: open)
- [ ] **Q-D6c-3** GO-3 and the G2 probes: does the signup route's config check run before body validation and write nothing (so the "not configured" probe is safe); does the invite page render the button without a valid invite; and what does the route write before the browser's `signInWithIdToken` step? *Suggested:* the two cheap probes stay if safe; a full invite signup is never a default probe. (raised by: BA | status: open)
- [ ] **Q-D6c-4** GO-9 / GO-10: which Places product the loader uses (so the API restriction is exact), and whether any current log line in the research executor carries the search URL. *Suggested:* the restriction row says "the APIs the loader calls, read at use time"; a URL in a log is a code follow-up, not skill text. (raised by: BA | status: open)
- [ ] **Q-D6c-5** GO-12: given Google's availability notice for Custom Search, does G5 stay in `google.md`, or does the live check drop it and a code follow-up replace the search provider? *Suggested:* keep it with T-GO-11 until the live check or a product decision drops it; a replacement is a separate item for the user. (raised by: BA | status: open)
- [ ] **Q-D6c-6** The catalogue marks the Places key `secret` though it is a browser key. *Suggested:* a Low code follow-up to relabel it, not in the skill. (raised by: BA | status: open)
- [ ] **Q-D6c-7** Length: five credentials push past `stripe.md`'s ~170. *Suggested:* ≤ ~190; if over, Dev trims prose, never probe or drift rows. (raised by: BA | status: open)
- [ ] **Q-D6c-8** Is the G3 secret probe (completing consent on the user's own account) with its disconnect cleanup acceptable, and should `email.md`'s "DO-6c" pointers become links? *Suggested:* the secret probe is optional and user-only, else "secret not probed"; leave `email.md` untouched (the index resolves it). (raised by: BA | status: open)

---

## DO-6d Specification — LLM providers (third-party-ops)

**By BA — 2026-11-02.** Short scoping pass, like DO-6b and DO-6c. Config/docs-only slice: no application code, no CI job, no CI time. It adds one reference file (`llm-providers.md`) and one index row to `third-party-ops`, under SKILL.md §1–§4 and SA Review — DO-6 (changes 1–7 apply to every DO-6 slice: a probe has a precondition or it is "not probed", a roll overlap makes a pass "not conclusive", derivation from code, no copied lists, T- rows live in the platform file). It also applies the lessons of [SA Review — DO-6c (short pass)](#sa-review--do-6c-short-pass) up front: every probe states its precondition, an exact pass and an exact fail; a probe that would pass on an unset value is not a probe; every side effect is named; every quoted log string is checked verbatim with its logger field.

**SA changes 1–13 applied.** [SA Review — DO-6d (short pass)](#sa-review--do-6d-short-pass) changes 1–13 and its rulings on Q-D6d-1..7 are folded into this section where they correct facts, so it does not lag the review; the review stays the authority wherever the two differ. `llm-providers.md` follows the review (see [DO-6d implementation notes](#do-6d-implementation-notes)).

**Services live (Q-D6-2 rule):** the main session confirms before use that each of L1–L4 still has a code path that runs, and records the result in the DO-6b form ("The main session confirmed on <date> that …", by role, no target named). L4 (Kimi) runs only when a settings row selects it (LM-5), so its live check is "a code path that runs **when selected**"; SA kept it in scope as "covered when selected" (Q-D6d-1). L5 (Mistral) has no code path and is recorded as not wired. The main session confirmed on 2026-11-02 that L1, L2 and L3 each still have a code path that runs (the factory, the orchestration routing defaults and the help bot), and that L4 runs when selected through the factory, so all four stay. Whether each one is configured is not recorded here; DO checks it at use time with the T-LLM checks.

**Boundary.** DO owns the four keys, the two model-name env names, and which provider account or project each environment's key belongs to. **Which model or provider a feature uses, when it is held in a database row, is app data owned by the admin screens that edit those rows** (found at use time; for example the Business OS LLM and AIS config screens) and the runbook `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md`; model prices (`ai_model_pricing`) belong to the model price review stream. DO reads those rows read-only for one purpose only: which providers they select (LM-5, T-LLM-4). DO never writes them.

### D6d.1 Context and findings from code

Taken from the main session's DO-6d inventory at `origin/main` (names and readers only; no value read, no `.env*` opened, no network), as checked by SA. Line numbers are pointers for SA; the skill names files and functions only, never line numbers. Where each value lives today is not derivable from the repo: DO finds it at run time and reports it by name and target only, in the private docs.

**Four keys, two model-name names, one provider not wired.** Each key is a separate vendor account with its own bill, limits and model access. The skill treats them as four, never as "the AI key".

| # | Credential | Env names | Catalogue `ai` group `expectedIn` (prod / preview / local) |
|---|---|---|---|
| L1 | OpenAI (chat, plus embeddings and image generation, which share the same key) | `OPENAI_API_KEY` | required / required / optional |
| L2 | Anthropic | `ANTHROPIC_API_KEY` | required / required / optional |
| L3 | Groq | `GROQ_API_KEY` | optional everywhere; effectively required wherever the help bot is served (LM-5) |
| L4 | Kimi | `KIMI_API_KEY` | optional everywhere; covered when selected |
| L5 | Mistral | none | Not wired: not a gap (LM-3) |
| M | Model-name overrides | `OPENAI_MODEL`, `OPENAI_CHAT_MODEL` | optional everywhere; config identifiers, not secrets |

| # | Finding | Where | Consequence for `llm-providers.md` |
|---|---|---|---|
| LM-1 | **All six names are server-side runtime names.** No `NEXT_PUBLIC_` LLM key or model name exists. The only adjacent public name is a UI feature flag, not a credential. | `lib/admin/environment/catalogue.ts` (group `ai`); `lib/utils/featureFlags.ts` | No rebuild rule applies, but a Vercel env change still needs a new deployment to take effect (`vercel-ops` §4). T-LLM-2 is Critical: a `NEXT_PUBLIC_` key would ship in the bundle. |
| LM-2 | **The factory reads each key once per instance and keeps it.** `getProviderFactory()` holds one OpenAI, Anthropic, Kimi and Groq instance each, built with the key read at first use. An unset key throws on first use; the common clause of the message is "environment variable is not configured" (nothing past it is quoted). The factory does not log the throw: the caller's own catch logs it, under the caller's module. | `lib/ai/providerFactory.ts` (`getProvider`, ~lines 44–48, 117–202) | A rotated key takes effect only on the deployment that carries it; warm instances of an older deployment keep the old key until they recycle. So the old key is revoked only after the new deployment is Ready and probed (env-change-protocol order). The throw is described as "the call fails on that path; the caller's own log line, if any, carries it". It is **not** a counted class and has no T- row (Q-D6d-6). |
| LM-3 | **Mistral is not wired.** `mistralProvider.ts` takes its key through its constructor; `PROVIDERS` in the factory lists openai, anthropic, kimi and groq; nothing constructs `MistralProvider`; no `MISTRAL_*` name is read. | `lib/ai/providers/mistralProvider.ts`; `lib/ai/providerFactory.ts` (`PROVIDERS`) | One line: "not wired, not a gap". When a caller wires it, that change adds the catalogue name and a row here before merge (order row). |
| LM-4 | **Embeddings and image generation use `OPENAI_API_KEY`.** There is no separate name. `EmbeddingService` ignores its key argument and calls the factory; `GeneratedImageService` calls `getOpenAI()`. | `lib/services/EmbeddingService.ts`; `lib/services/GeneratedImageService.ts` | Revoking or mis-setting L1 breaks chat, search-by-meaning and image features together. One key, one rotation. |
| LM-5 | **Model choice is mostly held in database rows, and a row can make an optional key required; the help bot's Groq dependency is in code.** `system_settings_config` holds the Business OS area settings (resolved by `modelSettings.ts`, 60 s cache, policy in `modelSettingsPolicy.ts`), the orchestration routing tiers (`RoutingService.ts`, with `ais_system_config`), the help bot model, and the V6 admin config (read by `lib/agentkit/v6/config/AgentGenerationConfigService.ts`, used by `V6PipelineOrchestrator`). **The help bot is not a selection:** `app/api/help-bot-v2/route.ts` constructs `GroqProvider` directly in both its model calls, and its settings rows choose the model name only. Kimi is reached only through a selection. | `lib/business-os/llm/modelSettings.ts`, `modelSettingsPolicy.ts`; `lib/orchestration/RoutingService.ts`; `app/api/help-bot-v2/route.ts`; `lib/agentkit/v6/config/AgentGenerationConfigService.ts`; `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | The catalogue says L3/L4 are optional. L3 is **effectively required** wherever the help bot is served, and wherever a settings row selects Groq; L4 wherever a row selects Kimi. T-LLM-4 compares the providers that the rows select, **or that a code path constructs outside the factory** (derived from code at `origin/main`), with the keys Set on that environment's deployment (read-only SQL, provider values only, under `devops.md` rules (a)–(d)). The setting keys are derived from those files at use time, never listed. |
| LM-6 | **The SDKs read some env names on their own.** The SDK clients read names for a base URL, an organisation, a project or an auth token when the constructor does not pass them. The catalogue does not list them and the drift guard cannot see them, because the app never reads them. Per client (settled by SA): `OpenAIProvider` passes the key only, so the OpenAI client's implicit base-URL, organisation and project names can apply; `AnthropicProvider` passes the key only, so the Anthropic client's implicit base-URL and auth-token names can apply; `KimiProvider` passes the key and an explicit base URL, so only the OpenAI organisation and project names can still apply, and they are sent to the other vendor; `GroqProvider` and `MistralProvider` use `fetch` with their own header: no SDK-implicit names. | `lib/ai/providers/openaiProvider.ts`, `anthropicProvider.ts`, `kimiProvider.ts`, `groqProvider.ts` | Gotcha plus T-LLM-3. The exact names are **confirmed in each SDK's docs at use time** for the version in `package.json`; the skill never types a list. |
| LM-7 | **Groq is absent from the factory's availability helpers.** `isProviderAvailable`, `getAvailableProviders` and `getStatus` cover openai, anthropic and kimi; `clearInstances` does not reset the Groq instance (it has no production caller). The help bot constructs its Groq provider directly from `GROQ_API_KEY`, so an unset key there surfaces as "Groq API error: " plus the status at request time, not as "not configured". | `lib/ai/providerFactory.ts`; `app/api/help-bot-v2/route.ts`; `lib/ai/providers/groqProvider.ts` | Gotcha: an availability helper is never evidence about Groq. Code follow-up FU-D6d-a (below), stated neutrally; not skill text. |
| LM-8 | **The usage ledger is the server-side evidence.** Each probe path named in part (4) writes one `token_usage` row per call (through `callWithTracking`), including auth and quota failures as `success = false`. The columns read are `provider`, `model_name`, `success`, `error_code`, `cost_usd`, `feature`, `created_at`. `error_code` is the error's `code`, or `UNKNOWN`: OpenAI SDK errors carry a `code`; Groq's error is a plain `Error`, so it records `UNKNOWN`; the Anthropic SDK error shape is vendor fact, confirmed at use time. There is no provider-level success or 401 log line: the ledger row is the evidence. | `lib/ai/providers/baseProvider.ts` (`callWithTracking`); `lib/analytics/aiAnalytics.ts` | The ledger probe reads counts only. **Never read:** `error_message`, `request_payload`, `response_metadata` and `user_id` are never selected, grouped, ordered or returned. Splitting an Anthropic or Groq 401 from a 429 uses the fixed Q-D6d-4 class match, in which `error_message` appears only inside a `CASE` / `WHERE` match. The OpenAI code names are vendor facts, confirmed at use time. |
| LM-9 | **A ledger row needs the service-role key, not only the provider key.** Two cases. (a) The service-role key is set but wrong: the call succeeds, the ledger write fails, and "Failed to insert token_usage row" or "AI call tracking threw; row not written" appears (service `AIAnalyticsService`). (b) It is unset: `getAnalytics()` builds the analytics client before the provider, and the Supabase client constructor throws on an empty key, so every factory call fails before reaching the provider. | `lib/analytics/aiAnalytics.ts`; `lib/ai/providerFactory.ts` (`getAnalytics`) | (a) A missing ledger row is a fail only when both classes are 0 in the window; otherwise the probe is "not conclusive (ledger write failed)". (b) is a database-credential fault, routed to `supabase-ops`, not a provider fault. |
| LM-10 | **A key from a project without access to a configured model.** When the configured model differs from the code default and the provider's refusal is one `isModelUnavailableError` recognises, Business OS retries once with the code default and logs "Provider rejected the configured model; retrying once with the code default" (module `BosLlmModelFallback`). A refused model is remembered for one settings-cache period, so there is at most one line per instance per period. Other paths fail the call. | `lib/business-os/llm/modelFallback.ts` | T-LLM-6 counts the class. A count > 0 after a key change points at the key's project or the setting. **0 does not prove model access** when the configured model is the code default. |
| LM-11 | **Cost is computed in-app.** `cost_usd` and Business OS credits come from the `ai_model_pricing` table, not from the provider. A model with no pricing row records $0 and logs "No pricing found; recording $0 for this call" (module `AiPricing`, `warn`). | `lib/ai/pricing.ts`; `lib/business-os/llm/aiChargeRecorder.ts` | Two consequences. (1) A model-name change needs a pricing row first (order row; the row itself is the price review stream's). (2) **A key from the wrong organisation or project leaves the ledger and customer credits looking normal**, while the bill and the spend limit land on the other account: only the provider dashboard shows it (T-LLM-7, T-LLM-8, user tier). |
| LM-12 | **The model-name names have their own readers.** `OPENAI_MODEL` is read twice in `app/api/orchestration/run-step/route.ts`, with different code defaults; `OPENAI_CHAT_MODEL` twice in `lib/business-os/ai-data-layer/AIDataLayerService.ts`. Each falls back to a code default when unset. | those files | Unset is valid. A set value must name a model the recorded project can use and that has a pricing row. **No functional probe** for either reader (Q-D6d-3): the row is Set / Not set, plus the user's model-availability report, plus "a pricing row exists for that model" (read-only); T-LLM-9 is the drift check. |
| LM-13 | **Some scripts spend on a real account.** `npm run eval:chat` and `npm run bos:llm-settings` load the local env file through `scripts/env-preload.ts` and call the real provider with whatever key it holds. Many other `scripts/*.ts` read the two main keys. Unit tests set stub keys when unset (`tests/plugins/jest-setup.ts`). | `scripts/env-preload.ts`; `package.json` scripts | No DO probe runs these without the user's explicit approval naming the script and the account it will charge; they are key-holder runs (SKILL.md §2) and pre-checks at most, never the post-change probe. A green Jest run proves nothing about any key. |

### D6d.2 What `llm-providers.md` teaches (the six-part template)

Same intro sentence as `stripe.md`, `email.md` and `google.md`, plus the live-check line. Each part is organised by L1–L4, with L5 one line and M its own row.

**(1) What must differ between environments.** One "Rule per environment" column plus a target sentence, as in `google.md` §1. The current setup (which accounts, organisations, projects or workspaces exist, which key each environment uses, where each value lives, what limits are set) is a private-inventory pointer: "Where the value lives is found at run time, reported by name and target only." Rows:

| Setting | Rule per environment |
|---|---|
| Account, organisation, project or workspace per key | As recorded. Every key on one target belongs to the recorded account for that environment. **Recommended shape:** production keys in their own project or workspace, with their own spend limit; preview and local keys in a separate one, so a preview run cannot spend against production's limit. The skill states the shape, never whether it is in place |
| L1, L2 keys | Set on production and preview (catalogue `required`); local optional, guidance only |
| L3 key | Set wherever the help bot is served (the help bot constructs the Groq provider directly; its settings rows choose the model only), and wherever a settings row selects Groq |
| L4 key | Covered when selected: set wherever a settings row selects Kimi; otherwise optional |
| Spend limit, budget and alerts | Per project or workspace, as recorded; set by the user in the provider dashboard; never written into the repo |
| Model-name names | Unset (code default) or a model available to the recorded project with a pricing row |
| SDK-implicit names (LM-6) | Not set on any target unless recorded with a reason |
| Local | Guidance only. DO reads no `.env*` file; a local key never belongs to the production project |

**(2) Where the code reads it.** The LM-2 to LM-12 files, per credential, named as files and functions. Expected names per environment: the catalogue group `ai` at `origin/main`; effective requiredness for L3/L4 comes from code (a provider class constructed outside the factory) and from the settings rows (LM-5), derived at use time. The V6 admin config lives in `system_settings_config`, read by `AgentGenerationConfigService.ts`. Under "never a probe target": the deprecated V1 research strategy (`lib/plugins/strategies/chatgptResearchStrategy.ts`) and the `backups/` copies of old readers.

**(3) Dashboard steps (the user),** by area name, because the consoles move (confirm at use time): per provider, **API keys** (create, name, restrict to a project where offered, revoke; last-used time where shown); **organisation / project / workspace** settings (which one the key belongs to); **Billing, limits or budgets** (spend limit, alert thresholds, current period spend); **Usage** (per day, per key or project where offered); **model access** per project where the vendor gates it. Setting the value on Vercel: `vercel-ops` and `env-change-protocol`; the value never passes through chat or a file.

The user reports presence, "belongs to the recorded project: yes/no", "limit and alert set as recorded: yes/no", "usage shown for the probe window: yes/no", "model available: yes/no" and the last-updated time. Never a key, a key fragment, an organisation or project id, an amount on an invoice, or a limit value.

**(4) Probes** (as ruled in Q-D6d-2). Each fails when the setting is wrong. No probe needs DO to hold a key. Every functional probe is a **real provider call: it spends real money and writes ledger rows**; it is optional, user-approved, one run, never repeated in a loop, and "not probed (declined)" if the user declines. A probe that meets deployment protection is "not probed".

Ledger reads follow the Q-D6d-4 rules: the select list holds only `provider`, a derived class (or `feature`, `success`, `error_code`) and `count(*)`; the four never-read columns are never selected, grouped, ordered or returned; the Groq class is "Groq API error: " followed by the status (from our code), the Anthropic class is the status number at the start of the SDK's message (confirmed against the installed SDK at use time), and unmatched failures are "unclassified" and reported, never folded into 0. A ledger read is usable only where that environment writes to its own database, as recorded; otherwise "not conclusive (shared ledger)".

| Change | Probe | Pass | Fails when | Who | Side effects |
|---|---|---|---|---|---|
| Any of the six names | `/admin/environment` on that deployment | Name shows Set (or Not set, for an intended unset) | Shows the other state; `required-not-set` flagged | Main session or user (admin session) | None |
| L1 and L3: one help bot question | On that deployment, after it is Ready, signed in with a normal session (not admin), ask the floating help button on a V2 page a harmless question that is new (it must miss both the FAQ and the answer cache, and must not ask to find an agent), with the help bot's semantic search setting on, as read at use time on the help bot config screen | L3: the answer appears with the Groq source badge, and a `help_bot_v2` row with `success = true` for provider groq. L1: ≥ 1 `helpbot` row with `success = true` for provider openai, and 0 failure rows. Both `created_at` after the probe time | L3: an error answer, or a groq failure row. L1: a failure row, or 0 rows while both LM-9 classes are 0. The visible answer is not evidence for L1 (a failed lookup logs "Cache search error", module `HelpBotV2API`, and Groq still answers) | User (trigger); DO (ledger counts) | Three real provider calls (an embedding, a Groq chat call, a second embedding), ledger rows on the platform's own account, no credits charged; one shared answer-cache row holding the question and the answer (reused for later matching questions; no in-app route removes it); one support-analytics counter increment. A FAQ or Cache badge (or an agent-search answer): "not probed (answered from FAQ or cache)", never a fail |
| L2 key | No app-side probe; `/admin/environment` Set + user dashboard read | Set, and "belongs to the recorded project: yes" | Not set, or "no" | Main session or user; user | None |
| L4 key | As L2, where a row selects Kimi | As L2 | As L2 | As L2 | None; where no row selects it: "not probed (not selected)" |
| Any key: traffic read (optional, never a substitute for a failing probe) | After Ready, DO counts that provider's ledger rows by `success` and class from Ready time onward | ≥ 1 success and 0 auth-class rows: "pass (from traffic)" | An auth class > 0 | DO | None; no rows: "not probed (no traffic)", never 0 |
| Key belongs to the recorded account | After a call probe or traffic, the user opens the recorded project's usage view | Usage shown for the window (allowing the vendor's reporting delay, confirm at use time) | No usage on the recorded project | User | None |
| Model-name name | No functional probe: Set / Not set, plus the user's "model available to the recorded project: yes/no", plus "a pricing row exists for that model" (read-only) | All three | Any one fails | Main session; user | None |
| Key rotation | The probes above on the new deployment, then revoke the old key, then repeat them | Pass after revoke | Any failure after revoke | User; DO | As the probes used |

Rotation overlap: until the old key is revoked, a pass may have used the old key (for example if the new value never reached the target), so it is "pass, not conclusive (overlap)" until the old key is revoked and the probe repeated.

**(5) Gotchas,** each grounded in a repo file or marked vendor fact:

- **Four keys, four accounts** (D6d.1 table): a working OpenAI path proves nothing about Anthropic, and the reverse.
- **One OpenAI key serves chat, embeddings and images** (LM-4).
- **The factory keeps the key it first read** (`providerFactory.ts`): a change takes effect on the next deployment; revoke the old key only after that deployment is Ready and probed. Older Preview deployments built before a rotation keep the old key and fail once it is revoked; redeploy any still needed.
- **An unset key fails the call** (LM-2); the caller's own log line, if any, carries it; not a counted class.
- **Groq does not depend on a selection** (LM-5): the help bot constructs it directly.
- **A settings row can make an optional key required** (LM-5): check the key before a row selects a provider.
- **SDK-implicit names** (LM-6): invisible to the catalogue and the guard; can re-route or re-bill calls. Per client as LM-6; the Kimi client receives only the OpenAI organisation and project names; Groq has none. Names from SDK docs at use time.
- **Groq and the availability helpers** (LM-7): they never report Groq; an unset Groq key in the help bot shows as "Groq API error: " plus the status at request time.
- **Wrong organisation or project looks healthy in the app** (LM-11): ledger and credits are priced in-app; only the provider dashboard shows the account the spend landed on and the limit it counts against.
- **The ledger needs the service-role key too** (LM-9): set but wrong is "not conclusive (ledger write failed)"; unset fails every factory call and is a `supabase-ops` fault.
- **Model access differs by project** (LM-10): a fallback line after a key change points at the key's project or the setting.
- **Scripts spend for real** (LM-13); a green Jest run proves nothing about keys.
- **Mistral is not wired** (LM-3): not a gap.
- **Spend limits, budgets and alerts are dashboard facts** the user operates; never written into the repo.
- **Deprecated readers are never probe targets.**

**(6) Drift checks** (in `env-drift-audit` §7 format and under its rules):

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-LLM-1 | On each **Vercel target**, the `ai` group names match the catalogue's `expectedIn` (L1, L2 set on production and preview). Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-LLM-2 | No `NEXT_PUBLIC_` name on any target holds an LLM key or model name: every `NEXT_PUBLIC_` name on the target is a `NEXT_PUBLIC_` name in the catalogue, and none of the `ai` group's names appears with the prefix. Derived, not a typed list | Catalogue at `origin/main` | `vercel-ops` §3 (names only) | Critical | DO |
| T-LLM-3 | No SDK-implicit name (LM-6) is set on any target unless recorded with a reason | SDK docs at use time; private inventory | `vercel-ops` §3 (names only) | High | DO |
| T-LLM-4 | Every provider that a settings row selects, or that a code path constructs outside the factory (derived from code at `origin/main`), has its key Set on that environment's deployment | Code at `origin/main` (setting keys and direct constructions derived); settings rows (provider values only) | `supabase-ops` §2 read-only SQL; `/admin/environment` or `vercel-ops` §3 | High | DO |
| T-LLM-5 | Per provider, `token_usage` failure rows since the last run, counted by `error_code` (OpenAI) or the Q-D6d-4 class (Anthropic, Groq). An auth class > 0: High. A quota or rate-limit class > 0: Medium. Unclassified > 0 reported as such. A provider with no rows in the window: "not read (no traffic)", never 0 | Change records | Read-only SQL, counts only | High / Medium | DO |
| T-LLM-6 | 0 "Provider rejected the configured model; retrying once with the code default" (module `BosLlmModelFallback`) since the last run. 0 does not prove model access when the configured model is the code default; at most one line per instance per settings-cache period | Change records | Runtime logs | Medium | DO |
| T-LLM-7 | Each key on each target belongs to the recorded organisation / project / workspace for that environment; preview and production separation as recorded | Private inventory | User report (API keys, project settings) | High | User |
| T-LLM-8 | Spend limit, budget and alerts set per project as recorded; current-period spend below the alert threshold; the recorded project shows usage on the days the ledger shows traffic for that provider | Private inventory; ledger counts by day (DO) | User report (Billing, Usage) | High | User; DO |
| T-LLM-9 | 0 "No pricing found; recording $0 for this call" (module `AiPricing`, level `warn`) since the last run; each set model-name name names a model available to the recorded project | Change records; private inventory | Runtime logs; user report | Medium | DO; User |
| T-LLM-10 | `PROVIDERS` in `providerFactory.ts` at `origin/main` lists exactly the providers this file covers; a new one means this file needs a row before its key is set | Code at `origin/main` | Repo read | Low | DO |

**(7) Tiers and order.** Pointer to `env-change-protocol`; nothing restated.

**Tiers.** Any key create, rotation or revoke for a key production uses; any change of organisation, project or workspace for it; any spend limit, budget or alert change on production's project; and any production model-name change (it changes cost) are **production tier**: SA reviews the plan, the user executes. Removing a key is a hard off for every feature on that provider (every call throws), so it is production tier on any target where the catalogue, a settings row or a direct construction requires it. Changes to a key used **only** by non-production environments, as recorded, are reversible: the user applies them after the approval in chat. Where one key or project serves several environments, every change to it is production tier.

| Change | When |
|---|---|
| A settings row will select Groq or Kimi on an environment | That key Set on that environment's deployment and probed before the row is changed |
| A model-name value, or a row choosing a new model | Model available to the recorded project, and a pricing row present, before the change |
| A newly wired provider (for example Mistral) | Catalogue name, key on every target the catalogue requires, and a row here, before merge |
| Key rotation | Create new in the recorded project → set → deploy Ready → probe → revoke old **after deploy** → probe again; overlap per (4) |
| Lowering a spend limit | After the user compares current-period spend with the new limit (calls are refused once a limit is hit: vendor fact, confirm at use time) |
| Removing a key | Only after no settings row or code default selects that provider, no code path constructs that provider directly, and the catalogue does not require it on that target |

### D6d.3 Files to change

| # | File | Action |
|---|---|---|
| D6d-1 | `.claude/skills/third-party-ops/llm-providers.md` | New, §D6d.2, target ≤ ~175 lines (Q-D6d-7) |
| D6d-2 | `.claude/skills/third-party-ops/SKILL.md` | §5 row "LLM providers" → `[llm-providers.md](llm-providers.md)`. Add to the description triggers: "an OpenAI, Anthropic, Groq or Kimi key, an LLM provider key, a model-name env var, an LLM spend limit or budget, provider usage or billing". Nothing else |
| D6d-3 | This requirement | §0 row, these sections, notes, reviews |
| — | `stripe.md`, `email.md`, `google.md`, `devops.md`, `env-drift-audit`, `env-change-protocol`, `supabase-ops`, the runbook, `CLAUDE.md` | **Not edited** |

**Code follow-ups (requirement only, not skill text):**

- FU-D6d-a (Low): `isProviderAvailable`, `getAvailableProviders`, `getStatus` and `clearInstances` in `providerFactory.ts` cover Groq like the other providers, with tests, or record why not.
- FU-D6d-b (Low, widened per Q-D6d-5): the catalogue (or `/admin/environment`) flags a provider key that is unset where either a settings row selects that provider or a code path constructs that provider directly (the help bot's Groq), or records why not. The skill's T-LLM-4 stands either way.

### D6d.4 Acceptance criteria

- [ ] `llm-providers.md` has the six parts plus tiers/order, organised by L1–L4, with L5 one line and M one row; every file path it names exists; it states the Q-D6-2 live check by role, not by environment.
- [ ] Each of L1–L4 has a probe row with its precondition, pass, fail, not-probed states, who runs it and its side effects, as ruled in Q-D6d-2. Every functional probe says it spends real money and writes ledger rows. No probe runs `eval:chat`, `bos:llm-settings` or any key-reading script without user approval.
- [ ] `error_message`, `request_payload`, `response_metadata` and `user_id` are never selected, grouped, ordered or returned; `error_message` appears only inside the fixed Q-D6d-4 match. A missing row is "not conclusive" when an LM-9 class is > 0. No sentence says Groq is reached only through a selection.
- [ ] The DB-held model choice is stated as the admin screens' and the runbook's, with T-LLM-4 the only DO read of it (provider values, read-only).
- [ ] The SDK-implicit names are described per client, never listed; "confirm in SDK docs at use time" is present.
- [ ] No copied lists: no setting-key list, no model name, no line number. QA greps `llm-providers.md` for the model-name constant names, the OpenAI and Anthropic model-family prefixes, the Groq-hosted and Kimi model families (derived at use time from `GROQ_MODELS` and `KIMI_MODELS`, never copied into tracked text), `bos_llm_area_`, `orchestration_routing_`, any URL scheme or vendor host, and line references: 0 hits.
- [ ] Every quoted log string is verbatim in the cited file with its module or service name (`grep -cF`); vendor messages and error codes are marked "confirm at use time". No text past "environment variable is not configured" is quoted.
- [ ] The restatement grep from §D6.4 over `llm-providers.md`: 0, or each hit is a pointer.
- [ ] Public repo: the finding-11 regex over the added lines is 0. No key, key prefix or fragment, organisation, project or workspace id, base URL, domain, invoice amount, limit value or personal path. No line states which environment has which key, which project exists, whether preview and production are separated today, or what limits are set.
- [ ] The SKILL.md diff is only D6d-2; the diff touches only D6d.3 files; `wc -l llm-providers.md` ≤ 175.

### D6d.5 Questions — all settled

- **Q-D6d-1 (settled by SA):** keep Kimi as "covered when selected"; its probe is "not probed (not selected)" until a row selects it, and T-LLM-4 catches a selection without a key.
- **Q-D6d-2 (settled by SA):** L1 and L3 share one help bot question; L2 and L4 have no app-side probe (`/admin/environment` Set + user dashboard read); all four get the optional traffic read, with "not conclusive (shared ledger)" where another deployment writes to the same ledger.
- **Q-D6d-3 (settled by SA):** no functional probe for either model-name reader; Set / Not set + availability report + pricing row present; T-LLM-9 stays.
- **Q-D6d-4 (settled by SA):** yes, as counts only, under the two rules in part (4).
- **Q-D6d-5 (settled by SA):** accepted as FU-D6d-b, widened to direct constructions.
- **Q-D6d-6 (settled by SA):** the throw is not a counted class; constructor options as in LM-6.
- **Q-D6d-7 (settled by SA):** ≤ ~175 lines; if over, trim prose, never probe or drift rows.

---

## 6. Non-Functional Requirements

- **Security:** no secret values printed or decrypted. No project refs, IDs, secret locations or open weaknesses in any tracked file. Production and irreversible actions are executed by the user only.
- **Reviewability:** every DO change plan is one change per step, with before-state, exact action, and a probe that fails when the change is wrong.
- **Usability:** skills are usable by the main session without the agent.
- **CI cost:** DO-1 adds no CI job and no CI time.
- **Consistency:** the agent and skill files follow the format of the existing `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` files.

---

## 7. Acceptance Criteria (DO-1)

- [ ] `.claude/agents/devops.md` exists with valid frontmatter (`name`, `description`, explicit `tools:` list including the chosen Supabase MCP and Vercel MCP tool names).
- [ ] The agent file states the role, the boundaries with RM, Dev and SA, the bounded jobs, the three permission tiers, the public-repo rule, and a "What You Must NOT Do" section covering FR-3.
- [ ] `.claude/skills/env-change-protocol/SKILL.md` exists with frontmatter `name` and `description` in the existing skills' format, and its description triggers on environment and settings changes (FR-4).
- [ ] The skill contains the eight protocol steps, the permission tiers, and a change-record template.
- [ ] CLAUDE.md Agent Team table has a DO row (initials DO, triggered by User or TL). The change adds no counts, statuses or dates, and the Ship drill numbering is unchanged.
- [ ] `team-leader.md` has the DO handshake rows (environment change plan, SA review of risky plans, post-merge environment gate).
- [ ] `release-manager.md` has the one-line RM/DO boundary note.
- [ ] **Grep check:** no committed file in the diff contains a Supabase project ref, a Vercel project or team ID, a GitHub app or installation ID, a secret value or key prefix, a secret storage location, or a description of an open weakness. QA runs a grep over the diff for ID-shaped strings and key prefixes, and reads the diff for the rest.
- [ ] The diff touches only `.claude/agents/devops.md`, `.claude/skills/env-change-protocol/SKILL.md`, `CLAUDE.md`, `.claude/agents/team-leader.md`, `.claude/agents/release-manager.md`, `.claude/agents/system-architect.md` and this requirement (SA finding 10).
- [ ] The finding-11 regex over the added lines of the diff returns zero hits, or each hit is explained in the QA report. The `tools:` line contains no `*`.
- [ ] Tool-list smoke test in a fresh session (SA finding 11): every listed MCP name resolves, no excluded tool is available, and the output contains no ID.
- [ ] The agent file names the forbidden Bash and `gh` families, states the verbatim-approval rule and the SQL rules R1 (a)–(d); the skill holds the order-against-deploy field, the rollback field and the no-secret probe rule; `team-leader.md` has all four finding-3 rows (SA finding 12).

---

## 8. Out of Scope / Future Roadmap

- The DO-2 to DO-5 skills (scoped in §5, built in later slices).
- Installing the Vercel CLI.
- Any actual environment change. DO-1 only defines the agent and the protocol.
- Moving the private environment inventory into the repo. It stays untracked by design (§3.4).
- Any application code change.

---

## 9. Open Questions

- [ ] **Q1: Which Supabase MCP server does DO use?** Two are connected. (raised by: BA | status: for SA)
  *Suggested resolution:* SA picks one and Dev lists its tool names explicitly in the frontmatter. Prefer the read-capable tools only (advisors, logs, list migrations, read-only SQL). Leave the apply-migration tool out of the list, so the "never applies DDL" rule is enforced by the tool list and not only by the prose.
- [ ] **Q2: Does the agent frontmatter accept a wildcard for MCP tools, or must each tool be named?** (raised by: BA | status: for SA)
  *Suggested resolution:* name each tool explicitly, as the user decided. Keep the Vercel list to read tools plus the env-var create/update tools needed for the reversible tier.
- [ ] **Q3: Include ClickUp tools in DO-1, or defer?** (raised by: BA | status: for SA)
  *Suggested resolution:* include only the read and status-update ClickUp tools, for syncing the DevOps task list. No create or delete tools.
- [ ] **Q4: Where does DO write change plans and change records?** (raised by: BA | status: for SA)
  *Suggested resolution:* the change plan goes in the workplan of the cycle that needs it, under an "Environment changes" section. Records that would name refs or IDs go only to the untracked private docs. The tracked record names environments by role.

---

## 10. Notes on Integration Points

| Item | Affected by DO-1 | How |
|---|---|---|
| `.claude/agents/devops.md` | New | Agent definition |
| `.claude/skills/env-change-protocol/SKILL.md` | New | Core protocol skill |
| `CLAUDE.md` | Edited | One Agent Team row, optionally one pointer line |
| `.claude/agents/team-leader.md` | Edited | Handshake rows, agent list in description |
| `.claude/agents/release-manager.md` | Edited | One boundary line |
| `.github/workflows/`, `.github/ci/non-deploying-change.sh`, `vercel.json`, `docs/runbooks/`, `docs/VERCEL_ENV_SETUP.md`, `docs/SUPABASE_CLIENTS.md` | Read only | Reference material for DO-2 to DO-5 |
| Database tables, API routes, app code | Not affected | — |

---

## SA Review

**Reviewed by SA — 2026-10-30**
**Verdict: APPROVED WITH CHANGES.** The §3 design is sound and is not reopened. The changes below close gaps where the tool list or the handshakes would not actually enforce the agreed design. Dev builds DO-1 with findings 1–12 and rulings R1–R5 applied. No second SA requirement pass is needed. SA checks them at code review.

### Rulings on the open questions

**R1 (Q1): Supabase server = the Claude Code plugin server (`mcp__plugin_supabase_supabase__*`). Exclude the apply-migration and every other write tool.**
- Why the plugin server: its tool names are stable and readable, and it is the one the CLI session and subagents load. The claude.ai connector's server name is an opaque per-connection instance ID. It can change on reconnect, and writing it into a tracked file would breach §3.4. Do not name it anywhere in the repo.
- **Include (read only):** `list_projects`, `get_project`, `list_tables`, `list_extensions`, `list_migrations`, `get_advisors`, `get_logs`, `execute_sql`, `list_edge_functions`, `get_edge_function`, `list_branches`, `search_docs`.
- **Exclude:** `apply_migration`, `create_project`, `pause_project`, `restore_project`, `get_cost`, `confirm_cost`, `deploy_edge_function`, `create_branch`, `delete_branch`, `merge_branch`, `reset_branch`, `rebase_branch`, `generate_typescript_types` (Dev's domain), `get_publishable_keys` / `get_anon_key` (key material, see the no-secrets rule), and any tool not in the include list.
- **The list cannot fully enforce "never applies DDL".** `execute_sql` accepts any statement, DDL included. It stays in the list because pre-check and post-check SQL is a Read-tier job (§3.3). The agent body and the skill must therefore require all of the following:
  - (a) DO's SQL is SELECT-only.
  - (b) Each check is wrapped in a read-only transaction (`begin read only; … ; commit;`) as defence in depth. DO-2 confirms that this form works through the tool.
  - (c) Checks return counts, booleans or catalog facts, never customer rows or PII.
  - (d) DO never selects from `vault` or any decrypted-secrets view.
- **Future, not DO-1:** a separate read-only-mode Supabase connection for DO would turn (a) into real enforcement. It is a harness change, so log it for DO-5.
- **Names:** Dev confirms each name against the live server at build time. A name that does not exist is dropped. Nothing is added beyond this list without SA.

**R2 (Q2): name every tool explicitly. No wildcards.**
- Claude Code documents `mcp__server__*` for permission rules and command `allowed-tools`. It does not document wildcards in a subagent's `tools:` field.
- An unrecognised entry in `tools:` is dropped silently. An omitted `tools:` field inherits everything, MCP included.
- So: comma-separated exact names, and a smoke test that proves the names resolve (AC addition, finding 11).

**R3 (Q3): defer ClickUp. Leave it out of DO-1.**
- No DO-1 job (audit, drift report, change plan, verification) needs it.
- The update-task tool cannot be limited to the status field: it also edits names, descriptions and assignees. So it does not fit "status only".
- The DevOps list's identity is a private ID that would have to live outside the repo anyway.
- Revisit in DO-5 with a scoped proposal.
- The "ClickUp task status" example in §3.3 can stay as a tier illustration.

**R4 (Q4): BA's suggested resolution is accepted, with two additions.**
- (a) A change tied to a cycle goes in that cycle's workplan under `## Environment changes`, written by role only.
- (b) A standalone change (no cycle) goes only to the untracked private docs. No new tracked folder is created; that would be a new pattern for no gain.
- (c) Every plan and record follows the skill's template (finding 6).

**R5 (Vercel tool list): read tools only in DO-1. No Vercel write tool at all.**
- **Include, by category, exact names confirmed live by Dev:** list/get teams and projects; list/get deployments; deployment build logs and events; runtime logs and runtime errors; list env vars **by name and target only**; list domains and project domains (read); cron and project config reads; documentation search.
- **Why no writes:** the env-var create/update tools take the target environment as a parameter. The tool list therefore cannot tell "Preview only" (reversible) from "Production" (user executes). A list that allows one allows both.
- **Where reversible Vercel writes go:** they wait for DO-3. DO-3 may propose adding create/update env-var with a hard rule that the target is exactly `preview` (any call whose target includes `production` or `development` is out of bounds). That proposal needs SA re-review.
- **Always excluded:**
  - delete of anything: project, deployment, env var, domain
  - pause, promote, rollback and rolling-release controls, alias set/remove
  - domain buy/register/transfer, DNS and TLS writes, firewall and protection writes
  - Blob and Edge Config writes, sandbox tools, billing/usage purchase tools, integration installs
  - **any tool that returns decrypted env values**, and the `decrypt` flag on any list call

### Findings

1. **[§3.6 / FR-1] Bash is not restricted by the tool list.** With Bash and `gh`, DO can still change branch protection (`gh api -X PUT|PATCH|POST|DELETE`), set or delete secrets and variables (`gh secret set`, `gh variable set`), edit the repo (`gh repo edit`), open or merge PRs, and run `git commit/push/stash`.
   - The agent body must say that Bash is governed by prose. It must list these command families as forbidden, apart from the read forms (`gh api` GET, `gh secret list` names only, `gh pr view/list`, `gh run view/list`).
   - Once the Vercel CLI exists, the same applies to it. `vercel env pull` writes **decrypted** values to disk, so it is forbidden outright. Carry this into DO-3.
   — Priority: High
2. **[§3.3 / FR-2] The reversible tier needs a defined approval channel.** A background subagent cannot receive "approved" mid-run, and another agent's message is never user consent.
   - Rule: DO applies a reversible change only in an invocation whose brief quotes the user's approval message verbatim, for that exact plan.
   - Otherwise DO returns the plan and stops. The main session then either applies it itself with the user, or re-invokes DO with the quoted approval.
   — Priority: High
3. **[§3.7 / FR-7] Order against the deploy is missing.** "Post-merge environment step = DO's gate" is too late for a migration or env var that the merging code needs: the deploy lands before the step does.
   - The plan must state for each step whether it happens **before merge**, **after merge but before testing**, or **after deploy**. Additive schema the new code reads is applied before merge.
   - Handshake rows to add to `team-leader.md`:
     - *Dev submits a workplan with environment impact* → trigger DO to write `## Environment changes` in that workplan **before** the SA workplan review, so SA reviews both together.
     - *SA approves a plan containing a production or irreversible step* → that step is cleared for the user to execute, at its stated point.
     - *Any pre-merge environment step* → it is done and verified by DO before the user's diff approval goes to RM.
     - *RM confirms merge and the workplan has post-merge environment steps* → trigger DO to prepare the user's step and verify it per the protocol. The cycle is not closed until DO reports evidence.
   — Priority: High
4. **[FR-8] The RM edit needs a second line, not just one.**
   - `release-manager.md` currently says that when `--auto` fails with "Auto merge is not allowed", RM reports to TL. That line should also say the fix is a repo setting owned by DO.
   - Keep the boundary sentence too.
   - Do not move RM's merge-queue procedure; it is still RM's.
   — Priority: Medium
5. **[Boundary with SA] SA has no instructions for reviewing DO plans.**
   - Add a short `### Environment change plan review` subsection to `.claude/agents/system-architect.md`. It checks:
     - the tier is classified correctly
     - one change per step
     - the before-state snapshot
     - the probe fails when the change is wrong
     - the order against the deploy (finding 3)
     - a rollback step
     - no IDs or secret locations in tracked text
   - This adds one file to the DO-1 diff (see finding 10).
   — Priority: Medium
6. **[§3.5 / FR-5] Add a rollback step to the change-record template.** This is not a change to the agreed protocol. The fields are: what, where (by role), tier, before-state, exact action, **how to undo**, order against the deploy, probe and the evidence it produced, who executed, when. Production steps without a known undo must say so explicitly, so SA can weigh them. — Priority: Medium
7. **[§3.5 step 5] Probes must not need DO to hold a secret.**
   - Verifying a key means going through the deployed surface: an endpoint or job whose server-side, timestamped output proves which key it used.
   - It never means DO reading or using the key itself.
   - Say this in the skill, next to the RLS zero-policy example.
   — Priority: Medium
8. **[FR-6] CLAUDE.md change: compliant. Make the pointer required and give it a place.**
   - The Agent Team row `DevOps | DO | User or TL` contains no counts, statuses or dates. The Ship drill is untouched.
   - The pointer should be one row in **Common Gotchas**, on the same pattern as the `durable-queue-drain` row: *"Any environment or settings change (env var, cron, domain, migration apply, auth setting, repo setting, MCP/permission/hook) → Use the `env-change-protocol` skill"*.
   - Do not touch the Standard flow line, since DO is out-of-band like TS.
   — Priority: Low
9. **[FR-4] The skill description must also fire for the main session.**
   - The description should name the verbs a user actually types: "set/rotate/swap a key", "apply the migration", "add an env var", "change branch protection", "add an MCP server".
   - It should also say it is used **by the main session and by DO**.
   - It must not mention any concrete project, environment URL or ID.
   — Priority: Low
10. **[§7 AC, file list] Update the allowed-files criterion** to: `.claude/agents/devops.md`, `.claude/skills/env-change-protocol/SKILL.md`, `CLAUDE.md`, `.claude/agents/team-leader.md`, `.claude/agents/release-manager.md`, `.claude/agents/system-architect.md`, and this requirement. Also add the DO-1 status update to §0. — Priority: Medium
11. **[§7 AC] Make the grep and the tool check executable.** Add these criteria:
    - **Grep (QA runs it over the added lines of the diff; zero hits required, or each hit explained in the QA report):**
      `grep -nE "[a-z]{20}|prj_|team_[A-Za-z0-9]{6,}|sb_(secret|publishable)_|sk_(live|test)_|eyJ[A-Za-z0-9_-]{10,}|ghp_|github_pat_|\.supabase\.co|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|vercel\.app"`.
      This also catches the claude.ai connector's instance ID. QA also reads the diff for secret locations and open weaknesses, which a regex cannot find.
    - **Tool-list smoke test.** This needs a fresh session, because agent files are loaded at session start.
      - Invoke `devops` with a read-only job ("list your available tools, then report the advisor count by severity for the production Supabase project, named by role, with no IDs").
      - Confirm that every listed MCP name resolved, and that no excluded tool (`apply_migration`, any Vercel delete/promote/env write) is available.
      - Confirm that the output contains no ID.
    - The `tools:` line contains no `*`.
    — Priority: Medium
12. **[§7 AC] Add criteria for findings 1–7.** The agent file:
    - names the forbidden Bash and `gh` command families (1)
    - states the approval-channel rule (2)
    - states the SQL rules from R1 (a)–(d)
    The skill holds:
    - the order-against-deploy field (3)
    - the rollback field (6)
    - the no-secret probe rule (7)
    `team-leader.md` has all four rows from finding 3. — Priority: Medium

### Public-repo check (§3.4) of this requirement

- Pass. The requirement names environments by role only.
- The finding-11 regex over this file returns zero hits.
- The incident references in §3.5 and §5 (key-swap outage, account suspension) are closed history, not open weaknesses.
- The untracked docs are mentioned only as existing, never by path.
- Existing tracked docs named in §10 are fine.
- This SA section deliberately does not record the claude.ai connector's server ID.

### Approval

[x] Requirement approved with the changes above. Proceed to branch `feature/devops-agent-do-1` and implementation. SA will check findings 1–12 and R1–R5 at code review.

---

## DO-1 implementation notes

**By Dev — 2026-10-30.** Config-only slice, so no separate workplan. Nothing committed.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/agents/devops.md` | New | Agent definition: frontmatter with an explicit tool list, role, boundaries, bounded jobs, tiers, approval channel, Supabase SQL rules, Vercel rules, Bash/`gh` allowed and forbidden families, plan locations, public-repo rule, report format, What You Must NOT Do |
| `.claude/skills/env-change-protocol/SKILL.md` | New | Tier classification + approval, order against merge/deploy, the eight steps (with the no-secret probe rule), read-only SQL rules, record location + public-repo rule, change-record template, final checklist |
| `CLAUDE.md` | Edited | Agent Team row `DevOps \| DO \| User or TL`; one Common Gotchas row pointing at the skill |
| `.claude/agents/team-leader.md` | Edited | DO in the description's delegate list; the four handshake rows of SA finding 3 |
| `.claude/agents/release-manager.md` | Edited | Boundary sentence under the role intro; the "Auto merge is not allowed" line now says the fix is a DO-owned repo setting |
| `.claude/agents/system-architect.md` | Edited | `### Environment change plan review` subsection in Phase 1 |

### Tool names (R1, R2, R5)

Each MCP name was checked against the plugin servers' deferred-tool lists recorded in this project's local session logs. No wildcard is used.

- **Supabase (plugin server):** all of R1's include list resolved **except `get_logs`, which does not exist** on the current server. Its log tool is now `query_logs` (a read-only log query). Dev listed `query_logs` in its place, as the same approved capability under a new name. **SA to confirm at code review**; if SA rules it out, delete that one entry.
- **Vercel:** `list_teams`, `get_team`, `list_projects`, `get_project`, `list_deployments`, `get_deployment`, `list_deployment_events` (build events and logs), `get_runtime_logs`, `get_runtime_errors`, `filter_project_envs` (env var names and targets), `list_domains`, `get_domain`, `get_domain_config`, `list_project_domains`, `get_project_domain`, `search_vercel_documentation`.
  - The server has no dedicated cron tool and no separate build-log tool. Crons are read from `vercel.json` in the repo and from `get_project`.
  - `filter_project_envs` has a deprecated `decrypt` parameter. The tool list cannot block it, so the agent body forbids passing it.
  - Excluded on purpose: `get_project_env` and `get_shared_env_var` (single-variable reads that can return the value), `get_deployment_file_contents`, and every create/edit/delete/promote/rollback/alias/DNS/firewall/Edge Config/sandbox/billing tool.
- No ClickUp tools (R3).

### Acceptance criteria

| Criterion | How it is met |
|---|---|
| Agent file with valid frontmatter and explicit tools | `devops.md` frontmatter: `name`, `description` (role + triggers), a comma-separated `tools:` line with no `*` |
| Role, boundaries, jobs, tiers, public-repo rule, Must-NOT list (FR-2, FR-3) | Sections What You Own, Boundaries, Your Jobs, Permission Tiers, Public-Repo Rule, What You Must NOT Do (every FR-3 item, plus the approval and Bash items) |
| Skill exists, triggers on environment changes (FR-4, finding 9) | Description names the user's verbs (set/rotate/swap a key, apply the migration, add an env var, change branch protection, add an MCP server) and says it is used by the main session and DO. No project, URL or ID |
| Eight steps, tiers, template (FR-5) | Skill §1 tiers, §3 eight steps, §6 template |
| CLAUDE.md DO row, no counts/statuses/dates, Ship drill unchanged | One Agent Team row, one Common Gotchas row. Ship drill and Standard flow untouched |
| TL handshake rows (finding 3) | All four rows added |
| RM boundary note (finding 4) | Boundary sentence + the auto-merge line routed to DO. Merge-queue procedure not moved |
| SA plan-review note (finding 5) | Seven checks in the new subsection |
| Finding 1 (Bash/`gh`) | Agent § Bash and `gh`: allowed read forms and a forbidden-family table, incl. `gh api` field flags (which imply POST) and `vercel env pull` |
| Finding 2 (approval channel) | Agent § Permission Tiers and skill §1 |
| R1 (a)–(d) SQL rules | Agent § Supabase table, and skill §4 |
| Findings 3, 6, 7 in the skill | Skill §2 + the `When` field (order); the `How to undo` field (rollback); step 5 third bullet (no-secret probe) |
| R4 plan locations | Agent § Where Plans and Records Go, skill §5 |
| Grep check (finding 11) | Run over the added lines of the diff and the two new files: zero hits |
| Allowed files (finding 10) | The diff touches only the six files above and this requirement |
| Tool-list smoke test (finding 11) | **Not run by Dev.** Agent files load at session start, so it needs a fresh session. QA runs it |

---

## SA Code Review — DO-1

**Reviewed by SA — 2026-10-30**
**Verdict: APPROVED WITH CHANGES.** R1–R5 and findings 1–12 are honoured. Two small prose additions to `devops.md` (C1, C2) are required before QA; no re-review needed, QA checks they are present.

### Ruling on `query_logs` (replaces `get_logs`)

Approved. It reads the project's log store and cannot change project state, so it is the same Read-tier capability R1 approved under its old name. Logs can carry request data (emails in auth logs, paths, IPs), so rule (c) applies to log queries too: DO reports counts and aggregates, never log lines that hold PII. This is covered by C2.

### Checked and honoured

- R1 include list (with `query_logs`), no excluded Supabase tool; plugin server only, no connector ID anywhere. R2 explicit names, no `*`. R3 no ClickUp. R4 plan locations (agent and skill §5). R5 Vercel read tools only; `decrypt` forbidden; value-returning single-var reads excluded.
- Finding 1 forbidden families incl. field flags and `vercel env pull`; 2 verbatim approval (agent + skill §1); 3 skill §2 + `When` field + all four TL rows; 4 both RM lines, merge-queue procedure not moved; 5 SA subsection with all seven checks; 6 `How to undo` incl. "No known undo"; 7 no-secret probe; 8 Gotchas row is a rule/pointer, Standard flow and Ship drill untouched; 9 description verbs + "main session and DO"; 10 §0 updated, §7 file list fixed by SA in this pass; 11/12 §7 criteria added by SA in this pass.
- Grep (finding 11 regex) over the diff's added lines and both new files: zero hits.
- Consistency: no contradiction with `release-manager.md`, `team-leader.md` or CLAUDE.md. The skill is self-contained and usable by the main session without the agent (tiers say "anyone following this skill"; approval = the user's own chat message).

### Code Review Comments

1. **C1** `devops.md` § Bash and `gh` — the allowed list is not stated as exhaustive, so commands outside both lists (`gh issue create|edit|close`, `gh label create`, `gh cache delete`, `gh repo sync|fork`, `gh extension install`, `git checkout <branch>`/`git switch`) are in neither. Add: "Anything not on the allowed list is forbidden." — Priority: Medium
2. **C2** `devops.md` § Tool Rules — Write/Edit are unrestricted, so "Your tool list has no write tools today" is not true for repo-file config: DO could edit `.claude/settings*.json` (its own permissions), `.github/`, `vercel.json` or migration files. Add a Write/Edit rule: DO writes only the `## Environment changes` section of a cycle workplan and the untracked private docs; in DO-1 it never edits `.claude/settings*.json`, `.github/**`, `vercel.json`, or `supabase/migrations/**` — a harness or repo-file change is planned and applied by the main session with the user. Also add the `query_logs` PII clause from the ruling above. — Priority: Medium

### Optimisation Suggestions

- `team-leader.md`: the generic "Dev submits workplan → trigger SA" row precedes the new env-impact row; consider a "(see next row if environment impact)" note so TL does not fire SA first. Non-blocking.

### Code Approved for QA: Yes, once C1 and C2 are applied (QA confirms both sentences exist, then runs the fresh-session smoke test).

### SA re-check — TL routing + scope

**Re-checked by SA — 2026-10-30. Verdict: APPROVED.**

- `devops.md`: C1 (allowed list exhaustive), C2 (Write/Edit scope) and the log-PII clause are present and correct. The Third-party row, scope rule and "Platforms without a tool" paragraph match §3.1 and DO-6; DO holds no third-party tools, so the user operates those dashboards.
- `team-leader.md`: the workflow (DO plan before SA workplan review; post-merge DO verify), the widened trigger, the handshake rows and § DevOps (DO) Routing agree with `devops.md` on bounded jobs, tiers, the verbatim-approval rule, standalone plans in untracked private docs, and the user executing production steps. No conflict with `release-manager.md`, CLAUDE.md or the Standing User Preferences (diff approval and auto-merge unchanged).
- SA fixed in this pass: the generic "Dev submits workplan" row now points to the DO row (closes the earlier optimisation note); the routing row for applying a reversible change now says the main session applies it while DO's platform tools are read-only (DO-1); `devops.md` "sandbox/live" aligned to "test/live".
- Public-repo check: no IDs, refs, key prefixes, secret locations or open weaknesses in the changed text.
- Non-blocking: §3.7 says a *requirement* with environment impact triggers DO; TL only wires the workplan stage. Acceptable for DO-1 (DO plans against the workplan); revisit if BA-stage planning is wanted.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created | BA drafted the requirement from the design already decided with the user. DO-1 is specified in detail; DO-2 to DO-5 are scoped. Awaiting SA review. |
| 2026-10-30 | SA review | APPROVED WITH CHANGES. Rulings R1–R5 (plugin Supabase server, read tools only; explicit names; ClickUp deferred; plan locations; Vercel read-only in DO-1) and findings 1–12 (Bash/gh rules, approval channel, order against deploy, SA plan-review note, rollback field, executable AC). |
| 2026-10-30 | DO-1 code complete | Dev built the agent, the `env-change-protocol` skill and the CLAUDE.md, TL, RM and SA edits. Supabase `get_logs` no longer exists; `query_logs` listed in its place, pending SA confirmation. Uncommitted, awaiting SA code review and QA. |
| 2026-10-30 | SA code review | APPROVED WITH CHANGES. `query_logs` approved. C1 (Bash allowed list exhaustive) and C2 (Write/Edit scope + log PII) required in `devops.md`. SA fixed §7: file list now includes `system-architect.md`; finding 11/12 criteria added. |
| 2026-10-30 | QA + fixes + scope | QA passed (6 pass, smoke test deferred). C1/C2 and the log-PII clause applied to `devops.md`; ClickUp example replaced. User widened scope to every platform the system needs to operate: Third-party row in §3.1, `devops.md` and the skill; DO-6 `third-party-ops` added. |
| 2026-10-30 | DO-1 merged; DO-2 spec | DO-1 merged (PR #578). BA wrote the DO-2 Specification (`supabase-ops` skill): deliverables, what the skill teaches (reading state, paste-and-check apply flow, paste-safe SQL, key and lifecycle facts, PostgREST gotchas), boundaries, acceptance criteria, SA questions Q-D2-1 to Q-D2-4. CLAUDE.md unchanged. Awaiting SA review. |
| 2026-10-30 | SA review DO-2 | APPROVED WITH CHANGES. Q-D2-1: `begin read only; …; commit;` (measured), never a session-level `SET`. Q-D2-2: ledger never proof. Q-D2-3/Q-D2-4: follow-ups, out of DO-2. Findings S1–S10 (persisting SET check, timing test instead of additive/destructive labels, checker must fail before apply, RLS-vs-grant checks, rollback for destructive migrations, legacy file names, no restated probe). |
| 2026-10-30 | DO-2 code complete | Dev built the `supabase-ops` skill (SKILL.md + two reference files) and the `devops.md` pointer line, with Q-D2-1 to Q-D2-4 and S1–S10 applied. CLAUDE.md unchanged. Uncommitted, awaiting SA code review and QA. |
| 2026-10-30 | SA code review DO-2 | CODE APPROVED. S1–S10 honoured. SA fixed six items in the skill files ("into" rule narrowed to literals/comments, unmeasured fresh-backend claim removed, pre-checks in the drop-`SET` rule, paste-error step, `CONCURRENTLY` exception, no raising lookups). S1's main-session check was run separately and closed (see SA Code Review — DO-2, item 2). QA passed (6/6). |
| 2026-10-30 | DO-2 merged; FU-1 built | DO-2 merged (PR #579). FU-1: the `Running Migrations` sections of `supabase/migrations/README.md` and `supabase/SQL Scripts/README.md`, and the apply options in `supabase/migrations/APPLY_MIGRATIONS.md`, replaced with the paste-one-file flow, a pointer to `supabase-ops` §4, and a warning against `db push` / `db execute` / `migration up` / `psql` on a hosted project. |
| 2026-10-31 | FU-1 merged; DO-3 spec | FU-1 merged (PR #584). BA wrote the DO-3 Specification (`vercel-ops` skill): deliverables, what the skill teaches (reading state across every project by role, which deployment holds a value, waiting for READY on the expected SHA, docs-only skips, CLI not installed and `vercel env pull` forbidden, dashboard-only settings), boundaries, acceptance criteria, SA questions Q-D3-1 to Q-D3-4 (Q-D3-1: BA suggests no Preview-only write tool). CLAUDE.md unchanged. Awaiting SA review. |
| 2026-10-31 | SA review DO-3 | APPROVED WITH CHANGES. Q-D3-1: no Vercel write tool, `devops.md` gets only the pointer line. Q-D3-2: no live shape probe; Dev reads the documented response schema; `filter_project_envs` and `get_project` treated as value-bearing. Q-D3-3: yes, Read tier, never trigger a cron. Q-D3-4: roles only, no "which values it holds". Findings V1–V14 (DO has no HTTP probe, value-bearing responses, domain not always assigned after rollback, ignored build = CANCELED, `npx vercel`, user never pastes values, who triggers a deploy, cron rules, unverified parameter names, AC additions). SA fixed five spec statements in place (featureFlags grounding, production-alias check, CANCELED reconciliation, docs-only wording, `vercel.json` keys) and removed the marketing project's Supabase-config detail. |
| 2026-10-31 | DO-3 code complete | Dev built the `vercel-ops` skill (SKILL.md + `dashboard-settings.md` + `tool-parameters.md`) and the `devops.md` pointer line, with Q-D3-1 to Q-D3-4 and V1–V14 applied. Q-D3-2 decided from documentation only (env list: `value` required on every item; project object: `env` list and a `crons` field). V13: `group_by` names corrected; `get_runtime_errors` has no deployment filter. CLAUDE.md unchanged. Uncommitted, awaiting SA code review and QA. |
| 2026-10-31 | SA code review DO-3 | CODE APPROVED. Dev's deviation accepted: `get_runtime_logs` with `deploymentId` is the only per-deployment evidence, `get_runtime_errors` a project-wide first look. SA fixed four wording items (`level` is not the HTTP status in §6 and `tool-parameters.md`; the `crons` enabled state falls back to the dashboard when `get_project` does not carry it, in §6 and `dashboard-settings.md`). `group_by` names re-checked by QA on a schema load. Awaiting QA. |
| 2026-10-31 | QA DO-3 | QA passed: 9 checks pass, the fresh-session load test deferred. No bugs. Three non-blocking edge cases in `tool-parameters.md` / §7 (the `environment` values for `get_runtime_logs` are not listed; three parameter statements are unverified; "not installed" is stated indirectly). Awaiting the user's diff review. |
| 2026-10-31 | DO-3 merged; DO-4 spec | DO-3 merged (PR #589). BA wrote the DO-4 Specification (`github-ops` skill): deliverables, what the skill teaches (named-field reads only, branch protection and rulesets read together, required checks read never assumed, the seven rules for a check that protects `main` and the order for changing the required set, merge queue and auto-merge facts with the RM boundary, "landed on main" verification, stacked PRs, pacing and the backup owner account, never `git stash`, public-repo specifics, dashboard-only settings), boundaries, acceptance criteria, SA questions Q-D4-1 to Q-D4-9. CLAUDE.md unchanged. Awaiting SA review. |
| 2026-10-31 | SA review DO-4 | APPROVED WITH CHANGES. Q-D4-1: read classic protection and rulesets, rulesets through `gh api` only; an error is "not read". Q-D4-2: next real PR, probe PR only by SA. Q-D4-3: never a whole log; `--log-failed` piped to `grep -m` only, as a `devops.md` allowed-list line. Q-D4-4: enabled states only, no alerts path. Q-D4-5: `--json name,updatedAt` in `devops.md`, `gh variable get` named forbidden. Q-D4-6: accepted. Q-D4-7: no setting change; RM gets the stacked-PR pointer. Q-D4-8: no number, `--limit` added. Q-D4-9: GraphQL stays forbidden. Auto-merge exception is not in TL/RM: TL row amended + one RM sentence join the file list. Findings G1–G18. SA fixed nine spec statements in place. |
| 2026-10-31 | DO-4 code complete | Dev built the `github-ops` skill (SKILL.md + `read-commands.md` + `dashboard-settings.md`), the `devops.md` pointer line and allowed/forbidden amendments (G1, G2, G3, G11, G15, Q-D4-3, Q-D4-5, Q-D4-9), the RM manual-gate sentence and stacked-PR pointer, and the TL "Auto-merge when CI is the only gate" row, with a short qualifier on the other auto-merge lines of RM and TL. Uncommitted, awaiting SA code review and QA. |
| 2026-10-31 | SA code review DO-4 | CODE APPROVED. Every `gh` command, flag and `--json` field in the skill checked against local `gh --help` and field lists; paths, frontmatter, CRLF, finding-11 regex, owner/repo-name and workflow-name greps all clean. The extra "unless a manual gate is open" qualifiers (RM x4, TL x2) ruled inside G18(d): each defers to the TL row and adds no rule. SA fixed five wording items: the `devops.md` `gh api` line and `gh pr|run|repo|workflow` line now forbid `value`, actor, login and email fields (`gh repo view --json` offers commit emails, `gh pr view --json commits` author emails); SKILL.md §1 never-select list widened to match; SKILL.md §2 `gh pr checks --required` given `--json`; the TL row example aligned with the "check" gate. |
| 2026-10-31 | QA DO-4 | QA passed: 9 checks pass, the fresh-session load test deferred. No bugs. Frontmatter, triggers, paths and sections, the public-repo greps (finding-11 regex, owner/repo name, 6+ digits, URLs, every workflow and job `name:`), the restatement greps, named fields and `--limit` on every read, banned forms only as prohibitions, every `gh` flag and `--json` field against local `gh` 2.92.0 (no network call), the `devops.md` diff against G18(a), the RM/TL auto-merge qualifiers, files touched and CRLF all checked. Four non-blocking edge cases: `--limit` on the §2 shorthand, the `// []` jq guard, two §D4.3 CI files not pointed to, one unqualified RM mechanism line. |
| 2026-10-31 | DO-4 merged; DO-5 spec | DO-4 merged (PR #590). BA wrote the DO-5 Specification (`claude-harness-ops` and `env-drift-audit` skills): findings F1–F9 (the tracked local settings file, settings precedence, MCP scopes, Supabase read-only mode, subagent hooks failing open, no permission rule that matches an MCP argument), what each skill teaches, files to change, acceptance criteria, SA questions Q-D5-1 to Q-D5-11. BA recommends splitting into DO-5a (harness skill + FU-3) and DO-5b (drift audit), building FU-3 with a user-scope read-only server, and closing FU-4 and ClickUp without building. CLAUDE.md unchanged. Awaiting SA review. |
| 2026-10-31 | SA review DO-5 | APPROVED WITH CHANGES. Q-D5-1: split; Dev builds DO-5a first, DO-5b after 5a merges with a short re-check. Q-D5-2: SA recommends untracking, the user decides; back up the file first, because pulling the untrack commit deletes it from every other checkout; no history rewrite. Q-D5-3: accepted, widened to every prompt- or trust-relaxing key. Q-D5-4: build in user scope, swap `execute_sql` only (never both listed), no URL in tracked text, other projects get no SQL tool until each has its own server. Q-D5-5 to Q-D5-11 accepted (FU-4 and ClickUp closed). Findings H1–H10: the FU-3 read-only probe must run unwrapped with a plugin-server control (the wrapped write probe could not fail); the server-name binding is trust-on-config; DO never opens user-scope files; junction removal reads the target first. SA fixed eight spec statements in place. |
| 2026-10-31 | DO-5a code complete | Dev built the `claude-harness-ops` skill (SKILL.md only), the `devops.md` pointer line with the H3 clause, and the `github-ops` pointer-row fix, with Q-D5-1 to Q-D5-11 and H1–H9 applied. The FU-3 `tools:` swap is not in the diff (the user has not added the read-only server; the H1 probe has not run), so it is FU-3b. Q-D5-2 untouched (awaits the user). CLAUDE.md unchanged. Uncommitted, awaiting SA code review and QA. |
| 2026-10-31 | SA code review DO-5a | CODE APPROVED. Deviation 1 (H7 creation command) kept: two workplans record `New-Item -ItemType Junction` working, the same evidence standard as the removal procedure. Deviation 2 (Q-D5-3 key names): none of the six names is backed by evidence in the repo, so SA replaced them with descriptions and a "read the key name from the settings docs" instruction. Deviation 3 (docs named, not linked) accepted. SA fixed three items: the six key names, the `jq` reads (`jq` is not installed here; replaced with tested `node -p` key and count reads), and "twice mis-quoted" (the record shows one). Finding-11 regex and personal-path greps: 0 hits. Awaiting QA. |
| 2026-10-31 | QA DO-5a | PASSED, all 10 checks. Finding-11 regex: 0 hits over the new skill and the 643 added diff lines. Personal-path, `mcp.supabase` and worktree-name hits appear only in BA and SA text that quotes the grep patterns or names the gitignored folder, not in the skill. Cited paths and sections exist. Frontmatter parses. Restatement grep: 0/0/0. `devops.md` diff is the H3 pointer line only, with one plugin `execute_sql`. The junction steps match H5, and the property names were confirmed by a read-only `Get-Item`. Both `node -p` reads are assigned to the main session and run cleanly against the tracked settings file. FU-3 matches H1, H2 and H4, with no URL. No whole-file churn. No blocking issues; 3 non-blocking edge cases. Awaiting the user's diff review. |
| 2026-10-31 | DO-5a merged; DO-5b BA re-check (FU-5) | DO-5a merged (PR #592). BA re-checked §D5.2.2 `env-drift-audit`, the D5-5 and D5-6 rows and the DO-5b criteria, marked *(BA re-check)*. H10 applied: the env-name sources are `lib/utils/featureFlags.ts` and `.env.example` (both confirmed to exist); junction reads are the main session's; production-against-`main` points to `vercel-ops` and `github-ops` §6. H3 applied: user-scope, managed, MCP-server and junction checks are "main-session check owed". The Supabase area reads through the plugin `execute_sql` under rules (a)–(d) until FU-3b, with no dependency on it. The local settings file is not an expected-state source (being untracked, PR #593 pending). New: check list (g) with 22 checks (G-1..G-6, V-1..V-5, S-1..S-5, CH-1..CH-6), each with its source, pointer, class and reader; Q-D5-9 examples confirmed, with Critical-class "not read" checks listed first; private inventory unreachable means "not read (expected state missing)"; repo files read on `main`; a five-part chat summary; on demand only. New questions Q-D5b-1 to Q-D5b-4. Awaiting the SA short pass. |
| 2026-10-31 | SA short pass DO-5b | APPROVED WITH CHANGES; Dev may build. Q-D5b-1 accepted. Q-D5b-2: names only is compatible with the Secret-exposure row, but DO has no form that prints names only, and the drafted pattern without `-E` matches nothing; the `.env.example` names read is a main-session check with `grep -oE` plus a guard count. Q-D5b-3 accepted, with five row corrections. Q-D5b-4: the compare read exists and answers the question, but the ref must be `origin/main` (local `main` measured 356 commits behind here), and only `identical` counts as current. CH-3 moves to DO (the untrack has landed on `origin/main`). The skill fits in about 150 lines with no reference file. Finding-11 regex over the added lines: 0 hits. |
| 2026-10-31 | DO-5b code complete | Dev built the `env-drift-audit` skill (SKILL.md only, 141 lines, no reference file) and the one `devops.md` pointer line under job 2, with Q-D5b-1 to Q-D5b-4 and SA findings 1–10 applied. PR #593 (untrack the local settings file) is merged, so CH-3 is DO's. Two items flagged for SA: the Git Bash rewrite of `origin/main:<dot path>` arguments, and the Grep only-matching question, which Dev could not confirm from its own tool schema. CLAUDE.md unchanged. Uncommitted, awaiting SA code review. |
| 2026-10-31 | SA code review DO-5b | Code Approved for QA. Dot-path rewrite: the skill now reads repo files as `origin/main:./<path>` from the worktree root. That is plain `git show`, already allowed, with a root-listing self-check. `git ls-tree` and the `MSYS_NO_PATHCONV=1` prefix were rejected as allowed-list changes that are not needed. Presence comes from the folder listing. The Q-D5-10 fix-plan pointer is accepted. Grep `-o` exists, but the guard needs an invert match the Grep tool lacks, so the `.env.example` names stay a main-session check. SA re-ran the procedure as counts only: guard 0, names 4, diff-stat 0. Four small skill fixes; `devops.md` +1/−0 unchanged. Finding-11 regex: 0 hits in the skill and in the 351 added lines; no personal paths. |
| 2026-10-31 | QA DO-5b | PASSED, 12 checks, no blocking issue. Finding-11 regex: 0 hits in the skill and in the 413 added lines across the four files. All 22 checks present, with classes equal to the spec. SA ruling 1 run live: from the root, `./.gitignore` reads (82 lines) and `./.claude/` lists 3 names; from `lib/` the same read fails "does not exist" and the root listing shows no `.github/`. `.env.example` as counts only: guard 0, names 4, BRE 0, diff-stat 0. `claude-harness-ops` fix: 5/5 lines, no churn, consistent with `origin/main`. Two non-blocking items: the `claude-harness-ops` description still opens with "the tracked local settings file", and that file's edit is outside the 5b rows of D5.3 and not yet recorded here. |
| 2026-11-01 | DO-6 spec | Inventory pass (env var names, SDKs, hosts; names only). BA spec with split DO-6a..6h; SA approved with 7 changes; user decisions Q-D6-1..3 recorded in §D6.6. |
| 2026-11-01 | DO-6a code complete | Dev built the `third-party-ops` skill: `SKILL.md` (86 lines: pointers, scope, who does what, common rules, template, platform index, checklist) and `stripe.md` (134 lines: the seven parts plus the T-ST drift rows), with SA required changes 1–7 and Q-D6-4..12 applied. `devops.md` +1 pointer line, `tools:` unchanged; `env-drift-audit` four pointer edits (145 lines). Two spec corrections from the code: the plan resolver is `planInvoiceResolver.ts`, and `charge.refunded` is read by the boost resolver on the platform side. Changes nothing about the current Stripe setup. Uncommitted, awaiting SA code review. |
| 2026-11-01 | DO-6a SA code review | Code Approved for QA. Every quoted log string and cited path verified in code. SA fixes: SKILL.md `devops.md` pointer names all four sections; `stripe.md` §1 no longer states Preview's current state; `env-drift-audit` §1 names the five areas. Rulings on Dev's six items; FU-D6-e logged (Stripe clients without `apiVersion`). Condition before commit: the main session corrects the T-ST-1 pointer in §D6.6 and rewords two current-state phrases there. |
| 2026-11-01 | QA DO-6a | PASSED, 14 checks, one Medium item before commit. Every §D6.4 criterion passes; SA change 1(f): the resend probe holds (a)–(e), and all 10 quoted log or response strings are verbatim in the webhook route. Finding-11 regex 0 over the added lines (new files `git add -N`'d); vendor-prefix, URL and path greps 0; 38 cited paths exist; every cross-skill section resolves. §D6.6 already corrected. Medium: SA Code Review — DO-6a quotes the removed current-state phrases, so tracked text still states them. Low: the new files are LF. |
| 2026-11-01 | DO-6b spec + SA short pass | BA scoping spec (email: Resend, SMTP, Gmail system sender); SA approved with changes 1–12, settled Q-D6b-1/2 (no user question), dropped FU-D6b-c (already tracked), accepted FU-D6b-a/b. |
| 2026-11-01 | DO-6b build | `third-party-ops/email.md` new; SKILL.md index row + triggers. Awaiting SA code review and QA. |
| 2026-11-01 | DO-6b SA code review | Code Approved for QA. Changes 1–12 pass; code claims verified. SA fixed the send probe (send-email option, non-Paid type, revoke audit entry), the replay precondition (open/click count), the smoke script's `--url`, and two short-pass wording tidies. Leak scan 0. |
| 2026-11-01 | QA DO-6b | PASSED, 19 checks, one Medium item before commit. Every §D6b.4 criterion and SA changes 1–12 pass; all quoted log strings verbatim (`grep -cF`); replay safe-type precondition, send-probe gating and the plan-cancel order row match the code; 16 cited paths exist; leak regex 0. Medium: the requirement's SA sections describe the contact route beyond "a second `GMAIL_*` reader outside the transport". Low: webhook row timestamp caveat, §D6b.2 lags SA fixes, no Gmail trigger, contact-route wording, `email.md` LF. |
| 2026-11-01 | DO-6b QA fixes (main session) | QA Medium fixed: three requirement passages reworded to the `email.md` description of the contact route. Low 1: webhook-secret row "Fails when" excludes the timestamp refusal. Low 3: SKILL.md trigger for a Gmail refresh token. Low 4: "contact-route mail". Low 2 (§D6b.2 lags SA code-review fixes) left: the SA Code Review section records them. |
| 2026-11-02 | DO-6c spec + SA short pass | BA scoping spec (Google: sign-in client, invite ID-token client, plugin OAuth client, Places, Custom Search; Gmail system sender cross-linked); SA approved with changes 1–13, settled Q-D6c-1..8 (no user question), accepted FU-D6c-a/b/c. |
| 2026-11-02 | DO-6c build | `third-party-ops/google.md` new; SKILL.md index row + triggers. Awaiting SA code review and QA. |
| 2026-11-02 | QA DO-6c | PASSED, 18 checks, no bugs. Every §D6c.4 criterion as overridden by SA changes 1–13, the public-repo regex (0) and weakness grep (4 `throttl` hits, all the "not probed (throttled)" outcome), current-state text, paths, links, verbatim strings, code claims, CRLF and length (144) checked. Four Low edge cases: two vendor messages unmarked, rate-limit detail in SA text, spec text lags SA change 1, `google.md` LF. |
| 2026-11-02 | DO-6c QA fixes (main session) | QA Low 1: vendor messages in `google.md` (`redirect_uri_mismatch`, the invalid-client page) marked "confirm at use time". QA Low 2: the SA short-pass ruling on Q-D6c-3 no longer spells out the rate-limit bucket and budget. Lows 3 (spec text lags the SA changes; the SA section records them) and 4 (LF in the working copy; git normalises it) left as they are. |
| 2026-11-02 | DO-6d spec + SA short pass | BA scoping spec (LLM providers: OpenAI, Anthropic, Groq, Kimi keys; the two model-name names; Mistral not wired); SA approved with changes 1–13 and settled Q-D6d-1..7 (no user question): Groq is required wherever the help bot is served, two ledger cases, never-read columns and the counts-by-class rule, help bot probe for OpenAI and Groq, no app-side probe for Anthropic and Kimi, no functional model-name probe. SA changes folded into §DO-6d. |
| 2026-11-02 | DO-6d build | `third-party-ops/llm-providers.md` new (142 lines); SKILL.md index row + triggers. Awaiting SA code review and QA. |
| 2026-11-02 | DO-6d SA code review + QA | SA approved for QA with two fixes (help bot probe precondition excludes agent-search questions; old LM-8 wording scrubbed). QA PASS, 20 checks (19 pass, 1 deferred), 3 Lows: Low 1 (stale status text) fixed by the main session; Low 2 (LF endings, normalised by git) and Low 3 (`InputHelp` mode not reachable from the floating button) left on purpose. |

---

## QA Report — DO-1

**QA — 2026-10-30.** Mode: full, config/docs only. Strategy: static checks (grep, frontmatter parse, path checks, reading the diff). Run in the DO-1 worktree on the uncommitted changes. QA edited nothing except this section.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Public-repo grep (finding 11 regex) | ✅ Pass | Over the added lines of `git diff -U0` and the two new files: 0 hits. Over this requirement: 1 hit, line 360, which is the regex quoting itself (expected). Extra greps: no 7+ digit numeric IDs (so no ClickUp or org IDs), no `cec9` connector ID, no 16+ char lowercase or hex runs that look like a project ref. The word `vault` appears only in the rule "never select from `vault`" (agent § Supabase (d) and Must-NOT; skill §4 (d)). It names the Supabase schema as forbidden, not where a secret is stored. Reading the diff found no secret location and no open weakness. |
| 2 | Files touched | ✅ Pass | `git status --short`: M on CLAUDE.md, release-manager.md, system-architect.md, team-leader.md; untracked: devops.md, `env-change-protocol/` (holds only SKILL.md), and this requirement. `git diff --stat`: 4 files, +24/−2. Nothing outside the allowed list from finding 10. |
| 3 | Frontmatter | ✅ Pass | Parsed with js-yaml from a scratch script outside the repo. devops.md keys are `name`, `description`, `tools`, and `name=devops` matches the file. SKILL.md keys are `name` and `description`, and `name=env-change-protocol` matches the folder. `tools` has 34 entries: 6 built-in tools, 12 Supabase plugin, 16 Vercel plugin. None is `*`. No excluded tool: no `apply_migration`, no create_/update_/delete_/edit_, no promote, rollback or assign_alias, no `get_project_env`, `get_shared_env_var` or `get_deployment_file_contents`, no ClickUp, no `mcp__cec9…`. |
| 4 | Tool-name resolution / load smoke test | ⚠️ Deferred | The main session resolved all 28 MCP names against the live tool list. The load smoke test from finding 11 is **deferred to the user / a fresh session**, because agent files load at session start. It has not failed. |
| 5 | CLAUDE.md rule (no counts, statuses, PR numbers, dates) | ✅ Pass | Two rows were added: `\| DevOps \| DO \| User or TL \|` and one Common Gotchas row pointing at the skill. Neither has a number, status, PR or date. The Ship drill and the Standard flow are unchanged. |
| 6 | Links and paths | ✅ Pass | Every referenced path exists in the worktree: `.claude/skills/env-change-protocol/SKILL.md`, `.claude/settings*.json` (matches settings.json and settings.local.json), `.github/`, `.github/workflows/`, `supabase/migrations/`, `vercel.json`, `docs/SUPABASE_CLIENTS.md`, `docs/VERCEL_ENV_SETUP.md` (both tracked), `docs/runbooks/`, `docs/workplans/`. Every in-page ToC anchor matches a heading. |
| 7 | Failure path, forbidden in the agent body | ✅ Pass | devops.md: DDL is forbidden at line 10, the (a) rule at 73, the database clients row at 102 and the Must-NOT at 129. Printing or decrypting secrets: lines 11, 80 (never pass `decrypt`), 100 and 132. `vercel env pull` "outright": line 101. `gh auth token`: line 97. `gh api` with field flags: lines 86 and 96. Reversible change only with the approval quoted verbatim in the brief: lines 59 and 131. |

**Edge case (nice to fix, not blocking):** the reversible-tier example in devops.md line 56 is "a ClickUp task status". ClickUp tools are deferred (R3), so the example names a capability DO does not have. A Preview-only env var on its own is enough.

**Final status:** [x] All checkable criteria pass. The only item left is the fresh-session tool-list smoke test (item 4), which is owed by the user / a fresh session. No bugs found.

---

## SA Review — DO-2

**Reviewed by SA — 2026-10-30**
**Verdict: APPROVED WITH CHANGES.** The scope, the boundaries (§D2.3) and the decision to leave CLAUDE.md alone are right. The paste-and-check flow is the correct one, and the spec mostly points to `env-change-protocol` rather than repeating it. Dev builds DO-2 with rulings Q-D2-1 to Q-D2-4 and findings S1–S10 applied. No second SA spec pass; SA checks them at code review.

### Rulings on the open questions

**Q-D2-1: the wrapper is `begin read only; <select>; commit;`. Never a session-level `SET`.**
- Evidence (main session, 2026-10-30, `execute_sql` against the production project, catalog-only):
  - `begin read only; select current_setting('transaction_read_only') …; commit;` returned the select's rows with `ro = on`. The tool does not swallow the rows behind the `commit`, so the BA's stated risk is ruled out.
  - `set default_transaction_read_only = on; select …;` returned `ro = off`. A `default_*` setting governs the **next** transaction, not the one already running for the rest of the same batch, so this form is no guard here.
  - `begin read only; create temp table …; commit;` failed with `25006`. The guard blocks writes.
- R1(b) is confirmed as written. `devops.md` and `env-change-protocol` §4(b) already prescribe this form, so neither file changes.
- §D2.4's last AC is met by this evidence. Dev cites it in the implementation notes by role and does not need to probe again. A probe again would only be needed if the plugin server changes.
- Two rules the skill adds:
  - **No session-level `SET` through `execute_sql`, ever.** A plain `SET` inside a committed transaction outlives it. If the tool reuses connections, a stray `default_transaction_read_only = on` can make a later, unrelated statement read-only. One example would be the user's own migration paste failing with `25006`. See S1.
  - **Running a repo checker through the tool:** drop the checker's first line (`SET default_transaction_read_only = on;`) and run the body inside the `begin read only; … commit;` wrapper. The body is one `WITH … SELECT`, so the rows come back as one result set. The skill also states that a checker with N gate rows must return exactly N + info rows. Fewer rows than that is a failed check, not a pass.
- **Do the existing checkers need a note? Not in DO-2.** The `SET` first line is pinned by migration text tests (e.g. `supabase/migrations/__tests__/ai-model-pricing-slice2.migration.test.ts` expects the checker to start with it), so changing the convention is a Dev change to tests and checkers. It also matters less now: under Q-D2-4 the checker is run by DO or the main session through the wrapper, not pasted. Whether the SQL editor runs a pasted batch as one implicit transaction (and so ignores the `SET` the same way) is **not measured**. The skill must not claim either way. Logged as **FU-2**: new checkers start with `begin read only;` and end with `commit;`, and the text tests accept that form. Old checkers are not edited.

**Q-D2-2: the ledger is never proof of "applied" or "not applied". Accepted, with a tighter statement.**
- An entry in `list_migrations` proves that a CLI/MCP apply once ran. It does not prove the objects still exist, because a later rollback paste leaves the entry behind. A missing entry proves nothing.
- "Applied" is decided only by catalog evidence (the checker, or the §D2.2(a) catalog functions).
- DO never backfills the ledger. DO also has no `apply_migration` tool, so DO never adds an entry.
- The skill states one consequence plainly, because it is why `supabase/held/` exists: with a ledger that misses SQL-editor applies, a bulk `supabase db push` would try to apply migrations that are already live. `supabase db push` stays forbidden (`devops.md` database-clients row). The skill points to that row and does not repeat it.

**Q-D2-3: the README sections are a follow-up, out of DO-2's file list. Accepted, and they are a priority.**
- `supabase/migrations/README.md`, `supabase/migrations/APPLY_MIGRATIONS.md` and `supabase/SQL Scripts/README.md` all tell the reader to run `supabase db push` and `psql`. In this repo that is a live hazard (see Q-D2-2), not only stale prose.
- Logged as **FU-1**, a small docs-only slice right after DO-2 merges: replace those sections with a pointer to `supabase-ops`. The connection-string templates in `APPLY_MIGRATIONS.md` contain placeholders only (no real value), so the public-repo rule is not breached today.
- DO-2 stays tight: the skill does not link to those files as guidance.

**Q-D2-4: accepted.** The skill states the new rule: DO or the main session runs the pre-check and the checker, and the user pastes only the migration (and the rollback if needed). Old workplans and the headers of old checkers (e.g. "paste the output back to TL") are history and are not edited. No agent file currently says the operator runs the checker, so no agent edit is needed.

### Findings

S1. **[Q-D2-1] Check that today's `SET` probe did not persist.** The main session's evidence ran a plain session-level `set default_transaction_read_only = on`.
- Before the next migration apply, the main session runs `begin read only; select current_setting('default_transaction_read_only'); commit;` in a fresh call. If it says `on`, the setting persisted on a reused connection: report it and run `reset default_transaction_read_only` once with the user's approval.
- The skill carries the "no session-level SET" rule from the ruling above.
— Priority: High

S2. **[§D2.2(b) "When"] Use a timing test instead of the additive/destructive labels.** The labels are not enough. "Additive" changes like a new trigger, a default, a NOT NULL with a backfill, a narrower RLS policy or a new grant that widens access can still break the code that is currently deployed or change what it does. The skill states the test, in this order:
- (1) The currently deployed code keeps working against the new schema → apply **before merge**, and only after SA's code review and the user's diff approval. Applying before approval leaves schema orphaned if the PR is abandoned.
- (2) The new code works against the old schema, and the old code breaks against the new schema → apply **after the deploy** that stops using the old shape is Ready.
- (3) Neither is true → the migration must be split into expand and contract parts. This goes back to Dev/SA and is not DO's call.
- The migration header's stated timing is copied into the plan. If the header disagrees with this test, SA decides; the header does not win by default.
— Priority: High

S3. **[§D2.2(b) step 2/5] A checker must be shown to fail.** Before handing over the migration, DO or the main session runs the checker once against the **pre-apply** state. The rows for new objects must say `FAIL`. A checker that is all `ok` before the apply cannot detect the apply, and is sent back to Dev. This is the cheapest "probe that can fail" proof, and it costs one read-only call. Add it to the step table, as step 2b.
— Priority: High

S4. **[§D2.2(b) checker bullets] A grant check and an RLS check are different checks.** `has_table_privilege('anon', …)` is false only if the migration **revokes the grant**. When the control is an RLS policy, the role still holds the privilege and the example passes or fails for the wrong reason. The skill says:
- Check the control the migration actually uses. For grants, use `has_*_privilege`. For RLS, use `relrowsecurity`/`relforcerowsecurity` plus the exact `pg_policies` row (command, roles, and the `qual`/`with_check` text).
- Name the limit: a behavioural RLS test needs `SET ROLE`, which rule (a) forbids. Catalog checks are therefore the strongest evidence DO can produce. A behavioural test is a Dev Jest/integration concern.
— Priority: Medium

S5. **[§D2.2(b) step 5] A rollback on `FAIL` is not automatic for destructive migrations.** Pasting the rollback in the same sitting is right for additive and DDL-only changes. A migration that drops or rewrites data may have a rollback that restores the shape but not the rows. For those, the plan states "No known undo for data" (per the protocol template), and on `FAIL` the step is: **stop, apply nothing more, escalate to SA and the user**. A blind rollback is not the step. Also: a `FAIL` row can come from a faulty checker. Before calling for a rollback, re-read the failing row's catalog fact once.
— Priority: Medium

S6. **[§D2.2(a) Repo layout] The file-name statement is wrong as written.**
- `supabase/migrations/` also holds legacy files named by calendar date (`YYYY-MM-DD_<slug>.sql`) and non-SQL docs.
- The shared numbers and the letter suffixes are **legacy only**. `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts` refuses, from its first guarded version on, a duplicate number, a letter suffix, a timestamp form, and a `held/` file that shares a version with `migrations/`.
- The skill says: new files are exactly eight digits, unique, enforced by that guard; older shapes exist and are not a pattern to copy. It names the guard file and states no version number or count.
— Priority: Medium

S7. **[§D2.2(d)] Do not restate the zero-policy probe.** It is protocol step 5's own example, so the bullet copies `env-change-protocol`, which the spec says it will not do. The skill keeps only what is specific to Supabase:
- the two key families and which one bypasses RLS;
- the env-var-name grep on a family switch;
- the `search_docs` check for rotation scope;
- one line: "verify per `env-change-protocol` step 5".
— Priority: Low

S8. **[§D2.2(a) Advisors] Say where the advisor comparison lives.** "Before and after" needs the before-list kept somewhere, but the open findings may not go into tracked text. The rule:
- The full before/after lists go only to the untracked private docs.
- The tracked change record's Evidence field says only "no new advisor finding on objects this migration touched" or "new finding: stopped, see private record". It never gives a lint name, an object name or a count of open findings.
- A new finding on a touched object stops the step. Whether to roll back or accept it is SA's ruling, not DO's.
— Priority: Medium

S9. **[§D2.2(c)] Name the enforcement honestly.** The migration text tests are per migration (one test file per migration), not a global lint. "Enforced for Dev by the migration text tests" is true only where the migration has one. Say "checked by the migration's text test when it has one; otherwise the person preparing the paste checks the file against this list". The `.gitattributes` LF rule is also per file: the skill says a new migration, rollback, pre-check and checker each need their own `text eol=lf` line.
— Priority: Low

S10. **[§D2.4 ACs] Tighten two criteria so they can fail.**
- (a) Replace the Q-D2-1 AC with: "The skill prescribes `begin read only; …; commit;`, forbids session-level `SET` through `execute_sql`, and states the drop-the-first-line rule for repo checkers. The implementation notes cite the 2026-10-30 measurement by role."
- (b) Add: "SKILL.md contains no restatement of the eight steps, the tier table, the change-record template or the zero-policy probe. QA greps for `Snapshot the before-state`, `| **Read** |` and `zero policies` in the new files; expected 0 hits."
— Priority: Low

### Checked and honoured

- **No duplication of the neighbours.** (f) points to `business-os-schema-check`. The plugin skills own generic RLS and migration authoring. `env-change-protocol` keeps the steps, the tiers, the record and the order table. S7 removes the one copied item.
- **File list is tight.** It covers the skill folder, one line in `devops.md`, and this requirement. CLAUDE.md is not touched (correct: the existing protocol row already routes the work). FU-1 and FU-2 stay out of DO-2.
- **Public-repo rule.** The spec contains no project ref, ID, plan-per-project, key prefix, secret location or open advisor finding. The lifecycle facts in (e) are generic and checked with `search_docs` at use time. "The ledger misses SQL-editor applies" describes a process and is already stated in a tracked script header; it is not a security weakness. The finding-11 regex and the read-through in §D2.4 cover the build.
- **Paths named exist:** `supabase/held/`, `supabase/seeds/`, `supabase/SQL Scripts/`, `supabase/functions/`, `supabase/config.toml`, `supabase/migrations/__tests__/`, `scripts/check-migrations-applied.ts` (its header does say no ledger is reachable), `scripts/precheck-*.sql`, `scripts/check-*-migration.sql`, and the PostgREST 42703 line in `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`.
- **No CI time and no app code.** Config and docs only.

### Follow-ups (not DO-2)

| # | What | Owner |
|---|---|---|
| FU-1 | Replace the `db push` / `psql` sections of the three apply READMEs with a pointer to `supabase-ops` (Q-D2-3) | BA scope → Dev, docs-only, right after DO-2. ✅ MERGED 2026-10-30 (PR #584) |
| FU-2 | New checkers use the `begin read only; … commit;` wrapper; the migration text tests accept it; old checkers untouched (Q-D2-1) | Dev, next migration that ships a checker |
| FU-3 | A read-only-mode Supabase connection for DO, which would turn rule (a) into real enforcement (from R1) | DO-5 |

### SA review — FU-1

**2026-10-30 — APPROVED.** The three READMEs agree with `supabase-ops` §3 (`supabase/held/`) and §4 (pre-check, user pastes one file, checker); the warning matches §2 (ledger misses SQL-editor applies) and the forbidden clients. Links resolve from repo root. "Verifying the Migration" and "What This Migration Does" in `APPLY_MIGRATIONS.md` kept. No migration-dir or held test reads these files. No secrets or project refs. Optional later: §3's "older apply READMEs" sentence in the skill can be trimmed now the READMEs comply.

### Approval

[x] DO-2 spec approved. Dev builds with Q-D2-1 to Q-D2-4 and S1–S10 applied. S1 is a main-session check, owed before the next migration apply, and does not block the build.

---

## DO-2 implementation notes

**By Dev — 2026-10-30.** Config/docs-only slice, no separate workplan. Nothing committed.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/supabase-ops/SKILL.md` | New | The skill: pointer table to the neighbours, §1 `execute_sql` wrapper, §2 reading state, §3 repo layout, §4 apply flow + rollback rule + timing test, §5 keys, §6 lifecycle, §7 PostgREST, §8 checklist |
| `.claude/skills/supabase-ops/checker-pattern.md` | New | What a good checker proves; grant vs RLS checks and the `SET ROLE` limit |
| `.claude/skills/supabase-ops/paste-safety.md` | New | Paste-safe SQL checklist ("into", ASCII, per-file LF, no meta-commands, one transaction, guards, post-conditions) and honest enforcement |
| `.claude/agents/devops.md` | Edited | One pointer line under `### Supabase (plugin server only)` |

### Wrapper evidence (Q-D2-1, S1)

Cited from the main session's measurement on 2026-10-30 against the production Supabase project, through the plugin server's `execute_sql`, catalog-only; not re-probed by Dev. `begin read only; select …; commit;` returned the select's rows with `transaction_read_only = on`; a `create` inside it failed with `25006`; a `set default_transaction_read_only = on;` in the same call left `transaction_read_only = off`. Each call ran on a different backend, so the earlier `SET` did not persist to later calls — this answers S1's concern. The skill still forbids any session-level `SET` and does not rely on the fresh-backend behaviour.

### Acceptance criteria (§D2.4 as amended by S10)

| Criterion | How it is met |
|---|---|
| Frontmatter | `name: supabase-ops` (matches folder) + `description`, same single-line format as `tenant-isolation-guard`; parsed with js-yaml: keys `name`, `description` |
| Description triggers | Apply/check a migration, pre-check/checker, advisors, logs, drift, auth/project settings, key verify/rotate, create/pause/restore; "used by the main session and by the DevOps (DO) agent"; no project, URL or ID |
| Covers (a)–(f) and §D2.3 | (a) §2–§3; (b) §4 + `checker-pattern.md`; (c) `paste-safety.md`; (d) §5; (e) §6; (f) §7; boundaries in the opening pointer table |
| No restatement (S10b) | Grep of the new files for `Snapshot the before-state`, `\| **Read** \|`, `zero policies`: 0 hits. Keys verified "per `env-change-protocol` step 5" (S7) |
| Size | SKILL.md 121 lines; reference files 30 and 15, linked from SKILL.md |
| `devops.md` | One added line, nothing else |
| Wrapper (S10a) | §1 prescribes `begin read only; …; commit;`, forbids session-level `SET`, states the drop-the-first-line rule and the row-count rule; evidence above |
| S2–S6, S8, S9 | S2 timing test in §4; S3 step 2b; S4 `checker-pattern.md`; S5 rollback rule + step 6 re-read; S6 §3 names `migrationNumberUnique.guard.test.ts`, legacy shapes; S8 §2 advisor-results row; S9 `paste-safety.md` rule 3 and the enforcement paragraph |
| Q-D2-2/3/4 | Ledger row in §2 (never evidence, no backfill, `db push` consequence); §3 says not to follow the older apply READMEs (not linked as guidance; FU-1 fixes them); §4 states DO or the main session runs pre-check and checker |
| Paths exist, no counts | Every named path checked in the worktree; no file counts or version numbers stated |
| Finding-11 regex | Over the added diff lines and the three new files: 0 hits |
| Public-repo read | No ref, ID, plan-per-project, key prefix, secret location or open advisor finding; generic platform facts only |
| Files touched | `.claude/skills/supabase-ops/**`, `.claude/agents/devops.md`, this requirement. CLAUDE.md unchanged |

---

## QA Report — DO-2

**QA — 2026-10-30**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path existence, read-through). This is a docs/config-only slice, so there is no runtime to exercise. · **Focus:** security (public-repo), schema (frontmatter) · **Skipped:** none · **Input source:** TL prompt + §D2.4 as amended by S10.

### Test Coverage

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Frontmatter parses; `name` matches folder | Pass | js-yaml load of the SKILL.md frontmatter: keys `name`, `description`. `name = supabase-ops`, description 753 chars |
| Description triggers + "main session and DO" + no project/URL/ID | Pass | The description contains: apply the migration, pre-check, checker, advisors, logs, drift, auth / project setting, key verify/rotate, create/pause/restore, main session, DevOps (DO). The regex finds no ID |
| Covers (a)–(f) + §D2.3; no restatement (S10b) | Pass | Read-through: (a) §2–3, (b) §4 + checker-pattern.md, (c) paste-safety.md, (d) §5, (e) §6, (f) §7, boundaries in the pointer table. Grep for `Snapshot the before-state` / `\| **Read** \|` / `zero policies` in the 3 new files: 0/0/0 |
| Wrapper (S10a) | Pass | §1 prescribes `begin read only; <select>; commit;` as "the only form", forbids session-level `SET`, gives the drop-the-first-line and row-count rules. Implementation notes cite the 2026-10-30 measurement by role |
| Failure-path content | Pass | DDL is forbidden: §1 "only form", the §8 checklist "no `SET`, no DDL", and §4 step 3 (the user pastes). Ledger: "never evidence either way". Step 2b: the checker must read `FAIL` on the pre-apply state. Rollback rule: a data-destroying migration means "stop, apply nothing more, escalate to SA and the user — never a blind rollback". Pasteable SQL snippets contain no "into". Every hit for the whole word is in prose (SKILL.md 90/92, paste-safety rule 1, where `SELECT … INTO` is the counter-example) |
| Size ≤ ~200 lines | Pass | SKILL.md 121; checker-pattern.md 30, paste-safety.md 15, both linked from SKILL.md |
| `devops.md` one pointer line only | Pass | `git diff`: +2 lines (the D2-3 sentence and a blank line), no other change |
| Finding-11 regex | Pass | Over the added diff lines (`^+`, excluding `+++`) and the 3 new files: 0 hits |
| No ref/ID/org/plan-per-project/key prefix/secret location/open finding | Pass | Extra greps: 20-char `[a-z0-9]` tokens 0; 6+-digit numbers 0; common advisor lint names 0. The only plan/tier hits are the generic "the free tier has no PITR and pauses idle projects" (§6 and §D2.2(e)), a platform fact rather than which project is on which plan. Read-through of the requirement diff: no advisor counts or object names |
| Every named path / link exists; no counts | Pass | All exist: env-change-protocol, business-os-schema-check, the devops.md agent file, both reference files, `scripts/check-migrations-applied.ts` (line 4 says no ledger is reachable), `supabase/{migrations,migrations/__tests__,held,seeds,functions,config.toml,SQL Scripts}`, `migrationNumberUnique.guard.test.ts`, the `scripts/precheck-*.sql` and `scripts/check-*-migration.sql` globs, and the entitlements doc 42703 line (365). The `supabase:*` items are plugin skills, not repo paths. No file counts stated |
| Files touched | Pass | `git status`: only `.claude/agents/devops.md`, this requirement, and `.claude/skills/supabase-ops/` (3 files). `git diff HEAD -- CLAUDE.md` is empty |

### Issues Found

- **Bugs:** none.
- **Edge case (nice to fix, non-blocking):** the DDL ban in SKILL.md is implicit. It is carried by "the only form" plus the §8 checklist item, and is not stated as a sentence in §1. The rule is explicit in `devops.md` ("DDL goes through the user"), and §1's wrapper would block DDL anyway (`25006`).

### Final Status

- [x] All acceptance criteria pass. Ready for the user's diff review.
- [ ] Issues found

---

## SA Code Review — DO-2

**Code Review by SA — 2026-10-30**
**Status: ✅ Code Approved (with SA wording fixes applied).** Approved for QA.

### Checked and honoured

- **S1 / Q-D2-1:** §1 prescribes `begin read only; …; commit;` only, forbids session-level `SET`, states the drop-the-`SET`-line and row-count rules.
- **Q-D2-2:** ledger never evidence either way, no backfill, `db push` consequence pointed to `devops.md`, not restated.
- **S2:** timing test in order, before-merge applies only after SA code review and the user's diff approval; split otherwise; header does not win by default.
- **S3:** step 2b (checker shown to `FAIL` pre-apply). **S4:** grant vs RLS table plus the `SET ROLE` limit. **S5:** no blind rollback for data-destroying migrations; failing row re-read first.
- **S6:** new-file naming per `migrationNumberUnique.guard.test.ts`, legacy shapes named as legacy, no counts. **S7/S10b:** no restated steps, tiers, template or probe (greps 0 hits). **S8:** advisor lists private only, tracked Evidence wording fixed. **S9:** per-file `text eol=lf`, enforcement stated honestly.
- No duplication of `env-change-protocol`, `business-os-schema-check` or the plugin skills; public-repo rule held (by role, no IDs); usable from the main session (nothing depends on the DO agent being loaded).

### Code Review Comments

1. `paste-safety.md` rule 1 — banned "into" in statements too. Technically wrong: `INSERT INTO` has no alternative and applied migrations contain it; the measured failure is in literals and comments. SA reworded: literals/comments banned, keyword allowed, the migration's text test wins if it bans the word file-wide. — Priority: High — SA: resolved
2. `SKILL.md` §1 — stated "each call was measured to run on a fresh backend". The 2026-10-30 evidence does not show that (no backend-id comparison). SA reworded to "depends on pooling; do not rely on it". The same claim in the implementation notes ("this answers S1's concern") does not stand: **S1's main-session check is still owed** before the next migration apply. — Priority: Medium — SA: skill resolved; S1 open
   - **S1 closed (main session, 2026-10-30, after the SA spec review):** three consecutive read-only `execute_sql` calls each reported `default_transaction_read_only = off`, on three different backend pids. The earlier `SET` did not persist. The skill's "do not rely on it" wording stands — three calls are not a guarantee about pooling.
3. `SKILL.md` §1 — drop-the-`SET` rule named checkers only; repo pre-checks carry the same first line. SA extended it to pre-checks. — Priority: Low — SA: resolved
4. `SKILL.md` §4 step 4 — nothing said what to do when the paste errors. SA added: the single transaction applied nothing, confirm with the checker, do not paste the rollback. — Priority: Medium — SA: resolved
5. `paste-safety.md` rule 5 — one `BEGIN; … COMMIT;` cannot hold `CREATE INDEX CONCURRENTLY` / `VACUUM`. SA added the separate-file exception. — Priority: Low — SA: resolved
6. `checker-pattern.md` — a `::regclass` cast raises on the pre-apply state, which defeats step 2b. SA added a "no raising lookups" row. — Priority: Low — SA: resolved

### Optimisation Suggestions

- FU-1 (README `db push` sections) remains the priority follow-up; §3's "do not follow the older apply READMEs" is the stopgap.

### Code Approved for QA: Yes

---

## SA Review — DO-3

**Reviewed by SA — 2026-10-31**
**Verdict: APPROVED WITH CHANGES.** The scope, the file list, leaving CLAUDE.md alone, and the "points back, never restates" shape match `supabase-ops`. The core procedure in §D3.2(b) is the right one, and the facts are right: an env var change reaches only deployments built after the save, `NEXT_PUBLIC_*` is inlined at build, crons run on production only, `ignoreCommand` exit 0 means skip, and merge-queue branches are not deployed. The gaps are in **how** DO can probe, in two read tools whose responses can carry values, and in what "READY" proves for a production domain. Dev builds DO-3 with rulings Q-D3-1 to Q-D3-4 and findings V1–V14 applied. No second SA spec pass; SA checks them at code review.

SA fixed five spec statements in place (marked in the findings) and removed one detail from §D3.2(a) under Q-D3-4.

### Rulings on the open questions

**Q-D3-1: no Vercel write tool in DO-3. BA's suggestion accepted.**
- `create_project_env` / `edit_project_env` take `target` (and `gitBranch`, and a custom environment) as arguments. The frontmatter tool list allows a tool or does not; it cannot match an argument. "Preview only" would rest on prose alone, which is exactly the gap R5 named.
- A Preview var with no `gitBranch` reaches **every** preview deployment, including other people's PRs. "Preview" is therefore not automatically low blast radius.
- `devops.md` gets only the D3-3 pointer line. Its "read-only today" sentence stays true, so nothing else changes.
- Logged as **FU-4** for DO-5, next to FU-3: revisit only if an enforcement appears that does not rest on prose (a token scoped to Preview, or a harness permission rule that can match a tool argument).

**Q-D3-2: Dev does NOT probe the live response shape. Decide from documentation; treat the response as value-bearing either way.**
- Schema read (the tool definition only, no call): `filter_project_envs` takes `idOrName`, `gitBranch` ("must have target=preview"), `decrypt` (deprecated, "the environment variable value will be decrypted"), `source`, `customEnvironmentId`, `customEnvironmentSlug`, and team scope. The parameters say nothing about what the response holds when `decrypt` is not passed.
- A "field names only" check is not possible after the fact. Any call returns its full response into the session context and the local session transcript, so whatever value it holds has already been exposed. The BA's suggested build-time call is ruled out.
- **What Dev does at build:** read the documented response schema of the platform's "list environment variables of a project" endpoint and of "get a project" through `search_vercel_documentation`, which returns documentation only. Record by field name in the implementation notes whether the response can carry a `value` field and for which variable types (plain, encrypted, sensitive), and whether the project object carries an env list or protection-bypass entries. No env or project tool is called for this.
- **What the skill says, whatever the docs show (see V2):** `filter_project_envs` and `get_project` are **value-bearing responses**. Report only named fields (key, target, Git-branch scope, type, last-updated time). Never quote raw output, never summarise a value, never pass `decrypt` or `source`.

**Q-D3-3: yes, Read tier. DO may confirm a cron ran on its own.**
- Counts by path and status from `get_runtime_logs` / `get_runtime_errors` in a window after the schedule time, scoped to the current production deployment. No log line copied (rule (c)).
- The window must sit inside log retention. An empty window older than retention is "not checked", never "did not run".
- **Running** a cron is not Read tier. That means the dashboard's run button, or a request carrying the cron secret. It executes a production job and needs a secret: production tier, the user executes. DO never triggers one (V8).

**Q-D3-4: roles only. BA's suggestion accepted, and narrowed.**
- The skill says more than one project exists, gives the known roles, and says to resolve the current list with `list_projects` each time. A project with no known role is reported as unrecognised. It states no count.
- **SA removed "that holds its own Supabase configuration" from §D3.2(a).** Which credentials a given project stores is a "where a secret is stored" fact (§3.4). The generic rule replaces it: each project holds its own env vars, so a value can exist in more than one project, and a rotation or "where does this live" answer covers each.
- Which variables each project holds belongs in the untracked inventory and in DO-5's `env-drift-audit`.

### Findings

V1. **[§D3.2(b) step 5] DO cannot make the HTTP probe the step describes.**
- DO's Bash allowed list has no HTTP client ("anything not on the allowed list is forbidden"). Preview deployments, and often production deployment URLs, sit behind Deployment Protection, so an unauthenticated request gets the platform's login wall. That is a probe that can neither pass nor fail on the change.
- The skill states who probes what:
  - DO's own evidence is server-side and timestamped: `get_runtime_logs` / `get_runtime_errors` scoped to **that deployment**, for a request or job the change affects.
  - An HTTP or browser probe of a deployment URL is done by the main session or the user. They use their existing Vercel authentication (the `access-protected-vercel-deployment` plugin skill). They never use a protection-bypass secret and never turn protection off to probe.
  - A 401/403 from the protection page is "not probed". It is not a pass and not a fail.
- Deployment URLs and custom domains are never written into tracked text.
— Priority: High

V2. **[§D3.2(a) Env vars, Projects] Two of DO's read tools can return values.** This is the general form of Q-D3-2.
- `filter_project_envs` without `decrypt` may still return `value` (in clear for plain-type variables, as ciphertext otherwise).
- The project object returned by `get_project` may include an env list, and protection-bypass entries keyed by the bypass secret itself. Dev confirms both from the docs (Q-D3-2). The rule does not wait on the answer.
- The skill carries one "value-bearing responses" rule for both tools: named fields only, no raw output in any file, report or chat, and `decrypt` and `source` are never passed.
- `get_project` stays in the list, because it is the only source for the framework, root directory and Git link. The rule above is what keeps it safe.
— Priority: High

V3. **[§D3.2(b) production alias] A READY production deployment is not always the one serving the domain.**
- After an Instant Rollback the platform stops auto-assigning production domains to new production deployments until the rollback is undone or a deployment is promoted. The same is true when production domains are configured not to auto-assign (a staged production deployment).
- In both cases the new deployment is READY but receives no traffic. A probe through the domain then tests the old deployment.
- `get_project_domain` does not show which deployment serves a domain. **SA fixed the spec line:** read the step-3 deployment with `get_deployment` and check that its aliases include the production domain.
- If they do not, stop. "Promote" is a production write, so the user executes it.
- Rolling releases can also split production traffic. If one is active, the probe must name the deployment it hit, through server-side evidence.
— Priority: High

V4. **[§D3.2(c)] An ignored build is recorded as a CANCELED deployment.** That contradicted "CANCELED: never treat it as done" two bullets earlier. **SA fixed the spec:** CANCELED is the expected outcome only when the build events show the script's `SKIP:` line on a docs-only change. Any other CANCELED is a stop. The skill should also say the script **fails open**: an unresolvable base or an empty diff builds (exit 1), so a build on a docs-only push is possible and not an error. — Priority: Medium

V5. **[§D3.2(d)] "Not installed" is not a control.**
- `npx vercel …`, `npm exec vercel` and `pnpm dlx vercel` download and run the CLI on the spot. So does `vercel env pull`, by that route.
- The skill states that DO runs no `vercel` invocation by any route. That is already true under "anything not on the allowed list is forbidden"; the skill says it in so many words.
- The Vercel MCP server's own instruction to "use CLI fallbacks" when MCP fails, and the fallback lines inside the tool descriptions, are **not followed** by DO. An MCP failure is reported, not worked around.
— Priority: Medium

V6. **[§D3.2(a) Env vars, (e) Env var values] What the user reports from the dashboard.**
- The user never pastes a value into chat. They report presence, target, Git-branch scope, type and last-updated time, or "matches what I expected: yes/no".
- A **sensitive**-type variable cannot be read back even in the dashboard. Its correctness is proven only by a probe through the deployed surface (protocol step 5), never by reading it.
— Priority: Medium

V7. **[§D3.2(b) steps 2–3] Who triggers the deploy, and which deployment is "the one".**
- DO never triggers a deployment. A push reaches the branch through Dev/RM. A Redeploy is the user's on production, and the main session's with the user on Preview.
- Step 2 should name that owner in the plan.
- "First deployment created after the save" can be superseded by a later one. The probe target is the deployment that was created after the save **and** currently serves the target (for production, the one holding the domain, V3). It is "the first" only when nothing newer exists.
- A deployment created before the save is never evidence, even if it finished building after the save.
— Priority: Medium

V8. **[§D3.2(a) Crons] Three cron rules to add.**
- (1) Never trigger a cron (Q-D3-3).
- (2) The active cron set is the **current production deployment's**. After a rollback, the older deployment's `vercel.json` crons are the ones running.
- (3) DO-1's implementation notes say crons are read "from `vercel.json` and from `get_project`", while §D3.2(a) says enabled/disabled is dashboard-only. Dev checks the documented project object (Q-D3-2 docs read) for a crons field. If one exists, the skill reads the enabled state from it under V2's named-fields rule. If not, it stays a dashboard step. The skill states the one answer it found, not both.
— Priority: Medium

V9. **[§D3.2(b)] The grounding for "`NEXT_PUBLIC_*` is inlined" was wrong.** `lib/utils/featureFlags.ts` has no comment saying so. The statement is in `docs/feature_flags.md`. **SA fixed the spec.** — Priority: Low

V10. **[§D3.3 Dev row] `vercel.json` has no `functions` key.** Its keys are crons, `ignoreCommand`, `git.deploymentEnabled` and rewrites. **SA fixed the spec.** Because the file sets no region or duration, those are dashboard facts, which is consistent with §D3.2(e). — Priority: Low

V11. **[§D3.2(c)] "An env-var change merged alongside a docs-only PR."** An env var is saved in the dashboard; it is never merged. **SA reworded the spec** to "an env var saved while the only change merging is docs-only". — Priority: Low

V12. **[§D3.2(a) Env vars] Custom environments.** The tool takes `customEnvironmentId`/`customEnvironmentSlug`, so a project can have targets beyond the three named. The skill says "every target, including any custom environment `get_project` shows", and does not assume three. — Priority: Low

V13. **[§D3.2(a), (c)] Parameter and state names are not verified.**
- The `list_deployments` filters (`target`, `state`, `sha`, `branch`, `since`, and the unit `since` takes), the `group_by` values on `get_runtime_logs`, and the deployment state names have not been checked against the live server.
- Dev checks them by loading each tool's schema at build (no call) and drops any name that does not exist.
- The skill keys on READY versus everything else, and does not list states that may not exist.
— Priority: Low

V14. **[§D3.4] Add criteria so V1–V8 can fail.**
- (a) The skill states the value-bearing-responses rule for both tools, naming `decrypt` and `source` as never passed (V2).
- (b) It states DO's probe is runtime evidence scoped to the deployment, that HTTP/browser probes belong to the main session or the user, and that no bypass secret is used (V1).
- (c) It states the production-domain check and the rollback case (V3).
- (d) The implementation notes record the Q-D3-2 documentation result by field name, and state that no env or project tool was called for it.
- (e) A QA read for domain names and deployment hostnames. The regex catches only the platform's default hostname, not a custom domain.
— Priority: Medium

### Checked and honoured

- **Facts against the platform and the repo:** env changes need a new build; `NEXT_PUBLIC_*` is fixed at build (`docs/feature_flags.md`); crons are production-only; `ignoreCommand` runs `.github/ci/non-deploying-change.sh` and exit 0 = SKIP, exit 1 = BUILD, fail-open; the skip list (`docs/**`, root `*.md`, `scripts/**` minus the gate scripts and Jest suites, `.claude/**`), nested `.md` built, `--no-renames`; `git.deploymentEnabled` disables `gh-readonly-queue/**`. All are correct as stated, apart from the V3/V4 nuances.
- **No write, no secret:** §D3.2(f) keeps every Vercel write with the user or the main session; `decrypt` stays banned; `vercel env pull` is forbidden by pointer. V2, V5 and V6 close the remaining paths by which a value could reach DO or a chat.
- **No duplication:** the steps, tiers, template and probe point to `env-change-protocol`; the tool list, `decrypt` ban and Bash families point to `devops.md`; the region note points to `supabase-ops` §6 (line checked). The §D3.4 grep for restated protocol text is kept.
- **Public-repo:** the finding-11 regex over §D3 returns zero hits. There are no IDs, slugs, URLs, key prefixes or open weaknesses. The one secret-location hint (the marketing project's Supabase config) was removed under Q-D3-4.
- **Paths named exist:** `vercel.json`, `.github/ci/non-deploying-change.sh`, `docs/feature_flags.md`, `lib/utils/featureFlags.ts`, `.claude/skills/supabase-ops/SKILL.md` §6, `.claude/agents/devops.md` `### Vercel`. The plugin skills `vercel:env-vars`, `vercel:deployments-cicd` and `vercel:vercel-cli` exist in the installed plugin. The Vercel CLI is confirmed absent from PATH and from `node_modules/.bin`.
- **Config/docs only:** no app code, no CI job, no CI time.

### Follow-ups (not DO-3)

| # | What | Owner |
|---|---|---|
| FU-4 | A Preview-only Vercel env write for DO, only with enforcement that does not rest on prose (a scoped token, or a harness rule that matches tool arguments) (Q-D3-1) | DO-5 |

### Approval

[x] DO-3 spec approved. Dev builds with Q-D3-1 to Q-D3-4 and V1–V14 applied. `devops.md` changes by the D3-3 pointer line only.

---

## DO-3 implementation notes

**By Dev — 2026-10-31.** Config/docs-only slice, no separate workplan. Nothing committed.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/vercel-ops/SKILL.md` | New | The skill: pointer table, §1 scope and projects by role, §2 value-bearing responses, §3 reading state, §4 which deployment holds a value (steps + who probes what), §5 waiting for a deploy and docs-only skips, §6 crons, §7 the CLI, §8 checklist |
| `.claude/skills/vercel-ops/dashboard-settings.md` | New | The dashboard-only settings table (§D3.2(e)), with the region pointer to `supabase-ops` §6 |
| `.claude/skills/vercel-ops/tool-parameters.md` | New | Parameter names checked against the loaded tool schemas (V13) |
| `.claude/agents/devops.md` | Edited | One pointer line under `### Vercel`, nothing else |

### Q-D3-2 documentation result (V2, V14 d)

Read through `search_vercel_documentation` only. **No env or project tool was called** — not `filter_project_envs`, not `get_project`, not any other account tool. Tool schemas were loaded (no call) for V13.

- **List env vars of a project** (the endpoint behind `filter_project_envs`): the documented 200 schema lists `value` as a **required** field on every item, next to `key`, `type`, `target`, `gitBranch`, `customEnvironmentIds`, `decrypted` (boolean), `updatedAt`, `updatedBy`, `comment`, `securityIssues`, `contentHint`. `type` is one of `encrypted`, `plain`, `secret`, `sensitive`, `system`. The docs do **not** say, per type, whether `value` is clear text or ciphertext when `decrypt` is not passed; the `decrypted` flag is the only per-item signal. So a `value` can come back for every type.
- **The project object** (as documented for the list and create responses; the "find a project" page in the index shows no field list): carries an `env` array whose items hold `value`, `legacyValue`, `vsmValue` and `internalContentHint` (described as holding the value encrypted), plus `decrypted`. A `protectionBypass` object keyed by `additionalProperties` is documented on the protection-bypass endpoint; its presence on the project object was not shown by the index excerpts, and the skill treats it as present.
- **Crons on the project object (V8 3):** a `crons` field with `enabledAt`, `disabledAt`, `deploymentId`, `updatedAt` and `definitions` (`path`, `schedule`). The skill states this one answer: the enabled state is read from `get_project` by those named fields; run history stays a dashboard step.
- **Result for the skill:** both tools are value-bearing, as SA ruled. §2 of the skill applies to both: named fields only, no raw output, never `decrypt` or `source`.

### V13 schema checks (loaded, not called)

| Tool | Checked | Result |
|---|---|---|
| `list_deployments` | `target`, `state`, `sha`, `branch`, `since` | All exist. `since` / `until` are JavaScript timestamps in milliseconds; `from` / `to` deprecated |
| `list_deployments` | `state` values | The schema lists them; the skill keys on READY versus everything else and names only READY and CANCELED |
| `get_deployment` | SHA source | Needs `withGitRepoInfo` |
| `get_runtime_logs` | `group_by` | `requestPath`, `level`, `source`, `deploymentId`, `branch` — the spec's "path" and "deployment" corrected to these. One value per call. `deploymentId` filter exists |
| `get_runtime_errors` | deployment scope | **No deployment filter** (project, `routes`, window, max seven days). So V1's per-deployment evidence is `get_runtime_logs` only; the skill says so |
| `filter_project_envs` | `gitBranch`, `customEnvironmentId` / `customEnvironmentSlug`, `decrypt`, `source` | All exist; `decrypt` and `source` banned in §2 |

### Acceptance criteria (§D3.4 as amended by V14)

| Criterion | How it is met |
|---|---|
| Frontmatter | `name: vercel-ops` (matches folder) + single-line `description`, same format as `supabase-ops`; parsed with js-yaml: keys `name`, `description` |
| Description triggers, no project/URL/ID | Env var check/set, which deployment has a value, wait for a deploy, failed or skipped deploy, build logs, runtime logs or errors, cron that did not run, domain, deployment protection or another project setting; "used by the main session and by the DevOps (DO) agent"; no project, team, URL or ID |
| Covers (a)–(f), §D3.3, no restatement | (a) §1, §3, §6; (b) §4; (c) §5; (d) §7; (e) `dashboard-settings.md`; (f) end of §3 and §6; boundaries in the pointer table. Grep of the new files for `Snapshot the before-state`, `\| **Read** \|`, `zero policies`: 0 hits |
| After-save rule, `NEXT_PUBLIC_*`, deployment / READY / SHA | §4 opening bullets and steps 3–4 (V7 wording: created after the save and serving the target); §5 first bullet |
| More than one project, by role | §1 |
| CLI not installed, MCP first, `vercel env pull` | §7, by pointer to the `devops.md` Vercel CLI row; V5 routes (`npx`, `npm exec`, `pnpm dlx`) and no MCP CLI fallbacks |
| V14 (a) value-bearing rule | §2, naming `decrypt` and `source` |
| V14 (b) probe ownership | §4 "Who probes what": runtime logs scoped to the deployment; HTTP/browser by main session or user; no bypass secret; 401/403 = "not probed" |
| V14 (c) production domain + rollback | §4 step 5 |
| V14 (d) | Section above; no env or project tool called |
| V14 (e) domains / hostnames | Read by Dev: no custom domain, deployment hostname or project name in the new files. QA reads again |
| V3–V12 | V3 §4 step 5 (incl. rolling release); V4 §5 CANCELED + `SKIP:` + fail-open; V6 §2; V7 §4 step 2–3; V8 §6; V9 §4 grounding; V10 `dashboard-settings.md` last paragraph; V11 §5; V12 §3 env row |
| Q-D3-1 | No write tool; `devops.md` has only the pointer line |
| Q-D3-3 | §6: confirming a run is Read tier; running one is production tier, user executes |
| Q-D3-4 | §1: roles only, `list_projects` each time, unknown = unrecognised, each project holds its own env vars |
| Size | SKILL.md 107 lines; reference files 22 and 15, linked from SKILL.md |
| `devops.md` | One added line (plus its blank separator), nothing else |
| Finding-11 regex | Over the three new files and the added lines of the `devops.md` diff: 0 hits |
| Public-repo read | No ID, slug, deployment URL, custom domain, key prefix, value, secret location or open weakness; projects by role |
| Paths exist, no counts | `.claude/skills/env-change-protocol/SKILL.md`, `.claude/agents/devops.md`, `.claude/skills/supabase-ops/SKILL.md`, `docs/feature_flags.md`, `lib/utils/featureFlags.ts`, `vercel.json`, `.github/ci/non-deploying-change.sh` checked in the worktree; plugin skills `vercel:env-vars`, `vercel:deployments-cicd`, `vercel:vercel-cli`, `vercel:access-protected-vercel-deployment` exist in the installed plugin. No count of crons, projects or env vars stated |
| Files touched | `.claude/skills/vercel-ops/**`, `.claude/agents/devops.md`, this requirement. CLAUDE.md unchanged |

---

## SA Code Review — DO-3

**Code Review by SA — 2026-10-31**
**Status: CODE APPROVED** (four small wording fixes made by SA, listed below). Q-D3-1 to Q-D3-4 and V1–V14 are honoured.

### Ruling on Dev's deviation (`get_runtime_errors` has no deployment filter)

**Accepted.** V1 asked for server-side evidence scoped to *that deployment*; a project-wide tool cannot give it, so `get_runtime_logs` with `deploymentId` is the only per-deployment evidence. `get_runtime_errors` stays as the project-wide first look for a production problem, which also matches the Vercel MCP server's own "errors first, then logs" order. Its seven-day ceiling is recorded in `tool-parameters.md`. No spec change needed: V1 named both tools as sources, not both as per-deployment.

### Code Review Comments

| # | Item | Result |
|---|---|---|
| 1 | No restatement | ✅ The pointer table sends the eight steps, tiers, template and probe to `env-change-protocol`, the tool list, `decrypt` ban and CLI row to `devops.md`, the region to `supabase-ops` §6. The §D3.4 grep (`Snapshot the before-state`, `\| **Read** \|`, `zero policies`) over the new files: 0 hits. |
| 2 | No write, no decrypt, no deploy/cron trigger, no `vercel` | ✅ §2 bans `decrypt` and `source` and `get_project_env`; §3 closes with every write going to the user or the main session; §4 step 2 "DO never triggers a deployment"; §6 "Never trigger a cron"; §7 bans every `vercel` route (`npx`, `npm exec`, `pnpm dlx`) and the MCP CLI fallbacks; `dashboard-settings.md` forbids changing protection to make a probe work. |
| 3 | Value-bearing responses (V2, V6, V14 a) | ✅ §2: named fields only, no raw output, no summarising or measuring a value, user never pastes a value, sensitive type proven only by probe. |
| 4 | Probe ownership and production domain (V1, V3, V7, V14 b/c) | ✅ §4 steps 2–6 and "Who probes what": deployment-scoped runtime logs for DO, HTTP probes by the main session or user without a bypass secret, 401/403 = "not probed"; aliases-include-domain check with the rollback, non-auto-assign and rolling-release cases. |
| 5 | CANCELED, fail-open, docs-only (V4, V11) | ✅ §5, checked against `.github/ci/non-deploying-change.sh`: exit 0 = SKIP, the `SKIP:` echo line, fail-open on empty diff, `--no-renames`, the root-`*.md`-only rule and the carve-outs. `gh-readonly-queue/**` matches `vercel.json`. |
| 6 | V8 crons field | ✅ One answer stated (enabled state from `get_project` `crons` named fields; run history dashboard). SA added the absent-field case (fix 2) so the rule cannot read as "absent = disabled". |
| 7 | V13 `group_by` values | ✅ with caveat. `requestPath`, `level`, `source`, `deploymentId`, `branch`, one per call, are used consistently in §6 and `tool-parameters.md`. SA could not load the tool schemas in this session (ToolSearch not exposed to this agent), so the names rest on Dev's schema load; QA re-checks by loading the `get_runtime_logs` schema (no call). `level` is not the HTTP status, so "by path and status" was wrong; SA fixed it (fixes 1 and 3). |
| 8 | V12 custom environments, branch scope | ✅ §3 env row: every target including custom environments; unscoped Preview reaches every preview. |
| 9 | Public-repo rule | ✅ Finding-11 regex over the three new files and the added lines of `git diff -U0`: 0 hits. A read for hostnames, custom domains, project names, `http(s)://` and TLD patterns: 0 hits. Projects named by role only; no cron paths, counts or IDs. |
| 10 | Paths exist | ✅ `.claude/skills/env-change-protocol/SKILL.md`, `.claude/skills/supabase-ops/SKILL.md` (§6 region line present), `.claude/agents/devops.md`, `docs/feature_flags.md` (build-time redeploy line), `lib/utils/featureFlags.ts` (literal `process.env.NEXT_PUBLIC_*` reads), `vercel.json` (keys `ignoreCommand`, `git`, `crons`, `rewrites`), `.github/ci/non-deploying-change.sh`; the four `vercel:*` plugin skills exist in the installed plugin. Both reference files linked from SKILL.md. |
| 11 | Frontmatter and description | ✅ js-yaml parses to `name`, `description`; `name` matches the folder. The description fires on every trigger in §D3.4 (check or set an env var, which deployment has a value, wait for a deploy, failed or skipped deploy, build/runtime logs and errors, a cron that did not run, a domain, deployment protection or another project setting), says main session and DO, names no project, URL or ID. |
| 12 | `devops.md` | ✅ Exactly the D3-3 pointer line plus its blank separator, under `### Vercel`. Every Vercel tool the skill tells DO to use is in the frontmatter list. |
| 13 | Size, CRLF | ✅ SKILL.md 107 lines (within ~200); files are CRLF like their neighbours. |

### Fixes made by SA

1. `SKILL.md` §6 — "report counts by path and status" changed to "by path and by level, and a status code only where the entries carry one": `level` is the log level, not the HTTP status.
2. `SKILL.md` §6 — added "if a response does not carry them, the enabled state is a dashboard step" to the `crons` field rule.
3. `tool-parameters.md` `get_runtime_logs` row — "by path and by status" changed to "by path and by level", with the same level-is-not-status note.
4. `dashboard-settings.md` cron row — now "run history; the enabled state when `get_project` does not carry it", matching fix 2.

### Optimisation Suggestions

- §4 step 3 "currently serves the target" reads naturally for production; for Preview it means the newest deployment of that branch. Not blocking.

### Code Approved for QA: Yes

---

## QA Report — DO-3

**QA — 2026-10-31**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path existence, read-through). This is a docs/config-only slice, so there is no runtime to exercise. · **Focus:** security (public-repo, no-write), schema (frontmatter, tool parameters) · **Skipped:** the fresh-session load test (deferred, as for DO-1) · **Input source:** TL prompt + §D3.4 as amended by V14 + SA Code Review — DO-3. Run in the DO-3 worktree on the uncommitted changes. QA edited nothing except this section, the §0 DO-3 row and the Change History row.

### Test Coverage

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | Frontmatter parses; `name` matches folder; description triggers | Pass | js-yaml load (the main checkout's `node_modules`; the worktree has none) from a scratch script outside the repo: keys `name`, `description`; `name = vercel-ops`; description 840 chars. It fires on: check or set an env var, which deployment has a value, wait for a deploy, a deploy that failed or was skipped, build logs, runtime logs or errors, a cron that did not run, a domain, deployment protection or another project setting. It says "used by the main session and by the DevOps (DO) agent", and names no project, team, URL or ID |
| 2 | Size; linked reference files exist | Pass | SKILL.md 107 lines; `dashboard-settings.md` 22, `tool-parameters.md` 15. Both are linked from SKILL.md and both exist |
| 3 | Every repo path named exists; no counts | Pass | Backticked tokens with `/` or `.` extracted from the three files and tested with `test -e`. Exist: `.claude/agents/devops.md`, `.claude/skills/env-change-protocol/SKILL.md`, `.claude/skills/supabase-ops/SKILL.md` (§6 region line, line 104), `.github/ci/non-deploying-change.sh`, `docs/feature_flags.md` (build-time lines 501, 533), `lib/utils/featureFlags.ts` (10 literal `process.env.NEXT_PUBLIC_` reads), `vercel.json`. The rest are globs or keys, not paths: `docs/**`, `scripts/**`, `.claude/**`, `*.md`, `gh-readonly-queue/**`, `git.deploymentEnabled`, `process.env.NEXT_PUBLIC_*`. Facts checked against the files: `vercel.json` keys are `ignoreCommand`, `git`, `crons`, `rewrites`; `git.deploymentEnabled` disables `gh-readonly-queue/**`; the script exits 0 on SKIP after echoing `SKIP:`, exits 1 (BUILD) on an unresolvable base or an empty diff, uses `--no-renames`, skips `docs/*`, `scripts/*`, `.claude/*` and root-level `*.md`, and builds nested `.md`, the four gate scripts and `scripts/` test suites. No count of crons, projects or env vars stated |
| 4 | Finding-11 regex; V14(e) read | Pass | Regex over the added lines of `git diff -U0` (`^+`, excluding `+++`) and over the three new files: 0 hits. Over the whole requirement: 1 hit, line 623, the regex quoting itself (expected). Extra greps over the new files and the added diff lines for `https?://`, `www.`, TLDs (`.com .io .dev .app .net .org .co .il .ai`), the product and repo names, `dpl_`, and 6+ digit runs: 0 hits. Read-through: projects named by role only ("the web app project", "the marketing-site project"); "the production domain" is generic; no custom domain, deployment hostname, project name, slug, key prefix, value, secret location or open weakness |
| 5 | No restatement | Pass | The §D3.4 greps (`Snapshot the before-state`, `\| **Read** \|`, `zero policies`) over the three files: 0/0/0. Extra greps for the `env-change-protocol` tier and timing labels and template fields (`Reversible write`, `Production or irreversible`, `Before merge`, `After deploy`, `How to undo`, `Before-state`, `Executed by`, `### Step N`, `Classify the tier`): all 0. `The eight steps` has 1 hit, in the pointer table, which points to the skill. `devops.md` forbidden-family table markers (`gh secret`, `gh api`, `printenv`, `db push`, `git commit`, `Secret exposure`, `Family`): all 0; §7 points to the "Vercel CLI row of the forbidden families in `devops.md`" |
| 6 | Safety: no write, no `decrypt`/`source`, no `get_project_env`, no deploy/cron trigger, no `vercel` by any route | Pass | Grep for write tool names (`create_`, `edit_`, `update_`, `delete_`, `promote_`, `rollback_`, `assign_`), `redeploy`, `decrypt`, `source`, `get_project_env`, `trigger`, `vercel <subcommand>`, `npx`, `npm exec`, `pnpm dlx`, `CLI`. Every hit is a prohibition or a hand-off: §2 line 34 (never `decrypt`/`source`, never `get_project_env`), §3 line 49 (every write by the user or main session; DO read-only), §4 step 2 (DO never triggers a deployment; Redeploy by the user / main session), §6 line 88 (never trigger a cron), §7 lines 92–94 (no `vercel` via binary, `npx`, `npm exec`, `pnpm dlx`; MCP CLI fallbacks not followed; `vercel env pull` forbidden by pointer), checklist lines 99, 105, 106. No write tool is named anywhere in the three files |
| 7 | `devops.md` diff; tool names in frontmatter | Pass | `git diff -U0`: exactly two added lines, the D3-3 pointer line and a blank, no removed line. All 15 Vercel tools the skill tells DO to use (`list_teams`, `list_projects`, `get_project`, `filter_project_envs`, `list_deployments`, `get_deployment`, `list_deployment_events`, `get_runtime_logs`, `get_runtime_errors`, `list_domains`, `get_domain`, `get_domain_config`, `list_project_domains`, `get_project_domain`, `search_vercel_documentation`) are in the parsed `tools:` list as `mcp__plugin_vercel_vercel__<name>`. The only tool name not in the list is `get_project_env`, which the skill names only to forbid it |
| 8 | Files touched; line endings; diff size | Pass | `git status --short`: M `.claude/agents/devops.md`, M this requirement, untracked `.claude/skills/vercel-ops/` (the three files). `git diff HEAD -- CLAUDE.md` empty. `git diff --numstat`: devops.md +2/−0; requirement +368/−6, where the 6 removed lines are the Last Updated line and the five status lines updated in place (§0 DO-2/DO-3, §5 headings, FU-1 row), not a whole-file rewrite. CRLF: 0 LF-only lines in the three new files, 0 added diff lines without CR in either edited file |
| 9 | Tool parameters agree with the schema facts | Pass, with notes | Facts from the main session's schema load (no call), recorded as evidence: `get_runtime_logs.group_by` ∈ {`requestPath`, `level`, `source`, `deploymentId`, `branch`}; `get_runtime_logs.environment` ∈ {`production`, `preview`} only; `get_runtime_errors` has no deployment filter (`projectId`, `routes`, `since` ≤ 7 days, `until`); `list_deployments.state` values BUILDING, ERROR, INITIALIZING, QUEUED, READY, CANCELED, BLOCKED; `list_deployments` `since`/`until` are JavaScript ms timestamps, `from`/`to` deprecated. `tool-parameters.md` agrees on every one: `group_by` same five, one per call; `get_runtime_errors` "no deployment filter", seven-day maximum; `list_deployments` ms and `from`/`to` deprecated; the state list is not enumerated, and the skill keys on READY versus everything else, naming only READY and CANCELED (both in the enum). Nothing in the skill implies `get_runtime_logs.environment` takes a custom environment: §3 sends custom environments to `filter_project_envs` only, and runtime logs are scoped by `deploymentId`. See edge cases 1 and 2 |
| 10 | Fresh-session load test | Deferred | Agent and skill files load at session start, so this needs a fresh session, as for DO-1. Not failed |

### Issues Found

- **Bugs:** none.
- **Edge cases (nice to fix, non-blocking):**
  1. `tool-parameters.md` lists `environment` for `get_runtime_logs` without its values. Add "`production` or `preview` only — a custom environment is not accepted; scope by `deploymentId`" so nobody passes a custom-environment slug there by analogy with `filter_project_envs`.
  2. Three statements in `tool-parameters.md` are outside the facts the main session verified, and QA could not load the schemas itself (no tool-schema loader in this session): `get_runtime_logs` `since`/`until` "take an ISO date or a relative lookback"; `get_runtime_errors` takes `teamId`; `list_deployments` `state` "takes a comma-separated list". None conflicts with the verified facts. They are unverified, not wrong. Re-check them on the next schema load.
  3. "The CLI is not installed" (§D3.4) is stated indirectly: §7 says nobody should read "not installed" as the control, and "if the main session ever installs the CLI". The control is stated outright: no `vercel` by any route. Acceptable as it stands.

### Final Status

- [x] All acceptance criteria pass (the load test is deferred). Ready for the user's diff review.
- [ ] Issues found

---

## SA Review — DO-4

**Reviewed by SA — 2026-10-31**
**Verdict: APPROVED WITH CHANGES.** The scope, the "points back, never restates" shape and the core procedure in §D4.2(b) are right. The seven rules match the repo: every required workflow has `merge_group`, no `paths:`, the skip decided inside the job, and a verdict job with `if: always()`. `plugin-tests.yml` is correctly called out as not required and not requirable. The gaps are three:
- The spec names reads that cannot meet its own named-fields rule (`gh ruleset list|view`, `gh workflow view`, an auto-merge field `gh repo view` does not have).
- `devops.md`'s allowed list, which is the only guard on Bash, still allows several value-bearing GETs and whole logs that the skill means to forbid.
- The auto-merge exception the skill wants to point to is not in `team-leader.md` or `release-manager.md`.

Dev builds DO-4 with rulings Q-D4-1 to Q-D4-9, the auto-merge ruling and findings G1–G18 applied. No second SA spec pass; SA checks them at code review.

SA fixed nine spec statements in place, each marked *(SA-corrected)* or listed under the finding that names it.

**Facts SA settled with read-only calls** (GET only, each with a narrow `--jq`, nothing else printed):
- `main` is protected by a classic rule.
- No repository ruleset exists, and the effective-rules read for `main` returns no rule.
- The classic protection response has no merge-queue field.
- Recent `merge_group` runs exist, so the queue is in use.
- `gh` help (local, no network) shows that `gh repo view --json` has no auto-merge or security field, that `gh ruleset list|view` and `gh workflow view` have no `--json`, that `gh pr list` defaults to 30 results, and that `gh variable list --json` offers `value` as a field.

No ID, login or check name was recorded here.

### Rulings on the open questions

**Q-D4-1: read both, report the union with each rule's source. BA's suggestion accepted, with corrections (G1, G4, G5).**
- Rulesets are read through `gh api` only: the repo rulesets list, and the effective rules for `main` (repo and org level).
- The classic response carries no merge-queue setting. For a classic rule, "a queue is required" is shown by recent `merge_group` runs (`gh run list --event merge_group --json …`) together with a dashboard check. A ruleset's queue shows up as a `merge_queue` rule.
- An error from either read (no admin rights, or 404) is "not read". It is never "not protected".
- The skill does not say which mechanism is in use today.

**Q-D4-2: accepted.**
- The evidence for the stored state is a read of the changed field after the user saves.
- The evidence for behaviour is the next real PR, watched by the main session with the undo ready.
- A docs-only probe PR is allowed only by SA, in a plan that names why the change cannot wait. Such a PR exercises **reporting** only. It does not exercise the test path, so it is never evidence that a new check passes on code.

**Q-D4-3: never a whole log. The rule goes into `devops.md`'s allowed list, not only the skill (G3).**
- The allowed form is `gh run view <id> --json jobs --jq …` first. Then, only if needed, `gh run view <id> --log-failed` piped into a bounded filter (`grep -n -m <N> -E …`). That pipe is the only allowed use of `grep` on `gh` output.
- `gh run view --log`, `gh run download`, and the `gh api` log and artifact download paths are forbidden.
- DO reports the error class and never copies a line into a file.
- DO does not read the logs of any job whose steps reference `secrets.*`.

**Q-D4-4: accepted.**
- DO reads only whether each feature is enabled, as named fields under `security_and_analysis`, which GitHub returns only to a caller with admin rights.
- No alerts endpoint is called, by path rule in `devops.md` (G2): not `secret-scanning`, not `dependabot/alerts`, not `code-scanning/alerts`.
- The enabled state of a security feature that is off is an open weakness. It goes to the untracked private docs only, never into a tracked file or a chat summary.
- Alert triage, if wanted, is its own slice.

**Q-D4-5: accepted, and widened.**
- In `devops.md`, the line becomes `gh secret list --json name,updatedAt` and `gh variable list --json name,updatedAt`, with any `--env` scope. `value` is never selected.
- `gh variable get` is added by name to the forbidden "Secrets and variables" row, because it prints a value and is the obvious command to reach for.
- Org scope is read with `gh api orgs/{owner}/…` and a `--jq` selector, not with `--org <name>` (G15).

**Q-D4-6: accepted. No allowed-list change.**
- The read is `gh pr view <n> --json state,baseRefName,mergeCommit,mergedAt --jq …`, selecting `.mergeCommit.oid`, then the compare read on that SHA.
- `identical` or `behind` means the commit is on `main`. `ahead` or `diverged` means it is not.
- A 404 is "not verified".

**Q-D4-7: no setting change in DO-4; RM gets one pointer line.** BA's suggestion accepted.
- D4-4 becomes **Edited**: one line in `release-manager.md` § Merging the PR pointing to `github-ops` §(d).
- The retarget fact is corrected (G9).
- Turning on "Automatically delete head branches" is a separate production-tier plan, if the user wants it.

**Q-D4-8: no number.** BA's suggestion accepted.
- The PR count gets `--limit` (G6). Without it the count stops at 30 and under-reports exactly in the burst it exists to catch.
- The pacing rule is scoped to batches (G13).

**Q-D4-9: GraphQL stays forbidden for DO, read queries included.** BA's suggestion accepted.
- `gh api graphql` is added by name to the forbidden "GitHub writes" row. It is already covered by the field-flag rule; the name makes it obvious.
- What the skill reads instead: recent `merge_group` runs, `gh pr checks <n> --required --json …`, and `gh pr view --json mergeStateStatus,autoMergeRequest --jq …`, with `autoMergeRequest` selected as present or absent and its merge method only, never `enabledBy` (G10).

**Auto-merge and manual gates (the tension BA raised): the rule is not where §D4.2(c) and §D4.3 say it is.**
- `team-leader.md` § Standing User Preferences says "Auto-merge every PR".
- `release-manager.md` § Merging the PR says every PR goes on auto-merge "as soon as it is opened".
- Neither file, and not `env-change-protocol`, carries the user's standing decision (2026-10-15) that a PR with a user demo or a production-migration or live-check gate stays off auto-merge until the user confirms the gate is done.
- The TL handshake row "Any pre-merge environment step: DO verifies it is done before the user's diff approval goes to RM" covers in-cycle environment steps only. It does not cover a demo or live-check gate, or a standalone plan.
- **Ruling:**
  - The rule's home is TL's "Auto-merge every PR" row, amended with the exception.
  - RM § Merging the PR gets one sentence: when the brief names an open manual gate, open the PR without `--auto`, report it, and put it on auto-merge only once TL relays that the user has confirmed the gate.
  - D4-4 (RM) and a new **D4-7 (`team-leader.md`, one row amended)** join the file list.
  - TL checks the exact wording against the user's 2026-10-15 decision before Dev edits. It records an existing decision; it does not make a new one.
  - The skill then points to the TL row and keeps only DO's plan instruction: a `Before merge` step's `When` field says "PR stays off auto-merge until step N is verified".
- Until those lines exist, the skill must not claim that `team-leader.md` holds the preference.

### Findings

G1. **[§D4.2(a) rulesets] `gh ruleset list` and `gh ruleset view` cannot meet the named-fields rule.**
- Neither command has `--json`.
- `list` prints ruleset IDs and the source owner and repo.
- `view` prints bypass details.
- **SA fixed the spec:** rulesets are read through `gh api` with `--jq` only.
- `devops.md` drops `gh ruleset list|view` from the allowed list.

— Priority: High

G2. **[`devops.md` `gh api` line] An unqualified GET reaches value-bearing and PII endpoints.**
- These are all plain GETs that the current line allows:
  - the secret-scanning alerts endpoint, which returns the secret;
  - repo, environment and org Actions variables, which return values;
  - the run-log and artifact download paths, which fetch whole logs;
  - `user`, which returns a login and an email;
  - collaborators, which returns logins.
- The skill's bans do not reach Bash. `devops.md` is the guard.
- The line is amended:
  - every `gh api` read carries a `--jq` that names fields;
  - never a `secret-scanning`, `dependabot/alerts` or `code-scanning/alerts` path;
  - never a `/logs` or artifact download path;
  - login lists are reported as a count.

— Priority: High

G3. **[`devops.md` `gh run view`; Q-D4-3] `gh run view` is allowed unqualified, and `grep` is not on the allowed list.** The narrow-filter rule the spec relies on therefore has no allowed form. The amended line is given in the Q-D4-3 ruling. — Priority: High

G4. **[§D4.2(a) repo settings] `gh repo view --json` has no auto-merge field and no security fields.**
- **SA fixed the spec:** Allow auto-merge and `security_and_analysis` come from `gh api repos/{owner}/{repo} --jq …`.
- `security_and_analysis` is returned only to a caller with admin rights, so a missing object is "not read", never "off".

— Priority: Medium

G5. **[§D4.2(a) classic protection] Two traps in the classic response.**
- Required checks carry an app ID next to the name. Select `context` only.
- The response has no merge-queue field.

**SA fixed the spec** (both, plus the error = "not read" rule). — Priority: Medium

G6. **[§D4.2(e) PR count] `gh pr list` returns 30 by default.** **SA fixed the spec:** the count read carries `--limit 1000`. Any other counting `gh pr list` or `gh run list` in the skill does the same. — Priority: Medium

G7. **[§D4.2(c), §D4.3 TL row] The auto-merge pointer is false today.** See the auto-merge ruling. — Priority: Medium

G8. **[§D4.2(b) rules 5 and 6] Two missing facts.**
- A job with `needs:` and no `if: always()` is skipped when a job it needs fails. It then reads as a pass, exactly like a skippable `if:`. That is the reason the verdict job in `tests.yml` is `if: always()`.
- The stronger reason the Vercel status is never required is that `vercel.json` disables deployments for `gh-readonly-queue/**`. So that status never reports on a queue commit, and every queued PR would time out. Docs-only skips come second.

**SA fixed the spec** (both). — Priority: Medium

G9. **[§D4.2(d)] The retarget trigger is the deletion of the branch, not the setting.**
- GitHub retargets open child PRs when the parent's head branch is deleted after the merge, whether the setting deletes it or someone deletes it by hand.
- **SA fixed the spec.**
- The rule is unchanged: avoid stacking, and verify the landing with the base-plus-compare check.

— Priority: Medium

G10. **[§D4.2(a) named fields] Name the actor-bearing fields to never select.**
- On `gh pr view|list`: `author`, `mergedBy`, `assignees`, `reviews`, `latestReviews`, `reviewRequests`, and `autoMergeRequest.enabledBy`.
- The same applies to a check or run actor.
- Any login list is a count.
- The skill carries this as one short list. Dev checks the field names at build (§D4.2(h)).

— Priority: Low

G11. **[§D4.2(a) Actions] `gh workflow view` has no `--json`.**
- **SA fixed the spec:** the read is `gh workflow list --json …`, and the workflow file in `.github/workflows/` gives the definition.
- `devops.md` keeps `gh workflow list` only.

— Priority: Low

G12. **[§D4.2(c)] Restatement of RM.** "Merge commit only, never squash or rebase", the failed-queue-run sentence, and the "Auto merge is not allowed" fallback are RM's text. The skill keeps only the GitHub facts: the queue sets the method, and Allow auto-merge is a readable setting. For the rest it points to RM. — Priority: Low

G13. **[§D4.2(e)] "One session at a time opens PRs or pushes" is broader than protocol step 8.**
- Step 8 paces bulk actions. As written, the line would set a new standing rule for every session, which is for TL to set with the user.
- Scope it to a batch: during a batch of PRs or pushes, one session runs it.

— Priority: Low

G14. **[§D4.2(e)] Recovery accounts.**
- The skill should not assert that a second owner account exists. That is an account fact about a public repo.
- **SA reworded the spec:** "any account kept for recovery" never runs a session, is never logged in to `gh`, and is never named, or said to exist, in tracked text.
- The AC is reworded to match.

— Priority: Low

G15. **[§D4.2(a) secrets and variables] Org scope.**
- `--org <name>` makes the org name a typed argument.
- Use `gh api orgs/{owner}/actions/secrets` and `…/variables` with a `--jq` selector on names only.
- An org read needs org-admin rights. A failure is "not read".

— Priority: Low

G16. **[Q-D4-3 grounding] Named a single job, where the rule is about any job with secrets.** **SA fixed the spec:** "any job whose steps reference `secrets.*`". — Priority: Low

G17. **[§D4.2(b) rule 2] Check names should be unique across workflows.** Two jobs with the same `name:` in different workflows make the required check ambiguous. DO reports a duplicate as drift. — Priority: Low

G18. **[§D4.4] Add criteria so the rulings can fail.**
- (a) The `devops.md` diff is exactly the following, and nothing else:
  - the D4-3 pointer line;
  - the `gh api` line amended (G2);
  - the secrets and variables line (Q-D4-5);
  - the `gh pr|run|repo|workflow` line (G1, G3, G11);
  - the forbidden-table additions `gh variable get`, `gh run download`, `gh api graphql` and `gh auth status` (that last one prints the login and token scopes).
- (b) QA greps the new files for `gh ruleset list`, `gh ruleset view`, `gh workflow view` and `--log ` (followed by a space). Each hit must be a prohibition.
- (c) Every `gh` read the skill shows carries `--json`/`--jq`, except the `--log-failed | grep -m` form. Every counting list carries `--limit`.
- (d) The RM diff is at most two added sentences in § Merging the PR. The TL diff is one amended row. TL confirmed the wording first.
- (e) QA greps the new files for the repo's owner and repo name: 0 hits.
- (f) The restatement grep adds `--squash or --rebase`.
- (g) The "files touched" criterion now includes `team-leader.md` and `release-manager.md`.

— Priority: Medium

### Checked and honoured

- **Facts against the repo:**
  - All six `pull_request` workflows other than `plugin-tests.yml` have `merge_group`, `permissions: contents: read`, no `paths:`, and an in-job skip through `.github/ci/non-deploying-change.sh` or `.github/ci/jest-gate-scope.sh`.
  - `tests.yml` has the matrix behind an `if: always()` verdict job.
  - `plugin-tests.yml` has `paths:`, no `merge_group`, and its secret-bearing jobs run only on the schedule or a dispatch.
  - `vercel.json` disables `gh-readonly-queue/**`.
  - `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md` enabled the queue through the classic rule, which matches the live read.
- **Facts against GitHub:**
  - A skipped required check passes.
  - A path-filtered required workflow leaves the check pending.
  - `merge_group` does not take `paths:`.
  - The compare statuses mean what §D4.2(c) says.
  - `gh variable list` prints values by default.
  - `gh api graphql` always POSTs.
  - The secret-scanning alerts endpoint returns the secret.
  - A fork PR gets no secrets on `pull_request`.
- **Order rules for the required set** (add after the check reports once; remove before) are right and generic.
- **No write:** the spec gives DO no `gh` write. `gh pr edit --base` is named as RM's, settings changes are production tier for the user, and GraphQL stays forbidden.
- **Public-repo:**
  - The finding-11 regex over §D4 and over this review returns zero hits.
  - There are no IDs, logins, check-name lists or token scopes.
  - The incident figures in §D4.2(e) are grounding in the spec only, and the skill carries none.
- **No restatement**, apart from G12. The steps, tiers, template and pacing rule point to `env-change-protocol`, and the tool rules point to `devops.md`. The §D4.4 grep is kept and widened.
- **Config/docs only:** no app code, no CI job, no CI time.

### Approval

[x] DO-4 spec approved. Dev builds with Q-D4-1 to Q-D4-9, the auto-merge ruling and G1–G18 applied. `devops.md` changes as G18(a) states. `release-manager.md` gets the stacked-PR pointer and the manual-gate sentence. `team-leader.md` gets one amended row, after TL confirms the wording.

---

## DO-4 implementation notes

**By Dev — 2026-10-31.** Config/docs-only slice, no separate workplan. Nothing committed.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/github-ops/SKILL.md` | New | Pointer table, §1 scope and named-fields rule, §2 reading state, §3 logs and alerts, §4 the seven rules + order rules, §5 merge queue and auto-merge facts, §6 landed on `main` + stacked PRs, §7 pacing and accounts, §8 git hazards, §9 public-repo specifics, §10 settings changes and verification, §11 checklist |
| `.claude/skills/github-ops/read-commands.md` | New | Every read with its named-field selector, and the "never used" list |
| `.claude/skills/github-ops/dashboard-settings.md` | New | The §D4.2(h) dashboard table |
| `.claude/agents/devops.md` | Edited | The D4-3 pointer line; the three `gh` allowed-list lines amended in place (G2, Q-D4-5/G15, G1/G3/G11/Q-D4-3); forbidden table: `gh api graphql`, `gh variable get`, `gh auth status` (replaces `gh auth status --show-token`), `gh run download` |
| `.claude/agents/release-manager.md` | Edited | § Merging the PR: the manual-gate sentence and the stacked-PR pointer (two added sentences) plus an "unless a manual gate is open" qualifier on its opening clause. The same qualifier, per TL's brief, on the merge-gating bullet, the end-of-cycle trigger, "Then put it on auto-merge" and the "Never merge by hand" bullet |
| `.claude/agents/team-leader.md` | Edited | The row renamed to "Auto-merge when CI is the only gate" and amended with the user's 2026-10-15 decision (wording checked by TL). The same short qualifier, per TL's brief, on the flow line and the "User approves" handshake row |
| This requirement | Edited | §0, these notes, Change History |

### Field names checked (§D4.2(h))

No response was quoted. No secret, variable, alert, log or actor endpoint was called.

| Name | How checked |
|---|---|
| `gh pr view\|list` fields (`state`, `baseRefName`, `mergeCommit`, `mergedAt`, `mergeStateStatus`, `autoMergeRequest`, `number`) and the never-select actor fields (`author`, `mergedBy`, `assignees`, `reviews`, `latestReviews`, `reviewRequests`) | The field list `gh` prints for `--json` with no value |
| `gh pr checks --json` (`name`, `state`, `bucket`, `workflow`) and `--required` | Field list + `--help` |
| `gh run view --json` (`jobs`); `gh run list --json` (`workflowName`, `event`, `status`, `conclusion`, `headSha`, `createdAt`); `--event`, `--limit` (default 20), `--workflow`, `--branch`; `--job`, `--log-failed` | Field list + `--help` |
| `gh workflow list --json` (`name`, `path`, `state`), `--limit` | Field list + `--help` |
| `gh secret list --json` / `gh variable list --json` (`name`, `updatedAt`; `value` exists on variables and is banned), `--env`, `--org` | Field list + `--help` |
| `gh pr list` `--author`, `--search`, `--limit` (default 30) | `--help` |
| Repo: `allow_auto_merge`, `delete_branch_on_merge`, `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`, `default_branch`, `visibility`, `security_and_analysis` | `gh api` GET with a `has(...)` selector: booleans only |
| Classic protection: `required_status_checks.checks`, `.strict`, `.contexts`, `enforce_admins`, `required_pull_request_reviews`, `required_linear_history`, `allow_force_pushes`, `allow_deletions` | `gh api` GET with a `has(...)` selector: booleans only |
| `actions/permissions` (`enabled`, `allowed_actions`); `actions/permissions/workflow` (`default_workflow_permissions`, `can_approve_pull_request_reviews`) | `gh api` GET with `--jq keys`: key names only |
| Rulesets list and effective rules for `main` | `gh api` GET with `--jq length` (agrees with SA's read). The field names (`name`, `target`, `enforcement`, `source_type`; `type`, `ruleset_source_type`, rule type `merge_queue`) come from the REST reference, not a live read, because both lists are empty |
| `security_and_analysis.secret_scanning.status`, `.secret_scanning_push_protection.status`; compare `.status`; org `secrets[].name`, `variables[].name` / `updated_at`; `autoMergeRequest.mergeMethod`; job `steps[].conclusion` | REST reference / documented `gh` shapes; not read live (Dev does not call security state, org scope or job data) |

### Acceptance criteria (§D4.4 as amended by G18)

| Criterion | How it is met |
|---|---|
| Frontmatter | `name: github-ops` (matches folder) + single-line `description`, same format as `vercel-ops` |
| Description triggers | Branch protection, rulesets, required checks, a stuck queue or a check that never reports, "Auto merge is not allowed", deleting head branches, stacked PR, "did my PR land on main", secret scanning or push protection, Actions permissions, a failed workflow run, secret or variable names, PR volume or an account suspension; "used by the main session and by the DevOps (DO) agent"; no owner, org, account, app or ID |
| (a)–(i), §D4.3, no restatement | (a) §1–§3 + `read-commands.md`; (b) §4; (c) §5; (d) §6; (e) §7; (f) §8; (g) §9; (h) `dashboard-settings.md` + these notes; (i) §10; boundaries in the pointer table. Restatement grep (`Snapshot the before-state`, `\| **Read** \|`, `zero policies`, `enqueuePullRequest`, `--squash or --rebase`) over the new files: 0 hits |
| No required check named, no count | Grep of the new files for each job `name:` in `.github/workflows/*.yml`: 0 hits |
| Seven rules + both order rules | §4 rules 1–7 (rule 2 carries G17's uniqueness, rule 5 G8's `needs:`, rule 6 G8's `vercel.json` reason) and the two order bullets |
| Named fields, no secret-scanning alerts, `gh variable list` form | §1, §2 secrets row, §3 last bullet, `read-commands.md` |
| Landed on `main`, stacked PRs | §6 (G9's deletion trigger) |
| Pacing, recovery accounts | §7, scoped to a batch (G13), no number (Q-D4-8), recovery accounts per G14 |
| Never `git stash` with reason | §8 |
| Size | SKILL.md 133 lines; reference files 28 and 15 lines, linked from SKILL.md |
| G18(a) `devops.md` | Exactly: the pointer line, the `gh api` line, the secrets and variables line, the `gh pr\|run\|repo\|workflow` line (`gh ruleset list\|view` and `gh workflow view` dropped), and the forbidden additions `gh variable get`, `gh run download`, `gh api graphql`, `gh auth status` |
| G18(b) | Grep of the new files for `gh ruleset list`, `gh ruleset view`, `gh workflow view`, `--log `: 3 lines, each a prohibition (SKILL.md §2 rulesets and Actions rows; the `read-commands.md` "Never used" line) |
| G18(c) | Every `gh` read shown carries `--json` or `--jq`, except the `--log-failed \| grep -n -m` form; every list carries `--limit` |
| G18(d) | RM: two added sentences in § Merging the PR. TL: one amended row. Beyond that, per TL's brief, a short "unless a manual gate is open" qualifier on four other RM lines and two other TL lines, so neither file still says every PR goes on auto-merge unconditionally. SA rules whether these fit G18(d) |
| G18(e) | Owner and repo name over the new files and the added lines: 0 hits |
| Finding-11 regex | Over the three new files and the added lines of the agent-file diffs: 0 hits. Extra grep for 6+ digit runs and `http(s)://`: 0 hits |
| Public-repo read | No owner, org, account login, ID, token scope, off security setting, open alert or check-name list in the new text |
| Paths exist, no counts | `.claude/skills/env-change-protocol/SKILL.md`, `.claude/skills/vercel-ops/SKILL.md`, `.claude/agents/devops.md`, `.claude/agents/release-manager.md`, `.claude/agents/team-leader.md`, `.github/workflows/tests.yml`, `.github/workflows/plugin-tests.yml`, `.github/ci/non-deploying-change.sh`, `.github/ci/jest-gate-scope.sh`, `vercel.json`, `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md` exist. `claude-harness-ops` is named as DO-5's, not built yet. No count of checks, workflows or PRs stated |
| Files touched (G18 g) | `.claude/skills/github-ops/**`, `devops.md`, `release-manager.md`, `team-leader.md`, this requirement. CLAUDE.md unchanged |

---

## SA Code Review — DO-4

**Code Review by SA — 2026-10-31**
**Status:** ✅ Code Approved. SA made five small wording fixes directly; they are listed below.

Reviewed in the DO-4 worktree against the DO-4 Specification, SA Review — DO-4 (Q-D4-1 to Q-D4-9, the auto-merge ruling, G1–G18) and the DO-4 implementation notes. No command beyond local `gh <cmd> --help` and the `--json` field lists was run. No GitHub API call was made.

### Ruling on Dev's flagged item (qualifiers beyond G18(d))

Accepted. G18(d) limited new *rules* to two RM sentences and one TL row. The extra qualifiers add no rule:
- RM: the merge-gating bullet, the end-of-cycle trigger, "Then put it on auto-merge" and "Never merge by hand".
- TL: the flow line and the "User approves" row.

Each says only "unless a manual gate is open" (or "once no manual gate is open") and points to § Merging the PR or § Standing User Preferences. Without them both files would still say every PR goes on auto-merge, which is the false statement G7 named. Each was checked against the user's 2026-10-15 decision:
- The TL row carries the decision exactly: auto-merge + Auto-fix only when green CI is the only remaining gate; a PR with a demo, production-migration or check gate stays off auto-merge until the user confirms the gate is done; diff approval before commit is unchanged.
- The RM sentence carries the procedure only: no `--auto` while the brief names an open gate, and auto-merge once TL relays the user's confirmation.
- No qualifier widens or narrows the rule. One example in the TL row was inconsistent with it; SA aligned it (fix 5).

### Code Review Comments

1. `devops.md` allowed and forbidden lists — coherent with G18(a): the pointer line, the three `gh` lines amended, and the forbidden additions `gh api graphql`, `gh variable get`, `gh auth status`, `gh run download`. `gh ruleset list|view` and `gh workflow view` are dropped. No write form remains. — Pass
2. `devops.md` `gh api` line and `gh pr|run|repo|workflow` line — "named fields" alone still allowed a login or an email:
   - `gh repo view --json` offers `owner`, `assignableUsers`, `mentionableUsers` and `viewer…` commit-email fields;
   - `gh pr view --json commits` carries author emails;
   - a `gh api` read could name `.owner.login`, or `.value` on a variables path.

   **SA fixed** (fixes 1–3). — Priority: High (fixed)
3. Every `gh` flag and `--json` field in the skill exists in local `gh` 2.92.0: `pr checks --json`/`--required` (`name`, `state`, `bucket`, `workflow`); `secret|variable list --json name,updatedAt` and `--env`; `workflow list --json name,path,state` and `--limit`; `run list` `--event`/`--workflow`/`--branch`/`--limit` and its fields; `run view --json jobs`, `--job`, `--log-failed`; `pr list` `--author`/`--search`/`--limit`; the `pr view` fields; the `{owner}`/`{repo}` placeholders of `gh api`. The REST field names (rulesets, effective rules, compare, `security_and_analysis`, org secrets and variables) match the documented REST shapes. — Pass
4. SKILL.md §2 showed `gh pr checks <n> --required` without `--json` (G18(c)). **SA fixed** (fix 4). — Priority: Low (fixed)
5. Logs and alerts — `--json jobs` first, then `--log-failed | grep -n -m` only, never for a job that uses `secrets.*`. No alerts endpoint. GraphQL is forbidden in both files. — Pass
6. Restatement — the grep for the protocol and RM markers (including `--squash or --rebase` and `enqueuePullRequest`) over the new files: 0 hits. §5 states the queue facts and points to RM and TL. — Pass
7. Public-repo — over the three new files and the added agent-diff lines: the finding-11 regex, an owner/repo/person-name grep, a 6+ digit and URL grep, and a grep for every workflow and job `name:` in `.github/workflows/*.yml`: 0 hits. — Pass
8. Paths and sections exist: `env-change-protocol`, `vercel-ops` §5 (with the `gh-readonly-queue/**` fact), the `tests.yml` verdict header, `plugin-tests.yml`, both `.github/ci/` scripts, `vercel.json`, `CI_MERGE_QUEUE_WORKPLAN.md`, TL § Standing User Preferences, RM § Merging the PR. The frontmatter parses (`name: github-ops`, `description`). All files are CRLF only, and every diff is line-level. — Pass

### Fixes made by SA

1. `devops.md` `gh api` line: "never a `value`, actor, login or email field" added.
2. `devops.md` `gh pr|run|repo|workflow` line: "never an actor, login or email field (`github-ops` §1)" added.
3. SKILL.md §1: the never-select list also names `comments`, `commits` and `headRepositoryOwner` on `gh pr`, and `owner`, `assignableUsers`, `mentionableUsers` and `viewer…` on `gh repo view`, plus email fields in general.
4. SKILL.md §2: `gh pr checks <n> --required --json …`.
5. `team-leader.md` auto-merge row: the example "(docs, or code with no demo or production-migration step)" now reads "no demo, production-migration or check step", so it cannot class a check-gated PR as CI-only.

### Optimisation Suggestions

- The classic-protection `--jq` in `read-commands.md` iterates `.required_status_checks.checks[]`. With no required checks, jq errors, and §1 then records "not read". A `// []` guard would tell "none" apart from "not read". Not blocking.
- `\|` inside table code spans is correct markdown but is not copy-paste-ready shell. A one-line note in `read-commands.md` would help.

### Code Approved for QA: Yes

---

## QA Report — DO-4

**QA — 2026-10-31**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path existence, local `gh` help and field lists, read-through). This is a docs/config-only slice, so there is no runtime to exercise. · **Focus:** security (public-repo, no-write, named fields), schema (frontmatter, `gh` flags and fields) · **Skipped:** the fresh-session load test (deferred, as for DO-1 and DO-3) · **Input source:** TL prompt + §D4.4 as amended by G18 + SA Code Review — DO-4 (including SA's five fixes). Run in the DO-4 worktree on the uncommitted changes. No `gh api` call and no other network call was made: only `gh <cmd> --help` and `gh <cmd> --json` with no field list, which fails at flag parsing and prints the field names. QA edited nothing except this section, the §0 DO-4 row and the Change History row.

### Test Coverage

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | Frontmatter parses; `name` matches folder; description triggers; size; links | Pass | js-yaml load (the main checkout's `node_modules`) from a scratch script outside the repo: keys `name`, `description`; `name = github-ops`; description 1046 chars, single line. All 16 D4.4 triggers found by substring: branch protection, ruleset, required check, a merge queue that is stuck, a check that never reports, "Auto merge is not allowed", deleting head branches, stacked PR, "did my PR land on main", secret scanning, push protection, Actions permissions, a failed workflow run, secret or variable names, PR volume, account suspension. It says "Used by the main session and by the DevOps (DO) agent", and names no owner, org, account, app, installation or ID. SKILL.md 133 lines; `read-commands.md` 28, `dashboard-settings.md` 15. Both are linked from SKILL.md and both exist |
| 2 | Every repo path and section cited exists | Pass | Backticked tokens with `/` or `.` extracted from the three files and tested with `test -e`. Exist: `.claude/agents/devops.md`, `.claude/agents/release-manager.md`, `.claude/agents/team-leader.md`, `.claude/skills/env-change-protocol/SKILL.md`, `.claude/skills/vercel-ops/SKILL.md`, `.github/ci/non-deploying-change.sh`, `.github/ci/jest-gate-scope.sh`, `.github/workflows/`, `.github/workflows/tests.yml`, `.github/workflows/plugin-tests.yml`, `vercel.json`, `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md`. The rest are globs, API paths, jq paths or branch patterns, not repo paths. `claude-harness-ops` is named as DO-5's, "not built yet". Sections: `devops.md` § Bash and `gh` (line 97), RM § Merging the PR (line 101), TL § Standing User Preferences with the "Auto-merge when CI is the only gate" row, `vercel-ops` §5 with the `gh-readonly-queue/**` line, the `vercel.json` `gh-readonly-queue/**: false` key, the `tests.yml` "SHARDS PLUS ONE VERDICT JOB" header with the `if: always()` verdict job, and the "Queue enabled … classic branch protection" row of the queue workplan. The six `pull_request` workflows other than `plugin-tests.yml` each have `merge_group` with the "Without this trigger nothing reports there" comment, no `paths:`, `contents: read`, a "No `paths:` filter on purpose" header and the in-job skip script. `plugin-tests.yml` has `paths:` and no `merge_group`. Every statement in §4 holds against the files |
| 3 | Public repo | Pass | Corpus: the three new files plus every added line of `git diff -U0` (`^+`, excluding `+++`), 532 lines across all four edited files. Finding-11 regex (SA Review, finding 11): 0 hits. Owner and repo name, and the user's and a team member's names, case-insensitive: 0. 6+ digit runs: 0. `https?://`, `www.` and TLD patterns: 0. Every workflow and job `name:` in `.github/workflows/*.yml` (18 distinct, including step names), as a fixed string: 0 hits. Read-through: no login, ID, token scope, off security setting, open alert or check-name list. The pacing incident is stated without figures |
| 4 | No restatement | Pass | Over the three new files: `Snapshot the before-state`, `\| **Read** \|`, `zero policies`, `enqueuePullRequest`, `--squash or --rebase`: 0/0/0/0/0. Extra greps for protocol labels and RM text (`never squash`, `Reversible write`, `Production or irreversible`, `How to undo`, `Before-state`, `Executed by`, `### Step`, `Classify the tier`, `Auto-merge every PR`, `git merge origin/main`): all 0. `Auto merge is not allowed` has 2 hits: the description trigger D4.4 requires, and §5's statement that `--auto` fails with that message when the setting is off. That is the GitHub fact G12 keeps; the fallback stays in RM |
| 5 | Named fields, `--limit`, banned forms | Pass, with a note | A scratch script pulled every backticked `gh …` span (61) from the three files and flagged spans with no `--json`/`--jq` and `gh pr\|run\|workflow list` spans with no `--limit`. Every concrete read command (all 19 rows of `read-commands.md` and the SKILL.md §2, §3, §5 and §6 commands) carries `--json` with named fields or `--jq` with a named selector, except the `--log-failed \| grep -n -m 40 -E …` form G18(c) allows. The flagged spans are command-family names in prose (§1 "on `gh api`", "`gh pr\|run\|repo\|workflow`"), `gh api` followed in the same sentence by "with `--jq`" (§2 repo and org rows), `gh <command> --help`, the RM facts `gh pr merge … --auto --merge` and `gh pr edit --base` (named as RM's and forbidden for DO), and prohibitions. The one count (today's PRs) carries `--limit 1000`. The `read-commands.md` lists carry `--limit 20`/`100`. Banned forms, each hit read in context: `gh ruleset list\|view` (SKILL §2 rulesets row "never used"; read-commands "Never used"), `gh workflow view` (SKILL §2 Actions "never used"; "Never used"), `--log ` (Never used only), `gh run download` (Never used), `gh variable get` (checklist "no"; Never used), `gh api graphql` (SKILL §5 "DO never calls"; Never used), `gh auth` (SKILL §7 "not on DO's allowed list"; Never used), `secret-scanning`, `dependabot/alerts`, `code-scanning/alerts`, `user`, collaborators, run logs, artifacts (Never used; SKILL §3 "never called"), actor/login/email fields (SKILL §1 never-select list; checklist), `enabledBy` (§1 never-select; read-commands "never `enabledBy`"), `value` (§2, checklist, read-commands "Never `value`"), `--org` ("never `--org <name>`"). Every hit is a prohibition. No selector names an actor, login, email, `value`, `id`, `source` or `ruleset_id` field. Note: see edge case 1 |
| 6 | Every `gh` subcommand, flag and `--json` field exists in local `gh` 2.92.0 | Pass | `--json` field lists: `pr view\|list` has `state`, `baseRefName`, `mergeCommit`, `mergedAt`, `mergeStateStatus`, `autoMergeRequest`, `number`, and every never-select name (`author`, `mergedBy`, `assignees`, `reviews`, `latestReviews`, `reviewRequests`, `comments`, `commits`, `headRepositoryOwner`). `pr checks` has `name`, `state`, `bucket`, `workflow`. `run view` has `jobs`; `run list` has `workflowName`, `event`, `status`, `conclusion`, `headSha`, `createdAt`. `workflow list` has `name`, `path`, `state`. `secret list` has `name`, `updatedAt`; `variable list` has those plus `value` (so the ban is needed). `repo view` has `owner`, `assignableUsers`, `mentionableUsers` and `viewer…` email fields, and no auto-merge or `security_and_analysis` field, as §2 says. Flags from `--help`: `pr checks --required --json --jq`; `run view --job --log-failed --log --json --jq`; `run list --event --workflow --branch --limit` (default 20); `pr list --author --search --state --limit` (default 30); `workflow list --limit` (default 50); `secret\|variable list --env --org --json`. `gh ruleset list\|view` and `gh workflow view` have no `--json`. `gh api --help` documents the `{owner}`/`{repo}` placeholders. REST paths and fields were not called (no network), so they rest on SA's code review and Dev's notes |
| 7 | `devops.md`, RM and TL diffs | Pass | `devops.md` (+8/−6): exactly G18(a). The pointer line (plus a blank line); the `gh api` line amended (named-field `--jq`, SA fix 1 "never a `value`, actor, login or email field", login lists as a count, no `secret-scanning`/`dependabot/alerts`/`code-scanning/alerts`/log/artifact/`user`/collaborators path); the secrets and variables line (`--json name,updatedAt`, `--env`, never `value`, org through `gh api orgs/{owner}/…`); the `gh pr\|run\|repo\|workflow` line (`gh ruleset list\|view` and `gh workflow view` dropped, `--json` named fields, SA fix 2 "never an actor, login or email field", `--limit`, the `--log-failed \| grep -n -m` form, never `--log`, never a `secrets.*` job). Forbidden table: `gh api graphql` (read queries included), `gh variable get`, `gh auth status` (replaces `--show-token`), `gh run download`. No write form was added to the allowed list. RM (+7/−5): the manual-gate sentence and the stacked-PR pointer in § Merging the PR, plus the four short qualifiers SA ruled inside G18(d). TL (+3/−3): the row amended to "Auto-merge when CI is the only gate". It says auto-merge only when green CI is the only remaining gate, that a PR with a demo, production-migration or check gate stays off auto-merge until the user confirms, and that diff approval before commit is unchanged. SA fix 5's example ("no demo, production-migration or check step") is present, plus the flow-line and "User approves" qualifiers. A grep of `.claude/` (worktrees excluded) for `every PR`, `as soon as it is opened`, `auto-merge every` and all `auto-merge`/`--auto` mentions: the only "every PR … as soon as it is opened" is RM line 103, which carries "unless a manual gate is open" in the same sentence. Every other auto-merge statement in RM and TL carries the qualifier or points to the qualified row. The remaining "every PR" hits are in the skills and are about checks, not auto-merge. See edge case 4 |
| 8 | Files touched; line endings; no whole-file diffs | Pass | `git status --short --untracked-files=all`: M `devops.md`, `release-manager.md`, `team-leader.md`, this requirement; untracked the three `github-ops` files. `git diff HEAD -- CLAUDE.md` empty. CRLF, read byte-wise with Node: 0 LF-only lines in the three new files and in the four edited files (`core.autocrlf=true`, index LF and working tree CRLF, the same as the base). `git diff` shows the added lines without CR because of autocrlf; the working-tree bytes are CRLF. Diff sizes are line-level: devops +8/−6, RM +7/−5, TL +3/−3, requirement +514/−4. The requirement's 4 removed lines are the §0 DO-3/DO-4 rows and the §5 DO-3/DO-4 headings, updated in place |
| 9 | Coverage of §D4.2 (a)–(i) and §D4.3 | Pass | Read-through: (a) §1–§3 + `read-commands.md`; (b) §4, all seven rules (with G17 uniqueness, G8 `needs:` and the `vercel.json` reason) and both order rules; (c) §5; (d) §6 (deletion trigger per G9); (e) §7, scoped to a batch, no number, recovery accounts per G14; (f) §8, never `git stash` with its reason; (g) §9; (h) `dashboard-settings.md`; (i) §10. The boundaries are in the pointer table. See edge case 3 |
| 10 | Fresh-session load test | Deferred | Skill files load at session start, so this needs a fresh session, as for DO-1 and DO-3. Not failed |

### Issues Found

- **Bugs:** none.
- **Edge cases (nice to fix, non-blocking):**
  1. SKILL.md §2 Actions row names `gh workflow list --json` and `gh run list|view --json` as shorthand without `--limit`. §1 states "Every list command carries `--limit`" and the exact forms in `read-commands.md` carry it, so the rule holds. Adding `--limit` to the shorthand would make the row copy-safe.
  2. SA's open optimisation still applies: the classic-protection `--jq` in `read-commands.md` iterates `.required_status_checks.checks[]` with no `// []` guard. With no required checks, jq errors and the read is recorded as "not read" rather than "none".
  3. §D4.3 names `.github/ci/jest-gate-check.mjs` and `jest-quarantine.json` as sources of truth. The skill names only the two scope scripts. Nothing in the skill depends on the other two, so this is a pointer gap, not a wrong statement.
  4. RM line 151 ("the merge itself runs through auto-merge + the merge queue") has no qualifier. It says how the merge runs, not when auto-merge goes on, so it does not contradict the TL row. Noted only.

### Final Status

- [x] All acceptance criteria pass (the load test is deferred). Ready for the user's diff review.
- [ ] Issues found

---

## SA Review — DO-5

**Reviewed by SA — 2026-10-31**
**Verdict: APPROVED WITH CHANGES.** The split, the "points back, never restates" shape, the harness source table, the hook and FU-4 reasoning, and the drift-audit result states are right. FU-3 is the right design: a user-scope server with read-only mode turns rule (a) into a database guard, and a missing server fails closed. The gaps are four:
- The FU-3 build check could not fail. A write inside the `begin read only` wrapper is rejected on any server (Q-D2-1 measured exactly that), so it proves nothing about the new server.
- The tool-list binding is by server **name** only. A server with that name and a different config resolves just as well.
- DO's Read tool has no path limit, so "never print `~/.claude.json`" needs a DO rule, not only a skill line.
- The junction procedure assumed one shared folder. There can be more than one, so the target must be read, not assumed.

Dev builds **DO-5a** with rulings Q-D5-1 to Q-D5-11 and findings H1–H10 applied. No second SA spec pass for 5a; SA checks them at code review. DO-5b gets a short BA re-check and an SA pass before its build.

SA fixed eight spec statements in place, each marked *(SA-corrected)* or *(SA-added)*: the junction procedure (now four steps), its acceptance criterion, the FU-3 build check, the `~/.claude.json` row (`claude mcp list` prints URLs; `claude mcp get` not used), F2 (some entries carry an absolute personal path), the D5-2 row (H3, H4), the FU-3 acceptance criterion (H1, H4), and a ToC line for this review.

No platform call was made for this review. The public-repo regex (finding 11) over the added lines of the diff returns zero hits. The only URLs added are public documentation pages, with no ID in them.

### Rulings on the open questions

**Q-D5-1: split. BA's suggestion accepted.**
- **DO-5a** = `claude-harness-ops`, the FU-3 procedure, the FU-4 and ClickUp decisions recorded, the D5-2(1) pointer line and the D5-3 pointer fix.
- The FU-3 `tools:` swap (D5-2(2)) goes into the 5a PR **only if** the user has added the server and the H1 probe has passed before the PR is ready. Otherwise 5a merges without it, and the swap is follow-up **FU-3b**: a one-line `devops.md` PR after the probe. 5a never waits on a user action.
- **DO-5b** = `env-drift-audit`, after 5a merges. It does not depend on FU-3b: if DO has no read-only server yet, the Supabase area reads through the plugin server under rules (a)–(d), as today.

**Q-D5-2: untrack it. SA recommends it; the user decides.**
- `git rm --cached .claude/settings.local.json` plus one `.gitignore` line, through a normal PR (Dev writes, RM commits). It goes in its own commit inside 5a, or its own small PR, so it can be reverted alone.
- **Required addition (H6):** when the untrack commit reaches another checkout through a pull or merge, git **deletes** that checkout's copy, because the file was tracked there. Before the PR merges, the user copies the file from the main checkout to a private location, and restores it after the main checkout pulls `main`. Worktrees on older branches keep their tracked copy until they merge `main`, and then lose it the same way.
- **No history rewrite.** The BA scan found nothing secret-shaped. A personal path in old commits is low-sensitivity, already public, and not an open weakness. Rewriting a public repo's history is a far larger, irreversible action.
- Until the user decides, the skill's "check the diff for the local file before every commit" rule applies.
- In this review, as in the spec, the file is described by keys and counts only.

**Q-D5-3: accepted, and widened.**
- Production tier (SA reviews, the user executes):
  - adding or widening an allow rule;
  - adding an MCP server, in any scope;
  - adding a hook;
  - changing `permissionMode` or `defaultMode`;
  - any key that turns off a prompt, a sandbox or a trust check (for example auto-approving project MCP servers). Dev confirms the current key names from the settings docs at build.
- Reversible tier: removing an allow rule, adding a deny rule, removing an MCP server the user added.
- A change to **DO's own `tools:` list**, either way, always goes to SA, and lands through a PR.
- The skill's harness tier table classifies harness changes only. It points to `env-change-protocol` §1 for what each tier means, and must not use the protocol table's own row format (the `| **Read** |` grep stays meaningful).

**Q-D5-4: build it. User scope, `execute_sql` only, fails closed. BA's suggestion accepted, with H1–H4.**
- **Scope: user scope.** Local scope is keyed by project path, and every worktree has its own path, so a local-scope server would not reach DO in a worktree. Dev does not need to measure this: user scope is the choice either way.
- **The user** adds the server and logs in with `/mcp`. The user types the project ref only into their own config, in their own terminal. The main session never runs the add command, so the ref never enters a transcript.
- **No URL in tracked text,** not even with a placeholder. The skill names the server by role, names the three settings (`read_only=true`, the project pin, a narrow feature list), and points to the Supabase MCP guide for the URL shape.
- **Feature list:** only the group that holds `execute_sql` (Dev reads the group name from the Supabase guide).
- **The swap:** in `devops.md`'s `tools:` list, the plugin server's `execute_sql` is **replaced**, never joined. Both listed at once would let DO pick the writable one.
- **Fallback:** until the H1 probe has passed, the plugin `execute_sql` stays exactly as it is. If the new server later goes missing, the name drops, DO has no SQL tool, and it reports SQL checks as "not read". Undo = revert the one `tools:` line.
- **Who verifies:** the main session, with the user, runs H1 before the swap merges. After the merge, the fresh-session tool-list smoke test (finding 11) shows that the new name resolves and the plugin `execute_sql` is gone.
- **Other projects (by role):** DO keeps no SQL tool for them after the swap. When DO needs SQL on another project, the user adds a second server, named by role, by the same procedure, and SA reviews the `tools:` change.
- Rules (a)–(d) and the wrapper stay unchanged. The skill states that read-only mode makes rule (a) enforced by the database on that server only.

**Q-D5-5: accepted.** DO's `tools:` list stays the guard for every non-SQL tool. Dev records the new server's exposed tool names in the implementation notes, by name only.

**Q-D5-6: close FU-4. BA's suggestion accepted.** This is consistent with R5 and Q-D3-1. Their reopen condition was a scoped token or a harness rule that matches an argument. Neither exists for a list-valued target, and a hook is a new pattern that fails open when the folder is not trusted. The skill states the closure and the two reopen conditions in one line.

**Q-D5-7: close ClickUp as "not needed". Accepted.** R3's reasons hold. Reopen only with a DO job that needs task status.

**Q-D5-8: accepted.** `/status`, `/permissions`, `/mcp` and `claude doctor` are main-session checks. DO lists them as "main-session checks owed". The main session reports names, counts and status from them, never a URL, header or path (H3).

**Q-D5-9: accepted, for DO-5b.** "Not read" is a separate state. A "not read" on an area that holds a Critical-class check (security features, required gates) is listed first in the summary, because it can hide a Critical finding. The 5b re-check confirms the examples.

**Q-D5-10: accepted.** This is consistent with Q-D4-4 and S8. A security-drift fix plan stays in the private docs until the fix is verified. Afterwards the tracked record may say what changed, by role, as closed history.

**Q-D5-11: accepted.** On demand only. A scheduled run would be a new pattern with an unattended session holding platform tools, so it needs its own SA review.

### Findings

H1. **[§D5.2.1(g) build check] The probe as drafted could not fail.**
- A write inside `begin read only; …; commit;` is rejected on any server. Q-D2-1 measured exactly that on the plugin server.
- **SA fixed the spec.** The probe runs without the wrapper, as a one-time exception to rule (b) made by the main session, never by DO:
  - `select current_setting('transaction_read_only')` returns `on` through the new server and `off` through the plugin server. The `off` is the control that shows the probe can fail.
  - An unwrapped `create temp table` through the new server is rejected. If it were not rejected, the temp table dies with the session and leaves nothing behind.
  - A catalog fact that only the intended project has comes back, so the server is pinned to the right project.
- The record names the project by role and the error by class.

— Priority: High

H2. **[§D5.2.1(g), F7] The `tools:` binding is by name, so it is trust-on-config.**
- `devops.md` is tracked and loads on every machine and for every collaborator. A user-scope server with the same name but without read-only mode would resolve, and DO would get a writable `execute_sql`. "Fails closed" is true only when the name is absent.
- The skill states this residual risk plainly:
  - anyone who adds a server under that name must give it the three settings;
  - H1 is re-run after any re-add or reconfigure;
  - rules (a)–(d) and the wrapper stay as the guard that does not depend on config.
- No tracked file can verify a user-scope config, so this is a stated limit, not a blocker.

— Priority: High

H3. **[§D5.2.1(a); `devops.md`] DO's Read tool has no path limit.**
- The Bash allowed list does not reach `~/.claude/settings.json` (and has no `jq`), but the Read tool can open any file, including `~/.claude.json`, which holds MCP server configs and headers.
- **Required:** the D5-2(1) pointer line also says that DO never opens `~/.claude.json` or user-scope settings, and that those reads are the main session's, by keys and counts.
- The `jq` examples in (a) are main-session commands, and the skill labels them so.
- This is the only `devops.md` addition beyond D5-2 as drafted.

— Priority: High

H4. **[§D5.2.1(g)] Stage the swap so 5a never waits on the user.** See the Q-D5-1 and Q-D5-4 rulings: replace, never join; FU-3b if the probe has not passed. D5-2 and the FU-3 criterion are amended to match. — Priority: Medium

H5. **[§D5.2.1(e) junction removal] Read the target; never assume the main checkout.**
- More than one shared `node_modules` folder exists on this machine, so step 2 as drafted could check the wrong folder and pass.
- A symbolic link is followed by recursive delete exactly like a junction.
- The drafted procedure also never checked that the link was gone before `git worktree remove`.
- **SA fixed the spec:** four steps: read `LinkType` and `Target`, stopping on any link type other than a junction; delete the link; check the link is gone and `<target>/next/package.json` exists; remove the worktree without `--force`, and never get past a refusal with `--force`, `rm -rf` or `Remove-Item -Recurse`.
- The skill does not name any shared folder or path. It says only "there can be more than one".

— Priority: High

H6. **[Q-D5-2] Untracking deletes the file in other checkouts.** See the Q-D5-2 ruling: the user backs it up first and restores it after pulling. The skill's Q-D5-2 note and the PR description both carry this. — Priority: High

H7. **[§D5.2.1(e)] Creating a worktree needs a line too.** The description fires on "a worktree to create", but (e) covers removal only. The skill says:
- How a new worktree gets its dependencies: a junction to a shared folder, made by the main session with the user. Dev states the exact command only after checking it works, as the removal procedure was.
- That a shared folder missing a dependency `main` added makes tests fail locally while CI passes (F9). It is fixed with the user, never by `npm install` in a stale checkout.
- If Dev cannot verify a creation command, the skill says "ask the user", and gives no command.

— Priority: Medium

H8. **[§D5.2.1(b)] The tracked local file is also read by the main session, not only DO.**
- The "never approve don't-ask-again for a command that embeds a secret, a token, a URL with an ID or a personal path" rule is for the main session and the user, because DO never sees a prompt.
- The skill addresses it to them, and adds: when an approval would write a personal path, choose "Yes" (once), not "don't ask again".

— Priority: Low

H9. **[§D5.4 AC] Make the new rulings checkable.** Add:
- (a) The `devops.md` diff is exactly the following, and nothing else:
  - the pointer line with the H3 clause;
  - and, only if FU-3b is folded in, one `tools:` entry replaced.
  QA counts the Supabase `execute_sql` entries in `tools:`: exactly one.
- (b) QA greps the new skill for an absolute personal path (`[A-Za-z]:\\`, `/Users/`, `/c/Users`), for `http` near the read-only server name, and for `mcp.supabase`: 0 hits, apart from a pointer to the Supabase guide.
- (c) The skill states the H2 residual risk, the H1 probe with its control, and "replace, never join".
- (d) If Q-D5-2 is decided yes: `git ls-files .claude/settings.local.json` is empty, `.gitignore` has the line, and the PR description carries the H6 backup step.
- (e) The worktree section has the creation line (H7), and no folder name or path.

— Priority: Medium

H10. **[§D5.2.2 for the 5b re-check] Three points to carry into 5b, not blocking 5a.**
- The "env var names the code reads" source should name `lib/utils/featureFlags.ts` and the repo's env example file only after Dev checks they exist.
- The Harness area's "worktrees and junctions" read is a main-session read, because DO cannot run `Get-Item` (not on the allowed list).
- "Production deployment against `main`" points to `vercel-ops`, and its SHA check to `github-ops` §6.

— Priority: Low

### Checked and honoured

- **Public-repo:**
  - The finding-11 regex over the added lines of the diff: 0 hits. A grep for absolute personal paths and 6+ digit runs: 0 hits.
  - The URLs are public Claude Code, Supabase and Vercel documentation pages, with no ID in them.
  - The spec names no project ref, connector ID, server URL, secret location or open weakness. "The tracked local file has no secret-shaped string" and "some entries carry a personal path" are counts-free facts, not values.
  - The spec tells Dev to write no URL, no ref and no folder path (tightened by H5 and the Q-D5-4 ruling).
- **No restatement:** the eight steps, tiers, record template, tool lists, forbidden commands, SQL rules (a)–(d) and every platform read stay in `env-change-protocol`, `devops.md` and the ops skills. `git stash` is a pointer to `github-ops` §8. The restatement grep in §D5.4 is kept.
- **DO stays read-only on platforms:** DO never edits any harness file. The user executes server, hook, permission and settings changes. Tracked harness files change by PR. DO's own `tools:` list changes only through SA (Q-D5-3).
- **FU-3 fails closed when the server is absent** (R2: an unresolved name is dropped), with the fallback and the stated name-binding limit (H2).
- **The junction procedure** matches the removal verified in this repo, with the target read added (H5). `git worktree remove` stays forbidden for DO. The removal is the main session's, with the user.
- **Consistency with earlier rulings:** R1 (no connector ID, plugin server named), R2 (explicit names, smoke test), R3 (ClickUp), R5 and Q-D3-1 (FU-4 reopen conditions), Q-D2-1 (the wrapper, and why the drafted probe could not fail), S8 and Q-D4-4 (open findings stay private).
- **Size and CI:** 5a is one skill of about 200 lines, two pointer lines and an optional untrack commit. Config and docs only: no app code, no CI job, no CI time.
- **CLAUDE.md** is not edited (D5-7). This is correct: the Common Gotchas `env-change-protocol` row already routes MCP, permission and hook changes.

### Follow-ups

| # | What | Owner |
|---|---|---|
| FU-3b | The `devops.md` `tools:` swap of `execute_sql` to the read-only server, if it is not in the 5a PR (H4) | Dev, after the user adds the server and the main session's H1 probe passes; SA reviews the one line |
| FU-5 | DO-5b short re-check with H10 and the Q-D5-9 note before its build | BA, then SA |
| FU-6 | Q-D5-2 decision, and the H6 backup step if yes | User; Dev and RM if yes |

FU-4 and the ClickUp tools decision are **closed** (Q-D5-6, Q-D5-7).

### Approval

[x] DO-5 spec approved with changes. **Dev builds DO-5a first:** the `claude-harness-ops` skill, the D5-2(1) pointer line with the H3 clause, and the D5-3 fix, with Q-D5-1 to Q-D5-11 and H1–H9 applied. The FU-3 swap goes in only after the H1 probe passes (otherwise FU-3b), and the Q-D5-2 untrack only if the user says yes. DO-5b starts after 5a merges, following FU-5.

---

## DO-5a implementation notes

**By Dev — 2026-10-31.** Config/docs-only slice, no separate workplan. Nothing committed. No `claude mcp` command, no platform tool and no user-scope file was used: nothing in 5a needed a live read.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/claude-harness-ops/SKILL.md` | New | Pointer table; §1 who reads what (H3); §2 where harness state lives + precedence; §3 harness tier table, who edits, before-state and probe, the tracked local file (H8, Q-D5-2 procedure with the H6 backup); §4 MCP servers; §5 hooks; §6 worktrees (four-step removal, creation line H7); §7 public-repo specifics; §8 FU-3 (user steps, H1 probe with control, replace never join, fallback, H2 limit); §9 closed decisions (FU-4, ClickUp); §10 checklist. No reference files: the spec did not need any |
| `.claude/agents/devops.md` | Edited | One pointer line to `claude-harness-ops`, with the H3 clause. `tools:` unchanged |
| `.claude/skills/github-ops/SKILL.md` | Edited | D5-3: the pointer row links `.claude/skills/claude-harness-ops/SKILL.md` and loses "(not built yet)". No `§6` stash pointer exists in `github-ops`; the stash rule is its §8, and the new skill points there |
| This requirement | Edited | §0, these notes, Change History |

### FU-3 (Q-D5-4, H1, H4)

- **The swap is not in the diff.** The user has not added the read-only server, so no H1 probe has run and no tool name could be checked in a fresh session. The plugin `execute_sql` stays in `tools:` exactly as it was. The swap is follow-up **FU-3b** (one `tools:` line, after the main session's H1 probe passes, SA reviews it).
- **No change record yet.** The record for the user's server (by role, the H1 results with the plugin-server control, the new server's exposed tool names by name for Q-D5-5) is written when FU-3b runs.
- **Feature group:** the skill names `database` as the group that holds `execute_sql`, from the Supabase MCP README's group list (account, docs, database, debugging, development, functions, storage, branching), and tells the reader to check the guide at use.

### Acceptance criteria (§D5.4 DO-5a, with H9)

| Criterion | How it is met |
|---|---|
| Frontmatter and triggers | `name: claude-harness-ops` (matches folder) + single-line `description`, same format as `github-ops`. Fires on settings files, permissions or allow rules, "don't ask again", MCP server, hook, subagent tools list, creating or removing a worktree, `node_modules` missing or broken, the tracked local settings file. Says "used by the main session and by the DevOps (DO) agent". No server ID or ref |
| (a)–(h) covered, pointers not restatements | (a) §1–§2; (b) §3; (c) §4; (d) §5; (e) §6; (f) §7; (g) §8; (h) §9. Restatement grep (`Snapshot the before-state`, `\| **Read** \|`, `zero policies`): 0 hits. The tier table uses a `Harness change \| Tier` layout, not the protocol's row format, and points to `env-change-protocol` §1 for what a tier means |
| Junction procedure | §6: the four SA-corrected steps in order, the `cmd /c rmdir` warning, the `git archive` baseline rule. `git stash` appears twice, both pointers to `github-ops` §8 |
| `~/.claude.json` never printed; keys and counts | §1 and §2 |
| FU-3 | Notes above: swap not in the diff, FU-3b named |
| `devops.md` only as D5-2 (H9 a) | The diff is the one pointer line with the H3 clause. Supabase `execute_sql` entries in `tools:`: exactly one (the plugin one) |
| H9 (b) | Grep of the new skill for the H9 (b) personal-path patterns, the Supabase MCP hostname and the worktree folder: 0 hits. `http` appears once, the Supabase guide link in the pointer table, not near the server name |
| H9 (c) | §8: the H2 limit, the H1 probe with the `off` control, "replaced, never joined" |
| H9 (d) | Not applicable: Q-D5-2 not decided. `.claude/settings.local.json` and `.gitignore` untouched |
| H9 (e) | §6 has the creation line; no folder name or path |
| Finding-11 regex | Over the added lines of the diff and over the new skill folder: 0 hits |
| Files touched | The three 5a files in D5.3 plus this requirement. CLAUDE.md unchanged |

### Deviations for SA

1. **H7 creation command.** I did not run a junction creation (no worktree or link is created in this slice). The skill gives `New-Item -ItemType Junction -Path '<wt>/node_modules' -Target '<shared>'` because two workplans in this repo record it working where `mklink /J` from Git Bash mis-quoted its target, and it is Microsoft's documented form. The shared folder and how the worktree itself is created are "ask the user", with no command. If SA reads H7 as "only a command Dev ran", replace that sentence with "ask the user".
2. **Q-D5-3 key names.** The prompt- and trust-relaxing examples (`enableAllProjectMcpServers`, `enabledMcpjsonServers`, `sandbox.enabled`, `sandbox.autoAllowBashIfSandboxed`, `disableBypassPermissionsMode`, `permissions.defaultMode`) were checked against the Claude Code settings documentation pages found by search, not by loading the current settings page directly. The skill tells the reader to confirm the names in the settings docs at use.
3. **Claude Code doc pages are named, not linked.** To keep `http` to the one Supabase guide pointer (H9 b), the skill names the settings, permissions, mcp, hooks and sub-agents pages instead of linking them.

---

## SA Code Review — DO-5a

**Code Review by SA — 2026-10-31**
**Status:** ✅ Code Approved. SA made three small fixes directly; they are listed below.

Reviewed in the DO-5a worktree against the DO-5 Specification §D5.2.1 (a)–(h), the §D5.4 criteria for 5a, SA Review — DO-5 (Q-D5-1 to Q-D5-11, H1–H9) and the DO-5a implementation notes. No platform call, no `claude mcp` command and no web fetch. No user-scope file and no `.claude/settings.local.json` entry was opened. The tracked settings files were read by key name and count only.

### Rulings on Dev's flagged deviations

1. **H7 creation command: kept.** H7 asked for a command "only after checking it works, as the removal procedure was". The removal procedure was itself verified from this repo's records, not re-run for the spec. The creation command meets the same standard: two workplans (credit deduction slice 7, upgrade modal UM-2) record `New-Item -ItemType Junction` working, and UM-2 records `mklink` producing a malformed target first. The skill still says "ask the user" for how the worktree is made and which shared folder it links to, and it adds the `LinkType` and `next/package.json` check after the link is made. One wording fix: the records show `mklink` failing once, not twice (fix 3).
2. **Q-D5-3 key names: dropped.** No file in the repo outside this requirement and the new skill names any of the six keys. The tracked `.claude/settings.json` and `.claude/settings.local.json` hold only `permissions.allow`, so they confirm none of them. A search-result check is not the settings page, so the names cannot be stated as fact. SA replaced the two rows with descriptions (fix 1): "the default permission mode in a settings file", and "auto-approving project MCP servers, turning the sandbox off, approving Bash automatically inside the sandbox, or lifting a block on bypass-permissions mode", plus "This skill names no key for these; read the current key name from the settings docs before writing it into a plan". `permissionMode` stays: it is a subagent frontmatter field from BA's F7 research, already in the approved spec table (a), and not one of the six.
3. **Doc pages named, not linked: accepted.** The pointer table names the five pages and tells the reader to check a key there at use. That keeps `http` to the one Supabase guide link, as H9(b) wants.

### Code Review Comments

1. Pointers, not restatement — §3 points to `env-change-protocol` §1 for what a tier means and uses a `Harness change \| Tier` layout. `git stash` appears only as a pointer to `github-ops` §8 (which exists: "Git hazards in a shared repo"). SQL rules (a)–(d) and the wrapper point to `devops.md` and `supabase-ops`. The restatement grep (`Snapshot the before-state`, `| **Read** |`, `zero policies`): 0 hits. — Pass
2. (a)–(h) coverage — (a) §1–§2, with H3 in §1 and the `~/.claude.json` row as SA-corrected (`claude mcp list` prints URLs; `claude mcp get` not used); (b) §3 with H8 and the Q-D5-2 procedure carrying the H6 backup; (c) §4; (d) §5; (e) §6; (f) §7; (g) §8; (h) §9 with both reopen conditions. — Pass
3. §2 user-settings row and §1 — gave `jq 'keys'` and `jq '.permissions.allow | length'`. `jq` is not installed on this machine (Git Bash `which jq` finds nothing), so the main session could not follow the step. **SA fixed** (fix 2) with two `node -p` reads; both forms were run against the tracked `.claude/settings.json` and returned the key list and a count. — Priority: Medium (fixed)
4. §3 tier table — the six unverified key names. **SA fixed** (fix 1). — Priority: High (fixed)
5. §6 junction removal — the four steps match the SA-corrected spec in substance and order: read `LinkType` and `Target`, stop on any non-empty, non-`Junction` type; `$j.Delete()` only for a junction; `Test-Path` is `False` and `<target>/next/package.json` exists; `git worktree remove` without `--force`. Step 4 is stricter than the spec ("never … to get past a refusal", without the "while any link may remain" qualifier), which is the safer reading. "There can be more than one shared folder" is stated, with no folder named. The `cmd /c rmdir` warning and the `git archive` baseline rule are there. — Pass
6. §8 FU-3 — matches H1 (unwrapped probe by the main session, never DO; `on` through the new server, `off` through the plugin server as the control; unwrapped `create temp table` rejected; a catalog fact for the pinning; record by role and error class), H2 (binding by name only, all three settings for anyone using the name, H1 re-run after a re-add or reconfigure, no tracked file can verify a user-scope config) and H4 (replace, never join; only after the probe; plugin `execute_sql` stays until then; undo is one line). User scope only, no URL, ref typed by the user in their own terminal. — Pass
7. `devops.md` — the diff is +2/−0: the pointer line with the H3 clause and its blank line. `tools:` is unchanged, with exactly one Supabase `execute_sql` (the plugin one). H9(a) holds. — Pass
8. `github-ops` — one row, 1/1: "(not built yet)" removed and the file linked. — Pass
9. Frontmatter — `name: claude-harness-ops` matches the folder; `description` is a single line in the `github-ops` format, fires on every trigger in the spec, names the main session and DO, and has no ID or ref. — Pass
10. Public-repo — the two path-pattern hits in the added lines are BA and SA text, not the skill. F9 names `.claude/worktrees/`, the repo-relative folder already listed in the tracked `.gitignore`: no worktree name and no absolute path. H9(b) quotes the grep patterns themselves (`[A-Za-z]:\\`, `/Users/`, `/c/Users`, `mcp.supabase`), not a path. Neither leaks anything. — Pass
11. Line endings — the new SKILL.md is LF in the working copy. Every sibling `SKILL.md`, `devops.md` and this requirement are LF in the index and CRLF in the working copy, with `core.autocrlf=true` and no `.gitattributes` rule for `.md`. Git stores the new file as LF on commit, the same as its siblings, so the difference is cosmetic and does not matter. The edited files kept CRLF. — Pass

### Fixes made by SA

1. SKILL.md §3: the two tier rows that named `permissions.defaultMode`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `sandbox.enabled`, `sandbox.autoAllowBashIfSandboxed` and `disableBypassPermissionsMode` now describe the setting, and tell the reader to read the key name from the settings docs before writing it into a plan.
2. SKILL.md §2 and §1: the `jq` reads replaced with `node -p` key and count reads of the user settings file. §1 now refers to "the user-settings key and count reads in §2".
3. SKILL.md §6: "`mklink /J` from Git Bash twice mis-quoted its target" now reads "mis-quoted its target".

### Optimisation Suggestions

- §2 "On Windows the local settings file sits next to…" — the qualifier adds nothing, since the rule holds on any OS. Not blocking.
- When FU-3b runs, the change record should also record the new server's exposed tool names (Q-D5-5), as the implementation notes already say.

### Code Approved for QA: Yes

---

## QA Report — DO-5a

**QA — 2026-10-31**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path and heading existence, byte-level line-ending read, read-through), plus two local read-only runs: the SA `node -p` forms against the tracked settings file, and a `Get-Item` property read on existing `node_modules` folders. This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public-repo, user-scope boundary, junction safety), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1, DO-3 and DO-4) · **Input source:** TL prompt + §D5.4 (DO-5a) as amended by SA Review — DO-5 (H1–H9) + SA Code Review — DO-5a. Run in the DO-5a worktree on the uncommitted changes. No platform call, no `claude mcp` command, no network call. No user-scope file was opened. No `.claude/settings.local.json` entry was read. No worktree or junction was created or removed. QA edited nothing except this section, the §0 DO-5 row and the Change History row.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Public repo (finding-11 regex, personal paths, `mcp.supabase`, worktree names, URLs) | Pass | **Corpus:** the new SKILL.md, plus every added line of `git diff -U0` with the new file `git add -N`'d and then `git reset` (643 lines across the four files). **Finding-11 regex:** 0 hits in the skill, 0 in the added lines. **In the skill:** drive-letter backslash, `C:\Users`, `/Users/`, `/c/Users`, `mcp\.supabase`, the worktree folder name, `worktrees/`, query strings (`?x=`), `www.`, 6+ digit runs and the user's, a team member's and the org name are all 0. `https?://` has 1 hit: the Supabase MCP guide link in the pointer table, which H9(b) allows. **In the added lines:** `/Users/` 2, `/c/Users` 2, `mcp.supabase` 2, `worktrees/` 2, all in BA and SA text. H9(b) quotes the grep patterns themselves. F9 and the SA code review name the gitignored, repo-relative `.claude/worktrees/`. None of these is a path or a leak. The other added `https://` hits are public docs pages in the BA findings table (code.claude.com docs, the Supabase guide, the Supabase MCP repo, two Vercel docs and changelog pages). None carries a query string, ID or ref |
| 2 | Cited paths and sections exist | Pass | `test -e` OK for `.claude/skills/env-change-protocol/SKILL.md`, `.claude/agents/devops.md`, `.claude/skills/github-ops/SKILL.md`, `.claude/skills/supabase-ops/SKILL.md`, `.claude/settings.json`, `.claude/settings.local.json`, `.gitignore` and `.claude/agents/`. `.mcp.json` is absent, as the skill says. **Sections:** `env-change-protocol` §1 "Classify the tier first"; `github-ops` §8 "Git hazards in a shared repo"; `devops.md` "### Supabase (plugin server only)" with rules (a)–(d) and the wrapper; "What you may write" (a bold run-in label at line 70, not a heading); `git worktree list` on the allowed list; `git worktree remove` on the forbidden list. `.gitignore` lists `.claude/worktrees/`. The DO-1 tool-list smoke test is in the DO-1 criteria |
| 3 | Frontmatter | Pass | js-yaml (the main checkout's `node_modules`) from a scratch script: keys `name`, `description`; `name = claude-harness-ops`, matching the folder; description 894 chars on one line. Every §D5.4 trigger is present: settings file, permission or allow rule, "don't ask again", MCP server, hook, subagent's tools list, creating or removing a worktree, `node_modules` missing or broken, tracked `.claude/settings.local.json`. It says "Used by the main session and by the DevOps (DO) agent" and names no server ID or ref |
| 4 | No restatement | Pass | `Snapshot the before-state`, `\| **Read** \|`, `zero policies`: 0/0/0. Extra greps: `Classify the tier`, `### Step`, `How to undo`, `Executed by`, `begin read only;`, `git commit\|push`, `enqueuePullRequest` are all 0. `SELECT-only` has 1 hit, §8's "rule (a) (SELECT-only)": a reference, not the rule table. `git stash` has 2 hits, both pointers to `github-ops` §8. Tiers point to `env-change-protocol` §1, the tool list and Bash forms to `devops.md`, and SQL rules to `devops.md` and `supabase-ops` |
| 5 | `devops.md` | Pass | `git diff -U0`: one added line (the pointer with the H3 clause, "You never open `~/.claude.json` or any user-scope settings file, with Read or any other tool…") and one blank line, and nothing removed. No `tools:` line in the diff. `execute_sql` appears exactly once in `tools:`, as `mcp__plugin_supabase_supabase__execute_sql` (the plugin one) |
| 6 | Junction removal | Pass | §6 has the four steps in order. (1) `$j = Get-Item …; $j.LinkType; $j.Target`, stopping on any non-empty, non-`Junction` type, with the symbolic-link reason. (2) `$j.Delete()`, guarded by `-eq 'Junction'`. (3) `Test-Path` is `False`, and `<target>/next/package.json` exists, where `<target>` is the folder from step 1. (4) `git worktree remove` without `--force`, and never `--force`, `rm -rf` or `Remove-Item -Recurse` to get past a refusal. `--force` has 3 hits: the hazard statement, the step-4 prohibition and the checklist; none is a suggestion. "There can be more than one shared folder"; no folder is named. The `cmd /c rmdir` warning and the `git archive` baseline rule are both present. **Property check:** this worktree has no `node_modules`, so `Get-Item` found nothing there. A read-only `Get-Item` on the main checkout (a real folder: LinkType empty, the `Target` property and the `Delete()` method exist) and on the two sibling worktrees that have one (LinkType `Junction`, Target set) confirms the names the skill uses. No target path was printed |
| 7 | `node -p` reads | Pass | §2 user-settings row: "Main session only: keys and counts". §1 lists "the user-settings key and count reads in §2" under main-session checks and says DO never opens user-scope settings, so the reads are not DO's. Both forms, with the require path swapped to `path.resolve('.claude/settings.json')` (the tracked file), ran cleanly: `Object.keys(...)` → `[ 'permissions' ]`; `(…permissions?.allow ?? []).length` → `1`. The home-directory file was not read |
| 8 | FU-3 section | Pass | §8 (lines 115–141): 0 hits for `https?:`, `www.`, `.com`, `<url>` and `example.`. The URL shape is left to the Supabase guide. **H1:** an unwrapped probe "made by the main session, never by DO"; `on` through the new server and `off` through the plugin server, "the control that shows the probe can fail"; an unwrapped `create temp table` rejected; a catalog fact for the pinning; the record by role and error class. **H2:** "the binding is by name only, so it trusts the config"; a same-name server without read-only mode gives DO a writable `execute_sql`; all three settings are required; H1 is re-run after any re-add or reconfigure; no tracked file can verify the config. **H4:** "**replaced** … never joined", only after the H1 probe passed, one line through a PR with SA review, the plugin `execute_sql` stays until then, undo is one line. §9: FU-4 is "closed, not built" and ClickUp is "closed as not needed", each with a reopen condition |
| 9 | Line endings | Pass | `git diff --numstat` is the same with and without `--ignore-cr-at-eol`: devops 2/0, github-ops 1/1, requirement 481/4. No whole-file churn. A byte read with Node shows 0 LF-only lines in the three edited files (index LF, working tree CRLF, `core.autocrlf=true`, the same as the base). The new SKILL.md is LF in the working copy; SA ruled this cosmetic, since Git stores it as LF like its siblings. The requirement's 4 removed lines are the §0 DO-4/DO-5 rows and the §5 DO-4/DO-5 headings, updated in place |
| 10 | `settings.local.json`, `.gitignore`, `CLAUDE.md` unchanged; files touched | Pass | `git diff --quiet HEAD` on the three files succeeds. `git status --short --untracked-files=all` shows only the four D5.3 files for 5a. `.claude/settings.local.json` is still tracked, as expected while Q-D5-2 awaits the user. The H9(d) check does not apply yet |
| 11 | Fresh-session load test | Deferred | Skills load at session start, as for DO-1, DO-3 and DO-4. Not failed |

### Issues Found

- **Blocking:** none.
- **Non-blocking (edge cases, nice to fix):**
  1. §6 removal has no branch for a worktree whose `node_modules` is **missing** or is a **real folder** (LinkType empty). For a missing one (this worktree is one), step 1 reads nothing and step 3's `<target>/next/package.json` cannot be checked. For a real folder, step 3's `Test-Path` stays `True`. Both fail safe, because the reader stops before step 4, but the skill does not say what to do next. Suggest one line: "If `node_modules` is absent, skip to step 4; if it is a real folder, stop and ask the user."
  2. The pointer "`devops.md` § What you may write" targets a bold run-in label (line 70), not a heading, so it cannot be found by heading search. It can be found by text search. Noted only.
  3. SA's open optimisation stands: the "On Windows" qualifier in §2 adds nothing.

### Final Status

- [x] All acceptance criteria pass (the load test is deferred). Ready for the user's diff review.
- [ ] Issues found

---

## SA Review — DO-5b (short pass)

**Reviewed by SA — 2026-10-31 (FU-5)**
**Verdict: APPROVED WITH CHANGES.** The BA re-check carries H10, the Q-D5-9 note and the H3 boundary correctly, and the check table (g) is the right shape: sources and pointers only, a fixed class per check, and a named reader for each. Two of the proposals would not have worked as drafted. The `.env.example` command matches nothing, so V-2 would have found no names and could not fail. The `main` ref is stale in practice, so most repo-sourced checks would have read old files. SA corrected both in place, plus five smaller row issues.

Reviewed against SA Review — DO-5 (H3, H10, the Q-D5-9 ruling, and the Q-D5-1 ruling that 5b does not wait for FU-3b), the merged `claude-harness-ops` skill, SA Code Review — DO-5a, QA Report — DO-5a, `devops.md`, `env-change-protocol`, and the `supabase-ops`, `vercel-ops` and `github-ops` skills with their reference files. No platform call and no `claude mcp` command were made. No user-scope file was opened. Local reads only: `git` refs and counts, and the names-only test on `.env.example`, reported here as counts.

### Rulings on Q-D5b-1 to Q-D5b-4

**Q-D5b-1: accepted.** DO writes no full report outside the untracked private docs: no tracked file and no scratch file. The chat summary says "full report not written: private docs not reachable". This follows from `devops.md` § What you may write and the Q-D5-10 ruling. The main session re-runs the audit with the location in the brief.

**Q-D5b-2: a names-only read is compatible with the rule, but it is a main-session read, and the drafted command is wrong.**
- **Compatible:** the Secret-exposure row forbids printing the file and its values. A command whose output can only be `NAME=` prints neither. `devops.md` stays unchanged.
- **DO has no such form today.** The Grep tool's content mode prints the whole matching line, and that line includes the value. Dev confirms at build whether the Grep tool has an only-matching option; if it does, SA revisits this ruling. A Bash `grep` on a repo file is not on DO's allowed list, because the only allowed `grep` is the `gh` log pipe. Adding it would change the allowed list, which D5-6 rules out.
- **The drafted pattern matches nothing.** `grep -o '^[A-Z0-9_]+='` is a basic regex, in which `+` is a literal character. On the real file it returns **0** lines. A silent zero means "no names", so V-2 could never fail. The extended form, `grep -oE '^[A-Z0-9_]+='`, returns **4** lines. Each one is exactly a `NAME=` shape (0 that differ), and the longest output is the name plus `=`.
- **Guard:** a multi-line value whose continuation line starts with capitals, digits or `_` and then `=` would leak a fragment. So the main session first counts the lines that are neither an assignment, a comment nor blank: `grep -vcE '^[A-Z0-9_]+=|^[[:space:]]*(#|$)' .env.example`, which prints only a number. Today that count is **0**, the file has no quoted values, and it has no commented-out assignments. If the count is not 0, the main session stops and V-2's `.env.example` source is "not read".
- **So:** in DO's run, V-2 uses `lib/utils/featureFlags.ts`, read at `origin/main`. It is code, so it may be read in full. The `.env.example` names are a **main-session check owed**: the guard count, then the `-E` command, then a `git diff --stat origin/main -- .env.example` (stat only). Never Read, `cat` or `git show` of the file, by anyone.
- **Stated limit:** the two sources hold far fewer names than the code reads. `featureFlags.ts` has 13 distinct `process.env` names and `.env.example` has 4, while `lib/`, `app/` and `components/` read about 120. V-2 checks the names those two sources hold, and the full report says it is not a completeness check. Widening the name source is a separate item, not 5b.

**Q-D5b-3: accepted, with the row corrections below (findings 3–7).** The classes stand as drafted. CH-3 is Medium, V-3 is High (Medium only when the gap is shown to be docs-only), and S-4 and the V-5 protection setting are user steps that are usually "not read" and listed first. No class was lowered and no check was dropped.

**Q-D5b-4: the read exists and answers the question, but on the wrong ref.**
- `github-ops` §6 step 2 (`compare/main...<sha>` with `--jq .status`) exists. It answers "is `<sha>` the same as GitHub's `main`" exactly. `identical` means current. `behind` means an older commit of `main`, so it is stale. `ahead`, `diverged` or a 404 means "not verified". The staleness test counts **only `identical`** as current. §6 counts `behind` as "landed", which answers a different question, and the skill says so in one line.
- **Local `main` is the wrong ref.** Measured in this worktree: local `main` is 356 commits behind `origin/main`, and the branch is ahead of it. Nothing in this repo updates local `main`, so "read on `main`" would read very old files. Reading `.env.example` at local `main` already differs from the branch. The ref is **`origin/main`**: the remote-tracking ref every worktree shares, updated by any session's fetch. `git show origin/main:<path>` and `git log -1 origin/main` are on DO's allowed list.
- The brief from the main session should follow a fresh `git fetch`, or the run is mostly "not read (`origin/main` stale)". The skill says this in one line, aimed at the main session.

### Findings

1. **[Q-D5b-2, V-2, §D5.2.2(a)] The `.env.example` read: the pattern needs `-E`, and DO has no names-only form.** See the ruling. *(SA-corrected:)* the (a) row, the V-2 "Who reads" cell, and one new criterion (the skill has no BRE `grep -o '` form). — Priority: High (fixed in spec)
2. **[Q-D5b-4, §D5.2.2(a)] `origin/main`, not local `main`; only `identical` is current.** *(SA-corrected:)* the "read as they are on `main`" paragraph, and one new criterion. — Priority: High (fixed in spec)
3. **[CH-3, §D5.2.2(a)] The untrack has landed.** `origin/main` as last fetched has the `.gitignore` line, and the local settings file is not in its tree. So "before the untrack lands: not applicable" no longer applies, and §0 said "pending merge". CH-3 also does not need the main session: `git show origin/main:.claude/` lists the tree's entry names with no content, and it is on the allowed list. *(SA-corrected:)* the CH-3 row moves to DO, with "never `git show` of the local file itself". The (a) row is noted, the H3 criterion is amended, and the §0 row is updated (RM confirms the PR state; SA made no platform call). — Priority: Medium (fixed in spec)
4. **[V-4] The crons are compared against what production was built from.** `vercel-ops` §6 says to compare the repo file with what production was built from, not with `main`. Against `main`, every V-3 gap would be counted a second time as V-4 drift. *(SA-corrected:)* `vercel.json` at the production deployment's SHA. — Priority: Medium (fixed in spec)
5. **[V-3] "Docs-only gap" needs platform evidence.** DO cannot run `.github/ci/non-deploying-change.sh`, and judging docs-only from file names is the interpretation `vercel-ops` §5 rules out. *(SA-corrected:)* Medium only when each later commit has a CANCELED deployment whose build events show the `SKIP:` line. — Priority: Medium (fixed in spec)
6. **[G-2, G-4, G-5] Critical-class checks need a reader when DO's read is refused.** The protection, `security_and_analysis` and Actions-permissions reads need admin rights (`github-ops` §2 and `read-commands.md`). An error is "not read", and these three are Critical-class. *(SA-corrected:)* "Who reads" is "DO; user if DO's read is refused", pointing to the `github-ops` `dashboard-settings.md` areas, which exist for all three. — Priority: Medium (fixed in spec)
7. **[S-1, S-3] Bound S-1, and stop DO from judging RLS intent.** "Every migration on `main`" means re-proving the whole history in every run, and most older files have no checker. *(SA-corrected:)* S-1 covers the migrations after the last one the private inventory records as verified. One with no checker and no named objects is "not read (no checker)", never "applied". *(SA-added)* note for S-3: a table without RLS is drift unless the private inventory records it as intended. — Priority: Medium (fixed in spec)
8. **[CH-1] "No write tool" is ambiguous.** Write, Edit and Bash are on the `tools:` line by design. *(SA-corrected:)* "no **platform** write tool". — Priority: Low (fixed in spec)
9. **[CH-6] `git worktree list` prints absolute paths.** *(SA-added)* note: report counts only, never a worktree name or path (`claude-harness-ops` §7). — Priority: Low (fixed in spec)
10. **[(e) chat summary] A Critical count is a weakness signal.** *(SA-added)*: the chat summary is never pasted into tracked text (`github-ops` §9). — Priority: Low (fixed in spec)

**Required of Dev at build:** apply the table as corrected; confirm the Grep tool has no only-matching option (finding 1); give the `-E` command and the guard count only as a main-session check, not as a DO step. Nothing else is pending: every finding is fixed in the spec.

### Checked and honoured

- **Every pointer resolves to the read it claims.**
  - `github-ops`: §2 Repo settings, Branch protection and rulesets, What to report, Required checks, Actions, and Secrets and variables; §3; §4 (the seven rules); §6 step 2; `read-commands.md`; `dashboard-settings.md`.
  - `vercel-ops`: §1; §3 Projects, Env vars, Deployments and Domains; §4 step 5 (aliases); §5 (CANCELED and `SKIP:`); §6 (crons and enabled state); `dashboard-settings.md` (Deployment Protection).
  - `supabase-ops`: §2 Advisors, Where advisor results go, Migration drift, Catalog evidence (`relrowsecurity` / `relforcerowsecurity`, `has_table_privilege`), Extensions, functions, branches, and What the tools cannot read (auth, backups).
  - `claude-harness-ops`: §1, §2, §3, §4 (smoke test, `.mcp.json`), §6, §7 and §8.
  - `lib/utils/featureFlags.ts`, `.env.example`, `supabase/functions/` and `supabase/config.toml` exist.
- **Every Critical-class check has a reader:**
  - G-1, S-2, S-3, CH-1, CH-2 and CH-4: DO.
  - G-2, G-4 and G-5: DO, or the user when refused (finding 6).
  - V-5: DO for domains, the user for protection.
  - S-4: the user.
  - CH-5: the main session.
- **H3:** no check makes DO open `~/.claude.json`, user or managed settings, or a junction. CH-1 is DO's own loaded tool list, not a file. CH-5 and the CH-6 junctions are main-session checks, and now so are the `.env.example` names. The H3 criterion's grep (`node -p`, `Get-Item`, `claude mcp`, `jq`) stays.
- **H10:** both name sources are named, and they exist. Junctions are the main session's. Production against `main` points to `vercel-ops` and `github-ops` §6.
- **Q-D5-9:** the classes are fixed per check, and a finding may be rated lower, never higher. Critical-class "not read" checks are listed first by ID, and drift is counted, never named, in chat.
- **Q-D5-1:** no dependency on FU-3b. Supabase reads go through the plugin `execute_sql` under rules (a)–(d) and the wrapper, and the same rules apply after FU-3b.
- **No restatement:** the table holds pointers only. The criterion's restatement grep stays.
- **DO-5a consistency:** "not read" is never "no drift", main-session checks owed are listed, and DO edits no harness file.
- **Size: it fits, so no reference file is needed.** Frontmatter and the pointer table take about 15 lines, (a)–(f) about 55, the table with its header 24, the notes about 6 and the checklist about 12: about 115–140 lines. D5-5 stays "SKILL.md only". If the draft runs past about 160 lines, Dev trims prose in (a)–(f), never table rows, and asks SA before adding a reference file.
- **`devops.md`:** exactly the one D5-6 pointer line. `tools:` and the allowed list are unchanged, and nothing in these rulings needs a change to either.
- **Public repo:** the finding-11 regex over the added lines of `git diff`: **0** hits. The figures given (356 commits, 0/4 matches, 13, 4 and about 120 names) are counts, not IDs or values. No `.env.example` line, name or value was printed.

### Approval

[x] DO-5b spec approved with changes. **Dev may build** D5-5 (`.claude/skills/env-drift-audit/SKILL.md`) and D5-6 (the one `devops.md` pointer line), using §D5.2.2 and the §D5.4 criteria as corrected here, with findings 1–10 applied. SA does a code review, then QA.

---

## DO-5b implementation notes

**By Dev — 2026-10-31.** Config/docs-only slice, no separate workplan. Nothing committed. No platform tool, no `claude mcp` command and no user-scope file was used. `.env.example` was not opened, printed or grepped: only its existence at `origin/main` was checked (`git cat-file -e`). Local `git` reads only: `origin/main` head, tree entry names and counts.

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/env-drift-audit/SKILL.md` | New (141 lines) | Pointer table; §1 when it runs (f); §2 the three expected-state sources (a), the private-inventory rule, `origin/main` and the staleness test; §3 live areas as pointers (b); §4 comparison rules and the "not read" reasons (c); §5 severity (d); §6 output, the unreachable-docs case and the five-part summary (e); §7 the 22-check table (g) with the SA notes and the main-session `.env.example` procedure; §8 checklist. No reference file |
| `.claude/agents/devops.md` | Edited (+1/−0) | One indented line under job 2: drift reports follow `env-drift-audit`. `tools:`, the allowed list, the forbidden list and the Secret-exposure row unchanged |
| This requirement | Edited | §0 DO-5 row (DO-5b built; PR #593 merged), these notes, Change History |

### Acceptance criteria (§D5.4 DO-5b, as amended by SA Review — DO-5b)

| Criterion | How it is met |
|---|---|
| Frontmatter and triggers | `name: env-drift-audit` (matches the folder), single-line `description` in the `github-ops` format. Fires on "drift", "audit the environments", "is everything configured as expected", "what is out of sync". Names DO and the main session; no ID |
| Sources, areas, states, severity, output | §2 (three sources and what each holds), §3 (four areas, pointers only), §4 (no drift / drift / not read), §5 (four levels, fixed class, rate lower never higher), §6 (full report in the untracked private docs only) |
| No restated procedure | Grep of the skill: `--jq`, `filter_project_envs`, `begin read only` 0/0/0. SQL points to `devops.md` rules (a)–(d) |
| Check table (g) | §7, all 22 rows, none merged or dropped, no class lowered. Each row has its source, a pointer by skill and section, its class and its reader. Every SA correction applied: G-2/G-4/G-5 "user if refused", V-2 split reader, V-3 Medium only with the CANCELED and `SKIP:` evidence, V-4 at the production deployment's SHA, S-1 bounded plus "not read (no checker)", S-3 intent note, CH-1 "platform write tool", CH-3 DO's, CH-6 counts only. No row holds a value, project, folder or path |
| "Not read" reasons; Critical-class first | §4 lists the reasons: no access, error, retention passed, expected state missing, `origin/main` stale, no checker, main-session check owed. §6 part 1 lists Critical-class "not read" checks first, by ID |
| Private inventory | §2: IDs, secret locations and security settings come only from it; its location comes from the brief and is not named; not reachable means "not read (expected state missing)", never "no drift" |
| Report split | §6: full report in the private docs only; "full report not written: private docs not reachable" (Q-D5b-1); five-part counts-only summary; never pasted into tracked text |
| H3 | CH-5, the CH-6 junctions and the V-2 `.env.example` names are main-session checks owed. Grep: `node -p`, `Get-Item`, `claude mcp`, `jq` 0/0/0/0. `.claude.json` appears once, in the "DO never opens" sentence of §3 |
| No restatement | `Snapshot the before-state`, `\| **Read** \|`, `gh api`, `list_deployments`, `get_advisors`: 0/0/0/0/0 |
| Local settings file | `settings.local.json`: 1 hit, the CH-3 row |
| `devops.md` | `git diff --numstat`: 1/0, the one pointer line |
| On demand only, size | §1 "On demand only" and "No schedule". 141 lines |
| `origin/main` (SA-added) | Every `main:` hit in the skill is `origin/main:` (2 hits). §2 states the main session fetches before the brief, and only `identical` counts as current |
| `.env.example` (SA-added) | §7: main-session check owed, guard count first, then `grep -oE`, then the stat-only diff. `grep -o '` (BRE): 0 hits |
| Public repo | See the grep counts below |

### Cited sections checked

`github-ops` §2 (Repo settings, Branch protection and rulesets, What to report, Required checks, Actions, Secrets and variables), §3, §4, §6 step 2, §9, `read-commands.md`, `dashboard-settings.md`; `vercel-ops` §1, §3 (Projects, Env vars, Deployments, Domains), §4 step 5, §5, §6, `dashboard-settings.md`; `supabase-ops` §2 (Advisors, Where advisor results go, Migration drift, Catalog evidence, Extensions, functions, branches, What the tools cannot read); `claude-harness-ops` §1, §2, §3, §4, §6, §7, §8; `devops.md` rules (a)–(d), § What you may write, § Report Format. All exist and hold the read cited. At `origin/main`: `lib/utils/featureFlags.ts` and `.env.example` exist; the `.claude/` tree lists no local settings file; `.gitignore` has the ignore line.

### Grep tool only-matching question (finding 1)

This Dev session's own tool schema has **no Grep tool** (it holds Read, Write, Edit, Bash, Glob and web search), so the parameters could not be read from a schema. From Claude Code's Grep tool as Dev knows it (output modes for content, matching files and counts, plus context and line-number options), there is no only-matching mode; that is recall, not a schema read. The content mode prints the whole line. The ruling stands as written; only SA can change it. The skill says DO never reads `.env.example` by any tool.

### Deviations for SA

1. **Git Bash rewrites `origin/main:<path>` when the path starts with `.`.** Measured here: `git show origin/main:.claude/`, `origin/main:.gitignore` and `origin/main:.github/workflows/` each fail with "unknown revision", because Git Bash turns the argument into a Windows path list. A path not starting with `.` (`lib/…`, `vercel.json`, `supabase/…`) works. With `MSYS_NO_PATHCONV=1` before the command, `.claude/` lists the tree's entry names. This touches CH-3's live read as SA wrote it and the repo source of G-1, G-6, CH-2 and CH-4. It fails loudly, so it cannot produce a false "no drift". The skill says this error is "not read (error)", never "absent". It does **not** add the `MSYS_NO_PATHCONV=1` prefix, because whether that prefix is an allowed form under `devops.md` is SA's call. If it is not ruled in, those checks will usually be "not read (error)" in a DO run from Git Bash.
2. **Fix-plan row.** The skill points to "Q-D5-10 in the DevOps requirement" for the rule that a security fix plan stays private, the same way `claude-harness-ops` points to Q-D5-2, because `env-change-protocol` does not hold that rule.
3. **Line endings.** The new SKILL.md was written LF in the working copy, as in DO-5a (SA ruled that cosmetic). The two edited files kept CRLF: `--numstat` is the same with and without `--ignore-cr-at-eol`.
4. **This branch is 2 commits behind `origin/main`** (the #593 merge). The diff does not touch the local settings file or `.gitignore`. RM syncs before the PR.

---

## SA Code Review — DO-5b

**Code Review by SA — 2026-10-31**
**Status:** ✅ Code Approved. SA made four small fixes in the skill directly; they are listed below. `devops.md` needs no further change.

Reviewed in the DO-5b worktree against §D5.2.2 (a)–(g), the §D5.4 DO-5b criteria, SA Review — DO-5b (short pass) (Q-D5b-1 to Q-D5b-4, findings 1–10) and the DO-5b implementation notes. No platform call, no `claude mcp` command and no web fetch. No user-scope file was opened. Local reads only: `git` refs, tree listings and counts. The `.env.example` reads were counts only, piped to `wc -l`. No line, name or value was printed.

### Rulings on Dev's flagged deviations

1. **The dot-path rewrite: use `origin/main:./<path>`, with no prefix and no allowed-list change.** SA measured three forms here. A bare `git show origin/main:.gitignore` fails ("unknown revision"). `MSYS_NO_PATHCONV=1 git show origin/main:.gitignore` works (82 lines). **`git show origin/main:./.gitignore` also works (82 lines), with no prefix**: Git Bash does not rewrite an argument whose path starts with `./`, and git reads `./` as relative to the current folder. This form is plain `git show`, which is already on DO's allowed list, so neither `devops.md` nor its allowed list changes.
   - **Rejected: `git ls-tree`.** It answers CH-3 by names only, but it is not on the allowed list (`git status|log|diff|show|branch --list|worktree list`). Adding it would be an allowed-list change, and the `./` folder listing gives the same answer: `git show origin/main:./.claude/` printed `agents/`, `settings.json`, `skills/`.
   - **Rejected: the `MSYS_NO_PATHCONV=1` prefix.** An environment prefix is not a listed form. Ruling it in would mean an allowed-list sentence, and it is not needed.
   - **Trap, now in the skill:** `./` is relative to the current folder. Run from `lib/`, `origin/main:./.gitignore` gave "does not exist", which a reader could take as "absent". That would be a false "no drift" for CH-4. So the skill says to run from the worktree root. It adds a self-check: a root listing (`git show origin/main:./`) without `.github/` means the command ran elsewhere. "Unknown revision", or a "does not exist" from outside the root, is "not read (error)", never "absent".
   - **Per check:**

     | Check | Need | Form |
     |---|---|---|
     | CH-3 | Presence only | `git show origin/main:./.claude/` (names only); the `.gitignore` line from `origin/main:./.gitignore` (tracked, public) |
     | CH-4 | Presence, then content only if the file exists | Root listing `git show origin/main:./`. `.mcp.json` is not on `origin/main` today, so no content is read |
     | G-1, G-6 | Workflow content | `git show origin/main:./.github/workflows/` to list, then each file as `origin/main:./.github/workflows/<file>` |
     | CH-2 | Settings and agent file content | `origin/main:./.claude/settings.json` and `origin/main:./.claude/agents/<file>`, by key name and count where the owning skill says so |

     Presence comes from the folder listing; a file's content is read only when the check needs it. All of this is DO's, and none of it moves to the main session.
2. **Fix-plan pointer to Q-D5-10: accepted.** `env-change-protocol` holds the template and §5 "Where the record goes", but not the rule that a security fix plan stays private until verified. That rule is the Q-D5-10 ruling. Pointing to a requirement ruling follows the `claude-harness-ops` precedent for Q-D5-2, which SA accepted in DO-5a. The skill's wording, "until it is verified", matches the ruling.
3. **Grep only-matching: DO still does not read `.env.example`. The main-session procedure stands.** The Grep tool does have `-o` in content mode. But a safe DO form also needs the guard, and the Grep tool has no invert match. The guard would become two `output_mode: count` reads compared by hand: every line, then the conforming lines. That is a new procedure for 4 names. It also leaves one parameter between DO and printing the file's values: content mode without `-o` prints whole lines. That is a print of an `.env*` file, which is on the Secret-exposure row in `devops.md`, and an exception there would be an allowed-list change. So Q-D5b-2 stands, and the skill line "DO never reads `.env.example`, by any tool" stays. Reopen only if V-2's name source is widened (the separate item in Q-D5b-2), when a DO-owned names read would be worth a new form.
4. **Branch 2 behind `origin/main`:** noted. RM syncs. No action.

### Code Review Comments

1. Frontmatter: `name: env-drift-audit` matches the folder. The `description` is one line, fires on "drift", "audit the environments", "is everything configured as expected" and "what is out of sync", names DO and the main session, and holds no ID. — Pass
2. (a)–(f) coverage: §2 (a), with the private-inventory rule, `origin/main` and the staleness test (only `identical` counts; `behind` is explained in one line). §3 (b), as pointers only. §4 (c), with all seven "not read" reasons. §5 (d), with fixed classes and "rate lower, never higher". §6 (e), with Q-D5b-1, the five-part summary and `github-ops` §9. §1 (f), "On demand only" and "No schedule". — Pass
3. (g): all 22 rows are present (G-1..G-6, V-1..V-5, S-1..S-5, CH-1..CH-6), and every class equals the spec's. Every SA correction from findings 3–9 is applied, and the S-3 row's added source ("private inventory (intended exceptions)") matches the SA note. No row holds a value, project, folder or path. — Pass
4. Pointers: every cited section exists and holds its read. `github-ops` §2 (Repo settings, Branch protection and rulesets, What to report, Required checks, Actions, Secrets and variables), §3, §4, §6 step 2 and §9. `vercel-ops` §1, §3 (Projects, Env vars, Deployments, Domains), §4 step 5, §5 (CANCELED and `SKIP:`) and §6 (the production deployment's set, enabled state). `supabase-ops` §2 (all six topics, and What the tools cannot read). `claude-harness-ops` §1–§4 and §6–§8. Both `dashboard-settings.md` files. — Pass
5. §2 dot-path line: as built, it named the failure but gave no working form, so G-1, G-6, CH-2, CH-3 and CH-4 would usually be "not read (error)" from Git Bash. **SA fixed** (fixes 1–3). — Priority: High (fixed)
6. §7 V-2 `.env.example` procedure: guard first, then `-oE`, then the stat-only diff, with stop on the first failure. SA re-ran it as counts only. Guard `0`. Names `4`, each exactly `NAME=` (0 differ). BRE form `0`, which confirms the `-E` note. Diff-stat lines `0`. — Pass
7. Restatement and H3 greps on the skill: `--jq`, `filter_project_envs`, `begin read only`, `gh api`, `list_deployments`, `get_advisors`, `Snapshot the before-state`, `| **Read** |`, `node -p`, `Get-Item`, `claude mcp`, `jq`, `grep -o '`, `ls-tree`, `MSYS`: all 0. `settings.local.json`: 1 (the CH-3 row). `.claude.json`: 1 (the "DO never opens" sentence). Every `main:` hit is `origin/main:` (7). — Pass
8. `devops.md`: +1/−0, the one pointer line under job 2. `tools:`, the allowed list and the Secret-exposure row are unchanged, and the rulings above need no change to them. — Pass
9. Size: 142 lines after the fixes, inside the ~150 target. No reference file. — Pass
10. Line endings: the new SKILL.md is LF (0 CR bytes), as in DO-5a, which SA ruled cosmetic. `devops.md` and this requirement keep CRLF (CR count equals line count). — Pass

### Fixes made by SA

1. SKILL.md §2: the dot-path line is replaced. Every path is written `origin/main:./<path>`, from the worktree root, with the root-listing self-check. "Unknown revision", or a "does not exist" from outside the root, is "not read (error)". A new line says presence is read from the folder listing, and content only when the check needs it.
2. SKILL.md §2: `git show origin/main:<path>` → `git show origin/main:./<path>`.
3. SKILL.md §7 CH-3 row: `git show origin/main:.claude/` → `git show origin/main:./.claude/` (§2).
4. SKILL.md §8 checklist: the dot-path item now names the `./` form from the root, presence from the listing, and "not read (error), never absent".

### Optimisation Suggestions

- `claude-harness-ops` §2 still lists `.claude/settings.local.json` as tracked "Yes, today", and §3 still describes the tracked file. Both are stale since PR #593. Update them in a small docs PR (FU), not in 5b, so the 5b diff stays within D5.3.
- When V-2's name source is widened (the separate item in Q-D5b-2), revisit ruling 3: a DO-owned names read becomes worth a form at that point.

### Code Approved for QA: Yes

---

## QA Report — DO-5b

**QA — 2026-10-31**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path, heading and sub-label existence, byte-level line-ending count, a class-by-class comparison of the check table with §D5.2.2(g), read-through), plus local read-only `git show` runs of SA ruling 1, and the `.env.example` procedure as counts only. This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public-repo, the `.env.example` boundary, the dot-path trap), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1, DO-3, DO-4 and DO-5a) · **Input source:** TL prompt + §D5.4 (DO-5b) as amended by SA Review — DO-5b (short pass) + SA Code Review — DO-5b. Run in the DO-5b worktree on the uncommitted changes. No platform call, no `claude mcp` command, no network call. No user-scope file was opened. No `.env.example` line, name or value was printed. QA edited nothing except this section, the §0 DO-5 row and the Change History row.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Public repo (finding-11 regex, personal paths, `mcp.supabase`, worktree names, URLs) | Pass | **Corpus:** the new SKILL.md, plus every added line of `git diff -U0` with the new file `git add -N`'d and then `git reset` (413 lines across the four files; `git status` afterwards shows the skill untracked again). **Finding-11 regex:** 0 hits in the skill, 0 in the added lines. **Skill and added lines both 0:** drive-letter backslash, `C:/Users`, `/Users/`, `/c/Users`, `mcp\.supabase`, `worktrees/`, the worktree folder name, `ENVIRONMENTS_AND`, `environment-readiness`, `https?://`, query strings, `www.`, 6+ digit runs, and the user's, a team member's and the org name |
| 2 | Cited paths and sections exist | Pass | `test -e` OK for `env-change-protocol`, `devops.md`, the four ops skills, both `dashboard-settings.md` files, `github-ops` `read-commands.md`, `lib/utils/featureFlags.ts`, `vercel.json`, `supabase/migrations`, `supabase/functions`, `supabase/config.toml`, `.claude/settings.json`. At `origin/main`: `featureFlags.ts`, `vercel.json`, `config.toml` and `.env.example` exist (`git cat-file -e`, no content). **Sections:** `github-ops` §2 holds all six sub-labels (Repo settings, Branch protection and rulesets, What to report, Required checks, Actions, Secrets and variables), §3 security alerts, §4 the seven rules, §6 step 2 the compare read with `identical`/`behind`, §9 public-repo. `vercel-ops` §1, §3 (Projects, Env vars, Deployments, Domains), §4 step 5 (aliases), §5 (CANCELED and `SKIP:`), §6 (crons), `dashboard-settings.md` protection. `supabase-ops` §2 holds all six topics, with backups under What the tools cannot read. `claude-harness-ops` §1–§4, §6–§8. `devops.md`: rules (a)–(d) under "Supabase (plugin server only)", "What you may write" (bold label), "Report Format" |
| 3 | Frontmatter | Pass | js-yaml (the main checkout's `node_modules`) from a scratch script: keys `name`, `description`; `name = env-drift-audit`, matching the folder; description 834 chars on one line. Fires on "drift", "audit the environments", "is everything configured as expected" and "what is out of sync" (1 each). Names DO and the main session; no ID |
| 4 | The 22 checks | Pass | 22 rows: G-1..G-6, V-1..V-5, S-1..S-5, CH-1..CH-6, none merged or dropped. Class column compared row by row with §D5.2.2(g): 19 identical, 3 reworded with the same classes (G-1 drops "required"; V-3 folds the SA correction in; CH-1 says "platform write tool", per SA finding 8). No class lowered. Readers match the SA corrections: G-2/G-4/G-5 "DO; user if refused", V-2 split, CH-3 DO, CH-5 main session, CH-6 split, S-4 user. No row holds a value, project, folder or path |
| 5 | No restatement or forbidden reads | Pass | 0 hits each: `Snapshot the before-state`, `\| **Read** \|`, `gh api`, `list_deployments`, `get_advisors`, `--jq`, `filter_project_envs`, `begin read only`, `node -p`, `Get-Item`, `claude mcp`, ` jq`, `grep -o '`. Extra: `ls-tree`, `MSYS`, `cat .env`, `git show origin/main:./.env` 0. `main:` 7 hits, all `origin/main:` (0 otherwise). `settings.local.json` 1 (CH-3). `.claude.json` 1 (the "DO never opens" sentence, pointing to `claude-harness-ops` §1) |
| 6 | `devops.md` | Pass | `git diff -U0`: 1 changed line, added, under job 2 ("Drift report"); 0 removed; no `tools:` in the diff. The allowed and forbidden lists are outside the only hunk |
| 7 | SA ruling 1, live | Pass | From the worktree root: `git show origin/main:./.gitignore \| wc -l` → 82; `git show origin/main:./.claude/` lists 3 names (`agents/`, `settings.json`, `skills/`); the root listing holds `.github/` (1). The bare form `origin/main:.gitignore` fails "ambiguous argument" (the Git Bash rewrite). **Trap, from `lib/`:** `git show origin/main:./.claude/` fails "path … does not exist in 'origin/main'", and the root listing from there has 0 `.github/` entries, so the skill's self-check catches it |
| 8 | `.env.example` stays a main-session check | Pass | The skill tells DO "DO never reads `.env.example`, by any tool" (§7) and checklist §8 repeats it; V-2's DO reader is `featureFlags.ts` only. No content of the file is shown in the skill; its 6 mentions are the source row, V-2, the procedure and the checklist. QA ran the procedure as counts only: guard 0, names 4 (0 that differ from the `NAME=` shape), BRE form 0, diff-stat lines 0. The file was not opened |
| 9 | "Not read" handling | Pass | §4 lists the seven reasons (no access, error, retention passed, expected state missing, `origin/main` stale, no checker, main-session check owed). §6 part 1: "Critical-class checks not read" is always first. §6: "full report not written: private docs not reachable", with no tracked or scratch fallback. Summary is counts only, no finding named, never pasted into tracked text (`github-ops` §9). §2: the private inventory's location comes from the brief and is never named; the path greps in check 1 find none |
| 10 | `claude-harness-ops` fix | Partial (non-blocking) | `git diff -U0`: 5 changed lines (5 added, 5 removed), no churn. The §2 row ("**No** on `main`; only on an older branch"), the §3 paragraph and the done-marked untrack bullet agree with `origin/main`: its `.gitignore` has the ignore line (1 hit, line not printed) and its `.claude/` tree holds no local settings file. **But** the description still begins its topic list with "the tracked local settings file" (only the trigger phrase was changed). See Issues |
| 11 | Line endings | Pass | `git diff --numstat` is the same with and without `--ignore-cr-at-eol`: devops 1/0, claude-harness-ops 5/5, requirement 265/12 before this report. CR count equals LF count in the three edited files (160, 159, 2572; `core.autocrlf=true`). The new SKILL.md has 0 CR bytes (LF), as in DO-5a, which SA ruled cosmetic |
| 12 | Untouched files | Pass | `git diff --quiet HEAD` succeeds on `.gitignore`, `CLAUDE.md`, `.claude/settings.json`, `env-change-protocol`, `github-ops`, `vercel-ops` and `supabase-ops`. `git status --untracked-files=all` shows only the four files under test. The requirement's 12 removed lines are in-place BA/SA edits of the §0 DO-5 row, §D5.2.2 (a), (b), (e), (f) rows and the D5-5/D5-6 rows |
| 13 | Fresh-session load test | Deferred | Skills load at session start. Not failed |

### Issues Found

- **Blocking:** none.
- **Non-blocking (should fix before commit):**
  1. **Stale phrase left in the `claude-harness-ops` description** — File: `.claude/skills/claude-harness-ops/SKILL.md` line 3 — Severity: Low. The topic list still reads "…approvals, the tracked local settings file, MCP servers…". The trigger later in the same line was changed to "the local", so the description now calls the file tracked once and local once. Suggest "the local settings file". Line 50 ("each worktree reads its own checked-out copy") is also slightly off now that the file is untracked on `main`; it is only true on an older branch. Optional.
  2. **Scope: the `claude-harness-ops` edit is outside D5.3 for 5b and not recorded here** — Severity: Low (process). The DO-5b criterion says "the diff touches only the 5b files in D5.3", and SA Code Review — DO-5b's optimisation said to make this fix in a separate small docs PR. The main session made it in 5b instead, and no line in this requirement records that decision or SA's acceptance of it. Either TL/SA add one line accepting it into 5b (a D5-8-style row or a note under SA Code Review — DO-5b), or RM ships it as its own commit/PR. The content itself is correct (check 10).
- **Noted only:** `vercel-ops` §4 step 5 and `github-ops` §6 step 2 are table rows / numbered items, not headings; they are found by text search.

### Final Status

- [x] All acceptance criteria pass (the load test is deferred). No High or Medium issue. Ready for the user's diff review, with the two Low items above for TL to route.
- [ ] Issues found

**TL routing of the two Low items (2026-10-31):** (1) fixed by the main session: the `claude-harness-ops` description now says "the local settings file", and its §2 line notes a new worktree has no copy. (2) Accepted into the 5b PR rather than a separate PR: the edit is 7 lines, docs-only, corrects text made stale by Q-D5-2 (PR #593), and QA has checked it.

---

## SA Review — DO-6 (spec)

**By SA — 2026-11-01.**
**Verdict: APPROVED WITH CHANGES.** The split is right, DO-6a is small enough, and the spec keeps to the rules that matter: it points instead of restating, `devops.md` gets one line, DO gets no Stripe tool, and nothing adds CI time. Every code claim I spot-checked holds. The production webhook probe is the one weak point. "Resend an event that already shows 2xx" is **not** money-safe as written. A 2xx in the dashboard does not prove that a `completed` claim row exists, and the claim row is the only thing that stops a handler from running. Required change 1 adds the precondition that makes the probe safe. Three smaller probe rows needed fixes (changes 2–4), and two rows needed precision (changes 5–6).

Reviewed in the DO-6 worktree at `origin/main` (merge of #595), against §0, §3.1–§3.5, the DO-6 scope paragraph, SA Review — DO-5 and SA Review — DO-5b (short pass) as the model, `devops.md`, and the `env-change-protocol`, `vercel-ops`, `supabase-ops` and `env-drift-audit` skills. No platform call, no SQL, no network call. No `.env*` file and no private doc was opened. Local reads only: source files, `git log`, line counts.

### Code claims (spot-check)

| Claim | Result | Where |
|---|---|---|
| A delivery of an already-`completed` event returns 200 `duplicate: true` and runs no handler | **Verified.** The check comes after signature verification and before the Business OS dispatcher and the `switch`. Two more `duplicate: true` returns exist: a live `processing` claim, and a unique violation on insert. Neither runs a handler. | `app/api/stripe/webhook/route.ts`, `POST`, idempotency block |
| No secret → 500; no match → 400; no claim row is written | **Verified.** Both return before any claim. The route tries **both** secrets on every delivery (this matters for change 1(d)). | same, secrets loop |
| `catalogue.ts` is guarded and covers production, preview and local | **Verified.** `exp(production, preview, local)` takes R / O / X (required / optional / forbidden). The drift guard scans `app`, `lib`, `components` and `hooks`, plus plugin `${NAME}` placeholders. The Stripe rows match F11. *Nuance:* the guard is complete for the read forms it recognises (dot, bracket-literal, destructuring, same-file constant). It does not cover a computed name. "DO never searches the code for names" stands. | `lib/admin/environment/catalogue.ts`, `__tests__/catalogueDrift.guard.test.ts` |
| Mistral key not read | **Verified.** No `MISTRAL` name in `lib/` or `app/`. `PROVIDERS` lists four providers. `MistralProvider` takes its key through its constructor and is never constructed outside tests. | `lib/ai/providerFactory.ts`, `lib/ai/providers/mistralProvider.ts` |
| SendGrid is not a transport | **Verified.** The provider union is `resend \| smtp \| gmail \| none`. SendGrid appears only in the SMTP comment. | `lib/notifications/emailTransport.ts` |
| F4 pin, F6 both client names, F7 log event names, F8 key-file guard, F9 shape-only check | **Verified.** Every file path named in §D6.2.2(2) and the three setup docs exist. One precision for F6: change 6. | as cited |

### Is the production resend probe money-safe? (point 4)

Only when the claim row for **that event**, in **that deployment's database**, is `completed` at the moment of the resend. A 2xx in the dashboard does not imply that, in five cases a reader can see in the code:

- (i) **The row was deleted.** The operator account-cleanup migrations delete a cleaned-up account's `processed_webhook_events` rows, so its old events have no claim.
- (ii) **The claim was never written.** If the insert fails with anything other than a unique violation, the route continues, runs the handler and returns 2xx without a row.
- (iii) **The row is stuck at `processing`.** `completeClaim()` does not check the result of `complete()`. A failed completing write still returns 2xx and leaves the row at `processing`. A resend after `STALE_CLAIM_AGE_MS` takes the row back and **runs the handler again**. Stripe never retries a 2xx, so the manual resend is the only thing that reaches this path, and that resend is the probe.
- (iv) **The duplicate read fails at resend time.** The route then goes on to insert. If the row exists, the unique violation still stops it. If the row is absent, as in (i) or (ii), nothing does.
- (v) **The first delivery was served against a different database.** That is a deployment on another project, before an endpoint moved.

**Connect vs platform:** the event ID is the dedupe key whichever endpoint receives the event, so one endpoint versus two changes nothing here. The layout does change what the probe proves, though (change 1(d)). Business OS dispatch runs only for platform events. Both sides pass the same claim check first.

### Required changes

1. **[§D6.2.2(4) webhook row, (5) "Resend only a delivered event", acceptance criteria] Make the resend probe safe and conclusive.** — Priority: High
   - (a) **Precondition, before the resend:** DO confirms `select count(*) from processed_webhook_events where event_id = <the event> and status = 'completed'` returns **1**, on the database that deployment uses. Rules (a)–(c) apply, and the query returns a count. The user supplies the event ID in chat. It is not a secret, but it never goes into tracked text, and the change record holds it only in the private docs. If the count is 0 or DO cannot read it, **do not resend**. The probe is "not probed".
   - (b) **Prefer a low-stakes event:** an event whose type the route acknowledges without a money handler. Derive the type from code at use time, and never hardcode it in the skill.
   - (c) **Evidence classes:** the expected success class after the resend is "Received event" followed by "Event already processed, skipping duplicate". If "Event recorded, processing" or "Retrying previously failed event" appears for the resent event, the resend has reached a handler. DO stops and escalates to the user and SA.
   - (d) **Probe each endpoint whose secret changed, from that endpoint's own delivery list.** The route tries both secrets, so a resend from the other endpoint passes on the unchanged secret and proves nothing.
   - (e) **During a roll overlap a pass proves nothing.** When the vendor signs with both the old and the new secret during an overlap (check the vendor docs at use time), a pass while the old secret is still valid does not prove that the new value is deployed. The result is "pass, not conclusive (overlap)". Repeat the probe after the old secret has expired, or record it as not conclusive.
   - (f) **New acceptance criterion:** QA confirms the stripe.md webhook row holds (a)–(e).
2. **[§D6.2.2(4) "Secret key mode / account" and "Publishable key" rows] State the checkout probe's preconditions and side effects.** — Priority: Medium
   - **Preconditions:** the plan-checkout flag is on for that deployment, since the route returns 404 otherwise, and an internal account that is eligible to start a checkout exists. If either is missing, the result is "not probed".
   - **Side effects** (not money; SA accepts them for a production probe): opening checkout can create a vendor customer for that account in that mode, an open session that later expires and whose expiry event the route handles, and an audit row. stripe.md names them so they are expected.
   - **Follow-up (not DO-6a, Dev + SA):** show the Stripe key **mode** (test / live, derived from the prefix, never the key) on the admin Environment page. That is a mode probe with no customer side effect.
3. **[§D6.2.2(4) "Plan prices" row] The post-flag evidence cannot fail as written.** `unknown_price` denies fire only when a plan invoice arrives, and a "test-mode plan invoice" has no meaning on production. Replace it: after the flag is on, open the plan page or start checkout on that deployment. DO then counts `bos_billing_lookup_key_missing` (logged with `alert: true` by `planPriceCatalog.ts`) in that deployment's logs after the probe time, and the count must be 0. — Priority: Medium
4. **[T-ST-1] DO cannot read the local column.** DO opens no `.env*` file, and local is not a Vercel target unless the private inventory says a Development target is in use. So T-ST-1 covers the Vercel targets only, and local is "not read (main session / user)". The same applies to "Local" in the (1) table: it is guidance, not a DO check. — Priority: Medium
5. **[§D6.2.2(2), T-ST-4, Q-D6-12] Derive event types per side.** T-ST-4 compares each endpoint's subscription, so the derivation must say which types the route acts on for **platform** events (the dispatcher plus the `switch`) and which for **Connect** events (the `switch` branches on `event.account`). A type that reaches the `switch` default, or is only logged as ignored, is not "acted on". Subscribing to extra types is harmless but writes claim rows. If Dev cannot derive the split reliably at build, T-ST-4's per-side comparison is "not read (side)", never a guess. — Priority: Medium
6. **[F6, T-ST-6] The Connect OAuth redirect is the path *plus a query string*.** `oauth-link/route.ts` appends a query parameter to the callback path. Dev confirms against the vendor docs at build whether the registered URI must include it. The skill says "the redirect exactly as the route builds it, read at use time", not "the callback path". — Priority: Low
7. **[Q-D6-5] Move the T-ST rows into stripe.md.** The rows go in a "Drift checks" section in the `env-drift-audit` §7 column format. `env-drift-audit` gets only the §1, §3, §6 item 3 and §7 one-line edits. It is 142 lines today, and the four edits must keep it within about 150. — Priority: Low

**Follow-ups logged (not DO-6a):**
- **FU-D6-a (Dev, code):** `completeClaim()` should log a failed `complete()` write at error level with `alert: true`, so case (iii) shows up. This is reliability, not an attacker-reachable gap: every path needs a valid signature.
- **FU-D6-b:** the Environment-page mode display (change 2).
- **FU-D6-c:** the stale setup guides (Q-D6-10).
- **FU-D6-d:** V-2 moves its name source to the catalogue (Q-D6-6).

### Rulings on Q-D6-4 to Q-D6-12

- **Q-D6-4: accepted.** One `SKILL.md` (the shared rules and the index) and one reference file per family. A later slice adds a file and an index row and edits no other family's file. The one exception is a correction to the shared rules, which gets its own SA pass.
- **Q-D6-5: accepted, the reference-file option.** See change 7.
- **Q-D6-6: accepted** for T-ST-1 and T-ST-2, read at `origin/main`. The catalogue is pure data with no values, so DO may read it in full. Moving V-2 is FU-D6-d.
- **Q-D6-7: accepted.** DO gets no Stripe tool or key. A future read-only, mode-scoped vendor MCP would be a `claude-harness-ops` change with its own SA review.
- **Q-D6-8: accepted.** Counts by `status` and by metadata `livemode` in a stated window. The table is not a rule (d) table. It is supporting evidence only, and the runtime logs are primary. It also serves the single-event count in change 1(a), which is a count and so within rule (c).
- **Q-D6-9: accepted.** One clarification: a test-mode endpoint is in the reversible tier, but DO holds no Stripe tool, so the user applies it after the approval in chat, as `devops.md` already says. Creating, rolling or revoking a test-mode **key** is production tier, because a key action is a key rotation under §3.3.
- **Q-D6-10: accepted.** FU-D6-c is docs-only: Dev replaces the event lists with a pointer to the derivation.
- **Q-D6-11: accepted.** Our own shared secrets are out of DO-6. The QStash signing keys are DO-6f.
- **Q-D6-12: accepted, with change 5.** Dev records the derivation steps per side. A code-side constant with a guard is a later Dev change if deriving the list proves unreliable.

### Split and order (point 1)

- **The split DO-6a..6h is accepted.** The technical order is right: money first, then customer mail, then sign-in. Plugin OAuth apps come last because a failure there affects one plugin, not the platform.
- **DO-6a is small enough.** It is two new files and two pointer edits, the same size as DO-3 or DO-4. If stripe.md runs past about 180 lines, Dev trims prose, never probe or drift rows, and asks SA before splitting the file.

### Checked and honoured (point 5 and point 6)

- **Pointers, not restatement:** the shared rules point to `env-change-protocol`, `vercel-ops` §2–§4, `supabase-ops` §2 and `devops.md` (a)–(d). The restatement grep criterion stays.
- **`devops.md`:** exactly one pointer line. `tools:` is unchanged, and DO gets no Stripe tool.
- **CI time:** none. Config and docs only, with no CI job.
- **Public repo:** the spec holds no account, client, endpoint, price, portal or configuration ID, no endpoint URL, no personal path and no private-doc location. Key prefixes appear only as the generic `sk_`/`pk_` test/live concept. The loopback callback URLs in the existing setup guide are not copied.
- **Open weaknesses:** F5 says the guide lags the code, not that any live endpoint is unsubscribed. The claim-row cases above can be seen in public code and cannot be reached without a valid signature. They are worded as probe preconditions, and nothing here says any production row is in that state. **No content has to move to the private docs.** Any finding from an actual run (which endpoint lacks which type, which mode is where) does go to the private docs only.

### For the user (Q-D6-1 to Q-D6-3)

These remain the user's decisions. SA has no technical objection to the BA's suggestions: production live, Preview and local test (Q-D6-1); the order in §D6.0 (Q-D6-2); and no end-to-end payments on Preview for now (Q-D6-3). If the user wants end-to-end Preview payments, SA designs it as a separate item.

### Approval

[x] DO-6 spec approved with changes. **Dev may build DO-6a** (D6-1 to D6-4, D6-7), with changes 1–7 applied, once the user has answered Q-D6-1 to Q-D6-3. SA does a code review, then QA. DO-6b to DO-6h each get a BA scoping pass and an SA short pass before build.

---

## DO-6a implementation notes

**By Dev — 2026-11-01.** Config/docs-only slice, no separate workplan. Nothing committed. No platform tool, no SQL, no Stripe call. No `.env*` file and no private doc was opened. Local reads only: source files, line counts, and two web searches of the vendor's docs (below). The skill records the current Stripe setup as a pointer to the private inventory and changes nothing (Q-D6-1, Q-D6-3).

### Files changed

| File | Action | What |
|---|---|---|
| `.claude/skills/third-party-ops/SKILL.md` | New (86 lines) | Frontmatter `name: third-party-ops`, single-line description with the D6-1 triggers, used by the main session and DO. Pointer table (a); §1 scope with the catalogue as the name source (b, Q-D6-6, Q-D6-11); §2 who does what (c, Q-D6-7); §3 common rules (e); §4 the six-part template (d); §5 platform index (f, Q-D6-4) with DO-6b..6h "not covered yet" and the Q-D6-2 "confirm the services are live" rule; §6 checklist |
| `.claude/skills/third-party-ops/stripe.md` | New (134 lines) | §1 what differs (with the Q-D6-1 target and the Q-D6-3 Preview rule), §2 where the code reads it plus the per-side derivation steps, §3 dashboard steps, §4 probes (table, the resend probe, the checkout probe, supporting SQL), §5 gotchas, §6 drift checks T-ST-1..7, §7 tiers and order |
| `.claude/agents/devops.md` | Edited (+2/−0: the pointer line and its blank line) | After the "Platforms without a tool" paragraph. `tools:` unchanged |
| `.claude/skills/env-drift-audit/SKILL.md` | Edited (+5/−2, 145 lines) | §1 sentence; §3 Third-party row; §6 item 3; §7 one pointer bullet under the table |
| This requirement | Edited | §0 DO-6 row, these notes, Change History |

### SA required changes

| # | Where it landed |
|---|---|
| 1 (High) | `stripe.md` §4, "The resend probe", steps 1–7. (a) step 3: count of `completed` rows for that `event_id` on the database that deployment uses must be exactly 1, else "not probed"; the event ID comes in chat and stays out of tracked text. (b) step 2: prefer a type that reaches no money handler on that side, derived at use time, none named. (c) steps 5–6: pass is "Received event" then "Event already processed, skipping duplicate"; "Event recorded, processing", "Retrying previously failed event" or `bos_webhook_stale_claim_reclaimed` means stop and escalate to the user and SA. The stale-claim line was added because the reclaim path also reaches a handler (`route.ts`, `processing` branch). (d) step 1. (e) step 7: "pass, not conclusive (overlap)". (f) is QA's criterion against these steps |
| 2 | `stripe.md` §4, "The checkout probe": the flag precondition (404 otherwise) and the eligible-account precondition, each "not probed" when missing; side effects (customer, open session and its expiry event, audit row); never enter payment details. FU-D6-b not built |
| 3 | `stripe.md` §4, "Plan prices, after the flag" row: count of `bos_billing_lookup_key_missing` after the probe time = 0. **Refined from the code:** the checkout does not load the full price catalog. `planCheckoutPrice.ts` checks only the current tier's key (and logs the same event name, plus `bos_billing_checkout_price_mismatch`), while the full catalog (`planPriceCatalog.ts`, current and retired keys) is loaded by the plan invoice list and the upgrade preview. So the probe runs both the checkout and the invoice list, and counts both event names. Both caches log nothing on a hit (catalog a few minutes, checkout 60 s and only for a passing price), which is why the gotcha says to probe the new deployment |
| 4 | T-ST-1 covers Vercel targets only; local is "not read (main session / user)". `stripe.md` §1 states the Local column is guidance, never a DO check |
| 5 | `stripe.md` §2, derivation steps 1–5, per side, with "not read (side)" in step 5 and in T-ST-4's reader column. Default and log-only cases are not "acted on"; extra subscriptions are harmless but write claim rows |
| 6 | Checked against the vendor's Connect OAuth reference (below). The skill says register each redirect "exactly as the code builds it, read at use time" (`stripe.md` §1, §5, T-ST-6), and names the query string |
| 7 | The T-ST rows live in `stripe.md` §6 in the §7 column format. `env-drift-audit` got only the four one-line edits and is 145 lines |

Q-D6-4..12 rulings: Q-D6-4 in SKILL.md §5 (one file per family, shared-rule corrections get their own SA pass). Q-D6-5 is change 7. Q-D6-6: T-ST-1 and T-ST-2 read the catalogue; V-2 untouched (FU-D6-d). Q-D6-7: SKILL.md §2 last paragraph. Q-D6-8: supporting SQL paragraph in `stripe.md` §4. Q-D6-9: `stripe.md` §7, including "a test-mode key action is production tier". Q-D6-10: the guides are linked with the "lists lag" warning and not edited (FU-D6-c). Q-D6-11: SKILL.md §1. Q-D6-12: the derivation, below.

### Event-type derivation, checked once at build

Run on this worktree's code (the merge of #595), following `stripe.md` §2 steps 1–5. Both sides could be derived with certainty, so no side is "not read (side)" today. Counts only, so this note cannot go stale as a list: **13 types acted on for platform events, 14 for Connect events.** The skill holds neither the list nor the counts.

Two corrections to the BA text, both from the code:

- §D6.2.2(2) named `planCheckoutSessionEvents.ts` as a resolver. It is handler-side. The resolvers are those in `DEFAULT_RESOLVERS` (`webhookDispatcher.ts`): the plan resolver in `planInvoiceResolver.ts` and the boost resolver, whose type lists are in `boostChargeEvents.ts` and `boostWebhookSession.ts`. The skill starts from `DEFAULT_RESOLVERS`, so a new resolver is picked up.
- F5 / the gotcha said "the route ignores `charge.refunded`". The `switch` ignores it on both sides, but on the platform side the boost resolver reads it before the `switch` (boost refunds). The gotcha says so; a platform endpoint that drops it would miss boost refunds.

### Checked against the vendor's docs (2026-11-01)

- **Connect OAuth redirect (change 6).** The Connect OAuth reference says the request's `redirect_uri` must exactly match one of the registered redirect URIs, that a live-mode URI must use HTTPS, that the first registered URI is used when none is sent, and that a mismatch returns `invalid_redirect_uri`. It does not say in so many words whether the query string is compared. The skill therefore says "register exactly as the code builds it" and lets the authorise-page probe confirm. Both facts are marked "confirm at use time".
- **Webhook secret roll overlap (change 1(e)).** The search returned only secondary sources (an optional overlap of up to 24 hours, signing with both secrets until it ends). Not confirmed from the vendor's own page. The skill hardcodes no window and says to check the vendor's docs at use time.

### Deviations for SA

1. **`stripe.md` §1 table shape.** The BA table had Production / Preview / Local columns. The skill has one "Rule per environment" column plus the target sentence, because the per-environment mode is now the user's target (Q-D6-1) while the current setup is private, and a per-column value would read as the expected state. No row was dropped.
2. **`env-drift-audit` §6 item 3** reads "Third-party: per platform, audited (counts as in item 2) or not audited". The parenthesis is beyond the spec's wording; without it the summary does not say what an audited platform reports.
3. **`env-drift-audit` §1** still says "A run covers all four areas". It was left as is, because the spec says nothing else changes. SA may want "the areas" there.
4. **Q-D6-1 wording.** §D6.6 says the per-environment key mode "is checked by probe T-ST-1". T-ST-1 sees names only; the mode check is T-ST-3 (and the checkout probe). The skill follows the T-ST table. §D6.6 is the user's record, so Dev did not edit it.
5. **Line endings.** The two new files are LF in the working copy; the edited files kept CRLF (byte count: every line).

### Open items

- **Not checked, for SA:** several Stripe clients in `app/api/stripe/webhook/route.ts` are built with `new Stripe(process.env.STRIPE_SECRET_KEY!)` and no `apiVersion`, so they use the SDK's default rather than `STRIPE_API_VERSION`. Whether the default equals the pin was not checked. It affects outgoing calls, not the webhook payload shape. Not in the skill.
- FU-D6-a..d stand as SA logged them; none is built here.
- Public-repo scan (the finding-11 regex) over every added line of the working diff, the two new files included (`git add -N`), the BA and SA spec text included: **0 hits**. The restatement grep over both new files (`Snapshot the before-state`, `| **Read** |`, `begin read only`, `filter_project_envs`, `decrypt`): 0. The dated-version grep over `stripe.md`: 0. A grep for vendor identifier prefixes (publishable, client, endpoint, portal-configuration, price, customer, session, intent and restricted-key prefixes) over both new files: 0. Every file path the two new files name exists in the worktree.

---

## SA Code Review — DO-6a

**Code Review by SA — 2026-11-01**
**Status:** ✅ Code Approved for QA. SA made three small fixes directly (below). **One condition before commit**, for the main session: the §D6.6 wording items in ruling 4. They are not in the skill and do not block QA.

Reviewed in the DO-6a worktree on the uncommitted changes, against §D6.2–§D6.4, §D6.6, SA Review — DO-6 (spec) (changes 1–7, Q-D6-4..12) and the DO-6a implementation notes. No platform call, no SQL, no Stripe call, no network call. No `.env*` file and no private doc was opened. Local reads only: source files, `git diff`, byte counts, and the installed SDK's `package.json` and its default-version constant (for ruling 6).

### Code claims (spot-check)

| Claim in `stripe.md` | Result |
|---|---|
| Webhook route at `app/api/stripe/webhook/route.ts`, both secrets read there | **Verified.** |
| Every quoted log string | **Verified, each present in the route:** "Received event", "Event already processed, skipping duplicate", "Event recorded, processing", "Retrying previously failed event", `bos_webhook_stale_claim_reclaimed`, "Signature verification failed", "No Stripe webhook secret configured", the responses "Invalid signature" and "Webhook secret not configured", and "Unhandled event type". `duplicate: true` appears 3 times (the three duplicate returns in SA Review — DO-6) |
| `bos_billing_lookup_key_missing` logged with `alert: true` by both `planPriceCatalog.ts` and `planCheckoutPrice.ts`; `bos_billing_checkout_price_mismatch` by `planCheckoutPrice.ts` | **Verified.** Dev's refinement to change 3 is right: the checkout checks one tier's key, while the full catalog is loaded by `planBillingDocuments.ts` (the invoice list) among others. Probing both and counting both names is correct |
| `bos_billing_portal_configuration_` prefix with `alert: true` | **Verified:** the missing, unreadable and mismatch events in `portalConfiguration.ts` |
| Resolvers: `DEFAULT_RESOLVERS` in `webhookDispatcher.ts` = plan + boost; Connect returns before any resolver | **Verified** (`if (event.account) return { kind: 'not_business_os' }`). The correction to the BA text (`planInvoiceResolver.ts`, not `planCheckoutSessionEvents.ts`) is right |
| The boost resolver reads `charge.refunded`; the `switch` only logs it | **Verified** (`boostChargeEvents.ts`; the route's `case 'charge.refunded'` logs "ignored") |
| `STALE_CLAIM_AGE_MS` in `ProcessedWebhookEventRepository.ts`; cleanup migrations delete claim rows | **Verified** (the operator test-account cleanup migrations) |
| Mode from the key prefix, secret or restricted, fails closed (`stripeMode.ts`); shape-only publishable check with a "not configured" line (`stripeJs.ts`) | **Verified** |
| The checkout route answers 404 with the flag off; the plan checkout is embedded, so the publishable-key probe really exercises the key | **Verified** (`planCheckout.ts`: embedded session; `PlanEmbeddedCheckout.tsx` loads `stripeJs`) |
| Connect redirect = `platformOrigin()` + path + query string; `platformOrigin()` refuses loopback on Vercel | **Verified** (`oauth-link/route.ts`, `lib/utils/origins.ts`) |
| A guard test keeps `StripeService.ts` equal to `STRIPE_API_VERSION` | **Verified** (`boostCheckoutAccess.test.ts` compares the two) |
| `check-bos-plan-prices` npm script; key-file guard; the older webhook-status script pins an older version | **Verified** |
| Cache facts ("a few minutes"; checkout caches only a passing price) | **Verified** (5 min and 60 s in code; the skill hardcodes neither, correctly) |
| Every backticked file path in both new files exists | **Verified** (scripted `test -e`, 0 missing) |

### Required changes 1–7

| # | Result |
|---|---|
| 1 (a)–(e) | **Pass.** Steps 1–7 hold every sub-item. Step 3 uses rules (a)–(c), names `processed_webhook_events`, `status = 'completed'`, "exactly 1", and "do not resend / not probed" on 0, error or doubt. Step 6's extra stop class (`bos_webhook_stale_claim_reclaimed`) is **accepted**: the reclaim path reaches a handler, and a `processing` row is case (iii). (f) is QA's |
| 2 | **Pass.** Both preconditions with "not probed", the three side effects, "never enter payment details". The added invoice-list precondition (prices flag + a billing row of that mode) is correct |
| 3 | **Pass**, refined as above |
| 4 | **Pass.** T-ST-1 is Vercel targets only; §1's Local line says guidance, never a DO check |
| 5 | **Pass.** Per-side derivation, "not acted on" cases, harmless-but-claim-row note, "not read (side)" in step 5 and in T-ST-4 |
| 6 | **Pass.** "Exactly as the code builds it, read at use time", query string named, probe confirms |
| 7 | **Pass.** T-ST rows in `stripe.md` §6 in the §7 column format; `env-drift-audit` 145 lines, four edits plus SA fix 3 |

Q-D6-4..12: each landed where the notes say (spot-checked SKILL.md §1, §2, §5 and `stripe.md` §4, §7). Q-D6-9's "a test-mode key action is production tier" is in §7.

### Rulings on Dev's six items

1. **One "Rule per environment" column in `stripe.md` §1: accepted.** Per-environment value columns would read as the expected state and would put the current setup, which is private, next to the target. The target sentence plus "as recorded" is the right shape. No row was dropped; the local guidance survives in the Local line and the webhook row.
2. **"(counts as in item 2)" in `env-drift-audit` §6 item 3: accepted.** Without it an audited platform's summary has no defined content. It is a clarification of the spec's wording, not a new rule.
3. **"all four areas" in `env-drift-audit` §1: change it. SA fixed it** (fix 3). §D6.2.3 makes Third-party a fifth area, and §3 now has a fifth row, so "four" is now wrong. The line names the five areas, so it cannot go stale by count again. This stays inside the D6-4 edit to §1; it is not a new rule.
4. **§D6.6 Q-D6-1 says "checked by probe T-ST-1": the main session should correct the pointer before commit.** It is a factual cross-reference, not the decision: T-ST-1 reads names only; the mode check is T-ST-3 plus the checkout probe. The correction is "…is checked by T-ST-3 and the checkout probe", with the decision unchanged. SA did not edit the user's record. **Same pass, same condition:** two phrases in §D6.6 state the current setup in tracked text: Q-D6-3's opening phrase and Q-D6-2's sentence about where the QStash variables are set. They hold no value or ID, but the rule is that the current env setup is private. Suggested rewording, decision unchanged: Q-D6-3 "The user does not want Preview's Stripe setup changed now; no slice in DO-6 changes it"; Q-D6-2 "The main session confirmed QStash is still in use, so it stays in DO-6f" (the detail goes to the private inventory). The main session confirms the wording with the user if it wants to, then edits. SA removed the same kind of phrase from `stripe.md` (fix 2).
5. **Secret-roll overlap not confirmed from the vendor's own page: accepted as is.** The skill hardcodes no window and says "check its docs at use time" (SKILL.md §3, `stripe.md` step 7 and the API-version gotcha). Step 7 is safe either way: with an overlap the result is "not conclusive", without one a pass is conclusive. No build-time confirmation is needed; whoever runs a roll confirms at that time.
6. **`new Stripe(process.env.STRIPE_SECRET_KEY!)` without `apiVersion` in the webhook route: follow-up, not DO-6a.** SA checked: the route has 8 such constructions. The installed SDK's default version **equals the pin today**, so there is no drift now. But the dependency range allows a minor upgrade, and the vendor's SDK minor releases can move the default version. The existing guard compares only `StripeService.ts` with the pin, so a lockfile refresh could move these outgoing calls off the pin silently. Logged as **FU-D6-e (Dev, code, Low):** build those clients through the pinned client (or pass `apiVersion: STRIPE_API_VERSION`), and extend the guard to fail on a `new Stripe(` without `apiVersion` in `app/` and `lib/`. Not in the skill: it is a code fact for Dev, not an operations step.

### Code Review Comments

1. Frontmatter: `name: third-party-ops` matches the folder; one-line description holding every D6-1 trigger; names the main session and DO; no ID. — Pass
2. SKILL.md (a)–(f), the index with DO-6b..6h "not covered yet", and the Q-D6-2 "confirm the services are live" rule. — Pass
3. SKILL.md pointer row for `devops.md` named one section for four facts. **SA fixed** (fix 1). — Low (fixed)
4. `stripe.md` §1 had a sentence describing Preview's current payment setup. **SA fixed** (fix 2). — Medium (fixed)
5. `stripe.md` holds the seven parts; 134 lines, inside ~170. No event-type list (one type, `charge.refunded`, is named as a gotcha example, as the spec does) and no dated version string (0). — Pass
6. Pointers, not restatement: restatement grep 0 in both files. Every cited section exists (`devops.md` § Permission Tiers, § Tool Rules, § Report Format; `vercel-ops` §2–§4 and "Who probes what"; `supabase-ops` §1–§2; `env-drift-audit` §1, §3, §7). — Pass
7. `devops.md`: +2/−0, the D6-3 line and a blank line; `tools:` unchanged (0 `tools` lines in the diff). DO gets no Stripe tool, and SKILL.md §2 says a vendor MCP is a `claude-harness-ops` change. — Pass
8. CI time: none. Docs and config only; no workflow touched. — Pass
9. Public repo: the brief's regex over every added line (new files `git add -N`'d, then `git reset`), re-run after the SA fixes: **0**. Extra greps for publishable, restricted, customer, session, price, endpoint and client prefixes, `https?://`, user paths, worktree paths and the two private-doc names: 0 real hits (2 false positives: `checkout_price_mismatch` matching a price-prefix pattern). The vendor's IDs, endpoint URLs, the account and the current layout appear nowhere; the probe-precondition cases are worded as public code facts, as SA Review — DO-6 ruled. The only remaining current-state phrases are in §D6.6 (ruling 4). — Pass, with the condition
10. Line endings: the two new files are LF (0 CR), as in DO-5a and DO-5b; the three edited files keep CRLF (CR count equals LF count: 162, 145, this file). — Pass

### Fixes made by SA

1. `third-party-ops/SKILL.md` pointer table: the `devops.md` row now names § What You Own ("Platforms without a tool"), § Permission Tiers ("What you may write"), § Tool Rules ("Supabase (plugin server only)", rules (a)–(d)) and § Report Format.
2. `third-party-ops/stripe.md` §1: a sentence describing Preview's current payment setup → "No DO-6 slice changes Preview's Stripe setup (user decision)."
3. `env-drift-audit/SKILL.md` §1: "A run covers all four areas…" → "A run covers every area (GitHub, Vercel, Supabase, Harness, Third-party)…".

### Optimisation Suggestions

- The checkout probe's "the vendor marks test mode in the checkout" is a vendor UI fact; a later edit could add "(confirm at use time)" for consistency with the other vendor facts. Not blocking.
- FU-D6-b (mode on the Environment page) would replace the checkout probe for T-ST-3's secret-key half and remove its side effects; worth taking before DO-6b.

### Code Approved for QA: Yes

Condition before commit (main session, not QA): ruling 4's §D6.6 edits.

---

## QA Report — DO-6a

**QA — 2026-11-01**
**Test mode:** full · **Strategy:** static checks (grep, YAML parse, path and heading existence, verbatim string lookup in the webhook route, byte-level line-ending count, `git diff --numstat` with and without `--ignore-cr-at-eol`, read-through). This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public repo, current-state text, probe safety), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1 to DO-5b) · **Input source:** TL prompt + §D6.4 + SA Review — DO-6 (spec) change 1(f) + SA Code Review — DO-6a. Run in the DO-6a worktree on the uncommitted changes. No platform call, no SQL, no Stripe call, no network call. No `.env*` file and no private doc was opened. QA edited nothing except this section, the §0 DO-6 row and one Change History row.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | §D6.4: SKILL.md exists, frontmatter | Pass | js-yaml parse: keys `name`, `description`; `name = third-party-ops`, matching the folder; description 951 chars on one line, and its only `: ` is the key separator. Each D6-1 trigger is present: Stripe, a payment key, a webhook endpoint or signing secret, test or live mode, a Connect setting, a customer portal configuration, an OAuth redirect URI or client, a vendor API key, a sending domain, a vendor dashboard, "is the integration configured". Names the main session and DO |
| 2 | §D6.4: SKILL.md holds (a)–(f), index | Pass | (a) the pointer table (5 rows); (b) §1; (c) §2; (e) §3 (all seven common rules plus "vendor facts at use time"); (d) §4, six parts; (f) §5, with `stripe.md` linked and DO-6b..6h each "not covered yet (DO-6x)", plus "not audited" until covered. 86 lines, inside ~120 |
| 3 | §D6.4: `stripe.md` seven parts, paths exist | Pass | §1 what differs, §2 where read (plus the per-side derivation), §3 dashboard, §4 probes, §5 gotchas, §6 drift checks T-ST-1..7, §7 tiers and order. 134 lines, inside ~170. Every backticked path in both files tested with `test -e`: 38 exist, 0 missing (the only non-hit is the string `origin/main`, which is not a path) |
| 4 | §D6.4: no restatement | Pass | `Snapshot the before-state`, `\| **Read** \|`, `begin read only`, `filter_project_envs`, `decrypt` over both new files: 0 hits. The eight steps, the tiers table and rules (a)–(d) are named by pointer only |
| 5 | §D6.4: no copied lists | Pass | Dated-version grep over `stripe.md`: 0. No event-type list: the only type named is `charge.refunded`, as a gotcha example (the spec does the same); `refund.*` is a family name. The pin is named by file and constant, not value |
| 6 | §D6.4: probes | Pass | All 9 rows of the probe table name who runs it and what it shows when the setting is wrong. "No probe needs DO to hold a secret" is stated, and every key-bearing action is the user's. The production webhook probe is the resend; synthetic events to production are forbidden in §5 |
| 7 | SA change 1(f): resend probe (a)–(e) | Pass | (a) step 3: count of `processed_webhook_events` rows with that `event_id` and `status = 'completed'`, on the database that deployment uses, must be exactly 1; 0, an error or doubt means "do not resend", "not probed"; the event ID stays out of tracked text. (b) step 2: prefer a type that reaches no money handler, derived at use time, none named. (c) steps 5–6: pass is "Received event" then "Event already processed, skipping duplicate"; stop and escalate on "Event recorded, processing", "Retrying previously failed event" or `bos_webhook_stale_claim_reclaimed`. (d) step 1: each endpoint whose secret changed, from its own delivery list, with the both-secrets reason. (e) step 7: "pass, not conclusive (overlap)". **Verbatim in `app/api/stripe/webhook/route.ts`** (`grep -cF`): "Received event" 1, "Event already processed, skipping duplicate" 1, "Event recorded, processing" 1, "Retrying previously failed event" 1, `bos_webhook_stale_claim_reclaimed` 1, "Signature verification failed" 2, "No Stripe webhook secret configured" 1, "Invalid signature" 1, "Webhook secret not configured" 1, "Unhandled event type" 1; `duplicate: true` 3. Other names: `bos_billing_lookup_key_missing` in `planPriceCatalog.ts` and `planCheckoutPrice.ts`; `bos_billing_checkout_price_mismatch` in `planCheckoutPrice.ts`; `bos_billing_portal_configuration_` in `portalConfiguration.ts`; `STALE_CLAIM_AGE_MS` in the repository; `DEFAULT_RESOLVERS` in `webhookDispatcher.ts`; `charge.refunded` read in `boostChargeEvents.ts`; "not available right now" in `planBillingDocuments.ts`; `check-bos-plan-prices` in `package.json` |
| 8 | Cross-skill pointers resolve | Pass | `devops.md`: § What You Own (with "Platforms without a tool"), § Permission Tiers (the test-mode endpoint is in its Reversible row; "What you may write" label), § Tool Rules / "Supabase (plugin server only)" with rules (a)–(d), § Report Format. `vercel-ops` §2, §3, §4 with "Who probes what", the `NEXT_PUBLIC_` build-inline line and the 401/403 "not probed" line. `supabase-ops` §1, §2. `env-drift-audit` §1, §2, §3, §4, §5, §6, §7. `env-change-protocol` §3 steps 4 and 5. `claude-harness-ops` exists |
| 9 | `devops.md` | Pass | `git diff`: one hunk, +2/−0 (the D6-3 line and a blank line) after the "Platforms without a tool" paragraph. No `tools:` line in the diff |
| 10 | `env-drift-audit` | Pass | 145 lines (≤ ~150). +5/−2: §1 sentence (plus SA fix 3, the five area names), §3 Third-party row, §6 item 3, §7 one pointer bullet. G-, V-, S-, CH- rows, classes and the summary order are unchanged |
| 11 | Public repo (regex and prefixes) | Pass | The brief's regex over `git diff -U0` added lines with the new folder `git add -N`'d, then `git reset -q` (`git status` shows it untracked again): **0**. Extra over the same lines: `https?://`, `localhost:`, vendor identifier prefixes (publishable, restricted, customer, session, intent, event, price, portal-configuration, account-link, endpoint, product, subscription, invoice), `Users/`, the user's name, `worktrees/`, both private-doc names: 0 |
| 12 | Current env setup in tracked text | **Fail (Medium)** | Both new files: none. §D6.6 already carries the corrected wording (Q-D6-1 "checked by T-ST-3 and the checkout probe"; Q-D6-3 and Q-D6-2 no longer state the setup). **But** SA Code Review — DO-6a quotes the removed phrases verbatim, so the requirement still states them: see Issue 1 |
| 13 | Line endings, churn | Pass | CR count equals LF count in the three edited files (162, 145, 3096 before this report); `git ls-files --eol` shows `w/crlf`. `git diff --numstat` is the same with `--ignore-cr-at-eol` (2/0, 5/2, 485/2). The requirement's 2 removed lines are the §0 DO-6 row and the old "### DO-6 … ⬜" heading. The two new files are LF (0 CR), as in DO-5a and DO-5b |
| 14 | Only D6.3 files | Pass | `git status --untracked-files=all`: the three edited files and the two new files only. `env-change-protocol` and `CLAUDE.md` untouched (D6-5, D6-6) |
| 15 | Fresh-session load test | Deferred | Skills load at session start. Not failed |

### Issues Found

#### Bugs (must fix before commit)

1. **Current-state phrases survive as quotes in SA Code Review — DO-6a** — File: `docs/requirements/DEVOPS_AGENT_REQUIREMENT.md`, § SA Code Review — DO-6a: ruling 4, Code Review Comment 4 and Fix 2 — Severity: Medium.
   - Steps to reproduce: search § SA Code Review — DO-6a for quoted phrases that describe the current Preview or Vercel setup.
   - Expected: no tracked text states which environment's Stripe setup works or which targets hold a variable. SA ruled that rule applies (ruling 4) and removed the phrase from `stripe.md`.
   - Actual: ruling 4 quotes the two §D6.6 phrases, Comment 4 quotes the `stripe.md` phrase, and Fix 2 quotes it as the "before" text. The phrases were removed from §D6.6 and `stripe.md` but are now in the review instead. They hold no value or ID, so this is not High. Fix: describe the fixed text without quoting it, for example "a phrase stating Preview's current payment state" and "a phrase stating which targets hold QStash's variables". This is the requirement only, not the skill.

#### Edge Cases (nice to fix)

1. **§D6.5 Q-D6-3 "Suggested" reads like a fact** — "Preview uses test keys for checkout and the portal" is in the BA's suggestion, so it is a proposal, but it is written in the present tense. Optional rewording: "Preview would use test keys…". Severity: Low.
2. **New files are LF** — Git warns that they become CRLF on the next touch. Same as DO-5a and DO-5b, which SA ruled cosmetic. Severity: Low.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — the main session must fix Issue 1 (Medium, requirement text only) before commit. Every §D6.4 criterion and SA change 1(f) pass, and the skill files themselves need no change.

---

## SA Review — DO-6b (short pass)

**Reviewed by SA — 2026-11-01**
**Verdict: APPROVED WITH CHANGES.** The six-part shape, the tiers, the drift rows and the public-repo criteria are right, and most code findings hold. Three things would have made the skill wrong:
- **A second Gmail sender is missing.** The contact route reads the four `GMAIL_*` names itself and sends through Gmail directly. It skips the transport, its fallback order, Resend and `email_sends`. So E12's "the `GMAIL_*` names are only the system sender's fallback" is false.
- **The webhook replay probe has no overlap rule and no timestamp rule.** The route accepts any of several signatures (the vendor's rotation overlap) and refuses anything signed more than 300 s ago. A pass during a rotation proves nothing, and a replay that keeps its original timestamp fails whatever the secret.
- **The fallback count double-counts.** `NotificationService` also logs "Email sent" with a `provider` field, so counting that class without the module overstates sends.

E5 also understates which mail a missing sender address stops, and FU-D6b-c duplicates items that another requirement already tracks. Required changes 1–12 below fix all of these. None needs a new decision from the user.

I reviewed this in the DO-6b worktree at `origin/main` (merge of #604), against §D6.0–§D6.4, SA Review — DO-6 (spec) changes 1–7, SA Review — DO-5b (short pass) as the model, SA Code Review — DO-6a, QA Report — DO-6a, and `third-party-ops` `SKILL.md` and `stripe.md`. No platform call, no SQL and no network call were made. No `.env*` file and no private doc was opened. Local reads only: source files, `git grep origin/main`, `middleware.ts` and `package.json`.

### Code claims (E1–E12)

| # | Result | Correction for `email.md` |
|---|---|---|
| E1 | **Verified.** `resendConfigured` / `smtpConfigured` / `gmailConfigured`, fixed order, `provider: 'none'` last. | Partial sets leave no "skipped" line, but "Attempting to send email" carries `resendConfigured`, `smtpConfigured` and `gmailConfigured` as booleans. DO reads those fields, never the line. |
| E2 | **Verified.** The three strings are as quoted. The invalid-key line holds the vendor's key prefix, so the skill quotes only the substring "not a valid Resend key". | — |
| E3 | **Verified.** The production test is `VERCEL_ENV === 'production'`. A keyed send that fails at Resend logs "Resend keyed send failed — no fallback for a keyed send" on **every** deployment. | Add that class to the failure classes (change 6). |
| E4 | **Verified for SMTP, wrong for Gmail.** `sendEmail` sets `from` before any transport, so `SMTP_FROM` and `SMTP_FROM_NAME` never take effect. For Gmail the code passes that `from` as well, but the vendor overwrites From with the authenticated account unless the address is a verified send-as alias (vendor fact, confirm at use time). The comment in `sendViaGmail` says the code ignores the caller's `from`, and the code does not. | Gotcha: on SMTP, fallback mail carries the Resend-domain From through another relay, which may be refused or may fail alignment. On Gmail, the recipient most likely sees the Gmail account as the sender. Both go into FU-D6b-b, along with the catalogue role text for `SMTP_FROM` ("unset uses the SMTP login name"), which is false in effect. |
| E5 | **Understated.** `platformSenderAddress()` gates more than two senders. Fail-closed callers: the admin invitation, the friend invite, the inviter notification, the invite redemption system emails (the **signup code** and the existing-account notice), and the plan-cancel emails, including their reminder cron. The data-export callers pass the result as `from` and are **not** gated: an unset value falls through to the transport's default. The header comment "read by nobody else" is stale. | A missing or malformed sender address **stops invite-only signup**, because the code email is not sent, as well as the invites and the plan-cancel mail. The skill keeps "callers found at use time" and names the signup code as the example (change 4). |
| E6 | **Verified.** The secret check runs on every deployment; the header says "in production". A missing secret and a bad signature both return 401 with the same body, so only the log class tells them apart. An out-of-window timestamp logs "Webhook rejected: timestamp outside the replay window" **before** "Webhook signature did not verify". | The timestamp class goes into the probe (change 2). |
| E7 | **Verified.** The acted-on set is the `toDeliveryEvent` cases that return non-null, minus those the header marks not subscribed. The `ResendEventType` union is **not** the list: it holds a type that returns null. | One line for Dev: derive from the non-null returns, never from the union. Resend has one side only, so DO-6 change 5 (per side) does not apply. Say so in one line. |
| E8 | **Verified**, including "debug" for duplicates. An unacted type returns 200 with no log line, and an unparseable body logs "Webhook body was not JSON". | — |
| E9 | **Verified.** All 14 `email`-group names use the optional default. `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` is in group `features`, not `email`, so T-EM-1 does not see it. | The skill names the flag in part (2), as drafted. |
| E10 | **Verified.** The historic default is `sendgrid`, no writer produces it, and `recordEmailSend.ts` writes `result.provider`. | See S-3 (change 9). |
| E11 | **Verified, but already tracked.** `ADMIN_BOS_CLEANUP_REQUIREMENT.md` records the replay route's defects (V-12, NF-6), and its decision UC-2 keeps the Messages page as it is. | See S-5. |
| E12 | **Wrong** (see the verdict). `lib/plugins/google-mail/sendEmailDraft.ts` is indeed the user's own connection. But `app/api/contact/route.ts` builds its own Gmail transport from the four `GMAIL_*` names. | Change 1. |
| E11 (SendGrid re-check) | **Verified.** No transport. | — |

### The grep gap: readers the spec missed

| File | Ruling |
|---|---|
| `app/api/contact/route.ts` | **A second Gmail sender, outside the transport.** Add it to part (2) and part (5). A broken Gmail token stops contact-route mail even where Resend works, and a working Resend proves nothing about it. T-EM-3 (all-or-none) and T-EM-8 cover this route as well. Its callers are tracked as V-14 in `ADMIN_BOS_CLEANUP_REQUIREMENT.md`; the skill points there and opens nothing new. **Never a probe.** |
| `lib/business-os/billing/planCancelEmail.ts`, `planCancelEmailsFlag.ts`, `lib/email/templates/plan-cancel.ts` | **The only env flag that gates sending email.** With the flag on and no sender address, the route sends nothing, audits `sender_not_configured`, and logs an `error` with `alert: true`. The flag also gates the plan-cancel reminder cron (`docs/feature_flags.md`). Order row: the flag goes on only after the send probe passes on that deployment (change 7). No other env flag gates sending (I checked the catalogue's flag rows). |
| `lib/business-os/invites/{inviteEmail,inviteEmailPolicy,inviterNotification,redemptionDeps}.ts` | Fail-closed on the sender address. See E5. |
| `lib/calibration/calibrationResultEmail.ts` | **Does not read `RESEND_API_KEY`.** The name appears only inside a log string. It sends through `NotificationService` and then `sendEmail`, so it follows the transport order. |
| `lib/pilot/NotificationService.ts` | Goes through `sendEmail`. Its comments describe a two-provider order, which is stale (FU-D6b-b comment sweep). **It logs "Email sent" with `provider` too**, so DO's count must be limited to module `EmailTransport` (change 6). |
| `lib/admin/environment/catalogue.ts`, `lib/notifications/emailTransport.ts`, `app/api/webhooks/resend/route.ts` | Covered in E1–E9. |
| `scripts/resend-webhook-smoke.ts` (`npm run resend:smoke`) | **An existing probe. It may be used, with limits.** It signs a synthetic event with the secret in hand and invents a message id by default, so the route answers "unknown message id" and writes nothing. It proves that the **deployed** secret equals the **held** one, not that the vendor's endpoint secret equals the deployed one. **Allowed:** by the key holder, for local, or for a non-production stable address, with **default arguments only** (no `--id`, no `--type`). With a real `--id` it writes to that row, and with a status type it changes that row's status. **Never against production:** it would put the production secret in hand and send a synthetic event, which `stripe.md` §5 already forbids for the same reason. Production uses the vendor replay. The npm script reads the checkout's `.env.local`, so it is a local tool by construction. |
| `scripts/validate-resend.mjs` | **A key-holder pre-check only, never the post-change probe, and without `--to`.** `--to` sends straight to the vendor, skipping the transport, so it proves only the key in hand. It reads `.env.local` from the working directory, falling back name by name. So for any non-local key, the holder runs it from a directory outside every checkout, with the values set in that shell only. Its output holds domain names, a key fragment and a message id: the user reports the verdict line only. It lists domains, which a sending-only key may not be allowed to do, so a 401 there can mean "correctly scoped" rather than "invalid" (vendor fact, confirm at use time). Its default-domain advice is about `RESEND_DEFAULT_FROM`, not the configured sender. |
| `scripts/validate-gmail.mjs` | **A key-holder pre-check for T-EM-8.** It exchanges the refresh token and sends no mail. The same conditions as `validate-resend.mjs` apply: outside every checkout for non-local values, and the verdict and error code only. Its output prints the account address and fragments of the secrets. |
| `scripts/generate-gmail-token.js` | **The rotation tool for `GMAIL_REFRESH_TOKEN`.** It prints the token to the terminal and says "add to `.env.local`". For a non-local target the value goes straight from the terminal into Vercel (`vercel-ops`, `env-change-protocol`), never into chat or a file inside a checkout. It needs a loopback redirect registered on the Gmail OAuth client, which is a DO-6c console fact. The script's own guidance is that a consent screen left in testing makes tokens expire within days (confirm at use time). That belongs in T-EM-8. |

### S-4: the replay probe, confirmed in `recordDeliveryEvent`

- **A replayed event whose type carries no status is safe in every case.** A delivered-type event writes `delivered_at` only when it is null, and never touches `status`. So a replay is either `duplicate` (no write) or one write of the true delivery time. `unmatched` writes nothing. There is no money and no status change, so unlike `stripe.md` no database precondition is needed. The precondition becomes: **the event's type, per `toDeliveryEvent`, returns no `status`**, derived at use time and never named in the skill.
- **A status-carrying type always writes.** `status` and `error_message` are patched on every delivery, so the result is never `duplicate`. "Never replay a status-changing event" stands, and is now grounded.
- **Two conditions the spec lacks** (change 2):
  - (a) **Timestamp.** The route refuses a signature timestamp more than `MAX_AGE_SECONDS` old. If the vendor's replay keeps the original signing time, every replay fails whatever the secret. Whether a replay is re-signed at send time is a vendor fact, confirmed at use time. A 401 with "Webhook rejected: timestamp outside the replay window" in the window is **"not probed (timestamp)"**, never a secret failure.
  - (b) **Overlap.** `verify` accepts any one signature in the header, and during the vendor's rotation both the old and the new secret sign. A pass while the old secret is still valid is **"pass, not conclusive (overlap)"** (DO-6 change 1(e)). The gotcha "the rotation may have no overlap" is replaced: check the vendor docs at use time, and with an overlap the result is not conclusive until it ends.
- **A dashboard 200 is otherwise conclusive.** Every 200 the route returns comes after `verify`. So pass = 200, plus 0 "Webhook signature did not verify", 0 "RESEND_WEBHOOK_SECRET not configured" and 0 timestamp lines after the probe time, outside an overlap.

### Rulings on S-1 to S-5 and the follow-ups

- **S-1: accepted.** The expected names per environment come from the private inventory. **FU-D6b-a (Dev, code, Low):** mark `RESEND_API_KEY` and `RESEND_FROM_EMAIL` required in production, with the catalogue tests. The transport already rules that production always has Resend (its SA Q-7 note), so this records an existing decision. `RESEND_WEBHOOK_SECRET` stays optional in this FU: whether production must receive delivery events is the Q-D6b-2 target, and Dev raises it with SA in the FU workplan rather than deciding it here.
- **S-2: accepted, widened.** It is a gotcha only in DO-6b. **FU-D6b-b (Dev, code):** decide which From SMTP and Gmail send with. Fix the comments that state a different order or sender: the `from` field comment, the `sendViaGmail` comment, "read by nobody else", and the `NotificationService` order comments. Fix the catalogue role text for `SMTP_FROM`. One FU, because these all describe the same behaviour.
- **S-3: accepted, with one precision.** The query counts by `provider` and by `status`, and may **filter** on `created_at` after the change time. It never selects or groups by any other column. As drafted, "never another column" would forbid the time filter the row itself asks for (change 9).
- **S-4: confirmed** (above).
- **S-5: no new follow-up.** The replay route's defects are V-12 and NF-6 in `ADMIN_BOS_CLEANUP_REQUIREMENT.md`, under the user's decision UC-2. FU-D6b-c is dropped. The DO-6b record adds one line: "E11: already tracked (ADMIN_BOS_CLEANUP NF-6, V-12)". `email.md` does not mention the route.

### Rulings on Q-D6b-1 and Q-D6b-2

Both are technical, so SA settles them. Neither goes to the user.

- **Q-D6b-1: settled by SA, so it is not a question.** The send order is fixed in code. Resend always goes first where its names are set, so "which provider sends first" is not a per-environment choice: it follows from which names are set. The target is already decided in code (production always has Resend, the transport's SA Q-7). Which fallbacks exist on each target is current state, recorded in the private inventory. DO-6b changes nothing. Whether to keep the SMTP and Gmail fallbacks in production at all depends on FU-D6b-b's From decision, so it is settled there, with SA, not asked now. Part (1)'s first row becomes "Which providers have their names set: as recorded; the order is fixed by code (E1); production target: Resend set (E3)".
- **Q-D6b-2: settled by SA. No endpoint for Preview.** The reasons are technical and match the user's own Q-D6-3 direction for Stripe: Preview has no stable address, it sits behind deployment protection, and the route correctly refuses every event without a secret. Delivery tracking is checked where an endpoint is recorded, with the replay probe. Any later wish for Preview delivery events is a separate item.

### Required changes

1. **[E12, (2), (5), T-EM-3, T-EM-8] Add the contact route as the second `GMAIL_*` reader.** Part (2) names `app/api/contact/route.ts`: "reads the four Gmail names itself; does not use the transport, its order, Resend or `email_sends`". Gotcha: "a working Resend proves nothing about contact-route mail; a broken Gmail token stops it alone". T-EM-3 and T-EM-8 apply to it too. Never a probe. Whether it has a caller is a pointer to V-14 in `ADMIN_BOS_CLEANUP_REQUIREMENT.md`. Correct E12 in the record. — Priority: High
2. **[(4) webhook row, (5)] Replay probe: precondition by derivation, and timestamp and overlap results.** The precondition is "an event whose type, per `toDeliveryEvent`, carries no `status`", derived at use time and never named. An unmatched event is also safe. Add "not probed (timestamp)" for the window line and "pass, not conclusive (overlap)" during a rotation (S-4 (a) and (b)). Replace the "may have no overlap" gotcha. Keep "never replay a status-carrying type". — Priority: High
3. **[(2), (4)] The existing scripts, as ruled in the table above.** `resend-webhook-smoke.ts`: local or a non-production stable address, default arguments only, never production. `validate-resend.mjs` (no `--to`) and `validate-gmail.mjs`: key-holder pre-checks, run outside every checkout for non-local values, verdict only, and never the post-change probe. `generate-gmail-token.js`: the rotation tool, with the value going from the terminal straight into Vercel and the loopback redirect pointed to DO-6c. — Priority: High
4. **[E5, (5)] Widen the sender-address gotcha.** "A missing or malformed `RESEND_FROM_EMAIL` stops every caller that gates on `platformSenderAddress()` (found at use time), including the invite signup code, so invite-only signup stops, as well as invitations and the plan-cancel mail. Logged and audited, never a failed request." Correct E5 in the record, including that the data-export callers are not gated. — Priority: Medium
5. **[E4, (5)] Split the From gotcha by provider.** SMTP sends the Resend-domain From through another relay, which may be refused or fail alignment. Gmail is handed it, and the vendor shows the authenticated account unless the address is a verified alias (confirm at use time). Both are FU-D6b-b. — Priority: Medium
6. **[(4) send probe, fallback-health row, T-EM-4] Name the failure classes and the module.** Count "Email sent" by `provider` **for module `EmailTransport` only**: `NotificationService` logs the same class. Failure classes, verbatim: "Resend API error", "Resend send failed — trying next transport", "Resend keyed send failed — no fallback for a keyed send", "SMTP send failed — trying next transport", "Gmail send failed", "No email transport delivered the message (preview only)", the "not a valid Resend key" substring, and the two `idempotency_unsupported` lines (quote the code `idempotency_unsupported` itself). The send probe's log lines hold the recipient's address: classes and counts only, never a copied line. — Priority: Medium
7. **[(7) order] Add the plan-cancel flag row.** `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` goes on for a deployment only after the send probe has passed there with a sender-gated trigger. It also gates the reminder cron. — Priority: Medium
8. **[(4) send probe] Fix the trigger's conditions now, and name its side effects** (DO-6 change 2). Dev picks a trigger that: goes through `sendEmail`; is gated on `platformSenderAddress()`, so that it also proves E5; goes to an address the user owns; moves no money and touches no customer's data. The admin invitation to the user's own address meets all four if Dev confirms the existing-account branch at build. Its side effects (an invite row, an audit row) are named, as is their cleanup (revoke). If no trigger meets all four, the probe is "not probed", never improvised. — Priority: Medium
9. **[S-3, supporting SQL] Allow the time filter.** Counts by `provider` and `status`, filtered on `created_at` after the change time; no other column selected or grouped. — Priority: Low
10. **[(1)] One Resend account per environment, as recorded, and no mode to rely on.** Add a row: "Which Resend account: private inventory. One endpoint receives events for every key on its account, so environments sharing an account share events. The route answers those 200 'unknown message id'." That Resend has no test/live split is a vendor fact, confirmed at use time. Replace part (1)'s first row as in the Q-D6b-1 ruling. — Priority: Medium
11. **[T-EM-5] Add "open and click tracking off for the sending domain".** The route's header records it as a decision, and turning it on changes every message's links and adds a pixel. — Priority: Low
12. **[§D6b intro, D6b.4] Public-repo wording and one criterion.** The intro's "named on Vercel" states the current setup. Use the DO-6a wording: "The main session confirmed on 2026-11-01 that all three are still in use, so all three stay." In D6b.4 the copied-list grep `email\.[a-z_]+` matches the file name `email.md` itself, so QA excludes `email\.md` before counting. Target length: ~170 lines, as for `stripe.md`. If it runs over, Dev trims prose, never probe or drift rows. — Priority: Low

### Checked and honoured

- **DO-6 changes 1–7:** a probe with a failed precondition is "not probed" (changes 2 and 8 here); overlap is "not conclusive" (change 2); local is "not read" in T-EM-1; per-side derivation does not apply to a one-sided vendor (E7); no copied lists; the T- rows live in `email.md`.
- **Probe safety:** no probe moves money or changes a status. No probe needs DO to hold a secret. No probe disables Resend to reach a fallback. Every vendor fact used (replay re-signing, rotation overlap, Gmail From rewriting, key scopes, Resend modes) is marked "confirm at use time".
- **Tiers:** every key, secret, domain, DNS and credential action is production tier. The DNS records stay with DO-6e and the Google console with DO-6c.
- **CI time:** none. Config and docs only.
- **Files:** D6b-1 and D6b-2 only. `stripe.md`, `devops.md`, `env-drift-audit`, `env-change-protocol` and `CLAUDE.md` are not edited.
- **Public repo:** this review names files, functions, env var names and log classes only. It holds no domain, address, endpoint URL, key prefix, project reference or current setup.

### Approval

[x] DO-6b spec approved with changes. **Dev may build** D6b-1 (`.claude/skills/third-party-ops/email.md`) and D6b-2 (the `SKILL.md` index row and triggers), with changes 1–12 applied. The user does not need to be asked anything (Q-D6b-1 and Q-D6b-2 are settled above). SA does a code review, then QA.

---

## DO-6b implementation notes

**By Dev — 2026-11-01.** Branch `feature/devops-third-party-email`, worktree at `origin/main`. Config/docs only; nothing committed.

| File | Change |
|---|---|
| `.claude/skills/third-party-ops/email.md` | New, 131 lines: six parts plus tiers and order, T-EM-1..8, mirroring `stripe.md`'s section order and table style |
| `.claude/skills/third-party-ops/SKILL.md` | §5 index row now points at `email.md`; description triggers gain "Resend, SMTP, a sender address, an email delivery webhook" (D6b-2 as SA-approved). CRLF preserved; 2 lines changed |

| SA change | Where / how applied |
|---|---|
| 1 | §2 row names `app/api/contact/route.ts` as a second `GMAIL_*` reader outside the transport, with the V-14 pointer; §5 "Two Gmail readers"; T-EM-3 and T-EM-8 cover it; §4 send probe says it is never a probe |
| 2 | §4 replay probe steps 1–5: precondition derived from `toDeliveryEvent` (no `status`), unmatched also safe, never a status-carrying type; "not probed (timestamp)"; "pass, not conclusive (overlap)"; the old "may have no overlap" gotcha removed |
| 3 | §2 "Existing scripts" table, one row per script, with the SA limits (default args only / never production; no `--to`; outside every checkout; verdict only; token from terminal straight into Vercel; loopback redirect to DO-6c) |
| 4 | §5 "Sender address" gotcha, naming the invite signup code via `redemptionDeps.ts`; callers found at use time |
| 5 | §5 "From by provider", split SMTP vs Gmail, both pointed to FU-D6b-b |
| 6 | §4 "Transport failure classes" paragraph, verbatim strings, module `EmailTransport` only for "Email sent"; "never a copied line (the send lines carry the recipient)"; T-EM-4 points at it |
| 7 | §7 order row for `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED`, including the reminder cron |
| 8 | §4 "The send probe": the four conditions, the admin invitation as trigger, side effects (invite row, audit entries), cleanup (revoke route), otherwise "not probed" |
| 9 | §4 supporting SQL: counts by `provider` and `status`, filtered on `created_at`, no other column |
| 10 | §1 row "Which Resend account" (shared events, "unknown message id", no test/live split confirm at use time); first row replaced per the Q-D6b-1 ruling; §5 "Shared account" |
| 11 | T-EM-5 adds "open and click tracking off", expected state also from the route header |
| 12 | Spec intro reworded in `do6b-spec-final.md`; D6b.4 grep excludes `email\.md`; file is 131 lines (under 170) |

**Verification done.** Every path named in `email.md` exists (scripted check). Every quoted log string is found by `grep -cF` in its file: the transport classes in `emailTransport.ts`, the webhook classes in the route, "Email sent" also in `NotificationService.ts`. The no-existing-account check in the admin invite create path was confirmed by reading `createInviteForAdmin`. `recordDeliveryEvent` duplicate behaviour confirmed (a delivered timestamp is written only when null; a status is patched every time). The leak scan prints nothing before "scan exit 1". `email\.[a-z_]+` over `email.md`: 0 hits.

**Could not verify / deviations.**
- SA attributed the "unpublished OAuth app → token expires in 7 days" guidance to `generate-gmail-token.js`; it is actually in `scripts/validate-gmail.mjs`. `email.md` grounds it there.
- Vendor facts (replay re-signing, rotation overlap, Gmail From rewriting, key scopes, no test/live split, domain-list refusal for a sending-only key) are not verifiable from code; each is marked "confirm at use time".
- That a revoked, never-opened invite leaves no other side effect beyond the row and audit entries was read from the create path, not run.

---

## SA Code Review — DO-6b

**Code Review by SA — 2026-11-01**
**Status:** ✅ Code Approved for QA. SA made five small wording fixes directly (below). No condition before commit.

Reviewed in the DO-6b worktree on the uncommitted changes, against §D6b.1–§D6b.4, SA Review — DO-6b (short pass) changes 1–12, the DO-6b implementation notes, and the shape of `stripe.md` and SKILL.md §4. No platform call, no SQL, no vendor call, no network call. No `.env*` file and no private doc was opened. Local reads only: source files, scripts, `package.json`, `git diff`, byte counts.

### Code claims (spot-check)

| Claim in `email.md` | Result |
|---|---|
| Every backticked file path exists | **Verified** (scripted `test -e`; the only non-matches are bare names such as `stripe.md` and `devops.md`, which resolve in context) |
| `resendConfigured` / `smtpConfigured` / `gmailConfigured` / `sendEmail` / `platformSenderAddress` in `emailTransport.ts`; fixed order; "Attempting to send email" carries the three booleans | **Verified** |
| The transport failure classes, verbatim | **Verified,** each by `grep -cF` in `emailTransport.ts`. "Two lines carrying `idempotency_unsupported`" is right: the code appears four times, but only two are log lines (the production refusal and the outside-production warn) |
| "Email sent" also logged by `NotificationService` | **Verified:** module `NotificationService` logs it with `provider`; the transport logger is module `EmailTransport` |
| `from` set before any provider; SMTP `SMTP_FROM` / `SMTP_FROM_NAME` never take effect; Gmail handed the same `from` | **Verified** (`resolveSender` result written into the params before the Resend branch) |
| Webhook strings, `verify`, `toDeliveryEvent`, `MAX_AGE_SECONDS`, "DELIBERATELY NOT SUBSCRIBED", the header's "in production" vs the code's every-deployment check | **Verified.** The secret line is quoted as a substring of the full message, which is fine for a count |
| Replay precondition vs `toDeliveryEvent` / `recordDeliveryEvent` | **Verified, one precision added** (fix 2). The status-free types are the delivered, opened and clicked cases. A delivered timestamp is written only when null; an open or click writes its timestamp and **increments its count** only when the event is newer than the stored one, so a replay of an already-recorded event is `duplicate`. A replay can write only what the first delivery failed to record. Status-carrying types patch status and error every time. `unmatched` writes nothing |
| Send probe: admin invitation via `createInviteForAdmin` | **Verified, two gaps closed** (fix 1). The create path does not check for an existing account; the email goes through `sendInvitationEmail`, which checks `platformSenderAddress()` first (`sender_not_configured`, `sendEmail` not called) and then calls `sendEmail` unkeyed and transactional, with the recipient redacted from logs. Money: none at create; a Paid type sells a plan only on redemption, but the probe now says non-Paid. Gaps: the email is sent only when the create's `sendEmail` option is true, and the revoke route writes its own audit entry. Invitation mail has no contact, so it writes no `email_sends` row: the supporting SQL will not see the probe, which the skill already treats as supporting only |
| Sender gotcha: `redemptionDeps.ts` gates the signup code | **Verified** (`platformSenderAddress()` then `sender_not_configured`) |
| Scripts: smoke `--id` / `--type` / invented id / npm script reads `.env.local`; `validate-resend.mjs` `--to` and cwd `.env.local`; `validate-gmail.mjs` cwd `.env.local`; `generate-gmail-token.js` loopback redirect and prints the token | **Verified.** The smoke script needs `--url` to reach a non-production address, which "default arguments only" forbade by its letter (fix 3) |
| The 7-day-token guidance is in `validate-gmail.mjs`, not `generate-gmail-token.js` | **Confirmed.** Dev's correction of my short-pass attribution is right; `email.md` grounds it correctly |
| Plan-cancel flag: group `features`, gates the reminder cron, needs the sender address | **Verified** (catalogue row, `docs/feature_flags.md`). The §7 order row is right |
| Contact route reads the four `GMAIL_*` names itself, no transport, no `email_sends` | **Verified** |
| `recordEmailSend.ts` records only mail tied to a contact | **Verified** |

### Required changes 1–12

| # | Result |
|---|---|
| 1 | **Pass.** §2 row, §5 "Two Gmail readers", T-EM-3, T-EM-8, "never a probe". The V-14 pointer goes to the row on whether the route has a caller |
| 2 | **Pass,** refined by fix 2. Steps 1–5 hold the derived precondition, unmatched-is-safe, timestamp and overlap results, and "never replay a status-carrying type" |
| 3 | **Pass,** refined by fix 3 |
| 4 | **Pass** |
| 5 | **Pass** |
| 6 | **Pass.** Module limit, verbatim classes, counts only |
| 7 | **Pass** |
| 8 | **Pass,** refined by fix 1 |
| 9 | **Pass** |
| 10 | **Pass.** §1 first row as the Q-D6b-1 ruling; account row; §5 "Shared account" |
| 11 | **Pass** |
| 12 | **Pass.** Spec intro uses the live-check wording; D6b.4 excludes `email\.md`; 131 lines |

### Code Review Comments

1. Shape: six parts plus tiers and order, in `stripe.md`'s order and table style; one "Rule per environment" column with a target sentence; T-EM rows in the `env-drift-audit` §7 column format. — Pass
2. SKILL.md: index row and description triggers only (D6b-2); frontmatter still one line. — Pass
3. Send probe left the `sendEmail` create option and the revoke's audit entry unstated. **SA fixed** (fix 1). — Medium (fixed)
4. Replay precondition said a replay "writes one missing timestamp", which misses the open/click count. **SA fixed** (fix 2). — Low (fixed)
5. Smoke script: "default arguments only" read literally forbade `--url`. **SA fixed** (fix 3). — Low (fixed)
6. Wording: two phrases in my own short pass said more about the contact route than the skill needs. **SA fixed** (fixes 4, 5). — Low (fixed)
7. No copied lists: no event-type name, no key or secret prefix, no line number in `email.md`. — Pass
8. Public repo: the brief's regex over every added line (new file `git add -N`'d, then `git reset`), re-run after the fixes: **0**. A further grep for URLs, domains and environment-placement phrases: no real hit (the only near-hit is the SA ruling that Preview gets no endpoint, which is a target, not current state). — Pass
9. Line endings: `email.md` is LF (new file, as in DO-6a); the two edited files keep CRLF (CR count equals LF count). — Pass
10. CI time: none. Docs and config only. — Pass

### Fixes made by SA

1. `email.md` §4 send probe: the invitation is created "with the send-email option on (off, nothing is sent) and a non-Paid type"; side effects add "the revoke adds one more".
2. `email.md` §4 replay step 1: "writes one missing timestamp" → "writes only what the first delivery failed to record (a missing timestamp, and for an open or click its count once)".
3. `email.md` §2 smoke-script row: "default arguments only" → "default arguments only apart from `--url`".
4. This file, SA Review — DO-6b (short pass), verdict bullet: one adjective dropped; it now reads "The contact route reads…".
5. This file, same review, grep-gap table, contact-route row: the "never a probe" wording was narrowed (later narrowed further by the main session after QA).

### Optimisation Suggestions

- The send probe's "Fails when" names provider `none`, which no "Email sent" line carries; the "No email transport delivered" class already catches it. A later edit could say "no 'Email sent' line" instead. Not blocking.
- §0's DO-6 row still reads "awaiting SA code review + QA"; the main session updates it with the QA result.

### Code Approved for QA: Yes

---

## QA Report — DO-6b

**QA — 2026-11-01**
**Test mode:** full · **Strategy:** static checks (grep, `grep -cF` verbatim string lookup, path and link existence, YAML parse, byte-level line-ending count, `git diff --numstat` with and without `--ignore-cr-at-eol`, read-through against the code). This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public repo, current-state text, probe safety), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1 to DO-6a) · **Input source:** TL prompt + §D6b.4 + SA Review — DO-6b (short pass) changes 1–12 + SA Code Review — DO-6b. Run in the DO-6b worktree on the uncommitted changes. No platform call, no SQL, no vendor call, no network call. No `.env*` file and no private doc was opened. QA edited nothing except this section and one Change History row; §0's DO-6 row is left to the main session.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | §D6b.4: six parts plus tiers/order; paths exist; live check by role | Pass | Headings §1–§7 in the same order and wording as `stripe.md`. Every backticked path tested with `test -e`: 16 exist, 0 missing (the only non-hit is `origin/main`, not a path). The live check is stated as a procedure ("confirm the three services are still live … a code path that runs, and the names set on Vercel"), naming no environment |
| 2 | §D6b.4: no copied lists | Pass | `email\.[a-z_]+` over `email.md`, excluding `email\.md`: 0. The vendor's API-key prefix, its webhook-secret prefix and the signing-scheme name, line numbers (`L123`, `line 123`, `:123`): 0. The `idempotency_unsupported` code and the "not a valid Resend key" substring are log-message text, as the criterion allows |
| 3 | §D6b.4: quoted log strings verbatim | Pass | `grep -cF` in `lib/notifications/emailTransport.ts`: "Resend API error" 2, "Resend send failed — trying next transport" 1, "Resend keyed send failed — no fallback for a keyed send" 1, "SMTP send failed — trying next transport" 1, "Gmail send failed" 1, "No email transport delivered the message (preview only)" 1, "not a valid Resend key" 1, "Attempting to send email" 1, "Email sent" 3, `idempotency_unsupported` 4, of which exactly 2 are log lines (the production refusal and the outside-production warn), "relay refused" 1 (inside the error the SMTP failure line logs). Module is `EmailTransport` (`createLogger`). `NotificationService.ts` logs "Email sent" with `provider` too. In `app/api/webhooks/resend/route.ts`: "Webhook signature did not verify" 1, "RESEND_WEBHOOK_SECRET not configured" 1 (substring of the full message), "Webhook rejected: timestamp outside the replay window" 1, "No email_sends row carries this message id" 1, "Delivery event added nothing new" 1 (a `debug` call), "Could not record the delivery event" 1, "DELIBERATELY NOT SUBSCRIBED" 1, "unknown message id" 1 |
| 4 | §D6b.4: probe rows | Pass | All 6 rows of the probe table name who runs it, the pass and the fail. Replay probe: precondition by derivation (no `status` per `toDeliveryEvent`), unmatched is safe, timestamp → "not probed (timestamp)", overlap → "pass, not conclusive (overlap)", never a status-carrying type. "No probe breaks Resend to reach a fallback" and "the contact route … is **never** a probe" are stated. See Edge Case 1 |
| 5 | §D6b.4: restatement grep (§D6.4 list) | Pass | `Snapshot the before-state`, `\| **Read** \|`, `begin read only`, `filter_project_envs`, `decrypt` over `email.md`: 0 |
| 6 | §D6b.4: public repo | Pass (skill files) | The brief's regex over all added lines (`email.md` `git add -N`'d, then `git reset -q`; `git status` shows it untracked again): **0** ("scan exit 1"). Extra over the same 443 added lines: `https?://`, `localhost`, `.com`/`.io`/`.ai`, product, repo and person names, `worktrees/`, `Users/`, both private-doc names: 0. The built-in default sender is named only as `RESEND_DEFAULT_FROM`. No line states which environment has which name: the only placement phrases are the code-decided target ("production always has Resend set", from the transport's keyed-send refusal) and the SA ruling that Preview gets no endpoint (a target) |
| 7 | §D6b.4: diff touches only D6b.3 files; SKILL.md only D6b-2 | Pass | `git status --untracked-files=all`: the two edited files and `email.md` only. SKILL.md diff: the description gains "Resend, SMTP, a sender address, an email delivery webhook" and the §5 Email row becomes `[email.md](email.md)`; nothing else. `stripe.md`, `devops.md`, `env-drift-audit`, `env-change-protocol`, `CLAUDE.md` untouched |
| 8 | SA short-pass changes 1–12 in `email.md` | Pass | 1 §2 contact-route row (V-14 pointer), §5 "Two Gmail readers", T-EM-3, T-EM-8, "never a probe". 2 replay steps 1–5. 3 §2 scripts table with every SA limit (smoke: default arguments apart from `--url`, never production; `validate-resend.mjs` never `--to`; outside every checkout; verdict only; token terminal → Vercel; loopback redirect → DO-6c). 4 §5 "Sender address" names `redemptionDeps.ts`, callers found at use time. 5 §5 "From by provider" split, FU-D6b-b. 6 §4 failure classes, module `EmailTransport` only, counts never lines. 7 §7 plan-cancel row incl. reminder cron. 8 send probe: four conditions, trigger, side effects, cleanup, "not probed". 9 supporting SQL: `provider`/`status`, `created_at` filter, no other column. 10 §1 account row, first row per Q-D6b-1, §5 "Shared account". 11 T-EM-5 tracking off. 12 131 lines; D6b.4 excludes `email\.md` |
| 9 | Replay-probe safe-type precondition vs code | Pass | `toDeliveryEvent`: the delivered, opened and clicked cases return no `status`; bounced, complained and failed return one; delivery-delayed and default return null. `recordDeliveryEvent` (`EmailAutomationRepository.ts`): delivered timestamp written only when null; open/click timestamp and count only when the event is newer than the stored one; `status` and `error_message` patched whenever present; empty patch → `duplicate`; no row → `unmatched`. So a replay of a status-free type writes nothing, or only what the first delivery missed, as `email.md` says |
| 10 | Send-probe trigger gating vs code | Pass | `createInviteForAdmin` (`adminInviteOps.ts`): no existing-account check; returns before any send when `sendEmail` is false; otherwise calls `sendInvitationEmail`, which reads `deps.senderAddress()` first and records `sender_not_configured` without sending. The admin invites route wires `senderAddress: platformSenderAddress`. Audits: `BOS_INVITE_CREATED`, then `BOS_INVITE_EMAIL_SENT` or `…_NOT_SENT`; the revoke route adds `BOS_INVITE_REVOKED`. `platformSenderAddress()` reads only `RESEND_FROM_EMAIL` |
| 11 | Plan-cancel flag order row | Pass | Catalogue: `flag('BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED', 'features', …)` with "needs the Resend sender address". `docs/feature_flags.md` 1.16.1: it also gates the reminder cron. `planCancelEmailDeps.ts` gates on `platformSenderAddress()`. §7 row matches |
| 12 | Other code claims (sample) | Pass | `sendEmail` resolves `from` once before any transport (`resolveSender`, fallback `RESEND_DEFAULT_FROM`); the secret check runs before any `NODE_ENV`/`VERCEL_ENV` test (every deployment); `verify` accepts any one `v1,` signature; `MAX_AGE_SECONDS` exists; contact route reads all four `GMAIL_*` names and has 0 references to the transport; `email_sends.provider` default `sendgrid` only in the original migration; `validate-gmail.mjs` holds the consent-screen expiry note; `resend:smoke` uses `--env-file=.env.local`; the smoke script invents a message id with no `--id`; `generate-gmail-token.js` uses a loopback redirect and prints the token |
| 13 | Template parity | Pass | Same intro sentence as `stripe.md` (one extra live-check line), same seven headings, one "Rule per environment" column with a target sentence, scripts table, probe table columns `Change \| Probe \| Pass \| Fails when \| Who`, drift table columns `ID \| Check \| Expected state from \| Live read (pointer) \| Class \| Who reads` (the `env-drift-audit` §7 shape), tiers paragraph plus order table. SKILL.md §5 row matches the Stripe row's style. 131 lines (≤ 170) |
| 14 | SKILL.md frontmatter and triggers | Pass | js-yaml parse: keys `name`, `description`; description 1,010 chars on one line. The new triggers are sensible and sit next to the existing "a sending domain". See Edge Case 3 |
| 15 | Line endings, churn | Pass | CR = LF in the requirement (3449/3449 before this report) and SKILL.md (86/86); `git ls-files --eol`: `w/crlf`. `--numstat` is the same with `--ignore-cr-at-eol` (2/2, 131/0, 307/1); the requirement's 1 removed line is the §0 DO-6 row. `email.md` is LF (0 CR), accepted as in DO-6a |
| 16 | Relative links | Pass | `email.md` has no markdown links (pointers are backticked names). SKILL.md: `stripe.md` and `email.md` resolve. Cross-skill sections cited exist: `vercel-ops` §3 (Env vars) and §4, `env-drift-audit` §7, `devops.md` § Permission Tiers and Tool Rules (a)–(c) (as in `stripe.md`) |
| 17 | Contact-route wording in tracked text | **Fail (Medium)** | `email.md`: clean (second `GMAIL_*` reader outside the transport, never a probe). **But** the requirement's added text says more: see Issue 1 |
| 18 | Quotes of removed text | Pass with note | No section quotes a removed current-state or sensitive phrase. SA Code Review — DO-6b fixes 2 and 3 quote the "before" wording of two technical imprecisions; that is not the DO-6a issue class. Fix 4 describes the dropped adjective without quoting it |
| 19 | Fresh-session load test | Deferred | Skills load at session start. Not failed |

### Issues Found

#### Bugs (must fix before commit)

1. **The requirement describes the contact route beyond "a second `GMAIL_*` reader outside the transport"** — File: `docs/requirements/DEVOPS_AGENT_REQUIREMENT.md` — Severity: Medium.
   - Steps to reproduce: search the added text of SA Review — DO-6b (short pass) and SA Code Review — DO-6b for the contact route.
   - Expected: the route is described only as a second reader of the four `GMAIL_*` names that skips the transport, its order, Resend and `email_sends`, with the V-14 pointer, as `email.md` does.
   - Actual: three passages (the short pass's E12 row, its grep-gap contact-route row, and SA Code Review — DO-6b fix 5) said more about the route than that. No value or ID was involved, so this was not High. Requirement text only; the skill files needed no change.
   - **Fixed by the main session 2026-11-01:** all three reworded to the `email.md` description; no removed wording is quoted here.

#### Edge Cases (nice to fix)

1. **Webhook-secret row's "Fails when" does not reference the timestamp case** — `email.md` §4. On a stale timestamp, `verify` logs the timestamp line and the route then also logs "Webhook signature did not verify". So the row's "401 with a signature or secret line" also matches a timestamp refusal; only step 3 of the replay probe reclassifies it as "not probed (timestamp)". Optional: add "(unless the timestamp line is present: step 3)" to the row. Severity: Low.
2. **§D6b.2 lags SA's code-review fixes** — the spec's replay paragraph still says a replay "writes nothing or one missing timestamp" (no open/click count), its scripts sentence says "default arguments only" (no `--url` exception), and its send-probe paragraph omits the send-email option and the revoke's audit entry. `email.md` is correct; the spec is the older text. Severity: Low.
3. **No trigger for the Gmail system sender** — the SKILL.md description gains Resend, SMTP, sender address and delivery webhook, but not "a Gmail refresh token" or "the contact route's mail". A question about rotating `GMAIL_REFRESH_TOKEN` may not load the skill. Optional; the spec's D6b-2 trigger list is as approved. Severity: Low.
4. **"contact-route mail" in `email.md` §5** — the only phrase in the skill that hints at what the route is for. It is SA's mandated gotcha wording and holds nothing sensitive; optional "contact-route mail" to match the strict rule's spirit. Severity: Low.
5. **`email.md` is LF** — becomes CRLF on the next touch, as in DO-6a. Severity: Low.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — the main session must fix Issue 1 (Medium, requirement text only) before commit. Every §D6b.4 criterion and SA changes 1–12 pass, the code claims hold, and the skill files themselves need no change.

---

## SA Review — DO-6c (short pass)

**Reviewed by SA — 2026-11-01**
**Verdict: APPROVED WITH CHANGES.** The five-credential split, the boundary with DO-6h, the six-part shape, the tiers and the public-repo criteria are right. Most code findings hold. Four things would have made the skill wrong:
- **The G3 probe reads a header that does not exist.** V2 has no start route. The browser builds the Google authorisation URL itself (`lib/client/oauth-handler.ts`, `initiateOAuth`) from the sanitised `auth_config` that `GET /api/plugins/available` serves, and opens it in a popup. There is no `Location` to read. The only start route is the deprecated V1 one.
- **`NEXT_PUBLIC_GOOGLE_CLIENT_ID` is not on the live path.** Only the deprecated V1 strategies read it. The V2 URL takes its `client_id` from `GOOGLE_CLIENT_ID` and its `redirect_uri` from `NEXT_PUBLIC_APP_URL`, both by substitution in the definitions. Neither goes through `platformOrigin()`.
- **The G2 page probes have an unstated precondition.** The Google button renders only in the `valid` invite state, so neither G2 page probe can run without an unredeemed invite. The route probe's pass ("any answer other than 404") would also count a 429 or a 503 as a pass.
- **The G5 probe cannot fail on an unset key.** With either Search name unset, `performWebSearch` returns `[]` and logs nothing at `info` or above (only a debug-gated `console.warn`). "0 failure classes" then passes on a broken setup.

GO-12 also states a vendor date we cannot stand behind. Required changes 1–13 below fix all of these. None needs a decision from the user.

I reviewed this in the DO-6c worktree at `eb2ee76a` (merge of #605). `origin/main` has moved since then, but not in `lib/`, `app/`, `.claude/` or `docs/requirements/`. I reviewed against §D6c, SA Review — DO-6 changes 1–7, SA Review — DO-6b (short pass) as the model, and `third-party-ops` `SKILL.md`, `stripe.md` and `email.md`. No platform call, no SQL and no network call were made. No `.env*` file and no private doc was opened. Local reads only.

### Code claims (GO-1 to GO-13)

| # | Result | Correction for `google.md` |
|---|---|---|
| GO-1 | **Verified.** `signInWithGoogle` calls `signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + redirectPath } })`, with `/auth/callback` as the default. A start failure logs "Google sign-in could not start". | Quote that class if the skill cites a log (it is a browser-side `clientLogger` line, so DO's runtime logs never see it). The Supabase half stays a pointer. |
| GO-2 | **Verified.** There is one accessor. It is trimmed, and blank means off. The route's 404 comes **after** the rate limiter and **before** the body is read or the session is checked. | See Q-D6c-3 for the probe. |
| GO-3 | **Verified.** On 200 the route has already claimed the invite, created the account and finalised it (`completeGoogleSignup`, the same path as `/complete`). The browser's `signInWithIdToken` runs after that. If it fails, `GoogleSignupButton.tsx` shows "account ready" and links to the normal sign-in page. | **A mismatch strands nothing half-done, but it uses up the invite.** The account is complete and password-less, and the Google identity is not linked by that step. Gotcha plus an order row (change 9). |
| GO-4 | **Verified.** The Google Identity button runs in a popup (`ux_mode: 'popup'`) on the invite page, so the origins rule stands. Closing the popup calls nothing. | Probe precondition: change 3. |
| GO-5 | **Verified, with two precisions.** The string "Environment variable not found, keeping placeholder" is verbatim, at `warn`, in module `PluginManager`, with a `varName` field. (1) It fires when the definitions **load** (a cold start), not per request. (2) It fires for **any** plugin's missing name. | T-GO-4 counts the class for module `PluginManager` filtered on `varName` in the Google set plus `NEXT_PUBLIC_APP_URL`. A window with no definition load is "not read (no load in window)", never 0 (change 6). |
| GO-6 | **Settled: only `GOOGLE_CLIENT_ID` is live.** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is read only by `gmailPluginStrategy.ts` and `googleDrivePluginStrategy.ts` (V1), and by the catalogue. | No drift check pairs the two names. The public name is a V1 leftover, noted under "never a probe target" (change 2). |
| GO-7 | **Verified, and it does not go through `platformOrigin()`.** Each `google-*-plugin-v2.json` holds `redirect_uri: "${NEXT_PUBLIC_APP_URL}/oauth/callback/<key>"`, substituted at runtime in `processEnvironmentVariables`. So the raw value lands verbatim: no trailing-slash strip, no loopback rule. The token exchange uses the same `redirect_uri`. The callback route posts its result to the opener at the **build-time** `NEXT_PUBLIC_APP_URL` origin (`app/oauth/callback/[plugin]/route.ts`), so an opener on any other origin never receives it. | Gotcha (change 5). This is the exception to SKILL.md §3's "read through `platformOrigin()`": `google.md` states it for G3 and does not edit SKILL.md. Code follow-up FU-D6c-a. |
| GO-8 | **Verified, and one is missing.** `lib/plugins/v2/core/UniversalOAuthHandler.ts`, `UniversalPlugin.ts` and `lib/plugins/v2/registry.ts` also build a Google-style auth URL, but nothing outside that folder imports them. **The V2 entry point** is the connect UI → `PluginAPIClient.connectPlugin` → `OAuthHandler.initiateOAuth` (popup), with the definition from `GET /api/plugins/available` (session required, writes nothing). | Add the unused `lib/plugins/v2/core` handler to "never a probe target". Dev confirms at build that it is still unimported (change 2). |
| GO-9 | **Settled.** The loader calls `AutocompleteSuggestion.fetchAutocompleteSuggestions` and, when a suggestion is picked, `fetchFields`. Both run through the Maps JavaScript loader. `docs/ADDRESS_AUTOCOMPLETE_SETUP.md` names the matching two APIs and agrees with the code. Billing is per session token. | The restriction row reads "the two APIs the loader needs: the setup doc lists them, confirmed against `placesAutocomplete.ts` at use time". The product names are vendor names, so they are confirmed at use time. The probe stops at suggestions (change 7). |
| GO-10 | **Verified: no current log line carries the URL.** The two error lines log `{ err: response.status }` ("Google Search API failed:") and `{ err: error }` ("Web search error:"). The URL lives in a local only. **But an unset key is silent** (see the verdict). | The G5 probe is reworked (change 8). Both strings, trailing colon included, are verbatim. |
| GO-11 | **Verified.** The groups are as stated. `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` is `secret(...)`. | Q-D6c-6. |
| GO-12 | **External: rephrase.** No date and no "reports say". | Change 10. |
| GO-13 | **Verified** against `email.md` (lines 22, 48, 59, 104 and 120 point to DO-6c). | — |

### Rulings on "SA to confirm" and Q-D6c-1 to Q-D6c-8

- **Q-D6c-1: yes.** The Google plugin client stays in `google.md`, because it is the same console, project, consent screen and API list. DO-6h points here for Google.
- **Q-D6c-2: settled.** The live client id is `GOOGLE_CLIENT_ID` only (GO-6). The two names need not match, and no check pairs them. The entry point is the V2 connect UI (GO-8). The probe has two forms, and either one is enough:
  - (a) **No consent, preferred.** Signed in on that deployment, the main session reads `GET /api/plugins/available` for one Google plugin and tests `auth_config.client_id` (not `${`-prefixed, raw or URL-encoded) and `auth_config.redirect_uri` (the target's recorded stable address plus that plugin's callback path, no `${`, no `//oauth`). It reports yes/no per field through a filter, and the response is never printed or pasted. This proves the substitution, not Google's acceptance.
  - (b) **Google's acceptance.** Start a connect from the V2 UI, stop at Google's consent page, close the popup. Google shows consent rather than invalid-client or `redirect_uri_mismatch`.

  T-GO-3 drops the public name (change 6).
- **Q-D6c-3: split.**
  - **Route probe: safe, with a precise pass.** It is a POST with no body and no cookie. The 404 check runs before the body is read, and with an empty body the route answers 400 `invalid_request` before the session lookup or any redemption step. Its only write is **one rate-limit counter increment** for the caller. Pass is **400 `invalid_request`**. Fail is 404 `google_signin_not_configured`. A 429 is "not probed (throttled)". A 503, or a deployment-protection page, is "not probed". Because `NEXT_PUBLIC_` is inlined at build into the server code as well, this probe proves the **built** value is present. So it replaces the "button shows" probe as the default "G2 name set and built" check.
  - **Page probes (button, JavaScript origin): precondition.** They need an unredeemed invite to an address the user owns. Without one, they are "not probed (no invite)". Creating one just for the probe is allowed only as an explicit user-approved step, with its side effects named: an invite row, an audit row and an invite email to the user's own address. The cleanup is to revoke the invite. The probe opens the chooser and **closes the popup**, which per the code sends nothing.
  - **A full invite signup is never a default probe.** It consumes the invite and creates an account.
  - **What the route writes before `signInWithIdToken`:** everything (GO-3).
- **Q-D6c-4: settled.** Places: GO-9. The search URL in logs: no current line (GO-10), so there is no follow-up for logging. The skill rule "never log, paste or command-line that URL" stays.
- **Q-D6c-5: keep G5**, subject to the Q-D6-2 live check. If the main session finds no code path that runs, or no target with the pair set, G5 is dropped from `google.md`, and T-GO-11 with it. Replacing the search provider is a product item for the user, outside DO-6c.
- **Q-D6c-6: accepted as FU-D6c-c (Low, code).** The catalogue relabels the Places key as a browser `config` identifier, with its tests, or records why `secret` is kept. It is not a skill rule.
- **Q-D6c-7: ≤ ~190 lines accepted.** If it runs over, Dev trims prose, never probe or drift rows.
- **Q-D6c-8: the G3 secret probe is acceptable**: optional, user-only, on the user's own Google account. Otherwise it is "secret not probed". **Cleanup is two steps.** Disconnect in the app only marks the row `disconnected` (`UserPluginConnections.disconnectPlugin` → `updateStatus`) and revokes nothing at Google. So the user also removes the app's access in their Google account's third-party access page (vendor area, confirm at use time). Side effects to name: a `plugin_connections` row and its audit. Leave `email.md` untouched, because the index row resolves its "DO-6c" pointers.
- **G3 secret "SA to confirm" (what disconnect does on Google's side):** nothing (above).
- **G5 cost "SA to confirm":** the probe spends real LLM provider cost and writes usage records. The row says "spends provider cost and writes usage records; one run, user-approved".

### Public-repo check

- **The spec text is clean.** It has no ids, refs, client ids, key prefixes, domains, addresses, endpoint URLs or personal paths, and it does not say which environment has which name. Env var names and repo paths are fine.
- **GO-12** contains a dated vendor claim and "reports say": change 10.
- **Line numbers** in GO-5, GO-10 and the inventory (`~line 150`, `~lines 255–271`) are fine as SA pointers in the requirement. They must not reach `google.md` (D6c.4 already checks that).
- **Dev must not copy code comments that state the current setup** into `google.md`.
- The "names set on Vercel" wording in the services-live line is fine here, because it is the rule. The **recorded result** must use the DO-6b form: "The main session confirmed on <date> that …", by role, with no target named.

### Required changes

1. **[GO-8, (4) G3 rows, D6c.4] Replace the G3 probe's "`Location` header of the start response".** Use the two forms in the Q-D6c-2 ruling: (a) the signed-in `GET /api/plugins/available` read, filtered to yes/no per field and never printed; (b) the V2 connect popup stopped at consent and closed. State that V2 has no start route and that the V1 start route is never a target. Add a D6c.4 grep: "Location" in `google.md` is 0, or the hit is "there is no start route". — Priority: High
2. **[GO-6, GO-8, (2), (5)] Live readers for G3.** Part (2) names, for G3: `plugin-manager-v2.ts` (`processEnvironmentVariables`), the `google-*-plugin-v2.json` definitions, `lib/plugins/sanitize-plugin-definition.ts`, `app/api/plugins/available/route.ts`, `lib/client/plugin-api-client.ts` / `lib/client/oauth-handler.ts` and `app/oauth/callback/[plugin]/route.ts`. Under "never a probe target", add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (read by V1 strategies only) and the unimported `lib/plugins/v2/core` handler (Dev confirms at build). Remove "if both are read on the live path…". — Priority: High
3. **[(4) G2 rows] G2 probes as ruled in Q-D6c-3.** The route probe becomes the default "name set and built" check: pass 400 `invalid_request`, fail 404 `google_signin_not_configured`. A 429 is "not probed (throttled)". A 503, or a protection page, is "not probed". Its side effect is one rate-limit counter increment. The button and JavaScript-origin probes carry the precondition "an unredeemed invite to an address the user owns, else not probed (no invite)". Creating one is user-approved, with the invite row, the audit row, the email and the revoke cleanup named. The popup is closed, never completed. — Priority: High
4. **[(4) G5 row] Make the G5 probe able to fail.** Pass: the research action returns web sources (`source_count` > 0, or sources shown) for a query certain to have results, **and** 0 "Google Search API failed:" and 0 "Web search error:" lines from that deployment after the probe time. Fail: no sources, or either class > 0. Add a gotcha: "an unset Search key or engine id is silent: the research answer comes back without web sources and no `info`-or-above log line". Side effects: one Custom Search query, plus real LLM provider cost and usage records. One run, user-approved. — Priority: High
5. **[GO-7, (5)] G3 redirect gotchas.** (a) The redirect is the raw `NEXT_PUBLIC_APP_URL` plus the callback path, substituted at runtime. It does **not** go through `platformOrigin()`, so a trailing slash, a loopback value or an unset name lands verbatim and Google answers `redirect_uri_mismatch` (an unset name also logs the GO-5 class). (b) The callback posts its result to the build-time `NEXT_PUBLIC_APP_URL` origin, so a connect started from any other origin (for example a Preview deployment URL) completes at Google but the page never hears of it. In the G3 probe, pass is "`redirect_uri` is the **target's recorded stable address** plus the plugin's callback path", not "that deployment's address". — Priority: High
6. **[T-GO-2, T-GO-3, T-GO-4] Drift rows.**
   - T-GO-2: "every `NEXT_PUBLIC_` Google name on the target is a `NEXT_PUBLIC_` name in the catalogue; neither `GOOGLE_CLIENT_SECRET` nor `GOOGLE_SEARCH_API_KEY` appears with the prefix". Derived, not a typed list.
   - T-GO-3: `GOOGLE_CLIENT_ID` with `GOOGLE_CLIENT_SECRET`, and wherever that pair is set, `NEXT_PUBLIC_APP_URL` set too. The search pair stays. The public client name is dropped.
   - T-GO-4: count the class for module `PluginManager`, with `varName` in the Google names plus `NEXT_PUBLIC_APP_URL`. A window with no definition load is "not read (no load in window)".

   — Priority: Medium
7. **[(4) G4 rows, GO-9] Places probe limits.** Type a partial address and **stop at suggestions**: never pick one (picking calls `fetchFields`, a second billable request) and never save the form. The fields are in Business OS settings, found at use time, on the user's own business only. The restriction row is as in GO-9. The "restriction holds" probe uses an address on that deployment that is not on the referrer list, if the key is built there. Otherwise it is "not probed". — Priority: Medium
8. **[GO-10] Record the ruling.** "No current log line carries the search URL (SA, at `eb2ee76a`)". The skill keeps only the never-log/paste/command-line rule. — Priority: Low
9. **[(5), (7) order, GO-3] G2 equality and origins before the switch.** Gotcha: "if the sign-in name and the Supabase provider's client differ, the route still claims the invite and creates the account, and the browser step then fails. The person gets a complete, password-less account and a used invite, and is sent to the normal sign-in page" (`GoogleSignupButton.tsx`, `completeGoogleSignup`). Order row: "`NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` is set on a target only after T-GO-5 reads 'same client: yes' and T-GO-6 reads 'registered: yes' for every stable origin that serves the invite page". Add a second order row: "a changed `NEXT_PUBLIC_APP_URL`: every Google plugin's callback registered at the new address before the change, then a new build (the callback's post-message origin is build-time)". — Priority: Medium
10. **[GO-12, (5), T-GO-11] Vendor wording.** Replace it with: "Google's Custom Search JSON API documentation carries a notice about its availability; read Google's notice at use time before any G5 rotation or new project". No date and no "reports say". The rotation rule becomes "rotate within the existing project; if the notice says new projects or keys are refused, plan the rotation with that risk named". T-GO-11 becomes "Custom Search still served for the recorded project, per Google's notice at use time". — Priority: Medium
11. **[(4) G3 secret row] Cleanup is two steps** (Q-D6c-8): disconnect in the app, and the user removes the app's access in their own Google account (vendor area, confirm at use time). Name the `plugin_connections` row and its audit as side effects. — Priority: Medium
12. **[(4) G1 row] Which login surface.** The "Continue with Google" button calls `signInWithGoogle` in `lib/client/auth-actions.ts`, and the button is found at use time. The start-failure line is browser-side, so DO has no runtime-log evidence for G1. Say "user or main session report only". — Priority: Low
13. **[D6c.3 follow-ups] Record three code follow-ups in the requirement, not in the skill:**
    - FU-D6c-a (Medium): build the G3 redirect through `platformOrigin()`, or a shared helper, on both the definition substitution and the callback's post-message origin.
    - FU-D6c-b (Low): ✅ CLOSED by G-2 of GOOGLE_OAUTH_CLIENT_CONSOLIDATION_REQUIREMENT.md — both readers deleted with the V1 strategies and the catalogue entry removed. G-3 removes the variable from Vercel.
    - FU-D6c-c (Low): Q-D6c-6.

    `chatgpt-research-plugin-executor.ts` also has a `console.warn` and a hardcoded model (CLAUDE.md rules 3 and 5). It is not touched in this slice, so it is listed for whoever next opens that file, not converted here.

    — Priority: Low

### Checked and honoured

- **DO-6 changes 1–7:** every probe with a precondition is "not probed" when the precondition fails (changes 3, 7). A rotation overlap is "pass, not conclusive". Local is "not read" in T-GO-1. Derivation is from code (plugin keys, scopes, callbacks). There are no copied lists, and the T-GO rows live in `google.md`.
- **Probe safety:** no probe completes consent or sign-in except by the user on their own account. No probe sends mail unless the user approves the optional invite creation. The rate-limit increment, the Places and Search quota, and the LLM cost are each named. No probe needs DO to hold a secret, and no probe targets V1.
- **Tiers:** every consent-screen, scope, API, secret and key action, and any edit to a client or key that production uses, is production tier. Shared clients make every edit production tier.
- **Supabase half:** a pointer to `supabase-ops`, never restated.

### Approval

[x] Spec approved with changes 1–13. Dev builds `google.md` and the SKILL.md index row after the main session's Q-D6-2 live check. No user decision is needed.

---

## DO-6c implementation notes

**By Dev — 2026-11-02.** Branch `feature/devops-third-party-google`, worktree at `origin/main` (after #605). Config/docs only; nothing committed. The SA short pass's changes 1–13 override §DO-6c wherever they differ; `google.md` follows the SA text, and §DO-6c is kept as BA wrote it apart from the public-safety edits listed below.

| File | Change |
|---|---|
| `.claude/skills/third-party-ops/google.md` | New, 144 lines (under ~190): a credential table G1–G6, then six parts plus tiers and order, T-GO-1..11, mirroring `email.md`'s section order and table style. G1–G5 are separate rows in every part; G6 is a cross-link to `email.md`. No line numbers, no plugin key list, no scope string. LF line endings |
| `.claude/skills/third-party-ops/SKILL.md` | §5 index row now points at `google.md`; description triggers gain "Continue with Google" or Google sign-in, a Google OAuth client, a redirect URI mismatch, an OAuth consent screen, Authorised JavaScript origins, a Google API key, a Places key, Custom Search (D6c-2). CRLF preserved; 2 lines changed |
| This requirement | §DO-6c spec, SA Review — DO-6c (short pass), these notes, two Change History rows, §0 DO-6 row. CRLF preserved |

| SA change | Where / how applied |
|---|---|
| 1 | §2 "V2 has no start route" paragraph; §4 G3 probe split into (a) the signed-in `GET /api/plugins/available` read, yes/no per field through a filter, never printed, and (b) the V2 connect popup stopped at consent and closed. The word "Location" does not appear in `google.md` |
| 2 | §2 G3 row names `processEnvironmentVariables`, the `google-*-plugin-v2.json` definitions, `sanitize-plugin-definition.ts`, the available route, `connectPlugin` / `initiateOAuth` and the callback route. "Never a probe target" lists the V1 readers, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (V1 only, never paired) and the `lib/plugins/v2/core` handler. The "if both are read on the live path" text is gone |
| 3 | §4 G2 rows: the route probe is the default "name set and built" check (pass 400 `invalid_request`, fail 404 `google_signin_not_configured`, 429 "not probed (throttled)", 503 or protection page "not probed", one rate-limit increment). The button / JavaScript-origin row carries the unredeemed-invite precondition, the user-approved invite creation with its invite row, audit row, email and revoke cleanup, and "close the popup" |
| 4 | §4 G5 row: pass needs web sources (`source_count` > 0 or sources shown) and 0 of each failure class; §5 "An unset Search key or engine id is silent"; side effects one Custom Search query plus LLM provider cost and usage records; one run, user-approved |
| 5 | §5 "The G3 redirect is not built through `platformOrigin()`" (raw value; a trailing slash, loopback or unset name lands verbatim; the exception to SKILL.md §3) and "The callback answers one origin"; §4 G3 (a) pass is the target's recorded stable address. SKILL.md §3 is not edited |
| 6 | T-GO-2 derived from the catalogue, with the secret and the search key named; T-GO-3 adds `NEXT_PUBLIC_APP_URL` and drops the public client name; T-GO-4 module `PluginManager`, `varName` filter, "not read (no load in window)" |
| 7 | §4 G4 rows: stop at suggestions, never pick one (`fetchFields`), never save; fields in Business OS settings on the user's own business; the restriction-holds row is "not probed" without an unlisted address. §1 and §2 G4 rows per GO-9 |
| 8 | Recorded below under "Verification done"; `google.md` keeps only the never-log/paste/command-line rule (§5) |
| 9 | §5 "A G2 mismatch uses up the invite"; §7 order rows for setting `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` (after T-GO-5 and T-GO-6) and for a changed `NEXT_PUBLIC_APP_URL` |
| 10 | §5 "Custom Search availability" uses the SA wording, no date; T-GO-11 "per Google's notice at use time". §DO-6c GO-12 reworded the same way |
| 11 | §4 G3 secret row: two-step cleanup (disconnect only marks the row, then the user removes the app's access in their Google account) and the `plugin_connections` row and audit as side effects |
| 12 | §4 G1 row: the button that calls `signInWithGoogle`, found at use time; "by report only", because "Google sign-in could not start" is a browser-side line |
| 13 | Follow-ups below; none is in the skill |

**Code follow-ups (not in this slice).**

| ID | Priority | Item |
|---|---|---|
| FU-D6c-a | Medium | Build the G3 redirect and the callback's result origin through `platformOrigin()` (or a shared helper), both in the definition substitution and in the callback's post-message origin |
| FU-D6c-b | Low | ✅ CLOSED by G-2 (GOOGLE_OAUTH_CLIENT_CONSOLIDATION_REQUIREMENT.md) — readers and catalogue entry gone; G-3 removes the Vercel variable |
| FU-D6c-c | Low | The catalogue relabels the Places key as a non-secret browser setting (`config`), with its tests, or records why `secret` is kept |

`chatgpt-research-plugin-executor.ts` also has a `console.warn` and a hardcoded model (CLAUDE.md rules 3 and 5). It is not touched here; listed for whoever next opens that file.

**Public-safety edits.** In §DO-6c: GO-12 reworded per SA change 10; the G5 probe row's open question replaced by the SA ruling's wording; a header line says the SA changes override the section. In the SA short pass as recorded here: two passages were shortened to what the skill needs.

**Verification done.** Every path named in `google.md` exists in the worktree (scripted check). Quoted strings found by `grep -cF` in their files: "Google sign-in could not start" (`auth-actions.ts`), `google_signin_not_configured` and `invalid_request` (the signup route), "Environment variable not found, keeping placeholder" (`plugin-manager-v2.ts`, module `PluginManager`, field `varName`), "Google Search API failed:" and "Web search error:" (the research executor). Function names checked: `signInWithGoogle`, `signInWithGoogleIdToken`, `processEnvironmentVariables`, `connectPlugin`, `initiateOAuth`, `performWebSearch`, `completeGoogleSignup`, `fetchAutocompleteSuggestions`, `fetchFields`, `platformOrigin`. The Google definitions take `client_id` from `${GOOGLE_CLIENT_ID}` and build `redirect_uri` from `${NEXT_PUBLIC_APP_URL}`; the callback route posts to the build-time `NEXT_PUBLIC_APP_URL`. `lib/plugins/v2/core/UniversalOAuthHandler.ts` and `lib/plugins/v2/registry.ts` are imported by nothing outside `lib/plugins/v2/` except guard tests. SA change 8, recorded: no current log line carries the search URL (SA, at `eb2ee76a`).

**Could not verify / open.**
- The Q-D6-2 live check (each of G1–G5 still in use, by role) is the main session's; `google.md` keeps all five and states the check. The main session recorded its result in the spec on 2026-11-02 (all five have a running code path; configuration is checked at use time).
- Vendor facts (console area names, the per-project consent screen, Testing-mode token expiry, two active client secrets, origin-not-allowed and referrer error messages, Custom Search availability, Places billing) are not verifiable from code; each is marked "confirm at use time".
- `google.md` is LF; it becomes CRLF on the next touch, as `email.md` did.

---

---

## SA Code Review — DO-6c

**Code Review by SA — 2026-11-02**
**Status:** ✅ Code Approved

Reviewed the uncommitted DO-6c worktree (`google.md` new, `SKILL.md` index row and triggers, this requirement) against the DO-6c spec, SA Review — DO-6c (short pass) changes 1–13 and the DO-6c implementation notes. Local reads and greps only: no platform call, no SQL, no network call, no `.env*` file.

### SA changes 1–13 in `google.md`

All 13 landed as ruled. Change 1: the G3 probe is the two forms (a) and (b), §2 states that V2 has no start route, and "Location" occurs 0 times. Change 2: §2 names the live G3 readers and "never a probe target" lists the V1 readers, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and the `lib/plugins/v2/core` handler. Change 3: the G2 route probe is the default, with the exact pass, fail, throttled and not-probed states, and the invite precondition. Change 4: the G5 pass needs sources and 0 of both classes, and the silent-unset gotcha is present. Change 5: the two redirect gotchas, and (a) passes on the recorded stable address. Change 6: T-GO-2, T-GO-3 and T-GO-4 are as ruled. Change 7: the probe stops at suggestions. Change 8: the never-log rule only. Change 9: the gotcha and both order rows. Change 10: the vendor wording, with no date. Change 11: the two-step cleanup. Change 12: by report only. Change 13: the follow-ups are in the requirement only.

### Code claims checked at this tree

| Claim in `google.md` | Result |
|---|---|
| G2 route: rate limiter first, then 404 `google_signin_not_configured`, then an empty body is 400 `invalid_request` before the session lookup | ✅ Order confirmed in the route. An empty body makes `request.json()` fail, so the schema refuses it |
| G2 rate-limit bucket (one increment, `create` budget) | ✅ |
| G2 accessor reads only `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` with no fallback, popup button (`ux_mode: 'popup'`), `signInWithGoogleIdToken` after the route, link to sign-in on failure | ✅ |
| G1 `signInWithGoogle` → `signInWithOAuth`, "Google sign-in could not start" | ✅ (browser-side logger) |
| G3 `GET /api/plugins/available`: session required, serves `auth_config` through `toClientPluginInfo`, whose allow-list includes `client_id` and `redirect_uri` | ✅ Writes nothing |
| G3 `connectPlugin` → `initiateOAuth` builds the URL from `auth_config` and opens a popup | ✅ |
| G3 definitions: `client_id` from `${GOOGLE_CLIENT_ID}`, `redirect_uri` from `${NEXT_PUBLIC_APP_URL}` plus the callback path, substituted in `processEnvironmentVariables` | ✅ Every `google-*-plugin-v2.json` |
| PluginManager warn: "Environment variable not found, keeping placeholder", module `PluginManager`, field `varName`, at definition load | ✅ |
| Callback posts to the build-time `NEXT_PUBLIC_APP_URL` origin | ✅ |
| Disconnect only updates the status and revokes nothing | ✅ |
| G4 `fetchAutocompleteSuggestions`, `fetchFields` when a suggestion is picked, empty-key fallback | ✅ |
| G5 `performWebSearch`: unset pair returns `[]` silently (debug-only output); `source_count`; "Google Search API failed:" and "Web search error:" verbatim, trailing colon included | ✅ |
| Catalogue groups `admin` / `plugins` / `external` for the Google names | ✅ |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` live readers: V1 strategies only (other hits are the catalogue, a guard comment and tests) | ✅ |
| `lib/plugins/v2/core` / `registry.ts` imported only by guard tests outside the folder | ✅ |
| Every cited path exists (V1 files, setup doc, `scripts/validate-gmail.mjs`, the T-EM-8 pointer) | ✅ |

### Probes, public repo, template

- **Probes:** each one can fail. Side effects are named, and the costly or writing ones are user-approved and run once (rate-limit increment, invite creation, Places quota, Search query plus LLM cost, `plugin_connections` row). Every precondition has a "not probed" state, and so do "not read (no load in window)" and "secret not probed". No probe needs DO to hold a secret, and none targets V1.
- **Public repo:** `google.md` has no ids, client ids, key prefixes, domains, addresses, URLs, personal paths, line numbers, plugin key lists or scope strings (the copied-list greps return 0). It records no current environment setup, and the dated vendor claim is gone. The requirement diff adds no such values. The line-number pointers stay in SA text only, as ruled.
- **Template:** the same sections and order as `email.md` and `stripe.md`. It is 144 lines, inside the ~190 allowed.
- **SKILL.md:** only the description triggers and the §5 row changed (2/2 lines). Working copy CRLF is intact; the stored file stays LF under `core.autocrlf`.

### Optimisation Suggestions

- `google.md` is LF in the working copy while its siblings are CRLF there. Under `core.autocrlf` the stored files match, so no action is needed.

### Code Approved for QA: Yes

---

## QA Report — DO-6c

**QA — 2026-11-02**
**Test mode:** full · **Strategy:** static checks (grep, `grep -cF` verbatim string lookup, path and link existence, YAML parse, byte-level line-ending count, `git diff --numstat` with and without `--ignore-cr-at-eol`, read-through against the code). This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public repo, current-state text, probe safety), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1 to DO-6b) · **Input source:** TL prompt + §D6c.4 + SA Review — DO-6c (short pass) changes 1–13 + SA Code Review — DO-6c. Run in the DO-6c worktree on the uncommitted changes. No platform call, no SQL, no vendor call, no network call. No `.env*` file and no private doc was opened. QA edited nothing except this section and one Change History row.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | §D6c.4: six parts plus tiers/order, G1–G5 with G6 a cross-link; paths exist; live check by role | Pass | Credential table G1–G6 (G6 → `email.md`), then §1–§7 in the `email.md` order. Every backticked path tested with `test -e`: all exist; bare file names (`googleSignInConfig.ts`, `GoogleSignupButton.tsx`, the V1 strategy names, `UniversalPlugin.ts`) each resolve to the file the row means. The live check is a procedure ("a code path that runs, and the names set on Vercel"), naming no environment |
| 2 | §D6c.4: a probe row per G1–G5 with who, pass, fail, side effects; G4 and G5 cost quota; no consent or sign-in except the user's own; no V1 target | Pass | 12 probe rows, each with `Who` and `Side effects`. G4 "**Costs quota**", G5 "**Costs one Custom Search query**" plus LLM cost. G1 sign-in and the G3 secret: user only, own account. The §4 intro and §2 "Never a probe target" exclude V1 and the unimported `lib/plugins/v2/core` handler |
| 3 | §D6c.4 G3 probe, as overridden by SA change 1 | Pass | (a) signed-in `GET /api/plugins/available`, yes/no per field, response never printed; (b) popup stopped at consent, URL never pasted. Code: the route requires a session (`getUser`, 401) and serves `auth_config` through `toClientPluginInfo`, whose allow-list holds `client_id` and `redirect_uri`. "Location" in `google.md`: 0 |
| 4 | §D6c.4: G2 no-fallback and equality, with files | Pass | §5 "never falls back" (`googleSignInConfig.ts`; the accessor trims, blank → null); §1 equality row; T-GO-5 cites `googleSignInConfig.ts` and `googleIdToken.ts` |
| 5 | §D6c.4: Supabase side a pointer | Pass | "Skip nonce", "URL configuration", "Redirect URLs" over `google.md`: 0. §3 and §5 point to `supabase-ops` |
| 6 | §D6c.4: no copied lists | Pass | `googleapis\.com/auth`, `/oauth/callback/google-`, line references (`L123`, `line 123`, `:123`, `~line`): 0. No plugin key or scope named |
| 7 | §D6c.4: quoted strings verbatim; vendor messages marked | Pass with note | `grep -cF`: "Google sign-in could not start" 1 (`lib/client/auth-actions.ts`, the only file in `app/` and `lib/`); `google_signin_not_configured` 2 and `invalid_request` 2 (signup route); "Environment variable not found, keeping placeholder" 1 (`plugin-manager-v2.ts`, the only file), `varName` 4; "Google Search API failed:" 1, "Web search error:" 1, `source_count` 3 (research executor); `fetchAutocompleteSuggestions` 2, `fetchFields` 3. Every function name found. See Edge Case 1 |
| 8 | §D6c.4: restatement grep (§D6.4 list) | Pass | `Snapshot the before-state`, `\| **Read** \|`, `begin read only`, `filter_project_envs`, `decrypt` over `google.md`: 0 |
| 9 | §D6c.4 / brief: public-repo regex over added lines | Pass | The brief's regex over all 474 added lines (`google.md` `git add -N`'d, then `git reset -q`; `git status` shows it untracked again): **0**. Extra (`https?://`, `localhost`, `.com`/`.io`/`.ai`, `worktrees/`, `Users/`): 1 hit, the criterion's own grep pattern in §D6c.4 (a regex, not a URL) |
| 10 | Brief: weakness-wording grep over the added lines (case-insensitive; word list kept with the main session) | Pass with note | 4 hits, all `throttl`: the "not probed (throttled)" outcome of the G2 route probe (`google.md` §4, the SA Q-D6c-3 ruling, SA change 3, Dev note 3). It names a rate-limit refusal as an inconclusive probe result: a control, not a weakness. See Edge Case 2 |
| 11 | No statement of the current env setup | Pass | Grep of added lines for "is set in", "not set", "only on", "in production", "on preview", "is configured", "currently", "today", "is enabled", "is published": every hit is a rule ("production published", "registered only on a non-production client", "each API the code calls is enabled in that project"), a dashboard field name, or criterion text. The recorded live check says only that each of G1–G5 still has a code path that runs and that configuration is not recorded, by role, no target |
| 12 | Links and cross-skill pointers | Pass | The only markdown link is `[email.md](email.md)` (resolves). `supabase-ops`, `env-change-protocol`, `vercel-ops`, `env-drift-audit` exist. Cited sections exist: `vercel-ops` §3 (Env vars row) and §4 ("Who probes what", `NEXT_PUBLIC_` build-time), `env-drift-audit` §7, `SKILL.md` §3 ("Redirect URIs come from the app address") and §5, `email.md` §2, T-EM-8 |
| 13 | Code claims (sample) | Pass | Signup route order: rate limit → 404 → `request.json().catch` + schema → 400 → `getUser` → `completeGoogleSignup`. Every `google-*-plugin-v2.json` takes `client_id` from `${GOOGLE_CLIENT_ID}` and builds `redirect_uri` from `${NEXT_PUBLIC_APP_URL}` plus its callback path. The callback route reads `NEXT_PUBLIC_APP_URL` at module level for `postMessage`. `performWebSearch`: an unset pair → debug-gated output, `return []`. `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: live readers are the two V1 strategies only (plus the catalogue and a comment). `lib/plugins/v2/core` / `registry`: outside the folder only three guard tests reference them. `disconnectPlugin` → `updateStatus` |
| 14 | SKILL.md diff only D6c-2; diff touches only D6c.3 files | Pass | `git status --untracked-files=all`: the two edited files and `google.md`. SKILL.md 2/2 lines: the description triggers and the §5 row. The triggers add "a redirect URI mismatch" and "a Places key" beyond §D6c.3's list, both within its intent; every spec trigger is present in substance |
| 15 | SKILL.md frontmatter | Pass | js-yaml parse: keys `name`, `description`; `name: third-party-ops`; description 1,226 chars on one line |
| 16 | Line endings, churn | Pass | CR = LF in the requirement (3876/3876 before this report) and SKILL.md (86/86); `git ls-files --eol`: `w/crlf`. `--numstat` identical with `--ignore-cr-at-eol` (2/2, 372/1); the 1 removed requirement line is the §0 DO-6 row. `google.md` is LF throughout (0 CR, 144 LF, final newline), consistent, as `email.md` was |
| 17 | Length | Pass | 144 lines (≤ ~190, Q-D6c-7) |
| 18 | Fresh-session load test | Deferred | Skills load at session start. Not failed |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Edge Cases (nice to fix)

1. **`redirect_uri_mismatch` and the "invalid-client page" are not marked as vendor messages** — `google.md` §4 (G1 row, G3 (b) row) and §5 (the G3 redirect gotcha). §D6c.4 asks that vendor messages be marked "confirm at use time"; the origin-not-allowed and referrer messages are, these two are not. `redirect_uri_mismatch` is a Google error code, found nowhere in `app/` or `lib/`. Optional: add "(vendor message, confirm at use time)" at first use. Severity: Low.
2. **The rate-limit bucket and budget are written out in the requirement** — the SA short pass's Q-D6c-3 ruling names the bucket key and its request-per-window figure. Both are in public code and describe a control, so nothing is exposed; `google.md` says only "one rate-limit counter increment". Optional: trim to that. Severity: Low.
3. **§D6c.2 and §D6c.4 lag the SA short pass** — the §D6c.2 G3 probe row still reads the authorisation URL "or the `Location` header of the start response" with a "that deployment's stable address" pass, and §D6c.4 item 3 still says the probe reads the authorisation URL. SA change 1 also asked for a "Location" grep criterion in §D6c.4, which was not added (the grep itself returns 0). The section header says the SA changes override it, and `google.md` is correct. Severity: Low.
4. **`google.md` is LF** — becomes CRLF on the next touch, as with `email.md`. Severity: Low.

### Final Status

- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

**PASS.** Every §D6c.4 criterion, as overridden by SA changes 1–13, passes; the public-repo scan is 0 and the weakness grep's 4 hits are explained; the code claims hold. Four Low edge cases, none blocking.

---

## SA Review — DO-6d (short pass)

**Reviewed by SA — 2026-11-02**
**Verdict: APPROVED WITH CHANGES.** The four-key split, the boundary with the admin screens and the price review stream, the six-part shape, the probe discipline carried over from DO-6c and the public-repo criteria are right. Most code findings hold. Five things would have made the skill wrong:
- **Groq is not reached only through a selection.** The help bot builds its Groq provider directly, on every model call, whatever the settings say. Its settings rows choose the **model name only**, never the provider. So the Groq key is effectively required wherever the help bot is served, with no row involved. LM-5, the part (1) row for L3, T-LLM-4 and the "removing a key" order row all assume otherwise.
- **LM-9 is half right.** A service-role key that is set but wrong fails only the ledger write, as stated. An **unset** one fails the provider call itself: the factory builds its analytics client before it builds the provider, and the Supabase client constructor throws on an empty key. The two ledger lines are also under the `service` field `AIAnalyticsService`, not a `module`.
- **The model-name probe has a pass condition that cannot fail for every reader.** "0 'No pricing found' lines after the reader's next call" does not hold up as a per-change pass condition for both readers. It stays a drift class (T-LLM-9) and leaves the probe row (change 6).
- **The "not configured" throw is not a counted class.** It has no fixed module: each caller logs it under its own. Three of the four messages also end with a vendor console address, so the skill quotes at most the common clause and never the full text.
- **Q-D6d-2 has an answer for two providers, not four.** The help bot covers L1 and L3 in one question. L2 and L4 have no app-side probe that meets the criteria (see the Q-D6d-2 ruling).

None of this needs a decision from the user. Required changes 1–13 below fix it.

I reviewed this in the DO-6d worktree at `26df15e5` (= `origin/main` at review time). I reviewed against §D6d, SA Review — DO-6 changes 1–7, SA Review — DO-6c (short pass) as the model, and `third-party-ops` `SKILL.md`, `stripe.md`, `email.md` and `google.md`. No platform call, no SQL, no vendor call and no network call were made. No `.env*` file was opened. Local reads and greps only.

### Code claims (LM-1 to LM-13)

| # | Result | Correction for `llm-providers.md` |
|---|---|---|
| D6d.1 table | **Verified.** Group `ai` holds the six names. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are `exp('R', 'R', 'O')`. `GROQ_API_KEY` and `KIMI_API_KEY` are secrets with the default (optional everywhere). The two model names are `config(..., 'identifier')`, optional. | L3's row must add the help bot dependency (change 1). |
| LM-1 | **Verified.** No `NEXT_PUBLIC_` name containing an LLM provider or model word exists in `app/`, `lib/`, `components/` or `hooks/`. The only adjacent public name is the AI data layer UI switch in `featureFlags.ts`. | — |
| LM-2 | **Verified, with two precisions.** Each of the four `get*Provider` methods reads its key once into a static instance and throws if it is unset. (1) The first clause "`<NAME>` environment variable is not configured." is common to all four. Anthropic, Kimi and Groq then append a "Get your API key from:" vendor address, so the quoted sentence is not the whole message. (2) The factory does not log the throw. The caller's own catch logs it, under the caller's module, so it has no fixed module. `clearInstances` has no production caller. | Quote at most "environment variable is not configured", and never the vendor address. It is **not** a counted class and has no T- row (Q-D6d-6). |
| LM-3 | **Verified.** `PROVIDERS` lists openai, anthropic, kimi and groq. Nothing outside `mistralProvider.ts` names `MistralProvider` or a `MISTRAL_*` env name. | — |
| LM-4 | **Verified.** `EmbeddingService` ignores its key argument and calls `ProviderFactory.getProvider(PROVIDERS.OPENAI)`. `GeneratedImageService` calls `ProviderFactory.getOpenAI()`. Both go through `callWithTracking` (`createEmbedding`, `generateImage`). | — |
| LM-5 | **Corrected.** The Business OS area settings, the orchestration routing tiers (code defaults route all three tiers to Anthropic) and the V6 admin config are database selections. **"SA to confirm": the V6 config is stored in `system_settings_config`**, read by `lib/agentkit/v6/config/AgentGenerationConfigService.ts`, and edited from the agent generation config admin screen. **The help bot is not a selection.** `app/api/help-bot-v2/route.ts` constructs `GroqProvider` directly in both its model calls. Its settings rows name a model only. | Change 1. Groq's effective requirement comes from code (a provider class constructed outside the factory), so T-LLM-4 derives it from code as well as from rows. Kimi stays selection-only. |
| LM-6 | **Settled ("SA to confirm").** `OpenAIProvider` passes `{ apiKey }` only. `AnthropicProvider` passes `{ apiKey }` only. `KimiProvider` passes `{ apiKey, baseURL }`. `GroqProvider` and `MistralProvider` use `fetch` with their own header, not an SDK client. | The OpenAI client's implicit base-URL, organisation and project names can apply. The Anthropic client's implicit base-URL and auth-token names can apply. On the Kimi client the base URL is explicit, so only the OpenAI organisation and project names can still apply, and they are sent to the other vendor. Groq has none. The names themselves still come from SDK docs at use time (change 4). |
| LM-7 | **Verified.** `isProviderAvailable`, `getAvailableProviders` and `getStatus` cover openai, anthropic and kimi. `clearInstances` does not reset the Groq instance. An unset Groq key in the help bot reaches the vendor and comes back as "Groq API error: " plus the status (`groqProvider.ts`, verbatim, 1 hit). | — |
| LM-8 | **Verified.** `callWithTracking` writes one row on success and one on failure (`success = false`, `error_code` = `error.code` or `UNKNOWN`, `cost_usd` 0). Groq's error is a plain `Error` with no `code`, so it records `UNKNOWN`. The Anthropic SDK error shape is vendor fact, so confirm at use time. Columns: `provider`, `model_name`, `success`, `error_code`, `cost_usd`, `feature`, `created_at` are the ones the insert writes and the Layer 1.1 / Slice B2 workplans verified on the live schema. **The failure row also carries `error_message`, and every row carries `request_payload` and `response_metadata`.** None of the three is ever read. | Change 3 (never-read list), change 11 (wording). |
| LM-9 | **Corrected** (see the verdict). `getAnalytics()` calls `createClient(url, SUPABASE_SERVICE_ROLE_KEY!)`, and supabase-js throws "supabaseKey is required." on an empty key. Both ledger lines are verbatim (1 hit each in `aiAnalytics.ts`) under `createLogger({ service: 'AIAnalyticsService' })`. | Change 2. |
| LM-10 | **Verified, with a precision.** The line is verbatim (1 hit, `lib/business-os/llm/modelFallback.ts`, module `BosLlmModelFallback`). It fires only when the configured model **differs from the code default**, and only on a refusal that `isModelUnavailableError` recognises (status plus code or param, never the message). A refused model is then remembered for one settings-cache period and is retried silently (debug only), so there is at most one line per instance per period. | T-LLM-6 > 0 points at the key's project or the setting. **0 does not prove access** when the configured model is the default. Say so (change 5). |
| LM-11 | **Verified.** The line is verbatim (2 hits, `lib/ai/pricing.ts`, module `AiPricing`, `warn`). | T-LLM-9 names module `AiPricing` (change 5). |
| LM-12 | **Verified.** `OPENAI_MODEL` is read twice in `app/api/orchestration/run-step/route.ts`, with **different** code defaults. `OPENAI_CHAT_MODEL` is read twice in `AIDataLayerService.ts`. | No model names in the skill. For the probe, see Q-D6d-3. |
| LM-13 | **Verified.** `eval:chat` and `bos:llm-settings` both `--import ./scripts/env-preload.ts`. `tests/plugins/jest-setup.ts` stubs the two main keys when they are unset. | — |
| Paths | **All exist:** the admin environment, AI cost, Business OS LLM, AIS config, help bot config and agent generation config screens, the runbook, `modelSettings.ts` (60 s cache constant), `modelSettingsPolicy.ts`, `aiChargeRecorder.ts`, `pricing.ts`, `RoutingService.ts`, `V6PipelineOrchestrator.ts`, `chatgptResearchStrategy.ts`, `backups/`, `scripts/env-preload.ts`, `tests/plugins/jest-setup.ts`. `SKILL.md` §5 has the "LLM providers \| not covered yet (DO-6d)" row. | — |

### Rulings on "SA to confirm" and Q-D6d-1 to Q-D6d-7

- **Q-D6d-1: yes, keep Kimi** as "covered when selected". Its probe is "not probed (not selected)" until a row selects it. T-LLM-4 catches a selection without a key. Its gotcha line is the LM-6 one: an OpenAI organisation or project name on a target reaches Kimi's vendor too.
- **Q-D6d-2: per provider.**
  - **L1 OpenAI and L3 Groq: one help bot question.** The help bot is the floating help button on signed-in V2 pages. It needs a normal session, not admin. Precondition: a harmless question that is new (it must miss both the FAQ and the answer cache), with the help bot's semantic search setting on, as read at use time on the help bot config screen.
    - **What runs:** one OpenAI embedding for the cache lookup, feature `helpbot`; then one Groq chat call, feature `help_bot_v2`; then a second `helpbot` embedding to store the answer.
    - **Ledger rows:** all go on the **platform's own account**, never a customer's. No credits are charged.
    - **Side effects to name:** one shared answer-cache row holding the question and the bot's answer (it is reused for later matching questions, and the app has no route that removes it); one support-analytics counter increment; three real provider calls.
    - **L3 pass:** the answer appears on that deployment with the **Groq** source badge, **and** a `help_bot_v2` row with `success = true` for provider groq, `created_at` after the probe time.
    - **L3 fail:** an error answer, or a groq failure row.
    - **L3 not probed:** a FAQ or Cache badge means "not probed (answered from FAQ or cache)". This must never read as a fail.
    - **L1 pass:** ≥ 1 `helpbot` row with `success = true` for provider openai, and 0 failure rows.
    - **L1 fail:** a failure row, or 0 rows while both LM-9 classes are 0. The user-visible answer is **not** evidence for L1, because the help bot catches a failed lookup ("Cache search error", module `HelpBotV2API`) and still answers through Groq.
    - Optional and user-approved, one run, never in a loop. If the user declines, it is "not probed (declined)".
  - **L2 Anthropic: no app-side probe; `/admin/environment` Set + user dashboard read.**
    - The tracked Anthropic routes (`enhance-prompt`, `analyze-prompt-clarity`, `generate-clarification-questions`) sit in the agent-creation flow. They send large prompts, and one also writes an analytics row.
    - The orchestration default sends agent runs to Anthropic, but a run writes execution data.
    - Business OS calls charge a business's credits.
    - None meets "cheap and no side effect on customer data".
  - **L4 Kimi: no app-side probe; `/admin/environment` Set + user dashboard read** (and "not probed (not selected)" until a row selects it).
  - **All four: an optional traffic read, added as one more row, never a substitute for a failing probe.** After the deployment is Ready, DO counts that provider's ledger rows by `success` and `error_code`, from Ready time onward. ≥ 1 success and 0 auth-class rows is "pass (from traffic)". No rows is "not probed (no traffic)", never 0.
  - **When the traffic read can be used:** only where that environment writes to its own database, as recorded. Where another deployment writes to the same ledger, a count cannot say which deployment wrote it, and the traffic read is "not conclusive (shared ledger)". The same caveat applies to the L1 ledger read above.
- **Q-D6d-3: no functional probe for either reader.** Neither model-name reader has a trigger that meets the Q-D6d-2 criteria. The model-name row is: Set / Not set on `/admin/environment`, **plus** the user's "model available to the recorded project: yes/no", **plus** "a pricing row exists for that model" (read in the price review stream's admin screen, read-only). T-LLM-9 stays as the drift check. The row says "no functional probe".
- **Q-D6d-4: yes, as counts only, under two rules.**
  1. The query's select list holds only `provider`, a derived class and `count(*)`. `error_message` appears only inside a `CASE` / `WHERE` match, and is never selected, grouped, ordered or returned.
  2. The patterns are fixed in the skill:
     - **Groq:** derived from our own code. The prefix "Groq API error: " followed by the status, so `401` is the auth class and `429` is the quota/rate class.
     - **Anthropic:** the SDK's message format, so "status number at the start of the message: confirm against the installed SDK at use time".

  Anything unmatched is class "other", and an "other" > 0 is reported as "unclassified failures", never folded into 0. The D6d.4 criterion becomes "`error_message` never selected or returned" (change 3).
- **Q-D6d-5: accepted as FU-D6d-b (Low, code).** It now covers both cases: the catalogue (or `/admin/environment`) flags a provider key that is unset where either a settings row selects that provider or a code path constructs that provider directly (the help bot's Groq). Or it records why not. The skill's T-LLM-4 stands either way.
- **Q-D6d-6: settled.** The throw is not a counted class (LM-2). It stays out of the T- rows, and the skill describes it as "the call fails on that path; the caller's own log line, if any, carries it". Constructor options are as given in LM-6 above.
- **Q-D6d-7: ≤ ~175 lines.** The help bot preconditions add a few lines over `stripe.md`. If it runs over, Dev trims prose, never probe or drift rows.

### Public-repo check

- **The spec text is clean of ids, key prefixes, domains, URLs and personal paths.** It names no model and does not say which environment has which key. Env var names, repo paths and the `feature` values above are fine.
- **Line numbers** in LM-2 (`~lines 44–48, 117–202`) are fine as SA pointers in the requirement. They must not reach `llm-providers.md`.
- **LM-8's opening sentence must become a statement about the probe paths** (change 11). The skill states what the named probe paths write and nothing about coverage elsewhere.
- **The model-name probe row** loses its pricing-log condition with the neutral reason "no functional probe" (Q-D6d-3). No other reason goes into tracked text.
- **Vendor addresses:** the factory's throw messages contain vendor console addresses. Neither the requirement nor the skill may quote the messages past "environment variable is not configured" (change 4).
- **Model-family words:** the D6d.4 grep lists the OpenAI and Anthropic model-family prefixes. The code defaults also include Groq-hosted and Kimi model families, so the grep must cover those too (change 9).
- **The help bot probe** is described by its screen and route path, its `feature` values and its side effects. It does not name the settings key behind "semantic search on".
- **Recorded live-check results** use the DO-6b form, by role, with no target named.

### New pattern and CI time (CLAUDE.md rule 7)

- **No new pattern.** It is one reference file plus one index row and triggers, under the shape DO-6b and DO-6c set. The traffic read and the counts-by-pattern query are probe variants inside the existing `devops.md` read-only SQL rules (a)–(d), not new machinery.
- **No added CI time.** No job, workflow or test is added. The CI gates on the PR are the existing ones, unchanged.

### Required changes

1. **[LM-5, (1) L3 row, T-LLM-4, (7) order] Groq's code dependency.** LM-5 and the part (1) L3 row are rewritten as: "Set wherever the help bot is served (the help bot constructs the Groq provider directly; its settings rows choose the model only), and wherever a settings row selects Groq". T-LLM-4 reads: "every provider that a settings row selects, **or that a code path constructs outside the factory** (derived from code at `origin/main`), has its key Set on that environment's deployment". The "removing a key" order row adds "and no code path constructs that provider directly". Pass: no sentence in the spec or `llm-providers.md` says Groq is reached only through a selection. — Priority: High
2. **[LM-9, part (5) gotcha] Two ledger cases.** (a) The service-role key is set but wrong: the call succeeds, the ledger write fails, and one of the two lines appears under `service` `AIAnalyticsService`. The probe is then "not conclusive (ledger write failed)". (b) It is unset: every factory call fails before reaching the provider. That is a database-credential fault, routed to `supabase-ops`, not a provider fault. Replace "module `AIAnalyticsService`" with "service `AIAnalyticsService`". Pass: both cases are stated and the field name is correct. — Priority: High
3. **[LM-8, part (4), D6d.4] Never-read columns and the pattern count.** The never-read list is `error_message`, `request_payload`, `response_metadata` and `user_id`. The D6d.4 criterion becomes: "these four are never selected, grouped, ordered or returned; `error_message` appears only inside the fixed Q-D6d-4 match". Add the Q-D6d-4 class query rules: the Groq pattern is from code, the Anthropic pattern is confirmed at use time, and unmatched failures are "unclassified" and reported. T-LLM-5 uses those classes for Anthropic and Groq. Pass: a QA grep finds `request_payload`/`response_metadata`/`user_id`/`error_message` only in never-read or match-only text. — Priority: High
4. **[LM-2, LM-6, Q-D6d-6] Throw text and implicit names.**
   - The throw is described as "the call fails; the caller's own log line, if any, carries it". It has no T- row, and no text past "environment variable is not configured" is quoted.
   - LM-6 states per client which implicit names can still apply (the table above), with the names themselves from SDK docs at use time.
   - Groq is "no SDK-implicit names". The Kimi line says only the OpenAI organisation and project names reach it.

   Pass: no vendor address in either file, and no typed list of implicit names. — Priority: Medium
5. **[LM-10, LM-11, T-LLM-6, T-LLM-9] Precise classes.**
   - T-LLM-6 counts module `BosLlmModelFallback` and says "0 does not prove model access when the configured model is the code default; at most one line per instance per settings-cache period".
   - T-LLM-9 counts module `AiPricing`, level `warn`.
   - Every quoted string carries its module or service name, checked with `grep -cF` at build.

   Pass: each quoted log string has its logger field (module or service) next to it, and each `grep -cF` is ≥ 1. — Priority: Medium
6. **[(4) model-name row, Q-D6d-3] Drop the pricing-log pass condition.** The row becomes: Set / Not set, plus the user's availability report, plus "pricing row present" (read-only), with "no functional probe". The side-effects cell is "None". Pass: the row has no "next call" condition. — Priority: Medium
7. **[(4) probe rows, Q-D6d-2] Name the probe paths as ruled.**
   - L1 and L3 use the help bot question, with its precondition, the three calls, the shared answer-cache row (no in-app cleanup), the analytics counter, the platform-account ledger rows, the source-badge pass for L3 and the ledger pass for L1. A FAQ or Cache badge is "not probed (answered from FAQ or cache)".
   - L2 and L4 get "no app-side probe; `/admin/environment` Set + user dashboard read".
   - All four get the optional traffic read, with "not conclusive (shared ledger)" where another deployment writes to the same ledger.

   Pass: each of L1–L4 has a probe row with precondition, pass, fail, not-probed states and side effects. — Priority: High
8. **[Boundary, (2)] Admin screens without a list.** Replace the two named screens with "the admin screens that edit those rows, found at use time (for example the Business OS LLM and AIS config screens)". Add to part (2) that the V6 admin config lives in `system_settings_config`, read by `AgentGenerationConfigService.ts`. Pass: no exhaustive screen list; the V6 "SA to confirm" is removed. — Priority: Low
9. **[D6d.4 public grep] Widen the model-name grep.** It also covers the Groq-hosted and Kimi model families as the provider files' model constants name them, plus the two URL schemes and any vendor host. QA derives the family list from `GROQ_MODELS` and `KIMI_MODELS` at use time and does not copy it into tracked text. Pass: 0 hits in `llm-providers.md`. — Priority: Medium
10. **[(1), T-LLM-4] Kimi wording** (Q-D6d-1). Kimi is "covered when selected", and its probe is "not probed (not selected)" until a row selects it. Pass: present in parts (1) and (4). — Priority: Low
11. **[LM-8 wording] Coverage-neutral text.** LM-8's first sentence becomes "Each probe path named in part (4) writes one `token_usage` row per call (through `callWithTracking`), including auth and quota failures as `success = false`". No sentence in the requirement or the skill describes which other code paths do or do not write rows. Pass: LM-8 opens with that sentence. — Priority: Medium
12. **[D6d.3 follow-ups] Record in the requirement, not in the skill:**
    - FU-D6d-a (Low) as written.
    - FU-D6d-b (Low) widened per Q-D6d-5.

    Pass: both are listed in D6d.3 and absent from `llm-providers.md`. — Priority: Low
13. **[Length] ≤ ~175 lines** (Q-D6d-7). Pass: `wc -l` ≤ 175, with no probe or drift row cut. — Priority: Low

### Checked and honoured

- **DO-6 changes 1–7:** every probe has a precondition or reads "not probed". A rotation overlap is "pass, not conclusive". Local is "not read". Derivation is from code (catalogue, `PROVIDERS`, direct constructions), there are no copied lists, and the T-LLM rows live in `llm-providers.md`.
- **DO-6c lessons:** each probe has an exact pass and fail, no probe passes on an unset value (the L1 ledger fail needs the LM-9 classes at 0; the L3 pass needs the Groq badge), side effects are named, and quoted strings are verbatim with their module.
- **Probe safety:** no probe needs DO to hold a key. Every functional probe spends real money, is user-approved and runs once. No script runs without the user naming it and the account it charges. No probe charges customer credits or writes customer data.
- **Tiers:** any change to a key, project, limit or model name that production uses is production tier, and every change to a shared key is production tier. DB-held model choice stays the admin screens' and the runbook's. DO reads provider values only.

### Approval

[x] Spec approved with changes 1–13. Dev builds `llm-providers.md` and the SKILL.md index row and triggers after the main session's Q-D6-2 live check. No user decision is needed.

---

## DO-6d implementation notes

**By Dev — 2026-11-02.** Branch `feature/devops-third-party-llm`, worktree at `origin/main` (`26df15e5`). Config/docs only; nothing committed. The SA short pass's changes 1–13 and rulings Q-D6d-1..7 override §DO-6d wherever they differ; this time they are also folded into §DO-6d where they correct facts (its header says so), so the spec does not lag the review. `llm-providers.md` follows the SA text.

| File | Change |
|---|---|
| `.claude/skills/third-party-ops/llm-providers.md` | New, 142 lines (under ~175): a credential table L1–L5 + M and a boundary paragraph, then six parts plus tiers and order, T-LLM-1..10, mirroring `google.md`'s section order and table style. L1–L4 separate in every part; L5 one line; M its own row. No line numbers, no model name, no setting-key list. LF line endings, like `google.md` |
| `.claude/skills/third-party-ops/SKILL.md` | §5 index row now points at `llm-providers.md`; description triggers gain an OpenAI, Anthropic, Groq or Kimi key, an LLM provider key, rotating an LLM key, a model-name env var, an LLM spend limit or budget, provider usage or billing (D6d-2). CRLF preserved; 2 lines changed |
| This requirement | §DO-6d spec (SA changes applied), SA Review — DO-6d (short pass), these notes, two Change History rows, §0 DO-6 row. CRLF preserved |

| SA change | Where / how applied |
|---|---|
| 1 | §1 L3 row uses the SA wording (help bot constructs Groq directly; rows choose the model only); §2 L3 row; §5 "Groq does not depend on a selection"; T-LLM-4 adds "or that a code path constructs outside the factory"; §7 "Removing a key" adds "no code path constructs it directly", and the tiers sentence adds "a direct construction". No sentence says Groq is reached only through a selection |
| 2 | §4 ledger-write rule (set but wrong: "not conclusive (ledger write failed)"); §5 "The ledger needs the service-role key too" states both cases and routes unset to `supabase-ops`. Field is "service `AIAnalyticsService`" throughout |
| 3 | §4 "Ledger reads": the four never-read columns never selected, grouped, ordered or returned; `error_message` only inside the fixed class match; Groq class from code, Anthropic class confirmed at use time, "other" reported as "unclassified failures". T-LLM-5 uses those classes |
| 4 | §5 "An unset key fails the call" quotes only "environment variable is not configured", no T- row. §5 SDK-implicit gotcha states per client which kinds of names can apply, names from SDK docs at use time; Groq "no SDK-implicit names"; Kimi only the OpenAI organisation and project names. No vendor address, no typed name list |
| 5 | T-LLM-6 module `BosLlmModelFallback` with the "0 does not prove model access…; at most one line per instance per settings-cache period" text; T-LLM-9 module `AiPricing`, level `warn`; every quoted string carries its module or service (checked below) |
| 6 | §4 model-name row: "No functional probe", Set / Not set + availability + pricing row present; side effects "None"; no "next call" condition |
| 7 | §4 rows: L1 and L3 one help bot question with the precondition, three calls, platform-account ledger rows, answer-cache row (no in-app removal), analytics counter, Groq-badge pass for L3, ledger pass for L1, FAQ/Cache "not probed"; L2 and L4 "No app-side probe. `/admin/environment` Set, plus the user's dashboard read"; the optional traffic read row, with the shared-ledger rule |
| 8 | Boundary paragraph: "the admin screens that edit those rows (found at use time; for example the Business OS LLM and AIS config screens)"; §2 settings-rows row names the V6 admin config in `system_settings_config`, read by `AgentGenerationConfigService.ts` |
| 9 | §D6d.4 grep criterion widened (Groq-hosted and Kimi families derived from `GROQ_MODELS` / `KIMI_MODELS` at use time, URL schemes, vendor hosts), without writing any family prefix into tracked text. Ran over `llm-providers.md`: 0 hits (below) |
| 10 | §1 L4 row "Covered when selected"; §4 L4 row "not probed (not selected)"; credential table L4 "covered when selected" |
| 11 | §DO-6d LM-8 opens "Each probe path named in part (4) writes one `token_usage` row per call (through `callWithTracking`)". `llm-providers.md` §2 ledger row names the writer only, with no claim about coverage |
| 12 | FU-D6d-a and FU-D6d-b (widened) are in §D6d.3 and below; neither is in `llm-providers.md` |
| 13 | `wc -l` 142 (≤ 175); no probe or drift row cut |

**Code follow-ups (not in this slice).**

| ID | Priority | Item |
|---|---|---|
| FU-D6d-a | Low | `isProviderAvailable`, `getAvailableProviders`, `getStatus` and `clearInstances` in `providerFactory.ts` cover Groq like the other providers, with tests, or record why not |
| FU-D6d-b | Low | The catalogue (or `/admin/environment`) flags a provider key that is unset where either a settings row selects that provider or a code path constructs it directly (the help bot's Groq), or records why not. T-LLM-4 stands either way |

**Public-safety edits.** In the SA short pass as recorded here, two passages were reworded so tracked text carries no model-family prefix or URL scheme: the "Model-family words" bullet names "the OpenAI and Anthropic model-family prefixes" instead of quoting them, and change 9 names "the two URL schemes" instead of writing them. Nothing else in the review was changed. In §DO-6d, the D6d.4 grep criterion is worded the same way.

**Verification done.** Every path named in `llm-providers.md` exists in the worktree (scripted check; bare file names resolve to the file the row means). Quoted strings found by `grep -cF` in their files, with their logger field: "Failed to insert token_usage row" and "AI call tracking threw; row not written" (`lib/analytics/aiAnalytics.ts`, service `AIAnalyticsService`); "Provider rejected the configured model; retrying once with the code default" (`lib/business-os/llm/modelFallback.ts`, module `BosLlmModelFallback`); "No pricing found; recording $0 for this call" (`lib/ai/pricing.ts`, module `AiPricing`); "Cache search error" (`app/api/help-bot-v2/route.ts`, module `HelpBotV2API`); "Groq API error: " (`lib/ai/providers/groqProvider.ts`, thrown error text, not a log line); "environment variable is not configured" (`lib/ai/providerFactory.ts`, thrown, not logged by the factory). Function and identifier names checked: `getProviderFactory`, `getProvider`, `isProviderAvailable`, `getAvailableProviders`, `getStatus`, `getAnalytics`, `clearInstances`, `callWithTracking`, `isModelUnavailableError`, `getOpenAI`, `PROVIDERS`, `required-not-set` (`classifyEnvironment.ts`). The help bot route builds `GroqProvider` from `GROQ_API_KEY` in both model calls; its feature values `help_bot_v2` (route) and `helpbot` (`EmbeddingService.ts`) and its `Groq`, `FAQ` and `Cache` sources are as the probe row says. Both `eval:chat` and `bos:llm-settings` import `scripts/env-preload.ts`.

**Could not verify / open.**
- The Q-D6-2 live check (each of L1–L4 still has a code path that runs, Kimi when selected, and the names set on Vercel) is the main session's; it was not given to Dev; the main session recorded the dated result in the spec on 2026-11-02 (all four stay; configuration is checked at use time). `llm-providers.md` keeps L1–L4 and states the check.
- Vendor facts (console area names, SDK-implicit env names, the Anthropic error message format, OpenAI error code names, usage reporting delay, refusal at a spend limit) are not verifiable from code; each is marked "confirm at use time".
- `llm-providers.md` is LF; it becomes CRLF on the next touch, as `google.md` will.

---

## SA Code Review — DO-6d

**Code Review by SA — 2026-11-02**
**Status:** ✅ Code Approved

Reviewed the uncommitted DO-6d worktree (`llm-providers.md` new, `SKILL.md` index row and triggers, this requirement) against the DO-6d spec, SA Review — DO-6d (short pass) changes 1–13 and rulings Q-D6d-1..7, and the DO-6d implementation notes. Local reads and greps only: no platform call, no SQL, no vendor call, no network call, no `.env*` file.

### SA changes 1–13 and rulings Q-D6d-1..7 in `llm-providers.md`

All 13 landed as ruled. Change 1: §1 L3 row, §2 L3 row, the "Groq does not depend on a selection" gotcha, T-LLM-4 ("or that a code path constructs outside the factory"), and the tiers sentence and "Removing a key" row both name a direct construction. No sentence says Groq is reached only through a selection. Change 2: both ledger cases are stated, unset goes to `supabase-ops`, and the field is service `AIAnalyticsService`. Change 3: the four never-read columns, `error_message` only inside the fixed class match, the Groq class from code, the Anthropic class confirmed at use time, and "other" reported as "unclassified failures". T-LLM-5 uses those classes. Change 4: only "environment variable is not configured" is quoted, it has no T- row, the implicit names are given per client as kinds, never as names, and no vendor address appears. Change 5: T-LLM-6 and T-LLM-9 carry their module, level and caveats. Change 6: the model-name row has "No functional probe" and no "next call" condition. Change 7: L1 and L3 share one help bot row with its precondition, pass, fail, not-probed states and side effects. L2 and L4 have no app-side probe. The traffic read is there with the shared-ledger rule. Change 8: the screens are examples found at use time, and the V6 config is in `system_settings_config`. Change 9: see the greps below. Change 10: Kimi is "covered when selected" in the table, §1 and §4. Change 11: the §2 ledger row names the writer only. Change 12: both follow-ups are in §D6d.3 and the notes, and neither is in the skill. Change 13: 142 lines, and no probe or drift row was cut. Q-D6d-1..7 are reflected as settled in §D6d.5.

### Code claims checked at this tree

| Claim in `llm-providers.md` | Result |
|---|---|
| Every named path exists (factory, five provider files, `baseProvider.ts`, embedding and image services, help bot route, both model-name readers, settings and policy, routing, V6 config and orchestrator, ledger, pricing, charge recorder, catalogue, V1 strategy, `backups/`, env preload, jest setup, model fallback, runbook) | ✅ |
| Catalogue `ai`: OpenAI and Anthropic `exp('R', 'R', 'O')`; Groq and Kimi default; the two model names `config(..., 'identifier')`; `required-not-set` in `classifyEnvironment.ts` | ✅ |
| Factory: one static instance per provider; the key is checked on first use with the "not configured" throw (4 hits); `getAnalytics()` builds the service-role client before each provider instance; the availability helpers and `getStatus` cover openai, anthropic and kimi only | ✅ |
| Help bot: session required; `new GroqProvider(process.env.GROQ_API_KEY!, …)` in both model calls; settings choose the model only; FAQ, then cache (exact, then semantic when the setting is on, using an embedding), then Groq; then the answer is stored with a second embedding when semantic search is on; one analytics RPC per answer; `help_bot_v2` (route) and `helpbot` (`EmbeddingService`) feature values; attribution to the system account | ✅ |
| Ledger: `callWithTracking` writes success and failure rows (`error_code` = `error.code` or `UNKNOWN`, `cost_usd` 0 on failure, `error_message` on failure); `request_payload` and `response_metadata` are in the insert | ✅ |
| Groq is plain `fetch`, error "Groq API error: " plus the status; OpenAI and Anthropic clients get the key only; Kimi gets the key and an explicit base URL | ✅ |
| Quoted strings, `grep -cF`, with their logger field: "Failed to insert token_usage row" 1 and "AI call tracking threw; row not written" 1 (service `AIAnalyticsService`); "Provider rejected the configured model; retrying once with the code default" 1 (module `BosLlmModelFallback`); "No pricing found; recording $0 for this call" 2 (module `AiPricing`, `warn`); "Cache search error" 1 (module `HelpBotV2API`); "Groq API error: " 1 (thrown text) | ✅ |
| `OPENAI_MODEL` and `OPENAI_CHAT_MODEL` readers; `eval:chat` and `bos:llm-settings` import `scripts/env-preload.ts`; jest setup stubs the two main keys; embeddings through `getProvider(PROVIDERS.OPENAI)`, images through `getOpenAI()` | ✅ |

### Probes, public repo, template

- **Probes:** each one can fail. An unset OpenAI key gives 0 `helpbot` rows (the factory throws before any tracked call, and both help bot catches swallow it), so the L1 fail "0 rows while both ledger-write classes are 0" catches it. No probe needs DO to hold a key. Every functional probe is optional, user-approved, run once, and named as spending money. The cache row, the analytics counter and the platform-account ledger rows are named as side effects.
- **Public repo:** the finding-11 regex over the added lines of all three files returns 0. The extra greps also return 0 in `llm-providers.md`: hosts and URL schemes, the Groq and Kimi model constants derived at use time from the provider files and not copied here, setting-key prefixes, the help bot setting keys, and line references. The added text states no current configuration and no open weakness. The `~lines` pointers stay in SA text only, as ruled.
- **Template:** the same sections and order as `google.md`. `SKILL.md` changes only the description triggers and the §5 row (2/2 lines), and its working copy is still CRLF. `llm-providers.md` is LF, which is the same as `google.md` was. The stored file is LF under `core.autocrlf`.

### Fixes made by SA

1. `llm-providers.md` §4 help bot row and the spec's matching row. The route answers a find-an-agent question from the caller's own agents, before it looks at the FAQ, so that answer gets neither a FAQ nor a Cache badge. The precondition now says "and must not ask to find an agent". The not-probed state now covers "an agent-search answer".
2. SA Review — DO-6d (short pass), the "LM-8's opening" bullet and change 11's pass, plus the matching notes row (change 11). Each one quoted the old LM-8 wording. They now describe that wording without quoting it, under the same scrub rule that DO-6a set.

### Optimisation Suggestions

- None blocking. Under `core.autocrlf`, `llm-providers.md` turns into CRLF the next time git touches it. No action is needed.

### Code Approved for QA: Yes

---

## QA Report — DO-6d

**QA — 2026-11-02**
**Test mode:** full · **Strategy:** static checks (`test -e` on every backticked path, `grep -cF` verbatim string lookup with the logger field read from each file's `createLogger` call, read-through of the factory, help bot route, providers, ledger and catalogue against each claim, YAML parse, anchor resolution, byte-level line-ending count, `git diff --numstat` with and without `--ignore-cr-at-eol`). This is a docs/config-only slice with no runtime to exercise. · **Focus:** security (public repo, current-state text, probe safety), schema (frontmatter) · **Skipped:** the fresh-session load test (deferred, as for DO-1 to DO-6c) · **Input source:** TL prompt + §D6d.4 + SA Review — DO-6d (short pass) changes 1–13 and rulings Q-D6d-1..7 + SA Code Review — DO-6d. Run in the DO-6d worktree on the uncommitted changes. No platform call, no SQL, no vendor call, no network call; no `.env*` file opened.

### Test Coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | §D6d.4: six parts plus tiers/order, by L1–L4, L5 one line, M one row; live check by role | Pass | Credential table L1–L5 + M, boundary paragraph, then §1–§7. L1–L4 separate in §1, §2 and §4; L5 is one row ("Not wired: not a gap"); M is its own row. The live check is a procedure ("a code path that runs (for Kimi … **when selected**), and the names set on Vercel"), naming no environment |
| 2 | Every backticked path exists | Pass | All 25 repo paths pass `test -e`. Bare names resolve to one file each: `V6PipelineOrchestrator.ts` → `lib/agentkit/v6/pipeline/`, `modelSettingsPolicy.ts` → `lib/business-os/llm/`, `devops.md` → `.claude/agents/`; the other bare names repeat a full path given earlier in the file. `/admin/environment` → `app/admin/environment/page.tsx`. The four cited skills exist, and so do the sections cited in them: `vercel-ops` §3 Env vars, `env-drift-audit` §7, `supabase-ops` §2, `devops.md` rules (a)–(d), `SKILL.md` §2 (key holder) and §5 |
| 3 | §D6d.4: a probe row for each of L1–L4 with precondition, pass, fail, not-probed, who, side effects; money and ledger stated; no script runs | Pass | §4 has a shared L1+L3 help bot row (precondition: Ready, normal session, a new question, not an agent search, semantic search on), L2 and L4 rows ("No app-side probe"; L4 "not probed (not selected)"), the traffic-read row ("not probed (no traffic)"), the account, model-name and rotation rows. Every row has `Who` and `Side effects`. The §4 intro says "**real provider call: it spends real money and writes ledger rows**", "not probed (declined)", and "No probe runs `eval:chat`, `bos:llm-settings` or any key-reading script" |
| 4 | §D6d.4: the four never-read columns; `error_message` only in the class match; LM-9 "not conclusive"; no "Groq only through a selection" | Pass | `request_payload`, `response_metadata` and `user_id` appear only in the never-read sentence. `error_message` appears in that sentence, in "appears only inside the fixed class match", and in the Groq class bullet. The ledger-write rule makes a missing row "not conclusive (ledger write failed)" unless both `AIAnalyticsService` lines are 0. "only through", "reached only", "only reached" over `llm-providers.md`: 0. The Groq gotcha says the opposite |
| 5 | §D6d.4: DB-held model choice is the admin screens' and the runbook's; T-LLM-4 the only DO read | Pass | Boundary paragraph: owned by "the admin screens that edit those rows (found at use time …)" and the runbook; "DO reads those rows read-only for one purpose: which providers they select (T-LLM-4). DO never writes them" |
| 6 | §D6d.4: SDK-implicit names per client, never listed; "SDK docs at use time" | Pass | §5 gotcha gives kinds per client (OpenAI: base URL, organisation, project; Anthropic: base URL, auth token; Kimi: the OpenAI organisation and project only; Groq: none) and "the names themselves come from each SDK's docs at use time, for the version in `package.json`". No env name of that kind appears. Code: `new OpenAI({ apiKey })`, `new Anthropic({ apiKey })`, Kimi `new OpenAI({ apiKey, baseURL })`, Groq plain `fetch` with its own header |
| 7 | §D6d.4: no copied lists (model constants, model families, setting-key prefixes, URL schemes, hosts, line refs) | Pass | Values of `OPENAI_MODELS`, `ANTHROPIC_MODELS`, `GROQ_MODELS` and `KIMI_MODELS` plus their family stems, derived from the provider files at use time and kept in the scratchpad only: 0 hits. The only stem hits are the provider name "Kimi" and the substring of the V1 path `chatgptResearchStrategy.ts`, neither of them a model name. The four constant names, `bos_llm_area_`, `orchestration_routing_`, `helpbot_`, URL schemes, `www.`, `.com`, `localhost`, `~line`, `:NN`: 0. Case-insensitive greps were run on a lowercased copy, because `grep -i` aborts on this file under Git Bash |
| 8 | §D6d.4: quoted log strings verbatim with their logger field; vendor text marked; nothing quoted past "not configured" | Pass | `grep -cF`: "Failed to insert token_usage row" 1 and "AI call tracking threw; row not written" 1 (`aiAnalytics.ts`, `createLogger({ service: 'AIAnalyticsService' })`); "Provider rejected the configured model; retrying once with the code default" 1 (`modelFallback.ts`, module `BosLlmModelFallback`); "No pricing found; recording $0 for this call" 2 (`pricing.ts`, module `AiPricing`, both `logger.warn`); "Cache search error" 1 (help bot route, module `HelpBotV2API`, `log.error`); "Groq API error: " 1 (`groqProvider.ts`, thrown text); "environment variable is not configured" 4 (`providerFactory.ts`, thrown, not logged by the factory). The skill quotes nothing after that clause. Vendor facts (console areas, Anthropic message format, OpenAI code names, reporting delay, refusal at a limit) each carry "confirm at use time" |
| 9 | §D6d.4: restatement grep (§D6.4 list) | Pass | `Snapshot the before-state`, `\| **Read** \|`, `begin read only`, `filter_project_envs`, `decrypt` over `llm-providers.md`: 0 |
| 10 | Brief: public-repo regex over added lines | Pass | The brief's regex over all 534 added lines (`llm-providers.md` `git add -N`'d, then `git reset -q`; `git status` shows it untracked again): **0** |
| 11 | Brief: weakness-wording grep over added lines (word list kept with the main session) | Pass | 3 hits, all the rule text that bans the class: the SKILL.md description's "open weaknesses leaking into tracked text" (an unchanged clause on a changed line) and SA Code Review's "states … no open weakness". None names a weakness |
| 12 | No statement of the current setup | Pass | Added lines: "currently" 0; "today" 2 (§D6d.1 "where each value lives today is not derivable from the repo" and the §D6d.4 criterion), "only on" 2 (LM-2 "takes effect only on the deployment that carries it", the SA LM-10 note), "is configured" 1 ("whether each one is configured is not recorded here"), "not set" 13 (probe states and rules). All are rules, probe states or criterion text. The recorded live check names no target and records no configuration |
| 13 | Code claims: factory | Pass | `PROVIDERS` lists openai, anthropic, kimi, groq; four static instances; each `get*Provider` throws on an unset key, then calls `getAnalytics()` (service-role `createClient`) before `new …Provider`. `isProviderAvailable` handles openai/anthropic/kimi and returns false for anything else; `getAvailableProviders` and `getStatus` cover the same three; `clearInstances` does not reset Groq. `getProviderFactory()` is exported from the same file. No `MISTRAL_*` reader and no `new MistralProvider` outside its file (one `'MISTRAL_MODELS'` string in a literals checker script) |
| 14 | Code claims: help bot probe | Pass | `getUser()` → 401 when signed out. Order: input-help mode (only with `context.mode === 'input_help'`), agent search (`AgentSearch`), FAQ (`FAQ`), cache (exact, then semantic when the setting is on, using an embedding), then Groq (`Groq`). `new GroqProvider(process.env.GROQ_API_KEY!, …)` in both model calls, model names from settings; an unset key gives `Bearer undefined` and a vendor error, not "not configured". `feature: 'help_bot_v2'`, `userId: 'system'` (recorded against the platform account). Embeddings are `feature 'helpbot'` through `getProvider(PROVIDERS.OPENAI)`. `storeInCache` makes the second embedding when semantic search is on. `update_support_analytics` RPC once per answer. So three calls, one cache row, one counter, as the row says |
| 15 | Code claims: ledger, catalogue, readers, scripts | Pass | `callWithTracking` failure row: `success: false`, `error_code: error.code \|\| 'UNKNOWN'`, `cost_usd: 0`, `error_message`; the insert also writes `request_payload` and `response_metadata`. Catalogue `ai`: OpenAI and Anthropic `exp('R', 'R', 'O')`, Groq and Kimi `secret(...)` with the `OPTIONAL` default, both model names `config(..., 'identifier')`. `required-not-set` is in `classifyEnvironment.ts`. `OPENAI_MODEL` is read twice in the run-step route and `OPENAI_CHAT_MODEL` twice in `AIDataLayerService.ts`. `eval:chat` and `bos:llm-settings` use `--import ./scripts/env-preload.ts`. Jest setup stubs the two main keys. `isModelUnavailableError` and the default-model guard are in `modelFallback.ts`. `BOS_LLM_SETTINGS_CACHE_MS = 60_000`. V6 config: `system_settings_config` in `AgentGenerationConfigService.ts`, imported by `V6PipelineOrchestrator.ts`. Routing reads `ais_system_config`. The V1 strategy is marked `@deprecated` |
| 16 | SKILL.md: diff only D6d-2; §5 link; triggers; frontmatter | Pass | numstat 2/2: the description and the §5 row. `[llm-providers.md](llm-providers.md)` resolves, and all four §5 links resolve. All five §D6d.3 trigger phrases are present verbatim, plus "rotating an LLM key", which fits the slice. YAML parses: keys `name`, `description`; `name: third-party-ops`; description 1,387 chars on one line |
| 17 | Diff touches only D6d.3 files; structure matches `google.md` | Pass | `git status`: the two edited files and `llm-providers.md`. The `##` headings are identical to `google.md` in name and order (§1–§7), and both files use the same intro, credential table and live-check line |
| 18 | Requirement line endings, rows, anchors | Pass | CR = LF in the requirement (4317/4317 before this report) and in SKILL.md (86/86); `git ls-files --eol` gives `w/crlf`. numstat is identical with `--ignore-cr-at-eol` (390/1); the 1 removed line is the §0 DO-6 row, which now carries the DO-6d text. Change History has two DO-6d rows (spec + SA short pass, build). All 44 in-document `](#…)` anchors resolve; `#do-6d-implementation-notes`, `#sa-review--do-6d-short-pass`, the DO-6d spec heading and `#sa-code-review--do-6d` each resolve to exactly one heading |
| 19 | Length | Pass | `wc -l llm-providers.md` = 142 (≤ ~175, Q-D6d-7). No probe or drift row cut: T-LLM-1..10 all present |
| 20 | Fresh-session load test | Deferred | Skills load at session start. Not failed |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Edge Cases (nice to fix)

1. **§0 DO-6 row and the build Change History row still say "awaiting SA code review and QA"** — `docs/requirements/DEVOPS_AGENT_REQUIREMENT.md`. SA Code Review — DO-6d approved the code, and this report passes it. The main session normally updates both at the user-approval step, as for DO-6c. Severity: Low.
2. **`llm-providers.md` is LF** (0 CR, 142 LF, with a final newline), while `google.md` is now CRLF in this worktree. Git warns that it "will be replaced by CRLF the next time Git touches it", as `email.md` and `google.md` were. Stored as LF either way. Severity: Low.
3. **The help bot row does not name the input-help mode** — the route also answers with source `InputHelp` when the request carries `context.mode === 'input_help'` (field-help from an agent input). The floating help button on a V2 page does not send that mode, so the probe as written cannot land there. An optional addition is "not from a field's help" in the precondition. Severity: Low.

### Final Status

- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

**PASS.** Every §D6d.4 criterion passes, as do SA changes 1–13 and rulings Q-D6d-1..7. The public-repo regex over the added lines finds 0. The 3 weakness-grep hits and the current-state hits are all rule text. Every path, quoted string, logger field and code claim holds at this tree. Three Low edge cases, none blocking.

---
