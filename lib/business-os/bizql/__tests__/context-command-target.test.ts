/**
 * Acting on the row the user is looking at.
 *
 * The remembered-rows block is written for QUESTIONS: it says the list exists
 * only to resolve a reference back — "it", "him", "that one" — and that a
 * message which does not refer back should be treated as new. That rule earned
 * its place; without it a list survived into later turns and got re-shown for
 * no reason.
 *
 * Read literally by a COMMAND it says the wrong thing. "set the priority to
 * urgent" and "סמן את המשימה כבוטלה" contain no pronoun, so they were treated
 * as fresh requests — and a fresh request with nothing to act on becomes a
 * `find`. The user, looking at the one task they had just asked about, got it
 * listed back at them instead of changed. "add a description: ..." was worse:
 * with no target the planner drifted toward a create, which requires a title,
 * so it wrote the description into the title as well.
 */

import { renderContextForPrompt } from '../memory/ConversationMemory';
import type { ConversationContext } from '../memory/ConversationMemory';

const at = '2026-09-07T10:00:00.000Z';

const withRows = (count: number): ConversationContext => ({
  turns: [{ utterance: 'show open tasks', summary: 'find tasks', at }],
  lastRows: {
    entity: 'tasks',
    items: Array.from({ length: count }, (_, i) => ({
      id: `1111111${i}-1111-1111-1111-111111111111`,
      label: `task ${i + 1}`,
    })),
    at,
  },
});

describe('a command with no pronoun, and one remembered row', () => {
  it('tells the planner to act on that row instead of searching', () => {
    const rendered = renderContextForPrompt(withRows(1));

    expect(rendered).toMatch(/command to change, update, mark, set, cancel or delete/i);
    expect(rendered).toMatch(/act on it by id rather than searching/i);
  });

  it('still keeps the guard against re-showing rows nobody asked for', () => {
    // The narrowing must not cost the rule it narrows. A question that does not
    // refer back still has to be treated as new.
    const rendered = renderContextForPrompt(withRows(1));

    expect(rendered).toMatch(/IGNORE this list completely and treat the request as new/);
  });
});

describe('when several rows are remembered', () => {
  it('does NOT claim a command refers to any one of them', () => {
    /*
     * With more than one row, "the task" is genuinely ambiguous and asking is
     * the right outcome — the target resolver already does that. Naming a row
     * here would be picking one on the user's behalf, which for a write is the
     * failure mode worth avoiding.
     */
    const rendered = renderContextForPrompt(withRows(3));

    expect(rendered).not.toMatch(/act on it by id rather than searching/i);
    expect(rendered).toMatch(/IGNORE this list completely and treat the request as new/);
  });
});

describe('with no remembered rows at all', () => {
  it('says nothing about acting on a row', () => {
    const rendered = renderContextForPrompt({
      turns: [{ utterance: 'show open tasks', summary: 'find tasks', at }],
    });

    expect(rendered).not.toMatch(/act on it by id/i);
  });
});
