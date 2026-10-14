'use client';

import React, { useCallback } from 'react';
import { X } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * The settings page's drawer (settings drawer review, C-1 and C-4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS
 *
 * `MoneyDetailDrawer`'s shell, class for class, on the shared `Sheet`: the
 * side follows the reading direction, full width on a phone and `sm:max-w-xl`
 * above it, a fixed header with the title and its own X, and one scroll body.
 * Two drawers in one product that open at different widths read as two
 * products.
 *
 * Settings-only by SA ruling (rule 7). Using it outside
 * `components/business-os/settings/` needs its own SA ruling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY IS NOT
 *
 * Props only. It reads no context and defines none, so the side, the close
 * label and the return target come in from the page, the way `MoneyDetailDrawer`
 * takes `isRTL` and `t`. It has nothing to log (like `sheet.tsx`), so it has no
 * logger. The unsaved-changes guard (`isDirty`) and the fixed footer slot are
 * designed but arrive with S-3, the first slice that needs them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUSY REFUSAL (C-4, SA-2)
 *
 * While `isBusy`, every way out is closed: `onOpenChange(false)` is ignored,
 * Escape and an outside press are prevented, and the X is disabled. A save in
 * flight must not lose its drawer, or its result has nowhere to show.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional key-facts line under the title, rendered as the sheet's description. */
  meta?: React.ReactNode;
  /** While true the drawer refuses to close (C-4). */
  isBusy?: boolean;
  /** Side and direction, passed in so the wrapper reads no context. */
  isRTL: boolean;
  /** Accessible name of the X, already translated by the caller. */
  closeLabel: string;
  /**
   * Where focus goes on close. Covers the link-opened case, where nothing on the
   * page held focus before the drawer opened, so Radix's default has nowhere to
   * return to.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  testId?: string;
  children: React.ReactNode;
}

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  meta,
  isBusy = false,
  isRTL,
  closeLabel,
  returnFocusRef,
  testId,
  children,
}: SettingsDrawerProps) {
  // Every close route (Radix's own, Escape, outside, the X) comes through here,
  // so the busy refusal lives in exactly one place.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && isBusy) return;
      onOpenChange(next);
    },
    [isBusy, onOpenChange]
  );

  const side = isRTL ? 'left' : 'right';

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={side}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-side={side}
        data-testid={testId}
        // No description without a meta line: tell Radix so, rather than have it
        // warn about a missing one.
        {...(meta ? {} : { 'aria-describedby': undefined })}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (isBusy) event.preventDefault();
        }}
        onInteractOutside={(event: Event) => {
          if (isBusy) event.preventDefault();
        }}
        onCloseAutoFocus={(event: Event) => {
          const target = returnFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={cn(
          'w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden'
        )}
      >
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] p-6">
          <div className="flex items-center gap-4" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start">
                {title}
              </SheetTitle>
              {meta ? (
                <SheetDescription className="mt-1.5 text-xs text-[var(--v2-text-muted)] text-start">
                  {meta}
                </SheetDescription>
              ) : null}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                disabled={isBusy}
                className={cn(
                  'p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors',
                  isBusy && 'opacity-50 cursor-not-allowed'
                )}
                aria-label={closeLabel}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div
          className="scrollbar-thin flex-1 overflow-y-auto p-6 space-y-3"
          aria-busy={isBusy || undefined}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
