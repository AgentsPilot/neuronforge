/**
 * The admin page re-declares the cost report's payload (its source guard
 * forbids `@/lib/` imports). These type-level assertions stop that
 * duplication from rotting. Money MK-2 (RU-9): the route sends
 * `CreditReportResponse` (the report plus `chargedInWindow`), so that is the
 * server side compared here.
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * `lib/business-os/credits/` is in that gate's SCOPED_DIRS (slice 4a), so the
 * aliases below are compiled there and a drift fails with `TS2344`. Jest
 * transpiles without type diagnostics in this repo, so the runtime bodies are
 * deliberately trivial: they keep the file alive as a suite.
 *
 * MK3A-FU-1 (SA Low-2, SA-WP-FU): two-way `Satisfies` misses an OPTIONAL field
 * added on one side only, so an exact `Equals` is asserted too. The server type
 * is an intersection, which a plain `Equals` reads as different from the
 * client's flat object, so both sides go through `Norm` first. The two
 * `@ts-expect-error` lines are planted controls (TS2578 if they stop biting).
 */

import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';
import type { CreditReportResponse } from '../creditReportTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<CostReportPayload, CreditReportResponse>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<CreditReportResponse, CostReportPayload>;

/** Exact equality, optional and readonly modifiers included. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Flattens intersections at every depth, so `A & B` equals the same object written out. */
type Norm<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]: Norm<T[K]> } : T;
type Expect<T extends true> = T;

/** MK3A-FU-1: exactly equal, an optional field on one side included. */
type ExactlyEqual = Expect<Equals<Norm<CostReportPayload>, Norm<CreditReportResponse>>>;
// @ts-expect-error planted control: an optional field on one side only is NOT equal
type ControlTopLevel = Expect<Equals<Norm<CostReportPayload>, Norm<CostReportPayload & { extra?: number }>>>;
// @ts-expect-error planted control: a one-sided optional field one level down is NOT equal
type ControlNested = Expect<Equals<Norm<{ a: { b: number } }>, Norm<{ a: { b: number; c?: string } }>>>;

describe('the Costs & credits payload types match what the route sends', () => {
  it('is assignable in both directions and exactly equal (checked by typecheck:bos-llm)', () => {
    const forwards: ServerSatisfiesClient | null = null;
    const backwards: ClientSatisfiesServer | null = null;
    const exact: ExactlyEqual | null = null;
    const controls: [ControlTopLevel | null, ControlNested | null] = [null, null];
    expect([forwards, backwards, exact, controls]).toEqual([null, null, null, [null, null]]);
  });
});
