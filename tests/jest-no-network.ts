/**
 * No test in the Jest suite may reach the network.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES
 *
 * Unit tests were making real outbound calls, because production code reaches
 * `supabaseServer` at module scope — past the collaborators a test can stub.
 * `tests/plugins/jest-setup.ts` points Supabase at `https://test.supabase.co`,
 * which does not exist, so each of those calls was a DNS lookup that NXDOMAINed
 * in a few milliseconds and was swallowed by the caller's error handling. The
 * test passed, and nobody could tell it had left the machine.
 *
 * Until a DNS query was lost. A resolver then waits out its retry timeout,
 * which on Linux is the same five seconds as Jest's per-test budget, so one
 * dropped packet is enough to blow whichever test happens to be holding that
 * `await`:
 *
 *     thrown: "Exceeded timeout of 5000 ms for a test.
 *       at lib/business-os/channel-insights/__tests__/ChannelPerformanceService.test.ts
 *
 * That test builds an in-memory stub repository and asserts on numbers. It had
 * nothing to do with the PR it failed, and neither did the next one, in another
 * shard, in another file. A timeout rather than a wrong assertion, on a random
 * test, is the signature of this and not of a product bug.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUSE, DO NOT RESOLVE
 *
 * The connection is refused here, before any name resolution, so the call fails
 * in microseconds instead of waiting on a resolver. Callers see an ordinary
 * socket error, which is what they already handled — that is why these tests
 * passed. So this removes the stall without changing what any test asserts.
 *
 * It also makes the suite FASTER: every DNS lookup and TCP handshake the gate
 * was performing is now skipped.
 *
 * This is a floor, not a licence. A unit test that needs a reply should mock
 * its seam — for Supabase, `jest.mock('@/lib/supabaseServer', ...)`, which 259
 * test files already do. Reaching a live endpoint is integration work, and
 * integration tests have their own home below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS STILL ALLOWED
 *
 *   - Loopback, so a test may talk to a server it started itself.
 *   - Unix sockets and Windows named pipes, which cannot leave the machine.
 *   - `tests/plugins/integration-tests/`, which exists to call live APIs with
 *     real credentials. It is already outside the PR gate
 *     (`jest.gate.config.js`) and runs only where those credentials are set.
 *   - Anything, when ALLOW_TEST_NETWORK=1 — an escape hatch for diagnosing a
 *     live service by hand, never for CI.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COUNTING THE REFUSALS, SO THEY CAN BE DRIVEN OUT
 *
 * A refusal is silent by design (above), so the suites that still leak never
 * announce themselves. When NO_NETWORK_RECORD_DIR is set, every refusal is
 * also APPENDED to a file there, and `.github/ci/jest-gate-check.mjs` (G8)
 * fails the gate when the total across shards exceeds a ceiling that may only
 * ratchet down. Unset — which is every developer machine — nothing is written
 * and this file behaves exactly as it did before.
 *
 * The gate deliberately accuses no TEST. It cannot: this guard installs once
 * per worker (see ONE INSTALL, MANY SANDBOXES below), so a socket opened by a
 * promise an earlier file left floating is charged to whichever file happens to
 * be running when it opens. An earlier attempt to fail the running case did
 * exactly that to an innocent suite, and a failure pointing at the wrong file
 * is the original sin of this whole bug class. So the count gates and the
 * attribution only informs — which is why the two attribution fields below are
 * NAMED for their own unreliability. To attribute a refusal beyond doubt, run
 * the one suite alone (`npm run test:leaks -- <path>`): with no predecessor in
 * the worker there is nothing to inherit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* `node:` prefixed: this patches the CORE module's prototype, which is shared
   by every test file a worker runs, and that is the whole premise below. */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/** Where the live-API tests live. Exempt, by design. */
const INTEGRATION_TESTS = 'tests/plugins/integration-tests/';

