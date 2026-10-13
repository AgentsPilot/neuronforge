/**
 * A URL that is a credential is treated like one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four client-facing surfaces carry a secret in the PATH — the booking portal,
 * an invoice, a quote, a consent confirmation. None of them has a login; the
 * link IS the authorisation. Two consequences follow, and both were half done.
 *
 * 1. The path must not travel in a `Referer` header. The portal renders the
 *    business's own website and social links, so following a link off the page
 *    is a thing clients do from a page whose URL opens their booking. Modern
 *    browsers default to `strict-origin-when-cross-origin` and withhold the
 *    path, but that is a default, not a guarantee — it does not bind older
 *    browsers or embedded webviews. `no-referrer` closes it by construction,
 *    and was already the decision for `/invite`.
 *
 * 2. Every surface that serves the same record must apply the SAME access
 *    rule. `/api/public/invoice/[id]/intent` hands out a Stripe client secret;
 *    an endpoint more permissive than the document it serves is the way in,
 *    whatever the page does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('the paths that are credentials never leak in a Referer', () => {
  /*
   * RAW, not comment-stripped.
   *
   * `codeOf` pairs `/*` with the next `*​/`, and middleware.ts contains
   * `// - Public website routes (/site/*)` — a comment opener inside a LINE
   * comment. The stripper swallowed fifty-six lines of real code after it,
   * including the header it is asserting on, and the guard failed while the
   * middleware was correct.
   *
   * Safe to read raw here because every pattern below includes executable
   * code (`response.headers.set(...)`), so a comment cannot satisfy one.
   */
  const mw = read('middleware.ts');

  it.each([
    ['the booking portal', "'/book/manage/'"],
    ['an invoice', "'/invoice/'"],
    ['a quote', "'/proposal/'"],
    ['a consent confirmation', "'/consent/'"],
    ['the invite page', "'/invite'"],
  ])('%s is declared as carrying a secret', (_name, prefix) => {
    const fn = mw.slice(mw.indexOf('function carriesASecretInTheUrl'));
    expect(fn.slice(0, 600)).toContain(prefix);
  });

  it('sets no-referrer on them', () => {
    // Wide enough for the explanatory comment, which is read raw — see above.
    expect(mw).toMatch(/carriesASecretInTheUrl\(pathname\)[\s\S]{0,400}Referrer-Policy['"],\s*['"]no-referrer/);
  });

  it('still keeps them out of search indexes', () => {
    // A no-referrer header does nothing about a crawler that found the URL.
    for (const file of [
      'app/book/manage/[token]/layout.tsx',
      'app/invoice/[id]/layout.tsx',
      'app/invoice/[id]/page.tsx',
    ]) {
      expect(read(file)).toMatch(/robots/);
    }
  });
});

