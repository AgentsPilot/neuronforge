/**
 * A Page People Read And Nobody Acts On
 *
 * A published page with real traffic over thirty days, from which not one
 * person got in touch. Not a slow page: a page with an audience and no result.
 *
 * ---------------------------------------------------------------------------
 * HOW A CONTACT IS TIED BACK TO A PAGE
 *
 * Through `crm_contacts.source_metadata.capture_page_url`, which the public
 * forms and the booking widget send from the browser. That field existed long
 * before this detector and recorded the wrong thing: the API route's own path,
 * `/api/website/booking/create`, because the attribution helper falls back to
 * the request URL and for a POST that is the API. Every contact ever created
 * carried the one value that cannot answer which page converts.
 *
 * So this detector only has an answer for contacts created after that was
 * fixed. It is not retroactive, and the `minSamples` floor below is what stops
 * it declaring every page a failure on the strength of history it cannot read.
 *
 * MATCHED ON THE SLUG, NOT ON THE WHOLE URL
 *
 * The stored value is a full href — scheme, host, query string, sometimes a
 * `_sid`. The page is identified by its slug appearing in that path, which
 * survives a custom domain, a locale prefix and any tracking parameters.
 *
 * EXCEPT ON A HOME PAGE, WHICH HAS NO SLUG IN ITS OWN URL
 *
 * A home page is served at the root of the site — `/c/fny614` — and its slug,
 * `home`, appears nowhere in that address. Matching it the same way as every
 * other page meant every enquiry from the home page failed to match, so a home
 * page that converts perfectly well was reported as converting nobody. Home
 * pages are matched on the root path instead.
 *
 * A LANDING PAGE IS HELD TO A DIFFERENT STANDARD FROM A HOME PAGE
 *
 * They are not the same kind of page and it is misleading to judge them alike.
 * A landing page exists for one purpose: someone arrives from an ad or a post
 * and either acts or leaves. Traffic with no enquiries is that page failing at
 * the only job it has, so it is worth saying sooner and it is worth saying more
 * firmly.
 *
 * A home page is partly a doorway. People read it, form a view, and get in
 * touch from the booking page they clicked through to — which is recorded
 * against that page, not this one. So the same silence means much less, and the
 * bar is set correspondingly higher.
 *
 * WHAT IT DELIBERATELY DOES NOT REPORT
 *
 *  - Unpublished pages. A draft with no audience is not underperforming.
 *  - Pages below the traffic floor. "0 conversions from 6 visitors" is six
 *    people, and telling an owner their page is broken on that basis is worse
 *    than saying nothing.
 *  - The owner's own visits, which are excluded by `is_owner_view` — otherwise
 *    a page the owner previews often looks busy and therefore broken.
 *
 * Advisory. The platform cannot rewrite a page, and an automation here would be
 * a button that does nothing.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const WINDOW_DAYS = 30;

/**
 * Unique visitors a page needs before "nobody got in touch" is a finding,
 * by the kind of page it is.
 *
 * See the header for why these differ. The short of it: a landing page with
 * twenty readers and no enquiries has failed at its only purpose, while a home
 * page with twenty readers has mostly been doing its other job.
 */
const MIN_VISITORS_BY_KIND: Record<string, number> = {
  landing: 20,
  services: 30,
  homepage: 80,
};

/** Every other page type, and anything unrecognised. */
const MIN_VISITORS_DEFAULT = 40;

/** The lowest of the above, for the definition's `minSamples` floor. */
const MIN_VISITORS = 20;

function floorFor(pageType: string | null): number {
  return MIN_VISITORS_BY_KIND[pageType ?? ''] ?? MIN_VISITORS_DEFAULT;
}

/** One step up, stopping short of `critical`, which this finding never is. */
function raise(severity: InsightSeverity): InsightSeverity {
  if (severity === 'low') return 'medium';
  return 'high';
}

interface PageRow {
  id: string;
  slug: string | null;
  title: string | null;
  page_type: string | null;
}

/**
 * Whether any recorded enquiry came from this page.
 *
 * Home pages are matched on the root of the site rather than on their slug,
 * which never appears in their own address. Everything else is matched on the
 * slug appearing in the path.
 */
export function pageHasContact(page: { slug: string | null; page_type: string | null }, urls: string[]): boolean {
  if (page.page_type === 'homepage') {
    return urls.some(url => {
      /*
       * `/c/<code>` with nothing after it, or a trailing slash, or the literal
       * `/home` some links use. Query strings are already stripped by the
       * caller, so what is left is a path.
       */
      return /\/c\/[a-z0-9]+\/?$/i.test(url) || url.endsWith('/home') || url.includes('/home?');
    });
  }

  const slug = page.slug?.toLowerCase();
  if (!slug) return false;
  return urls.some(url => url.includes(`/${slug}`));
}

interface ViewRow {
  page_id: string | null;
  session_id: string | null;
}

interface ContactRow {
  capture_page_url: string | null;
}

