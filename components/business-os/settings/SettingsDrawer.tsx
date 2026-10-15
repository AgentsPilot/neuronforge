'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TabFooterSlot, TabFooterSlotProvider } from '@/components/business-os/settings/TabFooter';
import { cn } from '@/lib/utils';

/**
 * The settings page's drawer (settings drawer review, C-1, C-4 and C-5).
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
 * label, the return target and the discard prompt's words come in from the
 * caller, the way `MoneyDetailDrawer` takes `isRTL` and `t`. It has nothing to
 * log (like `sheet.tsx`), so it has no logger.
 *
 * The one provider it renders is `TabFooterSlotProvider` (SA W-4): the existing
 * portal slot of `TabFooter`, reused, not copied. It carries a DOM node, not
 * shared state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIXED FOOTER (S-3, W-4)
 *
 * A `TabFooter` rendered anywhere in the drawer's children portals into the
 * slot after the scroll body, so a Save bar never scrolls away from the form.
 * The slot is always there; `empty:hidden` keeps it invisible in drawers that
 * have no footer (plan, password). The node is held as state, not a ref, for
 * the reason `ConfigurationDialog` gives: a ref is still null on the render
 * that mounts the content, and the bar would never appear.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUSY REFUSAL (C-4, SA-2)
 *
 * While `isBusy`, every way out is closed: `onOpenChange(false)` is ignored,
 * Escape and an outside press are prevented, and the X is disabled. A save in
 * flight must not lose its drawer, or its result has nowhere to show.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNSAVED CHANGES (C-5, S-3)
 *
 * Opt-in: a caller that passes `isDirty` must pass `discardCopy` with it (the
 * union below makes a dirty drawer with no words to ask in a type error).
 * While dirty, every close request (X, Escape, overlay) opens a "Discard your
 * changes?" prompt instead of closing. Busy is checked first, so a close during
 * a save is refused with no prompt.
 *
 * The prompt is a `components/ui/dialog` rendered INSIDE `SheetContent`'s React
 * tree. Radix then treats it as a nested layer: Escape and outside presses go
 * to the prompt only, and the sheet's own outside-press check (React-tree
 * capture) counts the portalled prompt as inside. Moved out of `SheetContent`,
 * a press on the prompt would dismiss the sheet. Any dismissive gesture on the
 * prompt (Escape, its backdrop, its X) means Keep editing: the safe default.
 *
 * Discard answers the question, so it calls the caller's `onOpenChange(false)`
 * directly, past the gate. The content unmounts and the draft goes with it.
 * Only the content knows what "unsaved" means, so `isDirty` is computed there;
 * this file only enforces the consequence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The discard prompt's words, already translated by the caller. */
export interface DiscardCopy {
  title: string;
  description: string;
  /** The safe choice: closes the prompt, keeps the drawer and its edits. */
  keep: string;
  /** Closes the drawer and throws the edits away. */
  discard: string;
}

interface BaseProps {
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

/** Either no guard at all, or a guard together with the words it asks in. */
type DiscardGuardProps =
  | { isDirty?: undefined; discardCopy?: undefined }
  | { isDirty: boolean; discardCopy: DiscardCopy };

export type SettingsDrawerProps = BaseProps & DiscardGuardProps;

const KEEP_BUTTON_CLASS =
  'px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all';

// Destructive, so it does not wear the primary fill: "Keep editing" must read as
// the default (SA S-3 suggestion).
const DISCARD_BUTTON_CLASS =
  'px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-all disabled:opacity-50';

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
  isDirty = false,
  discardCopy,
}: SettingsDrawerProps) {
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Set by Discard, so the prompt's own focus return does not compete with the
  // sheet's return to the row.
  const discarding = useRef(false);
  // What had focus inside the sheet when the prompt opened. The prompt has no
  // Radix trigger, so on close Radix would put focus nowhere (the body); Keep
  // editing puts it back here instead.
  const focusBeforePrompt = useRef<HTMLElement | null>(null);

  // A parent that closes the drawer some other way while the prompt is up must
  // not get the prompt back on the next open.
  useEffect(() => {
    if (!open) setConfirmOpen(false);
  }, [open]);

  // Every close route (Radix's own, Escape, outside, the X) comes through here,
  // so the refusals live in exactly one place, in this order: busy, then dirty.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      if (isBusy) return;
      if (isDirty) {
        discarding.current = false;
        focusBeforePrompt.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setConfirmOpen(true);
        return;
      }
      onOpenChange(false);
    },
    [isBusy, isDirty, onOpenChange]
  );

  const handleDiscard = useCallback(() => {
    if (isBusy) return;
    discarding.current = true;
    setConfirmOpen(false);
    onOpenChange(false);
  }, [isBusy, onOpenChange]);

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

        <TabFooterSlotProvider value={footerSlot}>
          <div
            className="scrollbar-thin flex-1 overflow-y-auto p-6 space-y-3"
            aria-busy={isBusy || undefined}
          >
            {children}
          </div>
          <TabFooterSlot hostRef={setFooterSlot} />
        </TabFooterSlotProvider>

        {discardCopy ? (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent
              className="sm:max-w-md"
              dir={isRTL ? 'rtl' : 'ltr'}
              data-testid="settings-drawer-discard"
              onCloseAutoFocus={(event: Event) => {
                event.preventDefault();
                // On Discard the sheet closes in the same tick and returns focus
                // to the row; the prompt must not pull it back into a sheet that
                // is going away.
                if (discarding.current) return;
                const back = focusBeforePrompt.current;
                if (back?.isConnected) back.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>{discardCopy.title}</DialogTitle>
                <DialogDescription>{discardCopy.description}</DialogDescription>
              </DialogHeader>
              <div className={cn('flex gap-3', isRTL && 'flex-row-reverse')}>
                {/* First in the DOM, so the prompt opens with focus on the safe choice. */}
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className={KEEP_BUTTON_CLASS}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {discardCopy.keep}
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isBusy}
                  className={DISCARD_BUTTON_CLASS}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {discardCopy.discard}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
