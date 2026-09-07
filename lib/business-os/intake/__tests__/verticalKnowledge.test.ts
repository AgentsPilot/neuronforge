/**
 * The questions a booking tool must never ask.
 *
 * The prompt already tells the model to stay out of these subjects. This filter
 * exists because "we asked it not to" and "it cannot" are different guarantees,
 * and the cost of relying on the first is a clinical detail collected by a
 * booking tool — in the wrong system, under the wrong protections, with the
 * wrong retention.
 *
 * So these tests exercise the FILTER, with no model involved. If they pass, the
 * platform cannot ask a therapist's client about their medication however
 * persuasive the business description is.
 */

import {
  intakeKnowledgeFor,
  isRestrictedVertical,
  stripForbiddenQuestions,
} from '../verticalKnowledge';
import type { IntakeQuestion } from '../types';

const question = (over: Partial<IntakeQuestion> = {}): IntakeQuestion => ({
  id: over.id ?? 'q1',
  label: 'Where will the session take place?',
  type: 'short_text',
  required: false,
  ...over,
});

describe('intakeKnowledgeFor', () => {
  it('falls back rather than returning nothing for an unknown trade', () => {
    // Twenty-eight verticals, ten entries. The rest must still generate.
    const knowledge = intakeKnowledgeFor('underwater_basket_weaving');
    expect(knowledge.concepts.length).toBeGreaterThan(0);
    expect(knowledge.neverAsk).toEqual([]);
  });

  it('resolves aliases onto one entry rather than duplicating them', () => {
    // Near-duplicate entries drift apart the first time one is edited.
    expect(intakeKnowledgeFor('psychologist')).toBe(intakeKnowledgeFor('therapist'));
    expect(intakeKnowledgeFor('teacher')).toBe(intakeKnowledgeFor('tutor'));
  });

  it('is case and whitespace insensitive, because the column is free text', () => {
    expect(intakeKnowledgeFor('  Therapist ')).toBe(intakeKnowledgeFor('therapist'));
  });

  it('marks the regulated trades as restricted and the rest as not', () => {
    expect(isRestrictedVertical('therapist')).toBe(true);
    expect(isRestrictedVertical('doctor')).toBe(true);
    expect(isRestrictedVertical('photographer')).toBe(false);
    expect(isRestrictedVertical(null)).toBe(false);
  });
});

describe('stripForbiddenQuestions', () => {
  it('leaves an unrestricted trade completely alone', () => {
    const questions = [question(), question({ id: 'q2', label: 'How many people?' })];
    const { kept, removed } = stripForbiddenQuestions(questions, 'photographer');

    expect(kept).toEqual(questions);
    expect(removed).toHaveLength(0);
  });

  /*
   * The case this exists for. Every one of these is a plausible thing a model
   * would write for a therapist, and every one of them creates a health record.
   */
  it.each([
    'Please list any medications you are currently taking',
    'What is your diagnosis?',
    'Describe your symptoms',
    'Do you have any mental health history we should know about?',
    'Have you experienced trauma related to this?',
  ])('removes a clinical question: %s', label => {
    const { kept, removed } = stripForbiddenQuestions(
      [question({ label }), question({ id: 'ok', label: 'How would you prefer we contact you?' })],
      'therapist'
    );

    expect(removed.map(q => q.label)).toContain(label);
    expect(kept.map(q => q.label)).toEqual(['How would you prefer we contact you?']);
  });

  it('catches the subject in Hebrew too', () => {
    // The form is written in the business's language, so an English-only filter
    // would protect exactly the businesses that do not need protecting.
    const { removed } = stripForbiddenQuestions(
      [question({ label: 'אילו תרופות אתם נוטלים?' })],
      'therapist'
    );

    expect(removed).toHaveLength(1);
  });

  it('reads the help text and the options, not only the label', () => {
    // A neutral label with the forbidden subject hidden in its answers is the
    // shape that would slip past a label-only check.
    const { removed } = stripForbiddenQuestions(
      [
        question({ label: 'Anything to share?', help: 'For example, your diagnosis' }),
        question({
          id: 'q2',
          label: 'Which applies?',
          type: 'single_choice',
          options: [
            { id: 'a', label: 'None' },
            { id: 'b', label: 'Currently taking medication' },
          ],
        }),
      ],
      'therapist'
    );

    expect(removed).toHaveLength(2);
  });

  it('lets a therapist be asked the administrative questions they need', () => {
    // The rule is "not the clinical record", not "nothing at all". A filter that
    // took these too would leave the trade with no usable intake.
    const allowed = [
      question({ id: 'a', label: 'Have you completed the paperwork we sent you?', type: 'yes_no' }),
      question({ id: 'b', label: 'Will this be in person or online?', type: 'single_choice' }),
      question({ id: 'c', label: 'How would you prefer we contact you?' }),
    ];

    const { kept, removed } = stripForbiddenQuestions(allowed, 'therapist');
    expect(kept).toHaveLength(3);
    expect(removed).toHaveLength(0);
  });

  /*
   * A question revealed by one that was just removed can never be shown — its
   * parent's answer no longer exists. Leaving it would put a permanently
   * invisible question in front of the owner to wonder about.
   */
  it('drops a question conditional on one it removed', () => {
    const { kept, removed } = stripForbiddenQuestions(
      [
        question({ id: 'parent', label: 'Are you taking any medication?', type: 'yes_no' }),
        question({ id: 'child', label: 'Which one?', showIf: { questionId: 'parent', equals: true } }),
        question({ id: 'safe', label: 'Anything else we should know?' }),
      ],
      'therapist'
    );

    expect(kept.map(q => q.id)).toEqual(['safe']);
    expect(removed.map(q => q.id).sort()).toEqual(['child', 'parent']);
  });

  it('keeps a condition whose parent survived', () => {
    const { kept } = stripForbiddenQuestions(
      [
        question({ id: 'parent', label: 'Is this your first session with us?', type: 'yes_no' }),
        question({ id: 'child', label: 'How did you hear about us?', showIf: { questionId: 'parent', equals: true } }),
      ],
      'therapist'
    );

    expect(kept).toHaveLength(2);
  });
});