export class WebPageNoConversionsDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_page_no_conversions',
    name: 'A Page People Read And Nobody Acts On',
    category: 'acquisition',
    description: 'Finds published pages with real traffic that produced no enquiries at all',

    watchedMetrics: ['acquisition.page_conversion_rate'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'below',
    minSamples: MIN_VISITORS,

    severityFn: (pageCount: number, visitors: number): InsightSeverity => {
      // The traffic is the cost. A page with 400 readers and no enquiries is
      // wasting far more attention than one with 45.
      if (visitors >= 300) return 'high';
      if (visitors >= 100 || pageCount >= 3) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined,
    ignoresVectorMaturity: false,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 336,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const { data: pageData, error: pageError } = await this.supabase
      .from('website_pages')
      .select('id, slug, title, page_type')
      .eq('user_id', userId)
      .eq('published', true);

    if (pageError) throw pageError;

    const pages = (pageData ?? []) as unknown as PageRow[];
    if (pages.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const [viewData, contactData] = await Promise.all([
      this.supabase
        .from('website_page_views')
        .select('page_id, session_id')
        .eq('user_id', userId)
        .eq('is_owner_view', false)
        .gte('viewed_at', from),
      this.supabase
        .from('crm_contacts')
        .select('source_metadata->>capture_page_url')
        .eq('user_id', userId)
        .gte('created_at', from),
    ]);

    if (viewData.error) throw viewData.error;
    if (contactData.error) throw contactData.error;

    const views = (viewData.data ?? []) as unknown as ViewRow[];
    /*
     * The query string goes before matching. It carries a `_sid` and whatever
     * UTM tags the link was tagged with, and a home page is identified by its
     * path ENDING at the site root — which `?utm_source=wa` would otherwise
     * defeat.
     */
    const contactUrls = ((contactData.data ?? []) as unknown as ContactRow[])
      .map(c => (c.capture_page_url ?? '').toLowerCase().split('?')[0])
      .filter(Boolean);

    // Unique visitors per page. Views with no session are dropped rather than
    // counted as a visitor each — see WebMobileConversionGapDetector.
    const visitorsByPage = new Map<string, Set<string>>();
    for (const v of views) {
      if (!v.page_id || !v.session_id) continue;
      if (!visitorsByPage.has(v.page_id)) visitorsByPage.set(v.page_id, new Set());
      visitorsByPage.get(v.page_id)!.add(v.session_id);
    }

    const failing = pages
      .map(page => ({ page, visitors: visitorsByPage.get(page.id)?.size ?? 0 }))
      .filter(({ page, visitors }) => {
        if (visitors < floorFor(page.page_type)) return false;
        /*
         * A slug is what identifies a page inside a full href. Without one
         * there is nothing to match on, so no claim can be made either way —
         * except on a home page, which is matched on the root path and needs no
         * slug.
         */
        if (!page.slug && page.page_type !== 'homepage') return false;
        return !pageHasContact(page, contactUrls);
      })
      .sort((a, b) => b.visitors - a.visitors);

    if (failing.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const totalVisitors = failing.reduce((sum, f) => sum + f.visitors, 0);
    const base = this.definition.severityFn(failing.length, totalVisitors);
    /*
     * A landing page in the set raises the finding a step. Its whole reason for
     * existing is the enquiry that is not arriving, so the same silence means
     * more there than on a page people were only ever reading.
     */
    const hasLanding = failing.some(f => f.page.page_type === 'landing');
    const severity = hasLanding ? raise(base) : base;

    /*
     * The kind of page the owner is being told about, so the card can name it.
     * "2 landing pages nobody enquired from" is a different sentence from "2
     * pages", and the difference is what tells them where to look.
     */
    const kinds = new Set(failing.map(f => f.page.page_type ?? 'other'));
    const pageKind = kinds.size === 1 ? [...kinds][0] : 'mixed';

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.page_conversion_rate',
      currentValue: 0,
      baselineValue: totalVisitors,
      thresholdValue: MIN_VISITORS,
      /*
       * Nothing fell by a hundred per cent; nothing was measured twice.
       *
       * Worse than the same fabrication elsewhere, because `baselineValue`
       * here is the VISITOR COUNT rather than a previous conversion rate. So
       * `hasRealBaseline` sees a non-zero baseline, lets the figure through to
       * the prompt, and the narrator is handed "current 0, baseline 412,
       * change -100%" — three numbers in two different units presented as one
       * trend.
       *
       * The finding is "nobody got in touch", which needs no percentage.
       */
      percentChange: 0,
      direction: 'below',
      affectedEntityType: 'page',
      affectedEntityIds: failing.map(f => f.page.id),
      affectedCount: failing.length,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        total_visitors: totalVisitors,
        page_kind: pageKind,
        pages: failing.slice(0, 5).map(f => ({
          id: f.page.id,
          title: f.page.title,
          slug: f.page.slug,
          type: f.page.page_type,
          visitors: f.visitors,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
