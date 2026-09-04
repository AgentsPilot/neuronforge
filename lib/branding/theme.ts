/**
 * A business's look, as a complete theme. Pure, and safe on both sides.
 *
 * WHY THIS IS SEPARATE FROM `resolveTheme`
 *
 * These two exports are needed on BOTH sides of the server/client boundary: the
 * server resolver fills gaps with them, and the client error boundary — which
 * renders precisely when a page has failed and there may be no resolved
 * branding at all — needs something to paint with.
 *
 * They used to live in `resolveTheme`, which reaches `getBusinessTemplate` and
 * therefore the service-role Supabase client. Importing one plain object from
 * there pulled that whole chain into the browser bundle, where
 * `SUPABASE_SERVICE_ROLE_KEY` does not exist and must not — so the page threw
 * `supabaseKey is required` in the customer's browser, on the component whose
 * entire job is to handle failure gracefully.
 *
 * Nothing here touches the database, so `resolveTheme` can stay `server-only`
 * while these stay importable from anywhere.
 *
 * @module lib/branding/theme
 */

import { getTemplateById, templateToPageTheme } from '@/lib/website-builder/templates';
import type { PageTheme } from '@/lib/repositories/WebsitePageRepository';

/**
 * The look of a business that has chosen nothing.
 *
 * `primary` and `secondary` are the values the emails have always used
 * (`DEFAULT_EMAIL_BRANDING`). They are the right anchor because the customer
 * sees the confirmation email before the page it links to, so any other choice
 * would make the first branded thing they see disagree with the second.
 */
export const DEFAULT_PUBLIC_THEME: PageTheme = {
  colors: {
    primary: '#4F46E5',
    secondary: '#818CF8',
    accent: '#EC4899',
    background: '#FFFFFF',
    surface: '#F9FAFB',
    text: '#111827',
    textSecondary: '#6B7280',
  },
  fonts: {
    heading: 'Inter',
    body: 'Inter',
  },
  borderRadius: '8px',
  spacing: 'normal',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Fill a partial theme out to a complete one.
 *
 * Merged key by key, in order: what the business stored, then the template it
 * chose, then the platform defaults. Key-by-key matters — a theme carrying only
 * `colors.primary` (which is what the design tab produces on an account with no
 * website) must still yield a full seven-colour palette rather than falling
 * wholesale back to the defaults and discarding the one colour it does have.
 */
export function completeTheme(partial: unknown, templateId?: string | null): PageTheme {
  const stored = (partial && typeof partial === 'object' ? partial : {}) as {
    colors?: Record<string, unknown>;
    fonts?: Record<string, unknown>;
    borderRadius?: unknown;
    spacing?: unknown;
  };

  const template = templateId ? getTemplateById(templateId) : undefined;
  const base = template ? templateToPageTheme(template) : DEFAULT_PUBLIC_THEME;

  const color = (key: keyof PageTheme['colors']): string =>
    str(stored.colors?.[key]) ?? base.colors[key] ?? DEFAULT_PUBLIC_THEME.colors[key];

  const font = (key: keyof PageTheme['fonts']): string =>
    str(stored.fonts?.[key]) ?? base.fonts[key] ?? DEFAULT_PUBLIC_THEME.fonts[key];

  const spacing = str(stored.spacing) ?? base.spacing;

  return {
    colors: {
      primary: color('primary'),
      secondary: color('secondary'),
      accent: color('accent'),
      background: color('background'),
      surface: color('surface'),
      text: color('text'),
      textSecondary: color('textSecondary'),
    },
    fonts: {
      heading: font('heading'),
      body: font('body'),
    },
    borderRadius: str(stored.borderRadius) ?? base.borderRadius ?? DEFAULT_PUBLIC_THEME.borderRadius,
    spacing: (['compact', 'normal', 'spacious'].includes(spacing as string)
      ? spacing
      : 'normal') as PageTheme['spacing'],
  };
}
