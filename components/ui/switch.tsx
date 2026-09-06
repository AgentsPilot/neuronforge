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
    <SwitchPrimitives.Thumb
      className="pointer-events-none block h-[20px] w-[20px] rounded-full bg-white shadow-lg transition-transform duration-200 data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[20px]"
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = 'Switch'