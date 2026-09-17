/**
 * Close the public doors, before anything else about a deletion happens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every live page and every active smart link is a way for a stranger to book
 * an appointment or pay for something. Deleting an account is not instant — the
 * money check, the audit write, the cancellations and the sweep take seconds,
 * and a booking that lands inside that window is worse than one that is
 * refused: it is a client who gets a confirmation email for an appointment that
 * is deleted moments later, or a payment taken by a business that no longer
 * exists.
 *
 * So this runs FIRST. Not as tidying — the cascade deletes these rows anyway —
 * but to shut the window.
 *
 * Reversible on purpose. Pages go back to `draft` and links to `is_active =
 * false`, both of which the owner can undo from the UI. If a later step
 * refuses — a cascade that fails, leaving the account intact — the business is
 * quiet rather than destroyed, and its owner can put it back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CloseShopfront' });

export interface ShopfrontClosure {
  /** Live pages returned to draft. */
  pagesUnpublished: number;
  /** Active smart links switched off. */
  linksDeactivated: number;
  /**
   * What could not be closed. Non-empty means a door may still be open, which
   * the caller should log rather than treat as a reason to stop: refusing to
   * delete because a page would not unpublish helps nobody.
   */
  errors: string[];
}

export async function closeShopfront(userId: string): Promise<ShopfrontClosure> {
  // Service role deliberately: this runs on a path that is about to delete the
  // account, and it must close doors the user's own session might not see.
  const websitePageRepository = getWebsitePageRepository(supabaseServer);

  const result: ShopfrontClosure = {
    pagesUnpublished: 0,
    linksDeactivated: 0,
    errors: [],
  };

  // ── Pages ────────────────────────────────────────────────────────────────
  // `status` is the gate the public renderer reads — `findBySubdomain` filters
  // `status = 'live'` — so only live pages are serving anything.
  const pages = await websitePageRepository.listByUser(userId);

  if (pages.error) {
    result.errors.push(`pages: ${pages.error.message}`);
  } else {
    const liveIds = (pages.data ?? []).filter(p => p.status === 'live').map(p => p.id);

    if (liveIds.length > 0) {
      const unpublished = await websitePageRepository.unpublishMany(liveIds, userId);
      if (unpublished.error) {
        result.errors.push(`pages: ${unpublished.error.message}`);
      } else {
        result.pagesUnpublished = unpublished.data ?? 0;
      }
    }
  }

  // ── Smart links ──────────────────────────────────────────────────────────
  // Every one of them, not just the transactional ones. A contact form on a
  // business that has closed collects enquiries nobody will ever read.
  const links = await smartLinkRepository.listByUser(userId, { activeOnly: true });

  if (links.error) {
    result.errors.push(`links: ${links.error.message}`);
  } else {
    const linkIds = (links.data ?? []).map(l => l.id);

    if (linkIds.length > 0) {
      const deactivated = await smartLinkRepository.deactivateMany(linkIds, userId);
      if (deactivated.error) {
        result.errors.push(`links: ${deactivated.error.message}`);
      } else {
        result.linksDeactivated = deactivated.data ?? 0;
      }
    }
  }

  logger.info(
    {
      userId,
      pagesUnpublished: result.pagesUnpublished,
      linksDeactivated: result.linksDeactivated,
      errorCount: result.errors.length,
    },
    'Shopfront closed'
  );

  return result;
}
