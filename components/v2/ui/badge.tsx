// components/v2/ui/badge.tsx
// V2 Badge component for status indicators

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/design-system-v2'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        success: 'bg-[#D1FAE5] text-[#059669] dark:bg-green-900/30 dark:text-green-400',
        warning: 'bg-[#FEF3C7] text-[#D97706] dark:bg-amber-900/30 dark:text-amber-400',
        error: 'bg-[#FEE2E2] text-[#DC2626] dark:bg-red-900/30 dark:text-red-400',
        info: 'bg-[#DBEAFE] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-400',
        neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
        primary: 'bg-[#6366F1]/10 text-[#6366F1] dark:bg-indigo-900/30 dark:text-indigo-400',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className={cn(
          'h-1.5 w-1.5 rounded-full',
          variant === 'success' && 'bg-[#059669]',
          variant === 'warning' && 'bg-[#D97706]',
          variant === 'error' && 'bg-[#DC2626]',
          variant === 'info' && 'bg-[#2563EB]',
          variant === 'neutral' && 'bg-gray-500',
          variant === 'primary' && 'bg-[#6366F1]',
        )} />
      )}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
