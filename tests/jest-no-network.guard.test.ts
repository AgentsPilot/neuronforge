/**
 * The no-network guard installed by `tests/jest-no-network.ts`.
 *
 * Every case here pins a property whose quiet regression brings back the
 * intermittent 5000 ms timeouts the guard was written for — and two of them
 * pin a bug this file already caught once.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

import { blankStringLiterals, stripComments } from '@/tests/helpers/source-scan';

/** Attempt one connection and report how it ended, without throwing. */
function attempt(options: net.NetConnectOpts): Promise<{
  connected: boolean;
  error?: NodeJS.ErrnoException;
}> {
  return new Promise(resolve => {
    const socket = net.connect(options);
    socket.once('connect', () => {
      socket.destroy();
      resolve({ connected: true });
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve({ connected: false, error });
    });
  });
}

describe('the Jest no-network guard', () => {
  it('refuses a connection that would leave this machine, and says which test tried', async () => {
    const started = Date.now();
    const { connected, error } = await attempt({ host: 'example.com', port: 443 });

    expect(connected).toBe(false);
    expect(error?.code).toBe('ECONNREFUSED');
    expect(error?.message).toContain('Blocked a network connection to example.com:443');
    /*
     * The message has to name the offending test. The whole reason this class
     * of bug survived so long is that the failure surfaced in an unrelated
     * file, in an unrelated shard, as a bare timeout.
     */
    expect(error?.message).toContain('jest-no-network.guard.test.ts');
    /* And it has to point at the fix, for whoever meets it first. */
    expect(error?.message).toContain("jest.mock('@/lib/supabaseServer'");

    /*
     * No name was resolved and no handshake attempted, so this is microseconds.
     *
     * The ceiling is deliberately far above that. The only thing this needs to
     * tell apart is "refused instantly" from "waited on a resolver", and the
     * resolver timeout being guarded against is ~5 s — so anything comfortably
     * under that settles it. A tight bound would instead make THIS test the
     * flake, failing on a loaded runner for want of CPU rather than for any
     * network wait, which is the whole bug class in miniature.
     */
    expect(Date.now() - started).toBeLessThan(3000);
  });

  /**
   * The guard is installed ONCE per worker, but every test file gets its own
   * sandbox global — so the pointer it reads `expect.getState()` through has to
   * be republished for each file. Stale, and the message names whichever suite
   * the worker happened to run first, sending the next reader to an innocent
   * file. That is this whole bug class in miniature, so it is pinned directly:
   * the assertion above only catches it when another file installed the guard
   * first, which depends on worker scheduling.
   */
  it('reads the running test from this file, not the one that installed it', () => {
    const connect = net.Socket.prototype.connect as typeof net.Socket.prototype.connect & {
      __currentSandbox?: unknown;
    };

    expect(connect.__currentSandbox).toBe(globalThis);
  });

  /**
   * The refusal must arrive no earlier than a real one could.
   *
   * `process.nextTick` drains before promise continuations, so a listener
   * attached after an `await` — undici, `tls` and every promise-wrapped
   * connector do exactly that — would miss it, Node would raise
   * ERR_UNHANDLED_ERROR, and the Jest WORKER would die, reddening whatever
   * unrelated suite it was running. This test fails outright in that case
   * rather than merely asserting something weaker.
   */
  it('still reaches a listener attached after an await', async () => {
    const socket = net.connect({ host: 'example.com', port: 443 });
    await Promise.resolve();

    const error = await new Promise<NodeJS.ErrnoException>(resolve => {
      socket.once('error', resolve);
    });
    socket.destroy();

    expect(error.code).toBe('ECONNREFUSED');
  });

  it('keeps refusing on a second attempt, so one install stays the install', async () => {
    const first = await attempt({ host: 'example.com', port: 443 });
    const second = await attempt({ host: 'example.org', port: 80 });

    expect(first.connected).toBe(false);
    expect(second.connected).toBe(false);
    expect(second.error?.message).toContain('Blocked a network connection to example.org:80');
  });

  /**
   * The refusal COUNT is what the gate holds to a ceiling (G8 in
   * .github/ci/jest-gate-check.mjs), and one property of the recorder decides
   * whether that ceiling can be trusted at all: the record directory has to be
   * read on EVERY refusal, never captured once when the guard installs.
   *
   * Hoisting that read to module scope would read as a harmless tidy-up and
   * would silently stop the counting partway through every worker. Measured
   * 2026-11-04: the guard installs ONCE per worker, from whichever test file
   * ran first, and `jest-environment-node` gives every test file its own
   * `process` — including its own `process.env`, which it EMPTIES at teardown
   * (probed directly: the installing file's env object has 0 keys once that
   * file has finished). A captured directory would therefore come from an
   * object that no longer holds anything, so every refusal after the first
   * file in the worker would go unrecorded and the total would read LOW — the
   * direction that makes a ceiling pass when it should fail.
   *
   * ── Why a source scan and not a behavioural test ──────────────────────────
   * The guard reads the PROCESS environment, and a test file's `process.env`
   * is a private copy, so a test cannot switch recording on or off for the
   * installed closure at all. That is measured, not assumed: the first version
   * of this case set `NO_NETWORK_RECORD_DIR` and
   * `NO_NETWORK_RECORD_GUARDS_OWN_TEST` from here and asserted its own records
   * — which passed only when this file happened to install the guard, i.e.
   * when run alone, and failed on CI where it does not. The override works
   * when set from OUTSIDE the run, which is the only place it can be set.
   *
   * Recording is proven end to end where it genuinely can be: G8 requires an
   * `alive-*` proof-of-life from every shard and prints the real destinations
   * it recorded, and `npm run test:leaks -- <path>` drives the same path with
   * the environment set by the parent process.
   *
   * A scan pins the shape, not the behaviour. It is the honest half of the
   * proof, and it is the half that catches the regression described above.
   */
  it('reads the record directory on every refusal, not once at install', () => {
    const source = fs.readFileSync(path.join(__dirname, 'jest-no-network.ts'), 'utf8');
    /* Comments discuss these names constantly; blank the literals too, so no
       mention inside a string can satisfy an assertion below (D-Q1). */
    const scaffold = blankStringLiterals(stripComments(source));

    const guardedAt = scaffold.indexOf('const guarded = function');
    expect(guardedAt).toBeGreaterThan(0);

    const beforeTheClosureExists = scaffold.slice(0, guardedAt);
    const insideAndAfter = scaffold.slice(guardedAt);

    /* Read per refusal... */
    expect(insideAndAfter).toContain('process.env.NO_NETWORK_RECORD_DIR');
    /* ...and never read into a variable before the closure that uses it. */
    expect(beforeTheClosureExists).not.toContain('process.env.NO_NETWORK_RECORD_DIR');

    /*
     * The exemption is decided per refusal for the same reason, and so is its
     * override — a captured `counts` would freeze the first file's answer for
     * every file after it.
     */
    expect(insideAndAfter).toContain('testPath.includes(GUARDS_OWN_TEST)');
    expect(insideAndAfter).toContain('process.env[RECORD_GUARDS_OWN_TEST]');
  });

  it('leaves loopback alone, so a test can reach a server it started itself', async () => {
    const server = net.createServer(socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as net.AddressInfo;

    try {
      const { connected } = await attempt({ host: '127.0.0.1', port });
      expect(connected).toBe(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('treats loopback written as an IPv4-mapped IPv6 address as loopback', async () => {
    const server = net.createServer(socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as net.AddressInfo;

    try {
      const { connected, error } = await attempt({ host: '::ffff:127.0.0.1', port });
      /*
       * Whether the stack dials it is the platform's business; the guard's
       * business is not to refuse it.
       */
      expect(error?.message ?? '').not.toContain('Blocked a network connection');
      expect(connected || error?.code !== undefined).toBe(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  /**
   * IPC carries no hostname, so there is nothing to resolve and nothing to
   * reach — and this is the one branch whose regression is INVISIBLE: break it
   * the other way and every HTTP call in the suite is waved through as a local
   * socket while everything still passes.
   */
  it('does not block a Unix socket or named pipe', async () => {
    const path =
      process.platform === 'win32'
        ? '\\\\.\\pipe\\jest-no-network-absent'
        : '/tmp/jest-no-network-absent.sock';

    const { connected, error } = await attempt({ path });

    /* Nothing is listening there, so it fails — but from the OS, not from us. */
    expect(connected).toBe(false);
    expect(error?.message ?? '').not.toContain('Blocked a network connection');
  });
});
