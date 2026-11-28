# Retrospective: App Version Stamp (R19)

> **Last Updated**: 2026-11-27

## Overview

Retrospective for the `feature/app-version-stamp` cycle (2026-11-26 to 2026-11-27), ClickUp R19 under PROD-4. The cycle ran Dev workplan, SA workplan review, implementation, SA code review, QA, the user's diff review, RM, and merge through the merge queue (PR #698). Every step waited for the user's OK where the standing rules require it.

**MD links:** [Spec: DEVELOPMENT_LIFECYCLE.md §5.4](/docs/DEVELOPMENT_LIFECYCLE.md) | [Workplan](/docs/workplans/app-version-stamp-workplan.md)

---

## What shipped

- `GET /api/version`: public, and returns only `environment`, a 7-character `commit` and `builtAt`. A strict schema enforces that limit, and the response is never cached.
- A version line at the bottom of Business OS Settings and of every admin page.
- `deploymentRoleOf` tells Staging (`main`) from Production (`production` branch, production environment) by the branch. It is built on the existing environment classifier, so there is still one label.
- The commit and the build time are inlined at build in `next.config.js`.

---

## What went well

- **"Reuse before building" held.** The role function extends `environmentLabelOf` in the admin environment module, and the catalogue drift guard passed without an edit. SA caught the one trap in advance: passing `process.env` whole would have turned the guard red.
- **SA's workplan conditions were specific enough to test.** Each of SA-V1 to SA-V11 became a test case or a checked line, so the code review was a table, not a debate.
- **The code review found a real layout bug that tests had missed.** The Settings line sat inside the two-column grid (SA-C-1). It looked right only on a phone.
- **The post-merge check was read from the right builds.** The cache question was answered on `main`'s builds, not assumed from the preview.

---

## What to do differently

| Issue | Lesson |
|---|---|
| Preview builds here always skip the Vercel build cache | A cache or compile-time condition cannot be met on a preview. Plan it as a post-merge check on `main`, and compare against the build after the merge build: a `next.config.js` change makes the merge build itself cold |
| A fresh worktree has no `.env.local`, so `npm run build` fails at "Collecting page data" | Build with the placeholder values CI uses. The real fix is the routes that create clients on import, which is out of scope here |
| No browser look at the line before merge | A signed-in check needs the real env in the worktree. A render test placed the line instead. For UI slices, decide at the workplan stage how the visual check will be done |
| Writing test files with an inline Python script put literal backspace characters into regexes | Write test files with the editor tools, or check the result for control characters |
| Heavy Jest runs in parallel with `tsc` timed out unrelated suites | Run the typecheck and big suites one at a time before calling a failure real |

---

## Follow-ups

- Optional: show the deployment role on `/admin/environment` (SA Q1, deferred).
- R5 (bug form *version* field) and R10 (smoke test) can now use `/api/version`.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Cycle closed: PR #698 merged, live probe and SA-V9 passed |
