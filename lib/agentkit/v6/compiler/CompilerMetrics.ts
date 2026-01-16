/**
 * Compiler Metrics and Monitoring
 *
 * Tracks compilation success/failure rates, performance, and patterns
 * for production monitoring and debugging
 */

export interface CompilationMetric {
  timestamp: Date
  success: boolean
  irVersion: string
  patternType: string
  stepCount: number
  compilationTimeMs: number
  errorType?: string
  errorMessage?: string
  features: {
    hasFilters: boolean
    hasAI: boolean
    hasDeduplication: boolean
    hasGrouping: boolean
    hasPartitions: boolean
    multiDestination: boolean
  }
}

export class CompilerMetrics {
  private metrics: CompilationMetric[] = []
  private maxMetrics = 1000 // Keep last 1000 compilations

  /**
   * Record a compilation attempt
   */
  record(metric: CompilationMetric): void {
    this.metrics.push(metric)

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }
  }

  /**
   * Get success rate
   */
  getSuccessRate(timeWindowMinutes?: number): number {
    const metrics = this.getMetricsInWindow(timeWindowMinutes)
    if (metrics.length === 0) return 0

    const successful = metrics.filter(m => m.success).length
    return (successful / metrics.length) * 100
  }

  /**
   * Get average compilation time
   */
  getAverageCompilationTime(timeWindowMinutes?: number): number {
    const metrics = this.getMetricsInWindow(timeWindowMinutes)
    if (metrics.length === 0) return 0

    const total = metrics.reduce((sum, m) => sum + m.compilationTimeMs, 0)
    return total / metrics.length
  }

  /**
   * Get most common error types
   */
  getTopErrors(limit = 5): Array<{ error: string; count: number }> {
    const errorCounts = new Map<string, number>()

    this.metrics
      .filter(m => !m.success && m.errorType)
      .forEach(m => {
        const count = errorCounts.get(m.errorType!) || 0
        errorCounts.set(m.errorType!, count + 1)
      })

    return Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  /**
   * Get pattern usage statistics
   */
  getPatternUsage(): Map<string, number> {
    const patterns = new Map<string, number>()

    this.metrics
      .filter(m => m.success)
      .forEach(m => {
        const count = patterns.get(m.patternType) || 0
        patterns.set(m.patternType, count + 1)
      })

    return patterns
  }

  /**
   * Get feature usage statistics
   */
  getFeatureUsage(): {
    filters: number
    ai: number
    deduplication: number
    grouping: number
    partitions: number
    multiDestination: number
  } {
    const usage = {
      filters: 0,
      ai: 0,
      deduplication: 0,
      grouping: 0,
      partitions: 0,
      multiDestination: 0
    }

    this.metrics.forEach(m => {
      if (m.features.hasFilters) usage.filters++
      if (m.features.hasAI) usage.ai++
      if (m.features.hasDeduplication) usage.deduplication++
      if (m.features.hasGrouping) usage.grouping++
      if (m.features.hasPartitions) usage.partitions++
      if (m.features.multiDestination) usage.multiDestination++
    })

    return usage
  }

  /**
   * Get summary statistics
   */
  getSummary(timeWindowMinutes?: number): {
    totalCompilations: number
    successRate: number
    avgCompilationTimeMs: number
    topErrors: Array<{ error: string; count: number }>
    patternUsage: Map<string, number>
    featureUsage: ReturnType<typeof this.getFeatureUsage>
  } {
    const metrics = this.getMetricsInWindow(timeWindowMinutes)

    return {
      totalCompilations: metrics.length,
      successRate: this.getSuccessRate(timeWindowMinutes),
      avgCompilationTimeMs: this.getAverageCompilationTime(timeWindowMinutes),
      topErrors: this.getTopErrors(),
      patternUsage: this.getPatternUsage(),
      featureUsage: this.getFeatureUsage()
    }
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clear(): void {
    this.metrics = []
  }

  /**
   * Get metrics within time window
   */
  private getMetricsInWindow(timeWindowMinutes?: number): CompilationMetric[] {
    if (!timeWindowMinutes) {
      return this.metrics
    }

    const cutoff = new Date(Date.now() - timeWindowMinutes * 60 * 1000)
    return this.metrics.filter(m => m.timestamp >= cutoff)
  }

  /**
   * Export metrics for analysis
   */
  export(): CompilationMetric[] {
    return [...this.metrics]
  }
}

// Global singleton instance
export const compilerMetrics = new CompilerMetrics()
