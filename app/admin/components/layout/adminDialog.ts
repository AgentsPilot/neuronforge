/**
 * The admin dialog classes (Admin Layout Standard C-10; fixes F-88 and F-89).
 *
 * Pass `ADMIN_DIALOG_CLASS` to `components/ui/dialog` `DialogContent`, and the
 * title and description constants to `DialogTitle` and `DialogDescription`.
 * They replace the per-file `DARK_DIALOG` copies, one page at a time (SA Q-5).
 * `components/ui/dialog.tsx` is not edited (SA Q-4); these classes win by
 * specificity or `!`, never by `cn()` order (S-9).
 *
 * - Palette: the `!` classes beat the primitive's `--v2-*` fallbacks, which are
 *   light under /admin (F-91).
 * - `[color-scheme:dark]`: the dialog portals to `body`, outside the admin
 *   chrome that sets the scheme (T-4, SA-R-7).
 * - The corner close is the content's only direct-child `<button>`
 *   (`dialog.tsx`). `.x>button` (0,1,1) beats the primitive's text colour and
 *   `opacity-70` (0,1,0), which in the light scheme resolve to near-black on
 *   slate-900 (F-88). `.x>button:focus` (0,2,1) beats `focus:ring-ring`
 *   (0,2,0), which has no colour (F-66); the offset colour replaces the white
 *   `ring-offset-background`.
 *
 * NEVER put the substring "flex" in `ADMIN_DIALOG_CLASS` (SA M-2):
 * `DialogContent` checks `className.includes('flex')` and, when it is there,
 * drops its own grid, padding, gutter and max-height scroll. One "flex" here
 * would silently break the layout of every admin dialog. Pinned by
 * `__tests__/adminDialog.render.test.tsx`.
 *
 * A plain module: no imports, no 'use client'. Each class is a literal here so
 * Tailwind generates it.
 */

export const ADMIN_DIALOG_CLASS =
  '!border-slate-700 !bg-slate-900 !text-slate-100 [color-scheme:dark] ' +
  '[&>button]:text-slate-300 [&>button]:opacity-100 [&>button:hover]:text-white ' +
  '[&>button:focus]:ring-purple-500 [&>button]:ring-offset-slate-900';

/** For `DialogTitle`: `!` wins over the primitive's token colour whatever the order. */
export const ADMIN_DIALOG_TITLE_CLASS = '!text-white';

/** For `DialogDescription`. */
export const ADMIN_DIALOG_DESCRIPTION_CLASS = '!text-slate-400';
