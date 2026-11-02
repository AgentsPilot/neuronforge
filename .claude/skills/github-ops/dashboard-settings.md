# GitHub settings only the dashboard shows

Reference for `github-ops` §2 and §10. These are a **user dashboard step**: give the user the area, they open it and report what it shows (never a value), and the record names the setting, not an account. If the dashboard has moved, the user finds the current page from the repo's Settings menu.

| Setting | Dashboard area |
|---|---|
| Merge queue configuration (method, group size, timeout) | Repo → Settings → Branches (classic rule) or Rules → Rulesets |
| Allow auto-merge, delete head branches, allowed merge methods | Repo → Settings → General → Pull Requests |
| Secret scanning, push protection, Dependabot, code scanning | Repo → Settings → Code security |
| Allowed actions, fork PR workflow approval, workflow permissions | Repo → Settings → Actions → General |
| Secret and variable values | Repo → Settings → Secrets and variables (values are never read back) |
| Collaborators and roles | Repo → Settings → Collaborators |
| Org member privileges, two-factor requirement, org Actions policy, org rulesets | Org → Settings |

The state of a security setting that is off, and any open alert, is recorded in the untracked private docs only (`github-ops` §9). Collaborators and roles are reported as counts by role, never by login.
