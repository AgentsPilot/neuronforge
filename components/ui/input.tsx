import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    // Date/time inputs need color-scheme for proper dark mode icon styling
    const isDateInput = type === 'date' || type === 'datetime-local' || type === 'time'

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-[var(--v2-border,var(--border))] bg-[var(--v2-surface,var(--background))] text-[var(--v2-text-primary,inherit)] px-3 py-2 text-sm shadow-sm placeholder:text-[var(--v2-text-muted,var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          isDateInput && '[color-scheme:light] dark:[color-scheme:dark] dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:brightness-[0.8] dark:[&::-webkit-calendar-picker-indicator]:opacity-70 dark:[&::-webkit-calendar-picker-indicator]:hover:opacity-100',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }