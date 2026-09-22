'use client';

/**
 * The answers to a choice question, and the four things the owner may do to them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Add · rename · remove · reorder. Nothing else — this is not a field builder.
 *
 * The answers were displayed but never editable: a generated question arrived
 * as "How would you describe your current fitness level? · Beginner ·
 * Intermediate · Advanced" and the owner's only recourse, if their clients do
 * not think in those three words, was to delete the whole question and hope a
 * re-worded note coaxed a different list out of the model.
 *
 * That was the wrong line to draw. The TYPE of a question is structure and the
 * platform owns it; the ANSWERS are content, exactly like the label, and a
 * wrong list does more damage than a wrong label because the client's reply is
 * recorded and acted on.
 *
 * REORDER IS NOT A NICETY. Add "Never trained" to Beginner · Intermediate ·
 * Advanced and it lands at the end — a scale printed out of order, which reads
 * to the client as a mistake. An add button without a way to move the new
 * answer into place is only half the feature.
 *
 * Dragged, not nudged: the same @dnd-kit setup the website sections use
 * (`SortableBlockItem` in app/business-os/website/page.tsx), down to the 8px
 * activation distance and the keyboard sensor — so reordering answers feels
 * like reordering sections rather than like a different product. Keeping the
 * keyboard coordinate getter matters: a drag-only list is unusable without a
 * pointer, and arrow keys still move a focused handle.
 *
 * ANSWERS ARE STORED BY LABEL, not by id (`IntakeAnswerField` passes
 * `option.label` to `onChange`). Renaming therefore changes what FUTURE clients
 * store and leaves past submissions alone — they carry their own snapshot of
 * the questions, so an old answer stays readable against the words actually
 * shown at the time. That is the behaviour we want, and worth knowing before
 * anyone "fixes" renaming to rewrite history.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import {
  MIN_CHOICE_OPTIONS,
  type IntakeQuestionOption,
} from '@/lib/business-os/intake/types';

interface Props {
  options: IntakeQuestionOption[];
  /** Whether a free-text "Other" is offered alongside the list. */
  allowOther: boolean;
  onChange: (options: IntakeQuestionOption[]) => void;
  onAllowOtherChange: (allowOther: boolean) => void;
  t: (key: string) => string;
}

/** Stable and opaque: ids are never derived from the words, which change. */
const newOptionId = () =>
  `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

interface RowProps {
  option: IntakeQuestionOption;
  autoFocus: boolean;
  canRemove: boolean;
  onRename: (label: string) => void;
  onRemove: () => void;
  onFocus: () => void;
  t: (key: string) => string;
}

function SortableOptionRow({
  option,
  autoFocus,
  canRemove,
  onRename,
  onRemove,
  onFocus,
  t,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : ('auto' as const),
      }}
      {...attributes}
      className="flex items-center gap-1"
    >
      {/*
        The handle carries the drag listeners, not the row. Spreading them over
        the whole row would swallow clicks into the text input — the field would
        look editable and refuse to take a caret.
      */}
      <button
        type="button"
        {...listeners}
        className="p-1 cursor-grab active:cursor-grabbing text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] flex-shrink-0"
        aria-label={t('config.intake.answer_reorder')}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <input
        value={option.label}
        onChange={e => onRename(e.target.value)}
        autoFocus={autoFocus}
        onFocus={onFocus}
        placeholder={t('config.intake.answer_placeholder')}
        className="flex-1 min-w-0 px-2 py-1 text-[13px] border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />

      {/*
        Disabled rather than hidden at the minimum. A control that vanishes
        leaves the owner wondering what they did; one that is visibly
        unavailable, with the reason on hover, explains itself.
      */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? t('config.intake.answer_remove') : t('config.intake.answers_min')}
        className="p-1 text-[var(--v2-text-muted)] hover:text-red-500 disabled:opacity-25 disabled:hover:text-[var(--v2-text-muted)] flex-shrink-0"
        aria-label={t('config.intake.answer_remove')}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function IntakeOptionsEditor({
  options,
  allowOther,
  onChange,
  onAllowOtherChange,
  t,
}: Props) {
  // Which row was just added, so a blank answer takes the caret without every
  // row fighting for focus on each render.
  const [focusId, setFocusId] = useState<string | null>(null);

  const sensors = useSensors(
    // 8px before a drag starts — the same threshold the website sections use,
    // and what stops a click on the handle registering as a one-pixel drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = options.findIndex(option => option.id === active.id);
    const to = options.findIndex(option => option.id === over.id);
    if (from === -1 || to === -1) return;

    onChange(arrayMove(options, from, to));
  };

  const add = () => {
    const option = { id: newOptionId(), label: '' };
    setFocusId(option.id);
    onChange([...options, option]);
  };

  const canRemove = options.length > MIN_CHOICE_OPTIONS;

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--v2-text-muted)]">
        {t('config.intake.answers')}
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={options.map(option => option.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {options.map(option => (
              <SortableOptionRow
                key={option.id}
                option={option}
                autoFocus={option.id === focusId}
                canRemove={canRemove}
                onRename={label =>
                  onChange(
                    options.map(candidate =>
                      candidate.id === option.id ? { ...candidate, label } : candidate
                    )
                  )
                }
                onRemove={() => {
                  if (!canRemove) return;
                  onChange(options.filter(candidate => candidate.id !== option.id));
                }}
                onFocus={() => setFocusId(option.id)}
                t={t}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-[11.5px] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
        >
          <Plus className="w-3 h-3" />
          {t('config.intake.answer_add')}
        </button>

        {/*
          The escape hatch for a list that does not fit. However carefully the
          owner picks their answers, some client is none of them — and without
          this that client picks a wrong one rather than no one at all.
        */}
        <button
          type="button"
          onClick={() => onAllowOtherChange(!allowOther)}
          className={`text-[10.5px] px-1.5 py-0.5 rounded-full border transition-colors ${
            allowOther
              ? 'border-[#22C58B] text-[#22C58B] bg-[#22C58B]/10'
              : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
          }`}
          title={t('config.intake.allow_other_hint')}
        >
          {t('config.intake.allow_other')}
        </button>
      </div>
    </div>
  );
}
