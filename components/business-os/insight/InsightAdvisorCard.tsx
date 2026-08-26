'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2, Check, Clock } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { BeforeAfterPanel, type ProjectionColumn } from './BeforeAfterPanel';
import { VectorsStrip } from './VectorsStrip';
import { HandledSection, type HandledEntry } from './HandledSection';
import type { InsightData, InsightProjection } from './InsightDetailModal';
import type { VectorMaturityData } from '@/lib/business-os/insight/repository/InsightRepository';

// ===========================
// Types
// ===========================

export type { InsightData, InsightProjection };

export interface AutomationConfig {
  processId: string;
  suggestedParams: Record<string, unknown>;
}

export type InsightCardState = 'default' | 'running' | 'completed' | 'automate_offer' | 'automated';

export type CardStage = 'setup' | 'win' | 'run' | 'automate';

interface PendingInsight extends Omit<InsightData, 'eligible_for_automation'> {
  projection?: InsightProjection;
  eligible_for_automation?: boolean;
  process_parameters?: Record<string, unknown>;
  affected_entity_type?: string;
}

interface InsightAdvisorCardProps {
  insights: PendingInsight[];
  currentIndex: number;
  projection?: InsightProjection;
  automationConfig?: AutomationConfig;
  vectorMaturity?: VectorMaturityData | null;
  handledEntries?: HandledEntry[];
  stage?: CardStage;
  onIndexChange: (index: number) => void;
  onAction: (action: 'run' | 'snooze' | 'dismiss', insightId: string, params?: Record<string, unknown>) => Promise<void>;
  onAutomate: (insightId: string, params: Record<string, unknown>) => Promise<void>;
  onDeclineAutomate: () => void;
}

// ===========================
// Category badge colors
// ===========================

const CATEGORY_COLORS: Record<string, string> = {
  cash_flow: '#F59E0B',
  conversion: '#6366F1',
  ops: '#0EA5E9',
  retention: '#8B5CF6',
  leads: '#EC4899',
  pricing: '#F97316',
  win: '#22C55E',
  setup: '#6366F1',
};

// ===========================
// Running steps
// ===========================

const RUNNING_STEP_KEYS: Record<string, string[]> = {
  cash_ar_overdue: ['insight.step.cash_ar_overdue.1', 'insight.step.cash_ar_overdue.2', 'insight.step.cash_ar_overdue.3'],
  sales_stalled: ['insight.step.sales_stalled.1', 'insight.step.sales_stalled.2', 'insight.step.sales_stalled.3'],
  default: ['insight.step.default.1', 'insight.step.default.2', 'insight.step.default.3'],
};

// ===========================
// Component (matching mockup .adv)
// ===========================

