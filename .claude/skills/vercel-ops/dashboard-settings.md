# Vercel settings only the dashboard shows

Reference for `vercel-ops` §3. These are a **user dashboard step**: give the user the area, they open it in the project (named by role) or the team settings and report what it shows, and the record names the environment by role. If the dashboard has moved, find the current path with `search_vercel_documentation`.

The user reports facts, never values: presence, target, Git-branch scope, type, last-updated time, or "matches what I expected: yes/no" (`vercel-ops` §2).

| Setting | Dashboard area |
|---|---|
| Deployment protection (Vercel Authentication, password, bypass for automation) | Project → Settings → Deployment Protection |
| Production branch, Git connection, ignored build step override | Project → Settings → Git |
| Build and development settings (framework, commands, Node version, root directory) | Project → Settings → Build and Deployment |
| Function region, max duration, memory | Project → Settings → Functions |
| Cron job run history; the enabled state when `get_project` does not carry it (`vercel-ops` §6) | Project → Settings → Cron Jobs |
| Env var **values** | Project → Settings → Environment Variables |
| Team members and roles | Team → Settings → Members |
| Plan, usage, billing | Team → Settings → Billing |
| Firewall rules, attack challenge mode | Project → Firewall |
| Log drains | Team → Settings → Drains |

`vercel.json` sets no function region or duration (its keys are `crons`, `ignoreCommand`, `git.deploymentEnabled` and `rewrites`), so those are dashboard facts. The function region should match the Supabase project's region: see `supabase-ops` §6, not repeated here.

A protection or bypass setting is read, never changed, to make a probe work (`vercel-ops` §4, "Who probes what").
