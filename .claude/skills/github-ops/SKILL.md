---
name: github-ops
description: How to read GitHub state and verify a GitHub change in this repo — repo settings, branch protection and rulesets read together, required checks read and never assumed, when a check actually protects main, the merge queue and auto-merge, whether a PR landed on main, stacked PRs, Actions permissions, failed workflow runs, secret and variable names without values, secret scanning and push protection, PR volume and pacing, and the settings only the dashboard shows. Use when the user asks about branch protection, a ruleset or a required check, a merge queue that is stuck or a check that never reports, "Auto merge is not allowed", deleting head branches, a stacked PR, "did my PR land on main", secret scanning or push protection, Actions permissions, a failed workflow run, GitHub secret or variable names, or PR volume or an account suspension. Used by the main session and by the DevOps (DO) agent. Prevents required checks that never gate, PRs called merged that never reached main, and values, logins or IDs leaking from a GitHub response.
---

# github-ops

This repo's operating procedure for GitHub settings, Actions and workflow runs. It adds only what is specific to GitHub and points elsewhere for the rest:

| For | Read |
|---|---|
| The eight steps (pacing is step 8), tiers, approval, order against the deploy, probe rules, change-record template, public-repo rule | `.claude/skills/env-change-protocol/SKILL.md` — mandatory for every change; not repeated here |
| DO's allowed and forbidden Bash and `gh` forms, where plans go | `.claude/agents/devops.md` § Bash and `gh` — the guard on every command below |
| Getting code to `main`: branch, commit, push, PR, auto-merge, the merge queue procedure and its fallback, conflicts, retargeting a child PR | `.claude/agents/release-manager.md` § Merging the PR |
| When a PR goes on auto-merge | `.claude/agents/team-leader.md` § Standing User Preferences, the "Auto-merge when CI is the only gate" row |
| Docs-only skipped builds; merge-queue branches not deployed | `.claude/skills/vercel-ops/SKILL.md` §5 |
| Worktrees, the `node_modules` junction, harness permissions | DO-5's `claude-harness-ops` skill (not built yet) |
| Every read command with its named-field selector; settings only the dashboard shows | [read-commands.md](read-commands.md), [dashboard-settings.md](dashboard-settings.md) |

---

## 1. Scope and the named-fields rule (hard rule)

