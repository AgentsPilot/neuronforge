---
name: env-drift-audit
description: How to run a read-only drift audit of this repo's environments — compare the expected state (repo files at origin/main, change records, the untracked private inventory) with the live state of GitHub, Vercel, Supabase and the Claude Code harness, check by check, and report it with a fixed severity class per check, "not read" with its reason, and the full report kept in the untracked private docs. Use when the user or TL asks for drift, a drift report, to audit the environments, "is everything configured as expected", "what is out of sync", or whether the platforms still match the repo and the change records. Used by the DevOps (DO) agent and by the main session. Prevents "no drift" claims from checks that were never read, comparisons against stale repo files or guesses, and open weaknesses leaking into tracked text or chat.
---

# env-drift-audit

This repo's procedure for comparing expected with live environment state and reporting the result. It is **read-only**: it changes nothing and fixes nothing. Each finding becomes a change plan in a later job. It holds only how to compare and how to report; every live read is a pointer to the skill that owns it:

| For | Read |
|---|---|
| Tiers, approval, change-record template, public-repo rule, the fix plan for a finding | `.claude/skills/env-change-protocol/SKILL.md` — not repeated here |
| DO's tools, allowed and forbidden Bash forms, read-only SQL rules (a)–(d), what DO may write, § Report Format | `.claude/agents/devops.md` |
| GitHub reads | `.claude/skills/github-ops/SKILL.md` (§2, §4, §6; commands in its `read-commands.md`) |
| Vercel reads | `.claude/skills/vercel-ops/SKILL.md` (§1, §3, §4, §5, §6) |
| Supabase reads | `.claude/skills/supabase-ops/SKILL.md` (§2) |
| Harness reads, and who may make them | `.claude/skills/claude-harness-ops/SKILL.md` (§1, §2, §4, §6, §7, §8) |

---

## 1. When it runs

- **On demand only**, by the user or TL. **No schedule**: a scheduled run would be a new pattern, with an unattended session holding platform tools. DO never starts a run itself; a report may suggest one (at the end of a DO stream, or after a production-tier change lands).
- A run covers every area (GitHub, Vercel, Supabase, Harness, Third-party) unless the brief names fewer. A partial run lists the other areas as "not audited". Third-party platforms are "not audited" until `third-party-ops` covers them; see its platform index.
- Each run compares against the **expected state**, never against the previous report.

## 2. Expected state: three sources

| Source | Tracked? | What it supplies |
|---|---|---|
| Repo files | Yes | Workflow files and their job names; `vercel.json` (crons, ignore command, disabled branches); `supabase/migrations/**` and checkers; `.claude/settings.json` and agent `tools:` lists; env var **names** from `lib/utils/featureFlags.ts` (DO) and `.env.example` (main session only, §7 V-2) |
| Change records | Yes, by role | Each cycle workplan's `## Environment changes` section: the end state a recorded step said it left |
| Private inventory | **No** | Everything that is an ID, a value location or a weakness: which project holds each role and which env var names, the expected settings of security features, the last recorded advisor lists, the last verified migration, earlier full reports |

- An expected value that is an ID, a secret location or a security setting lives **only** in the private inventory. The audit reads it there and never copies it into tracked text or chat.
- **The private inventory's location comes from the brief.** This skill never names it, and DO never searches the disk for it. When it is not reachable, every check whose expected state lives there is **not read (expected state missing)**: never "no drift", and never compared with a guess or an earlier report. Repo-sourced checks still run.
- **Repo files are read at `origin/main`**, never the current branch and never local `main`, which nothing here keeps current: `git show origin/main:./<path>` and `git log -1 origin/main`. DO cannot fetch, so **the main session runs `git fetch` before it briefs DO**.
- **Staleness test, before any repo-sourced check:** take the SHA from `git log -1 origin/main` and run the compare read in `github-ops` §6 step 2 on it. Only `identical` counts as current. `behind` is stale here, although §6 counts it as landed (that answers a different question); anything else is not verified. When it is not `identical`, every repo-sourced check is **not read (`origin/main` stale)**. The report names the commit read.
- **Write every path as `origin/main:./<path>`, from the worktree root.** In Git Bash a bare `origin/main:.<path>` (`.github/`, `.claude/`, `.gitignore`) is rewritten into a Windows path list and git fails with "unknown revision"; the `./` form is not rewritten and needs no prefix. `./` is relative to the current folder, so run from the root: a root listing (`git show origin/main:./`) without `.github/` means the command ran elsewhere. "Unknown revision", or a "does not exist" from outside the root, is **not read (error)**, never "absent".
- **Presence is read from the folder listing** (`git show origin/main:./<folder>/`), which prints entry names only. A file's content is read only when the check needs it.

