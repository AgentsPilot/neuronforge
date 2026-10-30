/**
 * @jest-environment jsdom
 *
 * The control cannot be used to say something its range refuses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPLACED, AND WHAT IT MUST NOT LOSE
 *
 * Two sets of chips, one per dialog, with no overlap: the mailbox wizard
 * offered five, fifteen or thirty minutes and hourly, the adopt dialog offered
 * daily through monthly. A list of chips cannot be set to a value nobody put on
 * it — that was its only safety property, and it was free.
 *
 * A number box has no such property. `win_back_quiet_clients` writes to people
 * who have not been in touch for a year, so the range is the whole guard, and
 * this suite is what holds the control to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT STILL HAS TO BE TYPEABLE
 *
 * Clamping on every keystroke sounds safer and makes the field unusable: typing
 * "10" into a field whose floor is 7 passes through "1", and clamping there
 * turns it into "7" before the zero arrives. So the committed value changes on
 * blur, and the half-typed text lives separately until then.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { IntervalPicker } from '../IntervalPicker';
import type { IntervalRange, ScheduleInterval } from '@/lib/business-os/schedule/interval';

const FORTNIGHTLY: IntervalRange = {
  min: { every: 14, unit: 'days' },
  max: { every: 30, unit: 'days' },
};

const MAILBOX: IntervalRange = {
  min: { every: 5, unit: 'minutes' },
  max: { every: 7, unit: 'days' },
};

/**
 * The mailbox's STOP range, which is a different question from its cadence.
 *
 * Twelve hours to ninety days: how far back to keep looking, where the cadence
 * above is how often to look. The first version of the round-trip test below
 * used the cadence range by mistake, so thirty days was already over its
 * ceiling and the conversion clamped — which looked like the bug it was written
 * to catch.
 */
const MAILBOX_STOP: IntervalRange = {
  min: { every: 12, unit: 'hours' },
  max: { every: 90, unit: 'days' },
};

const unitLabel = (unit: string, count: number) => (count === 1 ? unit.slice(0, -1) : unit);

function picker(
  value: ScheduleInterval,
  range: IntervalRange,
  onChange = jest.fn()
) {
  render(
    <IntervalPicker
      label="How often?"
      lead="Every"
      value={value}
      range={range}
      onChange={onChange}
      unitLabel={unitLabel as never}
    />
  );

  return { onChange, field: screen.getByRole('spinbutton') as HTMLInputElement };
}

/**
 * The unit segments, in the order they are drawn.
 *
 * No opening step any more: the control is three connected buttons, so every
 * answer is on screen. That removed the four jsdom stubs this file used to need
 * to make a portalled listbox openable — pointer capture, pointer release,
 * scroll-into-view and a resize observer — none of which were about the thing
 * being tested.
 */
const segments = () => screen.queryAllByRole('radio');

/** Press one unit, the way a person would. */
function choose(unit: string) {
  fireEvent.click(screen.getByRole('radio', { name: unit }));
}

