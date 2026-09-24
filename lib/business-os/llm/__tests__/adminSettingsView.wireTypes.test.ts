/**
 * The screen re-declares the payload's types so the client can import no server
 * module (FR-6). These type-level assertions are what stop that duplication
 * from rotting.
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT jest ─────────
 * This file is in that gate's scope (`--list` reports it), so the assertions
 * below are evaluated there: reverting the DEF-6 widening (`at: string | null`
 * back to `at: string` in `adminSettingsView.ts`) fails it loudly with
 * `TS2344`, naming this file and line.
 *
 * It is **not** jest, and an earlier version of this header wrongly said it
 * was. SA measured it (F-4): `jest.config.js` hands ts-jest an inline
 * `tsconfig` under which it emits no diagnostics, so a blatant type error in a
 * test file passes. **No test in this repo fails on a type error** — any test
 * whose stated mechanism is "it fails to compile" is inert unless the file also
 * sits inside `typecheck:bos-llm`'s scope, as this one does.
 *
 * The runtime bodies below are therefore deliberately trivial: they keep the
 * file alive as a suite. The type aliases are the substance.
 */

import type {
  AreaView as ClientAreaView,
  LastChangedBy as ClientLastChangedBy,
} from '@/app/admin/business-os-llm/types';
import type { AreaView as ServerAreaView, LastChangedBy as ServerLastChangedBy } from '../adminSettingsView';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/**
 * The three assignments this file exists for. Each one is evaluated when
 * `typecheck:bos-llm` compiles the file; each is REFERENCED below, so there is
 * no unused-symbol warning and no `: true = true` literal for
 * `prefer-as-const` to object to (QA DEF-S2-6 — the one lint error this slice
 * introduced).
 */
type ServerAreaViewSatisfiesClient = Satisfies<ClientAreaView, ServerAreaView>;
type ServerLastChangedSatisfiesClient = Satisfies<ClientLastChangedBy, ServerLastChangedBy>;
/** The other direction: a client state the server cannot produce is dead code. */
type ClientLastChangedSatisfiesServer = Satisfies<ServerLastChangedBy, ClientLastChangedBy>;

describe('the client payload types still match what the server sends', () => {
  it('AreaView is assignable, field for field', () => {
    const sample: ServerAreaViewSatisfiesClient | null = null;
    expect(sample).toBeNull();
  });

  it('all three LastChangedBy states survive, including a null timestamp (DEF-6)', () => {
    const forwards: ServerLastChangedSatisfiesClient | null = null;
    const backwards: ClientLastChangedSatisfiesServer | null = null;
    expect([forwards, backwards]).toEqual([null, null]);

    const kinds: ClientLastChangedBy['kind'][] = ['no_row', 'not_recorded', 'admin', 'unresolved'];
    expect(kinds).toHaveLength(4);
  });
});
