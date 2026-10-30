/**
 * An automation acts as the owner who installed it, and as nobody else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHAIN, AND THE ONE LINK THAT IS NOT WRITTEN YET.
 *
 *   agents.user_id            written by `installAutomation` from the caller's
 *                             own session. A caller cannot supply it.
 *   → pilot.execute(a, userId)  the runner reads it off the row
 *   → context.userId          carried through every step
 *   → pluginExecuter.execute(userId, …)
 *   → connection.user_id      the synthetic connection a system plugin gets
 *   → BusinessOsPluginExecutor  "the ONLY source of tenant scoping.
 *                             Deliberately not read from parameters."
 *   → runBusinessQuery({ userId })  every row filtered
 *
 * Verified live: the same plan step run through the real plugin executor for
 * two accounts returned 4 rows and 5 rows with NO row in common.
 *
 * The link not yet written is the runner, which is parked. So this pins the
 * two halves that exist and the shape the runner must use, because the whole
 * chain rests on one argument being the agent row's own `user_id` — and an
 * agent that ran as the wrong owner would write to a stranger's clients.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

describe('the install stamps the owner', () => {
  const install = readFileSync(
    join(root, 'lib', 'business-os', 'automations', 'install.ts'),
    'utf-8'
  );

  it('takes the user from its own argument, never from the automation', () => {
    /* `installAutomation(userId, automation, cadence)`. The catalogue entry
       carries a plan and a schedule and has no idea whose business it is. */
    expect(install).toContain('user_id: userId');
  });

  it('and the API never lets a caller name somebody else', () => {
    const route = readFileSync(
      join(root, 'app', 'api', 'business-os', 'automation-agents', 'route.ts'),
      'utf-8'
    );

    /* Every call passes the session's own user. A `userId` in the body would
       be the whole of a cross-tenant install. */
    /* Whitespace-insensitive: the call grew a fourth argument and Prettier
       wrapped it across lines. The point is the FIRST argument. */
    expect(route.replace(/\s+/g, ' ')).toContain('installAutomation( user.id,');
    expect(route).not.toMatch(/userId: z\./);
  });
});

describe('the plugin refuses to act for nobody', () => {
  const executor = readFileSync(
    join(root, 'lib', 'server', 'business-os-plugin-executor.ts'),
    'utf-8'
  );

  it('reads the tenant from the connection, not the parameters', () => {
    /*
     * The line this rests on. Parameters come from a plan, and a plan is data:
     * if the tenant could be named there, a committed steps file — or anything
     * that edited one — could read another business's clients.
     */
    expect(executor).toContain('const userId: string | undefined = connection?.user_id');
    expect(executor).toMatch(/refusing to run unscoped/);
  });

  it('throws rather than defaulting when there is none', () => {
    const guard = executor.slice(
      executor.indexOf('const userId: string | undefined'),
      executor.indexOf('const parsed = this.parseActionName')
    );

    expect(guard).toContain('throw new Error');
    /* No fallback of any kind: not a system user, not an empty string. */
    expect(guard).not.toMatch(/\?\?|\|\|/);
  });
});
