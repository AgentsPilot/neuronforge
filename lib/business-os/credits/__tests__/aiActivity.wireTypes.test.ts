/**
 * The admin page re-declares the AI Activity payload (its source guard
 * forbids `@/lib/` imports). These type-level assertions stop that
 * duplication from rotting.
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * `lib/business-os/credits/` is in that gate's SCOPED_DIRS, so the aliases
 * below are compiled there and a drift fails with `TS2344`. Jest transpiles
 * without type diagnostics in this repo, so the runtime body is deliberately
 * trivial: it keeps the file alive as a suite.
 */

import type { ActivityPayload } from '@/app/admin/business-os-llm/activityTypes';
import type { AiActivityPayload } from '../aiActivityTypes';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<ActivityPayload, AiActivityPayload>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<AiActivityPayload, ActivityPayload>;

describe('the Activity payload types match what the route sends', () => {
  it('is assignable in both directions (checked by typecheck:bos-llm)', () => {
    const forwards: ServerSatisfiesClient | null = null;
    const backwards: ClientSatisfiesServer | null = null;
    expect([forwards, backwards]).toEqual([null, null]);
  });
});