describe('an invoice is served on one rule, by every surface that serves it', () => {
  it('the page applies it', () => {
    const page = codeOf('app/invoice/[id]/page.tsx');
    expect(page).toMatch(/await mayViewInvoice\(\{/);
    expect(page).toMatch(/if \(!access\.allowed\) \{/);
  });

  it('the page tells a refused client the way back', () => {
    /*
     * Not `notFound()`, which renders the unstyled English 404 on a page a
     * client reached by clicking Pay on their own bill. The business can
     * re-send any unpaid invoice and every send mints a fresh signed link, so
     * the honest answer is "ask them to send it again".
     */
    const page = codeOf('app/invoice/[id]/page.tsx');
    expect(page).toMatch(/kind="expired"/);
    expect(page).toMatch(/invoiceLinkExpiredDesc/);
  });

  it('that wording exists in every language the portal speaks', () => {
    const copy = read('lib/i18n/public-pages.ts');
    expect(copy.match(/invoiceLinkExpiredDesc:/g) ?? []).toHaveLength(3);
  });

  it('builds no public endpoint that mails a link to a supplied address', () => {
    /*
     * The recovery path is the OWNER's authenticated resend. A public "email
     * me a link" route would accept an address from a stranger and send mail
     * from this domain — a worse thing to own than the problem it solves,
     * especially on self-hosted SMTP where the reputation is the sender's.
     */
    expect(fs.existsSync(path.join(process.cwd(), 'app/api/public/invoice/[id]/resend'))).toBe(
      false
    );
  });

  it('the payment endpoint applies the same one', () => {
    /*
     * This is the half that makes the other half real. It returns a Stripe
     * client secret, the amount and the connected account id.
     */
    const route = codeOf('app/api/public/invoice/[id]/intent/route.ts');
    expect(route).toMatch(/await mayViewInvoice\(\{/);
    expect(route).toMatch(/if \(!access\.allowed\)/);
  });

  it('both read the issue date, so the grace window can be applied at all', () => {
    expect(codeOf('app/invoice/[id]/page.tsx')).toMatch(/invoice\.sent_at[\s\S]{0,60}created_at/);
    expect(codeOf('app/api/public/invoice/[id]/intent/route.ts')).toMatch(/sent_at, created_at/);
  });

  it('neither reveals that the invoice exists when refusing', () => {
    // `notFound()` and `not_found`, not "expired": an expired link must not
    // confirm that an invoice with this id is real.
    expect(codeOf('app/api/public/invoice/[id]/intent/route.ts')).toMatch(
      /access\.allowed[\s\S]{0,220}error: 'not_found'/
    );
  });
});

describe('the bare-URL path is measured, so the decision to close it is not a guess', () => {
  /*
   * Every link minted since signing shipped carries a token, so a `fresh`
   * admission is made entirely of links sent BEFORE it. Watching that count
   * fall to zero is what says the grace window can be set to 0 — rather than
   * picking a date and hoping.
   */
  it.each([
    ['the page', 'app/invoice/[id]/page.tsx'],
    ['the payment endpoint', 'app/api/public/invoice/[id]/intent/route.ts'],
  ])('%s logs when it admits one', (_name, file) => {
    expect(codeOf(file)).toMatch(/access\.reason === 'fresh'/);
  });

  it('can be closed by configuration, with no deploy and no hardcoded date', () => {
    const rule = codeOf('lib/payments/invoiceAccessToken.ts');
    expect(rule).toMatch(/INVOICE_BARE_URL_GRACE_DAYS/);
    expect(rule).toMatch(/bareUrlGraceDays\(\)/);
  });
});

describe('every link we mint to an invoice is signed', () => {
  /*
   * Files that build an invoice URL themselves. `app/api/proposal/[token]`
   * used to be one and is not any more — it goes through `invoicePayLink`,
   * which signs on its behalf AND decides between the portal and the invoice
   * page.
   *
   * That distinction is the lesson here. This guard only ever asked "is a
   * token appended", so the proposal route satisfied it while quietly sending
   * every client who accepted a quote to the invoice document instead of to
   * their portal. Signing a link says nothing about where it points;
   * `payLinksStayOnOurPages` owns that question and now lists the route.
   */
  const SIGNERS = [
    'lib/payments/invoicePayLink.ts',
    'app/api/book/manage/[token]/route.ts',
    'app/api/payments/blocks/execute/route.ts',
  ];

  it.each(SIGNERS)('%s appends a token', file => {
    const code = codeOf(file);
    // Either inline in the URL, or hoisted to a variable because signing is
    // async now and cannot sit inside an object literal.
    expect(
      /\/invoice\/\$\{[^}]+\}[^`]*\$\{await generateInvoiceToken\(/.test(code) ||
        /await generateInvoiceToken\(/.test(code)
    ).toBe(true);
  });

  it.each(SIGNERS)('%s never signs without awaiting', file => {
    /*
     * `generateInvoiceToken` reads the contact address, so it returns a
     * Promise. Dropping the `await` interpolates "[object Promise]" into the
     * URL — a link that looks right in the code and is dead in the email.
     */
    expect(codeOf(file)).not.toMatch(/[^t] generateInvoiceToken\(/);
  });

  it('the portal hands the in-page card one too', () => {
    /*
     * The portal pays in place, so its card calls the intent endpoint
     * directly. Without a token it would depend on the invoice being young
     * enough for the bare-URL window — the Pay button would simply stop
     * working on an old unpaid bill, which is the one it matters most on.
     */
    expect(codeOf('app/api/book/manage/[token]/route.ts')).toMatch(/invoiceToken:/);
    expect(codeOf('app/book/manage/[token]/page.tsx')).toMatch(
      /accessToken=\{payment\.invoiceToken\}/
    );
    expect(codeOf('components/public/InvoicePaymentPanel.tsx')).toMatch(
      /accessToken \? `\?t=\$\{encodeURIComponent\(accessToken\)\}`/
    );
  });
});
