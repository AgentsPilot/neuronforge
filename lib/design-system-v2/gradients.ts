// lib/design-system-v2/gradients.ts
// Gradient utility functions for V2 design system

import { v2Gradients } from './tokens'

/**
 * Get gradient CSS string by name
 */
export function getGradient(name: keyof typeof v2Gradients): string {
  return v2Gradients[name]
}

/**
 * Gradient class names for Tailwind
 */
export const gradientClasses = {
  primary: 'bg-gradient-to-br from-[#6366F1] to-[#4F46E5]',
  card: 'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6]',
  success: 'bg-gradient-to-br from-[#10B981] to-[#059669]',
  warning: 'bg-gradient-to-br from-[#F59E0B] to-[#D97706]',
  error: 'bg-gradient-to-br from-[#EF4444] to-[#DC2626]',
  backgroundSubtle: 'bg-gradient-to-br from-[#F5F5F7] to-white',
} as const

/**
 * Gradient text class names
 */
export const gradientTextClasses = {
  primary: 'bg-gradient-to-r from-[#6366F1] to-[#4F46E5] bg-clip-text text-transparent',
  card: 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent',
} as const

/**
 * Create custom gradient
 */
export function createGradient(
  from: string,
  to: string,
  angle: number = 135
): string {
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`
}

/**
 * Apply gradient as inline style
 */
export function gradientStyle(name: keyof typeof v2Gradients): React.CSSProperties {
  return {
    background: v2Gradients[name],
  }
}
