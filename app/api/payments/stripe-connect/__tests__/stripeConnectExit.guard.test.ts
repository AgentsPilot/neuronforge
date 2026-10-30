/**
 * Source guard: the Stripe Connect exit routes keep their shape (self-service
 * exit SX-5 / D5; SA W-18, kept minimal on purpose).
 *
 * The behaviour (Stripe first, rows only on a confirmed release, refusals
 * change nothing) is proved by the two route tests. This pins only what a
 * later edit could quietly undo without any of those tests noticing:
 *
 *   - Delete goes through `releaseConnectedAccount` and `checkConnectExit`,
 *     and never reaches Stripe directly (`getStripeService`), which is how the
 *     old swallowed `accounts.del` came about (K-4).
 *   - Neither route reads a request body.
 *   - Disconnect runs the check before its update (BQ-12).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = (route: string) => readFileSync(join(__dirname, '..', route, 'route.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The code with comments removed, so the header's words cannot satisfy or trip the guard. */
const code = (route: string) => source(route).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Stripe Connect exit routes', () => {
  const remove = code('delete');
  const disconnect = code('disconnect');

  it('are actually reading the routes', () => {
    expect(remove).toContain("createLogger({ module: 'StripeConnectDelete' })");
    expect(disconnect).toContain("createLogger({ module: 'StripeConnectDisconnect' })");
  });

  it('delete releases through the D5 modules, never through StripeService directly', () => {
    expect(remove).toMatch(/import \{[^}]*\breleaseConnectedAccount\b[^}]*\} from '@\/lib\/business-os\/account-deletion\/connectRelease'/);
    expect(remove).toMatch(/import \{[^}]*\bcheckConnectExit\b[^}]*\} from '@\/lib\/business-os\/account-deletion\/connectExitGuard'/);
    expect(remove).not.toContain('getStripeService');
    expect(remove).not.toContain('deleteConnectedAccount');
  });

  it('neither route reads a request body', () => {
    for (const route of [remove, disconnect]) {
      expect(route).not.toContain('request.json(');
      expect(route).not.toContain('request.text(');
      expect(route).not.toContain('request.formData(');
    }
  });

  it('disconnect checks for running client plans before it updates the record', () => {
    const check = disconnect.indexOf("checkConnectExit(");
    const update = disconnect.indexOf('.update(');
    expect(check).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(check);
  });
});
