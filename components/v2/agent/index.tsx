export { AgentHeader } from './AgentHeader'
export { PerformanceTrends, type TimePeriod } from './PerformanceTrends'
export { LatestRunCard } from './LatestRunCard'
export { RunHistoryTable } from './RunHistoryTable'
export { ExecutionDetailPanel } from './ExecutionDetailPanel'
export { InsightPreview } from './InsightPreview'
export { ExecutionModal } from './ExecutionModal'

// Helper function to normalize insights
export function normalizeInsights(insights: any[]): any[] {
  if (!Array.isArray(insights)) return []

  return insights.map((insight) => ({
    id: insight.id || insight.insight_id || `insight-${Date.now()}-${Math.random()}`,
    title: insight.title || insight.insight_title || 'Untitled Insight',
    description: insight.description || insight.insight_description || '',
    severity: insight.severity || insight.priority || 'low',
    type: insight.type || insight.insight_type || 'general',
    ...insight
  }))
}