describe('the range is a wall', () => {
  it('clamps a number below the floor, on commit', () => {
    const { onChange, field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.blur(field, { target: { value: '2' } });

    expect(onChange).toHaveBeenCalledWith({ every: 14, unit: 'days' });
  });

  it('clamps a number above the ceiling', () => {
    const { onChange, field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '400' } });
    fireEvent.blur(field, { target: { value: '400' } });

    expect(onChange).toHaveBeenCalledWith({ every: 30, unit: 'days' });
  });

  it('keeps a number between the ends exactly as typed', () => {
    /* THE POINT OF THE CHANGE. Twenty days was on neither dialog's list of
       chips and is well inside the same walls. */
    const { onChange, field } = picker({ every: 14, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.blur(field, { target: { value: '20' } });

    expect(onChange).toHaveBeenCalledWith({ every: 20, unit: 'days' });
  });

  it('says what the limits are, because the spinner cannot', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────────
     * REPORTED FROM THE AGENTS LIST: "I tried to use the arrow to reduce it from
     * 5 to 1 and I couldn't, until I selected days."
     *
     * Nothing was broken. `min` stops the spinner at the floor and five minutes
     * IS the floor — the scheduler's own cron fires every five, so anything
     * faster is a promise the platform cannot keep. What was missing was any
     * way to find that out: the arrow simply did nothing, and the only clue was
     * that switching to days made it move again.
     *
     * Quoted in the CURRENT unit, because the bounds change with it.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const { field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(field.title).toContain('14');
    expect(field.title).toContain('30');
    expect(field.title).toContain('days');
  });

  it('requotes the limits when the unit changes', () => {
    /* 14-30 days is 336-720 hours, and quoting the day figures on an hours
       field would explain nothing. */
    picker({ every: 400, unit: 'hours' }, FORTNIGHTLY);

    const field = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(field.title).toContain('336');
    expect(field.title).toContain('720');
    expect(field.title).toContain('hours');
  });

  it('carries the range into the input own bounds', () => {
    /* So a spinner, a phone keypad and an assistive tool all know the limits
       without having to discover them by being clamped. */
    const { field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(field.min).toBe('14');
    expect(field.max).toBe('30');
  });
});

describe('typing is not fought mid-number', () => {
  it('does not commit on every keystroke', () => {
    /*
     * "1" on the way to "10" is below a floor of 14. Committing there would
     * clamp it to 14 and the owner would be typing into a field that keeps
     * answering back.
     */
    const { onChange, field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '1' } });

    expect(onChange).not.toHaveBeenCalled();
    /* And the field shows what was typed, not the committed value. */
    expect(field.value).toBe('1');
  });

  it('commits on Enter, so a value is never left uncommitted', () => {
    /* Somebody types and then presses the dialog's own button. Without this the
       number they can see is not the number that is sent. */
    const { onChange, field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ every: 25, unit: 'days' });
  });

  it('puts the committed value back when the field is emptied', () => {
    const { onChange, field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ every: 20, unit: 'days' });
  });
});

describe('the units on offer follow the range', () => {
  it('states the unit as a pill when only one fits, rather than as bare text', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────────
     * A range this wide in days leaves days as the only readable unit — a count
     * of hours in the thousands is not something anybody says.
     *
     * It used to render as plain words, on the reasoning that a one-segment
     * control cannot be operated and reads as broken. Wrong about which thing
     * reads as broken: on a list where another agent showed a pill group, the
     * bare word read as "this agent is missing its control". So the shape stays
     * and only the interaction goes.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const WIDE_DAYS: IntervalRange = {
      min: { every: 500, unit: 'days' },
      max: { every: 700, unit: 'days' },
    };

    picker({ every: 600, unit: 'days' }, WIDE_DAYS);

    /* Nothing to choose, so nothing announced as choosable. */
    expect(segments()).toHaveLength(0);
    /* But the word is still in the track, styled as the chosen segment. */
    expect(screen.getByText('days')).toBeTruthy();
  });

  it('offers all three to a mailbox range', () => {
    picker({ every: 15, unit: 'minutes' }, MAILBOX);

    /* Visible without a press, which is the point of the connected control. */
    expect(segments().map(o => o.textContent)).toEqual(['minutes', 'hours', 'days']);
  });

  it('marks exactly one as chosen', () => {
    picker({ every: 15, unit: 'minutes' }, MAILBOX);

    const checked = segments().filter(o => o.getAttribute('aria-checked') === 'true');

    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe('minutes');
  });

  it('converts rather than resets when the unit changes', () => {
    /*
     * An owner switching days to hours is reaching for a finer grain AROUND the
     * answer they have. Starting them at one hour is a cadence nobody chose —
     * and on a mailbox that is twenty-four times more often.
     */
    const { onChange } = picker({ every: 1, unit: 'days' }, MAILBOX);

    choose('hours');

    expect(onChange).toHaveBeenCalledWith({ every: 24, unit: 'hours' });
  });

  it('clamps the conversion too', () => {
    /* Seven days is the mailbox ceiling; in hours that is 168, and a conversion
       that overshot would land outside the range it just came from. */
    const { onChange } = picker({ every: 7, unit: 'days' }, MAILBOX);

    choose('hours');

    expect(onChange.mock.calls[0][0]).toEqual({ every: 168, unit: 'hours' });
  });
});

