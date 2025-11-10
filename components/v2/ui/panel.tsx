// components/v2/ui/panel.tsx
// V2 Panel component - white container with 24px rounded corners

import * as React from 'react'
import { cn } from '@/lib/design-system-v2'

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  actions?: React.ReactNode
  noPadding?: boolean
}

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, title, description, actions, noPadding, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'bg-white dark:bg-slate-800 rounded-[24px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_16px_rgba(0,0,0,0.3)]',
          !noPadding && 'p-8',
          className
        )}
        {...props}
      >
        {(title || actions) && (
          <div className={cn(
            'flex items-center justify-between',
            !noPadding && 'mb-6',
            noPadding && 'p-8 pb-0'
          )}>
            <div>
              {title && (
                <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {description}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-3">{actions}</div>}
          </div>
        )}
        <div className={noPadding ? 'p-8 pt-6' : undefined}>
          {children}
        </div>
      </div>
    )
  }
)
Panel.displayName = 'Panel'

export { Panel }
