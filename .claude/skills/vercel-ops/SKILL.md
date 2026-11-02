---
name: vercel-ops
description: How to read Vercel state and verify a Vercel change in this repo — which projects exist (by role), env var names and targets without values, which deployment holds a value, waiting for a deploy to be READY on the expected commit, docs-only skipped builds, build logs, runtime logs and errors, crons, domains, and the settings only the dashboard shows. Use when the user asks to check or set a Vercel env var, find which deployment has a value, wait for a deploy, investigate a deploy that failed or was skipped, read build logs or runtime logs or errors, check a cron that did not run, check a domain, or check deployment protection or another Vercel project setting. Used by the main session and by the DevOps (DO) agent. Prevents checks that race the deploy, probes of the wrong deployment, and env var values leaking into a file or chat.
---

# vercel-ops

This repo's operating procedure for Vercel. It adds only what is specific to Vercel and points elsewhere for the rest:

| For | Read |
|---|---|
| The eight steps, tiers, approval, order against the deploy, probe rules, change-record template, public-repo rule | `.claude/skills/env-change-protocol/SKILL.md` — mandatory for every change; not repeated here |
| DO's Vercel tool list, the `decrypt` ban, the forbidden Bash and CLI families, where plans go | `.claude/agents/devops.md` |
| Supabase state, and the region a Vercel function region should match | `.claude/skills/supabase-ops/SKILL.md` (§6) |
| Generic Vercel guidance | the `vercel:env-vars`, `vercel:deployments-cicd` and `vercel:vercel-cli` plugin skills. Where one suggests a write, a CLI command or `vercel env pull`, this repo's rules win |
| Settings only the dashboard shows; tool parameter names checked against the tool schemas | [dashboard-settings.md](dashboard-settings.md), [tool-parameters.md](tool-parameters.md) |

Every project and environment is named **by role** ("the web app project", "Production"). Never a project or team ID or slug, a deployment URL, a custom domain or an env var value in tracked text or in a chat summary.

---

## 1. Scope and projects

- Resolve the team and the project with `list_teams` / `list_projects` at the start of each job, and reuse that scope for every later call. Never guess a project; if two could match, ask. IDs and slugs stay inside the calls.
- **More than one Vercel project exists.** Known roles: the web app project and the marketing-site project. Resolve the current list with `list_projects` every time; a project with no known role is reported as "an unrecognised project". No count is fixed here.
- **Each project holds its own env vars.** A value one project uses may also exist in another. Any "where does this value live", "is this var set" or rotation answer covers **every** project, by role. A check of one project is reported as one project, not as "Vercel".

## 2. Value-bearing responses (hard rule)

`filter_project_envs` and `get_project` can return secret material. The documented env-list response carries a `value` field on every variable, and the documented project object carries an `env` list and protection-bypass entries. Treat both responses as value-bearing **whatever a given call returns**:

