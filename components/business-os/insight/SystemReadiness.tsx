'use client';

import { useEffect, useState } from 'react';
import { Lock, AlertCircle, Check, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SetupItem } from './LiveDashboard';
import {
  allSteps,
  resolveSetup,
  isReadyForClients,
  UNKNOWN_SHAPE,
  type BusinessShape,
  type ResolvedStep,
} from '@/lib/business-os/setup/setupGraph';
import { stepColor, useStepLabel } from '@/components/business-os/setup/SetupChain';

/**
 * System readiness — everything that has to be configured for the platform to
 * run end to end.
 *
 * Each step keeps its own icon in both states, so the row is scannable by shape
 * before it is read: the calendar is always a calendar, done or not. State is
 * carried separately — a green tick for configured, an outline and an arrow for
 * work still to do — rather than by swapping the icon out, which would cost the
 * identity exactly when the list gets long.
 *
 * The steps were pills before. Pills wrap into a ragged block that is hard to
 * count and gives each label a different visual weight depending on the length
 * of its text; a two-column list of fixed rows reads as a checklist, which is
 * what it is.
 */

interface SystemReadinessProps {
  items: SetupItem[];
  onAction?: (action: string) => void;
  /**
   * Actions currently in flight. Most rows open a dialog instantly, but
   * connecting an external account takes an OAuth round trip — without visible
   * progress the user clicks again, and again.
   */
  pendingActions?: string[];
  /** Action key -> message, shown under the list when a connection fails. */
  actionError?: { action: string; message: string } | null;
  /**
   * What the onboarding chat learned about this business — whether money moves,
   * how it is collected, whether they wanted a site.
   *
   * Without it the graph cannot tell a business that invoices from one that
   * takes cards, and shows both the same nine steps. Defaults to nothing known,
   * which keeps the old behaviour for any caller that has not been updated.
   */
  shape?: BusinessShape;
}

const INK = '#131A2B';
const MUTED = '#697187';
const TODO = '#C2410C';

