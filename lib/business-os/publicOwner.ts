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
 * identifiers that only ever resolve to the business that owns them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/publicOwner
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PublicOwner' });

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
    const { data, error } = await supabaseServer
      .from('website_pages')
      .select('id, user_id')
      .eq('subdomain', subdomain)
      .maybeSingle();

    if (error) {
      logger.warn({ err: error, subdomain }, 'Could not resolve a website by subdomain');
      return null;
    }

    if (data?.user_id) {
      return { userId: data.user_id, pageId: data.id, source: 'subdomain' };
    }
  }

  if (userCode) {
    const { data, error } = await supabaseServer
      .from('business_profiles')
      // Stored lower-case; a link pasted with different casing must still work.
      .select('user_id')
      .eq('user_code', userCode.toLowerCase())
      .maybeSingle();

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
