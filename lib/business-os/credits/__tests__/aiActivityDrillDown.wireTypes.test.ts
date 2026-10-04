/**
 * The admin page re-declares the AI Activity drill-down payload (its source
 * guard forbids `@/lib/` imports). These type-level assertions stop that
 * duplication from rotting (Gap B slice B2a).
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * `lib/business-os/credits/` is in that gate's SCOPED_DIRS, so the aliases
 * below are compiled there and a drift fails with `TS2344`. Jest transpiles
 * without type diagnostics in this repo, so the runtime body is deliberately
 * trivial: it keeps the file alive as a suite.
 */

import type { ActivityDrillDownPayload } from '@/app/admin/business-os-llm/activityDrillDownTypes';
import type { AiActivityDrillDownPayload } from '../aiActivityDrillDownTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<ActivityDrillDownPayload, AiActivityDrillDownPayload>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<AiActivityDrillDownPayload, ActivityDrillDownPayload>;

describe('the Activity drill-down payload types match what the route sends', () => {
  it('is assignable in both directions (checked by typecheck:bos-llm)', () => {
    const forwards: ServerSatisfiesClient | null = null;
    const backwards: ClientSatisfiesServer | null = null;
    expect([forwards, backwards]).toEqual([null, null]);
  });
});