export function SystemReadiness({
  items,
  onAction,
  pendingActions = [],
  actionError,
  shape = UNKNOWN_SHAPE,
}: SystemReadinessProps) {
  const { t, isRTL } = useLanguage();
  /**
   * The step a blocked click is pointing at.
   *
   * Clicking something that cannot be done yet should answer "why not" on the
   * chain itself rather than navigating somewhere the user did not ask to go:
   * the prerequisite lights up in place, so the answer is the picture they are
   * already looking at. It clears itself, because a highlight that stays is
   * just another permanent state to decode.
   */
  const [pointingAt, setPointingAt] = useState<string | null>(null);
  /** The fold at the bottom: recommended work, or finished work once ready. */
  const [showFold, setShowFold] = useState(false);
  // Shared with the onboarding chat and the build screen: one set of words.
  // Above the early return with the other hooks — it calls one itself.
  const shortLabel = useStepLabel();

  useEffect(() => {
    if (!pointingAt) return;
    const timer = setTimeout(() => setPointingAt(null), 3200);
    return () => clearTimeout(timer);
  }, [pointingAt]);

  if (!items.length) return null;

  const missing = items.filter(item => !item.completed);
  /**
   * "Ready" means nothing compulsory is outstanding.
   *
   * Asked of the graph rather than of a `required` flag on each item, because
   * compulsory is not fixed: invoice details are optional until payments are
   * connected and required the moment they are, and a boolean set when the item
   * was built cannot know that. A business taking money with no tax id on its
   * invoices used to be reported as ready.
   */
  const graph = resolveSetup(items, shape);
  /** What still stands between this business and taking a client. */
  const mandatoryLeft = graph.mandatoryTotal - graph.mandatoryDone;
  const ready = isReadyForClients(graph);
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const displayFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  const steps = allSteps(graph);

  /**
   * A capability, and the steps that configure it.
   *
   * `belongsTo` is the graph's own word for "this step exists to make that
   * capability work" — invoice details under payments, a calendar under your
   * hours. The card draws that as indentation, which is how a dependency is
   * shown here: no arrow, no legend, just a step sitting under the thing it
   * serves. A step waiting on a sibling says so in words on its own row.
   */
  const capabilities = steps.filter(step => !step.belongsTo);
  const childrenOf = (id: string) => steps.filter(step => step.belongsTo === id);

  /** Compulsory work, and the compulsory work underneath it. */
  const essential = capabilities.filter(step => step.mandatory || step.state === 'done');
  /** Everything that improves things without blocking them. */
  const recommended = steps.filter(step => !step.mandatory && step.state !== 'done');
  const completed = steps.filter(step => step.state === 'done');


  function renderStep(step: ResolvedStep, kid = false) {
    const { item, state } = step;
    const pending = Boolean(item.action && pendingActions.includes(item.action));
    const locked = state === 'locked';
    const done = state === 'done';
    const open = state === 'next';
    const color = stepColor(item.id);
    const waitingFor = step.blockedBy.map(id => shortLabel(id)).join(', ');

    // The whole row, not a button wrapped around the title.
    //
    // The first version put a <button> around the text only, so most of the
    // row — the marker, the space after a short label — did nothing when
    // clicked, and a row that looks like a target but is one only in places
    // reads as broken.
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          if (locked) { setPointingAt(item.id); return; }
          if (item.action) onAction?.(item.action);
        }}
        disabled={pending}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: kid ? '7px' : '9px',
          width: '100%',
          padding: kid ? '4px 6px' : '5px 6px',
          margin: 0,
          borderRadius: '8px',
          border: 'none',
          background: open ? `${color}0D` : 'transparent',
          textAlign: isRTL ? 'right' : 'left',
          cursor: pending ? 'default' : 'pointer',
          fontFamily: bodyFont,
        }}
      >
        <span
          style={{
            width: kid ? 13 : 16,
            height: kid ? 13 : 16,
            borderRadius: '999px',
            flexShrink: 0,
            marginTop: '1px',
            display: 'grid',
            placeItems: 'center',
            background: done ? color : 'transparent',
            border: done
              ? `1.5px solid ${color}`
              : `1.5px ${locked ? 'dashed #D9DDE7' : `solid ${color}`}`,
            boxSizing: 'border-box',
          }}
        >
          {pending ? (
            <Loader2 className="w-3 h-3 animate-spin" style={{ color: MUTED }} />
          ) : done ? (
            <Check style={{ width: 10, height: 10, color: '#FFFFFF' }} strokeWidth={3.6} />
          ) : locked ? (
            <Lock style={{ width: 8, height: 8, color: MUTED }} strokeWidth={2.5} />
          ) : null}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: kid ? '11.5px' : '12.5px',
              fontWeight: done || locked ? 500 : kid ? 500 : 600,
              color: done || locked ? MUTED : INK,
              lineHeight: 1.35,
            }}
          >
            {item.title}
          </span>

          {locked && (
            <span style={{ display: 'block', fontSize: '10.5px', color: MUTED, marginTop: '1px' }}>
              {t('readiness.after')} {waitingFor}
            </span>
          )}

          {/* The blocked answer, in the row that was clicked. */}
          {locked && pointingAt === item.id && (
            <span style={{ display: 'block', fontSize: '10.5px', lineHeight: 1.4, marginTop: '2px', color }}>
              {t(`setup.blocked.${item.id}`)}
            </span>
          )}

          {/* Only the step being worked on carries a reason, and only one line
              of it — which field is blank, not merely that something is. */}
          {open && ((item.missing?.length || 0) > 0 || item.description) && (
            <span style={{ display: 'block', fontSize: '10.5px', lineHeight: 1.4, marginTop: '2px', color: MUTED }}>
              {(item.missing?.length || 0) > 0
                ? `${t('readiness.stillNeeds')} ${item.missing!.join(' · ')}`
                : item.description}
            </span>
          )}
        </span>

        {!locked && !pending && item.action && (
          <span style={{ flexShrink: 0, fontSize: '13px', color: open ? color : MUTED, lineHeight: 1.3 }}>
            {isRTL ? '←' : '→'}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        // No bottom margin: the row that lays this out beside the usage card
        // owns the spacing, and a second margin here made the two cards sit at
        // different depths.
        padding: '14px 16px',
        borderRadius: '18px',
        // Deliberately plain. Nine coloured nodes sit on this card, each
        // carrying the colour of the part of the platform it belongs to; a
        // tinted ground behind them fights every one of them and turns the
        // whole card into one green (or one orange) mood. State is on the
        // nodes, so the card is simply a surface.
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        // Fills the grid track so this card and the usage card end level.
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Verdict + how much is still outstanding */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
          // Room for the chain to be its own thing. The card above it used to
          // hold this gap open; without it the title sat on top of the first
          // row of nodes, and the breathing ring had nowhere to expand into.
          marginBottom: '12px',
        }}
      >
        <span
          style={{
            fontFamily: displayFont,
            fontSize: '14.5px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: INK,
            minWidth: 0,
          }}
        >
          {ready
            ? (t('readiness.ready') || 'Your system is ready')
            : (t('readiness.title') || "What's missing before this works")}
        </span>
        {/* Plain text rather than a pill. The steps below no longer use pills,
            and one floating badge above a list that has none reads as leftover.
            It still says which kind of work is outstanding: "2 missing" beside a
            card claiming the system is ready would look like a contradiction. */}
        {missing.length > 0 && (
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: '12px',
              fontWeight: 600,
              color: MUTED,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {ready
              ? `${missing.length} ${t('readiness.optional') || 'optional'}`
              // A count, not a fraction.
              //
              // This said "5/6", counting the steps that must be done before
              // the business can trade. The chain underneath draws every step
              // it has, optional ones included — so the denominator named six
              // things while eleven nodes sat below it, and the number looked
              // wrong because nothing on screen added up to it.
              //
              // The heading asks what is missing. This answers that, and there
              // is no denominator left to disagree with.
              : mandatoryLeft === 1
                ? (t('readiness.remaining.one') || '1 step left')
                : (t('readiness.remaining.many', { count: mandatoryLeft }) || `${mandatoryLeft} steps left`)}
          </span>
        )}
      </div>

      {/* What does not work yet, before what is unconfigured.
          Taken from how Stripe reports a restricted account: it names the
          capability that is switched off, not the field that is blank. An owner
          acts on "you cannot take payments"; "payments: not configured" is a
          status, and a status is not a reason to do anything today. */}
      {!ready && graph.blocking.length > 0 && (
        <p
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            margin: '0 0 14px',
            padding: '7px 10px',
            borderRadius: '9px',
            background: '#FDF3EE',
            fontFamily: bodyFont,
            fontSize: '11.5px',
            fontWeight: 600,
            lineHeight: 1.45,
            color: TODO,
          }}
        >
          <AlertCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 2 }} strokeWidth={2.5} />
          <span style={{ minWidth: 0 }}>
            {t('readiness.costPrefix')}{' '}
            {Array.from(new Set(graph.blocking.map(step => t(`readiness.cost.${step.item.id}`))))
              .filter(phrase => !phrase.startsWith('readiness.cost.'))
              .join(' · ')}
          </span>
        </p>
      )}
      {ready && (
        <p
          style={{
            margin: '0 0 14px',
            fontFamily: bodyFont,
            fontSize: '11.5px',
            color: MUTED,
            lineHeight: 1.45,
          }}
        >
          {t('readiness.allWorks')}
        </p>
      )}

      {/* Capabilities, and what each one needs, nested beneath it.

          This was a chain of coloured nodes: every step on screen at once, none
          of them saying what to do, and the dependencies carried only by which
          node lit up when you clicked a locked one. The nesting says the same
          thing standing still — invoice details are under payments because that
          is what they are for — and a capability with nothing outstanding
          collapses to a single line, so the card gets shorter as the business
          gets further along. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!ready && essential.map(step => {
          // Only compulsory, unfinished children are shown. The optional ones
          // live in the fold below; a business six steps from trading should
          // not be reading about calendar sync.
          const kids = childrenOf(step.item.id).filter(kid => kid.mandatory && kid.state !== 'done');
          return (
            <div key={step.item.id}>
              {renderStep(step)}
              {kids.length > 0 && (
                <div
                  style={{
                    marginInlineStart: '13px',
                    paddingInlineStart: '11px',
                    borderInlineStart: '1.5px solid #EDEFF5',
                  }}
                >
                  {kids.map(kid => renderStep(kid, true))}
                </div>
              )}
            </div>
          );
        })}

        {/* Once nothing compulsory is outstanding the card turns into the list
            of things worth doing next, rather than a wall of ticks. */}
        {ready && recommended.map(step => renderStep(step))}
      </div>

      {/* One fold, holding whichever list is not the point right now. */}
      {(ready ? completed.length : recommended.length) > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowFold(open => !open)}
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '8px 6px 2px',
              background: 'none',
              border: 'none',
              borderTop: '1px solid #EDEFF5',
              textAlign: isRTL ? 'right' : 'left',
              fontFamily: bodyFont,
              fontSize: '11.5px',
              color: MUTED,
              cursor: 'pointer',
            }}
          >
            {ready
              ? t('readiness.doneGroup', { count: completed.length })
              : t('readiness.optionalGroup', { count: recommended.length })}
            {' '}
            {showFold ? '▾' : (isRTL ? '←' : '→')}
          </button>
          {showFold && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(ready ? completed : recommended).map(step => renderStep(step))}
            </div>
          )}
        </>
      )}

      {actionError && (
        <p
          style={{
            marginTop: '9px',
            fontSize: '12px',
            color: '#B4442E',
            fontFamily: bodyFont,
            lineHeight: 1.45,
          }}
        >
          {actionError.message}
        </p>
      )}
    </div>
  );
}
