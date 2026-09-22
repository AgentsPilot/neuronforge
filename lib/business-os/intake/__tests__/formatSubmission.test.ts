/**
 * Reading back what a client wrote.
 *
 * The shapes here are the real one: `{ form_id, version, questions, responses }`,
 * answers keyed by question id, questions carried alongside them so the
 * submission stays readable after the form is edited. Taken from an actual row
 * rather than invented, because the thing most likely to go wrong is a shape
 * assumption, and an invented fixture would agree with whatever this file
 * happened to assume.
 */

import { intakeAnswerLines, formatIntakeSubmission } from '../formatSubmission';

const submission = {
  form_id: '07a294e8-a0e6-40ef-96ef-3b903ab2ebb5',
  version: 1,
  questions: [
    {
      id: '6b3dc176-0d64-4cd2-ac52-d026f6298ead',
      label: 'What are your main fitness goals?',
      type: 'long_text',
      required: true,
    },
    {
      id: 'ba5bbf25-665d-41b6-8cfc-0e1cdf82bd4a',
      label: 'Do you have any injuries or medical conditions we should be aware of?',
      type: 'yes_no',
      required: false,
    },
    {
      id: '6cf7f653-c8a5-4541-8578-8093cae671fb',
      label: 'If yes, please provide details.',
      type: 'long_text',
      required: false,
    },
    {
      id: '931b1369-9f9c-4796-8e17-d4764fff6aeb',
      label: 'Where would you like to train?',
      type: 'single_choice',
      required: false,
      options: [
        { id: 'gym', label: 'Gym' },
        { id: 'home', label: 'At home' },
      ],
    },
  ],
  responses: {
    '6b3dc176-0d64-4cd2-ac52-d026f6298ead': 'Budy shape ',
    'ba5bbf25-665d-41b6-8cfc-0e1cdf82bd4a': false,
    '6cf7f653-c8a5-4541-8578-8093cae671fb': '',
    '931b1369-9f9c-4796-8e17-d4764fff6aeb': 'gym',
  },
};

describe('reading a completed intake form', () => {
  it('pairs each answer with the question that was asked', () => {
    const lines = intakeAnswerLines(submission);

    expect(lines[0]).toEqual({
      question: 'What are your main fitness goals?',
      answer: 'Budy shape',
    });
  });

  it('writes a boolean as a word, in the reader\'s language', () => {
    expect(intakeAnswerLines(submission, 'en')).toContainEqual(
      expect.objectContaining({ answer: 'No' })
    );
    expect(intakeAnswerLines(submission, 'he')).toContainEqual(
      expect.objectContaining({ answer: 'לא' })
    );
  });

  it('shows a chosen option by its label, not the value stored', () => {
    expect(intakeAnswerLines(submission)).toContainEqual(
      expect.objectContaining({ question: 'Where would you like to train?', answer: 'Gym' })
    );
  });

  /*
   * A form is mostly optional questions. Printing the blanks buries the two
   * things the client actually wrote.
   */
  it('drops questions that were left empty', () => {
    const questions = intakeAnswerLines(submission).map((l) => l.question);
    expect(questions).not.toContain('If yes, please provide details.');
  });

  it('keeps the order the form asked in', () => {
    expect(intakeAnswerLines(submission).map((l) => l.question)).toEqual([
      'What are your main fitness goals?',
      'Do you have any injuries or medical conditions we should be aware of?',
      'Where would you like to train?',
    ]);
  });

  /*
   * Should not happen — the snapshot is written at submission time — but an
   * answer with no question is still something the client said, and dropping it
   * silently is the worse of the two failures.
   */
  it('still shows an answer whose question is missing from the snapshot', () => {
    const orphaned = { ...submission, questions: [], responses: { 'q-1': 'kept' } };
    expect(intakeAnswerLines(orphaned)).toEqual([{ question: 'q-1', answer: 'kept' }]);
  });

  it('returns nothing for a booking with no form', () => {
    expect(intakeAnswerLines(null)).toEqual([]);
    expect(intakeAnswerLines({})).toEqual([]);
    expect(formatIntakeSubmission(undefined)).toBe('');
  });

  it('joins multi-choice answers', () => {
    const multi = {
      questions: [
        {
          id: 'q',
          label: 'Which days?',
          type: 'multi_choice',
          required: false,
          options: [
            { id: 'mon', label: 'Monday' },
            { id: 'wed', label: 'Wednesday' },
          ],
        },
      ],
      responses: { q: ['mon', 'wed'] },
    };
    expect(formatIntakeSubmission(multi)).toBe('Which days?: Monday, Wednesday');
  });
});
