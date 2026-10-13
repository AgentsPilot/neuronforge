/**
 * A second page must never take down the first page's forms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Every public capture route resolved the site owner like this:
 *
 *     supabaseServer.from('website_pages').select('user_id')
 *       .eq('subdomain', subdomain).single()
 *
 * `.single()` fails on MORE THAN ONE row as well as on none. A subdomain has
 * one row per page, so the query was fine for exactly as long as a business had
 * exactly one page. Publish a landing page and every one of these routes
 * started answering 404 "Website not found" -- on the homepage too, not only on
 * the new page, because the lookup never named a page.
 *
 * Measured on production 2026-10-08: 3 of the 9 live subdomains already had
 * more than one page, so a third of all sites had a dead contact form, dead
 * booking, dead checkout and dead newsletter, with the owner's address already
 * handed to clients.
 *
 * `WebsitePageRepository.findBySubdomainAny` already existed and already solved
 * this -- stable tie-break, no status filter, and a comment noting that only
 * `user_id` is load-bearing and every row carries the same one. The capture
 * routes had simply never adopted it. They were also reaching past the
 * repository layer, against CLAUDE.md rule 1.
 *
 * NO STATUS FILTER is deliberate and required: a draft or preview page must
 * still accept a form submission, so the owner can test their own funnel before
 * publishing it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

/** Every route that resolves a site owner from a public request. */
const CAPTURE_ROUTES = [
  'app/api/payments/create-checkout/route.ts',
  'app/api/website/proposal-request/route.ts',
  'app/api/website/blocks/services/route.ts',
  'app/api/website/forms/contact/route.ts',
  'app/api/website/booking/confirm/route.ts',
  'app/api/website/booking/finalize/route.ts',
  'app/api/website/booking/create/route.ts',
  'app/api/website/checkout/route.ts',
  'app/api/website/booking/intake/route.ts',
  'app/api/public/newsletter/subscribe/route.ts',
];

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe.each(CAPTURE_ROUTES)('%s', (file) => {
  const code = strip(read(file));

  it('does not resolve a subdomain straight from website_pages', () => {
    /*
     * CLAUDE.md rule 1, and the reason the same defect was copied nine times.
     *
     * Scoped to SUBDOMAIN resolution rather than banning the table outright:
     * the checkout route reads a homepage by `user_id` to build a URL, which is
     * a different question with a different correct answer.
     */
    const raw = code.split("from('website_pages')").slice(1);
    for (const after of raw) expect(after.slice(0, 220)).not.toContain("eq('subdomain'");
  });

  it('never resolves a subdomain with .single()', () => {
    /*
     * The precise failure. `.single()` is PostgREST's "exactly one row", and a
     * subdomain legitimately has many.
     */
    const lookups = code.match(/\.eq\('subdomain'[\s\S]{0,120}?\.(single|maybeSingle|limit)\(/g) ?? [];
    for (const lookup of lookups) expect(lookup).not.toMatch(/\.single\(/);
  });
});

describe('the shared resolver', () => {
  const repo = read('lib/repositories/WebsitePageRepository.ts');

  it('exists and is what the capture routes call', () => {
    expect(repo).toContain('async findBySubdomainAny(');
    const adopters = CAPTURE_ROUTES.filter((f) => strip(read(f)).includes('findBySubdomainAny('));
    // Every one of them, with no exception to drift out of step later.
    expect(adopters).toEqual(CAPTURE_ROUTES);
  });

  it('takes the first of many rather than failing on them', () => {
    const body = repo.slice(repo.indexOf('async findBySubdomainAny('), repo.indexOf('async findBySubdomainAny(') + 900);
    expect(body).toContain('.limit(1)');
    expect(body).not.toContain('.single()');
  });

  it('is stable about WHICH row, so two callers cannot disagree', () => {
    const body = repo.slice(repo.indexOf('async findBySubdomainAny('), repo.indexOf('async findBySubdomainAny(') + 900);
    expect(body).toContain("order('page_type'");
    expect(body).toContain("order('created_at'");
  });

  it('does NOT filter by status, so a preview page still takes a submission', () => {
    // The published-only variant is `findBySubdomain`. Owner resolution must
    // not use it, or testing your own funnel before launch is impossible.
    const body = repo.slice(repo.indexOf('async findBySubdomainAny('), repo.indexOf('async findBySubdomainAny(') + 900);
    expect(body).not.toContain("eq('status', 'live')");
  });

  it('and the published-only variant still filters, for actually serving a page', () => {
    const body = repo.slice(repo.indexOf('async findBySubdomain('), repo.indexOf('async findBySubdomain(') + 900);
    expect(body).toContain("eq('status', 'live')");
  });
});
