'use client';

/**
 * "What would you like to ask your customers?"
 *
 * One text box. The owner describes what they want to know; the platform works
 * out how to collect it — yes/no, a number, a date, a short list, a photo
 * upload. That inference is the entire point: asking a non-technical person to
 * choose a field type is asking them to design a data structure in order to
 * find out where someone lives.
 *
 * The inferred type is shown before the question is added, and can be changed
 * from eight plain-language choices. Shown rather than hidden because a guess
 * the owner cannot see is a guess they cannot correct — but offered second,
 * after the question they actually care about.
 */

import { useState } from 'react';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import {
  INTAKE_QUESTION_TYPES,
  type IntakeQuestion,
  type IntakeQuestionType,
} from '@/lib/business-os/intake/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AddIntakeQuestion' });

const CONFIG_COLOR = '#D14E97';

interface Props {
  onAdd: (question: IntakeQuestion) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

export function AddIntakeQuestion({ onAdd, t, isRTL }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState<IntakeQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setText('');
    setDraft(null);
    setError(null);
  };

  const infer = async () => {
    const note = text.trim();
    if (note.length < 2) return;

    setThinking(true);
    setError(null);

    try {
      const response = await fetch('/api/intake/form/infer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note }),
      });
      const body = await response.json();

      if (!body.success) {
        // The safety filter refuses restricted subjects here too, and its
        // message explains what to ask instead — worth showing verbatim rather
        // than flattening into "that didn't work".
        setError(body.error || t('config.intake.add_failed'));
        return;
      }

      setDraft(body.data as IntakeQuestion);
    } catch (err) {
      logger.error({ err }, 'Failed to infer a question');
      setError(t('config.intake.add_failed'));
    } finally {
      setThinking(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-medium border border-dashed border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <Plus className="w-4 h-4" />
        {t('config.intake.add_question')}
      </button>
    );
  }

  return (
    <div
      className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-4 space-y-3"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--v2-text-primary)]">{t('config.intake.add_prompt')}</p>
        <button onClick={reset} className="p-1 text-[var(--v2-text-muted)]" aria-label={t('common.cancel')}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {!draft ? (
        <>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void infer();
              }
            }}
            rows={2}
            autoFocus
            placeholder={t('config.intake.add_placeholder')}
            className="w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] resize-none focus:outline-none"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />

          {error && <p className="text-[12px] text-amber-600 dark:text-amber-400">{error}</p>}

          <button
            onClick={infer}
            disabled={thinking || text.trim().length < 2}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: CONFIG_COLOR, borderRadius: 'var(--v2-radius-button)' }}
          >
            {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t('config.intake.add_continue')}
          </button>
        </>
      ) : (
        <>
          {/* What will be added, in the client's words, before it is added. */}
          <div
            className="border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2.5"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <p className="text-sm text-[var(--v2-text-primary)]">{draft.label}</p>
            {draft.options?.length ? (
              <p className="text-[11.5px] text-[var(--v2-text-muted)] mt-1">
                {draft.options.map(option => option.label).join(' · ')}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-[var(--v2-text-muted)]">{t('config.intake.answer_type')}</p>
            <div className="flex flex-wrap gap-1.5">
              {INTAKE_QUESTION_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => setDraft({ ...draft, type: type as IntakeQuestionType })}
                  className={`px-2 py-1 text-[11px] rounded-full border transition-colors ${
                    draft.type === type
                      ? 'border-[#D14E97] text-[#D14E97] bg-[#D14E97]/10'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  {t(`config.intake.type.${type}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onAdd(draft);
                reset();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium text-white"
              style={{ backgroundColor: CONFIG_COLOR, borderRadius: 'var(--v2-radius-button)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('config.intake.add_confirm')}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="px-3 py-2 text-[12.5px] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
            >
              {t('config.intake.add_rephrase')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
