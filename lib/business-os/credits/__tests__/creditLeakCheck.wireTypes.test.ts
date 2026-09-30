/**
 * The admin page re-declares the leak check's payload (its source guard
 * forbids `@/lib/` imports). These type-level assertions stop that duplication
 * from rotting (the 4a `creditReport.wireTypes.test.ts` pattern).
 *
 * What enforces them is `npm run typecheck:bos-llm` (this folder is in its
 * SCOPED_DIRS), NOT Jest, which transpiles without type diagnostics here. The
 * runtime body is deliberately trivial: it keeps the file alive as a suite.
 */

import type { LeakCheckPayload } from '@/app/admin/business-os-llm/leakTypes';
import type { CreditLeakCheckResult } from '../creditLeakCheckTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<LeakCheckPayload, CreditLeakCheckResult>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<CreditLeakCheckResult, LeakCheckPayload>;

describe('the leak check payload types match what the route sends', () => {
  it('is assignable in both directions (checked by typecheck:bos-llm)', () => {
    const forwards: ServerSatisfiesClient | null = null;
    const backwards: ClientSatisfiesServer | null = null;
    expect([forwards, backwards]).toEqual([null, null]);
  });
});
