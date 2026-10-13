/**
 * A client opening a link from an email must not compile the email system.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS COMING BACK
 *
 * `generateBookingToken` and `verifyBookingToken` used to live in
 * `BookingEmailService` — 38 static imports: every email template, five
 * repositories, the mail transport, the intake resolver. `portalAccess` and
 * `publicBranding` need the verify half, and they are reached by EVERY public
 * page: the portal, an invoice, a quote, a cancel link, an intake form.
 *
 * Measured before the split, on the portal layout: 96 first-party modules and
 * 34,243 lines of source reachable, 27,647 of them arriving through that one
 * import. Four fifths of a page's server graph, for an HMAC over two strings.
 * After: 51 modules and 13,970 lines.
 *
 * Two ways that regresses, and this guards both:
 *
 *   1. somebody adds an import to `bookingToken.ts` — it is a leaf, and
 *      anything added to it is added to every public page on the platform;
 *   2. a public module goes back to importing the token from
 *      `BookingEmailService`, which still re-exports it so that every OTHER
 *      call site kept working. The re-export is a compatibility shim, not an
 *      invitation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every `from '…'` specifier in a source file. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g)]
    .map(m => m[1]);
}

describe('bookingToken is a leaf', () => {
  const source = read('lib/services/bookingToken.ts');

  it('imports jsonwebtoken and nothing else', () => {
    expect(importsOf(source)).toEqual(['jsonwebtoken']);
  });

  it('still carries both halves of the contract', () => {
    expect(source).toContain('export function generateBookingToken');
    expect(source).toContain('export function verifyBookingToken');
  });

  /*
   * The property the whole split exists for. A secret read at module load
   * would make an unconfigured environment fail on IMPORT — which, now that
   * every public page imports this, would take the public surface down rather
   * than one email.
   */
  it('reads the secret lazily, not at import', () => {
    expect(source).toMatch(/function bookingTokenSecret\(\): string \{/);
    expect(source).not.toMatch(/^const\s+\w*SECRET\w*\s*=\s*process\.env/m);
  });
});

describe('the public surface does not reach the email service', () => {
  /*
   * The modules a client's browser causes to be compiled. `portalAccess` and
   * `publicBranding` are the two that made this everybody's problem: they are
   * imported by every public page, so their graph is every public page's graph.
   */
  const PUBLIC_SURFACE = [
    'lib/security/portalAccess.ts',
    'lib/branding/publicBranding.ts',
    'app/book/manage/[token]/layout.tsx',
    'app/api/book/manage/[token]/route.ts',
    'app/proposal/[token]/page.tsx',
  ];

  it.each(PUBLIC_SURFACE)('%s takes the token from the leaf', path => {
    const source = read(path);

    expect(source).not.toMatch(/from ['"]@\/lib\/services\/BookingEmailService['"]/);
    expect(source).toMatch(/from ['"]@\/lib\/services\/bookingToken['"]/);
  });
});

describe('the compatibility shim', () => {
  const source = read('lib/services/BookingEmailService.ts');

  /*
   * A dozen call sites import the token from here. The split was about weight,
   * not about renaming a function, so both names stay reachable.
   */
  it('still re-exports both names for the call sites that had them', () => {
    expect(source).toContain('export { generateBookingToken, verifyBookingToken }');
  });

  /*
   * And imports them too. A bare `export … from` re-exports without binding
   * locally, and this file MINTS tokens in eight places — the same class of
   * bug as a helper used twelve times and never imported, which `ignoreBuildErrors`
   * in next.config.js would have let ship.
   */
  it('imports them as well, because it uses them itself', () => {
    expect(source).toContain("import { generateBookingToken, verifyBookingToken } from './bookingToken';");
    expect(source).toMatch(/generateBookingToken\(bookingId, clientEmail\)/);
  });

  it('no longer signs anything itself', () => {
    expect(source).not.toContain("from 'jsonwebtoken'");
    expect(source).not.toMatch(/jwt\.(sign|verify)\(/);
  });
});
