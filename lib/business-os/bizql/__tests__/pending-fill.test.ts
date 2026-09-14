/**
 * Leaving a write in progress — the one judgment call in an otherwise
 * deterministic path.
 *
 * Everything else about a parked fill is mechanical: the next message is the
 * answer. The single decision is whether a message means "cancel", and it is
 * made against free text the user chose, so it is exactly where a careless
 * matcher destroys work.
 */

import { isCancelMessage } from '../mutate/PendingFillStore';
import { readConfirmationReply } from '../mutate/ConfirmationStore';
import { isGroundedIn } from '../mutate/MutateExecutor';

describe('leaving a write in progress', () => {
  describe('cancels', () => {
    it.each([
      'cancel',
      'Cancel',
      'cancel.',
      'stop',
      'nevermind',
      'never mind',
      'forget it',
      'ביטול',
      'בטל',
      'עצור',
      'cancelar',
      '  cancel  ',
    ])('%p ends the write', (message) => {
      expect(isCancelMessage(message)).toBe(true);
    });
  });

  describe('does NOT cancel — these are field values', () => {
    /*
     * THE REASON THIS MATCHER EXISTS.
     *
     * `readConfirmationReply` matches a PREFIX, which is correct for a yes/no
     * prompt where the whole message is the answer. Reused here it would read
     * the task title "לא לשכוח להתקשר" ("don't forget to call") as a refusal
     * and silently bin the task the user was in the middle of creating.
     *
     * A field value that begins with a negation is an ordinary thing to write.
     */
    it.each([
      ['לא לשכוח להתקשר לדויד', 'a Hebrew title starting with "no"'],
      ['לא הגיע לפגישה', 'a Hebrew title starting with "no"'],
      ["don't forget the invoice", 'an English title starting with a negation'],
      ['no show follow-up', 'an English title starting with "no"'],
      ['stop the subscription for Yael', 'a title that begins with a cancel word'],
      ['cancel the Tuesday booking', 'a title that begins with a cancel word'],
      ['לוודא שהוחזר הכסף', 'the reply from the original bug report'],
    ])('%p is kept as a value (%s)', (message) => {
      expect(isCancelMessage(message)).toBe(false);
    });

    it('is stricter than the confirmation reader it deliberately does not reuse', () => {
      const title = 'לא לשכוח להתקשר לדויד';

      // The confirmation reader would throw this title away...
      expect(readConfirmationReply(title)).toBe('cancel');
      // ...which is exactly why a fill does not use it.
      expect(isCancelMessage(title)).toBe(false);
    });
  });

  it('treats an empty or whitespace message as a value, not a cancel', () => {
    // Whitespace is not consent to discard work. It fails the required-field
    // check instead and the user is asked again.
    expect(isCancelMessage('   ')).toBe(false);
    expect(isCancelMessage('')).toBe(false);
  });
});

/**
 * Why the parked utterance accumulates.
 *
 * `executeMutate` refuses a required text value that is not traceable to what
 * the user said — the guard that stops a model inventing a task called "new
 * task". A supplied answer is, by definition, not in the ORIGINAL request. So
 * validating the finished write against the original alone would report the
 * field missing again and ask for it forever.
 *
 * The fix is one line in the route (`${utterance} ${value}`) and this is the
 * test that says why it cannot be removed.
 */
describe('grounding a value the user supplied a turn later', () => {
  const request = 'הוסף משימה לדויד המלך';
  const answer = 'לוודא שהוחזר הכסף';

  it('rejects the answer against the original request alone — the infinite loop', () => {
    expect(isGroundedIn(answer, request)).toBe(false);
  });

  it('accepts it against the accumulated request', () => {
    expect(isGroundedIn(answer, `${request} ${answer}`)).toBe(true);
  });

  it('still rejects a value invented from nothing', () => {
    // The guard has to keep working once the utterance grows, or accumulating
    // would quietly disable the protection it runs alongside.
    expect(isGroundedIn('משימה חדשה', `${request} ${answer}`)).toBe(false);
  });

  it('still rejects a value that is merely the whole request echoed back', () => {
    expect(isGroundedIn(`${request} ${answer}`, `${request} ${answer}`)).toBe(false);
  });
});