describe('the fields are the size of what they hold', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A CLASS CANNOT DO THIS, AND THAT IS THE POINT OF THE TEST.
   *
   * `Input` and `SelectTrigger` both carry `w-full`, and this project's `cn` is
   * a plain join rather than tailwind-merge — so a `w-20` passed alongside does
   * not replace it. Both classes survive and the stylesheet's order decides,
   * which `w-full` wins.
   *
   * The visible result was a two-digit number in a field the width of its
   * column, pushing the lead word and the unit onto lines of their own: three
   * lines for a question that is one sentence.
   *
   * Pinned as a STYLE because only a style attribute is certain to beat the
   * class, and because the next person to tidy this into a utility class would
   * reintroduce the bug with nothing failing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('gives the number a field sized for a number', () => {
    const { field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(field.style.width).toBeTruthy();
    expect(field.style.width).not.toBe('100%');
  });

  it('gives the units no more room than their words', () => {
    /* Buttons sized by their labels, where a dropdown had to reserve the width
       of the longest one whether it was showing it or not. */
    picker({ every: 15, unit: 'minutes' }, MAILBOX);

    for (const segment of segments()) {
      expect(segment.style.width).toBe('');
    }
  });

  it('rounds the field the way the services form rounds its fields', () => {
    /*
     * `Input` sets `rounded-md` — six pixels — by class, and this project's
     * `cn` is a plain join, so a class passed alongside does not replace it.
     * Six pixels beside a pill track is two form languages on one line, and
     * the only override certain to apply is a style.
     */
    const { field } = picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(field.style.borderRadius).toBe('var(--v2-radius-button)');
  });
});

describe('the chosen unit survives being handed back', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUG THIS EXISTS FOR, FOUND ON A LIVE MAILBOX CHANNEL.
   *
   * The agents list held its stop rule as a NUMBER of days and rebuilt the
   * control's value as `{ every: stored, unit: 'days' }` every render. So
   * pressing "hours" on thirty days did convert — to 720 — and the 720 came
   * back as 720 DAYS, which clamped to the ceiling with the unit never moving.
   *
   * The chip looked broken. Nothing about it was: the control reported the
   * right answer and the caller threw half of it away.
   *
   * A picker is only usable by a caller that stores BOTH halves, so this is
   * written as the round trip rather than as a single press.
   * ───────────────────────────────────────────────────────────────────────────
   */
  function Harness({ start }: { start: ScheduleInterval }) {
    const [value, setValue] = useState(start);

    return (
      <IntervalPicker
        label="Stops after"
        lead="Stops after"
        value={value}
        range={MAILBOX_STOP}
        onChange={setValue}
        unitLabel={unitLabel as never}
        inline
      />
    );
  }

  it('shows hours as chosen after pressing hours', () => {
    render(<Harness start={{ every: 30, unit: 'days' }} />);

    choose('hours');

    const checked = screen
      .getAllByRole('radio')
      .filter(o => o.getAttribute('aria-checked') === 'true');

    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe('hours');
  });

  it('does not re-read the converted number in the old unit', () => {
    /*
     * Thirty days is 720 hours, and 720 DAYS is past the ceiling. The failure
     * was visible as exactly that: the number jumped to 720 and the unit stayed
     * on days.
     */
    render(<Harness start={{ every: 30, unit: 'days' }} />);

    choose('hours');

    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('720');
    expect(screen.getByRole('radio', { name: 'days' }).getAttribute('aria-checked')).toBe('false');
  });

  it('can be put back, so the press is not one-way', () => {
    render(<Harness start={{ every: 30, unit: 'days' }} />);

    choose('hours');
    choose('days');

    expect(screen.getByRole('radio', { name: 'days' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('30');
  });
});

describe('inline, for the editor inside the agents table', () => {
  function inlinePicker(value: ScheduleInterval, range: IntervalRange) {
    render(
      <IntervalPicker
        label="Stops after"
        lead="Stops after"
        value={value}
        range={range}
        onChange={jest.fn()}
        unitLabel={unitLabel as never}
        inline
      />
    );
  }

  it('prints the question once, not twice', () => {
    /*
     * The label AND the lead both rendering gave "Stops after · Stops after ·
     * 30 · days" — the same question twice, and enough width to push a one-row
     * editor onto a second line inside a table row.
     */
    inlinePicker({ every: 30, unit: 'days' }, FORTNIGHTLY);

    expect(screen.getAllByText('Stops after')).toHaveLength(1);
  });

  it('still announces the question to a screen reader', () => {
    /* Only the duplicate INK goes. The group and both controls keep the name,
       or an inline picker would be an unlabelled number box. */
    inlinePicker({ every: 30, unit: 'days' }, FORTNIGHTLY);

    expect(screen.getByRole('group', { name: 'Stops after' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Stops after' })).toBeTruthy();
  });

  it('keeps the label visible when it is not inline', () => {
    render(
      <IntervalPicker
        label="Stops after"
        lead="After"
        value={{ every: 30, unit: 'days' }}
        range={FORTNIGHTLY}
        onChange={jest.fn()}
        unitLabel={unitLabel as never}
      />
    );

    /* Stacked, the label is the question being asked and wants its own line. */
    expect(screen.getByText('Stops after')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
  });
});

describe('it can be read and operated', () => {
  it('labels the question for a screen reader', () => {
    picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(screen.getByRole('spinbutton', { name: 'How often?' })).toBeTruthy();
  });

  it('shows the lead word, so the control reads as a sentence', () => {
    picker({ every: 20, unit: 'days' }, FORTNIGHTLY);

    expect(screen.getByText('Every')).toBeTruthy();
  });

  it('agrees the unit with its number', () => {
    /* "1 days" is wrong in English and the Hebrew equivalent is worse: the
       plural is not the singular with a letter added. */
    picker({ every: 1, unit: 'days' }, { min: { every: 1, unit: 'days' }, max: { every: 9, unit: 'days' } });

    expect(screen.getByText('day')).toBeTruthy();
  });

  it('names the grain on the segments and agrees in the sentence', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * These are two jobs and Radix gives one string to do both: the trigger
     * echoes the selected item's own label unless told otherwise.
     *
     * With the count at 1 that put the whole list in the singular, so the
     * option an owner pressed to get 24 HOURS was labelled "hour". Caught by
     * the conversion test failing to find it.
     *
     * So the trigger agrees with its number and the list names the grain.
     * ─────────────────────────────────────────────────────────────────────────
     */
    picker({ every: 1, unit: 'days' }, MAILBOX);

    /*
     * The control is read as a sentence, and the chosen segment is its last
     * word: "every 1 day". The other two are categories on offer, not part of
     * any sentence, so they stay plural.
     *
     * Both halves asserted together, because fixing either one alone is what
     * produced each of the two previous bugs: all-singular made the button for
     * 24 hours read "hour", and all-plural made the sentence "every 1 days".
     */
    expect(segments().map(o => o.textContent)).toEqual(['minutes', 'hours', 'day']);
  });

  it('keeps the unchosen ones plural when the number is not one', () => {
    picker({ every: 15, unit: 'minutes' }, MAILBOX);

    expect(segments().map(o => o.textContent)).toEqual(['minutes', 'hours', 'days']);
  });
});
