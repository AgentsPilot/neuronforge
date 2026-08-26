'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useInsights } from '@/hooks/useInsights';
import { VerdictCard } from './VerdictCard';
import { TipsStepper, Tip } from './TipsStepper';
import { FunnelMap, FunnelStation, FunnelGap, GhostProjection } from './FunnelMap';
import { FunnelDrawer, DrawerContent, DrawerTodo } from './FunnelDrawer';
import { SystemReadiness } from './SystemReadiness';
import { FirstLightMilestones, Milestone } from './FirstLightMilestones';
import { FooterReplay, ReplayModal } from './FooterReplay';
import { VectorsStrip } from './VectorsStrip';
import { HandledSection, HandledEntry } from './HandledSection';

// ===========================
// Types
// ===========================

type DayKey = 'd1' | 'd4' | 'd18' | 'd60' | 'd90';
type VectorState = 'dark' | 'learn' | 'lit';
type GapState = 'ok' | 'leak' | 'watch' | 'off';

interface TimelineStage {
  key: DayKey;
  day: number;
  label: string;
  sublabel: string;
}

export interface SetupItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: string;
  /**
   * false = recommended, not required. The business can still take a client
   * end to end without it, so it never blocks the "all set" state — but it is
   * still shown, because the user asked to see everything left to configure.
   */
  required?: boolean;
}

export interface FunnelStats {
  found: number;
  touch: number;
  booked: number;
  paid: number;
  paidAmount: number;
}

// Real CRM pipeline stage from crm_pipeline_stages table
export interface PipelineStage {
  stage_key: string;
  stage_label: string;
  color: string;
  count: number;
}

export interface MilestoneData {
  firstVisitor?: { date: string; source: string };
  firstEnquiry?: { date: string; responseTime: string };
  firstBooking?: { date: string; amount: number };
}

// ===========================
// Props
// ===========================

interface LiveDashboardProps {
  userName: string;
  greeting?: 'morning' | 'afternoon' | 'evening';
  // Real data from parent
  setupItems?: SetupItem[];
  funnelStats?: FunnelStats;
  pipelineStages?: PipelineStage[];  // Real CRM pipeline stages
  milestoneData?: MilestoneData;
  autonomousWorkData?: HandledEntry[];
  onConfigureClick?: (stepId: string) => void;
  onAction?: (action: string, data?: unknown) => void;
  // Collapse state
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// Helper to get current date info
function useDateInfo(t: (key: string) => string | undefined) {
  const now = new Date();
  const dayKeys = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
  const monthKeys = ['month.jan', 'month.feb', 'month.mar', 'month.apr', 'month.may', 'month.jun', 'month.jul', 'month.aug', 'month.sep', 'month.oct', 'month.nov', 'month.dec'];
  const dayName = t(dayKeys[now.getDay()]) || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const monthName = t(monthKeys[now.getMonth()]) || ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()];
  const dateStr = `${now.getDate()} ${monthName}`;
  return { dayName, dateStr };
}

// ===========================
// Component
// ===========================

