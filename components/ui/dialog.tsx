"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[60] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  // Check if flex is specified in className to avoid grid conflict
  const hasFlex = className?.includes('flex');
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        /*
         * ─────────────────────────────────────────────────────────────────────
         * WHY THE SIZING IS WRITTEN HERE AND NOT PASSED IN
         *
         * `cn` is a plain `.join(' ')` — it does NOT merge conflicting Tailwind
         * classes. A caller passing `max-h-…` or `max-w-…` to fix a dialog on a
         * phone lands a second rule of the same property at equal specificity,
         * and which one wins is whatever order Tailwind happened to emit them
         * in. So the mobile behaviour has to be correct in the base string,
         * where nothing competes with it.
         *
         * THE TWO THINGS THAT WERE WRONG
         *
         * `w-full` with no gutter: at 375px the panel spanned the screen edge
         * to edge with `p-6` inside it, leaving a 327px content column pressed
         * against both bezels. `w-[calc(100%-2rem)]` gives it a margin and
         * `sm:w-full` restores the old behaviour the moment there is room —
         * applied below, with the scroll, so a self-laying-out dialog keeps
         * the full bleed it asked for.
         *
         * And no height limit at all, which is the serious one. The panel is
         * `fixed` and centred with `translate-y-[-50%]`, so a dialog taller
         * than the viewport does not push the page down — it overflows EQUALLY
         * in both directions, and the part above the top edge cannot be
         * scrolled to by any means. On a short phone that hides the title and
         * often the first field, with no indication anything is missing. The
         * cap plus `overflow-y-auto` makes the panel itself scroll.
         *
         * `100dvh` rather than `100vh`: mobile browsers report `vh` as the
         * height WITHOUT the address bar, so a `vh`-capped dialog is still
         * taller than the visible area until the user scrolls the chrome away.
         *
         * The scroll goes on the `!hasFlex` branch only. A caller that has
         * opted into a flex column is managing its own header/body/footer
         * scrolling — the landing-page wizard does exactly this — and a second
         * scroll container around it produces two scrollbars and a body that
         * cannot reach its own footer.
         */
        "fixed left-[50%] top-[50%] z-[60] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border border-[var(--v2-border,var(--border))] bg-[var(--v2-bg,var(--background))] shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg",
        /*
         * The gutter and the scroll go together, and both only for the plain
         * case.
         *
         * A caller that opted into a flex column is laying itself out — the
         * scheduling dialog asks for `w-full sm:w-[95vw]` and a full-height
         * sheet on a phone, deliberately edge to edge. Imposing a 2rem gutter
         * on it would leave a strip of backdrop down each side of something
         * meant to fill the screen, AND collide with its own width class:
         * `cn` does not merge, so two `w-…` rules would land at equal
         * specificity and fight over source order.
         */
        !hasFlex && "w-[calc(100%-2rem)] sm:w-full grid gap-4 p-4 sm:p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-70 text-[var(--v2-text-muted,var(--foreground))] ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none z-10">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
)})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-start",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-[var(--v2-text-primary,inherit)]",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--v2-text-muted,var(--muted-foreground))]", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
