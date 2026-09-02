/**
 * The business's template — one look, worn by everything it publishes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A template is not a property of a page. It decides the colours, the fonts and
 * the brand voice that every generated element is built from: the website's
 * blocks, a landing page's sections, a smart link's styling, the invoice PDF,
 * every transactional email. Storing it per page meant a business could be
 * wearing three different looks at once and had no way to say which was its.
 *
 * THE THREE RULES, which are all one rule:
 *
 *   1. A website from onboarding sets the business template.
 *   2. A landing page created first sets it instead — whichever surface exists
 *      first establishes it, and everything made afterwards adopts it.
 *   3. Changing it changes everything, because there is only one.
 *
 * `business_profiles.theme` already carried the values (emails and invoices read
 * it); `business_profiles.template_id` records which template they came from.
 * This module is the only thing that writes either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { getTemplateById, templateToPageTheme } from '@/lib/website-builder/templates';

const logger = createLogger({ module: 'BusinessTemplate' });

/** The shape every public surface reads a look out of. */
export interface BusinessTheme {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  [key: string]: unknown;
}

export interface BusinessTemplateState {
  /** Null when the business has published nothing yet. */
  templateId: string | null;
  theme: BusinessTheme | null;
}

/**
 * What this business currently looks like.
 *
 * Falls back to the homepage for accounts whose look predates the profile
 * columns — the migration backfills those, but a read must not depend on it
 * having run.
 */
export async function getBusinessTemplate(userId: string): Promise<BusinessTemplateState> {
  try {
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('template_id, theme')
      .eq('user_id', userId)
      .maybeSingle();

    if (profile?.template_id || profile?.theme) {
      return {
        templateId: profile.template_id ?? null,
        theme: (profile.theme as BusinessTheme) ?? null,
      };
    }

    /*
     * Any page, not just the homepage.
     *
     * The fallback asked only for `page_type = 'homepage'`, so a business whose
     * template was established by a LANDING page — which is the whole point of
     * "whichever surface comes first" — had nothing to fall back to, and the
     * Templates tab showed no selection at all. Homepage first, because it is
     * the business's main surface; then the most recently created page that
     * carries a template.
     */
    const { data: pages } = await supabaseServer
      .from('website_pages')
      .select('template_id, theme, page_type, created_at')
      .eq('user_id', userId)
      .not('template_id', 'is', null)
      .order('created_at', { ascending: false });

    const source =
      (pages || []).find(page => page.page_type === 'homepage') ?? (pages || [])[0];

    return {
      templateId: source?.template_id ?? null,
      theme: (source?.theme as BusinessTheme) ?? null,
    };
  } catch (error) {
    // A look is decoration. Not knowing it must never stop a page being made.
    logger.warn({ err: error, userId }, 'Could not read the business template');
    return { templateId: null, theme: null };
  }
}

/**
 * Make this the business's template, and restyle everything it already has.
 *
 * This is what "changing the template" means: the profile is updated so future
 * surfaces are generated from it, and every existing page is restyled so the
 * business is not left wearing two looks. Block CONTENT is never touched — a
 * template decides styling, and a business that changes its colours must not
 * lose its words.
 */
