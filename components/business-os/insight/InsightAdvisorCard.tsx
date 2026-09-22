'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2, Check, Clock } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { BeforeAfterPanel, type ProjectionColumn } from './BeforeAfterPanel';
import type { InsightData, InsightProjection } from './InsightDetailModal';

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

/**
 * A job the platform is offering to take on, shown in this same carousel.
 *
 * Operational advice is still advice: the owner sees one card that sometimes
 * reports a pattern in the numbers and sometimes asks to handle a chore. Two
 * cards would have meant an advisor that changes costume depending on which
 * kind of help it is offering, which reads as two products — and, for a while,
 * meant a card offering advice above another announcing it had none.
 */
export interface OperationalItem {
  id: string;
  /** How many are waiting on this right now. Zero is offered too, quietly. */
  waiting: number;
  labelKey: string;
  hintKey: string;
  /**
   * Whether the owner has already switched this on, and whether they have said
   * no to it before.
   *
   * Both come from `/api/business-os/gaps` and were previously absent from this
   * type, so the card could not tell a running automation from an unanswered
   * offer and asked "shall I do this?" about jobs it was already doing. An
   * owner with all three enabled saw three pages inviting them to enable them.
   *
   * Optional so an older caller that omits them still renders the ask, which is
   * the safe reading of "we do not know".
   */
  enabled?: boolean;
  declined?: boolean;
}

interface PendingInsight extends Omit<InsightData, 'eligible_for_automation'> {
  /**
   * The process that can act on this, when one exists.
   *
   * Absent on an advisory insight — a website page missing a call to action, a
   * blocked Stripe payout — where what would fix it is a different kind of
   * thing from the message-sending the kernel can do. The card reads this to
   * decide whether to offer the button at all.
   */
  paired_process_id?: string;
  projection?: InsightProjection;
  eligible_for_automation?: boolean;
  process_parameters?: Record<string, unknown>;
  affected_entity_type?: string;
}

interface InsightAdvisorCardProps {
  insights: PendingInsight[];
  /**
   * Undecided automations, carouselled AFTER the insights.
   *
   * After rather than before: an insight is something the business did not
   * know, and it earns the first slot. An approval is asked once and then
   * never again, so it can wait a page.
   */
  operational?: OperationalItem[];
  onOperationalDecide?: (id: string, approve: boolean) => Promise<void>;
  currentIndex: number;
  projection?: InsightProjection;
  automationConfig?: AutomationConfig;
  stage?: CardStage;
  onIndexChange: (index: number) => void;
  /**
   * Returns false when the action was refused, so the card can stop claiming it
   * succeeded. Void is still accepted — an older caller that reports nothing is
   * treated as "no news", not as failure.
   */
  onAction: (action: 'run' | 'snooze' | 'dismiss', insightId: string, params?: Record<string, unknown>) => Promise<void | boolean>;
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
  operational = [],
  onOperationalDecide,
  currentIndex,
  projection,
  automationConfig,
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

  /*
   * Past the insights, the carousel is showing an automation to approve.
   *
   * Indexed rather than interleaved so `onIndexChange` and the dots below stay
   * a single running position, which is what makes this one card rather than
   * two sharing a shell.
   */
  /*
   * Already sorted itself out.
   *
   * A resolved insight rides the carousel for a day so the owner sees what
   * happened to something they were told about. It must not offer to act: the
   * invoice is paid, the lead booked, and "Handle it for me" on a settled thing
   * is exactly the card that prompted this work.
   */
  const isResolved = insight?.status === 'resolved';

  const operationalItem =
    currentIndex >= insights.length ? operational[currentIndex - insights.length] : undefined;

  const totalPages = insights.length + operational.length;

  // Setup stage only when there is genuinely nothing to say — an automation
  // waiting to be approved is something to say.
  const effectiveStage = operationalItem ? 'run' : !insight ? 'setup' : stage;

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
  const displayTitle = operationalItem
    ? t(operationalItem.labelKey)
    : insight?.title || setupContent.title;
  const displayDescription = operationalItem
    ? t(operationalItem.hintKey)
    : insight?.description || setupContent.description;
  const displayCategory = operationalItem ? 'ops' : insight?.category || setupContent.category;

