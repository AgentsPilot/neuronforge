/**
 * Which business a public request belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A client can arrive at a booking from three places, and they identify the
 * business differently:
 *
 *   • a website          → a SUBDOMAIN   (`mysite.agentpilot.io`)
 *   • a landing page     → a SUBDOMAIN   (it renders inside the website)
 *   • a smart link       → a USER CODE   (`/c/{userCode}/book`)
 *
 * The booking flow is meant to be the same on all three, and it very nearly is
 * — but every endpoint behind it resolved the owner from a subdomain alone. So
 * the shared flow could not run on a smart link at all, which is why that
 * surface grew its own booking widget, its own form, and its own bugs.
 *
 * One resolver, so a surface is identified in one place and adding a fourth
 * kind of link is a change here rather than in every endpoint.
 *
 * NOT user-scoped, by nature: these are public requests with no session. The
 * subdomain and the user code ARE the credential, and both are public
 * identifiers that only ever resolve to the business that owns them. This is
 * the documented exception to the `.eq('user_id', userId)` rule — there is no
 * caller identity yet; resolving one is the entire job of this module.
 *
 * Both lookups go through the repository layer (CLAUDE.md mandatory rule 1).
 * `app/api/website/forms/intake` locks that with an explicit
 * `expect(supabaseFrom).not.toHaveBeenCalled()` guard assertion, so a raw
 * `supabaseServer` query here would fail its test rather than merely violate
 * the standard. See D19 in
 * docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/publicOwner
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'PublicOwner' });

// Service-role client: a public request has no session, so RLS has no identity
// to evaluate. The subdomain / user code is the credential (see module note).
const websitePageRepository = new WebsitePageRepository(supabaseServer);

export interface PublicOwnerRef {
  /** A published website's subdomain. */
  subdomain?: string | null;
  /** A business's short code, as smart links carry. */
  userCode?: string | null;
}

export interface PublicOwner {
  userId: string;
  /** The website page, when the business was found by subdomain. */
  pageId?: string;
  source: 'subdomain' | 'user_code';
}

/**
 * Resolve a public request to the business behind it.
 *
 * Subdomain first, because a request carrying both came from a website and the
 * page id is worth having. Returns null rather than throwing: a bad subdomain
 * in a URL somebody typed is a 404, not an error.
 */
export async function resolvePublicOwner(ref: PublicOwnerRef): Promise<PublicOwner | null> {
  const subdomain = ref.subdomain?.trim();
  const userCode = ref.userCode?.trim();

  if (subdomain) {
    // `findBySubdomainAny` deliberately applies no status filter — a public
    // capture surface must also work on a draft/preview site.
    const { data, error } = await websitePageRepository.findBySubdomainAny(subdomain);

    if (error) {
      logger.warn({ err: error, subdomain }, 'Could not resolve a website by subdomain');
    } else if (data?.user_id) {
      return { userId: data.user_id, pageId: data.id, source: 'subdomain' };
    }
  }

  if (userCode) {
    // Stored lower-case; a link pasted with different casing must still work.
    const { data, error } = await businessProfileRepository.findByUserCode(userCode.toLowerCase());

    if (error) {
      logger.warn({ err: error, userCode }, 'Could not resolve a business by user code');
      return null;
    }

    if (data?.user_id) {
      return { userId: data.user_id, source: 'user_code' };
    }
  }

  return null;
}
