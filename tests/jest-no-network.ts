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
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* `node:` prefixed: this patches the CORE module's prototype, which is shared
   by every test file a worker runs, and that is the whole premise below. */
import net from 'node:net';

/** Where the live-API tests live. Exempt, by design. */
const INTEGRATION_TESTS = 'tests/plugins/integration-tests/';

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
type Sandbox = { expect?: { getState?: () => { testPath?: string } } };

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
}
