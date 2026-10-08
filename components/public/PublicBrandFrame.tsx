// components/public/PublicBrandFrame.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import type { PublicBrand } from '@/lib/branding/publicBranding';

interface PublicBrandFrameProps {
  /**
   * The business, or null when it could not be resolved — an expired token, a
   * deleted account, a mistyped link. Null is not an error here: the page
   * below still has to render something, and it renders unbranded.
   */
  brand: PublicBrand | null | undefined;
  children: React.ReactNode;
}

/**
 * Everything a public surface needs before it can paint in a business's own
 * colours, as ONE component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Four things have to happen together, in order, on every client-facing page:
 *
 *   PublicDirScript    stamps `dir` and `data-public-surface` on <html> before
 *                      first paint, so an RTL page does not flash LTR
 *   PublicFontLinks    the template's faces, preconnected
 *   PublicThemeStyle   the --ap-* custom properties AND the composition
 *   PublicBrandProvider the brand in React context for the tree below
 *
 * That block was copy-pasted verbatim into five layouts, and the sixth surface
 * — `/go/unavailable` — rendered only two of the four. It got the direction and
 * the colours but no fonts and no provider, which is a page in the business's
 * palette and somebody else's typeface.
 *
 * The miss is easy because the omission is SILENT. A surface gets its
 * composition only by rendering `PublicThemeStyle` (compositions.ts:15-18), so
 * forgetting one of these does not throw; the page simply renders without its
 * template and looks almost right.
 *
 * One component means a surface can no longer have three of the four.
 *
 * WHY IT SWALLOWS A NULL BRAND
 *
 * All four layouts ended with the same `if (!brand) return <>{children}</>`
 * before this, because an unresolvable token still has to render the page that
 * explains itself. That branch belongs with the thing it guards rather than
 * repeated at each call site.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PublicBrandFrame({ brand, children }: PublicBrandFrameProps) {
  if (!brand) return <>{children}</>;

  return (
    <>
      <PublicDirScript brand={brand} />
      <PublicFontLinks brand={brand} />
      <PublicThemeStyle brand={brand} />
      <PublicBrandProvider brand={brand}>{children}</PublicBrandProvider>
    </>
  );
}
