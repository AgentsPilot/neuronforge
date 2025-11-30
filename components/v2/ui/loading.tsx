/**
 * Shared loading components for V2 pages
 * Standardizes loading states across the application
 */

interface PageLoadingProps {
  message?: string
}

/**
 * Full-page loading spinner with message
 * Use for initial page loads
 */
export function PageLoading({ message = 'Loading...' }: PageLoadingProps) {
  return (
    <div className="flex items-center justify-center min-h-[600px]">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-[var(--v2-text-secondary)] font-medium">{message}</p>
      </div>
    </div>
  )
}

interface InlineLoadingProps {
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Inline loading spinner
 * Use for section-level loading within a page
 */
export function InlineLoading({ size = 'md' }: InlineLoadingProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  }

  return (
    <div className="flex items-center justify-center py-12">
      <div className={`animate-spin rounded-full border-b-2 border-[var(--v2-primary)] ${sizeClasses[size]}`}></div>
    </div>
  )
}
