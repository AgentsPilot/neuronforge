'use client';

/**
 * One question, and what the owner may do to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Edit · required · drag · delete — and, inside edit, the two things a client
 * actually READS: the help line, and the answers themselves.
 *
 * WHAT IS STILL NOT HERE, deliberately: no type picker, no validation rules, no
 * conditional-rule builder. The line is between content and structure. The
 * owner writes what the client reads; the platform owns what the answer MEANS.
 *
 * The type is the clearest case. Changing it after answers exist reinterprets
 * data already collected — a `short_text` reply of "about two years" matches no
 * option once the question becomes `single_choice`. It is chosen when the
 * question is added, before anyone has answered, which is the only safe moment.
 * So the type stays a plain-language chip here: information, not a decision to
 * make while scanning a list.
 *
 * The ANSWERS were on the wrong side of that line. They were printed as a grey
 * caption and could not be touched, so a question whose wording was right but
 * whose choices were wrong could only be deleted whole. A wrong choice list is
 * worse than a wrong label, because the client's reply is recorded and the
 * business prepares from it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, CornerDownRight, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import {
  questionTakesOptions,
  type IntakeQuestion,
  type IntakeQuestionOption,
} from '@/lib/business-os/intake/types';
import { IntakeOptionsEditor } from './IntakeOptionsEditor';

interface Props {
  question: IntakeQuestion;
  /** Position in the list, shown as the number beside the question. */
  index: number;
  /** The question this one follows from, when it is conditional. */
  parentLabel?: string;
  onChange: (patch: Partial<IntakeQuestion>) => void;
  onDelete: () => void;
  t: (key: string) => string;
}

