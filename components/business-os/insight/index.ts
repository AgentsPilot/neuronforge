/**
 * Business OS Insight Components
 */

export { InsightDetailModal } from './InsightDetailModal';
export type { InsightData, InsightProjection, InsightProcess } from './InsightDetailModal';

export { InsightBeatCard } from './InsightBeatCard';
export type { InsightBeatData } from './InsightBeatCard';

export { MyDayInsightSection } from './MyDayInsightSection';

export { AutomationDialog } from './AutomationDialog';
export type { AutomationData, AutomationProcessInfo } from './AutomationDialog';

// New insight card components
export { InsightAdvisorCard } from './InsightAdvisorCard';
export type { AutomationConfig, InsightCardState, CardStage } from './InsightAdvisorCard';

export { BeforeAfterPanel } from './BeforeAfterPanel';
export type { ProjectionColumn } from './BeforeAfterPanel';

export { VectorsStrip } from './VectorsStrip';

export { ConfidenceBar } from './ConfidenceBar';
export type { ConfidenceThreshold } from './ConfidenceBar';

export { SetupCard } from './SetupCard';

export { HandledSection } from './HandledSection';
export type { HandledEntry } from './HandledSection';

export { OnboardingTimeline } from './OnboardingTimeline';

// New mockup components (matching AgentsPilot live dashboard)
export { VerdictCard } from './VerdictCard';

export { TipsStepper } from './TipsStepper';
export type { Tip } from './TipsStepper';

export { FunnelMap } from './FunnelMap';
export type { FunnelStation, FunnelGap, GhostProjection } from './FunnelMap';

export { SystemReadiness } from './SystemReadiness';

export { FunnelDrawer } from './FunnelDrawer';
export type { DrawerContent, DrawerStat, DrawerPerson, DrawerTodo, ConfidenceData } from './FunnelDrawer';

export { FirstLightMilestones } from './FirstLightMilestones';
export type { Milestone } from './FirstLightMilestones';

export { FooterReplay } from './FooterReplay';
export type { ReplayRow, ReplayModal } from './FooterReplay';

export { ReportCard } from './ReportCard';

// Correlated insights (WOW story-driven)
export { CorrelatedInsightCard } from './CorrelatedInsightCard';

// Business health summary
export { BusinessHealthSummaryCard } from './BusinessHealthSummaryCard';

// Live Dashboard (main mockup-based insight component)
export { LiveDashboard } from './LiveDashboard';
export type { SetupItem, FunnelStats, MilestoneData, PipelineStage } from './LiveDashboard';
