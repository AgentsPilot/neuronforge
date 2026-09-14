import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'
    
    const variantClasses = {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border border-[var(--v2-border,var(--border))] bg-transparent text-[var(--v2-text-primary,inherit)] hover:bg-[var(--v2-surface,var(--accent))]',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'hover:bg-[var(--v2-surface,var(--accent))] text-[var(--v2-text-primary,inherit)]',
      link: 'text-primary underline-offset-4 hover:underline'
    }
    
    const sizeClasses = {
      default: 'px-4 py-2',
      sm: 'px-3 py-1.5 text-xs',
      lg: 'px-6 py-3 text-base',
      icon: 'p-2'
    }

    return (
      /*
       * `type="button"` by default, not the HTML default of "submit".
       *
       * A bare <button> inside a <form> submits it, so every Button that meant
       * "do this thing" also meant "submit and navigate" the moment someone
       * wrapped it in a form. That is a bug waiting on an unrelated edit — and
       * it fails as a full page reload, which looks nothing like its cause.
       *
       * Explicitly passing `type="submit"` still works: the prop overrides the
       * default. Verified before changing this that no <Button> in the codebase
       * relies on the implicit submit — every form that submits does so from a
       * control with an explicit type.
       */
      <button
        type={type}
        ref={ref}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'

export { Button }