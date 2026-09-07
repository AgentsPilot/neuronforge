'use client';

/**
 * The form, as the client meets it.
 *
 * Inert on purpose: the inputs render and accept nothing. The owner is here to
 * read what they are about to send, and a preview that collected answers would
 * invite them to fill it in and wonder where the answers went.
 *
 * Conditional questions ARE shown, marked as conditional, rather than hidden
 * until their trigger is answered. Hiding them would be a truer simulation and
 * a worse review: the owner is checking that every question they are asking is
 * a question they want to ask, and one that only appears sometimes is still one
 * of them.
 */

import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import { CornerDownRight } from 'lucide-react';

interface Props {
  questions: IntakeQuestion[];
  onBack: () => void;
  isRTL: boolean;
  t: (key: string) => string;
}

export function IntakeCustomerPreview({ questions, isRTL, t }: Props) {
  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5 space-y-5"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
      // Not a form. Nothing here submits, and marking it inert keeps a stray
      // Enter from doing anything at all.
      aria-label={t('config.intake.preview')}
    >
      <p className="text-[11px] uppercase tracking-wide text-[var(--v2-text-muted)]">
        {t('config.intake.preview_notice')}
      </p>

      {questions.map(question => (
        <div key={question.id} className="space-y-1.5">
          <label className="block text-sm text-[var(--v2-text-primary)]">
            {question.label}
            {question.required && <span className="text-red-500 ms-1">*</span>}
          </label>

          {question.help && (
            <p className="text-[11.5px] text-[var(--v2-text-muted)]">{question.help}</p>
          )}

          {question.showIf && (
            <p className="flex items-center gap-1 text-[11px] text-[var(--v2-text-muted)]">
              <CornerDownRight className="w-3 h-3 flex-shrink-0" />
              {t('config.intake.preview_conditional')}
            </p>
          )}

          <PreviewField question={question} t={t} />
        </div>
      ))}
    </div>
  );
}

/**
 * One inert control per answer type.
 *
 * Every type the generator can produce has a shape here. A missing case would
 * show the owner an empty space where their client will see an input — the one
 * thing a preview must not do.
 */
function PreviewField({ question, t }: { question: IntakeQuestion; t: (key: string) => string }) {
  const box =
    'w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-muted)]';
  const radius = { borderRadius: 'var(--v2-radius-button)' };

  switch (question.type) {
    case 'long_text':
      return <div className={`${box} h-16`} style={radius} aria-hidden="true" />;

    case 'yes_no':
      return (
        <div className="flex gap-2">
          {[t('config.intake.answer_yes'), t('config.intake.answer_no')].map(label => (
            <span
              key={label}
              className="px-3 py-1.5 text-[12.5px] border border-[var(--v2-border)] text-[var(--v2-text-muted)]"
              style={radius}
            >
              {label}
            </span>
          ))}
        </div>
      );

    case 'single_choice':
    case 'multi_choice':
      return (
        <div className="space-y-1">
          {(question.options ?? []).map(option => (
            <div key={option.id} className="flex items-center gap-2 text-[12.5px] text-[var(--v2-text-muted)]">
              <span
                className={`w-3.5 h-3.5 border border-[var(--v2-border)] flex-shrink-0 ${
                  question.type === 'single_choice' ? 'rounded-full' : 'rounded-sm'
                }`}
              />
              {option.label}
            </div>
          ))}
        </div>
      );

    case 'file':
      return (
        <div
          className="border border-dashed border-[var(--v2-border)] px-3 py-4 text-center text-[12px] text-[var(--v2-text-muted)]"
          style={radius}
        >
          {t('config.intake.preview_upload').replace('{count}', String(question.maxFiles ?? 1))}
        </div>
      );

    case 'date':
    case 'number':
    case 'short_text':
    default:
      return <div className={`${box} h-9`} style={radius} aria-hidden="true" />;
  }
}