export function InsightAdvisorCard({
  insights,
  currentIndex,
  projection,
  automationConfig,
  vectorMaturity,
  handledEntries,
  stage = 'run',
  onIndexChange,
  onAction,
  onAutomate,
  onDeclineAutomate,
}: InsightAdvisorCardProps) {
  const { t, isRTL, formatCurrency } = useLanguage();
  const [cardState, setCardState] = useState<InsightCardState>('default');
  const [runningStep, setRunningStep] = useState(0);
  const [autoValue, setAutoValue] = useState(
    (automationConfig?.suggestedParams?.days_threshold as number) || 14
  );
  const [vertical, setVertical] = useState<string | null>(null);

  // Fetch user's vertical for personalized advisor badge
  useEffect(() => {
    async function fetchVertical() {
      try {
        const response = await fetch('/api/business-os/business-profile');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setVertical(data.vertical);
          }
        }
      } catch {
        // Silent fail
      }
    }
    fetchVertical();
  }, []);

  const insight = insights[currentIndex];

  // Determine effective stage - if no insights exist, force setup stage
  const effectiveStage = !insight ? 'setup' : stage;

  // Setup stage content (Day 1 - no insights yet)
  const setupContent = {
    title: t('insight.setup.title') || 'Everything is built. None of it is on.',
    description: t('insight.setup.description') || 'I can\'t tell you anything about your business until your business is reachable. One button changes that, and I\'ve done the rest.',
    category: 'setup',
    primaryAction: t('insight.setup.action.primary') || 'Publish it',
    secondaryAction: t('insight.setup.action.secondary') || 'Show me what you built',
    projection: {
      left: {
        label: t('insight.setup.projection.left.label') || 'Right now',
        value: t('insight.setup.projection.left.value') || '0 ways in',
        subtext: t('insight.setup.projection.left.subtext') || 'nobody can find you',
      },
      right: {
        label: t('insight.setup.projection.right.label') || 'Two minutes from now',
        value: t('insight.setup.projection.right.value') || 'Live',
        subtext: t('insight.setup.projection.right.subtext') || 'Google usually indexes within the hour',
      },
    },
  };

  // Use setup content if no insight available
  const displayTitle = insight?.title || setupContent.title;
  const displayDescription = insight?.description || setupContent.description;
  const displayCategory = insight?.category || setupContent.category;

  const categoryColor = CATEGORY_COLORS[displayCategory] || '#F97316';
  const stepKeys = insight ? (RUNNING_STEP_KEYS[insight.detector_id] || RUNNING_STEP_KEYS.default) : RUNNING_STEP_KEYS.default;
  const steps = stepKeys.map(key => t(key));
  const canAutomate = insight?.eligible_for_automation && automationConfig;

  // Get eyebrow text based on stage
  const getEyebrowText = () => {
    switch (effectiveStage) {
      case 'setup':
        return { main: t('insight.advisor') || 'Your advisor', sub: t('insight.stage.setup.eyebrow') || 'Nothing to advise on yet — so here\'s the only thing that matters' };
      case 'win':
        return { main: t('insight.advisor.noticed') || 'Your advisor noticed', sub: t('insight.stage.win.eyebrow') || 'A good thing, which is still worth telling you' };
      case 'automate':
        return { main: t('insight.advisor') || 'Your advisor', sub: t('insight.stage.automate.eyebrow') || 'Third time — so I\'d like to stop asking' };
      default:
        return { main: t('insight.advisor.noticed') || 'Your advisor noticed', sub: '' };
    }
  };

  // Get category label
  const getCategoryLabel = () => {
    if (effectiveStage === 'setup') {
      return t('insight.category.setup') || 'Getting you switched on';
    }
    const key = `insight.category.${displayCategory}`;
    const translated = t(key);
    return translated !== key ? translated : displayCategory;
  };

  // Get "seen" text for first occurrence tracking
  const getSeenText = () => {
    // No "seen" text for setup stage
    if (effectiveStage === 'setup') {
      return null;
    }
    if (effectiveStage === 'win') {
      return t('insight.seen.win') || 'Wins are the only thing I can honestly report this early — they\'re facts, not judgements.';
    }
    if (cardState === 'default' && insight) {
      return t('insight.seen.first') || 'First time I\'ve seen this. I\'ll offer to handle it standing once it has happened a few times.';
    }
    return null;
  };

  // Handle run action
  const handleRun = useCallback(async () => {
    if (!insight) return; // Don't run for setup stage
    setCardState('running');
    setRunningStep(0);

    const interval = setInterval(() => {
      setRunningStep(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setCardState(canAutomate ? 'automate_offer' : 'completed');
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, 800);

    await onAction('run', insight.id);
  }, [insight, onAction, steps.length, canAutomate]);

  // Handle automate
  const handleAutomate = useCallback(async () => {
    if (!insight) return;
    await onAutomate(insight.id, { days_threshold: autoValue });
    setCardState('automated');
  }, [insight, autoValue, onAutomate]);

  // Handle decline automate
  const handleDeclineAutomate = useCallback(() => {
    setCardState('completed');
    onDeclineAutomate();
  }, [onDeclineAutomate]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    await onAction('dismiss', insight.id);
  }, [insight, onAction]);

  // Step automation threshold
  const stepAutoValue = (delta: number) => {
    setAutoValue(Math.max(7, Math.min(45, autoValue + delta * 7)));
  };

  // Build projection columns for BeforeAfterPanel
  const projectionColumns: { left: ProjectionColumn; right: ProjectionColumn } | null =
    effectiveStage === 'setup'
      ? setupContent.projection
      : projection
        ? {
            left: {
              label: t('insight.projection.do_nothing') || 'If you do nothing',
              value: projection.do_nothing?.outcome || `${insight?.affected_count || 0} outstanding`,
              subtext: projection.do_nothing?.detail || '',
            },
            right: {
              label: t('insight.projection.handle_it') || 'If I handle it',
              value: projection.handle_it?.outcome || `~${formatCurrency(insight?.estimated_impact_usd || 0)} recovered`,
              subtext: projection.handle_it?.detail || '',
            },
          }
        : null;

  const eyebrow = getEyebrowText();
  const seenText = getSeenText();

  // CSS Reference from mockup:
  // .adv{background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:0 26px 60px -32px rgba(20,26,44,.3);overflow:hidden;margin-bottom:16px}
  // .adv-in{padding:20px 22px}
  // .adv-top{display:flex;align-items:center;gap:11px;margin-bottom:12px}
  // .adv-orb{width:30px;height:30px;border-radius:50%;background:var(--aurora);flex:none;box-shadow:0 0 0 5px rgba(249,115,22,.12)}
  // .adv-ey{font-size:12.5px;font-weight:600;color:var(--violet)}
  // .adv-ey small{display:block;font-weight:400;color:var(--muted);font-size:11.5px}
  // .adv-vt{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;background:#F1F3F8;color:var(--muted);padding:5px 11px;border-radius:20px;white-space:nowrap}
  // .adv-h{font-family:var(--display);font-size:clamp(19px,2.6vw,23px);font-weight:600;letter-spacing:-.025em;margin-bottom:7px;line-height:1.25}
  // .adv-p{font-size:14.5px;color:var(--muted);max-width:46rem}

  return (
    <div
      className="adv"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        borderRadius: '22px',
        boxShadow: '0 26px 60px -32px rgba(20,26,44,0.3)',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      {/* Main content area: .adv-in */}
      <div className="adv-in" style={{ padding: '20px 22px' }}>
        {/* Top row: .adv-top */}
        <div
          className="adv-top"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            marginBottom: '12px',
          }}
        >
          {/* Orange gradient orb: .adv-orb */}
          <span
            className="adv-orb"
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
              flexShrink: 0,
              boxShadow: '0 0 0 5px rgba(249,115,22,0.12)',
            }}
          />

          {/* Eyebrow text: .adv-ey */}
          <span
            className="adv-ey"
            style={{
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#F97316',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {eyebrow.main}
            {eyebrow.sub && (
              <small
                style={{
                  display: 'block',
                  fontWeight: 400,
                  color: '#697187',
                  fontSize: '11.5px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {eyebrow.sub}
              </small>
            )}
          </span>

          {/* Category badge: .adv-vt */}
          <span
            className="adv-vt"
            style={{
              marginLeft: isRTL ? undefined : 'auto',
              marginRight: isRTL ? 'auto' : undefined,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              background: '#F1F3F8',
              color: '#697187',
              padding: '5px 11px',
              borderRadius: '20px',
              whiteSpace: 'nowrap',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {getCategoryLabel()}
          </span>
        </div>

        {/* Headline: .adv-h */}
        <div
          className="adv-h"
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: 'clamp(19px, 2.6vw, 23px)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            marginBottom: '7px',
            lineHeight: 1.25,
            color: '#131A2B',
          }}
        >
          {displayTitle}
        </div>

        {/* Description: .adv-p */}
        <div
          className="adv-p"
          style={{
            fontSize: '14.5px',
            color: '#697187',
            maxWidth: '46rem',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            lineHeight: 1.5,
          }}
          dangerouslySetInnerHTML={{ __html: displayDescription }}
        />

        {/* Before/After Projection (if available and in default state) */}
        {projectionColumns && cardState === 'default' && (
          <BeforeAfterPanel left={projectionColumns.left} right={projectionColumns.right} />
        )}

        {/* Action buttons (default state): .adv-acts */}
        {cardState === 'default' && (
          <div
            className="adv-acts"
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              marginTop: '16px',
              flexWrap: 'wrap',
            }}
          >
            {/* Primary button: .adv-btn */}
            <button
              onClick={handleRun}
              className="adv-btn"
              style={{
                background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                color: '#FFFFFF',
                borderRadius: '12px',
                padding: '11px 18px',
                fontSize: '14px',
                fontWeight: 600,
                boxShadow: '0 8px 20px -9px rgba(249,115,22,0.9)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {t('insight.action.primary') || 'Handle it for me'}
            </button>
            {/* Secondary button: .adv-lite */}
            <button
              onClick={handleDismiss}
              className="adv-lite"
              style={{
                border: '1.5px solid #E7E9F1',
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '11px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#697187',
                cursor: 'pointer',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {t('insight.action.secondary') || 'Not now'}
            </button>

            {/* "Seen" note: .adv-seen */}
            {seenText && (
              <span
                className="adv-seen"
                style={{
                  fontSize: '12.5px',
                  color: '#697187',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  marginLeft: isRTL ? undefined : 'auto',
                  marginRight: isRTL ? 'auto' : undefined,
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                <Clock
                  style={{
                    width: '14px',
                    height: '14px',
                    stroke: '#697187',
                    fill: 'none',
                    strokeWidth: 2,
                  }}
                />
                {seenText}
              </span>
            )}
          </div>
        )}

        {/* Running state */}
        {cardState === 'running' && (
          <div
            style={{
              marginTop: '16px',
              padding: '16px',
              borderRadius: '14px',
              background: '#F8F9FC',
              border: '1px solid #E7E9F1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <Loader2 style={{ width: '20px', height: '20px', color: '#F97316' }} className="animate-spin" strokeWidth={2.5} />
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#131A2B',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.running') || 'Working on it...'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
                  {i < runningStep ? (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: '#22C58B',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Check style={{ width: '12px', height: '12px', color: '#FFFFFF' }} strokeWidth={3} />
                    </span>
                  ) : i === runningStep ? (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: 'rgba(249,115,22,0.12)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className="animate-pulse"
                        style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F97316' }}
                      />
                    </span>
                  ) : (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: '2px solid #E7E9F1',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ color: i <= runningStep ? '#131A2B' : '#697187', fontWeight: i <= runningStep ? 500 : 400 }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed state - matches .auto-done styling */}
        {cardState === 'completed' && (
          <div
            style={{
              marginTop: '18px',
              border: '1.5px solid #B8E9D3',
              background: '#F3FBF7',
              borderRadius: '16px',
              padding: '17px 18px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <span
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#22C58B',
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 0 0 4px rgba(34,197,139,0.17)',
              }}
            >
              <Check style={{ width: '14px', height: '14px', color: '#FFFFFF' }} strokeWidth={3} />
            </span>
            <div>
              <b
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15.5px',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '3px',
                  color: '#131A2B',
                }}
              >
                {t('insight.completed.title') || 'Done'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: '#697187',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  margin: 0,
                }}
              >
                {t('insight.completed.subtitle') || 'I\'ll keep watching this for you.'}
              </p>
            </div>
          </div>
        )}

        {/* Automation offer state: .auto-offer */}
        {cardState === 'automate_offer' && canAutomate && (
          <div
            className="auto-offer"
            style={{
              marginTop: '18px',
              border: '1.5px solid #FBDCC0',
              background: 'linear-gradient(180deg, #FFF8F2, #FFFDFB)',
              borderRadius: '16px',
              padding: '17px 18px',
            }}
          >
            {/* Eyebrow: .auto-ey */}
            <div
              className="auto-ey"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#F97316',
                marginBottom: '6px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {t('insight.automate.eyebrow') || 'Standing automation'}
            </div>
            {/* Headline: .auto-h */}
            <div
              className="auto-h"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: '17px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                marginBottom: '6px',
                color: '#131A2B',
              }}
            >
              {t('insight.automate.title') || 'Want me to just handle this from now on?'}
            </div>
            {/* Description: .auto-p */}
            <div
              className="auto-p"
              style={{
                fontSize: '13.5px',
                color: '#697187',
                marginBottom: '14px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {t('insight.automate.description') || 'I\'ll watch every invoice and chase the ones that pass your limit. Up to three reminders, a week apart, in your voice. I stop the moment they pay, and I tell you when it works.'}
            </div>

            {/* Threshold control: .auto-thr */}
            <div
              className="auto-thr"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: '#FFFFFF',
                border: '1px solid #F3D2B4',
                borderRadius: '12px',
                padding: '11px 14px',
                flexWrap: 'wrap',
              }}
            >
              {/* Label: .thr-lb */}
              <span
                className="thr-lb"
                style={{
                  fontSize: '13.5px',
                  fontWeight: 500,
                  flex: 1,
                  minWidth: '150px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.automate.threshold_label') || 'Chase anything unpaid after'}
              </span>
              {/* Control: .thr-ctl */}
              <div
                className="thr-ctl"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  border: '1.5px solid #E7E9F1',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {/* Minus button: .thr-b */}
                <button
                  onClick={() => stepAutoValue(-1)}
                  className="thr-b"
                  style={{
                    width: '34px',
                    height: '34px',
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#F97316',
                    background: '#FFF6EE',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                {/* Value: .thr-v */}
                <span
                  className="thr-v"
                  style={{
                    minWidth: '62px',
                    textAlign: 'center',
                    fontFamily: '"Space Grotesk", system-ui, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {autoValue} {t('insight.automate.days') || 'days'}
                </span>
                {/* Plus button: .thr-b */}
                <button
                  onClick={() => stepAutoValue(1)}
                  className="thr-b"
                  style={{
                    width: '34px',
                    height: '34px',
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#F97316',
                    background: '#FFF6EE',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Action buttons: .auto-acts */}
            <div
              className="auto-acts"
              style={{
                display: 'flex',
                gap: '10px',
                marginTop: '14px',
                flexWrap: 'wrap',
              }}
            >
              <button
                className="adv-btn"
                onClick={handleAutomate}
                style={{
                  background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                  color: '#FFFFFF',
                  borderRadius: '12px',
                  padding: '11px 18px',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxShadow: '0 8px 20px -9px rgba(249,115,22,0.9)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.automate.yes') || 'Yes, handle it'}
              </button>
              <button
                className="adv-lite"
                onClick={handleDeclineAutomate}
                style={{
                  border: '1.5px solid #E7E9F1',
                  background: '#FFFFFF',
                  borderRadius: '12px',
                  padding: '11px 18px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#697187',
                  cursor: 'pointer',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.automate.no') || 'Keep asking me'}
              </button>
            </div>
          </div>
        )}

        {/* Automated confirmation state: .auto-done */}
        {cardState === 'automated' && (
          <div
            className="auto-done"
            style={{
              marginTop: '18px',
              border: '1.5px solid #B8E9D3',
              background: '#F3FBF7',
              borderRadius: '16px',
              padding: '17px 18px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            {/* Icon: .auto-done-ic */}
            <span
              className="auto-done-ic"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#22C58B',
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 0 0 4px rgba(34,197,139,0.17)',
              }}
            >
              <Check style={{ width: '14px', height: '14px', color: '#FFFFFF' }} strokeWidth={3} />
            </span>
            <div>
              <b
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15.5px',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '3px',
                  color: '#131A2B',
                }}
              >
                {t('insight.automated.title') || 'Done — I\'ll chase them from now on'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: '#697187',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  margin: 0,
                }}
              >
                {t('insight.automated.subtitle')?.replace('{days}', String(autoValue)) || `Anything unpaid past ${autoValue} days, up to three reminders. It shows up in what I've handled, not in your inbox. Turn it off in Operation whenever you like.`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Vectors strip (inside card, border-top) */}
      {vectorMaturity && <VectorsStrip vectorMaturity={vectorMaturity} standalone={false} />}

      {/* Handled section (inside card, border-top) */}
      {handledEntries && handledEntries.length > 0 && (
        <HandledSection entries={handledEntries} standalone={false} />
      )}
    </div>
  );
}
