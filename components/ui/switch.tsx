// components/ui/switch.tsx
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils' // or use your own classNames utility

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      'peer relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-[var(--v2-border)] transition-colors data-[state=checked]:bg-[var(--v2-primary)]',
      className
    )}
    {...props}
  >
    {/*
      The thumb's travel is DIRECTION-AWARE, and `:dir(rtl)` is load-bearing —
      Tailwind's own `rtl:` variant is the wrong tool here.

      ───────────────────────────────────────────────────────────────────────
      THE ORIGINAL BUG

      `translate-x` is a PHYSICAL transform: positive is always rightwards,
      whatever the writing direction. The track is an `inline-flex`, so under
      `dir="rtl"` its main-start edge is the RIGHT one and the thumb sits flush
      right while unchecked — correct, that is "off" in RTL. Checking it then
      translated the thumb a further +20px right, 20px PAST the end of a 44px
      track, so switching anything on in Hebrew threw the thumb out of the pill.

      WHY NOT THE `rtl:` VARIANT

      Tailwind 4 compiles `rtl:` to:

          &:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)

      That last clause matches any DESCENDANT of an RTL element, and it does not
      care that a nearer ancestor flipped back. Seven call sites wrap this switch
      in `dir="ltr"` — a workaround from before this was fixed, which forces the
      thumb's layout LTR on an RTL page. Under `rtl:` those switches were laid
      out LTR (thumb flush LEFT) while still receiving the RTL rule, so the thumb
      travelled 20px off the LEFT edge: the same defect, mirrored, on precisely
      the screens that had tried to avoid it.

      `:dir(rtl)` resolves against the element's OWN direction, so it follows the
      nearest `dir` and both arrangements come out right — wrapped in `dir="ltr"`
      the switch keeps the positive travel that matches its LTR layout, and
      inside a plain RTL page it gets the negative one. The wrappers are now
      redundant, but they are no longer harmful, so they can go separately.

      Specificity is why this is one arbitrary variant rather than two stacked:
      `.cls[data-state=checked]:dir(rtl)` is (0,3,0) and beats the unprefixed
      (0,2,0) rule no matter which order Tailwind emits them in. `rtl:` could not
      promise that — `:where()` contributes ZERO specificity, so it only ever won
      on source order.

      The minus sits INSIDE the brackets to match `dialog.tsx`'s
      `translate-x-[-50%]`, the idiom already in use here.

      Fixed on the primitive rather than at a call site: twelve components share
      this switch, and every one of them was wrong in Hebrew.
      ───────────────────────────────────────────────────────────────────────
    */}
    <SwitchPrimitives.Thumb
      className="pointer-events-none block h-[20px] w-[20px] rounded-full bg-white shadow-lg transition-transform duration-200 data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[20px] [&[data-state=checked]:dir(rtl)]:translate-x-[-20px]"
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = 'Switch'