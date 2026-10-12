/**
 * The one button look for the /test-business-os harness.
 *
 * Tailwind's preflight strips native buttons to bare text with a default
 * cursor, so the harness's inline-styled buttons read as plain labels. Every
 * action button on the harness takes its look from here instead of an ad-hoc
 * inline style: a border, a background, rounded corners, a pointer, a hover
 * shade, a visibly dimmed disabled state, and a red `danger` variant for
 * destructive confirms ("Yes, take credits", "Clear Debug Logs", "Sign out").
 *
 * Classes, not an inline style object: hover and `:disabled` cannot be
 * expressed inline. Every variant sets its own background AND text colour, so
 * it stays readable whether the page body is light or (OS dark mode) near
 * black — the harness itself is hardcoded light and mounts no `.dark` theme.
 *
 * Tabs keep their own look in `app/test-business-os/page.tsx`; they are
 * navigation, not actions.
 */

export type HarnessButtonVariant = 'primary' | 'secondary' | 'success' | 'danger';
export type HarnessButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center rounded-md border font-medium leading-tight shadow-sm ' +
  'cursor-pointer transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

const VARIANTS: Record<HarnessButtonVariant, string> = {
  primary: 'border-blue-700 bg-blue-600 text-white enabled:hover:bg-blue-700',
  secondary: 'border-gray-400 bg-gray-100 text-gray-900 enabled:hover:bg-gray-200',
  success: 'border-green-700 bg-green-600 text-white enabled:hover:bg-green-700',
  danger: 'border-red-700 bg-red-600 text-white enabled:hover:bg-red-700',
};

const SIZES: Record<HarnessButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

/** The className for a harness action button. Defaults: secondary, small. */
export function harnessButton(variant: HarnessButtonVariant = 'secondary', size: HarnessButtonSize = 'sm'): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}