export async function setBusinessTemplate(
  userId: string,
  templateId: string
): Promise<{ propagatedPages: number }> {
  const template = getTemplateById(templateId);
  if (!template) {
    logger.warn({ userId, templateId }, 'Unknown template; business template unchanged');
    return { propagatedPages: 0 };
  }

  // The same converter the pages use. A business theme that is not byte-for-byte
  // what a page stores is a second look pretending to be the first.
  const theme = templateToPageTheme(template) as unknown as BusinessTheme;

  await businessProfileRepository.updateBranding(userId, {
    theme: theme as unknown as Record<string, unknown>,
  });

  // `template_id` is not part of the branding contract, so it is written here.
  const { error: profileError } = await supabaseServer
    .from('business_profiles')
    .update({ template_id: templateId, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (profileError) {
    logger.error({ err: profileError, userId, templateId }, 'Could not record the business template');
  }

  // Every page the business already has, so the change is actually visible.
  const { data: repainted, error: pagesError } = await supabaseServer
    .from('website_pages')
    .update({ template_id: templateId, theme, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('id');

  if (pagesError) {
    logger.error({ err: pagesError, userId, templateId }, 'Could not restyle existing pages');
    return { propagatedPages: 0 };
  }

  logger.info(
    { userId, templateId, propagatedPages: repainted?.length || 0 },
    'Business template changed'
  );

  return { propagatedPages: repainted?.length || 0 };
}

/**
 * Set the business template only if it has none — first surface wins.
 *
 * Called when a website or a landing page is created. A business that already
 * has a look keeps it; the new surface adopts rather than overrides, which is
 * the difference between "the first thing I made set my look" and "the last
 * thing I made silently changed it".
 */
export async function adoptBusinessTemplate(
  userId: string,
  templateId: string | null | undefined
): Promise<boolean> {
  if (!templateId) return false;

  const current = await getBusinessTemplate(userId);
  if (current.templateId) return false;

  await setBusinessTemplate(userId, templateId);
  logger.info({ userId, templateId }, 'First published surface established the business template');
  return true;
}

/**
 * Adopt a look that came from no template — first surface wins, again.
 *
 * A landing page is styled from a preset rather than a template, so when one is
 * the first thing a business publishes there is no `template_id` to record,
 * only colours and fonts. Those still have to become the business's, or rule 2
 * does not hold: the website generated afterwards would pick its own and the
 * landing page would be left as the odd one out.
 */
export async function adoptBusinessTheme(
  userId: string,
  theme: BusinessTheme | null | undefined
): Promise<boolean> {
  if (!theme) return false;

  const current = await getBusinessTemplate(userId);
  if (current.templateId || current.theme) return false;

  await businessProfileRepository.updateBranding(userId, {
    theme: theme as unknown as Record<string, unknown>,
  });
  logger.info({ userId }, 'First published surface established the business look');
  return true;
}

/**
 * Clear the business's template — back to no choice made.
 *
 * Both columns go, because they are one answer: `template_id` without `theme`
 * names a look nothing is wearing, and `theme` without `template_id` is a look
 * nobody can point at. With neither, the business is in the state it was in
 * before it published anything, and the next surface it creates establishes the
 * template again.
 *
 * Existing pages keep their theme. Blanking those would leave a live site with
 * no colours at all — clearing the choice is not the same as undoing what was
 * already built from it.
 */
export async function clearBusinessTemplate(
  userId: string
): Promise<{ cleared: boolean; blockedByPages: number }> {
  /*
   * Refused once anything has been built from it.
   *
   * A website or a landing page is generated FROM the template — its blocks,
   * its colours, its fonts. Clearing the choice while those exist leaves live
   * surfaces wearing a look the business can no longer name, change or reapply,
   * and the next thing it creates would be free to establish a different one.
   * Unselecting is for a business that has not committed yet.
   */
  const { count, error: countError } = await supabaseServer
    .from('website_pages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (countError) {
    logger.error({ err: countError, userId }, 'Could not check for pages before clearing the template');
    return { cleared: false, blockedByPages: 0 };
  }

  if ((count || 0) > 0) {
    logger.info({ userId, pages: count }, 'Business template kept: pages are built from it');
    return { cleared: false, blockedByPages: count || 0 };
  }

  await businessProfileRepository.updateBranding(userId, { theme: null });

  const { error } = await supabaseServer
    .from('business_profiles')
    .update({ template_id: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error, userId }, 'Could not clear the business template');
    return { cleared: false, blockedByPages: 0 };
  }

  logger.info({ userId }, 'Business template cleared');
  return { cleared: true, blockedByPages: 0 };
}
