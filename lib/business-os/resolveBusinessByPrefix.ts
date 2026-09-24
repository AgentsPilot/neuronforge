/**
 * Which business a public address belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ADDRESS, TWO KINDS OF BUSINESS.
 *
 * `joesgym.agentspilot.ai` is served by `/site/{prefix}`, and that route asks
 * for a published WEBSITE. A business reaching clients by link alone has none —
 * which is the whole reason `/c/{userCode}` exists, as its own header says:
 * "without needing a website subdomain".
 *
 * So the same address worked for one kind of business and 404'd for the other,
 * and the failure was silent: the owner is shown their address in the builder
 * either way.
 *
 * The prefix is not a website's identifier. It is the BUSINESS's, and
 * `resolveBusinessSubdomain` already treats it that way — it returns the
 * claimed subdomain, then any page's, and finally `business_profiles.user_code`.
 * This resolves the same chain in the opposite direction, so a public route can
 * answer "whose is this?" before deciding what to render.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { normalizePrefix } from './reservedPrefixes';

const logger = createLogger({ module: 'ResolveBusinessByPrefix' });

export interface ResolvedBusiness {
  userId: string;
  /** The code the `/c/` surfaces are keyed on. */
  userCode: string;
  /** The address the business publishes under, which may be the code itself. */
  prefix: string;
}

/**
 * The business behind a public prefix, or null if there is none.
 *
 * Tried in the order a prefix can come to exist: the address the business
 * claimed, then the code every business has, then a subdomain held by one of
 * its pages but never promoted to the profile — the last of which is real,
 * because `claimBusinessSubdomain` refuses to overwrite an existing claim and so
 * a page can carry an address the profile does not.
 */
export async function resolveBusinessByPrefix(
  rawPrefix: string
): Promise<ResolvedBusiness | null> {
  const prefix = normalizePrefix(rawPrefix);
  if (!prefix) return null;

  try {
    // 1. The address the business claimed for itself.
    const { data: claimed } = await supabaseServer
      .from('business_profiles')
      .select('user_id, user_code, subdomain')
      .eq('subdomain', prefix)
      .maybeSingle();

    if (claimed?.user_id && claimed.user_code) {
      return { userId: claimed.user_id, userCode: claimed.user_code, prefix };
    }

    // 2. The code every business has, used as its address until it picks one.
    const { data: byCode } = await supabaseServer
      .from('business_profiles')
      .select('user_id, user_code, subdomain')
      .eq('user_code', prefix)
      .maybeSingle();

    if (byCode?.user_id && byCode.user_code) {
      return { userId: byCode.user_id, userCode: byCode.user_code, prefix };
    }

    /*
     * 3. A subdomain held by a page but never promoted to the profile.
     *
     * `claimBusinessSubdomain` never overwrites an existing claim, so a page can
     * carry an address its profile does not know about. Leaving this out would
     * 404 an address that is genuinely in use.
     */
    const { data: page } = await supabaseServer
      .from('website_pages')
      .select('user_id')
      .eq('subdomain', prefix)
      .limit(1)
      .maybeSingle();

    if (!page?.user_id) return null;

    const { data: owner } = await supabaseServer
      .from('business_profiles')
      .select('user_id, user_code')
      .eq('user_id', page.user_id)
      .maybeSingle();

    if (!owner?.user_id || !owner.user_code) return null;

    return { userId: owner.user_id, userCode: owner.user_code, prefix };
  } catch (error) {
    // Never throws: a public page that cannot resolve a prefix should render its
    // own not-found screen, not a stack trace to a visitor.
    logger.warn({ err: error, prefix }, 'Could not resolve a business from its prefix');
    return null;
  }
}
