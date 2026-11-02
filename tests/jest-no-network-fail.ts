/**
 * Turn a refused connection into a FAILED TEST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE
 *
 * `tests/jest-no-network.ts` is a `setupFiles` entry: it runs before the test
 * framework exists, so it cannot register `afterEach`. It refuses the socket and
 * records what it refused on the running file's global. This file runs in
 * `setupFilesAfterEnv`, where `afterEach` exists, and fails the case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY RECORD AND FAIL LATER, RATHER THAN THROW AT THE CALL SITE
 *
 * Because the code a unit test reaches almost always swallows the failure —
 * that is the whole reason this class of bug stayed invisible for so long. The
 * audit write is non-blocking by mandate. `rateLimitRepository.hit` fails open.
 * `loadImagePrices` keeps the last map. A throwing `connect` would turn a leak
 * into a silent fallback and the test would still pass.
 *
 * `tests/helpers/noRealNetwork.ts` reached the same conclusion for one module
 * (PR #340) and is the pattern this follows, applied to the whole suite.
 *
 * The socket is still refused exactly as before, so product code sees the same
 * ordinary socket error it already handled. Nothing about the failure's SHAPE
 * changes; only that the suite now says so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ATTRIBUTION IS USUALLY EXACT, AND SOMETIMES NOT
 *
 * A worker runs test files one at a time and the guard republishes the current
 * file's global, so a connection opened by the running test is attributed to it.
 * But a promise left floating by an EARLIER file in the same worker can open a
 * socket after that file has finished, while the next one is running — and it
 * is then recorded against the innocent file.
 *
 * That is not hypothetical: it is how
 * `app/api/admin/exchange-rates/__tests__/route.test.ts` came to be listed as an
 * offender when a full run was measured, while making no request at all on its
 * own. So the message below distinguishes the two cases instead of asserting the
 * blame: an attempt that arrives while no test is running is reported as
 * possibly inherited.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Recorded = { destination: string; whileRunning: string | null };
type Sandbox = typeof globalThis & { __blockedConnections?: Recorded[] };

function drain(): Recorded[] {
  const sandbox = global as Sandbox;
  return sandbox.__blockedConnections?.splice(0) ?? [];
}

function complain(made: Recorded[], when: 'case' | 'file'): never {
  const inherited = made.filter(m => m.whileRunning === null);
  const owned = made.filter(m => m.whileRunning !== null);

  const lines = [
    `${made.length} network connection(s) were refused during this ${when}.`,
    '',
    'A unit test must not reach the network. Stub the seam the call goes',
    "through — for Supabase, jest.mock('@/lib/supabaseServer', ...); for the",
    "audit write, jest.mock('@/lib/services/AuditTrailService', () =>",
    "require('@/tests/helpers/silentAuditTrail')). A call to a live endpoint",
    'belongs in tests/plugins/integration-tests/, which is exempt.',
    '',
    'Refused:',
    ...owned.map(m => `  ${m.destination}  (during: ${m.whileRunning})`),
  ];

  if (inherited.length > 0) {
    lines.push(
      ...inherited.map(m => `  ${m.destination}  (no test was running)`),
      '',
      'An attempt made while no test was running may have been started by an',
      'EARLIER file in this worker whose promise outlived it, in which case this',
      'file is not the one to fix. Run that file alone to tell the two apart:',
      'if it makes no request on its own, look for the leak in a file that ran',
      'before it.'
    );
  }

  throw new Error(lines.join('\n'));
}

afterEach(() => {
  const made = drain();
  if (made.length > 0) complain(made, 'case');
});

/* A connection opened while a module was being imported, or after the last
   case, belongs to no case — without this it would go unreported. */
afterAll(() => {
  const made = drain();
  if (made.length > 0) complain(made, 'file');
});
