/**
 * @jest-environment jsdom
 *
 * A step shows its answer, or asks its question. Never both, never neither.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dialog renders every section open, always — service, client, date,
 * availability, time, notes, intake — in one scroll of 3,130 lines. The client
 * block alone is nearly five hundred of them, permanently expanded whether or
 * not anybody is choosing a client.
 *
 * Collapsing is the whole point, so the rule that matters is when a step may
 * collapse: only once it has something to say instead. A row reading "שירות ✓"
 * and nothing else tells the owner less than the picker it replaced, and that
 * is the failure this component is most likely to produce — a step marked done
 * before its summary is ready.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BookingStep } from '@/components/scheduling/BookingStep';

describe('an answered step', () => {
  it('shows the answer instead of the form', () => {
    render(
      <BookingStep index={1} label="שירות" state="done" summary="ייעוץ אישי · 60 דק׳ · ₪400">
        <div>the picker</div>
      </BookingStep>
    );

    expect(screen.getByText('ייעוץ אישי · 60 דק׳ · ₪400')).toBeInTheDocument();
    expect(screen.queryByText('the picker')).not.toBeInTheDocument();
  });

  it('keeps its label, so the summary is readable out of context', () => {
    render(<BookingStep index={1} label="שירות" state="done" summary="ייעוץ אישי" />);

    expect(screen.getByText('שירות')).toBeInTheDocument();
  });

  it('offers a way back in', async () => {
    const onEdit = jest.fn();

    render(
      <BookingStep
        index={1}
        label="שירות"
        state="done"
        summary="ייעוץ אישי"
        onEdit={onEdit}
        editLabel="שינוי"
      />
    );

    /* Named by the step it reopens, not just "שינוי": four of these run down
       the dialog and a screen reader would read four identical buttons. */
    await userEvent.click(screen.getByRole('button', { name: 'שינוי · שירות' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('and offers none when it cannot be reopened', () => {
    /* A settled booking's service is not up for changing. */
    render(<BookingStep index={1} label="שירות" state="done" summary="ייעוץ אישי" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('a step marked done with nothing to say', () => {
  it('stays open rather than collapsing to a bare tick', () => {
    /*
     * The failure this component is most likely to produce. A collapsed row
     * carrying only "שירות ✓" tells the owner less than the picker did, and
     * hides the control they still need.
     */
    render(
      <BookingStep index={1} label="שירות" state="done">
        <div>the picker</div>
      </BookingStep>
    );

    expect(screen.getByText('the picker')).toBeInTheDocument();
  });

  it('and an empty string counts as nothing to say', () => {
    render(
      <BookingStep index={1} label="שירות" state="done" summary="">
        <div>the picker</div>
      </BookingStep>
    );

    expect(screen.getByText('the picker')).toBeInTheDocument();
  });
});

describe('the open step', () => {
  it('asks its question and shows its body', () => {
    render(
      <BookingStep index={3} label="מתי" state="open">
        <div>the slot grid</div>
      </BookingStep>
    );

    expect(screen.getByText('מתי')).toBeInTheDocument();
    expect(screen.getByText('the slot grid')).toBeInTheDocument();
  });

  it('carries its number, so the sequence is legible', () => {
    render(
      <BookingStep index={3} label="מתי" state="open">
        <div>body</div>
      </BookingStep>
    );

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('can carry a note beside the heading', () => {
    /* Where the business's clock is named, so hours are never ambiguous. */
    render(
      <BookingStep index={3} label="מתי" state="open" note="אסיה/ירושלים">
        <div>body</div>
      </BookingStep>
    );

    expect(screen.getByText('אסיה/ירושלים')).toBeInTheDocument();
  });
});

describe('a step still to come', () => {
  it('names itself without showing its form', () => {
    render(
      <BookingStep index={4} label="פרטים" state="pending">
        <div>notes and intake</div>
      </BookingStep>
    );

    expect(screen.getByText('פרטים')).toBeInTheDocument();
    expect(screen.queryByText('notes and intake')).not.toBeInTheDocument();
  });

  it('and offers nothing to press', () => {
    render(<BookingStep index={4} label="פרטים" state="pending" onEdit={jest.fn()} editLabel="שינוי" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('only one body is ever rendered', () => {
  it('across all three states, for the same children', () => {
    /*
     * Two sections open at once is the thing being fixed. Asserted as a set so
     * a future state cannot quietly render a body as well.
     */
    const states = ['done', 'open', 'pending'] as const;

    const shown = states.filter(state => {
      const { unmount } = render(
        <BookingStep index={1} label="שירות" state={state} summary="ייעוץ אישי">
          <div>body</div>
        </BookingStep>
      );
      const visible = screen.queryByText('body') !== null;
      unmount();
      return visible;
    });

    expect(shown).toEqual(['open']);
  });
});
