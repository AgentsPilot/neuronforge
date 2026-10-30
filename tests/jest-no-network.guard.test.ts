/**
 * The no-network guard installed by `tests/jest-no-network.ts`.
 *
 * Every case here pins a property whose quiet regression brings back the
 * intermittent 5000 ms timeouts the guard was written for — and two of them
 * pin a bug this file already caught once.
 */

import net from 'node:net';

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
