'use client';

/**
 * The admin drawer (Admin Layout Standard C-9, §5.8 D-1 to D-8): one right-side
 * panel per page that shows one row's details, opened from an `OpenRowButton`.
 *
 * Built on `components/ui/sheet` (never edited) with the mechanism the Business
 * OS AI Activity drawer proved (`ActivityDrillDown.tsx`):
 *
 * - Palette (D-4). `cn()` is a plain join, so the sheet's own `--v2-bg` class
 *   ships beside ours and CSS order would decide. The inline background and
 *   width decide instead, whatever the order (S-9; L-1d SA S-5 for the width:
 *   `w-full` against the sheet's `w-3/4` would be an order contest).
 * - The X (F-66). The sheet renders its close button as a DIRECT child of the
 *   dialog content, after `children`, so `[&>button]` reaches it: `.x>button`
 *   (0,1,1) beats the sheet's token colour and `opacity-70` (0,1,0), and
 *   `.x>button:focus` (0,2,1) beats `focus:ring-ring` (0,2,0), which has no
 *   colour, with a dark offset in place of the white one.
 * - The title (F-65). The sheet joins `text-[var(--v2-text-primary…)]` with our
 *   class by a plain `cn()`, so no class is sure to win in the light scheme.
 *   An inline colour beats any class.
 * - Focus (D-6). Focus trap, Escape and overlay come from Radix. The opener is
 *   not a Radix trigger, so focus goes back by hand: `onCloseAutoFocus` stops
 *   Radix's own return and calls the page's `onReturnFocus`.
 *
 * No loading, error or not-found states (D-7) and no fetch: L-1d's drawer
 * renders a row that is already loaded (R-6). They arrive with
 * `useDrawerResource` (L-8).
 */

import { useId, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

const DRAWER_CLASS =
  'overflow-y-auto border-slate-700 bg-slate-900 p-6 text-slate-200 sm:max-w-3xl [color-scheme:dark] [&>button]:text-slate-300 [&>button]:opacity-100 [&>button]:focus:ring-purple-500 [&>button]:focus:ring-offset-slate-900';

/**
 * slate-900 and full width, inline so they win over the sheet's classes (D-4,
 * SA S-5). Comma-separated `rgb()`: the same colour in a browser, and the form
 * jsdom's style parser keeps, so the render test can pin it.
 */
const DRAWER_STYLE = { backgroundColor: 'rgb(15, 23, 42)', width: '100%' } as const;

/** slate-100, inline so the sheet's `--v2-text-primary` class cannot win (F-65). */
const TITLE_STYLE = { color: 'rgb(241, 245, 249)' } as const;

export interface AdminDrawerProps {
  open: boolean;
  /** Escape, overlay click and X all call this (D-6). */
  onClose: () => void;
  /** Called once the drawer has closed. The opener is not a Radix trigger, so focus goes back by hand (D-6). */
  onReturnFocus: () => void;
  title: string;
  /** Optional `font-mono text-sm text-slate-400` suffix (D-5), e.g. the row's time. */
  titleSuffix?: string;
  testId?: string;
  children: ReactNode;
}

export function AdminDrawer({ open, onClose, onReturnFocus, title, titleSuffix, testId, children }: AdminDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        data-testid={testId}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        className={DRAWER_CLASS}
        style={DRAWER_STYLE}
      >
        <SheetTitle className="mb-4 text-lg font-semibold" style={TITLE_STYLE}>
          {title}
          {titleSuffix && (
            <>
              {/* A literal space, so the dialog's name reads "Title suffix", not "Titlesuffix" (SA S-4). */}
              {' '}
              <span className="ml-1 font-mono text-sm font-normal text-slate-400">{titleSuffix}</span>
            </>
          )}
        </SheetTitle>
        <div className="space-y-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * One named block of the drawer (D-5). A `div role="group"` named by its own
 * heading, never a `<section>`: S-8 refuses `<section` in the shared folder,
 * and a named group is not a landmark (A-9). The sheet's title is the dialog's
 * `h2`, so a section heading is an `h3`.
 */
export function DrawerSection({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} data-testid={testId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold text-slate-100">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** The label / value grid of a section (D-5). */
export function DrawerFields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">{children}</dl>;
}

/**
 * One label and its value. The wrapper is `display: contents`, so the `dt` and
 * `dd` sit in the grid, and a test can still reach the value through the
 * label's `parentElement`.
 */
export function DrawerField({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-words text-slate-200" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