- Run from a checkout of this repo. `gh` fills `{owner}` and `{repo}` in a `gh api` path from the checkout. Use those placeholders in every path, so no owner or org name is ever typed, logged or written. An owner, org, app, installation or ruleset ID never goes into a file, a report or a chat summary.
- **Select named fields on every read:** `--jq '<selector>'` on `gh api`, `--json <fields>` on `gh pr|run|repo|workflow` and the list commands. Never print a whole response. Several responses carry actor logins (owner accounts included), team and app IDs, bypass actors or values, and whatever is printed reaches the session context and the local transcript, so "I read it but did not copy it" is not a control.
- `--jq` and `--json` filter output only. They are not field flags and do not turn a call into a POST.
- **Never select an actor, login or email field:** on `gh pr view|list`, not `author`, `mergedBy`, `assignees`, `reviews`, `latestReviews`, `reviewRequests`, `comments`, `commits` (author emails), `headRepositoryOwner`, or `autoMergeRequest.enabledBy`; on `gh repo view`, not `owner`, `assignableUsers`, `mentionableUsers` or any `viewer…` field (commit emails); on a check, run, commit or ruleset, no actor, user, email, team or app field either. Any login list (collaborators, bypass actors, reviewers) is reported as a **count**.
- Every list command carries `--limit`. Without it `gh pr list` stops at 30 and `gh run list` at 20, and a count under-reports.
- An error from a read (no admin rights, 404) is **"not read"** — never "off", never "not protected".
- **Platform facts that may change** (an endpoint, a field, a setting's behaviour) are checked at use time with `gh <command> --help` and, for `gh pr|run|repo view`, the field list `gh` prints for `--json` with no value. DO holds no GitHub documentation tool. This skill hardcodes nothing beyond what it states.

## 2. Reading state (Read tier)

The exact command for each read is in [read-commands.md](read-commands.md).

| Topic | Procedure |
|---|---|
| **Repo settings** | `gh api repos/{owner}/{repo}` with `--jq` for Allow auto-merge, delete head branches on merge, the allowed merge methods, the default branch and visibility. `gh repo view --json` has no auto-merge field. The secret scanning and push protection states sit under `security_and_analysis`, which GitHub returns only to a caller with admin rights: an absent object is "not read". |
| **Branch protection and rulesets** | Read **both, every time**: the classic protection of `main`, and rulesets through `gh api` only (the repo's rulesets list, and the effective rules for `main`, which include org rulesets). `gh ruleset list` and `gh ruleset view` are never used: they have no `--json` and print ruleset IDs, the source owner and bypass details. Report the union, each rule with its source. Do not assume which mechanism is in use today; it can change. |
| **What to report** | Required check names (classic: `context` only, never the app ID beside it), strict (up to date before merge), applies to admins, required review count, linear history, force-push and deletion allowed, and whether a merge queue is required. A ruleset shows the queue as a `merge_queue` rule. The classic response has **no** merge-queue field: for a classic rule the evidence is recent `merge_group` runs plus a dashboard check ([dashboard-settings.md](dashboard-settings.md)). |
| **Required checks** | **Read, never assumed.** The list comes from the read above, at the time of the job. This skill names no required check and states no count. `gh pr checks <n> --required --json …` shows one PR's required checks. |
| **Actions** | `actions/permissions` and `actions/permissions/workflow` with `--jq` for which actions are allowed, the default `GITHUB_TOKEN` permission and whether Actions may approve PRs. `gh workflow list --json` for what exists; the file in `.github/workflows/` for its definition. `gh workflow view` is never used (no `--json`). `gh run list|view --json` for status, conclusion, event, head SHA and jobs. |
| **Secrets and variables** | Names and updated time only: `gh secret list --json name,updatedAt` and `gh variable list --json name,updatedAt`, with `--env <name>` for an environment. `gh variable list` **prints values by default**, and `value` is a selectable field: never select it. Org scope goes through `gh api orgs/{owner}/…` with a `--jq` on names (never `--org <name>`); it needs org-admin rights, and a failure is "not read". A value is never read, by DO or by the main session. |

## 3. Workflow run logs and security alerts

- **Never a whole log.** First `gh run view <id> --json jobs --jq …` for the failing job and step. Then, only if needed, that job's `--log-failed` output piped into a bounded `grep -n -m <N> -E …` — the one allowed log form in `devops.md`.
- Before reading any log, open the job in `.github/workflows/`. **If its steps reference `secrets.*`, its log is not read**, by any form. Actions masks registered secrets only: a value printed some other way (a variable, a test fixture, PII in test data) shows in clear, in the log of a public repo.
- Report the **error class** and the failing step. Never copy a log line into a file, and never one that names a person.
- **Security alerts are not read.** The secret scanning alerts endpoints return the detected secret in clear: never called, by any route. Dependabot and code scanning alerts are open weaknesses. DO reads only whether each feature is **enabled** (§2). Alert triage, if wanted, is its own slice.

## 4. When a check actually protects `main` (the core procedure)

A check protects `main` only when **all seven** hold. DO reads the required list (§2) and the workflow files, and reports each failure as drift, by check name. Check names are not secret: they are in the public workflow files.

1. **It is required.** A red check that is not required never blocks a merge. Two PRs, each green on its own base, can break `main` together (a semantic merge conflict). The merge queue re-tests each PR on top of the latest `main`, but it waits only for **required** checks.
2. **Its name equals a job `name:` exactly, and that name is unique across workflows.** Renaming a required job breaks the gate unless the protection changes in the same sitting (see the verdict-job header of `.github/workflows/tests.yml`). Two jobs with the same `name:` in different workflows make the required check ambiguous: report a duplicate as drift.
3. **Its workflow triggers on `pull_request` and on `merge_group`.** Without `merge_group` the check never reports on the queue's `gh-readonly-queue/main/…` commit, and every queued PR times out (the trigger comment in each required workflow, and `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md`).
4. **No `paths:` or `paths-ignore:` on those triggers.** A path-filtered required workflow never reports on a PR it filters out, so the merge waits forever, and `merge_group` does not support `paths:`. The skip is decided **inside** the job by `.github/ci/non-deploying-change.sh` (or `.github/ci/jest-gate-scope.sh` for the Jest gate), and the job still reports (the "NO `paths:` FILTER, ON PURPOSE" headers). `.github/workflows/plugin-tests.yml` uses `paths:` and has no `merge_group` trigger: it is not required and cannot become required as written.
5. **It cannot be skipped into a pass.** GitHub counts a SKIPPED required check as passing. A matrix leg, a job with a skippable job-level `if:`, or a job with `needs:` and no `if: always()` (skipped when a job it needs fails) is never required. A matrix gates through one verdict job with `if: always()` (the `tests.yml` header and its verdict job).
6. **It reports on every PR.** The Vercel deployment status is never required: `vercel.json` disables deployments for `gh-readonly-queue/**`, so it never reports on a queue commit and every queued PR would time out; docs-only changes also skip the build (`vercel-ops` §5). The same goes for any check that does not report on every PR.
7. **Which checks are required is SA's call, not DO's.** A guarding workflow that is not required, or a required name with no matching job, is reported as drift. DO never decides the fix.

**Order against the merge** for a change to the required set (the protocol's `When` field, applied to GitHub):

- **Adding a required check:** the workflow change merges first and the check reports once on a real PR; the setting changes after. The other order stalls every PR and the queue.
- **Removing or renaming a required check:** the setting changes first, or in the same sitting as the merge, then the workflow change merges. The other order leaves every PR waiting for a name that never reports.

## 5. Merge queue and auto-merge (facts; the procedure is RM's)

- `main` has a merge queue. `gh pr merge <n> --auto --merge` on a queue-protected branch **enqueues** the PR, and the merge queue sets the merge strategy. Everything else about merging — the method, a failed queue run, the fallback when `--auto` fails — is in `release-manager.md` § Merging the PR.
- **Allow auto-merge** is a repo setting DO owns, readable per §2. When it is off, `--auto` fails with "Auto merge is not allowed". Turning it on is production tier: the user executes.
- **A PR's queue state:** `gh pr checks <n> --required --json …`, and `gh pr view <n> --json mergeStateStatus,autoMergeRequest --jq …` with `autoMergeRequest` reported as present or absent plus its merge method only. Recent queue activity: `gh run list --event merge_group --limit <N> --json …`. Queue runs use `gh-readonly-queue/main/pr-<n>-<sha>` branches and the `merge_group` event; Vercel does not deploy them.
- **What only GraphQL shows** (queue entries, queue configuration) is a dashboard step or a main-session read with the user. DO never calls `gh api graphql`, read queries included.
- **DO's plans:** when a plan has a step that must land or be checked before the merge (a migration apply, a setting, a user demo or live check), that `Before merge` step's `When` field says "PR stays off auto-merge until step N is verified". When a PR goes on auto-merge is TL's standing rule (pointer table); this skill does not restate it.

## 6. Did it land on `main`? Stacked PRs

**"MERGED" alone is never the evidence.** A PR landed on `main` only when both hold:

1. `gh pr view <n> --json state,baseRefName,mergeCommit,mergedAt --jq …` shows `MERGED` **with base `main`**, and gives the merge commit SHA (`.mergeCommit.oid`).
2. `gh api repos/{owner}/{repo}/compare/main...<sha> --jq .status` returns `identical` or `behind`: the commit is on `main`. `ahead` or `diverged` means it is not. A 404 is "not verified".

This is the read-only equivalent of `git merge-base --is-ancestor`, which is not on DO's allowed list and would need a fresh fetch.

**Stacked PRs** (a PR whose base is another feature branch):

- GitHub retargets an open child PR to the parent's base only when the parent's head branch is **deleted** after the merge — by the "Automatically delete head branches" setting or by hand. When it is not deleted (read the setting, §2; do not assume), the child is **not** retargeted. Merging the child then lands it in the parent's branch, not in `main`, and the PR still says MERGED.
- **Rule: avoid stacking.** If it is unavoidable: after the parent merges, the child's base is changed to `main` (`gh pr edit <n> --base main` — an RM action, forbidden for DO), and the landing is verified with the two checks above before anything is called merged.
- DO's part, in a verification job: each PR's `baseRefName` and the compare result. Turning on "Automatically delete head branches" is a separate production-tier plan, if the user wants it; side effect: a session still pushing to a merged branch recreates it on the remote.

## 7. Pacing and accounts

Protocol step 8 holds the rule; this adds the GitHub specifics.

- Abuse detection judges the **account**, across every session and worktree that uses its token, so parallel sessions add up. The account was once suspended for days after a burst of PR and push activity.
- **During a batch** of PRs or pushes, one session runs it. A wait for CI or for a setting polls with pauses, never in a tight loop.
- **Before a batch**, count the account's PRs opened today and report the number (the count read is in [read-commands.md](read-commands.md); it carries `--limit`). GitHub publishes no threshold, and this skill gives no number.
- **Recovery accounts.** Any account kept for recovery never runs an AI session, is never logged in to `gh` in a session, and is never named, or said to exist, in tracked text. No session switches `gh` accounts; `gh auth` commands are not on DO's allowed list.

## 8. Git hazards in a shared repo

- **Never `git stash`.** The stash list is shared by every worktree and session of the repo, so a pop can take another session's work. It is in `devops.md`'s forbidden git writes; it is stated here with the reason because the main session uses this skill too.
- The worktree `node_modules` junction hazard belongs to `claude-harness-ops` (pointer table).

## 9. Public-repo specifics for GitHub

- The repo is public: workflow files, the logs of its runs, PR text, commit messages and check names are readable by anyone.
- Never in tracked text, or in a chat summary that may be pasted into one: an owner, org, app, installation, ruleset or bypass-actor ID, a token scope, an owner account's login, the state of a security setting that is off, or an open alert. Those go to the untracked private docs only.
- A secret is set by the user, in the dashboard or the user's own terminal. Its value never passes through a chat or a session.
- **Workflows:** a workflow never gains a secret it does not need. The required workflows declare `permissions: contents: read`; a plan that widens `permissions:` is reviewed by SA. A PR from a fork gets no secrets on `pull_request`; `pull_request_target` combined with checking out the PR's code is never proposed.
- Push protection blocks a push carrying a recognised secret. Bypassing it is the user's call only, and a bypassed secret is treated as leaked: rotate it per `env-change-protocol`.

## 10. Settings changes and verifying them

- **Every settings change is production tier:** branch protection, rulesets, the required set, merge-queue configuration, Allow auto-merge, delete head branches, merge methods, secret scanning, push protection, Actions permissions, secrets, variables, collaborators. DO plans it per `env-change-protocol` (before-state from §2, the exact dashboard path from [dashboard-settings.md](dashboard-settings.md), the undo as the before-state value, the probe); SA reviews it; the user executes it; DO verifies it.
- **Stored state:** after the user saves, read the changed field (§2) and compare it with the planned value. That read fails when the change did not land.
- **Behaviour** (a new required check, a queue setting): the evidence is the **next real PR**, watched by the main session with the undo ready. No probe PR by default — it costs CI time and adds PR volume (§7). SA may allow one docs-only probe PR in a plan that names why the change cannot wait. It exercises **reporting** only (the required jobs skip inside the job and still report), never the test path, so it is never evidence that a new check passes on code.
- Workflow files and `.github/ci/**` are code: Dev writes them through a PR, SA reviews them. DO checks §4 against the diff in its plan, and verifies after the merge.

## 11. Checklist

- [ ] Every `gh api` path uses `{owner}`/`{repo}`; every read has `--jq` or `--json` with named fields; no actor field; login lists as counts; every list has `--limit`
- [ ] Classic protection **and** rulesets read (through `gh api`); union reported with sources; an error recorded as "not read"
- [ ] Required checks read at the time of the job; none assumed, none listed in tracked text
- [ ] Each guarding check tested against the seven rules of §4; failures reported as drift by name; the fix left to SA
- [ ] A change to the required set ordered per §4 (add after it reports; remove or rename before)
- [ ] "Landed on `main`" = MERGED with base `main` **plus** the compare read; stacked PRs checked by `baseRefName`
- [ ] Secrets and variables by name and updated time only; no `value`, no `gh variable get`; no alerts endpoint
- [ ] Logs: `--json jobs` first, `--log-failed | grep -n -m <N>` only, never for a job that uses `secrets.*`; error class only
- [ ] No GraphQL; a plan with a pre-merge gate says the PR stays off auto-merge until that step is verified
- [ ] Batch paced; today's PR count read and reported; no account switching; no `git stash`
- [ ] Record written per `env-change-protocol`, with no ID, login, token scope, off security setting or open alert in tracked text
