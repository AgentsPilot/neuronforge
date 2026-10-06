/**
 * One way to answer "whose business is this" on every public booking surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Availability never loaded in the website PREVIEW while smart links worked, and
 * the reason was where each surface keeps the business's identity:
 *
 *   smart link   `params: Promise<{ userCode: string }>` — a path segment, so a
 *                request cannot reach the route without one
 *   website      `?subdomain=` — a query parameter, and a DRAFT page has no
 *                subdomain at all
 *
 * Two gaps then closed the door. The client returned before fetching
 * (`if (!subdomain) { setLoading(false); return; }`) — no request, no error, an
 * empty calendar and a clean console. And the route answered 400 "Subdomain is
 * required", with no `getUser` or `resolvePublicOwner` anywhere in it.
 *
 * `payment-intent` had already solved this: subdomain OR user code, otherwise the
 * signed-in owner. That is why payment worked in preview and availability did
 * not. These tests hold the two halves together, because the failure mode is a
 * call that does not exist rather than a function that returns the wrong thing —
 * which no unit test of either piece would catch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const AVAILABILITY = 'app/api/website/booking/availability/route.ts';
const PAYMENT_INTENT = 'app/api/website/payment-intent/route.ts';
const BLOCK = 'components/website/blocks/BookingWidgetBlock.tsx';
const PAGE_REPO = 'lib/repositories/WebsitePageRepository.ts';

describe('the availability route resolves an owner the same way payment does', () => {
  const route = read(AVAILABILITY);

  it('no longer demands a subdomain', () => {
    expect(route).not.toMatch(/error: 'Subdomain is required'/);
  });

  it('resolves by subdomain or user code through the shared resolver', () => {
    expect(route).toMatch(/from '@\/lib\/business-os\/publicOwner'/);
    expect(route).toMatch(/await resolvePublicOwner\(/);
    expect(route).toMatch(/userCode/);
  });

  it('falls back to the signed-in owner, which is what makes preview work', () => {
    expect(route).toMatch(/from '@\/lib\/auth'/);
    expect(route).toMatch(/await getUser\(\)/);
    // Not silently anonymous: no session and no address is a 401.
    expect(route).toMatch(/status: 401/);
  });

  it('does its own website_pages lookup nowhere', () => {
    // The lookup it replaced used `.single()`, which errors on more than one row.
    expect(route).not.toMatch(/from\('website_pages'\)/);
  });

  it('matches the resolution payment-intent already used', () => {
    // If these two ever disagree about whose business it is, one half of a
    // booking belongs to someone else.
    const payment = read(PAYMENT_INTENT);
    for (const source of [route, payment]) {
      expect(source).toMatch(/resolvePublicOwner\(/);
      expect(source).toMatch(/getUser\(\)/);
    }
  });

  it('still scopes every read to the resolved owner', () => {
    // The route is now reachable by an authenticated caller with no subdomain,
    // so owner scoping is the only thing standing between businesses.
    const scoped = route.match(/\.eq\('user_id', ownerId\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a subdomain with more than one page resolves instead of failing', () => {
  const repo = read(PAGE_REPO);
  const fn = repo.slice(repo.indexOf('async findBySubdomainAny'));

  it('does not use .single(), which errors on multiple rows', () => {
    // Live data: subdomain `0kgjcy` carries a draft AND a live page, so the old
    // `.single()` returned PGRST116 and every caller read it as "no business".
    expect(fn.slice(0, 700)).not.toMatch(/\.single\(\)/);
  });

  it('tie-breaks the same way as findBySubdomain, so the two cannot disagree', () => {
    const any = fn.slice(0, 700);
    expect(any).toMatch(/order\('page_type', \{ ascending: true \}\)/);
    expect(any).toMatch(/order\('created_at', \{ ascending: true \}\)/);
    expect(any).toMatch(/\.limit\(1\)/);
  });

  it('reports an empty result as an error rather than returning undefined', () => {
    expect(fn.slice(0, 900)).toMatch(/No page for this subdomain/);
  });
});

describe('the booking block asks when it can, not only when it has a subdomain', () => {
  const block = read(BLOCK);

  it('reads isPreview, which the renderer has always passed', () => {
    expect(block).toMatch(/isPreview,/);
    expect(block).toMatch(/const canResolveBusiness = Boolean\(subdomain\) \|\| Boolean\(isPreview\)/);
  });

  it('has no bare subdomain bail left in either effect', () => {
    // Both guards returned before fetching; that silence is the whole bug.
    expect(block).not.toMatch(/if \(!subdomain\) \{/);
    expect(block).toMatch(/if \(!canResolveBusiness\) \{/);
  });

  it('omits the subdomain entirely in preview rather than sending an empty one', () => {
    // An empty `?subdomain=` would look like an address and resolve to nothing.
    expect(block).toMatch(/if \(subdomain\) params\.set\('subdomain', subdomain\)/);
    expect(block).not.toMatch(/subdomain=\$\{subdomain\}/);
  });

  it('builds the query rather than interpolating it', () => {
    expect(block).toMatch(/new URLSearchParams\(/);
  });
});

/**
 * The OTHER availability route — the one the shared dialog actually calls.
 *
 * `ProcessFlowSection` fetches `/api/website/scheduling/availability`, not
 * `/api/website/booking/availability`. There are two, and each was broken on the
 * surface the other served:
 *
 *   booking/availability      demanded a subdomain → dead in PREVIEW
 *   scheduling/availability   ignored `user_code` → 401 on a SMART LINK, because
 *                             it fell through to the signed-in owner and a public
 *                             client has no session
 *
 * The dialog has always sent `&user_code=`; the route's Zod schema simply did not
 * list it, so it was parsed away silently. That is the shape worth guarding: a
 * parameter sent and dropped looks identical to one never sent.
 */
describe('the shared dialog route resolves all three ways too', () => {
  const route = read('app/api/website/scheduling/availability/route.ts');
  const dialog = read('components/website/blocks/ProcessFlowSection.tsx');

  it('accepts the user code the dialog sends', () => {
    expect(dialog).toMatch(/user_code=\$\{userCode\}/);
    expect(route).toMatch(/user_code: z\.string\(\)\.optional\(\)/);
  });

  it('resolves through the shared resolver rather than a fourth hand-rolled lookup', () => {
    expect(route).toMatch(/await resolvePublicOwner\(\{ subdomain, userCode \}\)/);
    expect(route).not.toMatch(/findBySubdomainAny/);
  });

  it('keeps the signed-in fallback for preview', () => {
    expect(route).toMatch(/await getUser\(\)/);
  });

  it('only looks for hidden services where a page was resolved', () => {
    // A smart link resolves an owner and no page; asking for blocks by a null id
    // would throw, and catching it would warn on every smart-link request.
    expect(route).toMatch(/if \(pageId\) \{/);
  });

  it('both availability routes now resolve identically', () => {
    const other = read(AVAILABILITY);
    for (const source of [route, other]) {
      expect(source).toMatch(/resolvePublicOwner\(/);
      expect(source).toMatch(/getUser\(\)/);
      expect(source).not.toMatch(/from\('website_pages'\)/);
    }
  });
});

/**
 * One answer to "what does this business publicly sell".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `BOOKABLE = { is_active: true, status: 'active' }` exists because the two flags
 * answer different questions — the owner's Power toggle, and draft versus
 * published — and its own comment says it is "exported as a rule rather than
 * repeated as a pair of `.eq()` calls so the next surface cannot pick one and
 * forget the other". Three public routes repeated the pair anyway. All four
 * happened to agree, which is the dangerous kind of correct.
 *
 * They also disagreed on ORDER — `service_name`, `created_at` ascending, and
 * `created_at` descending — so one catalogue came back in three sequences.
 *
 * The assertion that matters is the negative one: no public route may hand-roll
 * the pair again. That is what keeps a seventh surface from reintroducing the
 * drift, and no unit test of `listBookable` could catch it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the base services set has one definition', () => {
  const PUBLIC_ROUTES = [
    'app/api/website/booking/availability/route.ts',
    'app/api/website/public/[subdomain]/route.ts',
    'app/api/website/pages/[id]/blocks-with-content/route.ts',
    'app/api/conversion/[userCode]/route.ts',
    'app/api/conversion/[userCode]/availability/route.ts',
    'app/api/website/scheduling/availability/route.ts',
  ] as const;

  it.each(PUBLIC_ROUTES)('%s does not hand-roll the bookable pair', file => {
    const source = read(file);
    const active = source.includes(".eq('is_active', true)");
    const status = source.includes(".eq('status', 'active')");

    expect({ file, handRolled: active || status }).toEqual({ file, handRolled: false });
  });

  it.each([
    'app/api/website/booking/availability/route.ts',
    'app/api/website/public/[subdomain]/route.ts',
    'app/api/conversion/[userCode]/route.ts',
    'app/api/conversion/[userCode]/availability/route.ts',
  ] as const)('%s reads the base set through the repository', file => {
    expect(read(file)).toMatch(/listBookable\(/);
  });

  it('no public route queries scheduling_services directly any more', () => {
    for (const file of PUBLIC_ROUTES) {
      expect({ file, raw: read(file).includes("from('scheduling_services')") })
        .toEqual({ file, raw: false });
    }
  });

  describe('listBookable itself', () => {
    const repo = read('lib/repositories/SchedulingRepository.ts');
    const fn = repo.slice(repo.indexOf('async listBookable'));

    it('applies the shared rule rather than restating it', () => {
      expect(fn.slice(0, 700)).toMatch(/\.match\(SchedulingServiceRepository\.BOOKABLE\)/);
    });

    it('does not select *, because these rows go to anonymous visitors', () => {
      // The table carries ai_suggestions, source, availability and the booking
      // window settings; the public routes never sent those.
      expect(fn.slice(0, 700)).not.toMatch(/select\('\*'\)/);
      expect(repo).toMatch(/PUBLIC_COLUMNS/);
    });

    it('carries is_active, which toServiceCard reads', () => {
      // `isActive: service.is_active !== false` — omitting it would silently
      // flip every card to inactive.
      expect(repo).toMatch(/PUBLIC_COLUMNS[\s\S]{0,220}is_active/);
    });

    it('does not carry status, which no caller reads off the row', () => {
      const cols = repo.slice(repo.indexOf('PUBLIC_COLUMNS'), repo.indexOf('async listBookable'));
      expect(cols).not.toMatch(/\bstatus\b/);
    });

    it('settles one order, so the same catalogue reads the same everywhere', () => {
      expect(fn.slice(0, 700)).toMatch(/order\('service_name', \{ ascending: true \}\)/);
    });
  });

  it('the editor can still see switched-off services', () => {
    // `?active_only=false` is the owner asking what they have, not a public read.
    const editor = read('app/api/website/blocks/services/route.ts');
    expect(editor).toMatch(/activeOnly[\s\S]{0,140}listBookable\(userId\)[\s\S]{0,80}listAll\(userId, false\)/);
  });
});

/**
 * Every way into the dialog describes the service the same way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A client can enter the booking flow from a services card, a pricing card, a
 * CTA, the inline calendar block, a page-level header button, a smart link or the
 * business's own booking page. All of them open the SAME dialog — which is the
 * point — but each builds the `SelectedServiceData` it hands over, and each was
 * building a slightly narrower copy.
 *
 * Six of them dropped `paymentPlan`, `sale_mode`, or both. The endpoints supplied
 * the fields; the block types did not declare them, so the TYPE was where they
 * were lost. The consequences are not cosmetic: without the plan a client sold
 * something in instalments is quoted and charged the whole price, and without
 * `sale_mode` a job that should end at a quote is asked for a card.
 *
 * The file-by-file comments record this happening to `is_scheduled` and
 * `collection` first, then to these two. This test is the thing that would have
 * caught it once rather than four times.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('every entry point hands the dialog a complete service', () => {
  const ENTRY_POINTS = [
    ['services card', 'components/website/blocks/ServicesBlock.tsx'],
    ['pricing card', 'components/website/blocks/PricingBlock.tsx'],
    ['CTA', 'components/website/blocks/CTABlock.tsx'],
    ['inline calendar', 'components/website/blocks/BookingWidgetBlock.tsx'],
    ['page-level button', 'components/website/blocks/index.tsx'],
    ['smart link / booking page', 'components/public/StandaloneBookingWidget.tsx'],
  ] as const;

  it.each(ENTRY_POINTS)('the %s carries the payment plan', (_what, file) => {
    // Absent, the payment step quotes the total instead of one period.
    expect(read(file)).toMatch(/paymentPlan: \w+(\.\w+)*\.paymentPlan/);
  });

  it.each(ENTRY_POINTS)('the %s carries sale_mode', (_what, file) => {
    // Absent, a quoted job is asked for a card instead of ending at a request.
    expect(read(file)).toMatch(/sale_mode: \w+(\.\w+)*\.sale_mode/);
  });

  it('the routes that build block content supply both', () => {
    for (const file of [
      'app/api/website/public/[subdomain]/route.ts',
      'app/api/website/pages/[id]/blocks-with-content/route.ts',
    ]) {
      const source = read(file);
      expect({ file, plan: /paymentPlan: matchingService\.paymentPlan/.test(source) })
        .toEqual({ file, plan: true });
      expect({ file, sale: /sale_mode: matchingService\.sale_mode/.test(source) })
        .toEqual({ file, sale: true });
    }
  });

  it('the availability endpoints both publish the plan', () => {
    // One did and one did not, so the same service showed its split on a smart
    // link and a single price on the business's own booking page.
    for (const file of [
      'app/api/website/booking/availability/route.ts',
      'app/api/conversion/[userCode]/availability/route.ts',
    ]) {
      expect({ file, plan: read(file).includes('loadServicePaymentPlans') })
        .toEqual({ file, plan: true });
    }
  });
});
