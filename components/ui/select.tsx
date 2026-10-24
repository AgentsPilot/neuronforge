'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value
export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm',
      'border-[var(--v2-border,theme(colors.gray.200))] bg-[var(--v2-bg,white)] text-[var(--v2-text-primary,theme(colors.gray.900))]',
      'placeholder:text-[var(--v2-text-muted,theme(colors.gray.400))] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'rtl:flex-row-reverse rtl:text-right',
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="h-4 w-4 opacity-50" />
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

/**
 * The two buttons that make a long list reachable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Radix scrolls its listbox through these; without them in the tree there is
 * nothing to scroll with, and this copy of the wrapper never had them. Paired
 * with a `max-h` on the content below — missing here too, where upstream ships
 * `max-h-96` — the result was a list that simply ended: `overflow-hidden` with
 * no bound does not scroll, it CLIPS.
 *
 * It had been papered over once, by capping one dropdown's height at its call
 * site. The cancellation-reason list is thirteen options long and ran off the
 * dialog with no way to reach the last of them, which is the same bug arriving
 * somewhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4 opacity-60" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4 opacity-60" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      align="start"
      className={cn(
        /*
         * BOUNDED, SO IT SCROLLS.
         *
         * `overflow-hidden` with no height limit does not scroll — it clips at
         * whatever the popover happens to be, and the options past the fold
         * cannot be reached at all. Upstream ships `max-h-96`; this copy lost
         * it, and a thirteen-option list ran off the bottom of its dialog.
         *
         * `dvh` as well as a rem cap: on a phone `vh` is the viewport with the
         * browser chrome hidden, so a 60vh popover can extend past what is
         * actually visible. The rem stops it becoming a full-height column on
         * a desktop.
         */
        'z-[100] min-w-[8rem] max-h-[min(60dvh,26rem)] overflow-hidden rounded-md border shadow-md',
        'border-[var(--v2-border,theme(colors.gray.200))] bg-[var(--v2-surface,white)] text-[var(--v2-text-primary,theme(colors.gray.900))]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        'rtl:text-right',
        className
      )}
      {...props}
    >
      <SelectScrollUpButton />
      {/*
        `h-[...]` is deliberately NOT here, though upstream carries it.
        `--radix-select-trigger-height` is the height of the TRIGGER — one row
        — and pinning the viewport to it collapses the list to a single option
        on the popper path. Width still follows the trigger, which is what makes
        the menu line up under it.
      */}
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    /*
     * `--v2-text-primary`, not `text-foreground`, like every sibling here.
     *
     * `--foreground` flips only inside `@media (prefers-color-scheme: dark)` —
     * the operating system's preference — while this app has a dark mode of its
     * own, a `.dark` class the theme provider sets from the toggle and
     * localStorage. The two disagree the moment someone runs the app dark on a
     * light phone, and a label coloured by the OS on a surface coloured by the
     * app is unreadable: near-black on near-black.
     *
     * Latent today (nothing renders `SelectLabel` yet) and corrected before the
     * first caller inherits the fault.
     */
    className={cn(
      'px-2 py-1.5 text-sm font-semibold text-[var(--v2-text-primary,theme(colors.gray.900))]',
      className
    )}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
      'text-[var(--v2-text-primary,inherit)]',
      'focus:bg-[var(--v2-surface-hover,theme(colors.gray.100))] focus:text-[var(--v2-text-primary,inherit)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'rtl:flex-row-reverse rtl:text-right',
      className
    )}
    {...props}
  >
    <span className="me-2 h-4 w-4 flex items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName