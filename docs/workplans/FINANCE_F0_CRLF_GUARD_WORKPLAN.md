# Workplan: Finance F-0, CRLF in the finance source guard

**Developer:** Dev | **Branch:** `fix/finance-f0-crlf-guard` | **Date:** 2026-10-15 | **Status:** Code Complete

**Problem:** `lib/business-os/finance/__tests__/finance.source.guard.test.ts` reads files with `readFileSync(..., 'utf8')` and does not normalise line endings. On a Windows (CRLF) checkout, the DF-5 scans that look for a function or interface end shaped like newline, closing brace, newline find nothing, so 2 tests fail locally: "DF-5: the refunded amount..." and "the DF-5 pin bites (planted)...". CI uses LF and passes.

**Fix (test-only):** the `read` helper now applies the CRLF-to-LF replace, following the pattern of merged PR #394. Every scan goes through `read` or `codeOf`, so no other change is needed.

**Tailwind check:** `app/__tests__/tailwind-css-escape.guard.test.ts` scans every tracked file, test files included. It only flags a backslash followed by hex, and the `r` in the regex is not hex, so the plain regex is safe. That guard passes (6/6).

**Verification:** `npx jest lib/business-os/finance --ci` went from 2 failed / 1568 passed to 1570 / 1570 passed (16 suites). The baseline run is the mutation evidence: without the fix, the 2 DF-5 tests fail.
