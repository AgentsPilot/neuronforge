/**
 * Money MK-3 (SA-Q-MK3-12, SA-WP-MK3): the AI cost report's `recorded` wire
 * type is declared in the credits module (`CreditReportRecordedInWindow`), so
 * that module never imports the finance module. It must stay EQUAL to
 * Finance's own `FinanceRecordedAiCost`, which `recordedInWindow` returns.
 *
 * ── What enforces this is the type checker, NOT Jest ──────────────────────
 * This one file is in `npm run typecheck:bos-llm`'s SCOPED_DIRS, so a field
 * added, removed or retyped on either side fails with `TS2344`. Jest
 * transpiles without type diagnostics in this repo, so the runtime body is
 * deliberately trivial: it keeps the file alive as a suite. The client mirror
 * (`app/admin/business-os-llm/costTypes.ts`) is pinned to the whole response
 * by `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts`.
 */

import type { CreditReportRecordedInWindow } from '@/lib/business-os/credits/creditReportTypes';
import type { FinanceRecordedAiCost } from '../financeTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Finance's result fits the wire type the route sends. */
type FinanceSatisfiesWire = Satisfies<CreditReportRecordedInWindow, FinanceRecordedAiCost>;
/** And the other way: the wire type holds nothing Finance does not build. */
type WireSatisfiesFinance = Satisfies<FinanceRecordedAiCost, CreditReportRecordedInWindow>;

describe("the AI cost report's recorded wire type equals Finance's", () => {
  it('is assignable in both directions (checked by typecheck:bos-llm)', () => {
    const forwards: FinanceSatisfiesWire | null = null;
    const backwards: WireSatisfiesFinance | null = null;
    expect([forwards, backwards]).toEqual([null, null]);
  });
});