export function LiveDashboard({
  userName,
  greeting = 'morning',
  setupItems = [],
  funnelStats,
  pipelineStages = [],
  milestoneData,
  autonomousWorkData = [],
  onConfigureClick,
  onAction,
  collapsed = false,
  onToggleCollapse,
}: LiveDashboardProps) {
  const { t, isRTL, formatCurrency, language } = useLanguage();

  // Format date with proper locale (Hebrew months for Hebrew, etc.)
  const formatMilestoneDate = useCallback((dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }, [language]);
  const { dayName, dateStr } = useDateInfo(t);

  // Greeting text based on time of day
  const greetingText = t(`myday.greeting.${greeting}`) || {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening'
  }[greeting];
  const { vectorMaturity, autonomousWork } = useInsights();

  // Get real account age from vectorMaturity or default
  const accountAgeDays = vectorMaturity?.accountAgeDays || 1;

  // Timeline stages - using existing translation keys from LanguageContext
  const TIMELINE_STAGES: TimelineStage[] = useMemo(() => [
    { key: 'd1', day: 1, label: t('timeline.stage.day1') || 'Day 1', sublabel: t('timeline.stage.day1.sub') || 'Setup' },
    { key: 'd4', day: 4, label: t('timeline.stage.day4') || 'Day 4', sublabel: t('timeline.stage.day4.sub') || 'First visitors' },
    { key: 'd18', day: 18, label: t('timeline.stage.day18') || 'Day 18', sublabel: t('timeline.stage.day18.sub') || 'First booking' },
    { key: 'd60', day: 60, label: t('timeline.stage.day60') || 'Day 60', sublabel: t('timeline.stage.day60.sub') || 'Running' },
    { key: 'd90', day: 90, label: t('timeline.stage.day90') || 'Day 90', sublabel: t('timeline.stage.day90.sub') || 'Automated' },
  ], [t]);

  // Determine current stage based on REAL account age
  const getCurrentStageIndex = useCallback(() => {
    for (let i = TIMELINE_STAGES.length - 1; i >= 0; i--) {
      if (accountAgeDays >= TIMELINE_STAGES[i].day) {
        return i;
      }
    }
    return 0;
  }, [accountAgeDays, TIMELINE_STAGES]);

  // State
  const [selectedStageIndex, setSelectedStageIndex] = useState(getCurrentStageIndex);
  const [selectedNode, setSelectedNode] = useState<string>(() =>
    pipelineStages.length > 0 ? pipelineStages[0].stage_key : 'lead'
  );
  const [tipIndex, setTipIndex] = useState(0);
  const [autoAccepted, setAutoAccepted] = useState(false);
  const [autoThreshold, setAutoThreshold] = useState(14);

  // Update stage when account age changes
  useEffect(() => {
    setSelectedStageIndex(getCurrentStageIndex());
  }, [getCurrentStageIndex]);

  // Update selected node when pipeline stages load
  useEffect(() => {
    if (pipelineStages.length > 0 && selectedNode === 'lead') {
      setSelectedNode(pipelineStages[0].stage_key);
    }
  }, [pipelineStages, selectedNode]);

  const currentStage = TIMELINE_STAGES[selectedStageIndex];

  // ===========================
  // Derive funnel data from REAL stats
  // ===========================

  const stats = funnelStats || { found: 0, touch: 0, booked: 0, paid: 0, paidAmount: 0 };
  // Check if website is published OR if there's no website in setup (user doesn't need one)
  // If no website item exists at all, consider it "not blocking" for funnel display
  const websiteItem = setupItems.find(item => item.id === 'website');
  const hasPublished = websiteItem ? websiteItem.completed : true; // No website requirement = not in setup mode
  const hasHours = setupItems.some(item => item.id === 'availability' && item.completed);
  const hasPayments = setupItems.some(item => item.id === 'payments' && item.completed);
  const setupComplete = setupItems.filter(item => item.completed).length;
  const setupTotal = setupItems.length;

  // Build funnel stations from REAL CRM pipeline stages
  const funnelStations: FunnelStation[] = useMemo(() => {
    const isSetupMode = !hasPublished;

    // If we have real pipeline stages, use them
    if (pipelineStages.length > 0) {
      return pipelineStages.map((stage) => ({
        k: stage.stage_key,
        n: isSetupMode ? '—' : (stage.count ?? 0).toString(),
        lb: stage.stage_label, // Use user's custom label directly
        off: isSetupMode,
        color: stage.color,
      }));
    }

    // Fallback to hardcoded if no pipeline stages (shouldn't happen in production)
    return [
      {
        k: 'lead',
        n: isSetupMode ? '—' : stats.touch.toString(),
        lb: 'Lead',
        off: isSetupMode,
      },
      {
        k: 'active_client',
        n: isSetupMode ? '—' : stats.booked.toString(),
        lb: 'Active Client',
        off: isSetupMode,
      },
      {
        k: 'completed',
        n: isSetupMode ? '—' : stats.paid.toString(),
        lb: 'Completed',
        off: isSetupMode,
      },
    ];
  }, [hasPublished, pipelineStages, stats, t]);

  // Calculate gap states dynamically between consecutive pipeline stages
  const funnelGaps: FunnelGap[] = useMemo(() => {
    const isSetupMode = !hasPublished;
    const stages = pipelineStages.length > 0 ? pipelineStages : [];

    // Need at least 2 stages to have gaps
    if (stages.length < 2 || isSetupMode) {
      return stages.slice(0, -1).map((_, i) => ({
        k: `g${i + 1}`,
        state: 'off' as GapState,
      }));
    }

    // Calculate gap state between each consecutive pair of stages
    return stages.slice(0, -1).map((stage, i) => {
      const nextStage = stages[i + 1];
      const fromCount = stage.count;
      const toCount = nextStage.count;

      // Determine gap state based on conversion rate
      let state: GapState;
      let lb: string | undefined;

      if (fromCount === 0) {
        state = 'off';
      } else if (fromCount < 5) {
        // Not enough data to judge
        state = 'watch';
        lb = t('gap.tooEarly') || 'too early to tell';
      } else {
        const conversionRate = toCount / fromCount;
        if (conversionRate >= 0.5) {
          state = 'ok';
        } else if (conversionRate >= 0.25) {
          state = 'watch';
          lb = t('gap.watchConversion') || 'watching';
        } else {
          state = 'leak';
          const dropped = fromCount - toCount;
          lb = `${dropped} ${t('gap.dropped') || 'dropped off'}`;
        }
      }

      return {
        k: `g${i + 1}`,
        state,
        lb,
      };
    });
  }, [hasPublished, pipelineStages, t]);

  // Build tips from REAL data (actionable suggestions)
  const tips: Tip[] = useMemo(() => {
    const result: Tip[] = [];

    // Setup mode - tip to publish
    if (!hasPublished) {
      result.push({
        at: 'found',
        n: 1,
        t: t('tip.setup.title') || 'One thing to do',
        s: t('tip.setup.desc') || 'Publish your website. Everything else on this page waits on it.',
      });
      return result;
    }

    // Running mode - tips based on real gaps
    const g2 = funnelGaps.find(g => g.k === 'g2');
    if (g2?.state === 'leak' && stats.touch > stats.booked) {
      result.push({
        at: 'g2',
        n: result.length + 1,
        t: t('tip.followup.title') || 'Follow up',
        s: `${stats.touch - stats.booked} ${t('tip.followup.desc') || 'people asked but didn\'t book. A note costs nothing.'}`,
      });
    }

    // Low reach tip
    if (stats.found > 0 && stats.found < 50) {
      result.push({
        at: 'found',
        n: result.length + 1,
        t: t('tip.reach.title') || 'Increase reach',
        s: t('tip.reach.desc') || 'Your rate is fine. Your reach isn\'t — consider more channels.',
      });
    }

    return result;
  }, [hasPublished, funnelGaps, stats, t]);

  // Build milestones from REAL data
  const milestones: Milestone[] = useMemo(() => {
    const md = milestoneData || {};
    const visitorDate = md.firstVisitor?.date ? formatMilestoneDate(md.firstVisitor.date) : '';
    const enquiryDate = md.firstEnquiry?.date ? formatMilestoneDate(md.firstEnquiry.date) : '';
    const bookingDate = md.firstBooking?.date ? formatMilestoneDate(md.firstBooking.date) : '';

    return [
      {
        t: t('milestone.firstVisitor') || 'First visitor',
        s: md.firstVisitor
          ? visitorDate
          : (t('milestone.waiting.visitor') || 'Usually within a few hours of publishing.'),
        w: md.firstVisitor ? visitorDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstVisitor,
      },
      {
        t: t('milestone.firstEnquiry') || 'First enquiry',
        s: md.firstEnquiry
          ? `${enquiryDate} · ${t('milestone.answered') || 'answered in'} ${md.firstEnquiry.responseTime}`
          : (t('milestone.waiting.enquiry') || 'Most businesses see one in the first week or two.'),
        w: md.firstEnquiry ? enquiryDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstEnquiry,
      },
      {
        t: t('milestone.firstBooking') || 'First booking',
        // Show date only - amount no longer available from booking table
        s: md.firstBooking
          ? bookingDate
          : (t('milestone.waiting.booking') || 'I\'ll tell you the moment it happens.'),
        w: md.firstBooking ? bookingDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstBooking,
      },
    ];
  }, [milestoneData, t, formatMilestoneDate]);

  // Build drawer content based on REAL data
  const getDrawerContent = useCallback((): DrawerContent => {
    const isSetupMode = !hasPublished;
    const stages = pipelineStages.length > 0 ? pipelineStages : [];

    // Map action keys to translated button labels
    const getActionLabel = (action?: string): string | undefined => {
      if (!action) return undefined;
      const labels: Record<string, string> = {
        publish_website: t('action.publish') || 'Publish',
        add_services: t('action.add') || 'Add',
        set_hours: t('action.setup') || 'Set up',
        connect_payments: t('action.connect') || 'Connect',
        sync_calendar: t('action.connect') || 'Connect',
        setup_intake: t('action.setup') || 'Set up',
      };
      return labels[action] || t('action.setup') || 'Set up';
    };

    // Day 1 checklist - show ALL setup items when timeline Day 1 is selected
    if (selectedStageIndex === 0 && setupItems.length > 0) {
      // Items default to required — only the ones explicitly marked optional
      // (calendar, intake) are excluded from the "ready for clients" verdict.
      const requiredItems = setupItems.filter(item => item.required !== false);
      const completedCount = requiredItems.filter(item => item.completed).length;
      const allComplete = completedCount === requiredItems.length;

      // Short labels for compact checklist
      const getShortLabel = (id: string): string => {
        const labels: Record<string, string> = {
          website: t('checklist.website') || 'Website',
          services: t('checklist.services') || 'Services',
          availability: t('checklist.availability') || 'Hours',
          payments: t('checklist.payments') || 'Payments',
          calendar: t('checklist.calendar') || 'Calendar',
          intake: t('checklist.intake') || 'Intake form',
        };
        return labels[id] || id;
      };

      return {
        ey: t('drawer.day1.ey') || 'Day 1 checklist',
        t: allComplete
          ? (t('drawer.day1.complete.title') || 'All set up!')
          : `${completedCount}/${requiredItems.length} ${t('drawer.day1.completed') || 'completed'}`,
        p: allComplete
          ? (t('drawer.day1.complete.desc') || 'Your business is ready to receive clients.')
          : (t('drawer.day1.desc') || 'Complete these steps to start receiving clients.'),
        checklist: setupItems.map(item => ({
          label: getShortLabel(item.id),
          done: item.completed,
          action: item.completed ? undefined : item.action,
          actionLabel: item.completed ? undefined : getActionLabel(item.action),
          required: item.required !== false,
          detail: item.completed ? undefined : item.description,
        })),
      };
    }

    // Setup drawer (legacy) - show for first stage in setup mode when not on Day 1
    const firstStageKey = stages.length > 0 ? stages[0].stage_key : 'lead';
    if (selectedNode === firstStageKey && isSetupMode) {
      return {
        ey: t('drawer.setup.ey') || 'The only station that matters today',
        t: t('drawer.setup.title') || 'Nobody can find you yet',
        p: t('drawer.setup.desc') || 'A few switches stand between an empty map and your first enquiry. I\'ve done the work behind each one — you just say go.',
        todos: setupItems
          .filter(item => !item.completed)
          .slice(0, 3)
          .map(item => ({
            t: item.title,
            s: item.description,
            done: item.completed,
            action: getActionLabel(item.action),
            actionKey: item.action, // Keep original action key for callback
          })),
      };
    }

    // Handle dynamic pipeline stage selection
    if (stages.length > 0) {
      // Find if selectedNode is a stage
      const stageIndex = stages.findIndex(s => s.stage_key === selectedNode);
      if (stageIndex >= 0) {
        const stage = stages[stageIndex];
        return {
          ey: stage.stage_label, // Use user's custom label directly
          t: `${stage.count ?? 0} ${t('drawer.stage.contacts') || 'contacts'}`,
          p: t('drawer.stage.default.desc') || `Contacts currently in the ${stage.stage_label} stage.`,
          // No stats needed - the title already shows the count
        };
      }

      // Find if selectedNode is a gap between stages
      const gapMatch = selectedNode.match(/^g(\d+)$/);
      if (gapMatch) {
        const gapIndex = parseInt(gapMatch[1], 10) - 1;
        if (gapIndex >= 0 && gapIndex < stages.length - 1) {
          const fromStage = stages[gapIndex];
          const toStage = stages[gapIndex + 1];
          const fromCount = fromStage.count ?? 0;
          const toCount = toStage.count ?? 0;
          const dropped = fromCount - toCount;
          const convRate = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0;

          if (fromCount < 5) {
            return {
              ey: t('drawer.gap.early.ey') || `Between ${fromStage.stage_label} and ${toStage.stage_label}`,
              t: t('drawer.gap.early.title') || 'I can\'t call this yet',
              p: t('drawer.gap.early.desc') || `${fromCount} contacts. That's not enough to judge — I need about 5 before I'd trust what this gap is telling me.`,
              conf: {
                t: t('conf.notEnough') || 'Not enough to judge',
                p: t('conf.desc') || 'I need more contacts before I can assess this gap.',
                cur: fromCount,
                need: 5,
              },
            };
          }

          return {
            ey: `${t('drawer.gap.between') || 'Between'} ${fromStage.stage_label} ${t('drawer.gap.and') || 'and'} ${toStage.stage_label}`,
            t: dropped > 0
              ? `${dropped} ${t('drawer.gap.dropped') || 'dropped off'}`
              : t('drawer.gap.healthy') || 'Healthy conversion',
            p: dropped > 0
              ? t('drawer.gap.dropped.desc') || 'Some contacts didn\'t move to the next stage.'
              : t('drawer.gap.healthy.desc') || 'Most contacts are progressing through this stage.',
            hero: dropped > fromCount * 0.5, // Show red border if more than 50% dropped
            stats: [
              { v: fromCount.toString(), l: fromStage.stage_label, s: t('stat.from') || 'from' },
              { v: toCount.toString(), l: toStage.stage_label, s: `${convRate}%`, bad: convRate < 50 },
            ],
          };
        }
      }
    }

    // Gap 1: Found -> Touch
    if (selectedNode === 'g1') {
      if (stats.found < 25) {
        return {
          ey: t('drawer.g1.early.ey') || 'Between found you and got in touch',
          t: t('drawer.g1.early.title') || 'I can\'t call this yet',
          p: t('drawer.g1.early.desc') || `${stats.found} people looked. That's not enough to judge — I need about 25 visitors before I'd trust what this gap is telling me.`,
          conf: {
            t: t('conf.notEnough') || 'Not enough to judge',
            p: t('conf.desc') || 'I need about 25 visitors before I\'d trust what this gap is telling me.',
            cur: stats.found,
            need: 25,
          },
        };
      }

      const convRate = stats.found > 0 ? Math.round((stats.touch / stats.found) * 100) : 0;
      return {
        ey: t('drawer.g1.ey') || 'Between found you and got in touch',
        t: `${convRate}% ${t('drawer.g1.title') || 'conversion rate'}`,
        p: stats.touch === 0
          ? (t('drawer.g1.none.desc') || 'Nobody has got in touch yet. Check your contact forms and call-to-actions.')
          : `${stats.touch} ${t('drawer.g1.desc') || 'people got in touch from'} ${stats.found} ${t('drawer.g1.visitors') || 'visitors'}.`,
        stats: [
          { v: stats.found.toString(), l: t('stat.found') || 'Found you', s: t('stat.thisWeek') || 'this week' },
          { v: stats.touch.toString(), l: t('stat.touch') || 'Got in touch', s: `${convRate}%` },
        ],
      };
    }

    // Gap 2: Touch -> Booked (the leak spot)
    if (selectedNode === 'g2') {
      const wentQuiet = stats.touch - stats.booked;
      if (wentQuiet > 0) {
        return {
          ey: t('drawer.g2.ey') || 'Between got in touch and booked',
          t: `${wentQuiet} ${t('drawer.g2.title') || 'people asked, then went quiet'}`,
          p: t('drawer.g2.desc') || 'They got an answer quickly. They opened the booking page. They didn\'t finish. A short note costs nothing.',
          hero: true,
          stats: [
            { v: stats.touch.toString(), l: t('stat.gotInTouch') || 'Got in touch', s: t('stat.allAnswered') || 'all answered' },
            { v: stats.booked.toString(), l: t('stat.booked') || 'Booked', s: wentQuiet > 0 ? `${Math.round((stats.booked / stats.touch) * 100)}%` : '', bad: wentQuiet > stats.booked },
            { v: wentQuiet.toString(), l: t('stat.wentQuiet') || 'Went quiet', s: t('stat.followUp') || 'follow up?' },
          ],
          pl: wentQuiet > 0 ? {
            tx: t('pilot.followup') || 'These people are more likely to book if I write now.',
            act: t('pilot.followup.action') || 'Write to them',
          } : undefined,
        };
      }

      return {
        ey: t('drawer.g2.ok.ey') || 'Between got in touch and booked',
        t: t('drawer.g2.ok.title') || 'Everyone who asked has booked',
        p: t('drawer.g2.ok.desc') || 'This is as good as it gets. Nothing to fix here.',
      };
    }

    // Gap 3: Booked -> Paid
    if (selectedNode === 'g3') {
      const unpaid = stats.booked - stats.paid;
      if (unpaid > 0) {
        return {
          ey: t('drawer.g3.ey') || 'Between booked and paid',
          t: `${unpaid} ${t('drawer.g3.title') || 'unpaid'}`,
          p: t('drawer.g3.desc') || 'Some sessions were booked but haven\'t been paid yet.',
          stats: [
            { v: stats.booked.toString(), l: t('stat.booked') || 'Booked', s: t('stat.total') || 'total' },
            { v: stats.paid.toString(), l: t('stat.paid') || 'Paid', s: formatCurrency(stats.paidAmount), good: true },
          ],
        };
      }

      return {
        ey: t('drawer.g3.ok.ey') || 'Between booked and paid',
        t: t('drawer.g3.ok.title') || 'Everything is paid',
        p: t('drawer.g3.ok.desc') || 'No outstanding payments.',
      };
    }

    // Station: Found
    if (selectedNode === 'found') {
      return {
        ey: t('drawer.found.ey') || 'Where they came from',
        t: `${stats.found} ${t('drawer.found.title') || 'people found you'}`,
        p: t('drawer.found.desc') || 'Check your analytics to see which channels are working.',
        stats: [
          { v: stats.found.toString(), l: t('stat.found') || 'Found you', s: t('stat.thisWeek') || 'this week' },
        ],
      };
    }

    // Station: Touch
    if (selectedNode === 'touch') {
      return {
        ey: t('drawer.touch.ey') || 'Enquiries',
        t: `${stats.touch} ${t('drawer.touch.title') || 'people got in touch'}`,
        p: t('drawer.touch.desc') || 'Every form, call, and message lands here.',
        stats: [
          { v: stats.touch.toString(), l: t('stat.enquiries') || 'Enquiries', s: t('stat.thisWeek') || 'this week' },
        ],
      };
    }

    // Station: Booked
    if (selectedNode === 'booked') {
      return {
        ey: t('drawer.booked.ey') || 'Your calendar',
        t: `${stats.booked} ${t('drawer.booked.title') || 'booked'}`,
        p: t('drawer.booked.desc') || 'Confirmed sessions on your calendar.',
        stats: [
          { v: stats.booked.toString(), l: t('stat.booked') || 'Booked', s: t('stat.thisWeek') || 'this week' },
        ],
      };
    }

    // Station: Paid
    if (selectedNode === 'paid') {
      return {
        ey: t('drawer.paid.ey') || 'Money',
        t: formatCurrency(stats.paidAmount),
        p: t('drawer.paid.desc') || 'Collected this period.',
        stats: [
          { v: formatCurrency(stats.paidAmount), l: t('stat.collected') || 'Collected', s: t('stat.thisWeek') || 'this week', good: true },
          { v: stats.paid.toString(), l: t('stat.paidSessions') || 'Paid sessions', s: '' },
        ],
      };
    }

    // Default
    return {
      ey: t('drawer.default.ey') || 'Selected',
      t: t('drawer.default.title') || 'Nothing here yet',
      p: t('drawer.default.desc') || 'This part of the map switches on when there\'s something real to show.',
    };
  }, [selectedNode, selectedStageIndex, hasPublished, setupItems, stats, pipelineStages, formatCurrency, t]);

  // Build verdict from REAL data
  const verdict = useMemo(() => {
    if (!hasPublished) {
      return {
        status: 'warn' as const,
        text: t('verdict.setup') || 'Nothing can reach you yet.',
        sub: t('verdict.setup.sub') || 'Your business is configured but not live. Publishing takes about two minutes.',
        when: t('verdict.setup.when') || 'Not published',
      };
    }

    if (stats.booked > 0) {
      return {
        status: 'ok' as const,
        text: `${stats.found} ${t('verdict.running.found') || 'found you'}. ${stats.touch} ${t('verdict.running.wrote') || 'wrote'}. ${stats.booked} ${t('verdict.running.booked') || 'booked'} — ${formatCurrency(stats.paidAmount)}.`,
        sub: t('verdict.running.sub') || 'Everything\'s running.',
        when: t('verdict.running.when') || 'This week',
      };
    }

    if (stats.found > 0) {
      return {
        status: 'ok' as const,
        text: `${t('verdict.live') || 'You\'re live'}. ${stats.found} ${t('verdict.live.found') || 'people have found you'}.`,
        sub: stats.found < 25
          ? (t('verdict.live.early') || 'At this point that tells me nothing — I\'d expect the first enquiry around 25 visitors.')
          : (t('verdict.live.sub') || 'Looking good so far.'),
        when: t('verdict.live.when') || 'Since you published',
      };
    }

    return {
      status: 'ok' as const,
      text: t('verdict.justPublished') || 'You\'re live. Waiting for first visitors.',
      sub: t('verdict.justPublished.sub') || 'Usually within a few hours.',
      when: t('verdict.justPublished.when') || 'Just published',
    };
  }, [hasPublished, stats, formatCurrency, t]);

  // Ghost projection (only in setup mode)
  const ghost: GhostProjection | undefined = useMemo(() => {
    if (!hasPublished) {
      return {
        t: t('ghost.title') || 'About 40 people a week search for a business like yours nearby.',
        s: t('ghost.sub') || 'That\'s the pool this map will fill from once you\'re live.',
        tag: t('ghost.tag') || 'My estimate from your area and category — not your numbers.',
      };
    }
    return undefined;
  }, [hasPublished, t]);

  // Footer replay data from REAL autonomous work
  const replayData: ReplayModal = useMemo(() => {
    const work = autonomousWorkData.length > 0 ? autonomousWorkData : autonomousWork.slice(0, 6).map(w => ({
      title: w.displayTitle,
      detail: w.displayMessage || `${w.outcome.itemsSucceeded} completed`,
    }));

    return {
      h: t('replay.header') || 'Recently',
      s: work.length > 0
        ? `${work.length} ${t('replay.subtitle') || 'things happened. You approved none of them, because you already had.'}`
        : (t('replay.empty') || 'Nothing to show yet.'),
      rows: work.map(w => ({ b: w.title, s: w.detail })),
    };
  }, [autonomousWorkData, autonomousWork, t]);

  // Vector maturity from REAL data
  const vectorStates = useMemo(() => {
    const vm = vectorMaturity;
    if (!vm) {
      return {
        wins: 'dark' as VectorState,
        conv: 'dark' as VectorState,
        ops: 'dark' as VectorState,
        cash: 'dark' as VectorState,
        leads: 'dark' as VectorState,
        ret: 'dark' as VectorState,
        price: 'dark' as VectorState,
      };
    }

    // Map real vector states
    const mapState = (count: number, threshold: number): VectorState => {
      if (count >= threshold) return 'lit';
      if (count > 0) return 'learn';
      return 'dark';
    };

    return {
      wins: stats.booked > 0 ? 'lit' : 'dark',
      conv: mapState(stats.found, 25),
      ops: stats.booked > 0 ? 'lit' : stats.touch > 0 ? 'learn' : 'dark',
      cash: stats.paidAmount > 0 ? 'lit' : stats.booked > 0 ? 'learn' : 'dark',
      leads: mapState(stats.touch, 5),
      ret: accountAgeDays >= 60 ? (stats.booked >= 2 ? 'lit' : 'learn') : 'dark',
      price: accountAgeDays >= 42 ? (stats.booked >= 10 ? 'lit' : 'learn') : 'dark',
    };
  }, [vectorMaturity, stats, accountAgeDays]);

  const litCount = Object.values(vectorStates).filter(s => s === 'lit').length;
  const vectorNote = useMemo(() => {
    if (litCount === 0) return t('vecs.note.0') || 'Reading 0 of 7. I start watching the moment you publish.';
    if (litCount <= 2) return t('vecs.note.early') || `Reading ${litCount} of 7. Some vectors need more data or time.`;
    if (litCount <= 5) return t('vecs.note.mid') || `Reading ${litCount} of 7. Getting clearer.`;
    return t('vecs.note.full') || 'Reading 7 of 7. This is the whole business now.';
  }, [litCount, t]);

  // Handlers
  const handleStageClick = useCallback((index: number) => {
    setSelectedStageIndex(index);
  }, []);

  const handleNodeSelect = useCallback((nodeKey: string) => {
    setSelectedNode(nodeKey);
    const tipForNode = tips.findIndex(tip => tip.at === nodeKey);
    if (tipForNode >= 0) setTipIndex(tipForNode);
  }, [tips]);

  const handleTipSelect = useCallback((tip: Tip) => {
    setSelectedNode(tip.at);
  }, []);

  const handleDrawerAction = useCallback((action: string) => {
    if (onAction) onAction(action);
    if (onConfigureClick) {
      if (action.toLowerCase().includes('publish')) onConfigureClick('website');
      else if (action.toLowerCase().includes('hours')) onConfigureClick('availability');
      else if (action.toLowerCase().includes('write') || action.toLowerCase().includes('send')) onConfigureClick('followup');
    }
  }, [onAction, onConfigureClick]);

  // Show advisor card only when mature (Day 90+ style - when automation is offered)
  const showAdvisorCard = accountAgeDays >= 90 && litCount >= 5;

  return (
    <section
      className="bg-[var(--v2-bg)] border border-[var(--v2-border)] relative overflow-hidden"
      style={{
        borderRadius: '22px',
        padding: '22px 24px',
        boxShadow: '0 20px 50px -34px rgba(20, 26, 43, 0.4)',
        direction: isRTL ? 'rtl' : 'ltr',
      }}
    >
      {/* Background glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-40%',
          [isRTL ? 'left' : 'right']: '-6%',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255, 180, 84, 0.16), transparent 68%)',
        }}
      />

      {/* Page header with greeting + collapse button */}
      <div className={collapsed ? 'mb-0' : 'mb-6'}>
        <div className="flex items-start justify-between gap-4 mb-1">
          {/* Greeting */}
          <div className="flex-1">
            <h1
              className="text-[var(--v2-text-primary)]"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: 'clamp(23px, 3.6vw, 31px)',
                fontWeight: 600,
                letterSpacing: '-0.025em',
              }}
            >
              {greetingText}, {userName}
            </h1>
          </div>
          {/* Date + Collapse button */}
          <div className="flex items-center gap-3">
            <div className={`flex-none ${isRTL ? 'text-start' : 'text-end'}`}>
              <b
                className="block text-[var(--v2-text-primary)]"
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                {dayName}
              </b>
              <span className="text-xs text-[var(--v2-text-muted)]">{dateStr}</span>
            </div>
            {/* Collapse/Expand button */}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-2 rounded-lg hover:bg-[var(--v2-bg-secondary)] transition-colors"
                title={collapsed ? (t('insight.expand') || 'Expand') : (t('insight.collapse') || 'Collapse')}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--v2-text-muted)]"
                  style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
            )}
          </div>
        </div>
        {!collapsed && (
          <p
            className="text-[var(--v2-text-muted)]"
            style={{ fontSize: '15px', maxWidth: '52rem' }}
          >
            {setupComplete < setupTotal
              ? (t('liveDashboard.setup') || `${setupComplete} of ${setupTotal} setup steps complete. The map shows what's built and what's waiting.`)
              : (t('liveDashboard.running') || "Your live dashboard. The map shows what's flowing and where to look.")}
          </p>
        )}
      </div>

      {/* Collapsible content - everything below the header */}
      {!collapsed && (
        <>
      {/* Timeline Scrubber - CLICKABLE */}
      <div
        className="mb-6"
        style={{
          background: '#FFFFFF',
          border: '1px solid #E7E9F1',
          borderRadius: '18px',
          padding: '18px 16px 14px',
          boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        }}
      >
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: '#697187',
            marginBottom: '14px',
            paddingLeft: '2px',
          }}
        >
          {t('timeline.header') || 'Your journey'}
        </div>

        <div style={{ display: 'flex', position: 'relative' }}>
          {/* Connection line */}
          <div
            style={{
              position: 'absolute',
              [isRTL ? 'right' : 'left']: '11%',
              top: '11px',
              height: '2px',
              width: '78%',
              background: '#E7E9F1',
            }}
          />

          {/* Timeline nodes */}
          {TIMELINE_STAGES.map((stage, index) => {
            const isCurrent = accountAgeDays >= stage.day && (index === TIMELINE_STAGES.length - 1 || accountAgeDays < TIMELINE_STAGES[index + 1].day);
            const isSelected = index === selectedStageIndex;
            const isPast = accountAgeDays >= stage.day && !isCurrent;
            const isFuture = accountAgeDays < stage.day;

            return (
              <button
                key={stage.key}
                onClick={() => handleStageClick(index)}
                disabled={isFuture}
                style={{
                  flex: 1,
                  position: 'relative',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '9px',
                  background: 'none',
                  border: 'none',
                  cursor: isFuture ? 'not-allowed' : 'pointer',
                  padding: 0,
                  opacity: isFuture ? 0.5 : 1,
                }}
              >
                {/* Dot */}
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: isSelected
                      ? 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)'
                      : '#FFFFFF',
                    border: isSelected
                      ? 'none'
                      : isPast || isCurrent
                      ? '2px solid #F9C79A'
                      : '2px solid #E7E9F1',
                    position: 'relative',
                    zIndex: 1,
                    transition: '0.25s',
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: isSelected ? '0 0 0 4px rgba(249,115,22,0.16)' : 'none',
                  }}
                >
                  <i
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isSelected ? '#FFFFFF' : isPast || isCurrent ? '#F9C79A' : '#E7E9F1',
                      transition: '0.25s',
                      display: 'block',
                    }}
                  />
                </span>

                {/* Text */}
                <span>
                  <b
                    style={{
                      display: 'block',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      color: isSelected ? '#C2410C' : isCurrent ? '#F97316' : '#131A2B',
                    }}
                  >
                    {stage.label}
                  </b>
                  <small
                    style={{
                      display: 'block',
                      fontSize: '11.5px',
                      color: '#697187',
                      marginTop: '1px',
                      lineHeight: 1.35,
                    }}
                  >
                    {stage.sublabel}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* System readiness — sits directly under the timeline, ahead of every
          metric, because an unconfigured system makes the numbers below it moot. */}
      <SystemReadiness items={setupItems} onAction={onAction} />

      {/* Verdict Card */}
      <VerdictCard
        status={verdict.status}
        verdict={verdict.text}
        verdictSub={verdict.sub}
        when={verdict.when}
      />

      {/* Tips Stepper */}
      {tips.length > 0 && (
        <TipsStepper
          tips={tips}
          onSelectTip={handleTipSelect}
        />
      )}

      {/* Funnel Map */}
      <FunnelMap
        stations={funnelStations}
        gaps={funnelGaps}
        tips={tips.map(tip => ({ at: tip.at, n: tip.n }))}
        selectedKey={selectedNode}
        onSelectNode={handleNodeSelect}
        ghost={ghost}
      />

      {/* Funnel Drawer */}
      <FunnelDrawer
        content={getDrawerContent()}
        onAction={handleDrawerAction}
      />

      {/* Advisor Card - always shows, content changes by stage */}
      <div
        className="adv"
        style={{
          marginTop: '16px',
          background: '#FFFFFF',
          border: '1px solid #E7E9F1',
          borderRadius: '18px',
          padding: '20px 22px',
          boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        }}
      >
        {/* Top row: orb + eyebrow + category */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
          {/* Orb */}
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #FED7AA 0%, #FDBA74 50%, #FB923C 100%)',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 4px 12px -4px rgba(249, 115, 22, 0.4)',
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', fill: '#FFFFFF' }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>

          {/* Eyebrow text */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#F97316', letterSpacing: '0.02em' }}>
              {t('advisor.eyebrow') || 'Your advisor'}
            </div>
            <div style={{ fontSize: '13px', color: '#697187', marginTop: '2px' }}>
              {!hasPublished
                ? (t('advisor.eyebrow.setup') || 'Nothing to advise on yet — so here\'s the only thing that matters')
                : litCount === 0
                ? (t('advisor.eyebrow.waiting') || 'Watching, but nothing to advise on yet')
                : (t('advisor.eyebrow.active') || `Watching ${litCount} of 7 vectors`)
              }
            </div>
          </div>

          {/* Category badge */}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#F97316',
              background: '#FFF7ED',
              border: '1px solid #FDBA74',
              borderRadius: '20px',
              padding: '5px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            {!hasPublished
              ? (t('advisor.badge.setup') || 'Getting you switched on')
              : accountAgeDays >= 90
              ? (t('advisor.badge.automate') || 'Ready to automate')
              : accountAgeDays >= 18
              ? (t('advisor.badge.running') || 'Running')
              : (t('advisor.badge.early') || 'Early days')
            }
          </span>
        </div>

        {/* Headline */}
        <h3
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '19px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#131A2B',
            marginBottom: '8px',
          }}
        >
          {!hasPublished
            ? (t('advisor.headline.setup') || 'Everything is built. None of it is on.')
            : accountAgeDays >= 90
            ? (t('advisor.headline.automate') || 'Want me to handle things automatically?')
            : stats.booked > 0
            ? (t('advisor.headline.running') || 'Things are moving.')
            : (t('advisor.headline.waiting') || 'Waiting for first activity.')
          }
        </h3>

        {/* Description */}
        <p style={{ fontSize: '14px', color: '#697187', lineHeight: 1.55, marginBottom: '18px' }}>
          {!hasPublished
            ? (t('advisor.desc.setup') || 'I can\'t tell you anything about your business until your business is reachable. One button changes that, and I\'ve done the rest.')
            : accountAgeDays >= 90
            ? (t('advisor.desc.automate') || 'I know your patterns now. I can chase invoices, follow up on quiet leads, and handle routine tasks without asking.')
            : stats.booked > 0
            ? (t('advisor.desc.running') || 'The funnel is flowing. I\'m watching for patterns and will let you know when I see something.')
            : (t('advisor.desc.waiting') || 'Your website is live. Now we wait for visitors to start the flow.')
          }
        </p>

        {/* Projection columns (setup mode) */}
        {!hasPublished && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '18px' }}>
            {/* Before */}
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '12px',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                {t('advisor.proj.now') || 'Right now'}
              </div>
              <div style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif', fontSize: '17px', fontWeight: 600, color: '#131A2B' }}>
                {t('advisor.proj.now.val') || '0 ways in'}
              </div>
              <div style={{ fontSize: '12.5px', color: '#697187', marginTop: '2px' }}>
                {t('advisor.proj.now.sub') || 'nobody can find you'}
              </div>
            </div>

            {/* After */}
            <div
              style={{
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: '12px',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                {t('advisor.proj.after') || 'Two minutes from now'}
              </div>
              <div style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif', fontSize: '17px', fontWeight: 600, color: '#131A2B' }}>
                {t('advisor.proj.after.val') || 'Live'}
              </div>
              <div style={{ fontSize: '12.5px', color: '#697187', marginTop: '2px' }}>
                {t('advisor.proj.after.sub') || 'Google usually indexes within the hour'}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Primary action */}
          <button
            onClick={() => {
              if (!hasPublished) {
                onConfigureClick?.('website');
              } else if (accountAgeDays >= 90) {
                setAutoAccepted(true);
              } else {
                // "View funnel" action - navigate to CRM
                onAction?.('view_funnel');
              }
            }}
            style={{
              background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 12px -4px rgba(249, 115, 22, 0.4)',
              transition: 'all 0.15s',
            }}
          >
            {!hasPublished
              ? (t('advisor.action.publish') || 'Publish it')
              : accountAgeDays >= 90
              ? (t('advisor.action.automate') || 'Yes, automate it')
              : (t('advisor.action.viewFunnel') || 'View the funnel')
            }
          </button>

          {/* Secondary action */}
          {!hasPublished && (
            <button
              onClick={() => onConfigureClick?.('website')}
              style={{
                background: '#FFFFFF',
                color: '#131A2B',
                border: '1.5px solid #E7E9F1',
                borderRadius: '12px',
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t('advisor.action.preview') || 'Show me what you built'}
            </button>
          )}
        </div>

        {/* Automation accepted state */}
        {autoAccepted && accountAgeDays >= 90 && (
          <div
            style={{
              marginTop: '16px',
              padding: '14px 16px',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', fill: '#22C55E' }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <div>
                <div style={{ fontWeight: 600, color: '#166534', fontSize: '14px' }}>
                  {t('advisor.auto.done.title') || 'Done — I\'ll handle it from now on'}
                </div>
                <div style={{ fontSize: '13px', color: '#697187', marginTop: '2px' }}>
                  {t('advisor.auto.done.desc') || 'Anything that matches the pattern, I\'ll take care of. You\'ll see it in your daily summary.'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vectors strip below advisor card */}
      <div
        style={{
          marginTop: '12px',
          background: '#FBFCFE',
          border: '1px solid #E7E9F1',
          borderRadius: '14px',
          padding: '14px 18px',
        }}
      >
        <div
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#697187',
            marginBottom: '10px',
          }}
        >
          {t('vecs.header') || 'What I\'m watching'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
          {Object.entries(vectorStates).map(([key, state]) => (
            <span
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: `1px solid ${state === 'lit' ? '#CFEDDF' : state === 'learn' ? '#F0E2CC' : '#E7E9F1'}`,
                background: state === 'lit' ? '#F5FCF9' : state === 'learn' ? '#FFFCF7' : '#fff',
                borderRadius: '18px',
                padding: '5px 11px 5px 9px',
                fontSize: '12px',
                color: state === 'lit' ? '#131A2B' : state === 'learn' ? '#8A7A5E' : '#9AA1B2',
                fontWeight: state === 'lit' ? 600 : 400,
              }}
            >
              <i
                style={{
                  width: state === 'learn' ? '9px' : '7px',
                  height: state === 'learn' ? '9px' : '7px',
                  borderRadius: '50%',
                  background: state === 'lit' ? '#22C58B' : state === 'learn' ? '#fff' : '#DDE1EA',
                  border: state === 'learn' ? '2px dotted #FFB24D' : 'none',
                  boxShadow: state === 'lit' ? '0 0 0 3px rgba(34,197,139,0.16)' : 'none',
                  flexShrink: 0,
                }}
              />
              {t(`vector.${key}`) || key.charAt(0).toUpperCase() + key.slice(1)}
            </span>
          ))}
        </div>
        <p style={{ fontSize: '12px', color: '#697187', marginTop: '10px', lineHeight: 1.45 }}>
          {vectorNote}
        </p>
      </div>

      {/* First Light Milestones */}
      <FirstLightMilestones milestones={milestones} />

      {/* Footer Replay */}
      {replayData.rows.length > 0 && (
        <FooterReplay
          label={t('replay.button') || 'See what happened'}
          modal={replayData}
        />
      )}

      {/* Handled section (only if there's autonomous work) */}
      {autonomousWork.length > 0 && (
        <div
          style={{
            marginTop: '16px',
            background: '#FFFFFF',
            border: '1px solid #E7E9F1',
            borderRadius: '18px',
            padding: '15px 22px 18px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: '#697187',
              marginBottom: '10px',
            }}
          >
            {t('handled.header') || 'What I\'ve handled for you'}
          </div>
          {autonomousWork.slice(0, 4).map((work, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                padding: '7px 0',
              }}
            >
              <span
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: '#E6F8F0',
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  marginTop: '1px',
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: '10px', height: '10px', stroke: '#1B9A6C', fill: 'none', strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                  <path d="M4 12l6 6L20 5" />
                </svg>
              </span>
              <span>
                <b style={{ fontSize: '13.5px', fontWeight: 600, display: 'block' }}>
                  {work.displayTitle}
                </b>
                <small style={{ fontSize: '12.5px', color: '#697187' }}>
                  {work.displayMessage || `${work.outcome.itemsSucceeded} completed`}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </section>
  );
}