/*
 * The guard's OWN test opens connections deliberately, to prove this file
 * refuses them. They are still refused — that is what it asserts — but they are
 * not COUNTED, or the ceiling would be measuring the guard's own test instead
 * of the suite's leaks. Matched on the file name alone, so the path separator
 * does not matter.
 *
 * Residual, and in the safe direction: a socket inherited from the file that
 * ran immediately before the guard's test is exempted too, so the count can
 * under-report by a hair. Under-reporting errs toward not failing the gate.
 */
const GUARDS_OWN_TEST = 'jest-no-network.guard.test';

/*
 * Lifts the exemption above, and nothing else.
 *
 * It exists so the guard's own test can prove the recorder works END TO END on
 * its own refusals, which it otherwise cannot: it is the one file exempt from
 * recording. The alternative was to impersonate a non-exempt file by swapping
 * `__currentSandbox`, and that was measured to be worse than the problem — a
 * socket inherited from an earlier file in the worker, opening inside the
 * impersonation window, was charged to the fake identity and written to the
 * REAL record directory in two runs out of three, putting phantom counts into
 * the number the gate ratchets on.
 *
 * It never changes whether a connection is refused, only whether a refusal is
 * counted, so it cannot let a test reach the network.
 *
 * DELIBERATELY NOT reported in the shard marker, unlike ALLOW_TEST_NETWORK,
 * and the asymmetry is the point: ALLOW_TEST_NETWORK can HIDE leaks, so G8 has
 * to know whether it was set. This one can only ever add records, so if it
 * leaked into CI the gate would go red — a false alarm, never a silent pass.
 * Adding it to the marker would buy nothing and imply it were dangerous.
 */
const RECORD_GUARDS_OWN_TEST = 'NO_NETWORK_RECORD_GUARDS_OWN_TEST';

/**
 * How many refusals one worker will record before it stops.
 *
 * A leaked read contributes exactly ONE refusal here — measured in isolation
 * and repeated — and the REASON matters more than the number, because it is
 * not a property anyone should assume stays true.
 *
 * `lib/supabaseFetch.ts` looks like it should treble the count: it classifies
 * ECONNREFUSED as transient and retries a GET twice, 50 ms then 150 ms. Under
 * Jest it never retries at all. `isTransientConnectionError` opens with
 * `error instanceof Error`, and undici builds `TypeError: fetch failed` with
 * the HOST realm's `Error` while a test runs in Jest's own sandbox realm — so
 * that check is false even though `cause.code` really is ECONNREFUSED, and the
 * retry is skipped. In production it fires; in the gate it does not. Measured
 * warm, a retryable GET and a non-retryable POST cost the same (~25 ms vs
 * ~24 ms), which is what a skipped retry looks like; an earlier 347 ms vs
 * 34 ms pair that suggested otherwise was the ~250 ms one-time undici
 * initialisation charged to whichever call ran first.
 *
 * So do NOT read one-per-leak as a stable law. If that `instanceof` is ever
 * corrected, or sandbox realms stop differing, an awaited leaked read becomes
 * up to THREE refusals. Pin the ceiling from the maximum of several CI runs
 * with a margin, as `$refusalsComment` in the quarantine file requires.
 *
 * For the same reason the count is not a leak COUNT. Every leak contributes at
 * least one, so driving it to zero is exactly right — but a ratchet from 9 to 3
 * must not be read as six leaks fixed.
 *
 * The cap is for the case that obeys none of this: a pathological loop could
 * otherwise turn this into a hundred thousand synchronous writes. After
 * `MAX_RECORDS_PER_WORKER` real records the worker writes one `truncated`
 * record and stops; G8 FAILS on it, because a count that is known to be
 * incomplete must never read as a pass.
 *
 * Per WORKER, not per file, though this module is re-run for every test file:
 * the counter that matters belongs to the module instance of whichever file
 * installed the guard, because that is the one the closure below captured. The
 * later instances are created and never used.
 */
const MAX_RECORDS_PER_WORKER = 500;

/*
 * This file is `tests/jest-no-network.ts`, so the repo root is its parent.
 * Taken from `__dirname` rather than `process.cwd()`, which a worker is under
 * no obligation to set to the root.
 */
const REPO_ROOT = path.resolve(__dirname, '..');

