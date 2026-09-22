/**
 * Whether a contact was captured on a landing page or on the site itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS RESOLVED AT CAPTURE AND NOT AT READ TIME
 *
 * A landing page is a `website_pages` row with `page_type = 'landing'`; the
 * attribution records only `capture_page_url`. So "did this contact come from a
 * landing page" is answerable ONLY by matching that path against the owner's
 * landing slugs — a lookup the CRM drawer would have to repeat for every
 * contact it draws, against pages that may since have been renamed or deleted.
 *
 * Recording the answer once, at the moment of capture, is both cheaper and more
 * truthful: it says what the page WAS when the contact arrived, which is the
 * fact the CRM is reporting.
 *
 * Contacts captured before this existed have no `page_type` and group under
 * Website. There is no signal to backfill them from — the page may not even
 * exist any more — and guessing would put contacts in a group they may never
 * have come through.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os
 */

import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CapturePageType' });

/**
 * `'landing'` when the captured page is a live landing page, otherwise
 * undefined — which the CRM reads as "the website".
 *
 * Never throws. Attribution is an enrichment: a contact must not fail to be
 * created because the page it came from could not be classified.
 */
export async function resolveCapturePageType(
  subdomain: string | null | undefined,
  pageUrl: string | null | undefined
): Promise<'landing' | undefined> {
  if (!subdomain || !pageUrl) return undefined;

  try {
    // `/summer-offer`, `/summer-offer/`, or an absolute URL — all of which the
    // booking widget and the forms have been seen to send.
    const path = pageUrl.startsWith('http') ? new URL(pageUrl).pathname : pageUrl;
    const slug = path.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').filter(Boolean).pop();

    // No slug is the site root, which is never a landing page.
    if (!slug) return undefined;

    /*
     * Service role, like every other read on these public capture routes: there
     * is no session to scope by, and the subdomain IS the tenant — the same
     * resolution the route already did to find the owner.
     */
    const result = await getWebsitePageRepository(supabaseServer).findLiveLandingBySlug(subdomain, slug);
    return result.data ? 'landing' : undefined;
  } catch (err) {
    logger.warn({ err, subdomain, pageUrl }, 'Could not classify the capture page; treating it as the website');
    return undefined;
  }
}
