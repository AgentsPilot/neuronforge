/**
 * The two ways a public booking can be written and still tell the client nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Both failures below were invisible to every other kind of test: the booking
 * row is correct, the service layer is correct, and the unit tests of both pass.
 * What broke was the wiring of the route around them, so this reads the source.
 *
 *   1. A FREE VARIABLE. `smartLinkRepository` lost its import in a tidy-up and
 *      kept its only call site. `resolveVisitorSessionId()` always returns an
 *      id, so every booking from `/site/{subdomain}/book` reached that line and
 *      threw `ReferenceError` — after the row was written and the confirmation
 *      dispatched. The catch returned 500, so the client was told the booking
 *      failed for a booking that exists.
 *
 *   2. WORK THAT OUTLIVES ITS REQUEST. The confirmation and the intake request
 *      were dispatched as bare promises and the response returned underneath
 *      them. A serverless invocation is frozen when it responds, so the email,
 *      the intake request and the CRM activity were dropped together with
 *      nothing rejecting and nothing logged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTES = join(__dirname, '..');

const CREATE = readFileSync(join(ROUTES, 'create', 'route.ts'), 'utf8');
const FINALIZE = readFileSync(join(ROUTES, 'finalize', 'route.ts'), 'utf8');

describe('a repository the route calls is a repository the route imports', () => {
  /**
   * Every `xRepository.` call in the file must have an import naming it. A
   * missing import is a ReferenceError at the moment it is reached, which for
   * this one was every booking made on a published site.
   */
  it.each([
    ['create', CREATE],
    ['finalize', FINALIZE],
  ])('%s imports every repository it calls', (_name, source) => {
    const called = new Set(
      [...source.matchAll(/\b([a-z][A-Za-z0-9]*Repository)\s*\n?\s*\./g)].map(m => m[1])
    );

    for (const identifier of called) {
      expect(source).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`)
      );
    }
  });
});

describe('the client hears about their own booking before the request ends', () => {
  it.each([
    ['create', CREATE],
    ['finalize', FINALIZE],
  ])('%s awaits the confirmation email rather than firing it off', (_name, source) => {
    // The send has to be inside an awaited expression. Matching the old shape
    // is what catches a revert: `sendBookingConfirmation(...).catch(...)` with
    // the response returned underneath it.
    expect(source).toContain('await Promise.allSettled([');
    expect(source).toMatch(/await Promise\.allSettled\(\[[\s\S]*?sendBookingConfirmation/);
    expect(source).not.toMatch(/sendBookingConfirmation\([\s\S]{0,400}?\)\s*\n?\s*\.catch\(/);
  });
});
