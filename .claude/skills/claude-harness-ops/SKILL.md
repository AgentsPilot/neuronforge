---
name: claude-harness-ops
description: How to read and change the Claude Code harness in this repo safely — where settings live and which scope wins, permissions and allow rules, "Yes, and don't ask again" approvals, the tracked local settings file, MCP servers and their scopes, hooks, subagent tool lists, the read-only Supabase connection for DO, and worktrees (creating one, removing one, the shared node_modules junction). Use when the user asks about a settings file, a permission or allow rule, "don't ask again", adding or removing an MCP server, a hook, a subagent's tools list, creating or removing a worktree, node_modules missing or broken in a worktree, or the tracked .claude/settings.local.json. Used by the main session and by the DevOps (DO) agent. Prevents a worktree removal that deletes the shared node_modules, standing approvals published in a public repo, and tool-list or hook guards that silently do nothing.
---

# claude-harness-ops

This repo's operating procedure for the Claude Code harness: settings, permissions, MCP servers, hooks, subagent tool lists and worktrees. It adds only what is specific to the harness and points elsewhere for the rest:

| For | Read |
|---|---|
| The eight steps, what each tier means, approval, probe rules, change-record template, public-repo rule | `.claude/skills/env-change-protocol/SKILL.md` — mandatory for every harness change; not repeated here |
| DO's tool list, allowed and forbidden Bash forms, what DO may write | `.claude/agents/devops.md` |
| Never `git stash`, and why | `.claude/skills/github-ops/SKILL.md` §8 |
| The read-only SQL rules (a)–(d) and the `begin read only` wrapper | `.claude/agents/devops.md` § Supabase, `.claude/skills/supabase-ops/SKILL.md` |
| Settings keys, precedence, permissions, MCP, hooks and subagents as documented | The Claude Code docs: settings, permissions, mcp, hooks and sub-agents pages. Check a key name there at use time; this skill hardcodes nothing beyond what it states |
| The Supabase MCP server's URL shape and its settings | The [Supabase MCP guide](https://supabase.com/docs/guides/getting-started/mcp) |

---

## 1. Who reads what (hard rule)

- **DO never opens `~/.claude.json` or any user-scope settings file**, with Read or any other tool. DO's Read tool has no path limit, so this rule is the guard. Those reads belong to the main session, and report keys, counts, names and status only.
- `~/.claude.json` is **never printed and never read in full**, by anyone. It holds account details, MCP server configs (URLs, headers) and trust decisions.
- DO reads tracked harness files (§2) and runs `git worktree list`. Everything else in this skill that needs a live check is a **main-session check**: `/status`, `/permissions`, `/mcp`, `claude doctor` (rejected entries), the user-settings key and count reads in §2, and every worktree and junction read. DO lists them in its report as "main-session checks owed".
- The main session reports names, counts and status from those checks. Never a URL, a header or a path.

## 2. Where harness state lives (Read tier)

| Source | Tracked? | How to read it |
|---|---|---|
| Managed settings | No | `/status` → Setting sources (main session). Reported as "managed: present / absent", never its content. |
| User settings (`~/.claude/settings.json`) | No | Main session only: keys and counts. `jq` is not installed here; use `node -p "Object.keys(require(require('os').homedir()+'/.claude/settings.json'))"` and `node -p "(require(require('os').homedir()+'/.claude/settings.json').permissions?.allow ?? []).length"`. Never print the file. |
| `.claude/settings.json` (shared project) | Yes | Read in full; it is public. |
| `.claude/settings.local.json` (project local) | **Yes, today** (§3) | Keys and counts first. Read entries only to check a planned change; never paste them into chat. |
| `~/.claude.json` | No | Main session only, server **names** and status. `claude mcp list` prints each server's URL: report names and status from it, never repeat a URL. `claude mcp get` prints headers and is not used. |
| `.mcp.json` (project MCP servers) | Would be | None exists. If one is added, every ref or token in it is a `${VAR}` (§4). |
| Plugin servers and agents | No | Server names from the tool names (`mcp__plugin_<plugin>_<server>__<tool>`). |
| Subagent frontmatter (`.claude/agents/*.md`) | Yes | `tools:`, `disallowedTools`, `mcpServers`, `hooks`, `permissionMode`. |

**Precedence and merging** (read every scope; one file is never the whole answer):

| Rule | What it means |
|---|---|
| Order | Managed, then command line, then project local, then shared project, then user. The first scope that sets a single-value key wins. |
| Lists merge | `permissions.allow`, `ask` and `deny` merge across every scope. |
| Deny wins | Deny beats ask beats allow. An allow rule cannot carve an exception out of a deny. |
| Hooks | A hook can deny a call; it never overrides a deny rule. |

On Windows the local settings file sits next to `.claude/settings.json` in the directory the session started in, and each worktree reads **its own checked-out copy**.

## 3. Changing settings and permissions

Every harness change follows `env-change-protocol`. This table only classifies harness changes; what each tier means is in that skill's §1.

| Harness change | Tier |
|---|---|
| Add or widen an allow rule | Production or irreversible (SA reviews, the user executes) |
| Add an MCP server, in any scope | Production or irreversible |
| Add a hook | Production or irreversible, and a new pattern (§5) |
| Change the default permission mode in a settings file, or a subagent's `permissionMode` | Production or irreversible |
| Any key that turns off a prompt, a sandbox or a trust check: for example auto-approving project MCP servers, turning the sandbox off, approving Bash automatically inside the sandbox, or lifting a block on bypass-permissions mode. This skill names no key for these; read the current key name from the settings docs before writing it into a plan | Production or irreversible |
| Remove an allow rule, add a deny rule, remove an MCP server the user added | Reversible write |
| DO's own `tools:` list, either way | Always SA review, and always through a PR |

- **Who edits the file.** Tracked harness files (`.claude/settings.json`, `.claude/agents/*.md`) change through a PR like any repo file: Dev writes, RM commits. User-scope files and `~/.claude.json` are changed by the user only. DO edits none of them (`devops.md` § What you may write).
- **Before-state** is the keys and counts from §2, never the entries.
- **The probe is the behaviour.** A new deny rule is proven by a call it blocks; a new allow rule by a call that no longer prompts; a removed rule by a call that prompts again. Settings reload live, except a few keys read at start (settings docs). Agent files and tool lists load at **session start**, so a change to them is verified in a fresh session.

**The tracked local settings file.** `.claude/settings.local.json` is documented as personal, yet it is tracked in this public repo. A tracked local file is treated as repository-supplied: its allow rules wait until the folder is trusted. Each "don't ask again" writes a rule into the copy on the current branch, which can ride along in a PR.

- **Before every commit:** check whether `.claude/settings.local.json` is in the diff. It is never committed by accident.
- **For the main session and the user** (DO never sees a prompt): never approve "don't ask again" for a command that embeds a secret, a token, a URL with an ID, or an absolute personal path. When an approval would write a personal path, choose "Yes" (once).
- **Untracking it is the user's decision** (Q-D5-2 in the DevOps requirement). If the user says yes: `git rm --cached .claude/settings.local.json` plus one `.gitignore` line, in its own commit or its own small PR, so it reverts alone. No history rewrite. **Back up first:** when the untrack commit reaches another checkout through a pull or merge, git **deletes** that checkout's copy. Before the PR merges, the user copies the file from the main checkout to a private location, and restores it after the main checkout pulls `main`. A worktree on an older branch keeps its copy until it merges `main`, then loses it the same way. The PR description carries this step.

## 4. MCP servers

- **Scopes.** Local and user scope are stored in `~/.claude.json` (untracked); local scope is keyed by the project path, so it does not reach a worktree, which has its own path. Project scope is `.mcp.json` (tracked) and needs approval in interactive sessions. A tracked config supports `${VAR}` in `url` and `headers`.
- **A server URL with a project ref or a token goes only into user scope**, typed by the user, never into a tracked file — not even as a placeholder.
- **Names.** A name the user chooses, by role (for example a read-only Supabase server), may be written in tracked text. A claude.ai connector's instance ID never may.
- **After any server change:** in a fresh session, check that every name in DO's `tools:` still resolves (the DO-1 tool-list smoke test). An unresolved name is **dropped silently**, so "the agent loaded" proves nothing.
- A tool-list entry for a server that is not configured **fails closed**: the tool is simply missing.

## 5. Hooks

- A hook runs any command, with the user's credentials, before or after a tool call, and can deny a call (`PreToolUse`, exit code 2 or a deny decision). MCP matchers need a regex such as `mcp__<server>__.*`.
- A new hook is a **new pattern** (CLAUDE.md rule 7): SA reviews it before it is added.
- **A guard must fail closed.** A project subagent's frontmatter hooks, and its inline `mcpServers`, load only after the folder is trusted; until then they are skipped. So a frontmatter hook is never the only guard on a write.

## 6. Worktrees

**Removing a worktree.** A worktree's `node_modules` is a Windows junction to a shared folder. `git worktree remove --force` follows the junction and **deletes the shared contents**, breaking every tree that uses it. There can be more than one shared folder, so the target is always read, never assumed. Safe removal (PowerShell, main session with the user), in this order:

1. `$j = Get-Item '<wt>/node_modules'; $j.LinkType; $j.Target` — note the target. If `LinkType` is `SymbolicLink` or anything else that is not empty and not `Junction`, **stop and ask the user**: a symbolic link is followed by a recursive delete exactly like a junction. If `<wt>/node_modules` does not exist, skip to step 4. If it is a real folder (`LinkType` empty), stop and ask the user.
2. `if ($j.LinkType -eq 'Junction') { $j.Delete() }`. This removes the link only.
3. Check that `Test-Path '<wt>/node_modules'` is now `False`, and that `<target>/next/package.json` still exists, where `<target>` is the folder noted in step 1.
4. Only then run `git worktree remove '<wt>'`, **without `--force`**. If it refuses, report why. Never add `--force`, `rm -rf` or `Remove-Item -Recurse` to get past a refusal.

`cmd /c rmdir` is not a fallback: the PowerShell tool blocks it, and Git Bash mangles quoted paths with spaces.

**Creating a worktree.** How the worktree itself is created, and which shared folder it links to: **ask the user**. A new worktree has no `node_modules`; it gets one as a junction to the shared folder the user names, made by the main session with the user. This repo's workplans record the PowerShell form working, where `mklink /J` from Git Bash mis-quoted its target: `New-Item -ItemType Junction -Path '<wt>/node_modules' -Target '<shared>'`. Then check that `(Get-Item '<wt>/node_modules').LinkType` is `Junction` and that `<wt>/node_modules/next/package.json` exists.

- **Shared dependencies.** Local test results count only while the worktree's and the shared folder's dependency sets agree. A shared folder that lacks a dependency `main` added makes tests fail locally while CI passes. CI's `npm ci` is the authority. Fix it with the user; never `npm install` in a stale checkout, because through the junction it rewrites the shared folder for every tree.
- **Baseline comparisons** ("was this test red before my change?") use `git archive <base>` extracted into a scratch directory, not a temporary worktree, so no junction is created or removed.
- **Never `git stash`:** see `github-ops` §8.
- **Shared machine.** Never kill processes by image name (`taskkill /IM`, `pkill`): that reaches every session. Identify a hung process by PID and working directory, and ask the user.
- The worktree folder is gitignored. Never write a worktree folder name or a path in tracked text.
- **DO's part:** `git worktree list` only. `git worktree remove` is forbidden for DO (`devops.md`).

## 7. Public-repo specifics for the harness

- Never in tracked text: a project ref, a connector instance ID, a URL with an ID, a token, an absolute personal path, a shared folder or worktree path, or anything from `~/.claude.json` or user settings.
- An allow rule is a public statement of what a session may run without asking. Keep tracked rules narrow.

## 8. The read-only Supabase connection for DO (FU-3)

**Why:** with the hosted server's read-only mode, every query runs as a read-only Postgres user, so rule (a) (SELECT-only) is enforced **by the database**, on that server only.

**What the user does** (production tier, a harness change):

- Adds one HTTP MCP server in **user scope** (never local scope, never `.mcp.json`, never an inline `mcpServers` entry in an agent file), named by role, for example `supabase-readonly`.
- Gives it three settings: read-only mode on, pinned to the production project, and a feature list of only the group that holds `execute_sql` (the `database` group in the Supabase guide; check the guide at use). The URL shape is in the Supabase guide; it is not written here.
- Types the project ref only in their own terminal, into their own config. The main session never runs the add command, so the ref never enters a transcript.
- Logs the server in with `/mcp`.

**The H1 probe** (main session with the user, before any `tools:` change merges). A write inside the `begin read only` wrapper fails on **any** server, so it cannot prove read-only mode. The probe runs **unwrapped**, as a one-time exception to rule (b) made by the main session, never by DO:

1. `select current_setting('transaction_read_only')` returns `on` through the new server and `off` through the plugin server. The `off` is the control that shows the probe can fail.
2. An unwrapped `create temp table` through the new server is rejected. (If it were not, the temp table dies with the session.)
3. A catalog fact that only the intended project has comes back, so the server is pinned to the right project.

The record names the project by role and the error by class.

**The `tools:` swap (FU-3b).** In `devops.md`'s `tools:` list, the plugin server's `execute_sql` is **replaced** by the new server's, never joined: both listed at once would let DO pick the writable one. It is one line, through a PR, reviewed by SA, only after the H1 probe passed. After the merge, the fresh-session smoke test (§4) shows the new name resolves and the plugin `execute_sql` is gone.

- **What stays:** rules (a)–(d) and the wrapper, unchanged, as the guard that does not depend on config. DO's `tools:` list stays the guard for every non-SQL tool; read-only mode is not relied on to remove other tools.
- **Fallback:** until the probe passes, the plugin `execute_sql` stays as it is. If the new server later goes missing, its name drops, DO has no SQL tool, and SQL checks are reported as "not read". Undo = revert the one `tools:` line.
- **Other projects** (by role): DO has no SQL tool for them after the swap. Each gets its own server by the same procedure, and SA reviews the `tools:` change.
- **The limit (H2): the binding is by name only, so it trusts the config.** `devops.md` is tracked and loads on every machine. A user-scope server with the same name but without read-only mode resolves just as well, and gives DO a writable `execute_sql`. "Fails closed" holds only when the name is absent. So anyone who adds a server under that name gives it all three settings, and the H1 probe is re-run after any re-add or reconfigure. No tracked file can verify a user-scope config.

## 9. Closed decisions

Do not reopen these without the new fact named.

- **FU-4, a Preview-only Vercel env write for DO: closed, not built.** No permission rule can match the env tools' list-valued target, and a hook would be a new pattern that fails open when the folder is not trusted. Reopen only if Vercel offers an environment-scoped token, or a Claude Code settings rule can match an MCP argument.
- **ClickUp tools for DO: closed as not needed.** No DO job needs task status, the update tool cannot be limited to the status field, and the list ID is private. Reopen only with a DO job that needs task status.

## 10. Checklist

- [ ] DO opened no `~/.claude.json` or user-scope settings; user-scope reads were the main session's, by keys and counts; main-session checks owed are listed
- [ ] Every scope read for a permission question; precedence and list merging applied
- [ ] The harness change classified by §3 and run per `env-change-protocol`; a change to DO's `tools:` went to SA and through a PR
- [ ] The diff checked for `.claude/settings.local.json` before commit; no "don't ask again" for a command with a secret, an ID URL or a personal path
- [ ] No server URL, ref, token or connector ID in a tracked file; a tracked config uses `${VAR}`
- [ ] After a server or tool-list change, the fresh-session smoke test shows every DO tool name resolves
- [ ] No hook added without SA; no frontmatter hook as the only guard
- [ ] Worktree removal: link type and target read, link deleted, link gone and target intact, then `git worktree remove` without `--force`
- [ ] No worktree, folder or personal path in tracked text; no process killed by image name
- [ ] FU-3: user scope, three settings, H1 probe with its control before the swap; `execute_sql` replaced, never joined
