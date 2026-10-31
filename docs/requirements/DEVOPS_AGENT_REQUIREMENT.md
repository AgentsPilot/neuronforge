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
| DO-4 | `github-ops` skill | 🟡 User approved the diff 2026-10-31; PR open, auto-merge on. See [QA Report — DO-4](#qa-report--do-4), [DO-4 Specification](#do-4-specification--github-ops-skill), [SA Review — DO-4](#sa-review--do-4), [DO-4 implementation notes](#do-4-implementation-notes) and [SA Code Review — DO-4](#sa-code-review--do-4) |
| DO-5 | `claude-harness-ops` skill + `env-drift-audit` skill | ⬜ |
| DO-6 | `third-party-ops` skill — Stripe, Resend/SMTP, Google Cloud, LLM providers, QStash, AWS, messaging, DNS | ⬜ |

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

### DO-4 `github-ops` skill 🟡

Specified in detail in [DO-4 Specification](#do-4-specification--github-ops-skill). Original scope:

How to read and plan changes to repo and org settings: branch protection, required checks, merge queue, auto-merge setting, secret scanning, Actions permissions and workflows. Branch-protection changes are in the user-executes tier. Must carry the gotchas: **auto-merge only when CI is the sole gate**; **pace bulk PR and push activity** (abuse-detection suspension); **never `git stash`** (the stash list is shared across parallel sessions and worktrees).

### DO-5 `claude-harness-ops` skill + `env-drift-audit` skill ⬜

`claude-harness-ops`: how to read and change `.claude/settings*.json`, permissions, MCP servers, hooks and worktrees safely. Must carry the gotcha: **worktrees share `node_modules` through a Windows junction, and `git worktree remove --force` deletes the shared contents. Unlink the junction first.**

`env-drift-audit`: a read-only audit that compares the expected state (repo files, recorded change records, untracked private inventory) with the live state across GitHub, Vercel, Supabase and the harness. It outputs a drift report by area and severity, with no secret values and no IDs in any tracked output.

### DO-6 `third-party-ops` skill ⬜

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
