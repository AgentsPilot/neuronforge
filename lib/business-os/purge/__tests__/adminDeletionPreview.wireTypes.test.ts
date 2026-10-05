/**
 * The admin Businesses screen re-declares the deletion preview's payload (its
 * source guard forbids `@/lib/business-os` imports). These type-level
 * assertions stop the two copies drifting (admin delete AD-1c; the
 * `adminCreditPosition.wireTypes` precedent).
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * This one file (not the purge directory) is listed in that gate's
 * SCOPED_DIRS, so the aliases below are compiled there and a drift fails with
 * `TS2344`. Jest transpiles without type diagnostics in this repo, so the
 * runtime body is deliberately trivial.
 */

import type { DeletionAreaView, DeletionPreviewPayload } from '@/app/admin/users/types';
import type { AdminDeletionArea, AdminDeletionPreview } from '../AdminDeletionPreview';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<DeletionPreviewPayload, AdminDeletionPreview>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<AdminDeletionPreview, DeletionPreviewPayload>;

/** The area union equals the server's, both ways: a new area fails here, not as a blank label. */
type AreaServerSatisfiesClient = Satisfies<DeletionAreaView, AdminDeletionArea['area']>;
type AreaClientSatisfiesServer = Satisfies<AdminDeletionArea['area'], DeletionAreaView>;

describe('the deletion preview payload types match what the route sends', () => {
  it('is assignable in both directions, and the area union is equal (checked by tsc, not Jest)', () => {
    const checks: Array<
      ServerSatisfiesClient | ClientSatisfiesServer | AreaServerSatisfiesClient | AreaClientSatisfiesServer | null
    > = [null, null, null, null];
    expect(checks).toEqual([null, null, null, null]);
  });
});
