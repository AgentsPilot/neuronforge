/**
 * Everything a capture can learn about where a client came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE FUNCTION AND NOT FIVE COPIES
 *
 * Five routes create a CRM contact from a public surface — contact form,
 * intake, proposal request, booking, newsletter — and each built its own
 * attribution. They had drifted into three different answers:
 *
 *   contact           page_type ✓   smart link ✗
 *   proposal-request  page_type ✓   smart link ✗
 *   booking/create    page_type ✓   smart link ✗
 *   intake            page_type ✗   smart link ✗
 *   newsletter        page_type ✗   smart link ✗
 *
 * So the same client, arriving through the same smart link, was attributed
 * differently depending on which form they happened to fill in — and NONE of
 * them could say "Smart Link", because none resolved the link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CRM ACTUALLY READS
 *
 * `components/crm/contactSources` → `captureSurface` picks the chip in a fixed
 * order, and it reads only these:
 *
 *   1. `smart_link_id`  → "Smart Link"    (with the link's name beneath)
 *   2. `page_type === 'landing'` → "Landing Page"
 *   3. the capture source itself → "Newsletter" / "Added Manually"
 *   4. otherwise → "Website"
 *
 * A UTM tag then overrides the CHANNEL above that, but only a UTM — never a
 * referrer, because the chip shows what can be proven.
 *
 * Both fields this fills are therefore load-bearing, and both are ENRICHMENT: a
 * failure leaves the contact grouped under Website, which is what it did before.
 * A lead is never lost because attribution was unavailable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { resolveCapturePageType } from '@/lib/business-os/capturePageType';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import type { AttributionWithTracking } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'EnrichCaptureAttribution' });

export interface CaptureContext {
  /** The website the form was served from, where it has one. */
  subdomain?: string | null;
  /** The address the visitor was actually on — carries `_sid` and any UTMs. */
  pageUrl?: string | null;
}

/**
 * Fill in the two things a capture cannot know from its own request.
 *
 * Mutates and returns the attribution it was given, so a caller can pass the
 * object it already built without rebinding it.
 */
export async function enrichCaptureAttribution(
  attribution: AttributionWithTracking,
  context: CaptureContext
): Promise<AttributionWithTracking> {
  /*
   * Which KIND of page this was, recorded now rather than inferred later.
   * A landing page is only distinguishable by matching the path against the
   * owner's landing slugs, and the CRM cannot do that per contact it draws.
   */
  if (!attribution.page_type) {
    try {
      const pageType = await resolveCapturePageType(
        context.subdomain ?? undefined,
        context.pageUrl ?? undefined
      );
      if (pageType) attribution.page_type = pageType;
    } catch (error) {
      logger.warn({ err: error }, 'Could not resolve the capture page type');
    }
  }

  /*
   * Which smart link sent them.
   *
   * Nothing on a form submission names the link: `/go/[code]` redirects to an
   * ordinary page and appends only UTM tags and `_sid`. The session is the
   * bridge — the click is stored against it — and
   * `buildAttributionFromRequest` reads that id off the page's own address
   * rather than off the POST, which has no query string of its own.
   *
   * Skipped when the caller already knows the link (`/go` itself does).
   */
  if (attribution.session_id && !attribution.smart_link_id) {
    const { data: link } = await smartLinkRepository.findLinkBySession(attribution.session_id);

    if (link) {
      attribution.smart_link_id = link.id;
      attribution.smart_link_code = link.code;
      if (link.name) attribution.smart_link_name = link.name;
    }
  }

  return attribution;
}
