// components/v2/ui/input.tsx
// V2 Input component with mockup styling

import * as React from 'react'
import { cn } from '@/lib/design-system-v2'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-12 w-full rounded-[12px] border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 px-4 py-3 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all',
          'focus:outline-none focus:border-[#6366F1] focus:ring-4 focus:ring-[#6366F1]/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
