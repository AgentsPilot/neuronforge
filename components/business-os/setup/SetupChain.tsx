'use client';

import {
  Check,
  Loader2,
  Globe,
  Package,
  Clock,
  CreditCard,
  CalendarDays,
  ClipboardList,
  Building2,
  FileText,
  Share2,
  BarChart3,
  Palette,
  Link2,
  Circle,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { blockerFor, type ResolvedGraph, type ResolvedStep } from '@/lib/business-os/setup/setupGraph';

/**
 * The setup chain — one picture, used at every moment of the journey.
 *
 * The onboarding chat draws it assembling as the user answers, the build screen
 * draws it filling in, and the dashboard draws what is left. Those are the three
 * moments where a user decides whether this product is coherent, and showing
 * them three different pictures of the same nine facts is what made the whole
 * thing feel like configuration rather than a plan.
 *
 * So it lives here rather than inside the readiness card, and every state a step
 * can be in is expressed once: done, next, waiting on something else, not yet
 * knowable, and — the one that matters most for trust — work only the person
 * can do, which the platform must never promise to do for them.
 */

/**
 * One icon per step, chosen to say what the step *is* rather than what state it
 * is in. Anything unrecognised falls back to a plain circle, so a step added
 * elsewhere still lines up with the rest instead of collapsing the row.
 */
export const STEP_ICONS: Record<string, LucideIcon> = {
  website: Globe,
  smart_link: Link2,
  services: Package,
  availability: Clock,
  payments: CreditCard,
  calendar: CalendarDays,
  intake: ClipboardList,
  profile: Building2,
  invoicing: FileText,
  design: Palette,
  meta_insights: Share2,
  google_analytics: BarChart3,
};

const INK = '#131A2B';
const MUTED = '#697187';
/** Work only the person can do. Deliberately outside the module palette. */
const YOURS = '#C2410C';

/**
 * The colour of the screen each step actually opens.
 *
 * Not a palette invented for this component: these are the constants those
 * screens are built from, so a node matches the thing it takes you to. Four
 * steps live in the configuration dialog and share its pink, which is not a
 * collision — it is the truth, and it groups them for free.
 *
 *   CONFIG_COLOR      components/business-os/ConfigurationDialog.tsx
 *   WEBSITE_COLOR     app/business-os/website/page.tsx
 *   REPORTS_COLOR     components/payments/InvoiceModal.tsx
 *   brand.secondary   lib/design-system-v2/tokens.ts
 */
const STEP_COLORS: Record<string, string> = {
  services: '#D14E97',
  availability: '#D14E97',
  intake: '#D14E97',
  payments: '#D14E97',
  calendar: '#D14E97',
  website: '#4F6EF7',
  smart_link: '#4F6EF7',
  design: '#4F6EF7',
  invoicing: '#22C58B',
  profile: '#8B5CF6',
  meta_insights: '#8B5CF6',
  google_analytics: '#4F6EF7',
};

export const stepColor = (id: string): string => STEP_COLORS[id] || MUTED;

/** The same hue at low opacity, for rings and tints. */
export const tint = (hex: string, alpha: number): string => {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * The short name for a step, in the reader's language.
 *
 * Exported so the onboarding chat, the build screen and the dashboard cannot
 * drift into calling the same node three different things — which is the whole
 * reason the picture is worth carrying across them.
 */
export function useStepLabel() {
  const { t } = useLanguage();

  return (id: string): string => {
    const labels: Record<string, string> = {
      website: t('checklist.website') || 'Website',
      smart_link: t('checklist.website') || 'Website',
      services: t('checklist.services') || 'Services',
      availability: t('checklist.availability') || 'Hours',
      payments: t('checklist.payments') || 'Payments',
      calendar: t('checklist.calendar') || 'Calendar',
      intake: t('checklist.intake') || 'Intake form',
      profile: t('checklist.profile') || 'Business details',
      invoicing: t('checklist.invoicing') || 'Invoice details',
      design: t('checklist.design') || 'Brand look',
      meta_insights: t('checklist.meta') || 'Facebook & Instagram',
      google_analytics: t('checklist.analytics') || 'Google',
    };
    return labels[id] || id;
  };
}

interface SetupChainProps {
  graph: ResolvedGraph;
  /** Short label per step id, in the reader's language. */
  label: (id: string) => string;
  /**
   * Split over this many lines. Nine nodes across a card leaves each one about
   * eighty pixels — enough for the dot, not for a label anyone can read.
   */
  rows?: 1 | 2;
  /** Smaller nodes for the onboarding panel, which sits beside a conversation. */
  compact?: boolean;
  /** Actions currently in flight, so a node can show progress rather than repeat. */
  pendingActions?: string[];
  /**
   * Clicking a node opens the page it is configured on. Omitted where the chain
   * is being shown rather than operated — the chat panel and the build screen.
   */
  onAction?: (action: string) => void;
  /** The step currently being pointed at, when a locked node was clicked. */
  pointingAt?: string | null;
  onPointAt?: (id: string | null) => void;
}

export function SetupChain({
  graph,
  label,
  rows = 2,
  compact = false,
  pendingActions = [],
  onAction,
  pointingAt = null,
  onPointAt,
}: SetupChainProps) {
  const { isRTL } = useLanguage();
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  const chain = graph.steps;
  if (chain.length === 0) return null;

  const perRow = rows === 1 ? chain.length : Math.ceil(chain.length / 2);
  const chainRows = rows === 1
    ? [chain]
    : [chain.slice(0, perRow), chain.slice(perRow)].filter(row => row.length > 0);

  const renderNode = (step: ResolvedStep, index: number, startsRow: boolean) => {
    const item = step.item;
    const done = step.state === 'done';
    const locked = step.state === 'locked';
    const ghost = step.state === 'ghost';
    const isNext = step.state === 'next';
    // Compulsory right now — which is not fixed: invoice details are optional
    // until money can move and required the moment it can.
    const major = step.mandatory;
    const yours = step.owner === 'user' && !done;
    const pending = !!item.action && pendingActions.includes(item.action);
    const blocker = locked ? blockerFor(step, graph) : null;
    const StepIcon = STEP_ICONS[item.id] || Circle;
    // Locked and not-yet-known steps drop to grey: their own colour would claim
    // they are ready. Work that is theirs takes the one colour outside the
    // module palette, so "this one needs you" reads before the label does.
    const color = locked || ghost ? MUTED : yours ? YOURS : stepColor(item.id);
    const lit = pointingAt === item.id;

    // Every step leads to the page it is configured on, finished ones included:
    // a completed node is exactly where someone goes to CHANGE that setting.
    //
    // A locked node is the exception, and answers rather than acts: it lights
    // up the step standing in its way. Navigating there would take the user
    // somewhere they did not ask to go, and doing nothing would leave them
    // stuck with no way to find out why.
    const clickable = !!onAction && !pending && !ghost && (locked ? !!blocker : !!item.action);
    const size = compact ? (major ? 30 : 24) : major ? 38 : 28;
    const previous = index > 0 ? chain[index - 1] : null;

    return (
      <div
        key={item.id}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          opacity: ghost ? 0.35 : 1,
          transition: 'opacity 0.3s',
        }}
      >
        {/* The link back to the previous stop. Logical inset, so the chain
            builds rightwards in English and leftwards in Hebrew from one rule. */}
        {index > 0 && !startsRow && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: `${size / 2 - 1}px`,
              insetInlineEnd: '50%',
              width: '100%',
              height: 0,
              borderTop: `2px ${locked || ghost ? 'dashed' : 'solid'} ${
                previous?.state === 'done' ? tint(stepColor(previous.item.id), 0.45) : '#E4E7EF'
              }`,
              zIndex: 0,
            }}
          />
        )}

        <button
          className={isNext ? 'setup-chain-next' : undefined}
          onClick={() => {
            if (!clickable) return;
            if (locked && blocker) {
              onPointAt?.(blocker.item.id);
              return;
            }
            if (item.action) onAction?.(item.action);
          }}
          disabled={!clickable}
          aria-disabled={locked || undefined}
          aria-label={label(item.id)}
          title={item.description || undefined}
          style={{
            position: 'relative',
            zIndex: 1,
            width: size,
            height: size,
            borderRadius: '999px',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            background: done ? color : '#FFFFFF',
            border: done || lit || isNext
              ? `2px ${yours ? 'dashed' : 'solid'} ${color}`
              : `1.5px ${locked || ghost || yours ? 'dashed' : 'solid'} ${tint(color, 0.35)}`,
            ['--ring-soft' as string]: tint(color, 0.42),
            ['--ring-faint' as string]: tint(color, 0.10),
            boxShadow: lit ? `0 0 0 6px ${tint(color, 0.26)}` : 'none',
            cursor: clickable ? 'pointer' : 'default',
            opacity: pending ? 0.7 : locked ? 0.75 : 1,
            transition: 'box-shadow 0.2s, transform 0.15s',
          }}
          onMouseEnter={e => {
            if (!clickable) return;
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            if (!clickable) return;
            e.currentTarget.style.transform = 'none';
          }}
        >
          {/* The step's own icon in every state, done included. Swapping it for
              a tick cost the chain its shape: a finished row became identical
              ticks, and the one thing a glance should answer — which step is
              this — was the thing that disappeared. */}
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: MUTED }} />
          ) : (
            <StepIcon
              style={{ width: size * 0.42, height: size * 0.42, color: done ? '#FFFFFF' : color }}
              strokeWidth={2}
            />
          )}

          {/* One corner slot, three possible marks — and a step is never in two
              of these states at once. */}
          {!pending && (done || locked || yours) && (
            <span
              style={{
                position: 'absolute',
                insetInlineEnd: '-2px',
                bottom: '-2px',
                width: compact ? 12 : 14,
                height: compact ? 12 : 14,
                borderRadius: '999px',
                background: '#FFFFFF',
                border: `1px solid ${done || yours ? tint(color, 0.5) : '#E7E0D4'}`,
                display: 'grid',
                placeItems: 'center',
                fontSize: compact ? '7px' : '8px',
                fontWeight: 700,
                color,
                lineHeight: 1,
              }}
            >
              {done ? (
                <Check style={{ width: compact ? 7 : 8, height: compact ? 7 : 8 }} strokeWidth={3.5} />
              ) : locked ? (
                <Lock style={{ width: 7, height: 7, color: MUTED }} strokeWidth={2.5} />
              ) : (
                '!'
              )}
            </span>
          )}
        </button>

        <span
          style={{
            fontFamily: bodyFont,
            fontSize: compact ? '9.5px' : major ? '11px' : '10px',
            fontWeight: isNext ? 700 : major ? 600 : 500,
            lineHeight: 1.25,
            textAlign: 'center',
            color: lit ? color : done || locked || ghost ? MUTED : major ? INK : MUTED,
            maxWidth: '100%',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            padding: '0 4px',
          }}
        >
          {label(item.id)}
        </span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '10px' : '14px' }}>
      {chainRows.map((row, rowIndex) => (
        <div key={rowIndex} style={{ display: 'flex', alignItems: 'flex-start' }}>
          {row.map((step, indexInRow) =>
            // The index is the position in the whole chain, not in the row: it
            // decides whether a step draws a link back to the one before it,
            // and the first node of the second row must not draw one back
            // across empty space to the end of the first.
            renderNode(step, rowIndex * perRow + indexInRow, indexInRow === 0)
          )}
        </div>
      ))}

      <style jsx global>{`
        /* A slow breath, not a blink: the next step draws the eye on its own,
           which is what a card above the chain used to do with words. Two
           custom properties carry the step's own colour in, so one animation
           serves every node.

           Global rather than scoped: the node is returned from a helper inside
           this component, and styled-jsx's scoping class is not guaranteed to
           reach it — a silently dead animation is worse than one class name in
           the global sheet, and the name is prefixed for exactly that. */
        .setup-chain-next {
          animation: setup-chain-breathe 1900ms ease-in-out infinite;
        }

        @keyframes setup-chain-breathe {
          0%,
          100% {
            box-shadow: 0 0 0 3px var(--ring-soft);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 0 14px var(--ring-faint);
            transform: scale(1.09);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .setup-chain-next {
            animation: none;
            box-shadow: 0 0 0 5px var(--ring-soft);
          }
        }
      `}</style>
    </div>
  );
}