  const categoryColor = CATEGORY_COLORS[displayCategory] || '#F97316';
  const stepKeys = insight ? (RUNNING_STEP_KEYS[insight.detector_id] || RUNNING_STEP_KEYS.default) : RUNNING_STEP_KEYS.default;
  const steps = stepKeys.map(key => t(key));
  const canAutomate = insight?.eligible_for_automation && automationConfig;

  /*
   * Whether "handle it for me" can do anything.
   *
   * An operational page always can — it is an approval. An insight can only if
   * it carries a process; thirteen detectors describe something no process
   * implements, and offering to run one was how the card came to report success
   * for work that never started.
   */
  const canRun = !isResolved && (!!operationalItem || !!insight?.paired_process_id);

  // Get eyebrow text based on stage
  const getEyebrowText = () => {
    /*
     * Still "your advisor", as on every other page.
     *
     * Only the SUB line changes — which is how `setup`, `win` and `automate`
     * already work. Replacing the main line too made the operational page read
     * as a different card, which is the thing merging them was meant to stop.
     */
    if (operationalItem) {
      return { main: t('insight.advisor') || 'Your advisor', sub: t('automation.eyebrow') };
    }
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
    if (operationalItem) return t('automation.category');
    if (effectiveStage === 'setup') {
      return t('insight.category.setup') || 'Getting you switched on';
    }
    const key = `insight.category.${displayCategory}`;
    const translated = t(key);
    return translated !== key ? translated : displayCategory;
  };

  // Get "seen" text for first occurrence tracking
  const getSeenText = () => {
    // An approval is a question, not an observation — nothing was "seen".
    if (operationalItem) return null;
    // No "seen" text for setup stage
    if (effectiveStage === 'setup') {
      return null;
    }
    if (effectiveStage === 'win') {
      return t('insight.seen.win') || 'Wins are the only thing I can honestly report this early — they\'re facts, not judgements.';
    }
    if (cardState === 'default' && insight) {
      /*
       * How many times this has actually been shown, not a guess.
       *
       * This line said "First time I've seen this" unconditionally, to every
       * owner, about an insight that may have been sitting on their dashboard
       * for a week — and it was true of nothing, because `surface_count` was
       * never incremented by anything. Now that it is, the sentence can be the
       * one the number supports.
       *
       * The count is what the server held when this list was fetched, so it
       * does not include the view happening right now: 0 really is the first
       * time.
       */
      const shown = insight.surface_count ?? 0;

      if (shown === 0) {
        return t('insight.seen.first') || 'First time I\'ve seen this. I\'ll offer to handle it standing once it has happened a few times.';
      }
      if (shown >= 3) {
        return t('insight.seen.repeated') || 'This keeps coming back. If it is going to keep happening, I can handle it standing.';
      }
      return t('insight.seen.again') || 'You have seen this one before and it is still open.';
    }
    return null;
  };