export function IntakeQuestionRow({
  question,
  index,
  parentLabel,
  onChange,
  onDelete,
  t,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(question.label);
  const [help, setHelp] = useState(question.help ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const takesOptions = questionTakesOptions(question.type);

  const cancel = () => {
    setLabel(question.label);
    setHelp(question.help ?? '');
    setEditing(false);
  };

  const commit = () => {
    const patch: Partial<IntakeQuestion> = {};

    const nextLabel = label.trim();
    // An empty label would render as a blank question to a client. Reverting is
    // kinder than refusing: the owner meant to change it, not to remove it.
    if (nextLabel && nextLabel !== question.label) patch.label = nextLabel;
    else setLabel(question.label);

    /*
     * An emptied help line is a real edit, not a no-op, so it is written as
     * `undefined` rather than skipped. Treating blank as "no change" would make
     * the sentence impossible to remove once written.
     */
    const nextHelp = help.trim();
    if (nextHelp !== (question.help ?? '')) patch.help = nextHelp || undefined;

    if (Object.keys(patch).length) onChange(patch);
    setEditing(false);
  };

  /*
   * Answers commit on every keystroke, unlike the label.
   *
   * The label is one field with an obvious commit point; the answers are a list
   * with adds, removes and drags, and holding them in local state until a tick
   * is pressed means a drag that is never "saved" silently reverts. Writing
   * straight through keeps what the owner sees and what the form holds the same
   * thing — and the form itself is a draft until published, so nothing reaches
   * a client either way.
   */
  const commitOptions = (options: IntakeQuestionOption[]) => onChange({ options });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      /*
       * `ms-6` in both directions, not flipped by hand.
       *
       * A follow-up question is indented from the side the reader starts from,
       * which is what margin-inline-start means. The panel sets `dir`, so the
       * property already flips — the old `isRTL ? 'me-6' : 'ms-6'` flipped it a
       * second time and indented Hebrew from the left.
       */
      className={`bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3 ${
        parentLabel ? 'ms-6' : ''
      }`}
      style={{
        borderRadius: 'var(--v2-radius-card)',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : ('auto' as const),
      }}
    >
      {/* A condition, drawn rather than written as a rule. The owner sees which
          answer reveals this question; they never see an expression. */}
      {parentLabel && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--v2-text-muted)]">
          <CornerDownRight className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            {t('config.intake.shown_when')
              .replace('{question}', parentLabel)
              .replace(
                '{answer}',
                typeof question.showIf?.equals === 'boolean'
                  ? question.showIf.equals
                    ? t('config.intake.answer_yes')
                    : t('config.intake.answer_no')
                  : String(question.showIf?.equals ?? '')
              )}
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/*
          The handle leads the row, on the side the reader starts from — left in
          English, right in Hebrew. The panel sets `dir`, so DOM order decides
          this and no RTL branch is needed.

          Dragged, not nudged: two arrows cost two clicks per position and say
          nothing about where a question will land; a grip moves it in one
          gesture, the same way the website sections reorder.

          The listeners sit on the handle rather than the row, or every click
          inside the row — the label, the required pill, delete — would be read
          as the start of a drag.
        */}
        <button
          type="button"
          {...listeners}
          className="p-1 -ms-1 mt-0.5 cursor-grab active:cursor-grabbing text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] flex-shrink-0"
          aria-label={t('config.intake.answer_reorder')}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        <span className="text-[11px] text-[var(--v2-text-muted)] tabular-nums pt-1.5 w-4 flex-shrink-0">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div>
              <div className="flex items-center gap-1.5">
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') cancel();
                  }}
                  autoFocus
                  className="flex-1 min-w-0 px-2 py-1 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <button onClick={commit} className="p-1 text-[#22C58B]" aria-label={t('common.save')}>
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={cancel}
                  className="p-1 text-[var(--v2-text-muted)]"
                  aria-label={t('common.cancel')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/*
                The line under the question. Often the cheapest fix for a
                question that is nearly right — "we mean gym training, not
                sport" settles what the answers would otherwise have to.
              */}
              <input
                value={help}
                onChange={e => setHelp(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') cancel();
                }}
                placeholder={t('config.intake.help_placeholder')}
                className="mt-1 w-full px-2 py-1 text-[12px] border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] focus:outline-none"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />

              {takesOptions && (
                <IntakeOptionsEditor
                  options={question.options ?? []}
                  allowOther={question.allowOther === true}
                  onChange={commitOptions}
                  onAllowOtherChange={allowOther => onChange({ allowOther })}
                  t={t}
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-start text-sm text-[var(--v2-text-primary)] hover:underline"
            >
              {question.label}
            </button>
          )}

          {/* The help line, where the client sees it: under the question. */}
          {!editing && question.help ? (
            <p className="mt-0.5 text-[11.5px] text-[var(--v2-text-muted)]">{question.help}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {/* Information, not a control. */}
            <span className="text-[10.5px] px-1.5 py-0.5 border border-[var(--v2-border)] text-[var(--v2-text-muted)] rounded-full">
              {t(`config.intake.type.${question.type}`)}
            </span>

            <button
              type="button"
              onClick={() => onChange({ required: !question.required })}
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full border transition-colors ${
                question.required
                  ? 'border-[#D14E97] text-[#D14E97] bg-[#D14E97]/10'
                  : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
              }`}
            >
              {question.required ? t('config.intake.required') : t('config.intake.optional')}
            </button>

            {question.options?.length ? (
              <span className="text-[10.5px] text-[var(--v2-text-muted)] truncate">
                {question.options.map(option => option.label).join(' · ')}
                {/* Shown because it is an answer the client can give, and the
                    caption is meant to be the whole list of them. */}
                {question.allowOther ? ` · ${t('config.intake.allow_other')}` : ''}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
            aria-label={t('config.intake.edit')}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          {/* Confirmed in place. A dialog for deleting one line of text is more
              interruption than the act deserves, and no confirmation at all
              loses work to a mis-click. */}
          {confirmingDelete ? (
            <button
              onClick={onDelete}
              onBlur={() => setConfirmingDelete(false)}
              autoFocus
              className="px-1.5 py-0.5 text-[10.5px] font-medium text-red-600 border border-red-600/40 rounded-full"
            >
              {t('config.intake.confirm_delete')}
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="p-1 text-[var(--v2-text-muted)] hover:text-red-500"
              aria-label={t('config.intake.delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