let recordsWritten = 0;

/**
 * The repo frames of the stack that opened the socket.
 *
 * This is the one part of a record that is not a guess: it is the code path
 * that actually made the call, whoever "owns" it. It does not reach the calling
 * test — the socket opens on an undici continuation, so the frames stop at the
 * transport (for Supabase, `lib/supabaseFetch.ts`) — but it does say WHICH
 * transport, which separates a Supabase leak from an LLM one at a glance.
 *
 * `node_modules` and this file's own frame are dropped; everything left is the
 * repo's. The limit is raised around the capture because a stack is sliced to
 * `Error.stackTraceLimit` frames and something upstream may have lowered it —
 * measured at 100 here, but a zero would silently reduce every record to
 * nothing, which is how a diagnostic rots without anyone noticing.
 */
function repoFrames(root: string): string[] {
  const limit = Error.stackTraceLimit;
  try {
    /*
     * Negated rather than `limit < 30`, so a limit that is not a number raises
     * it too. `undefined < 30` is false, and V8 then captures no stack at all
     * — the exact rot the paragraph above defends against, let through by the
     * guard meant to prevent it.
     */
    if (!(limit >= 30)) Error.stackTraceLimit = 30;
    const raw = new Error('network').stack ?? '';
    return raw
      .split('\n')
      .slice(1)
      .filter(line => line.includes(root) && !line.includes('node_modules'))
      /* Normalise BEFORE filtering by file, so one spelling is matched. */
      .map(line => line.trim().replace(root, '').replace(/\\/g, '/').replace(/\(\/+/, '('))
      /* This file's own frame is never a lead — it is where every one of them
         passes through. Matched exactly, so the guard's TEST still shows up. */
      .filter(line => !line.includes('(tests/jest-no-network.ts:'))
      .slice(0, 8);
  } catch {
    return [];
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** This worker's own file, so concurrent appends cannot interleave a line. */
function fileFor(dir: string, kind: 'refusals' | 'alive'): string {
  const worker = process.env.JEST_WORKER_ID ?? '0';
  return path.join(dir, `${kind}-w${worker}-${process.pid}.${kind === 'alive' ? 'json' : 'jsonl'}`);
}

/**
 * Append one refusal to this worker's own file.
 *
 * Every failure here is swallowed. A test's outcome must not depend on whether
 * a diagnostic file could be written — but a swallowed write must not be able
 * to look like a clean run either, which is what `announceRecording` below is
 * for. The counter is incremented only after a write that succeeded, so the cap
 * counts records that exist rather than attempts — which does mean an
 * unwritable directory retries the append once per refusal forever, bounded
 * only by the refusals themselves. Theoretical: `announceRecording` writes to
 * the same directory at install, so G8 already fails a run that could not
 * write there.
 */
function record(dir: string, entry: Record<string, unknown>): void {
  try {
    if (recordsWritten > MAX_RECORDS_PER_WORKER) return;

    /* One sentinel in place of the record that would have exceeded the cap. */
    const line = JSON.stringify(
      recordsWritten === MAX_RECORDS_PER_WORKER ? { truncated: true } : entry
    );

    fs.appendFileSync(fileFor(dir, 'refusals'), line + '\n');
    recordsWritten++;
  } catch {
    /* never let the diagnostic change a test result */
  }
}

/**
 * Say, once per worker, that the recorder is actually running.
 *
 * Without this, a run in which the recorder never recorded is indistinguishable
 * from a run with no leaks: both are zero records, and G8 would read the second
 * meaning and pass. The shard's own marker cannot close that gap, because it is
 * written by the workflow and only proves the workflow MEANT to record — it is
 * one renamed environment variable, one edit to `setupFiles`, or one unwritable
 * directory away from being a lie, and `record` swallows that last case by
 * design.
 *
 * So the proof comes from the guard itself, in the same directory, and by the
 * same filesystem write the records depend on. Every shard runs at least one
 * worker, so G8 requiring one of these per shard means zero can only mean the
 * recorder never ran — which it then fails on.
 */
function announceRecording(dir: string): void {
  try {
    fs.writeFileSync(
      fileFor(dir, 'alive'),
      JSON.stringify({ worker: process.env.JEST_WORKER_ID ?? '0', pid: process.pid }) + '\n'
    );
  } catch {
    /* the absence IS the signal; G8 fails closed on it */
  }
}

/**
 * Destinations that cannot leave this machine.
 *
 * An absent host means a Unix socket or named pipe rather than a hostname, so
 * there is nothing to resolve and nothing to reach.
 */
function staysOnThisMachine(host: string | undefined): boolean {
  if (!host) return true;

  /*
   * Brackets come off an IPv6 literal, and `::ffff:` off loopback written as an
   * IPv4-mapped IPv6 address — `::ffff:127.0.0.1` is 127.0.0.1 and matches
   * neither `::1` nor the IPv4 test below without this.
   */
  const h = host
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/^::ffff:/, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h === '::' ||
    /^127\./.test(h)
  );
}

/**
 * The destination of a `socket.connect(...)` call.
 *
 * Three signatures to read: an options object, `(port, host?)`, and a path for
 * IPC. `(port)` with no host means localhost, which Node also defaults to.
 */
function destinationOf(args: unknown[]): { host?: string; port?: number } {
  let first = args[0];

  /*
   * `net.connect(...)` normalises its arguments into `[options, callback]` and
   * hands Socket.prototype.connect that ARRAY, so the options have to be
   * unwrapped before anything can be read off them. Missing this read every
   * such call as "no host given", i.e. localhost, and let it straight through
   * — `tls.connect` passes a plain object and WAS caught, so HTTPS looked
   * guarded while plain TCP was not.
   */
  if (Array.isArray(first)) first = first[0];

  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: string; port?: number; path?: string };
    /*
     * A path is IPC — no host, nothing to reach.
     *
     * Truthiness, deliberately: `http.request`, `https.request` and undici all
     * pass an options bag that HAS a `path` key, holding the URL path or null
     * (`_http_agent` sets `options.path = options.socketPath`, which is
     * undefined for a TCP request). `'path' in options` would therefore treat
     * every HTTP call in the suite as a local socket and allow the lot.
     */
    if (options.path) return {};
    return { host: options.host ?? 'localhost', port: options.port };
  }

  if (typeof first === 'number') {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
  }

  /* connect(path[, callback]) — IPC. */
  return {};
}

