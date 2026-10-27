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
 *
 * MK3A-FU-1 (SA Low-2, SA-WP-FU): two-way `Satisfies` misses an OPTIONAL field
 * added on one side only, so an exact `Equals` over a deep normaliser is
 * asserted too. The two `@ts-expect-error` lines are planted controls: if the
 * helper ever stops biting, the directive is unused and the gate fails
 * (TS2578). The helpers are local on purpose (SA-Q-FU-5), as `Satisfies` is.
 */

import type { CreditReportRecordedInWindow } from '@/lib/business-os/credits/creditReportTypes';
import type { FinanceRecordedAiCost } from '../financeTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Finance's result fits the wire type the route sends. */
type FinanceSatisfiesWire = Satisfies<CreditReportRecordedInWindow, FinanceRecordedAiCost>;
/** And the other way: the wire type holds nothing Finance does not build. */
type WireSatisfiesFinance = Satisfies<FinanceRecordedAiCost, CreditReportRecordedInWindow>;

/** Exact equality, optional and readonly modifiers included. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Flattens intersections at every depth, so `A & B` equals the same object written out. */
type Norm<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]: Norm<T[K]> } : T;
type Expect<T extends true> = T;

/** MK3A-FU-1: exactly equal, an optional field on one side included. */
type ExactlyEqual = Expect<Equals<Norm<CreditReportRecordedInWindow>, Norm<FinanceRecordedAiCost>>>;
// @ts-expect-error planted control: an optional field on one side only is NOT equal
type ControlTopLevel = Expect<Equals<Norm<FinanceRecordedAiCost>, Norm<FinanceRecordedAiCost & { extra?: number }>>>;
// @ts-expect-error planted control: a one-sided optional field one level down is NOT equal
type ControlNested = Expect<Equals<Norm<{ a: { b: number } }>, Norm<{ a: { b: number; c?: string } }>>>;

describe("the AI cost report's recorded wire type equals Finance's", () => {
  it('is assignable in both directions and exactly equal (checked by typecheck:bos-llm)', () => {
    const forwards: FinanceSatisfiesWire | null = null;
    const backwards: WireSatisfiesFinance | null = null;
    const exact: ExactlyEqual | null = null;
    const controls: [ControlTopLevel | null, ControlNested | null] = [null, null];
    expect([forwards, backwards, exact, controls]).toEqual([null, null, null, [null, null]]);
  });
});
