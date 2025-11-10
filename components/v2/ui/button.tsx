// components/v2/ui/button.tsx
// V2 Button component with mockup styling

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/design-system-v2'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-gradient-to-br from-[#6366F1] to-[#4F46E5] text-white shadow-[0_4px_16px_rgba(99,102,241,0.3)] hover:shadow-[0_8px_24px_rgba(99,102,241,0.4)] hover:-translate-y-0.5',
        secondary: 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-2 border-gray-200 dark:border-gray-700 hover:border-[#6366F1] hover:bg-gray-50 dark:hover:bg-slate-700',
        outline: 'border-2 border-[#6366F1] text-[#6366F1] hover:bg-[#6366F1]/10',
        ghost: 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800',
        danger: 'bg-gradient-to-br from-[#EF4444] to-[#DC2626] text-white shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:shadow-[0_8px_24px_rgba(239,68,68,0.4)]',
        success: 'bg-gradient-to-br from-[#10B981] to-[#059669] text-white shadow-[0_4px_16px_rgba(16,185,129,0.3)] hover:shadow-[0_8px_24px_rgba(16,185,129,0.4)]',
      },
      size: {
        sm: 'h-9 px-4 text-sm rounded-[10px]',
        md: 'h-11 px-6 text-base rounded-[12px]',
        lg: 'h-14 px-8 text-lg rounded-[14px]',
        icon: 'h-10 w-10 rounded-[12px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
