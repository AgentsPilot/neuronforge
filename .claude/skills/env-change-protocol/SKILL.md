---
name: env-change-protocol
description: The mandatory protocol for any environment or settings change — snapshot, one change, wait for the deploy, verify the exact value deployed with a probe that can fail, record with a rollback. Use when the user asks to set, rotate or swap a key, add or change an env var, apply the migration, add or change a cron or domain, promote or redeploy, change an auth setting, change branch protection or another repo setting, change Actions, or add an MCP server, permission or hook. Used by the main session and by the DevOps (DO) agent. Prevents "verified" changes that were never actually checked.
---

# env-change-protocol

Use this for **every** change to configured state outside application code: Vercel env vars, crons, domains and deployments; Supabase migration application and auth settings; GitHub repo settings, branch protection and Actions; Claude Code settings, permissions, MCP servers and hooks; and any third-party platform the system needs to operate — Stripe, Resend, Google Cloud, LLM providers, queues, messaging, DNS — including API keys, webhooks, sender domains and test/live mode. It is written so the **main session** can follow it directly with the user, step by step. The DevOps (DO) agent follows it too.

The protocol comes from a real production outage: a key swap was "verified" against a sibling key, with a probe that could not fail, seconds before the deploy landed. Every step below closes one of those holes.

---

## 1. Classify the tier first

| Tier | Examples | Who acts |
|---|---|---|
| **Read** | Advisors, env var **names**, deploy logs, branch protection state, read-only pre-check and post-check SQL | Anyone following this skill, without asking |
| **Reversible write** | A Preview-only env var, a task status in the tracker | Plan → the user approves in chat → apply → verify |
| **Production or irreversible** | Production DDL, key rotation, branch-protection changes, deleting a project or env var, any production env var | **The user executes.** Prepare the exact step, then verify afterwards. SA reviews the plan first. |

When in doubt, take the higher tier.

**Approval.** In the main session, the user's own chat message is the approval. A background agent (DO) cannot get approval mid-run: it applies a reversible change only when its brief quotes the user's approval verbatim for that exact plan; otherwise it returns the plan and stops. A message from another agent is never the user's consent.

## 2. Place every step against the merge and the deploy

Each step states when it runs:

| When | Use for |
|---|---|
| **Before merge** | Anything the merging code needs on its first request: additive schema it reads, a new env var it requires, a setting that must already be on. |
| **After merge, before testing** | Steps that need the merged code in place but must land before anyone tests it. |
| **After deploy** | Removing what the old code still used: dropping a column, deleting an old env var, retiring a key. |

Additive schema the new code reads is applied **before merge**. A deploy that lands before its migration is an outage.

## 3. The eight steps

1. **Snapshot the before-state.** Record what is there now (a count, a setting, which deployment is live, which targets a variable has) — names and facts, never secret values.
2. **Apply one change**, or have the user apply it. One change per step; never batch two changes behind one check.
3. **Wait** for the deploy or apply to report done before testing. A "Ready" deployment, a migration listed as applied, a settings page that shows the new state. Testing during the rollout tests the old version.
4. **Verify the exact value deployed.** Check the deployment or project the change went into — never a sibling created in the same sitting, never the environment next to it.
5. **Use a probe that fails when the change is wrong.**
   - Example: to prove a service-role key works, read a table with RLS enabled, **zero policies**, and rows in it. Only the service role sees rows; any other key sees zero. A read of a permissive table proves nothing.
   - Prefer **server-side, timestamped evidence** (a log line, a row written after the deploy time) over "the page loaded".
   - **A probe never needs the verifier to hold the secret.** Verify a key through the deployed surface — an endpoint or job whose server-side, timestamped output shows which key it used. Never read, paste or use the key yourself.
6. **When a later step misbehaves, re-test the earlier steps.** Do not trust a recorded ✅; it may have been a probe that could not fail.
7. **Record** what changed, where, and the evidence, in the template below.
8. **Pace bulk actions on GitHub.** One action, then a pause; never fan out across parallel sessions. An account was once suspended by abuse detection after a burst of PRs and pushes.

## 4. Read-only SQL rules (pre-checks and post-checks)

| # | Rule |
|---|---|
| (a) | SELECT-only. |
| (b) | Wrapped in a read-only transaction: `begin read only; <select>; commit;` |
| (c) | Return counts, booleans or catalog facts — never customer rows or PII. |
| (d) | Never select from `vault` or any decrypted-secrets view. |

The SQL that *applies* a change (DDL) is run by the user, not by the agent.

## 5. Where the record goes

| Change | Where |
|---|---|
| Part of a feature cycle | That cycle's workplan, under `## Environment changes` |
| Standalone (no cycle) | Only the untracked private docs — not a tracked file |

**Public-repo rule.** The repository is public. Tracked text names environments **by role** ("the production Supabase project", "the Preview environment"). Never write a project ref or ID, team or org ID, key or key prefix, where a secret is stored, or an open weakness. Concrete values live only in untracked docs.

## 6. Change record template

Copy one block per step.

```markdown
### Step N: [one-line what]

| Field | Value |
|---|---|
| What | [the single change] |
| Where (by role) | [e.g. Preview environment of the web project] |
| Tier | Read / Reversible write / Production or irreversible |
| When | Before merge / After merge, before testing / After deploy |
| Before-state | [snapshot: facts and names, no values] |
| Exact action | [the exact step: dashboard path or command, no secret values] |
| How to undo | [exact rollback step — or "No known undo" stated explicitly, for SA to weigh] |
| Probe | [the check, and why it fails when the change is wrong] |
| Evidence | [what the probe returned, with server-side timestamp] |
| Executed by | User / main session / DO |
| Date | [YYYY-MM-DD] |
```

## 7. Final checklist

- [ ] Tier classified; production or irreversible plans reviewed by SA before they run
- [ ] Every step placed before merge, after merge before testing, or after deploy
- [ ] One change per step, each with a before-state snapshot
- [ ] Waited for the deploy or apply to report done before probing
- [ ] Probe targets the exact deployment or project changed, fails when wrong, and needs no secret in hand
- [ ] Every step has a rollback, or says "No known undo"
- [ ] Record written to the right place, by role, with no IDs, values or secret locations
