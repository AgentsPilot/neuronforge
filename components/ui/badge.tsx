import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import React from 'react'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
        secondary: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        destructive: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
        success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
        warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
        outline: 'border border-[var(--v2-border)] bg-transparent text-[var(--v2-text-secondary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}