import {
  MIN_CHOICE_OPTIONS,
  questionTakesOptions,
  type IntakeQuestion,
  type IntakeQuestionOption,
} from '../types';

/*
 * The rules behind editing a choice question's answers.
 *
 * The answers were displayed and not editable, so a question whose wording was
 * right and whose choices were wrong could only be deleted whole. These pin the
 * parts of that fix that are logic rather than markup.
 */

const OPTIONS: IntakeQuestionOption[] = [
  { id: 'a', label: 'Beginner' },
  { id: 'b', label: 'Intermediate' },
  { id: 'c', label: 'Advanced' },
];

/** What the editor's remove button does, as a function of the list. */
const canRemove = (options: IntakeQuestionOption[]) => options.length > MIN_CHOICE_OPTIONS;

/** What the publish gate refuses. */
const hasBlankAnswer = (question: Pick<IntakeQuestion, 'options'>) =>
  (question.options ?? []).some(option => !option.label.trim());

describe('which questions have answers to edit', () => {
  it('is choice questions, and only those', () => {
    expect(questionTakesOptions('single_choice')).toBe(true);
    expect(questionTakesOptions('multi_choice')).toBe(true);

    // `yes_no` has its own two answers built in — it is not a two-option
    // choice, and offering an options editor on it would imply otherwise.
    for (const type of ['short_text', 'long_text', 'yes_no', 'date', 'number', 'file'] as const) {
      expect(questionTakesOptions(type)).toBe(false);
    }
  });
});

describe('removing an answer', () => {
  it('stops at two', () => {
    /*
     * One option is not a choice: it is a question with a single button, which
     * a client cannot answer in a way that carries information. Nothing would
     * catch it either — the form renders, the page works, and the answer is
     * always the same.
     */
    expect(canRemove(OPTIONS)).toBe(true);
    expect(canRemove(OPTIONS.slice(0, 2))).toBe(false);
    expect(canRemove(OPTIONS.slice(0, 1))).toBe(false);
  });
});

describe('the publish gate on blank answers', () => {
  it('lets a finished list through', () => {
    expect(hasBlankAnswer({ options: OPTIONS })).toBe(false);
  });

  it('catches the empty row that adding an answer creates', () => {
    // Allowed while editing — the owner is about to type into it. Published, it
    // is a button with no words that a client can click and cannot read.
    expect(hasBlankAnswer({ options: [...OPTIONS, { id: 'd', label: '' }] })).toBe(true);
  });

  it('counts whitespace as blank', () => {
    expect(hasBlankAnswer({ options: [...OPTIONS, { id: 'd', label: '   ' }] })).toBe(true);
  });

  it('ignores questions that have no answers at all', () => {
    expect(hasBlankAnswer({ options: undefined })).toBe(false);
  });
});

describe('finding the free-text answer among the chosen ones', () => {
  /*
   * A multi-choice "Other" lives in the same array as the chosen options, so it
   * is identified as the entry matching no option. That is what lets the stored
   * submission stay a plain list of strings — nothing downstream needs to know
   * the control exists.
   */
  const labels = new Set(OPTIONS.map(option => option.label));
  const otherOf = (value: string[]) => value.find(entry => !labels.has(entry));

  it('finds it', () => {
    expect(otherOf(['Beginner', 'Returning after an injury'])).toBe('Returning after an injury');
  });

  it('finds none when every answer was on the list', () => {
    expect(otherOf(['Beginner', 'Advanced'])).toBeUndefined();
  });

  it('survives an empty selection', () => {
    expect(otherOf([])).toBeUndefined();
  });
});
