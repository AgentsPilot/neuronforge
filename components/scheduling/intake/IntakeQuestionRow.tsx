'use client';

/**
 * One question, and the five things the owner may do to it.
 *
 * Edit · required · up · down · delete. There is no sixth: no type picker, no
 * validation, no options editor, no conditional-rule builder. Those are the
 * controls a form designer needs, and the owner is not designing a form — they
 * are reading the questions the platform wrote and deciding whether they are
 * the right ones to ask.
 *
 * The type is shown as a plain-language chip rather than offered as a choice.
 * It is information — "this one takes a photo" — not a decision to make while
 * scanning a list.
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, CornerDownRight, Pencil, Trash2, X } from 'lucide-react';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';

interface Props {
  question: IntakeQuestion;
  index: number;
  total: number;
  /** The question this one follows from, when it is conditional. */
  parentLabel?: string;
  onChange: (patch: Partial<IntakeQuestion>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isRTL: boolean;
  t: (key: string) => string;
}

export function IntakeQuestionRow({
  question,
  index,
  total,
  parentLabel,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isRTL,
  t,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(question.label);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const commit = () => {
    const next = label.trim();
    // An empty label would render as a blank question to a client. Reverting is
    // kinder than refusing: the owner meant to change it, not to remove it.
    if (next && next !== question.label) onChange({ label: next });
    else setLabel(question.label);
    setEditing(false);
  };

  return (
    <div
      className={`bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3 ${
        parentLabel ? (isRTL ? 'me-6' : 'ms-6') : ''
      }`}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
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
        <span className="text-[11px] text-[var(--v2-text-muted)] tabular-nums pt-1.5 w-4 flex-shrink-0">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') {
                    setLabel(question.label);
                    setEditing(false);
                  }
                }}
                autoFocus
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
              <button onClick={commit} className="p-1 text-[#22C58B]" aria-label={t('common.save')}>
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setLabel(question.label);
                  setEditing(false);
                }}
                className="p-1 text-[var(--v2-text-muted)]"
                aria-label={t('common.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
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
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] disabled:opacity-25"
            aria-label={t('config.intake.move_up')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] disabled:opacity-25"
            aria-label={t('config.intake.move_down')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
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
