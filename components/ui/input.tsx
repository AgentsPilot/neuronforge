import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-[var(--v2-border,var(--border))] bg-[var(--v2-surface,var(--background))] text-[var(--v2-text-primary,inherit)] px-3 py-2 text-sm shadow-sm placeholder:text-[var(--v2-text-muted,var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }