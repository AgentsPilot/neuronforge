/**
 * The weekly note may not move a figure into a week that has not happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, ON A LIVE CARD
 *
 * The note read: "יש לך 29 שעות ריקות בשבוע הקרוב" — you have 29 empty hours in
 * the COMING week.
 *
 * The 29 is real and the noun is right: `OpsUtilizationLowDetector` divides
 * unfilled hours by the weeks measured, so it is empty hours in an average week
 * ACROSS THE LAST 28 DAYS. The model kept the number, kept the noun, and moved
 * the period — producing the one claim on the card that nothing had measured
 * and nobody could check. `countNouns` already stopped "29 clients"; it said
 * nothing about when.
 *
 * The same note also inherited a stale headline. The insight it cited was
 * written on 17 October, titled "29 פגישות ריקות" — empty MEETINGS — eleven
 * days before the title prompt started being handed the noun. The headline
 * travels to the narrator as "what it is", so a sentence written before the fix
 * can still put the wrong subject in front of the model today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Both are rules in a prompt, and the output is a non-deterministic LLM call
 * against a live account — there is nothing to assert on a return value. What
 * can be held is that the rules are still in the prompt, and that the words for
 * the count still carry their period. Both were removed once by tidying.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { COUNT_NOUN, COUNT_PERIOD, describeCount } from '../countNouns';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const REPOSITORY = 'lib/business-os/insight/repository/InsightRepository.ts';

describe('the narrator is told the period is already past', () => {
  it('forbids placing a figure in the future', () => {
    const source = read(REPOSITORY);

    expect(source).toMatch(/PERIOD THAT HAS ALREADY HAPPENED/);
    // The exact phrasings the model reached for, named so it cannot reach again.
    expect(source).toMatch(/coming week/);
    expect(source).toMatch(/next month/);
  });

  it('tells the narrator the count outranks the headline', () => {
    const source = read(REPOSITORY);

    expect(source).toMatch(/HEADLINE WRITTEN EARLIER/);
    /* The rule wraps across lines in the prompt, so whitespace is loose here. */
    expect(source).toMatch(/follow the\s+count and ignore the\s+headline/);
  });

  it('still hands the narrator the count with its noun', () => {
    // The rule this file was written beside. Removing it is how "29 empty
    // hours" became "29 clients" the first time.
    const source = read(REPOSITORY);

    expect(source).toMatch(/describeCount\(i\.affected_count, i\.affected_entity_type\)/);
  });
});

describe('the words for an unfilled calendar', () => {
  it('name the period the figure covers, and refuse a week ahead', () => {
    expect(COUNT_PERIOD.open_hour).toMatch(/last 28 days/);
    expect(COUNT_PERIOD.open_hour).toMatch(/ALREADY HAPPENED/);
    expect(COUNT_PERIOD.open_hour).toMatch(/Never write it as a forecast/);
  });

  it('still say hours, and still refuse clients and bookings', () => {
    const described = describeCount(29, 'open_hour');

    expect(described).toMatch(/^29 empty hours/);
    expect(described).toMatch(/NOT clients and NOT bookings/);
    expect(described).toMatch(/last 28 days/);
  });

  it('keeps the noun itself short, so it does not read twice in one breath', () => {
    /*
     * `describeCount` repeats the noun inside its own parenthesis. A period
     * clause folded into the noun appeared twice in one sentence, nested, and
     * was unreadable to anything that had to parse it — model included.
     */
    expect(COUNT_NOUN.open_hour).toBe('empty hours in their working week');
    expect(COUNT_NOUN.open_hour).not.toMatch(/28 days|forecast/);
  });

  it('says nothing about a period where the count has no ambiguous one', () => {
    // Unpaid invoices exist right now and read that way unaided.
    expect(describeCount(3, 'invoice')).toBe(
      '3 invoices (this number counts invoices, NOT clients and NOT bookings).'
    );
  });
});
