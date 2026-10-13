/**
 * The throttle in front of the endpoints that have no login.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The behaviour worth pinning is not "it counts". It is the three judgements:
 *
 *   · failures are counted apart from successes, because a client reloading and
 *     somebody trying keys are not the same measurement and cannot share one
 *     allowance;
 *   · the caller's address is hashed, so this table never becomes a log of who
 *     looked at which invoice;
 *   · a broken counter lets the request through, because a database hiccup must
 *     not take the portal down with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const hit = jest.fn();

jest.mock('@/lib/repositories/RateLimitRepository', () => ({
  rateLimitRepository: { hit: (...a: unknown[]) => hit(...a) },
}));

jest.mock('@/lib/logger', () => {
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';

const requestFrom = (ip?: string) =>
  new Request('http://localhost/api/anything', {
    headers: ip ? { 'x-forwarded-for': ip } : {},
  });

beforeEach(() => {
  hit.mockReset();
  hit.mockResolvedValue({ allowed: true, hits: 1 });
});

/** The key the limiter asked the repository about. */
const keyUsed = () => hit.mock.calls[0][0] as string;

describe('successes and failures are counted apart', () => {
  it('puts a served request in the ok bucket', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    expect(keyUsed()).toMatch(/^ok:portal-read:/);
  });

  it('puts a rejected credential in the fail bucket', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read, 'failure');
    expect(keyUsed()).toMatch(/^fail:portal-read:/);
  });

  it('holds failures to a much tighter allowance', async () => {
    /*
     * The whole point of two buckets. Counted together, the only limit you
     * could set is one loose enough for a client reloading — far too loose to
     * notice somebody working through tokens.
     */
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    const okLimit = hit.mock.calls[0][2];

    hit.mockClear();
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read, 'failure');
    const failLimit = hit.mock.calls[0][2];

    expect(failLimit).toBeLessThan(okLimit);
  });

  it('keeps the two buckets on separate counters for one caller', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    const ok = keyUsed();
    hit.mockClear();
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read, 'failure');
    expect(keyUsed()).not.toBe(ok);
  });
});

describe('who the caller is', () => {
  it('never puts the address in the key', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    expect(keyUsed()).not.toContain('203.0.113.9');
  });

  it('gives one address a stable key', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    const first = keyUsed();
    hit.mockClear();
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    expect(keyUsed()).toBe(first);
  });

  it('gives two addresses different keys', async () => {
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    const first = keyUsed();
    hit.mockClear();
    await rateLimit(requestFrom('198.51.100.4'), 'portal-read', RATE_LIMITS.read);
    expect(keyUsed()).not.toBe(first);
  });

  it('reads the client, not the proxy, from a chained header', async () => {
    // `x-forwarded-for` is client-first; the rest are hops. Keying on a hop
    // would put every client behind that proxy in one bucket.
    await rateLimit(requestFrom('203.0.113.9, 70.41.3.18'), 'portal-read', RATE_LIMITS.read);
    const direct = keyUsed();
    hit.mockClear();
    await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);
    expect(keyUsed()).toBe(direct);
  });

  it('still counts a request with no discoverable address', async () => {
    await rateLimit(requestFrom(), 'portal-read', RATE_LIMITS.read);
    expect(hit).toHaveBeenCalled();
  });
});

describe('when the counter itself is broken', () => {
  it('lets the request through', async () => {
    /*
     * A client must still be able to open their booking and pay their bill.
     * Failing closed here would turn a database hiccup into an outage on the
     * one surface clients actually use.
     */
    hit.mockResolvedValue({ allowed: true, hits: 0, degraded: true });

    const outcome = await rateLimit(requestFrom('203.0.113.9'), 'portal-read', RATE_LIMITS.read);

    expect(outcome.allowed).toBe(true);
    expect(outcome.degraded).toBe(true);
  });
});

describe('what a throttled caller is told', () => {
  it('is refused with 429 and a retry hint, and no detail', async () => {
    const res = tooManyRequests(RATE_LIMITS.write.windowSeconds);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(RATE_LIMITS.write.windowSeconds));
    // Not owed a reason: naming the limit tells a prober what to pace under.
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Too many requests' });
  });
});

describe('the allowances themselves', () => {
  it('are tightest where a stranger creates something', async () => {
    /*
     * Reads are a page load. Writes are a thing a client does once. Creating
     * an account or putting a file in storage costs the business, so it is the
     * tightest of the three.
     */
    expect(RATE_LIMITS.create.limit).toBeLessThan(RATE_LIMITS.write.limit);
    expect(RATE_LIMITS.write.limit).toBeLessThan(RATE_LIMITS.read.limit);
  });

  it('give every shape a failure budget below its success budget', () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.failureLimit).toBeLessThanOrEqual(rule.limit);
      expect(rule.windowSeconds).toBeGreaterThan(0);
    }
  });
});
