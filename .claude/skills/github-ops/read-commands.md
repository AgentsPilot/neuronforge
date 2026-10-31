# GitHub read commands with their selectors

Reference for `github-ops` §2–§7. Every read here is on DO's allowed list in `.claude/agents/devops.md` § Bash and `gh`, and every one names its fields. Field names were checked at build against `gh <command> --help`, the field list `gh` prints for `--json`, and key-presence reads (booleans only, no values). Re-check with `--help` if a command errors.

`{owner}` and `{repo}` are typed literally: `gh` fills them from the checkout. `<n>` is a PR number, `<id>` a run ID, `<job-id>` a job ID from the jobs read, `<sha>` a commit SHA. IDs and SHAs stay in the session; they never go into tracked text.

| Read | Command |
|---|---|
| Repo settings | `gh api repos/{owner}/{repo} --jq '{allow_auto_merge, delete_branch_on_merge, allow_merge_commit, allow_squash_merge, allow_rebase_merge, default_branch, visibility}'` |
| Secret scanning and push protection (enabled state only; admin rights needed) | `gh api repos/{owner}/{repo} --jq '{secret_scanning: .security_and_analysis.secret_scanning.status, push_protection: .security_and_analysis.secret_scanning_push_protection.status}'` — `null` means "not read". An off state goes to the private docs only. |
| Classic protection of `main` | `gh api repos/{owner}/{repo}/branches/main/protection --jq '{checks: [(.required_status_checks.checks // [])[].context], strict: .required_status_checks.strict, admins: .enforce_admins.enabled, reviews: .required_pull_request_reviews.required_approving_review_count, linear: .required_linear_history.enabled, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}'` — `context` only, never `app_id`. An empty `checks` list means no required checks; an error is "not read". |
| Repo rulesets | `gh api repos/{owner}/{repo}/rulesets --jq '[.[] \| {name, target, enforcement, source_type}]'` — no `id`, no `source`. |
| Effective rules for `main` (repo and org rulesets) | `gh api repos/{owner}/{repo}/rules/branches/main --jq '[.[] \| {type, ruleset_source_type}]'` — a queue shows as type `merge_queue`. No `ruleset_id`, no `ruleset_source`. |
| Recent merge-queue runs | `gh run list --event merge_group --limit 20 --json workflowName,status,conclusion,createdAt` |
| Actions permissions | `gh api repos/{owner}/{repo}/actions/permissions --jq '{enabled, allowed_actions}'` and `gh api repos/{owner}/{repo}/actions/permissions/workflow --jq '{default_workflow_permissions, can_approve_pull_request_reviews}'` |
| Workflows | `gh workflow list --limit 100 --json name,path,state` |
| Runs | `gh run list --limit 20 --json workflowName,event,status,conclusion,headSha,createdAt` (add `--workflow`, `--branch` or `--event` to narrow) |
| Failing job and step | `gh run view <id> --json jobs --jq '.jobs[] \| select(.conclusion == "failure") \| {name, databaseId, failed_steps: [.steps[] \| select(.conclusion == "failure") \| .name]}'` |
| Log of one failed job (only if needed, never for a job using `secrets.*`) | `gh run view --job <job-id> --log-failed \| grep -n -m 40 -E "error\|Error\|FAIL"` — report the error class only |
| A PR's required checks | `gh pr checks <n> --required --json name,state,bucket,workflow` |
| A PR's merge and auto-merge state | `gh pr view <n> --json mergeStateStatus,autoMergeRequest --jq '{mergeStateStatus, auto_merge: (.autoMergeRequest != null), method: .autoMergeRequest.mergeMethod}'` — never `enabledBy` |
| Landed on `main`, step 1 | `gh pr view <n> --json state,baseRefName,mergeCommit,mergedAt --jq '{state, baseRefName, mergedAt, sha: .mergeCommit.oid}'` |
| Landed on `main`, step 2 | `gh api repos/{owner}/{repo}/compare/main...<sha> --jq .status` — `identical` or `behind` = on `main` |
| Repo secrets / variables (names only) | `gh secret list --json name,updatedAt` and `gh variable list --json name,updatedAt`; add `--env <name>` for an environment. Never `value`. |
| Org secrets / variables (names only; org-admin rights needed) | `gh api orgs/{owner}/actions/secrets --jq '[.secrets[].name]'` and `gh api orgs/{owner}/actions/variables --jq '[.variables[] \| {name, updated_at}]'` — never `value`, never `--org <name>` |
| PRs the account opened today (before a batch) | `gh pr list --author "@me" --state all --search "created:>=<YYYY-MM-DD>" --limit 1000 --json number --jq length` |

**Never used:** `gh ruleset list`, `gh ruleset view` and `gh workflow view` (no `--json`; they print IDs, owners or bypass details), a whole log (`gh run view` with `--log `), `gh run download`, `gh variable get`, `gh api graphql`, `gh auth status`, and any `gh api` path for `secret-scanning`, `dependabot/alerts`, `code-scanning/alerts`, `user`, collaborators, run logs or artifact downloads. The full forbidden list is in `devops.md`.
