// app/admin/ui-config/presets.ts

/**
 * The preset options of the `/admin/ui-config` token editor.
 *
 * In their own module (not inside `page.tsx`, which may export only what
 * Next.js allows a page to export) so a test can check every preset against the
 * save route's schema: the page must never offer a value its own save refuses
 * (slice F-1, SA R-5).
 *
 * `'custom'` is a sentinel, not a value: choosing it only opens the free-text
 * input, and it is never stored.
 */

export const CUSTOM_OPTION = 'custom'

export const radiusOptions = ['4px', '8px', '12px', '16px', '20px', '24px', '32px', CUSTOM_OPTION]

export const shadowOptions = [
  '0 1px 2px rgba(0,0,0,0.05)',
  '0 2px 4px rgba(0,0,0,0.1)',
  '0 4px 8px rgba(0,0,0,0.12)',
  '0 8px 16px rgba(0,0,0,0.15)',
  '0 2px 16px rgba(0,0,0,0.06)',
  '0 8px 24px rgba(0,0,0,0.12)',
  CUSTOM_OPTION,
]

export const spacingOptions = ['4px', '8px', '12px', '16px', '20px', '24px', '32px', '40px', '48px', CUSTOM_OPTION]

export const fontSizeOptions = ['0.75rem', '0.875rem', '1rem', '1.125rem', '1.25rem', '1.5rem', '1.875rem', '2.25rem', CUSTOM_OPTION]