  // Handle run action
  const handleRun = useCallback(async () => {
    if (!insight) return; // Don't run for setup stage
    setCardState('running');
    setRunningStep(0);

    /*
     * The card used to announce success on a timer, whatever the server said.
     *
     * `onAction`'s result was awaited and discarded, while this interval marched
     * to "completed" on its own — so an insight whose paired process does not
     * exist (the server answers 400, `Process X not found`) still told the owner
     * the job was done. Nothing had run, the insight was never marked acted, and
     * it reappeared on the next load having apparently already been handled.
     *
     * The flag is read by the timer at fire time rather than checked before it
     * is scheduled, because the refusal usually arrives while the animation is
     * still playing and would otherwise land after the state it needs to stop.
     */
    let refused = false;

    const interval = setInterval(() => {
      setRunningStep(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            if (refused) return;
            setCardState(canAutomate ? 'automate_offer' : 'completed');
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, 800);

    const ran = await onAction('run', insight.id);

    if (ran === false) {
      refused = true;
      clearInterval(interval);
      // Back to the offer, not to a success state: the work did not happen and
      // the button should still be there.
      setCardState('default');
    }
  }, [insight, onAction, steps.length, canAutomate]);

  /**
   * Approve or decline the automation on this page.
   *
   * Deliberately NOT routed through `cardState`: the running/completed states
   * narrate a job being carried out, and this is a permission being granted for
   * jobs not yet due. The page simply leaves the carousel once answered,
   * because the parent stops sending it.
   */
  /**
   * What this operational page is: a job already running, one turned down, or a
   * question not yet answered.
   *
   * Drives both buttons. Without it the card asked "shall I do this?" about
   * automations the owner had already switched on, because the only thing it
   * knew about them was the label.
   */
  const operationalState: 'on' | 'off' | 'unanswered' | null = !operationalItem
    ? null
    : operationalItem.enabled
      ? 'on'
      : operationalItem.declined
        ? 'off'
        : 'unanswered';

  const handleDecide = useCallback(
    async (approve: boolean) => {
      if (!operationalItem || !onOperationalDecide) return;
      await onOperationalDecide(operationalItem.id, approve);
      onIndexChange(0);
    },
    [operationalItem, onOperationalDecide, onIndexChange]
  );

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

  /**
   * Projection copy in the reader's language.
   *
   * The projector runs on the server with no access to the interface language,
   * so it sends a dictionary key and the numbers to fill it, alongside an
   * English rendering. Prefer the key; fall back to the English only when there
   * is no key or the dictionary has no entry — `t` returns the key itself when
   * a string is missing, which would otherwise print `insight.generic.do_nothing`
   * on the card.
   *
   * Without this the panel showed the server's English under a Hebrew heading.
   */
  const renderLine = (
    line: { text: string; key?: string; params?: Record<string, string | number> } | undefined,
    fallback: string | undefined
  ): string => {
    if (line?.key) {
      const translated = t(line.key, line.params);
      if (translated && translated !== line.key) return translated;
    }
    return line?.text || fallback || '';
  };

  // Build projection columns for BeforeAfterPanel
  const projectionColumns: { left: ProjectionColumn; right: ProjectionColumn } | null =
    effectiveStage === 'setup'
      ? setupContent.projection
      : projection
        ? {
            // These read `doNothing` / `letMeHandleIt`, the field names the
            // projection actually carries. They were snake_case here, so every
            // projection silently fell through to the generic fallback text.
            left: {
              label: t('insight.projection.do_nothing') || 'If you do nothing',
              value: renderLine(projection.doNothing?.summaryLine, projection.doNothing?.summary)
                || `${insight?.affected_count || 0} outstanding`,
              subtext: renderLine(projection.doNothing?.detailsLine, projection.doNothing?.details),
            },
            right: {
              label: t('insight.projection.handle_it') || 'If I handle it',
              value: renderLine(projection.letMeHandleIt?.summaryLine, projection.letMeHandleIt?.summary)
                || `~${formatCurrency(insight?.estimated_impact_usd || 0, { showFree: false })} recovered`,
              subtext: renderLine(projection.letMeHandleIt?.detailsLine, projection.letMeHandleIt?.details),
            },
          }
        : null;

  const eyebrow = getEyebrowText();
  const seenText = getSeenText();

  /**
   * Left and right step through the pages.
   *
   * The keys are read as screen directions, not as back and forward: in Hebrew
   * the card is laid out right-to-left, so the left key moves the way the eye
   * expects it to on that screen, which is onward. Anyone who has ever used an
   * arrow key on a carousel expects the key to follow the layout.
   *
   * Nothing is intercepted while the reader is typing. There is no text input
   * on this card today, and there is no reason for a future one to lose its
   * cursor keys to a pager.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const forward = isRTL ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
      const next = forward ? currentIndex + 1 : currentIndex - 1;

      if (next < 0 || next >= totalPages) return;

      event.preventDefault();
      onIndexChange(next);
    },
    [currentIndex, totalPages, isRTL, onIndexChange]
  );

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
      /*
       * Arrow keys move between pages.
       *
       * `role="group"` with a name, rather than a listbox or a tablist: this is
       * a set of cards shown one at a time, not a set of options being chosen
       * between, and announcing it as a chooser would promise a screen reader
       * something the card does not do.
       *
       * `tabIndex={-1}` makes the container focusable by script and click but
       * keeps it out of the tab order, so nobody tabbing through the dashboard
       * lands on a whole card before reaching its buttons.
       */
      role={totalPages > 1 ? 'group' : undefined}
      aria-roledescription={totalPages > 1 ? t('insight.nav.carousel') || 'Carousel' : undefined}
      aria-label={totalPages > 1 ? t('insight.nav.position', { current: currentIndex + 1, total: totalPages }) : undefined}
      tabIndex={totalPages > 1 ? -1 : undefined}
      onKeyDown={totalPages > 1 ? handleKeyDown : undefined}
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
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
            /*
             * Wrap rather than overflow.
             *
             * This row carries the orb, the eyebrow, the category badge and now
             * the pager with two arrows either side. On a narrow phone that is
             * more than fits, and the pager is the part that would have been
             * pushed off the edge — the control the reader is least likely to
             * already know about. Wrapping costs a line only when the
             * alternative was losing it.
             */
            flexWrap: 'wrap',
            rowGap: '8px',
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
                  color: 'var(--v2-text-secondary)',
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
              background: 'var(--v2-bg)',
              color: 'var(--v2-text-secondary)',
              padding: '5px 11px',
              borderRadius: '20px',
              whiteSpace: 'nowrap',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {getCategoryLabel()}
          </span>

          {/* Which of several insights this is, and a way to reach the others.
              The card only ever shows one at a time, so without this the rest
              are invisible — the parent has always tracked the index and passed
              onIndexChange; nothing rendered a control for it. */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span
                style={{
                  fontSize: '11.5px',
                  fontWeight: 500,
                  color: 'var(--v2-text-secondary)',
                  whiteSpace: 'nowrap',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.nav.position', { current: currentIndex + 1, total: totalPages })}
              </span>
              {/*
                An arrow either side of the dots.

                The dots alone said how many there were without saying that
                anything could be done about it — they read as a progress
                indicator, which is what people took them for. An arrow is the
                one control everyone already knows means "there is another one
                that way", and at the first page the forward arrow is the only
                lit thing in the row, which is the signal that was missing.

                Disabled at the ends rather than wrapping, so the extent is
                legible: a dimmed back arrow on page one says this is the
                beginning, where wrapping would just move without explaining.
              */}
              <PagerArrow
                direction="back"
                isRTL={isRTL}
                disabled={currentIndex === 0}
                label={t('insight.nav.prev') || 'Previous'}
                onClick={() => onIndexChange(currentIndex - 1)}
              />

              {/* Gap lives in the buttons' padding now, so the space between
                  dots is part of a hit area rather than a dead zone. */}
              <div style={{ display: 'flex', gap: 0 }}>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => onIndexChange(i)}
                    aria-label={t('insight.nav.goTo', { number: i + 1 })}
                    aria-current={i === currentIndex}
                    style={{
                      /*
                       * The button is the hit area; the dot inside it is the
                       * picture. They used to be the same element, which made
                       * the control for changing page a 6-pixel square — small
                       * enough that missing it reads as the card being stuck
                       * rather than as a missed tap. The dot is unchanged; what
                       * changed is how much of the space around it responds.
                       */
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '22px',
                      padding: '0 4px',
                      border: 'none',
                      background: 'transparent',
                      cursor: i === currentIndex ? 'default' : 'pointer',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        // The active one is a stadium rather than a bigger dot:
                        // size alone is hard to read at 6px, length is not.
                        width: i === currentIndex ? '14px' : '6px',
                        height: '6px',
                        borderRadius: i === currentIndex ? '4px' : '50%',
                        // Inactive dots ride the theme's border colour; the
                        // fixed light grey was near-white on a dark card.
                        background: i === currentIndex ? '#F97316' : 'var(--v2-border)',
                        transition: 'width 0.2s, background 0.2s',
                      }}
                    />
                  </button>
                ))}
              </div>

              <PagerArrow
                direction="forward"
                isRTL={isRTL}
                disabled={currentIndex >= totalPages - 1}
                label={t('insight.nav.next') || 'Next'}
                onClick={() => onIndexChange(currentIndex + 1)}
              />
            </div>
          )}
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
            color: 'var(--v2-text-primary)',
          }}
        >
          {displayTitle}
        </div>

        {/* Description: .adv-p */}
        <div
          className="adv-p"
          style={{
            fontSize: '14.5px',
            color: 'var(--v2-text-secondary)',
            maxWidth: '46rem',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            lineHeight: 1.5,
          }}
          dangerouslySetInnerHTML={{ __html: displayDescription }}
        />

        {/*
          What is waiting on this right now.
          
          The whole reason an approval is asked HERE and not on a settings
          screen: a count turns "enable invoice chasing" into "three invoices
          are past due, shall I chase them" — a decision somebody can make
          rather than a checkbox they skip.
        */}
        {operationalItem && operationalItem.waiting > 0 && (
          <div
            style={{
              marginTop: '14px',
              border: '1.5px solid rgba(249, 115, 22, 0.30)',
              background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.10), rgba(249, 115, 22, 0.03))',
              borderRadius: '16px',
              padding: '13px 16px',
              fontSize: '14px',
              color: 'var(--v2-text-primary)',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {t('automation.waiting_now').replace('{n}', String(operationalItem.waiting))}
          </div>
        )}

        {/* Before/After Projection (if available and in default state) */}
        {!operationalItem && projectionColumns && cardState === 'default' && (
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
            {/*
              Primary button: .adv-btn

              Shown only where something can actually run. An advisory insight
              names no process, the server answers "no action available", and
              the button used to sit there anyway — an offer to handle it that
              could only ever fail.
            */}
            {canRun && (
            <button
              /*
               * A running automation has nothing to approve, so the primary
               * button stops being a button and becomes the status. Turning it
               * off lives on the secondary, where the destructive choice
               * belongs — a control labelled "Working on its own" that switches
               * it off when pressed would be a trap.
               */
              disabled={operationalState === 'on'}
              onClick={
                operationalItem
                  ? operationalState === 'on'
                    ? undefined
                    : () => handleDecide(true)
                  : handleRun
              }
              className="adv-btn"
              style={{
                // Running reads as a settled state rather than an offer: the
                // orange call-to-action is what invites a press.
                background:
                  operationalState === 'on'
                    ? 'rgba(34,197,94,0.14)'
                    : 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                color: operationalState === 'on' ? '#15803D' : '#FFFFFF',
                borderRadius: '12px',
                padding: '11px 18px',
                fontSize: '14px',
                fontWeight: 600,
                boxShadow:
                  operationalState === 'on' ? 'none' : '0 8px 20px -9px rgba(249,115,22,0.9)',
                border: operationalState === 'on' ? '1.5px solid rgba(34,197,94,0.35)' : 'none',
                cursor: operationalState === 'on' ? 'default' : 'pointer',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {operationalItem
                ? operationalState === 'on'
                  // Running. The only move left is to stop it, so the primary
                  // button stops being an invitation.
                  ? t('automation.running')
                  : operationalState === 'off'
                    ? t('automation.enable')
                    : t('automation.approve')
                : t('insight.action.primary') || 'Handle it for me'}
            </button>
            )}
            {/* Secondary button: .adv-lite */}
            <button
              onClick={operationalItem ? () => handleDecide(false) : handleDismiss}
              className="adv-lite"
              style={{
                border: '1.5px solid var(--v2-border)',
                background: 'var(--v2-surface)',
                borderRadius: '12px',
                padding: '11px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--v2-text-secondary)',
                cursor: 'pointer',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {isResolved
                ? t('insight.action.acknowledge') || 'Got it'
                : !canRun && !operationalItem
                ? t('insight.action.acknowledge') || 'Got it'
                : operationalItem
                ? operationalState === 'on'
                  ? t('automation.turn_off')
                  : t('automation.decline')
                : t('insight.action.secondary') || 'Not now'}
            </button>

            {/* "Seen" note: .adv-seen */}
            {seenText && (
              <span
                className="adv-seen"
                style={{
                  fontSize: '12.5px',
                  color: 'var(--v2-text-secondary)',
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
                    stroke: 'var(--v2-text-secondary)',
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
              // A neutral inset panel, one step off the card. `#F8F9FC` was a
              // light-mode wash that turned into a white slab in dark mode,
              // under text that follows the theme tokens.
              background: 'var(--v2-surface-hover)',
              border: '1px solid var(--v2-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <Loader2 style={{ width: '20px', height: '20px', color: '#F97316' }} className="animate-spin" strokeWidth={2.5} />
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--v2-text-primary)',
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
                        border: '2px solid var(--v2-border)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ color: i <= runningStep ? 'var(--v2-text-primary)' : 'var(--v2-text-secondary)', fontWeight: i <= runningStep ? 500 : 400 }}>
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
              // The success family that exists in BOTH themes. The literals
              // here were a light mint that stayed light in dark mode.
              border: '1.5px solid var(--v2-status-success-border)',
              background: 'var(--v2-status-success-bg)',
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
                  color: 'var(--v2-text-primary)',
                }}
              >
                {t('insight.completed.title') || 'Done'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: 'var(--v2-text-secondary)',
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
              border: '1.5px solid rgba(249, 115, 22, 0.30)',
              background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.10), rgba(249, 115, 22, 0.03))',
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
                color: 'var(--v2-text-primary)',
              }}
            >
              {t('insight.automate.title') || 'Want me to just handle this from now on?'}
            </div>
            {/* Description: .auto-p */}
            <div
              className="auto-p"
              style={{
                fontSize: '13.5px',
                color: 'var(--v2-text-secondary)',
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
                background: 'var(--v2-surface)',
                // Tinted from the accent rather than a fixed pale peach, so it
                // stays a hairline against a dark surface instead of glowing.
                border: '1px solid rgba(249, 115, 22, 0.32)',
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
                  border: '1.5px solid var(--v2-border)',
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
                    background: 'rgba(249, 115, 22, 0.10)',
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
                    background: 'rgba(249, 115, 22, 0.10)',
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
                  border: '1.5px solid var(--v2-border)',
                  background: 'var(--v2-surface)',
                  borderRadius: '12px',
                  padding: '11px 18px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--v2-text-secondary)',
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
              // The success family that exists in BOTH themes. The literals
              // here were a light mint that stayed light in dark mode.
              border: '1.5px solid var(--v2-status-success-border)',
              background: 'var(--v2-status-success-bg)',
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
                  color: 'var(--v2-text-primary)',
                }}
              >
                {t('insight.automated.title') || 'Done — I\'ll chase them from now on'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: 'var(--v2-text-secondary)',
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

      {/* The vectors strip and "what I've handled" used to render here as well
          as in LiveDashboard, so both appeared twice — with different numbers —
          whenever there was a pending insight. LiveDashboard owns them now, and
          shows them whether or not an insight is pending. */}
    </div>
  );
}

/**
 * One step back or forward through the advisor's pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `direction` is 'back' / 'forward' rather than 'left' / 'right', because which
 * side of the screen those are depends on the language. In Hebrew, back is the
 * right-hand arrow. Naming the buttons by their position would have meant the
 * Hebrew card pointing the wrong way round, which is a bug you only see if you
 * read Hebrew.
 *
 * The visible glyph flips with `isRTL`. The DOM order does not need to: the row
 * is laid out by flexbox inside an RTL document, so the browser reverses it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function PagerArrow({
  direction,
  isRTL,
  disabled,
  label,
  onClick,
}: {
  direction: 'back' | 'forward';
  isRTL: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const pointsLeft = isRTL ? direction === 'forward' : direction === 'back';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        /*
         * 26px. Bigger than the 6px dots were before their hit areas were
         * widened, because this is the control most people will reach for and
         * the card is often read on a phone.
         */
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        background: 'transparent',
        /*
         * The whole point of the arrows: at the first page the forward one is
         * the only lit thing in the row, and that is what says there is more to
         * see. So the enabled state is the card's own accent rather than the
         * muted grey the dots use.
         */
        color: disabled ? 'var(--v2-border)' : '#F97316',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'color 0.2s, background 0.2s',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points={pointsLeft ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
      </svg>
    </button>
  );
}
