'use client';

import { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  contactOrigin,
  originOption,
  type ContactSourceMetadata,
} from '@/components/crm/contactSources';
import { isContactInactive } from '@/components/crm/contactStatus';
import { Badge } from '@/components/ui/badge';
import { Mail, Phone, Calendar, GripVertical, User, Clock, CheckSquare, MoveRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { localizeStageLabel, type StageLanguage } from '@/lib/business-os/stageLabels';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

// Animated Pipeline Flow Header - shows all stages as a connected flowing progress bar
function PipelineFlowHeader({
  stages,
  contactCounts,
  language,
  onStageSelect
}: {
  stages: CRMPipelineStage[];
  contactCounts: Record<string, number>;
  language: StageLanguage;
  /** Bring one stage's column to the middle of the board. */
  onStageSelect?: (index: number) => void;
}) {
  const total = Object.values(contactCounts).reduce((sum, c) => sum + c, 0);

  return (
    <div
      className="mb-6 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      {/*
        Stage labels and counts.

        ───────────────────────────────────────────────────────────────────────
        These were `flex-1` across the full width, which is fine for five
        stages on a desktop and unreadable on a phone: at 375px each of five
        gets about 70px, and a sales pipeline's seven get 50 — not enough for a
        name and a number, so every label truncated to nothing.

        Below `sm:` they become a scrolling row of fixed-width taps instead,
        and tapping one brings its column to the middle of the board. That is
        what makes a five-screen board navigable with a thumb rather than only
        by swiping through it.
        ───────────────────────────────────────────────────────────────────────
      */}
      <div className="flex items-center justify-between mb-3 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stages.map((stage, index) => (
          <button
            key={stage.stage_key}
            type="button"
            onClick={() => onStageSelect?.(index)}
            className="flex-none w-[88px] sm:flex-1 sm:w-auto text-center relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
            style={{ minWidth: 0 }}
          >
            <div className="flex flex-col items-center">
              <span
                className="text-sm font-semibold truncate max-w-full px-2"
                style={{ color: stage.color || 'var(--v2-text-primary)' }}
              >
                {/* One rule for every stage name, shared with the funnel.
                    The dictionary can only know the stages WE seed; onboarding
                    invents one pipeline per business, so a key like
                    `family_enrolled` is never in it and fell straight through
                    to the stored Hebrew label — on an English board. */}
                {localizeStageLabel(stage.stage_key, stage.stage_label, language as StageLanguage, stage.stage_type)}
              </span>
              <span
                className="text-xs font-medium mt-0.5"
                style={{ color: `${stage.color}99` || 'var(--v2-text-secondary)' }}
              >
                {contactCounts[stage.stage_key] || 0}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Animated flow bar - equal width segments matching Kanban columns */}
      <div className="relative h-4 overflow-hidden flex" style={{ borderRadius: '8px', gap: '3px' }}>
        {stages.map((stage, index) => {
          const count = contactCounts[stage.stage_key] || 0;
          const stageColor = stage.color || '#8B5CF6';
          const isActive = count > 0;
          const isLast = index === stages.length - 1;

          return (
            <div
              key={stage.stage_key}
              className="flex-1 h-full relative overflow-hidden flex items-center"
              style={{ borderRadius: '4px' }}
            >
              {/* Stage segment background */}
              <div
                className="absolute inset-0 transition-all duration-500"
                style={{
                  backgroundColor: isActive ? stageColor : `${stageColor}25`,
                }}
              />

              {/* Shimmer effect for active segments */}
              {isActive && (
                <div
                  className="absolute inset-0 animate-pipeline-shimmer"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)`,
                    backgroundSize: '200% 100%'
                  }}
                />
              )}

              {/* Arrow connector (except for last stage) */}
              {!isLast && (
                <div
                  className="absolute h-full flex items-center animate-pipeline-pulse-arrow z-10"
                  style={{ insetInlineEnd: '-10px' }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${stageColor}CC 0%, ${stageColor} 100%)`,
                      boxShadow: `0 2px 6px ${stageColor}50`
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" className="text-white rtl:rotate-180">
                      <path
                        d="M4 3 L8 6 L4 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Flowing particles */}
        <div className="absolute inset-0 pointer-events-none">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute h-3 w-3 rounded-full animate-pipeline-flow-particle"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'radial-gradient(circle, #FFFFFF 0%, #C4B5FD 40%, #8B5CF6 100%)',
                boxShadow: '0 0 10px 3px rgba(139, 92, 246, 0.6), 0 0 4px 2px rgba(255, 255, 255, 0.7)',
                animationDelay: `${i * 1.5}s`
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface CRMPipelineViewProps {
  contacts: CRMContact[];
  stages: CRMPipelineStage[];
  /**
   * How many contacts each stage really holds, keyed by `stage_key`.
   *
   * The board only ever has a page of each column in hand, so counting the
   * cards on screen would report the page size as the size of the business.
   */
  stageTotals?: Record<string, number>;
  /** Fetch the next page for one column and append it. */
  onLoadMore?: (stageKey: string) => void;
  onContactClick: (contact: CRMContact) => void;
  onContactUpdated: () => void;
}

/** Remembers that this browser has been told how to pick a card up. */
const HOLD_HINT_KEY = 'crm.pipeline.hold-hint.dismissed';

// Helper to generate Tailwind-compatible color classes from hex color
function getStageColors(hexColor: string | null) {
  // Default colors if no color specified
  if (!hexColor) {
    return {
      textColor: 'text-slate-600 dark:text-slate-400',
      bgColor: 'bg-slate-500/10',
      borderColor: 'border-slate-500/30',
      dotStyle: { backgroundColor: '#64748B' }
    };
  }

  // Use inline styles for dynamic colors from the database
  return {
    textColor: '',
    bgColor: '',
    borderColor: '',
    dotStyle: { backgroundColor: hexColor },
    // Inline styles for dynamic hex colors
    headerStyle: {
      backgroundColor: `${hexColor}15`,
      borderColor: `${hexColor}40`,
      color: hexColor
    }
  };
}

/**
 * A card you can pick up with a finger, a mouse, or the keyboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It was `draggable` with the HTML5 drag events, which never fire on touch. So
 * the one thing a board is for could not be done on a phone at all, and could
 * not be done from a keyboard anywhere. `useDraggable` replaces both, and the
 * arrow keys below are the explicit path: one press, one stage.
 *
 * `listeners` must sit on the whole card rather than on the grip, because the
 * grip is `opacity-0 group-hover` and a finger has no hover.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function PipelineCard({
  contact,
  onClick,
  onNudge,
  label,
  children,
}: {
  contact: CRMContact;
  onClick: () => void;
  onNudge: (contact: CRMContact, direction: -1 | 1) => void;
  label: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: contact.id,
    data: { contact },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      tabIndex={0}
      {...(label ? { 'aria-label': label } : {})}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        /*
         * Reading order, not screen order. In Hebrew the next stage is to the
         * LEFT, and an arrow that moved a card by pixels rather than by
         * sequence would run the pipeline backwards for half the accounts.
         */
        const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
        onNudge(contact, event.key === forward ? 1 : -1);
      }}
      className={`
        bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4
        cursor-grab active:cursor-grabbing touch-manipulation
        hover:border-[#8B5CF6]/50 hover:shadow-lg hover:shadow-[#8B5CF6]/10
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]
        transition-all duration-200 group
        ${isDragging ? 'opacity-40' : ''}
      `}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      {children}
    </div>
  );
}

/**
 * Moving a card without a gesture at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Dragging is the quick way and the only way, which fails three readers: a
 * thumb carrying a card from the first stage to the last across five screens
 * of auto-scroll, anyone on a keyboard, and anyone on a screen reader.
 *
 * Every handler here stops propagation. The card above is a dnd-kit draggable
 * listening on the whole surface, so without that a press on this button would
 * arm a drag, and a tap would open the contact drawer underneath.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function MoveToMenu({
  stages,
  currentStage,
  label,
  language,
  onPick,
}: {
  stages: CRMPipelineStage[];
  currentStage: string;
  label: string;
  language: StageLanguage;
  onPick: (stageKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div ref={box} className="relative flex-shrink-0" onPointerDown={stop} onClick={stop}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(v => !v)}
        className="p-1 -m-1 rounded text-[var(--v2-text-muted)] hover:text-[#8B5CF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
      >
        <MoveRight className="h-4 w-4 rtl:rotate-180" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-30 mt-1 min-w-[170px] max-h-[220px] overflow-y-auto border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-xl end-0"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--v2-text-muted)]">{label}</div>
          {stages.map(stage => {
            const here = stage.stage_key === currentStage;
            return (
              <button
                key={stage.stage_key}
                type="button"
                role="menuitem"
                disabled={here}
                onClick={() => {
                  setOpen(false);
                  if (!here) onPick(stage.stage_key);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors ${
                  here
                    ? 'text-[var(--v2-text-muted)] cursor-default'
                    : 'text-[var(--v2-text-primary)] hover:bg-[#8B5CF6]/10'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: stage.color || '#8B5CF6' }}
                />
                <span className="truncate">
                  {localizeStageLabel(stage.stage_key, stage.stage_label, language, stage.stage_type)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One stage, and the area a card can be let go over. */
function StageColumn({
  stageKey,
  children,
}: {
  stageKey: string;
  children: (isOver: boolean) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });

  return (
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * ONE STAGE PER SCREEN ON A PHONE, THE WHOLE BOARD ON A DESKTOP.
     *
     * This was `flex-1` with an inline `minWidth: 200px`, which no breakpoint
     * can reach. Five stages made the board 1,012px wide and a sales pipeline's
     * seven made it 1,418px, so a 375px phone showed about one and a half
     * columns and scrolled a metre sideways.
     *
     * 85% leaves the next column visibly peeking, which is what tells a reader
     * there is more board to the side. `snap-center` makes a swipe land on a
     * stage rather than between two.
     * ─────────────────────────────────────────────────────────────────────────
     */
    <div
      ref={setNodeRef}
      className="flex w-[85%] flex-none snap-center flex-col sm:w-auto sm:flex-1 sm:snap-align-none sm:min-w-[200px]"
    >
      {children(isOver)}
    </div>
  );
}

export function CRMPipelineView({ contacts, stages, stageTotals, onLoadMore, onContactClick, onContactUpdated }: CRMPipelineViewProps) {
  const { t, language } = useLanguage();
  const [draggedContact, setDraggedContact] = useState<CRMContact | null>(null);
  // Optimistic updates: track contacts being moved (id -> new stage)
  const [pendingMoves, setPendingMoves] = useState<Record<string, string>>({});
  // Track previous contacts to detect when data has been refreshed
  const prevContactsRef = useRef<CRMContact[]>(contacts);
  /** The scrolling row of columns, so the header can bring one into view. */
  const boardRef = useRef<HTMLDivElement>(null);

  /*
   * Teaching the hold, once.
   *
   * Dragging on touch only begins after 250ms of stillness, so that a swipe
   * can still scroll the board. That is the right trade, and it is also
   * undiscoverable: a gesture nobody is told about is the same as no gesture.
   *
   * Read in an effect rather than in the initial state, because the server
   * renders this too and has no `localStorage` — reading it during render
   * makes the first client paint disagree with the server's.
   */
  const [hintDismissed, setHintDismissed] = useState(true);
  useEffect(() => {
    try {
      setHintDismissed(localStorage.getItem(HOLD_HINT_KEY) === '1');
    } catch {
      // Private browsing, or storage refused. Show it: a hint seen twice is a
      // smaller failure than one nobody ever sees.
      setHintDismissed(false);
    }
  }, []);

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HOLD_HINT_KEY, '1');
    } catch {
      // Nothing to do. It returns on the next load, which is survivable.
    }
  };

  // Clear pending moves when contacts data is refreshed from server
  useEffect(() => {
    if (contacts !== prevContactsRef.current) {
      // Contacts have been refreshed - clear any pending moves that are now reflected in the data
      setPendingMoves(prev => {
        const newPending: Record<string, string> = {};
        for (const [contactId, targetStage] of Object.entries(prev)) {
          const contact = contacts.find(c => c.id === contactId);
          // Only keep pending if contact doesn't exist or hasn't moved to target stage yet
          if (contact && contact.stage !== targetStage) {
            newPending[contactId] = targetStage;
          }
        }
        return newPending;
      });
      prevContactsRef.current = contacts;
    }
  }, [contacts]);

  const getContactsByStage = (stage: string) => {
    return contacts.filter(contact => {
      const pendingStage = pendingMoves[contact.id];

      // If this contact has a pending move
      if (pendingStage !== undefined) {
        // Show in the target stage only
        return pendingStage === stage;
      }

      // No pending move - use actual stage
      return contact.stage === stage;
    });
  };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TELLING A DRAG FROM A SCROLL, WHICH IS THE WHOLE PROBLEM ON A PHONE.
   *
   * A finger landing on a card is ambiguous: scrolling the board sideways and
   * picking a card up begin identically. The activation constraints settle it.
   *
   *   touch   hold still for 250ms. Move more than 8px before that and the
   *           gesture was a scroll, so it is never claimed and the browser
   *           keeps it. Without this every swipe would lift a card.
   *   mouse   8px of travel, the same figure the intake editor and the website
   *           page already use. A mouse has no scroll-versus-drag ambiguity, so
   *           it needs distance rather than patience.
   *
   * MouseSensor and TouchSensor rather than one PointerSensor, so each input
   * gets its own rule and `touch-action` need not be disabled on the card --
   * which would have stopped the column scrolling under a finger.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedContact((event.active.data.current?.contact as CRMContact) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const contact = event.active.data.current?.contact as CRMContact | undefined;
    const stage = event.over?.id;
    setDraggedContact(null);
    if (contact && typeof stage === 'string') void moveContact(contact, stage);
  };

  /** One stage along, for a reader who is not holding a mouse. */
  const nudgeContact = (contact: CRMContact, direction: -1 | 1) => {
    const current = pendingMoves[contact.id] ?? contact.stage;
    const index = stages.findIndex(stage => stage.stage_key === current);
    const next = stages[index + direction];
    if (index === -1 || !next) return;
    void moveContact(contact, next.stage_key);
  };

  const moveContact = async (contact: CRMContact, stage: string) => {
    const currentStage = pendingMoves[contact.id] ?? contact.stage;
    if (currentStage === stage) return;

    const contactId = contact.id;

    // Optimistic update: immediately move in UI
    setPendingMoves(prev => ({ ...prev, [contactId]: stage }));
    setDraggedContact(null);

    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      });

      if (response.ok) {
        // Refresh data from server - pendingMoves will be cleared by useEffect when new data arrives
        onContactUpdated();
      } else {
        // Revert on error by clearing pending move
        setPendingMoves(prev => {
          const { [contactId]: _, ...rest } = prev;
          return rest;
        });
      }
    } catch {
      // Revert on error by clearing pending move
      setPendingMoves(prev => {
        const { [contactId]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return t('crm.pipeline.just_now');
    if (seconds < 3600) return `${Math.floor(seconds / 60)}${t('crm.pipeline.min_ago')}`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}${t('crm.pipeline.hours_ago')}`;
    return `${Math.floor(seconds / 86400)}${t('crm.pipeline.days_ago')}`;
  };

  const getInitials = (contact: CRMContact) => {
    const first = contact.first_name?.[0] || '';
    const last = contact.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  /*
   * The counts in the funnel header: the stage's REAL size, not the page of it
   * currently on screen.
   *
   * Counting the cards was right while the board held every contact. With each
   * column loading twenty at a time it would report twenty for every stage, and
   * the funnel — whose entire job is showing where people accumulate — would
   * draw four equal blocks for any business past its first page.
   *
   * Falls back to the loaded count when no total was supplied, so the board
   * still adds up if it is ever rendered with a plain list of contacts.
   */
  const contactCounts: Record<string, number> = {};
  stages.forEach(stage => {
    contactCounts[stage.stage_key] =
      stageTotals?.[stage.stage_key] ?? getContactsByStage(stage.stage_key).length;
  });

  // Show empty state if no stages configured
  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center text-[var(--v2-text-muted)]">
          <User className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>{t('crm.pipeline.no_stages')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Animated Flow Header */}
      <PipelineFlowHeader
        stages={stages}
        contactCounts={contactCounts}
        language={language as StageLanguage}
        onStageSelect={index => {
          // `inline: 'center'` lands on the snap point; `block: 'nearest'`
          // stops the page itself jumping to bring the board into view.
          const column = boardRef.current?.children[index];
          column?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }}
      />

      {/*
        Said only where it is true and only until it is known.

        `sm:hidden` because the hold is a touch rule: a mouse picks a card up
        after 8px of travel and needs no telling. Hidden too when the board is
        empty, where there is nothing to practise on.
      */}
      {!hintDismissed && contacts.length > 0 && (
        <div className="sm:hidden -mt-3 mb-3 flex items-start gap-2 px-3 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[12px] text-[var(--v2-text-secondary)]"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <GripVertical className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[#8B5CF6]" />
          <span className="flex-1">{t('crm.pipeline.hold_hint')}</span>
          <button
            type="button"
            onClick={dismissHint}
            aria-label={t('common.dismiss')}
            className="p-0.5 -m-0.5 rounded text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] flex-shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Kanban Columns - matches flow header segments */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggedContact(null)}
      >
      {/*
        `snap-x snap-mandatory` below `sm:` so a swipe lands on a stage rather
        than between two. Off from `sm:` up, where the whole board is visible
        and snapping would fight an ordinary scroll.
      */}
      <div ref={boardRef} className="flex flex-1 overflow-x-auto snap-x snap-mandatory sm:snap-none" style={{ gap: '3px' }}>
      {stages.map(stage => {
        const stageContacts = getContactsByStage(stage.stage_key);

        return (
          <StageColumn key={stage.stage_key} stageKey={stage.stage_key}>
          {(isOver) => {
          const isDropTarget = isOver && draggedContact?.stage !== stage.stage_key;
          return (
            <>
            {/* Drop Zone */}
            <div
              className={`flex-1 space-y-3 overflow-y-auto p-1 transition-all duration-200 ${
                isDropTarget
                  ? 'bg-[#8B5CF6]/10 border-2 border-dashed border-[#8B5CF6] rounded-lg'
                  : ''
              }`}
            >
              {/* Contact Cards */}
              {stageContacts.map(contact => {
                // If there's a pending move, pass contact with updated stage
                const pendingStage = pendingMoves[contact.id];
                const contactWithCurrentStage = pendingStage
                  ? { ...contact, stage: pendingStage }
                  : contact;

                return (
                <PipelineCard
                  key={contact.id}
                  contact={contactWithCurrentStage}
                  onClick={() => onContactClick(contactWithCurrentStage)}
                  onNudge={nudgeContact}
                  /* Their own name, never a translation key: an unknown key
                     renders as itself, which is how a screen reader ends up
                     reading "crm.pipeline.contact" out loud. */
                  label={`${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.email || ''}
                >
                  <div className="space-y-3">
                    {/* Header with Avatar and Grip */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Avatar */}
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
                        >
                          {getInitials(contact)}
                        </div>
                        {/* Name */}
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--v2-text-primary)] group-hover:text-[#8B5CF6] transition-colors truncate">
                            {contact.first_name} {contact.last_name}
                          </div>
                          {/*
                            Inactive, said on the card.

                            The column already says which STAGE they are in, but
                            a card dragged out of context, or scanned in a list,
                            carries no such signal — and "no longer a client" is
                            the one fact about a contact that changes what you
                            would do with them. Read by stage TYPE, so it holds
                            for a pipeline that calls the stage `inactive` and
                            for one that calls it `הושלם`.
                          */}
                          {isContactInactive(contact.stage, stages) && (
                            <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--v2-border)]/40 text-[var(--v2-text-muted)]">
                              {t('crm.contact.inactive_badge')}
                            </span>
                          )}
                          {/*
                            The same group the drawer lights, from the same
                            derivation — the card said "Website Booking" while
                            the drawer showed nothing selected, because one
                            resolved a label straight off the stored value and
                            the other matched it against a list that never
                            contained it.
                          */}
                          {(() => {
                            const origin = contactOrigin(
                              contact.source,
                              contact.source_metadata as ContactSourceMetadata | null
                            );
                            const option = originOption(origin?.group);
                            if (!option) return null;
                            return (
                              <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                                {t(option.labelKey)}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      {/*
                        Drag handle.

                        `group-hover` is how it used to appear, and a finger
                        never hovers — so on a phone the only hint that a card
                        could be moved was invisible. `pointer-coarse` shows it
                        wherever hovering is not a thing.
                      */}
                      <GripVertical className="h-4 w-4 text-[var(--v2-text-muted)] opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex-shrink-0" />
                      <MoveToMenu
                        stages={stages}
                        currentStage={contactWithCurrentStage.stage}
                        label={t('crm.pipeline.move_to')}
                        language={language as StageLanguage}
                        onPick={stageKey => void moveContact(contact, stageKey)}
                      />
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-1.5">
                      {contact.email && (
                        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                          <Mail className="h-3.5 w-3.5 text-[var(--v2-text-muted)] flex-shrink-0" />
                          <span className="truncate">{contact.email}</span>
                        </div>
                      )}
                      {contact.phone && (
                        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                          <Phone className="h-3.5 w-3.5 text-[var(--v2-text-muted)] flex-shrink-0" />
                          <span dir="ltr">{contact.phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {contact.tags && contact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {contact.tags.slice(0, 3).map(tag => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs px-2 py-0.5 bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {contact.tags.length > 3 && (
                          <Badge
                            variant="outline"
                            className="text-xs px-2 py-0.5 bg-[var(--v2-surface)] text-[var(--v2-text-muted)] border-[var(--v2-border)]"
                          >
                            +{contact.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--v2-border)]">
                      <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)]">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span>{formatTimeAgo(contact.updated_at)}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {(contact.tasks_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-xs text-amber-500">
                            <CheckSquare className="h-3 w-3" />
                            <span>{contact.tasks_count}</span>
                          </div>
                        )}
                        {(contact.bookings_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-xs text-[#8B5CF6]">
                            <Calendar className="h-3 w-3" />
                            <span>{contact.bookings_count}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </PipelineCard>
              );})}

              {/* Empty State */}
              {/*
                More in this column than are on screen.

                Counted against the stage's real total rather than the page
                size, because an optimistic move can put a card in a column it
                was not fetched into — comparing to `PAGE_SIZE` would then
                either offer a page that does not exist or hide one that does.
              */}
              {onLoadMore && (() => {
                const total = stageTotals?.[stage.stage_key];
                if (total === undefined || stageContacts.length >= total) return null;
                return (
                  <button
                    type="button"
                    onClick={() => onLoadMore(stage.stage_key)}
                    className="w-full py-2 text-[12px] font-medium text-[#8B5CF6] hover:bg-[#8B5CF6]/5 border border-dashed border-[#8B5CF6]/40 transition-colors"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    {t('crm.pipeline.load_more')} ({total - stageContacts.length})
                  </button>
                );
              })()}

              {stageContacts.length === 0 && (
                <div
                  className={`
                    flex flex-col items-center justify-center py-12
                    border-2 border-dashed border-[var(--v2-border)]
                    text-[var(--v2-text-muted)] text-sm
                    ${isDropTarget ? 'border-[#8B5CF6] bg-[#8B5CF6]/5' : ''}
                  `}
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <User className="h-8 w-8 mb-2 opacity-40" />
                  <span>{t('crm.pipeline.no_contacts')}</span>
                  {isDropTarget && (
                    <span className="text-[#8B5CF6] mt-1 font-medium">
                      {t('crm.pipeline.drop_here')}
                    </span>
                  )}
                </div>
              )}
            </div>
            </>
          );
          }}
          </StageColumn>
        );
      })}
      </div>

      {/*
        The card in hand, drawn above everything.

        The column scrolls vertically and the board horizontally, so a card
        dragged in place is clipped by both. `DragOverlay` renders it in a
        portal at the top level, where neither can cut it off.
      */}
      <DragOverlay dropAnimation={null}>
        {draggedContact && (
          <div
            className="bg-[var(--v2-surface)] border-2 border-[#8B5CF6] p-4 shadow-2xl shadow-[#8B5CF6]/20 cursor-grabbing"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
                style={{ backgroundColor: '#8B5CF6' }}
              >
                {getInitials(draggedContact)}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-[var(--v2-text-primary)] truncate">
                  {`${draggedContact.first_name ?? ''} ${draggedContact.last_name ?? ''}`.trim() || draggedContact.email}
                </div>
                {draggedContact.email && (
                  <div className="text-xs text-[var(--v2-text-muted)] truncate">{draggedContact.email}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </DragOverlay>
      </DndContext>
    </div>
  );
}
