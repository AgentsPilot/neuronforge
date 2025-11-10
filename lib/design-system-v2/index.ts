// lib/design-system-v2/index.ts
// Barrel export for V2 design system

export { v2Tokens, v2Gradients, type V2Tokens, type V2Gradients } from './tokens'
export { getGradient, gradientClasses, gradientTextClasses, createGradient, gradientStyle } from './gradients'
export { V2ThemeProvider, useV2Theme } from './theme-provider'
export { cn, formatGradient, responsivePadding, responsiveGap } from './utils'