## 3. Live state: pointers by area

| Area | Live read | Who reads |
|---|---|---|
| GitHub | `github-ops` §2 (repo settings, protection and rulesets, required checks, Actions, secret and variable names), §4 (the seven rules), §6 (on `main`) | DO; the user for a read DO is refused (admin rights) |
| Vercel | `vercel-ops` §1, §3 (projects, env var names by target, deployments, domains), §4 step 5 (production aliases), §5 (skipped builds), §6 (crons) | DO; the user for dashboard-only settings |
| Supabase | `supabase-ops` §2 (catalog evidence, never the ledger; advisors; extensions and functions). SQL follows `devops.md` rules (a)–(d), through whichever `execute_sql` DO's `tools:` holds | DO; the user for auth settings and backups |
| Harness | `claude-harness-ops` §1: DO reads only the tracked harness files, its own loaded tools and `git worktree list` | DO; everything else is a main-session check |
| Third-party | `third-party-ops` §5 (platform index); each covered platform's file, part 6 (its T- checks and their live reads) | DO for repo, log and count reads; the user for dashboard reads |

DO never opens `~/.claude.json` or a user-scope settings file (`claude-harness-ops` §1). Those checks are reported as "main-session check owed".

## 4. Comparison rules

- The audit works **per check** (§7). Each check reports one of three states: **no drift**, **drift** (with a severity), or **not read**.
- **"Not read" is never "no drift"**, and it always carries its reason: no access, error, retention passed, expected state missing, `origin/main` stale, no checker, or main-session check owed.
- A **main-session check owed** counts as "not read" in DO's report. It becomes a result only when the main session runs it and adds it to the full report.
- **Names are compared, never values.** An env var is "present in Production and Preview", never its value.
- A change record that disagrees with the live state is drift, even when the live state looks right: either the record or the platform is wrong.

## 5. Severity

| Severity | Meaning | Example (by kind) |
|---|---|---|
| **Critical** | Security exposure now, or production broken or at risk on the next deploy | A required gate that cannot fail; a security feature expected on and found off; a value-bearing permission wider than recorded |
| **High** | Will break the next merge, deploy or migration | A required check name with no job; an env var the code needs missing from a target; a migration not applied that merged code reads |
| **Medium** | Wrong but not harmful today | A cron in the repo not on the platform; a stale record; an unresolved tool name in an agent file |
| **Low** | Cosmetic or informational | A leftover worktree; an unused allow rule |

- Each check has a fixed **class** (§7): the highest severity its drift can have. A finding may be rated lower, never higher, with the reason in the full report.
- A check is **Critical-class** when its class is Critical. Every area has one, so a "not read" anywhere can hide a Critical finding.
- "Not read" is a state, not a severity.

## 6. Output

| Output | Where | Holds |
|---|---|---|
| Full report | **Untracked private docs only**, at the location the brief gives. One dated file per run | Per check: ID, result, severity, expected-state source, evidence by role, the reason for any "not read". Also the `origin/main` commit read, the main-session checks owed, and that V-2 is not a completeness check |
| Chat summary | DO's report | Counts only, in the order below |
| Fix plans | A later DO change-plan job | A fix for a security finding stays in the private docs until it is verified (Q-D5-10 in the DevOps requirement) |

**When the private docs are not reachable**, DO writes **no** full report anywhere else: no tracked file, no scratch file. The summary says "full report not written: private docs not reachable", and the main session re-runs the audit with the location in the brief.

**The chat summary**, in this order:

1. "Critical-class checks not read:" with their check IDs, or "none". Always first.
2. One row per area (GitHub, Vercel, Supabase, Harness): counts for Critical, High, Medium, Low, no drift and not read.
3. Third-party: per platform, audited (counts as in item 2) or not audited.
4. The main-session checks owed, by check ID.
5. The `origin/main` commit read.

