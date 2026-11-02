# Vercel tool parameters used by vercel-ops

Reference for `vercel-ops` §3–§6. Checked by loading each tool's schema, without calling it. If a name here stops resolving, load the schema again and trust the schema over this file.

| Tool | Parameters this skill relies on | Notes |
|---|---|---|
| `list_deployments` | `projectId`, `target`, `state`, `sha`, `branch`, `since`, `until`, `limit` | `since` / `until` are JavaScript timestamps in **milliseconds**. `state` takes a comma-separated list. `from` / `to` are deprecated — do not use them |
| `get_deployment` | `idOrUrl`, `withGitRepoInfo` | Pass `withGitRepoInfo` to get the commit SHA and branch. The response's aliases decide whether a production deployment serves the domain (`vercel-ops` §4 step 5) |
| `list_deployment_events` | `idOrUrl`, `direction`, `limit`, `since`, `until`, `statusCode` | Build log events. Read for the failing step, the error class and the `SKIP:` line; never copy the log |
| `get_runtime_logs` | `projectId`, `teamId`, `deploymentId`, `environment`, `group_by`, `level`, `since`, `until`, `limit` | `group_by` takes one of `requestPath`, `level`, `source`, `deploymentId`, `branch` — one per call, so "by path and by level" is two calls. `level` is the log level, not the HTTP status code. `environment` takes only `production` or `preview` — never a custom-environment slug; scope a custom environment's deployment by `deploymentId`. `since` / `until` take an ISO date or a relative lookback. Default window is short (minutes); always state the window |
| `get_runtime_errors` | `projectId`, `teamId`, `routes`, `since`, `until` | Project-wide error clusters; **no deployment filter**, so it cannot be the per-deployment evidence. Maximum range is seven days |
| `filter_project_envs` | `idOrName`, `gitBranch`, `customEnvironmentId` / `customEnvironmentSlug` | `gitBranch` needs the Preview target. **Never** `decrypt` or `source` (`vercel-ops` §2) |
| `get_project` | `idOrName` | Value-bearing response: named fields only (`vercel-ops` §2) |

**Deployment states.** The schema of `list_deployments` names its `state` filter values; this skill does not depend on the full list. It keys on **READY versus everything else** (`vercel-ops` §5), plus the one CANCELED-with-`SKIP:` exception.
