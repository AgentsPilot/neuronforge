'use client';

/**
 * The intake form, as the owner sees it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This screen replaces a template picker. The owner used to choose one of
 * eleven shared forms and preview it; now the form was written for their
 * business and this is where they read it, change it, and decide to send it.
 *
 * ONE SURFACE. There is no separate publish page, no builder, no field editor.
 * Preview is a MODE of this panel rather than a route, because "what will my
 * client see" is a question about the thing being edited and answering it
 * elsewhere loses the edit.
 *
 * FIVE ACTIONS PER QUESTION — edit, required, up, down, delete. Deliberately
 * not six: there is no type picker in the list, no validation, no layout, no
 * conditional-rule editor. A question's type is inferred when it is added and
 * changed by re-asking, which is the level of control the owner wants and the
 * level of complexity they do not.
 *
 * WHAT IS AND IS NOT LIVE is the one thing this screen must never be vague
 * about. The header says it in words, and the publish button is the only way to
 * change it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Check,
  Loader2,
  Eye,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  Sparkles,
  AlertCircle,
  CornerDownRight,
  Send,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { TabFooter } from '@/components/business-os/settings/TabFooter';
import { createLogger } from '@/lib/logger';
import type { IntakeForm, IntakeQuestion } from '@/lib/business-os/intake/types';
import { IntakeQuestionRow } from './intake/IntakeQuestionRow';
import { IntakeCustomerPreview } from './intake/IntakeCustomerPreview';
import { AddIntakeQuestion } from './intake/AddIntakeQuestion';

const logger = createLogger({ module: 'IntakeSettingsPanel' });

// Configuration theme color: Pink (#D14E97)
const CONFIG_COLOR = '#D14E97';

interface IntakeSettingsPanelProps {
  onSaved?: () => void;
}

interface FormState {
  questions: IntakeQuestion[];
  /** True while the owner has edits nobody has received. */
  isDraft: boolean;
  hasPublished: boolean;
  isEnabled: boolean;
  sendAfterBooking: boolean;
  contentSource: 'llm' | 'fallback' | 'manual' | null;
}

const EMPTY: FormState = {
  questions: [],
  isDraft: false,
  hasPublished: false,
  isEnabled: false,
  sendAfterBooking: true,
  contentSource: null,
};

export function IntakeSettingsPanel({ onSaved }: IntakeSettingsPanelProps) {
  const { t, isRTL } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/intake/form', { cache: 'no-store' });
      const body = await response.json();
      if (!body.success) {
        // Said out loud. Returning quietly here left the panel showing whatever
        // it had last — usually the empty state — with no hint that the read
        // had failed rather than the form being absent.
        setError(t('config.intake.load_failed'));
        return;
      }

      setError(null);
      const { draft, published, settings } = body.data;
      // The DRAFT is what this screen edits when there is one; the published
      // form is what it edits from when there is not.
      const active = draft ?? published;

      setForm({
        questions: active?.questions ?? [],
        isDraft: !!draft,
        hasPublished: !!published,
        isEnabled: settings.is_enabled,
        sendAfterBooking: settings.send_after_booking,
        contentSource: active?.generated_from?.source ?? null,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the intake form');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Take the screen's state from the write that just happened.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Generating and publishing both used to finish by calling `load()` — a
   * second request, asking the server to describe a change it had just
   * confirmed. When that request did not land, nothing on screen moved: the
   * form generated, the panel stayed empty, and the questions only appeared
   * after the dialog was closed and reopened, because reopening remounts the
   * panel and runs `load()` again from scratch.
   *
   * Both routes already return the resulting row. Using it is one fewer thing
   * that has to succeed for the screen to be right, and it is also instant —
   * there is no round trip between the owner clicking publish and the header
   * saying Published.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const applyForm = useCallback((form: IntakeForm, published: boolean) => {
    setForm(prev => ({
      ...prev,
      questions: form.questions ?? [],
      // Publishing consumes the draft: the row that was the draft IS now the
      // published one, so there is nothing unpublished left to publish.
      isDraft: !published,
      hasPublished: published || prev.hasPublished,
      contentSource: form.generated_from?.source ?? prev.contentSource,
    }));
  }, []);

  /**
   * Every edit is the same write: the whole list.
   *
   * Optimistic, because reordering a list that waits for a round trip before
   * moving feels broken. A failed save reloads from the server rather than
   * leaving the screen showing something that is not stored.
   */
  const saveQuestions = async (questions: IntakeQuestion[]) => {
    const previous = form.questions;
    setForm(prev => ({ ...prev, questions, isDraft: true }));
    setError(null);

    try {
      const response = await fetch('/api/intake/form', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      const body = await response.json();

      if (!body.success) {
        setForm(prev => ({ ...prev, questions: previous }));
        setError(body.error || t('config.intake.save_failed'));
      }
    } catch (err) {
      logger.error({ err }, 'Failed to save the intake form');
      setForm(prev => ({ ...prev, questions: previous }));
      setError(t('config.intake.save_failed'));
    }
  };

  const generate = async (regenerate: boolean) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/intake/form/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate }),
      });
      const body = await response.json();

      if (!body.success) {
        setError(body.error || t('config.intake.generate_failed'));
        return;
      }

      if (body.data?.form) {
        applyForm(body.data.form, false);
      } else {
        // Older shape, or a response without the row. Falls back to re-reading
        // rather than leaving the screen showing nothing.
        await load();
      }
    } catch (err) {
      logger.error({ err }, 'Failed to generate the intake form');
      setError(t('config.intake.generate_failed'));
    } finally {
      setGenerating(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const response = await fetch('/api/intake/form/publish', { method: 'POST' });
      const body = await response.json();

      if (!body.success) {
        setError(body.error || t('config.intake.publish_failed'));
        return;
      }

      if (body.data) {
        applyForm(body.data, true);
      } else {
        await load();
      }
      onSaved?.();
    } catch (err) {
      logger.error({ err }, 'Failed to publish the intake form');
      setError(t('config.intake.publish_failed'));
    } finally {
      setPublishing(false);
    }
  };

  const saveSettings = async (next: { is_enabled?: boolean; send_after_booking?: boolean }) => {
    setSavingSettings(true);
    setForm(prev => ({
      ...prev,
      isEnabled: next.is_enabled ?? prev.isEnabled,
      sendAfterBooking: next.send_after_booking ?? prev.sendAfterBooking,
    }));

    try {
      await fetch('/api/intake/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled: next.is_enabled ?? form.isEnabled,
          send_after_booking: next.send_after_booking ?? form.sendAfterBooking,
        }),
      });
      onSaved?.();
    } catch (err) {
      logger.error({ err }, 'Failed to save intake settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // ── question edits ─────────────────────────────────────────────────────
  const updateQuestion = (id: string, patch: Partial<IntakeQuestion>) =>
    saveQuestions(form.questions.map(q => (q.id === id ? { ...q, ...patch } : q)));

  const deleteQuestion = (id: string) =>
    /*
     * A question revealed by the deleted one goes too. Left behind it could
     * never be shown — its parent's answer no longer exists — and the owner
     * would be looking at a question their clients never see, with nothing on
     * screen to explain why.
     */
    saveQuestions(form.questions.filter(q => q.id !== id && q.showIf?.questionId !== id));

  const move = (id: string, direction: -1 | 1) => {
    const index = form.questions.findIndex(q => q.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= form.questions.length) return;

    const next = [...form.questions];
    [next[index], next[target]] = [next[target], next[index]];

    /*
     * A follow-up cannot be moved above the question it depends on, and its
     * parent cannot be moved below it. The server refuses that order anyway;
     * refusing it here means the row simply does not move, rather than moving
     * and springing back when the save fails.
     */
    const positions = new Map(next.map((q, i) => [q.id, i]));
    const broken = next.some(
      q => q.showIf && (positions.get(q.showIf.questionId) ?? -1) >= (positions.get(q.id) ?? 0)
    );
    if (broken) return;

    void saveQuestions(next);
  };

  const addQuestion = (question: IntakeQuestion) =>
    saveQuestions([...form.questions, question]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: CONFIG_COLOR }} />
      </div>
    );
  }

  const empty = form.questions.length === 0;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Header: what this is, and whether it is live ──────────────────
          The state sentence sits with the questions rather than in a badge
          somewhere else, because "is this reaching my clients?" is the question
          the owner has while reading them. */}
      <div
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-5"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${CONFIG_COLOR}20` }}
            >
              <ClipboardList className="w-5 h-5" style={{ color: CONFIG_COLOR }} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                {t('config.intake.title')}
              </h3>
              <p className="text-sm text-[var(--v2-text-muted)] mt-0.5">
                {form.isDraft
                  ? t('config.intake.state_draft')
                  : form.hasPublished
                    ? t('config.intake.state_published')
                    : t('config.intake.subtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={() => saveSettings({ is_enabled: !form.isEnabled })}
            disabled={savingSettings}
            aria-label={t('config.intake.title')}
            className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60"
            style={{
              backgroundColor: form.isEnabled ? CONFIG_COLOR : 'var(--v2-border)',
            }}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                form.isEnabled ? (isRTL ? 'left-1' : 'right-1') : isRTL ? 'right-1' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      {form.isEnabled && (
        <>
          {error && (
            <div
              className="flex items-start gap-2.5 border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-[var(--v2-text-primary)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Nothing written yet — the only state with a single obvious act. */}
          {empty && !generating && (
            <div
              className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6 text-center"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <p className="text-sm text-[var(--v2-text-primary)]">
                {t('config.intake.empty_title')}
              </p>
              <p className="text-[12.5px] text-[var(--v2-text-muted)] mt-1">
                {t('config.intake.empty_body')}
              </p>
              <button
                onClick={() => generate(false)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: CONFIG_COLOR, borderRadius: 'var(--v2-radius-button)' }}
              >
                <Sparkles className="w-4 h-4" />
                {t('config.intake.generate')}
              </button>
            </div>
          )}

          {generating && (
            <div
              className="flex items-center justify-center gap-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] py-8 text-sm text-[var(--v2-text-muted)]"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('config.intake.generating')}
            </div>
          )}

          {!empty && !generating && (
            <>
              {/* A generic form is not the form we promised. Said plainly, with
                  the way to try again, rather than passed off as personalised. */}
              {form.contentSource === 'fallback' && (
                <div
                  className="flex items-start gap-2.5 border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3 py-2.5 text-[12.5px] text-[var(--v2-text-secondary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--v2-text-muted)]" />
                  <span>{t('config.intake.generic_notice')}</span>
                </div>
              )}

              {previewing ? (
                <IntakeCustomerPreview
                  questions={form.questions}
                  onBack={() => setPreviewing(false)}
                  isRTL={isRTL}
                  t={t}
                />
              ) : (
                <div className="space-y-2">
                  {form.questions.map((question, index) => (
                    <IntakeQuestionRow
                      key={question.id}
                      question={question}
                      index={index}
                      total={form.questions.length}
                      // Drawn under its parent so a condition reads as a shape
                      // rather than as a rule the owner has to decode.
                      parentLabel={
                        question.showIf
                          ? form.questions.find(q => q.id === question.showIf!.questionId)?.label
                          : undefined
                      }
                      onChange={patch => updateQuestion(question.id, patch)}
                      onDelete={() => deleteQuestion(question.id)}
                      onMoveUp={() => move(question.id, -1)}
                      onMoveDown={() => move(question.id, 1)}
                      isRTL={isRTL}
                      t={t}
                    />
                  ))}

                  <AddIntakeQuestion onAdd={addQuestion} t={t} isRTL={isRTL} />
                </div>
              )}

              {/* ── What happens to it ──────────────────────────────────── */}
              <div
                className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-4 space-y-3"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.sendAfterBooking}
                    onChange={e => saveSettings({ send_after_booking: e.target.checked })}
                    className="mt-0.5 w-4 h-4"
                    style={{ accentColor: CONFIG_COLOR }}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm text-[var(--v2-text-primary)]">
                      <Send className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                      {t('config.intake.send_after_booking')}
                    </span>
                    <span className="block text-[11.5px] text-[var(--v2-text-muted)] mt-0.5">
                      {t('config.intake.send_after_booking_hint')}
                    </span>
                  </span>
                </label>
              </div>

              {/* ── Footer: preview, regenerate, publish ──────────────────
                  Frozen at the bottom of the tab. The generated questions run
                  past a screen, so an owner reviewing the last of them had to
                  scroll back up to publish what they had just read. */}
              <TabFooter
                message={
                  /* The one sentence that says whether clients are getting
                     this — beside the button that would change the answer. */
                  !form.hasPublished ? (
                    <p className="flex items-center gap-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">
                      <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" />
                      {t('config.intake.not_live_yet')}
                    </p>
                  ) : null
                }
              >
                <button
                  onClick={() => setPreviewing(p => !p)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {previewing ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {previewing ? t('config.intake.back_to_edit') : t('config.intake.preview')}
                </button>

                <button
                  onClick={() => generate(true)}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('config.intake.regenerate')}
                </button>

                {/* Enabled only when there is something unpublished. A publish
                    button that is always live invites the owner to press it and
                    wonder what changed. */}
                <button
                  onClick={publish}
                  disabled={publishing || !form.isDraft || empty}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-medium text-white disabled:opacity-40"
                  style={{ backgroundColor: CONFIG_COLOR, borderRadius: 'var(--v2-radius-button)' }}
                >
                  {publishing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  {form.hasPublished
                    ? t('config.intake.publish_changes')
                    : t('config.intake.publish')}
                </button>
              </TabFooter>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default IntakeSettingsPanel;
