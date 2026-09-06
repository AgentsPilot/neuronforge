/**
 * The one place a business's look is turned into a complete theme.
 *
 * WHY THIS EXISTS
 *
 * `business_profiles.theme` is a JSONB column that nothing validates. What is
 * actually in it varies: the design tab writes four fields, applying a template
 * writes all of them, an account that never published anything has null. Every
 * consumer then coped on its own, with its own fallback hex — which is how the
 * platform ended up shipping two different "default brand blues", `#4F46E5` in
 * the emails and booking-management pages and `#4F6EF7` on the smart links and
 * website, side by side in one customer's journey.
 *
 * `completeTheme` ends that — it lives in `./theme`, which is pure and
 * importable from anywhere. This module is the part that has to talk to the
 * database, and is therefore the part that has to stay on the server.
 *
 * @module lib/branding/resolveTheme
 */

/*
 * Server only, and enforced rather than assumed.
 *
 * This module reaches `getBusinessTemplate` and therefore the service-role
 * Supabase client. Without this marker a client component can import something
 * harmless-looking from here — a constant, a pure function — and drag the whole
 * chain into the browser bundle, where the failure is a runtime `supabaseKey is
 * required` in the customer's browser rather than an error at build time.
 *
 * That is not hypothetical: it is what `DEFAULT_PUBLIC_THEME` did, imported by
 * the client error boundary on `/book/manage/[token]`. The pure values moved to
 * `./theme` and this marker is here so the same mistake fails loudly.
 */
import 'server-only';

import { createLogger } from '@/lib/logger';
import { getBusinessTemplate, type BusinessTheme } from '@/lib/business-os/businessTemplate';
import { completeTheme, DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
import type { PageTheme } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'ResolveTheme' });

// Re-exported so existing server callers keep one import site.
export { completeTheme, DEFAULT_PUBLIC_THEME };

export interface ResolvedBusinessTheme {
  /** Complete, safe to render from without any fallback of the caller's own. */
  theme: PageTheme;
  /**
   * Exactly what was stored, gaps and all.
   *
   * Kept alongside the completed theme for callers that must be able to tell
   * "the business chose this" from "we filled it in" — the email builder needs
   * that distinction so an account with no theme keeps sending the exact
   * template it sent before this module existed.
   */
  raw: BusinessTheme | null;
  templateId: string | null;
}

/**
 * What this business looks like, complete.
 *
 * Delegates the lookup to `getBusinessTemplate`, which is already the single
 * writer and reader of the business's chosen look — profile first, then any
 * page that carries a template. Never throws: a look is decoration, and not
 * knowing it must not be able to stop an invoice rendering.
 */
export async function resolveBusinessTheme(
  userId: string,
  profileTheme?: BusinessTheme | null,
  profileTemplateId?: string | null
): Promise<ResolvedBusinessTheme> {
  // A caller that already loaded the profile has both values in hand; going
  // back to the database for them would be a second query for nothing.
  if (profileTheme || profileTemplateId) {
    return {
      theme: completeTheme(profileTheme, profileTemplateId),
      raw: profileTheme ?? null,
      templateId: profileTemplateId ?? null,
    };
  }

  try {
    const { templateId, theme } = await getBusinessTemplate(userId);
    return { theme: completeTheme(theme, templateId), raw: theme, templateId };
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve the business theme; using defaults');
    return { theme: DEFAULT_PUBLIC_THEME, raw: null, templateId: null };
  }
}
