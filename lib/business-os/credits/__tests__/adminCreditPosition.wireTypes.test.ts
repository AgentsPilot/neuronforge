/**
 * The admin Businesses screen re-declares the credit view's payload (its
 * source guard forbids `@/lib/business-os` imports), and the server types
 * declare the resolver layer literally (SA W11c-4: no import from the
 * entitlements module). These type-level assertions stop both copies rotting
 * (credit deduction slice 11c; the `creditReport.wireTypes` precedent).
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * `lib/business-os/credits/` is in that gate's SCOPED_DIRS, so the aliases
 * below are compiled there and a drift fails with `TS2344`. Jest transpiles
 * without type diagnostics in this repo, so the runtime body is deliberately
 * trivial.
 */

import type { AccountCreditPositionPayload, CreditAllowanceLayerView } from '@/app/admin/users/types';
import type { TraceEntry } from '@/lib/business-os/entitlements/resolver';
import type { AdminCreditAllowanceLayer, AdminCreditPosition } from '../adminCreditPositionTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<AccountCreditPositionPayload, AdminCreditPosition>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<AdminCreditPosition, AccountCreditPositionPayload>;

/** The literal layer union equals the resolver's, both ways: a new layer fails here, not on screen. */
type ResolverSatisfiesServer = Satisfies<AdminCreditAllowanceLayer, TraceEntry['layer']>;
type ServerSatisfiesResolver = Satisfies<TraceEntry['layer'], AdminCreditAllowanceLayer>;
type ResolverSatisfiesClient = Satisfies<CreditAllowanceLayerView, TraceEntry['layer']>;
type ClientSatisfiesResolver = Satisfies<TraceEntry['layer'], CreditAllowanceLayerView>;

describe('the admin credit view payload types match what the route sends', () => {
  it('is assignable in both directions, and the layer union equals the resolver\'s (checked by typecheck:bos-llm)', () => {
    const checks: Array<
      | ServerSatisfiesClient
      | ClientSatisfiesServer
      | ResolverSatisfiesServer
      | ServerSatisfiesResolver
      | ResolverSatisfiesClient
      | ClientSatisfiesResolver
      | null
    > = [null, null, null, null, null, null];
    expect(checks).toEqual([null, null, null, null, null, null]);
  });
});
