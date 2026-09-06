/**
 * Business OS Insight Components
 */

export { InsightDetailModal } from './InsightDetailModal';
export type { InsightData, InsightProjection, InsightProcess } from './InsightDetailModal';

// New insight card components
export { InsightAdvisorCard } from './InsightAdvisorCard';
export type { AutomationConfig, InsightCardState, CardStage } from './InsightAdvisorCard';

export { BeforeAfterPanel } from './BeforeAfterPanel';
export type { ProjectionColumn } from './BeforeAfterPanel';

export { VectorsStrip } from './VectorsStrip';

export { HandledSection } from './HandledSection';
export type { HandledEntry } from './HandledSection';

// New mockup components (matching AgentsPilot live dashboard)
export { VerdictCard } from './VerdictCard';

export { TipsStepper } from './TipsStepper';
export type { Tip } from './TipsStepper';

export { FunnelDrawer } from './FunnelDrawer';
export type { DrawerContent, DrawerStat, DrawerPerson, DrawerTodo, ConfidenceData } from './FunnelDrawer';
export { FunnelMap} from './FunnelMap';
export type { FunnelStation, FunnelGap, GhostProjection } from './FunnelMap';

export { SystemReadiness } from './SystemReadiness';

export { ChannelsCard } from './ChannelsCard';
export { ChannelsOverviewCard } from './ChannelsOverviewCard';

export { ChannelSourcesSection } from './ChannelSourcesSection';
export type { ChannelRow } from './ChannelSourcesSection';


export { FirstLightMilestones } from './FirstLightMilestones';
export type { Milestone } from './FirstLightMilestones';

export { FooterReplay } from './FooterReplay';
export type { ReplayRow, ReplayModal } from './FooterReplay';

// Live Dashboard (main mockup-based insight component)
export { LiveDashboard } from './LiveDashboard';
export type { SetupItem, FunnelStats, MilestoneData, PipelineStage, ChannelPerformance } from './LiveDashboard';
