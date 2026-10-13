import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    /*
     * A NATIVE DATE FIELD IS DRAWN BY THE BROWSER, AND IT IS TOLD WHICH THEME
     * IT IS IN EXACTLY ONCE — AT THE ROOT, NOT HERE.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `color-scheme` is the whole mechanism: `dark` makes the engine paint the
     * editable date parts, their separators and the calendar button in light
     * ink and open the picker dark. It is also an INHERITED property, so one
     * declaration on the document element reaches every control on the page.
     * `app/globals.css` makes it, keyed to `.dark` — the same class the `dark:`
     * variant uses, so a public page on a light template keeps light controls.
     *
     * THIS COMPONENT DELIBERATELY DECLARES NONE OF ITS OWN, and that is the
     * fix rather than an omission. It carried
     * `[color-scheme:light] dark:[color-scheme:dark]` — two rules of IDENTICAL
     * specificity, one class each, so which applied was decided by their order
     * in the generated stylesheet rather than by the order they are written in
     * here. When `light` landed last the engine drew a light-UI control inside
     * a dark dialog: dark glyphs and a near-black calendar button on a
     * near-black field, which reads as the date being blank and the button
     * being absent. Inheriting cannot race with itself.
     *
     * (It also carried `invert` on the indicator, a SECOND correction of the
     * same thing — `color-scheme: dark` had already made the icon light, so
     * inverting put it back to black. Each half was right alone and together
     * they cancelled.)
     *
     * The idle/hover opacity stays and is NOT theme-dependent: it de-emphasises
     * a button the owner needs only occasionally. It is no longer behind
     * `dark:`, because the icon deserves the same restraint in both themes and
     * gating it on the theme was never about colour.
     *
     * `min-w-0` because a date control has a wide INTRINSIC width (it reserves
     * room for the full date, the separators and the indicator) and a grid or
     * flex child will not shrink below its intrinsic width unless told it may.
     * Without it the field pushes its own column wider than the dialog and
     * bleeds off the edge of a phone screen, taking its border with it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const isDateInput = type === 'date' || type === 'datetime-local' || type === 'time'

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-[var(--v2-border,var(--border))] bg-[var(--v2-surface,var(--background))] text-[var(--v2-text-primary,inherit)] px-3 py-2 text-sm shadow-sm placeholder:text-[var(--v2-text-muted,var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          isDateInput && 'min-w-0 [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }