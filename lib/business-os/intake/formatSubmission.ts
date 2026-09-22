/**
 * A completed intake form, as readable lines.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS READS THE SUBMISSION AND NOTHING ELSE
 *
 * `IntakeSubmission.questions` is a snapshot of the form as it was answered,
 * recorded beside the answers precisely so a submission stays readable after
 * the form is edited and republished. The 2026-09-10 migration went back and
 * gave the old rows the same property by hand, because without it a three-
 * version-old submission renders as a list of values with nothing saying what
 * was asked.
 *
 * So this needs no form lookup, no version resolution, and no join. Everything
 * it prints is in the column it was handed.
 *
 * Note for anyone tempted to reuse `SessionCard.getFieldLabel` instead: that
 * one reads `intakeTemplate.fields`, the OLD shape, and falls back to tidying
 * the key when there is no template. Question ids are uuids now, so on a
 * current submission it would print a uuid as the question.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/intake
 */

import type { IntakeQuestion, IntakeSubmission } from './types';

export interface IntakeAnswerLine {
  question: string;
  answer: string;
}

type Language = 'en' | 'he' | 'es';

const YES: Record<Language, string> = { en: 'Yes', he: 'כן', es: 'Sí' };
const NO: Record<Language, string> = { en: 'No', he: 'לא', es: 'No' };

/** A stored choice value shown as the option's label, when it is one. */
function choiceLabel(question: IntakeQuestion | undefined, value: string): string {
  const option = question?.options?.find((o) => o.id === value || o.label === value);
  return option?.label ?? value;
}

function answerText(
  question: IntakeQuestion | undefined,
  value: unknown,
  language: Language
): string {
  if (typeof value === 'boolean') return value ? YES[language] : NO[language];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? choiceLabel(question, v) : String(v)))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'string') return choiceLabel(question, value);
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Question-and-answer pairs, in the order the form asked them.
 *
 * Unanswered questions are dropped rather than printed empty: a form is mostly
 * optional questions, and a reader scanning for what the client said is not
 * helped by eleven blanks around the two things they wrote.
 *
 * An answer whose question is missing from the snapshot still appears, under
 * its id. That should not happen — the snapshot is written at submission time —
 * but silently dropping a client's answer is the worse failure of the two.
 */
export function intakeAnswerLines(
  submission: unknown,
  language: Language = 'en'
): IntakeAnswerLine[] {
  const parsed = submission as Partial<IntakeSubmission> | null | undefined;
  const responses = parsed?.responses;
  if (!responses || typeof responses !== 'object') return [];

  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const byId = new Map(questions.map((q) => [q.id, q]));

  // The form's own order, then anything answered that the snapshot does not
  // describe.
  const ordered = [
    ...questions.map((q) => q.id),
    ...Object.keys(responses).filter((id) => !byId.has(id)),
  ];

  const lines: IntakeAnswerLine[] = [];
  for (const id of ordered) {
    if (!(id in responses)) continue;
    const question = byId.get(id);
    // Trimmed: people type trailing spaces into forms, and "Budy shape " is
    // not a different answer from "Budy shape" — it just renders as one.
    const answer = answerText(question, (responses as Record<string, unknown>)[id], language).trim();
    if (!answer) continue;
    lines.push({ question: question?.label ?? id, answer });
  }

  return lines;
}

/** The same lines as one string, for a surface that renders plain text. */
export function formatIntakeSubmission(
  submission: unknown,
  language: Language = 'en'
): string {
  return intakeAnswerLines(submission, language)
    .map((l) => `${l.question}: ${l.answer}`)
    .join(' · ');
}