- Report **named fields only**: key, target, Git-branch scope, type, last-updated time, and for a project its framework, Node version, root directory, Git link and production branch.
- Never quote raw output into a file, a report or a chat. Never summarise, hash, measure or compare a value ("it looks like a URL", "it is 40 characters").
- **Never pass `decrypt` or `source`** to `filter_project_envs`. Never call `get_project_env` (not in DO's tools; it returns the decrypted value).
- The value itself is a user dashboard step. **The user never pastes a value into chat.** They report presence, target, Git-branch scope, type and last-updated time, or "matches what I expected: yes/no". A **sensitive**-type variable cannot be read back even in the dashboard; its correctness is proven only by a probe through the deployed surface (`env-change-protocol` step 5).

## 3. Reading state (Read tier)

| Topic | Procedure |
|---|---|
| **Projects** | `get_project` for framework, Node version, root directory, linked Git repo and production branch — named fields only (§2). Settings it does not show are in [dashboard-settings.md](dashboard-settings.md). |
| **Env vars** | `filter_project_envs` for names, targets and Git-branch scope. Cover **every** target, including any custom environment `get_project` lists — do not assume three. A Preview var can be scoped to one Git branch (`gitBranch`), so "set on Preview" and "set for this branch's preview" are different facts; a Preview var with no branch reaches every preview deployment, other people's PRs included. |
| **Deployments** | `list_deployments` and `get_deployment` for state, target, the commit SHA it was built from (`withGitRepoInfo`), created and ready times, and aliases. `list_deployment_events` for one deployment's build log: read it for the error class and the failing step, never copy it whole (build logs can echo env var names and paths). |
| **Runtime errors and logs** | `get_runtime_errors` first for a production problem (project-wide clusters; it has no deployment filter), then `get_runtime_logs` scoped to **one deployment** and a stated window that brackets the change. Prefer `group_by` for counts. Report counts, status codes and error classes; never copy a log line that names a person (rule (c) in `devops.md`). Retention is plan-limited: an empty window older than retention is "not checked", never "nothing happened". |
| **Domains** | `list_domains`, `get_domain`, `get_domain_config`, `list_project_domains`, `get_project_domain` for which project and target a domain is attached to and whether its DNS config is valid. They do **not** show which deployment serves a domain (§4). |
| **Crons** | §6. |
| **Platform facts** | `search_vercel_documentation` for anything that may change (limits, retention, cron behaviour, build-time env handling). Not hardcoded here beyond what this skill states. |

Every Vercel write — env var, redeploy, promote, rollback, domain, cron, protection — is planned per `env-change-protocol` and executed by the user (production) or by the main session with the user (reversible, Preview). DO's Vercel tools are read-only.

## 4. Which deployment holds this value (the core procedure)

- An env var change applies **only to deployments built after the save**. A running deployment keeps the value it was built with. Saving a variable is not a deploy.
- `NEXT_PUBLIC_*` values are **inlined into the client bundle at build time** (`docs/feature_flags.md`; the readers in `lib/utils/featureFlags.ts` use literal `process.env.NEXT_PUBLIC_*` reads, which is what lets Next.js inline them). Changing one needs a new build of the deployment that serves it. A server-only var also needs a new deployment to be picked up.

| # | Step | Evidence |
|---|---|---|
| 1 | Record the save time (the user reports it, or the dashboard shows it), the project by role and the target. | The user's report |
| 2 | Name in the plan **who** creates the new deployment: a push reaching the branch (Dev / RM), a dashboard Redeploy by the user on Production, or by the main session with the user on Preview. **DO never triggers a deployment.** | The plan |
| 3 | Find the deployment of that project and target that was **created after the save and currently serves the target** (`list_deployments` with `since`, `target`, and the expected `sha` for a code deploy). It is "the first one after the save" only when nothing newer exists. A deployment created before the save is never evidence, even if it finished building after it. | `list_deployments` / `get_deployment` |
| 4 | Wait for it to report READY for the expected SHA (§5). | `get_deployment` |
| 5 | **Production only:** read that deployment with `get_deployment` and check that its aliases include the production domain. If they do not, **stop**: after an Instant Rollback, or when production domains are not auto-assigned, a READY production deployment receives no traffic. Promoting it is a production write the user executes. If a rolling release is active, traffic is split: the evidence must name the deployment it came from. | `get_deployment` aliases |
| 6 | Probe **that** deployment — never the alias's previous deployment, another project or the other target. The probe is chosen per `env-change-protocol` step 5. | below |

**Who probes what:**

- **DO's evidence is server-side and timestamped:** `get_runtime_logs` scoped to that deployment, for a request or job the change affects, in a window after the ready time. DO has no HTTP client.
- **An HTTP or browser probe** of a deployment is made by the main session or the user, with their existing Vercel authentication (the `vercel:access-protected-vercel-deployment` plugin skill). Never a protection-bypass secret, and never turning protection off to probe.
- A 401/403 from the protection page is **"not probed"** — neither a pass nor a fail.

## 5. Waiting for a deploy, and docs-only skips

- Poll `get_deployment` (or `list_deployments` filtered by `sha` and `target`) until the state is READY **for the expected SHA**. A READY deployment of another SHA is not the one being waited for.
- Key on **READY versus everything else.** Not READY yet means wait. A failed build: read `list_deployment_events` for the failing step and error class, report it, and stop — nothing is verified. Any other final state that is not READY is reported and never treated as done, with the one exception below.
- **Docs-only changes skip the build.** `vercel.json` `ignoreCommand` runs `.github/ci/non-deploying-change.sh`; **exit 0 means SKIP**, exit 1 means build. That script is the source of truth for what is skipped: in summary `docs/**`, root-level `*.md`, `scripts/**` (minus the CI gate scripts and Jest suites it carves back out) and `.claude/**`. Nested `.md` is **built** — it is production code, because the V6 pipeline reads prompts from disk. Renames count on both sides (`--no-renames`).
- **An ignored build is recorded as a CANCELED deployment.** CANCELED is the expected outcome only when its build events show the script's `SKIP:` line. Any other CANCELED is a stop.
- **The script fails open:** an unresolvable base or an empty diff builds (exit 1). A build on a docs-only push is possible and is not an error.
- So on a docs-only PR, "no new deployment" or a skipped build is correct, and a quick green check is correct. An env var saved while the only change merging is docs-only gets **no** new deployment from that merge: the plan names the deployment that will carry it (step 2 of §4).
- `vercel.json` disables deployments for merge-queue branches (`gh-readonly-queue/**`), so a queue run is never a deployment to wait for.

## 6. Crons

- The definitions are `vercel.json` `crons` (path + schedule). Adding or changing one is a code change (Dev, through a PR); this skill covers verifying it after the production deploy.
- **Crons run on production deployments only.** A Preview never fires them, so a cron change is verified against production.
- **The active cron set is the current production deployment's.** After a rollback, the older deployment's crons are the ones running. Compare the repo file with what production was built from, not with `main`.
- **Enabled state:** the documented project object carries a `crons` field (enabled and disabled times, the deployment the set came from, the definitions). Read those named fields from `get_project` under §2's rule; if a response does not carry them, the enabled state is a dashboard step. Run history stays a dashboard step.
- **Confirming a cron ran is Read tier:** `get_runtime_logs` on the current production deployment, in a window after the schedule time and inside retention, with `group_by` `requestPath`, then `level` (one per call, [tool-parameters.md](tool-parameters.md)). `level` is the log level, not the HTTP status: report counts by path and by level, and a status code only where the entries carry one; never copy a line. Presence in `vercel.json` proves nothing.
- **Never trigger a cron.** Running one — the dashboard's run button, or a request carrying the cron secret — executes a production job and needs a secret: production tier, the user executes.

## 7. The Vercel CLI

- **DO runs no `vercel` invocation by any route** — not an installed binary, not `npx vercel`, `npm exec vercel` or `pnpm dlx vercel`, which download and run it on the spot. This already follows from "anything not on the allowed list is forbidden" in `devops.md`; it is stated here so nobody reads "not installed" as the control.
- **MCP first, always.** The Vercel MCP server's instruction to "use CLI fallbacks" when MCP fails, and the CLI fallback lines inside the tool descriptions, are **not followed**. An MCP failure is reported, not worked around.
- If the main session ever installs the CLI: read commands only, and `vercel env pull` is forbidden outright — see the Vercel CLI row of the forbidden families in `devops.md`.

## 8. Checklist

- [ ] Team and project resolved with `list_teams` / `list_projects`; every project covered, named by role; an unknown one reported as unrecognised
- [ ] `filter_project_envs` / `get_project` reported by named fields only; no `decrypt`, no `source`, no raw output, no value in chat
- [ ] Every target covered, custom environments and Git-branch scope included
- [ ] The deployment named is the one created after the save that serves the target; READY for the expected SHA
- [ ] Production: that deployment's aliases include the production domain, or the step stopped
- [ ] DO's evidence is that deployment's runtime logs; HTTP probes by the main session or the user; 401/403 recorded as "not probed"
- [ ] A CANCELED deployment accepted only with the `SKIP:` line in its build events
- [ ] Cron checks against the current production deployment, inside retention; no cron triggered
- [ ] No `vercel` command by any route; no CLI fallback after an MCP failure
- [ ] Record written per `env-change-protocol`, with no ID, slug, URL, domain or value in tracked text