A check ID names only that a check was not read. A drift finding is **never named in chat**, only counted: no setting name, ID or value. A non-zero Critical or High count signals an open weakness, so the summary is **never pasted into tracked text** (`github-ops` §9). The rest of the report follows `devops.md` § Report Format.

## 7. The checks

Sources and pointers only: no expected value, setting value, project, folder or path. A row may not lose a check or have its class lowered without SA. "Who reads": **DO** in the run; **main session** means DO reports "main-session check owed"; **user** means a dashboard step the user reports.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| G-1 | Every required check protects `main` (all seven rules) | Workflow files at `origin/main` (job `name:`, triggers, `paths:`, `if:`, `needs:`) | `github-ops` §2 Required checks, §4 | Critical (a gate that cannot fail); High (a required name with no job) | DO |
| G-2 | Protection and rulesets of `main`, read together | Private inventory; change records | `github-ops` §2 Branch protection and rulesets, What to report | Critical | DO; user if refused (`github-ops` `dashboard-settings.md`) |
| G-3 | Repo settings: auto-merge allowed, delete head branches, merge methods, default branch | Change records; private inventory | `github-ops` §2 Repo settings | Medium | DO |
| G-4 | Secret scanning and push protection enabled | Private inventory | `github-ops` §2 Repo settings (an absent object is not read), §3 | Critical | DO; user if refused (as G-2) |
| G-5 | Actions permissions: allowed actions, default token permission, whether Actions may approve PRs | Private inventory | `github-ops` §2 Actions | Critical | DO; user if refused (as G-2) |
| G-6 | Every secret and variable name a workflow references exists in its scope | Workflow files at `origin/main` | `github-ops` §2 Secrets and variables (names only) | High | DO |
| V-1 | Each project by role: linked repo, production branch, framework, Node version, root directory | Private inventory (which project holds which role) | `vercel-ops` §1, §3 Projects | High | DO |
| V-2 | Each name the two sources hold is on every target that needs it, with its Git-branch scope as recorded | `lib/utils/featureFlags.ts` at `origin/main`; `.env.example` (below); private inventory (project and target) | `vercel-ops` §3 Env vars | High | DO (`featureFlags.ts` and the live read); main session (`.env.example` names) |
| V-3 | Production serves `main`: the production deployment's SHA is on `main` and holds the production aliases | `origin/main` head | `vercel-ops` §3 Deployments, §4 step 5; SHA on `main`: `github-ops` §6 | High; Medium only when each later commit has a CANCELED deployment with the `SKIP:` line (`vercel-ops` §5), never judged from file names | DO |
| V-4 | The crons match the production deployment's set, and each is enabled | `vercel.json` at the production deployment's SHA (a gap from `main` is V-3's finding) | `vercel-ops` §6 | Medium | DO |
| V-5 | Domains on the right project and target, DNS valid; deployment protection as recorded | Private inventory | `vercel-ops` §3 Domains; protection: `vercel-ops` `dashboard-settings.md` | Critical | DO (domains); user (protection) |
| S-1 | Each migration after the last one the private inventory records as verified is applied | `supabase/migrations/**` at `origin/main` and its checker, where one exists | `supabase-ops` §2 Migration drift, Catalog evidence | High | DO |
| S-2 | No security or performance advisor finding beyond the last recorded lists | Private inventory | `supabase-ops` §2 Advisors, Where advisor results go | Critical (security); Medium (performance) | DO |
| S-3 | RLS (enabled and forced) and grants as the migrations set them | Migrations at `origin/main`; private inventory (intended exceptions) | `supabase-ops` §2 Catalog evidence | Critical | DO |
| S-4 | Auth settings and backups as recorded | Private inventory | `supabase-ops` §2 What the tools cannot read | Critical | User |
| S-5 | Edge functions and extensions match the repo | `supabase/functions/`, `supabase/config.toml`, migrations at `origin/main` | `supabase-ops` §2 Extensions, functions, branches | Medium | DO |
| CH-1 | DO's loaded tools equal its `tools:` line; exactly one `execute_sql`; no platform write tool (Write, Edit and Bash are there by design) | `devops.md` at `origin/main` | DO compares its own loaded tools with the line (`claude-harness-ops` §4, §8) | Critical (a platform write tool, or two `execute_sql`); Medium (a name that does not resolve) | DO |
| CH-2 | Tracked harness files: no allow rule, key, `hooks`, `mcpServers` or `permissionMode` beyond a change record; no tracked rule with a secret, a URL with an ID or a personal path | `.claude/settings.json`, `.claude/agents/*.md` at `origin/main`; change records | `claude-harness-ops` §2, §3, §7 | Critical | DO |
| CH-3 | `.claude/settings.local.json` is untracked | The `.gitignore` line at `origin/main` | `git show origin/main:./.claude/` lists entry names with no content (§2); never a `git show` of the local file itself (`claude-harness-ops` §3) | Medium | DO |
| CH-4 | No `.mcp.json`, or every ref and token in it is a `${VAR}` | Repo at `origin/main` | `claude-harness-ops` §2, §4 | Critical | DO |
| CH-5 | User and managed settings, MCP server names and status; once FU-3b lands, the read-only server has its three settings and its probe was re-run after any re-add | Change records; private inventory | `claude-harness-ops` §1, §2, §8 | Critical | Main session |
| CH-6 | No leftover worktree; each worktree's `node_modules` is a junction with an intact target | Active work named in the brief | `git worktree list` (DO); junctions: `claude-harness-ops` §6 | Low | DO (list); main session (junctions) |

- **T- checks** (Third-party): `third-party-ops`, each covered platform's drift section, under the rules of this skill.

- **S-1:** a migration with no checker and no named objects is **not read (no checker)**, never "applied". **S-3:** a table the migrations leave without RLS is drift unless the private inventory records it as intended; DO does not decide that a missing policy is on purpose. Supabase checks are counts, booleans and catalog facts only (rule (c)); S-2's lint names go to the full report, never to chat.
- **CH-1 with CH-5:** CH-1 sees which server name DO is bound to; only CH-5 can see whether that server is really read-only (`claude-harness-ops` §8).
- **CH-6:** `git worktree list` prints absolute paths. Report counts only (worktrees, leftovers), never a worktree name or path (`claude-harness-ops` §7).
- **V-2 is not a completeness check:** the two sources hold far fewer names than the code reads, and the full report says so. DO never reads `.env.example`, by any tool. **The `.env.example` names are a main-session check owed.** The main session never Reads, `cat`s or `git show`s the file, and runs, in this order, stopping at the first failure:
  1. Guard count, which prints only a number: `grep -vcE '^[A-Z0-9_]+=|^[[:space:]]*(#|$)' .env.example`. If it is not `0`, stop: the source is "not read".
  2. Names only, with `-E` (without it `+` is a literal and nothing matches): `grep -oE '^[A-Z0-9_]+=' .env.example`.
  3. Same as `origin/main`, stat only: `git diff --stat origin/main -- .env.example`. Any output means the source is "not read".

## 8. Checklist

- [ ] Run on demand from a brief; the main session fetched first; `origin/main` head taken and the staleness test `identical`, or repo-sourced checks "not read (`origin/main` stale)"
- [ ] Repo files read at `origin/main` only, as `origin/main:./<path>` from the worktree root; presence from the folder listing; "unknown revision" reported as "not read (error)", never "absent"
- [ ] Private inventory at the brief's location only; not reachable means "not read (expected state missing)" for its checks, never a guess or an earlier report
- [ ] Every check in §7 has a state; every "not read" has its reason; main-session checks owed are listed by ID
- [ ] Live reads made only through the owning skill's section; no value read or compared, only names, counts, booleans and catalog facts
- [ ] DO opened no user-scope file and no `.env.example`; CH-6 as counts only
- [ ] Each finding rated at or below its check's class, with the reason when lower
- [ ] Full report in the untracked private docs only, or "full report not written: private docs not reachable"
- [ ] Chat summary in the five-part order, Critical-class "not read" first, counts only, no finding named; never pasted into tracked text
- [ ] Nothing changed or fixed; each finding left for a later change-plan job