/** Just enough of a sandbox global to find the running test's path. */
type Sandbox = {
  expect?: { getState?: () => { testPath?: string; currentTestName?: string } };
};

/**
 * The test file running right now, for the error message.
 *
 * Read at connection time rather than at setup time: `setupFiles` runs before
 * the test framework is installed, so `expect` does not exist yet, and it does
 * by the time anything opens a socket.
 *
 * The sandbox is passed in rather than taken from this module's own `global`,
 * and that is load-bearing — see `__currentSandbox` below.
 */
function currentTestPath(sandbox: Sandbox | undefined): string {
  try {
    return sandbox?.expect?.getState?.()?.testPath ?? 'an unknown test';
  } catch {
    return 'an unknown test';
  }
}

/**
 * `net` is a core module, shared by every test file a worker runs, so this
 * would wrap itself once per file without the marker — and did, while this was
 * being measured: a lookup came back recorded four hundred times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE INSTALL, MANY SANDBOXES
 *
 * The flip side of installing once: the closure belongs to whichever test file
 * installed it, and `jest-environment-node` gives every test file its OWN
 * global. So reading `global.expect` from inside the closure reports the FIRST
 * file the worker happened to run, for every connection afterwards — and this
 * file's error message then names an innocent test:
 *
 *     Blocked a network connection to example.com:443 from
 *       lib/services/__tests__/aCancelledMeetingSaysWhetherItWasSent.guard.test.ts
 *
 * when the call came from somewhere else entirely. That is the original sin of
 * this whole bug class — a failure pointing at the wrong file — reintroduced by
 * the fix for it.
 *
 * So the CURRENT file's global is republished on the shared function object on
 * every run of this module, which is once per test file. Files run one at a
 * time in a worker, so the latest is always the running one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type Connect = typeof net.Socket.prototype.connect;
type Guarded = Connect & {
  __noNetworkGuard?: true;
  __currentSandbox?: Sandbox;
};

const installed: Guarded = net.Socket.prototype.connect;

if (installed.__noNetworkGuard) {
  /* An earlier test file in this worker installed it; just say where we are. */
  installed.__currentSandbox = global as Sandbox;
} else {
  const realConnect = installed;

  const guarded = function (this: net.Socket, ...args: unknown[]) {
    const { host, port } = destinationOf(args);
    const testPath = currentTestPath(guarded.__currentSandbox);

    const exempt =
      process.env.ALLOW_TEST_NETWORK === '1' ||
      testPath.replace(/\\/g, '/').includes(INTEGRATION_TESTS);

    if (exempt || staysOnThisMachine(host)) {
      return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    }

    /*
     * Counted, when a run asked to count. Read from the environment on every
     * refusal rather than captured at install time, because this closure
     * belongs to whichever file installed it and the env var is set for the
     * whole run — and because the guard's own test flips it to prove both
     * states.
     */
    const recordDir = process.env.NO_NETWORK_RECORD_DIR;
    const counts =
      !testPath.includes(GUARDS_OWN_TEST) || process.env[RECORD_GUARDS_OWN_TEST] === '1';
    if (recordDir && counts) {
      let runningCase: string | null = null;
      try {
        runningCase = guarded.__currentSandbox?.expect?.getState?.()?.currentTestName ?? null;
      } catch {
        /* the state is not always readable; the destination still is */
      }

      record(recordDir, {
        destination: `${host}:${port ?? '?'}`,
        /* The call path. Not a guess — see repoFrames. */
        transport: repoFrames(REPO_ROOT),
        /*
         * Named for their unreliability on purpose. One install per worker
         * means an inherited socket is charged to whoever is running, so
         * neither field may be read as "the offender" — see the header. The
         * gate does not read them at all; it reads the count.
         */
        possiblyNotTheOriginFile: testPath
          .replace(REPO_ROOT, '')
          .replace(/\\/g, '/')
          .replace(/^\//, ''),
        possiblyNotTheOriginCase: runningCase,
      });
    }

    const error = Object.assign(
      new Error(
        `Blocked a network connection to ${host}:${port ?? '?'} from ${testPath}. ` +
          'Tests must not reach the network: mock the seam instead — for Supabase, ' +
          "jest.mock('@/lib/supabaseServer', ...). Calls to a live endpoint belong in " +
          `${INTEGRATION_TESTS}. See tests/jest-no-network.ts.`
      ),
      { code: 'ECONNREFUSED', host, port }
    );

    /*
     * Asynchronously, as a real refusal arrives. Throwing from `connect` would
     * reach callers that only ever expected an 'error' event, and the point is
     * to look exactly like the failure these tests already handle.
     *
     * `setImmediate`, NOT `process.nextTick`. The next-tick queue drains before
     * promise continuations, so a caller that attaches its 'error' listener
     * after even one `await` — which undici, `tls` and every promise-wrapped
     * connector do — would never see this one, and Node would raise
     * ERR_UNHANDLED_ERROR and take the Jest worker down. An unrelated suite
     * then goes red, which is the exact failure this file exists to abolish.
     *
     * A real ECONNREFUSED cannot arrive before the next event-loop turn, so
     * next-tick delivery is faster than physically possible and is the one way
     * this can diverge from the failure it is imitating.
     */
    setImmediate(() => this.destroy(error));
    return this;
  } as Guarded;

  guarded.__noNetworkGuard = true;
  guarded.__currentSandbox = global as Sandbox;
  net.Socket.prototype.connect = guarded;

  /* Here, so it happens exactly once per worker — the same place, and the same
     condition, as the install itself. */
  if (process.env.NO_NETWORK_RECORD_DIR) announceRecording(process.env.NO_NETWORK_RECORD_DIR);
}
