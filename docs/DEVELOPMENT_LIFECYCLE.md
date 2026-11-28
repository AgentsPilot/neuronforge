# Development Lifecycle (ALM)

> **Last Updated**: 2026-11-27

## Overview

How a change travels from an idea to production once AgentsPilot Business OS has two environments — **Dev/Staging** (`main`) and **Production** (`production` branch) — and how bugs, incidents, releases and feature flags are handled around that path. It is the runbook that [ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md](/docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md) §11 sketches and defers here (§11.6, ClickUp **S10.1**). The environment *topology* stays in that doc; this doc owns the *process*. Decisions recorded here were taken with the user on 2026-11-25, 2026-11-26 and 2026-11-27 (§12).

The process is sized for a team of three core people (Barak, Offir, Eyal), an AI agent team driven by Barak, and occasional outside contributors — no 24/7 on-call, no dedicated QA function.

---

## Table of Contents

1. [Roles](#1-roles)
2. [Tools — where things live](#2-tools--where-things-live)
3. [Branches and environments](#3-branches-and-environments)
4. [Development flow — idea to `main`](#4-development-flow--idea-to-main)
5. [Release flow — `main` to production](#5-release-flow--main-to-production)
6. [Hotfixes and rollback](#6-hotfixes-and-rollback)
7. [Database migrations](#7-database-migrations)
8. [Bug lifecycle](#8-bug-lifecycle)
9. [Severity and response targets](#9-severity-and-response-targets)
10. [Incident response](#10-incident-response)
11. [Feature flags and staged rollout](#11-feature-flags-and-staged-rollout)
12. [Decisions record](#12-decisions-record)
13. [Preparations this process needs](#13-preparations-this-process-needs)
14. [Change History](#change-history)

---

## 1. Roles

| Role | Who | Does |
|---|---|---|
| **Release approver** | Barak or Offir | Approves and merges the release PR into `production`; the only people who can |
| **Developer** | Barak (+ agent team), Offir, Eyal, outside contributors | Branch → PR → `main` |
| **Reviewer** | SA agent for agent-made PRs; Barak or Offir for everyone else's | Code review before merge to `main` |
| **QA** | QA agent | Tests per workplan; runs the smoke test on Staging before a release and on Production after it |
| **Release Manager** | RM agent (or the approver by hand) | Opens the release PR, tags, publishes release notes, moves released issues |
| **On duty** (weekly rotation) | Barak → Offir → Eyal | Reads the support inbox daily, files and triages bugs, first responder for incidents |

**On duty** rotates weekly, Sunday to Thursday. The rotation calendar lives in ClickUp (§13). When the person on duty is away, they hand the week over explicitly — a rotation slot is never silently empty.

---

## 2. Tools — where things live

| What | Where | Why |
|---|---|---|
| **Bugs and incidents** | **GitHub Issues** + one GitHub Project board | Links a bug to the PR that fixes it and the release that ships it; no daily call cap for the agent team; no extra seat for outside contributors |
| Roadmap, feature planning, readiness checklist, non-code tasks | **ClickUp** | Unchanged |
| Requirements, workplans, retrospectives | `docs/` (unchanged agent flow) | — |
| Customer reports | **support@agentspilot.ai** | The customer channel at launch; the person on duty turns emails into issues |
| Release notes | **GitHub Releases** (internal) | Auto-generated from merged PRs; not customer-facing at launch |
| Incident post-mortems | `docs/incidents/YYYY-MM-DD-<slug>.md` | Durable, reviewable |

> ⚠️ **Bugs live in GitHub only once the repository is private.** Bug reports carry account details; while the repo is public, an issue is world-readable. Making the repo private + GitHub Team is therefore a launch prerequisite (§13, R1), not a HARDEN item.

**Linking rule:** every PR that fixes a bug says `Fixes #<n>`; every PR that implements planned work names its ClickUp task ID in the description.

---

## 3. Branches and environments

```text
feature/* fix/*  ──PR──▶  main  ──auto-deploy──▶  Dev/Staging  (stable host)
                            │
                            └──cut at the Staging SHA──▶  release/vYYYY.MM.DD  ──release PR──▶  production  ──auto-deploy──▶  Production
                                                                                                 ▲
                                                                        hotfix/*  ──PR───────────┘  (then merged back into main)
```

| Branch | Deploys to | Who can merge | Protection |
|---|---|---|---|
| `feature/*`, `fix/*` | PR preview (ephemeral, UI review only) | — | — |
| `main` | **Dev/Staging** automatically on every merge | Author or reviewer, once the branch is up to date with `main` and checks + review pass | Required checks, **branch must be up to date before merging**, 1 approval (bypass: Barak, Offir — see §4) |
| `production` | **Production** automatically on every merge | **Barak or Offir only** | PR required, required checks, 1 approval from Barak/Offir, no direct push, no force-push |
| `release/vYYYY.MM.DD` | — (it is the head of the release PR) | — | Cut by the RM / approver at release step 1 from the exact commit Staging runs; never committed to; deleted after the release PR merges |
| `hotfix/*` | — | — | Branched from `production` |

**No merge queue.** On GitHub Team a private repository cannot have a merge queue (it is Enterprise-only), so `main` uses *require branches to be up to date before merging* instead. Effect: before a PR merges it must contain the current `main` and its required checks must have re-run on that — so two PRs that each pass alone cannot both merge on a stale base. The cost is manual: after another PR lands, press **Update branch** and wait for the checks again. Turn *Require merge queue* off **before** the repo goes private, or every PR is left unmergeable (R4).

**Never** use Vercel's "Promote to Production" on a Preview build — `NEXT_PUBLIC_*` values are baked in at build time, so a promoted Staging build ships Staging's database address to Production. Production always builds from the `production` branch. Rolling back to an earlier *production* build is safe.

---

## 4. Development flow — idea to `main`

1. **Plan.** Work starts from a ClickUp task or a GitHub issue. Non-trivial work follows the agent flow in [CLAUDE.md](/CLAUDE.md) (BA → SA → Dev workplan → SA → implement → SA review → QA → user sees the diff).
2. **Branch** from `main`: `feature/<slug>`, `fix/<slug>`.
3. **Unfinished work ships dark** behind a flag that defaults off (§11). Never hold a long-lived branch to avoid shipping half a feature.
4. **PR to `main`.** Required checks green; description names the ClickUp task or `Fixes #<n>`; schema changes include the migration file (§7).
5. **Review.**
   - Agent-made PRs: SA agent review + the user-approval step in the agent flow. Barak and Offir are bypass actors on the approval rule so their own PRs are not blocked by "cannot approve your own PR".
   - Everyone else's PRs (Eyal, outside contributors): **1 approval from Barak or Offir**, enforced by the ruleset.
6. **Merge** once the branch is up to date with `main` (**Update branch** if it is behind) and the required checks are green on that update. `main` auto-deploys to Staging. An issue closed by `Fixes #<n>` now means **fixed on Staging**, not released.

**Outside contributors** develop locally against Dev/Staging with Staging credentials only. They never receive production credentials or production dashboard access. Consequence: **Staging must hold no real customer data** once production exists (§13, R13).

---

## 5. Release flow — `main` to production

Releases are **on demand** — whenever there is something worth shipping and the approver has time to watch it land. No fixed window.

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | **Pick the release commit and cut the release branch** — the `main` commit currently deployed on Staging, read from Staging's version stamp (§5.4); create `release/vYYYY.MM.DD` at that SHA | RM / approver | The branch exists at the SHA Staging reports |
| 2 | **Smoke test on Staging** — the scripted smoke test (S10.2); it first checks that Staging reports the release SHA | QA agent | Smoke report green and naming the SHA it tested, attached to the release PR |
| 3 | **Manual check of what changed** — click through each changed feature on Staging | Approver | Approver comments "checked on Staging" on the release PR |
| 4 | **Open the release PR** `release/vYYYY.MM.DD` → `production`, titled with the version (§5.1); body = auto-generated notes + migration list + flags to flip | RM | PR open, required checks green |
| 5 | **Apply migrations to Production** if the release has any — *before* the code (§7) | Approver | Migration checker passes on Production |
| 6 | **Approve and merge** the release PR | Approver (Barak or Offir) | Merged; Vercel Production build starts |
| 7 | **Post-deploy verify** — Production reports the release SHA (§5.4), health endpoint green, smoke test against Production, error tracking quiet for 30 min | QA agent + approver | All four true; otherwise roll back (§6) |
| 8 | **Publish** — tag, GitHub Release with notes, move released issues to *Released*, flip any flags listed in the PR | RM | Release published; on-duty person replies to customers whose reported bugs shipped |

**Do not release** when the approver cannot watch the next 30 minutes, or into a known Sev 1/2 on Staging.

**Why a release branch.** Dev and Staging are one environment, and `main` keeps moving. A release PR straight from `main` would pick up anything merged after step 1 — code nobody tested in steps 2–3. The release branch pins the release to the SHA that was tested, so `main` stays open throughout and later merges simply wait for the next release.

**Hold merges during steps 2–3 only.** Staging can only test what `main` is running, so while the smoke test and the manual check run (typically under an hour), the approver asks the team not to merge to `main`. Both steps start and end by checking that Staging still reports the release SHA. If it moved anyway, delete the release branch, cut a new one at the new SHA, and repeat steps 2–3. From step 4 on, merging to `main` is open again.

### 5.1 Versioning

CalVer: **`vYYYY.MM.DD`**, with a suffix for a second release on the same day — `v2026.12.07`, `v2026.12.07.2`. The tag goes on the `production` merge commit. Hotfix releases are versioned the same way. There is no SemVer: nothing external pins to a version of this app.

### 5.2 Release notes

GitHub's auto-generated notes, grouped by label via `.github/release.yml` (Features · Fixes · Security · Internal). Internal only at launch — no customer-facing changelog. The on-duty person tells individual customers when *their* reported bug ships.

### 5.3 What a release contains

A release is **all of `main` up to the release commit** — never a hand-picked set of PRs. The rule that makes this work: **merged to `main` means releasable.**

| A PR on `main` is not ready to ship | Do this before the release |
|---|---|
| Feature still in progress | It should already be **behind a flag that is off** (§11) — it reaches Production switched off |
| Broken or no longer wanted | **Revert it on `main`**; the revert deploys to Staging and is checked like any change |
| Risky but wanted | Release it, with Instant Rollback ready (§6) |

**No cherry-picking into `production`.** A cherry-picked release is a combination Staging never ran, so the smoke test and the approver's check stop proving anything; migrations can land out of order; and every later release has to reconcile the drift. The only commits that reach `production` without passing through `main` first are hotfixes (§6), and they are merged back the same day.

**What is on Staging but not yet in Production** is GitHub's compare view `production...main`. The release PR shows that list up to the release commit; on the board it is the *On Staging* column (§8.4).

### 5.4 Version stamp — which build is running

Every build reports **environment, short commit SHA and build time**, taken at build time from Vercel's system variables (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`) and the environment name. It is visible in two places:

- **`GET /api/version`** — returns those three values and nothing else; the smoke test (R10) checks it before testing anything.
- **One line in the app** — Settings and the admin area — so a customer, the on-duty person or a bug report can quote it.

The stamp is the **SHA, not the CalVer tag**: Vercel builds from a shallow clone with no tags, and the tag is created only after the build (§5 step 8). Each GitHub Release names its SHA, so SHA → version is one lookup. Staging always shows a SHA from `main` with no tag; Production shows a SHA that belongs to a release. The Vercel dashboard shows the same commit, but only to people with dashboard access — the stamp is what support, customers and the QA agent can see.

---

## 6. Hotfixes and rollback

**Sev 1 → roll back first, fix second.** Vercel Instant Rollback restores the previous production build in seconds. It does **not** roll the database back — which is why every migration must be safe to run under the previous release (§7).

**Then fix — default is fix-forward:**

| Situation | Path |
|---|---|
| `main` holds nothing unreleased that is risky | Fix on `main` as usual, then a normal release (§5), steps 2–3 shortened to the fixed flow |
| `main` holds unreleased work that must not ship yet | `hotfix/<slug>` from `production` → PR into `production` (same checks, same approval) → release → **merge `production` back into `main` the same day** |

Required checks are never waived for a hotfix; they take minutes.

### 6.1 Hotfix versions

- **A hotfix is a release in its own right:** CalVer tag on its `production` merge commit (`v2026.12.09`, or `v2026.12.09.2` if a release already went out that day) and its own GitHub Release, labelled hotfix, listing only the fix. Its issue moves to *Released* at that point.
- **The merge back is a PR `production` → `main`**, through the normal checks and up-to-date rule. Without it the next regular release would undo the fix. If `main` changed the same code, the conflict is resolved in that PR — never by force-pushing either branch.
- **The next regular release carries the fix automatically** (it is on `main` after the merge back) and does not list it again.
- **Which environments have the fix** is answered by the version stamp (§5.4): compare each environment's SHA with the hotfix commit.

---

## 7. Database migrations

Owned in detail by ClickUp **S10.3** and the `supabase-ops` skill; the lifecycle rules are:

1. **Every schema change is a migration file in the PR.** No dashboard SQL against either environment, ever (the rule PROD-2 establishes).
2. **Staging first.** A migration is applied to Staging when its PR merges, and must be proven there before it is in a release.
3. **Additive or expand/contract.** A migration must be safe for the *currently deployed* code: add columns/tables first, switch code in a later release, drop in a later release still. A destructive migration shipped with the code that needs it is a deploy you cannot roll back.
4. **Production: applied at release step 5, before the code.** Recorded in the release PR body and checked with the migration's checker.
5. **Never ahead, never behind.** A migration goes to Production with the release that needs it.

---

## 8. Bug lifecycle

### 8.1 Intake

| Source | How it becomes an issue | Label |
|---|---|---|
| Customer email to support@ | On-duty person files it, replies to acknowledge | `source:customer` |
| Internal (team member) | Files directly | `source:internal` |
| QA agent / failed smoke / failed test | Agent files via `gh` | `source:qa-agent` |
| Error-tracking alert | On-duty person files it if it is a real defect | `source:monitoring` |

**No customer personal data in issues.** Reference the account by its ID, redact screenshots, and keep the email thread in the support inbox — link nothing that exposes it. Even in a private repo, outside contributors can read every issue.

### 8.2 The issue form

`.github/ISSUE_TEMPLATE/bug.yml` with required fields: **severity**, **environment** (production / staging), **version** (the SHA from the app's version line, §5.4), **area**, steps to reproduce, expected vs actual, account ID, first seen. A second form, `incident.yml`, for §10.

### 8.3 Labels

| Group | Labels |
|---|---|
| Type | `bug`, `incident` |
| Severity | `sev:1` · `sev:2` · `sev:3` · `sev:4` |
| Environment | `env:prod` · `env:staging` |
| Source | `source:customer` · `source:internal` · `source:qa-agent` · `source:monitoring` |
| Area | `area:crm` · `area:scheduling` · `area:payments` · `area:insights` · `area:auth` · `area:plugins` · `area:admin` · … |

### 8.4 States (Project board columns)

| State | Meaning | Moved by |
|---|---|---|
| **Triage** | New, not yet confirmed | Automatic on creation |
| **Confirmed** | Reproduced, severity set, owner assigned | On duty |
| **In progress** | Someone is fixing it | Developer |
| **In review** | PR open | Automatic (linked PR) |
| **On Staging** | Fix merged to `main` (`Fixes #<n>` closes the issue) | Automatic |
| **Released** | Fix is in Production | RM at release step 8 |
| **Won't fix / Duplicate** | Closed without a fix, with a reason | On duty |

### 8.5 Triage rhythm

- The on-duty person reads the support inbox and the *Triage* column **once each working day**.
- Each new issue gets: confirmed or closed, a severity, an owner, and — for `source:customer` — an acknowledgement reply within the §9 target.
- **A Sev 1 skips the queue** and starts §10 immediately.
- Weekly, at rotation handover: the outgoing person reviews open Sev 2 issues against their targets.

---

## 9. Severity and response targets

| Sev | Meaning | Acknowledge | Fix or mitigate |
|---|---|---|---|
| **1** | Production down; data loss or leak; money wrong (charged, refunded or recorded incorrectly); security hole | **1 h** in working hours | **Same day** — roll back first |
| **2** | A core flow broken for some customers, no workaround | 4 h | Within 2 working days (hotfix path) |
| **3** | Broken with a workaround, or minor | 1 working day | Within the next releases (~2 weeks) |
| **4** | Cosmetic or annoying | At triage | Backlog |

**Working hours:** Sunday–Thursday, daytime Israel time. Outside them, Sev 1 is **best effort** — whoever sees the alert first acts. There is no paid on-call; the targets are commitments to ourselves, not a customer SLA. Do not publish them to customers until they have been met for a while.

---

## 10. Incident response

An **incident** is any Sev 1, or a Sev 2 affecting many customers at once.

| # | Step | Owner |
|---|---|---|
| 1 | **Detect** — error-tracking alert, uptime alert, or a customer report | Whoever sees it |
| 2 | **Declare** — open an issue with the `incident.yml` form, label `incident` + `sev:1`; post in the team chat | On duty (or the finder) |
| 3 | **Mitigate** — Vercel Instant Rollback, or turn the offending flag off (§11). Data problems: stop the writer first (flag, cron), then assess | On duty, escalate to Barak/Offir |
| 4 | **Communicate** — email affected customers from support@ (template in §13 R16): what is affected, what to do, when the next update comes | On duty |
| 5 | **Fix** — §6 | Developer |
| 6 | **Close** — confirm on Production, final customer email | On duty |
| 7 | **Post-mortem within 3 working days** — `docs/incidents/YYYY-MM-DD-<slug>.md`: timeline, root cause, why it was not caught, follow-up issues. Blameless | Whoever led the incident |

Alerts route to **admin@agentspilot.ai** (ClickUp S0.18), escalating to Barak and Offir.

---

## 11. Feature flags and staged rollout

Flags are environment variables read through `lib/utils/featureFlags.ts`; the reference is [feature_flags.md](/docs/feature_flags.md). A flag is per environment, so the rollout ladder is:

| Stage | Where the flag is on | Purpose |
|---|---|---|
| 0 — Dark | Nowhere (default off) | Unfinished work merges to `main` without being reachable |
| 1 — Staging | Dev/Staging | QA agent + team test it |
| 2 — Pilot | Production, for an **allow-list of account IDs** | Real customers who agreed to try it |
| 3 — On | Production, everyone | Released |
| 4 — Removed | — | Flag and the off-path code deleted |

- **Pilot allow-lists** follow the existing `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` pattern. A shared helper for it would be a new pattern and needs SA review (§13, R15); until then each flag that needs a pilot stage carries its own list.
- **The release PR lists every flag to flip** (step 4) — flipping one is an environment change and follows the `env-change-protocol` skill.
- **A flag that has been fully on for 2 weeks gets removed** in its own PR. Flags are not configuration.
- **A flag is also the fastest mitigation** for a bad feature in an incident — prefer it to a rollback when only the flagged feature is broken.

---

## 12. Decisions record

Taken with the user, 2026-11-25 (L1–L12), 2026-11-26 (L13–L15) and 2026-11-27 (L16–L17).

| # | Decision | Choice |
|---|---|---|
| L1 | Bug tracker | **GitHub Issues**; ClickUp keeps planning. Conditional on the repo being private before launch |
| L2 | Customer intake | **Support email** (support@agentspilot.ai) |
| L3 | Release cadence | **On demand** (closes D4 / ClickUp S7.8) |
| L4 | Release approvers | **Barak or Offir** |
| L5 | Staging sign-off | **QA agent smoke test + approver's manual check** of changed features |
| L6 | Development team | Barak + agent team, Offir, Eyal, outside contributors |
| L7 | Triage owner | **Weekly rotation** Barak → Offir → Eyal |
| L8 | Promotion mechanics | **Release PR** to `production` with required approval — from a release branch since L17 |
| L9 | Outside contributors | PRs need 1 approval from Barak/Offir; Staging credentials only; Staging holds no real customer data |
| L10 | Versioning | **CalVer** `vYYYY.MM.DD[.n]` |
| L11 | Release notes | Internal GitHub Releases only; no customer changelog at launch |
| L12 | Severity targets | As §9; working hours Sun–Thu, best effort outside |
| L13 | Release contents | **All of `main`** at the release commit; no cherry-picking; not-ready work is flagged off or reverted (§5.3) |
| L14 | Build identity | **Version stamp** (env + SHA + build time) via `/api/version` and a line in the app, not only the Vercel dashboard (§5.4) |
| L15 | Hotfix versioning | Hotfix = its own CalVer release; merged back to `main` by PR the same day (§6.1) |
| L16 | GitHub plan | **GitHub Team** for the private repo. No merge queue (Enterprise-only); `main` requires branches up to date before merging instead (§3) |
| L17 | Release branch | Release step 1 cuts `release/vYYYY.MM.DD` at the SHA Staging runs; the release PR comes from it, so later merges to `main` cannot slip in. Merges to `main` are held only during steps 2–3 (§5) |

---

## 13. Preparations this process needs

Each needs to exist before the process can run. "ClickUp" says whether it maps onto an existing readiness task or is new; ClickUp owns status.

| # | Preparation | Phase | ClickUp |
|---|---|---|---|
| **R1** | **Repo private + GitHub Team before launch** — moved out of HARDEN, because bugs will live in GitHub. Every org member is a paid seat; Actions use exceeds Team's included minutes, so add a payment method and a spending budget | PROD-0 / PROD-3 | Existing **S7.5**, re-phased |
| **R2** | `production` branch + ruleset: PR required, required checks, 1 approval restricted to Barak/Offir, no direct push, no force-push, no deletion | PROD-3 | Extends **S7.2** |
| **R3** | **CI runs on PRs into `production`** — every workflow triggers on `branches: [main]` only today, so a release or hotfix PR would get no checks. Add `production` to `pull_request` (and the required checks to its ruleset) | PROD-3 | New |
| **R4** | `main` ruleset: 1 required approval, Barak + Offir as bypass actors (keeps the agent flow unblocked, gates outside contributors); **replace the merge queue** with *require branches to be up to date* — switch the queue off before going private (L16) | PROD-3 | New |
| **R5** | GitHub Issues setup: `bug.yml` + `incident.yml` issue forms, the §8.3 labels, the Project board with the §8.4 columns and automations | PROD-4 | New |
| **R6** | `support@agentspilot.ai` mailbox, shared by the three, + the on-duty rotation calendar | PROD-EXT | Extends **S1.5** (G5) |
| **R7** | Health endpoint (`/api/health`: app up, database reachable) — none exists | PROD-4 | Feeds **S8.3** |
| **R8** | Uptime monitor on `app.agentspilot.ai/api/health`, alerting admin@ | PROD-4 | New (with S8) |
| **R9** | Error tracking installed with alerts routed to admin@ → Barak/Offir | PROD-4 | **S8.1 / S8.2** + **S0.18** |
| **R10** | Scripted smoke test runnable by the QA agent against any base URL (Staging and Production) | PROD-4 | **S10.2** |
| **R11** | `.github/release.yml` for grouped release notes; RM agent updated to cut the release branch, open release PRs from it, tag CalVer, publish Releases and move issues | PROD-4 | New |
| **R12** | Agent definitions (TL, QA, RM, Dev) updated: file and reference GitHub issues, `Fixes #<n>` in PRs; CLAUDE.md points here | PROD-4 | New |
| **R13** | **Staging data hygiene** — after the cutover, Staging holds test data only, so Staging credentials can go to outside contributors | PROD-3 | New |
| **R14** | `CONTRIBUTING.md` + an access matrix: who holds which credentials and dashboards per environment | PROD-4 | Extends **S10.4** (F11/D6) |
| **R15** | Generic pilot allow-list helper for flags — SA review | HARDEN | New |
| **R16** | `docs/incidents/` + post-mortem template + customer incident email template | PROD-4 | **S10.5** (G6) |
| **R17** | Production migration step recorded per release (ledger + checker) | PROD-4 | **S10.3** |
| **R18** | Rehearse one full release (§5) and one rollback (§6) on Production before launch | PROD-4 | **S12.1 / S12.2** |
| **R19** | **Version stamp** (§5.4): `GET /api/version` (env, short SHA, build time only) + a version line in Settings and admin; the bug form's *version* field (R5) and the smoke test (R10) depend on it | PROD-4 | ✅ Done — PR #698, 2026-11-27 |
| — | Close the cadence decision as **on demand** | PROD-0 | Closes **S7.8** |
| — | This document | PROD-4 | **S10.1** |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-25 | Created | First version, from the ALM scoping session with the user: decisions L1–L12, preparations R1–R18 |
| 2026-11-27 | Release branch | Decision L17: release step 1 cuts `release/vYYYY.MM.DD` at the Staging SHA and the release PR comes from it (§3, §5 steps 1 and 4); merges to `main` held during steps 2–3 only; L8 and R11 updated |
| 2026-11-27 | GitHub Team, no merge queue | Decision L16: GitHub Team for the private repo; merge queue (Enterprise-only) replaced by *require branches up to date* in §3, §4 step 6 and §6.1; R1 and R4 extended |
| 2026-11-27 | R19 done | Version stamp merged (PR #698): `GET /api/version` is public and returns environment, short SHA and build time only; Staging vs Production is read from the branch |
| 2026-11-26 | Release contents, version stamp, hotfix versions | Added §5.3 (a release is all of `main`, no cherry-picking), §5.4 (version stamp), §6.1 (hotfix versions); release steps 1, 2 and 7 check the SHA; bug form gains *version*; decisions L13–L15; preparation R19 |
