/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://neuronforge-kohl.vercel.app/business-os/website"}
 */

/**
 * The address a CLIENT COMPONENT hands out, which is not the one the server does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: the smart-link preview showed a `localhost` link on the live site.
 *
 * Everything in `origins.ts` already refuses a loopback address on a deployed
 * build. It just could not tell it was on one. The detection reads Vercel's
 * system variables, and in the browser only the `NEXT_PUBLIC_` copies exist —
 * inlined at build time, and only when the project has "Automatically expose
 * System Environment Variables" switched on. It is a checkbox. Nothing in the
 * code can see whether it was ticked.
 *
 * With it off, `VERCEL` and `VERCEL_ENV` are server-only and simply absent in
 * the browser, so the deployment is undetectable there, the configured
 * `http://localhost:3000` is treated as usable, and every address built in a
 * client component points at the machine of whoever configured it. Server-
 * rendered addresses stayed correct the whole time, which is why only the two
 * client components — the share guide and the lead-capture links — were wrong.
 *
 * A browser never has to deduce this: it was loaded FROM the address, so
 * `window.location.origin` is the answer rather than an inference.
 *
 * WHY THIS FILE IS SEPARATE. `origins.test.ts` runs under the `node`
 * environment, where `window` does not exist and the rule can never fire — so
 * every assertion here would be vacuous there. The environment is the subject,
 * not an incidental.
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe('platformOrigin, in a browser on a real deployment', () => {
  const ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ENV };
    /*
     * Deliberately absent: `VERCEL`, `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`.
     * That IS the condition being reproduced — a real deployment that the
     * browser cannot identify as one.
     */
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_VERCEL_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = ENV;
  });

  const origins = () => require('../origins');

  it('ignores a configured localhost and uses the page it is served from', () => {
    // The exact misconfiguration: the variable copied out of `.env.local`.
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    expect(origins().platformOrigin()).toBe('https://neuronforge-kohl.vercel.app');
  });

  it('so a smart link is one a client can actually open', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    // What the preview renders. It read `localhost:3000/go/1el7ye`.
    expect(origins().platformUrl('/go/1el7ye')).toBe(
      'https://neuronforge-kohl.vercel.app/go/1el7ye'
    );
  });

  it('uses the page when nothing is configured at all', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    /*
     * Better than the production constant, which the module's own comments
     * record as not being served yet — that would swap an unreachable address
     * for a different unreachable address, which is harder to notice.
     */
    expect(origins().platformOrigin()).toBe('https://neuronforge-kohl.vercel.app');
  });

  it('but never overrules a real configured domain', () => {
    /*
     * The canonical host still wins. A business may serve this app from one
     * address and reach it by another, and links it hands to clients should
     * carry the canonical one. The new rule corrects only what is always
     * wrong — a loopback, or nothing — and leaves every deliberate
     * configuration alone.
     */
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.agentspilot.ai';

    expect(origins().platformOrigin()).toBe('https://app.agentspilot.ai');
  });

  it('and a preview still prefers its own deployment host', () => {
    // Rule 2 is unchanged: where the browser CAN see it is a preview, that
    // outranks configuration, because no single configured value is right for
    // every preview deployment.
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_VERCEL_URL = 'neuronforge-abc123-scope.vercel.app';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.agentspilot.ai';

    expect(origins().platformOrigin()).toBe('https://neuronforge-abc123-scope.vercel.app');
  });
});
