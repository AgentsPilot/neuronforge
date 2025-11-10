// lib/design-system-v2/utils.ts
// Utility functions for V2 design system

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names with proper Tailwind conflict resolution
 * Upgraded version of the simple cn() utility
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format gradient for CSS
 */
export function formatGradient(gradient: string): Record<string, string> {
  return { background: gradient }
}

/**
 * Get responsive padding classes
 */
export function responsivePadding(size: 'sm' | 'md' | 'lg' = 'md') {
  const sizes = {
    sm: 'p-4 sm:p-6',
    md: 'p-6 sm:p-8',
    lg: 'p-8 sm:p-12',
  }
  return sizes[size]
}

/**
 * Get responsive gap classes
 */
export function responsiveGap(size: 'sm' | 'md' | 'lg' = 'md') {
  const sizes = {
    sm: 'gap-3 sm:gap-4',
    md: 'gap-4 sm:gap-6',
    lg: 'gap-6 sm:gap-8',
  }
  return sizes[size]
}
