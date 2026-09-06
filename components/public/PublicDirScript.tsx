// components/public/PublicDirScript.tsx

import type { PublicBrand } from '@/lib/branding/publicBranding';

/**
 * Puts the business's language and direction on the document itself.
 *
 * WHY A SCRIPT AND NOT AN ATTRIBUTE
 *
 * `<html>` belongs to the root layout, and a root layout cannot see the params
 * of a nested dynamic segment — it has no way of knowing which business
 * `/book/manage/[token]` is for, so it cannot know the language. The result was
 * `<html lang="en">` on every Hebrew booking page, with `dir="rtl"` set on some
 * inner div instead. Browser translation, screen readers and font shaping all
 * still read those documents as English left-to-right, and the one page that
 * forgot its inner `dir` (cancel) rendered Hebrew in full LTR.
 *
 * This runs during HTML parsing, before any body content paints, so the page
 * never appears in the wrong direction and then flips. The wrapper element also
 * carries `dir` in the server-rendered markup, which covers crawlers and the
 * no-JS case.
 */
export function PublicDirScript({ brand }: { brand: PublicBrand }) {
  const script = `document.documentElement.lang=${JSON.stringify(brand.locale)};document.documentElement.dir=${JSON.stringify(brand.dir)};document.documentElement.dataset.publicSurface="1";document.documentElement.style.colorScheme=${JSON.stringify(brand.colorScheme)};`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
