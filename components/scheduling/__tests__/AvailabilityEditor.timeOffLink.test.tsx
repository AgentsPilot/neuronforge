/**
 * @jest-environment jsdom
 *
 * The way from the working-days row to the time-off section.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Time off saves its own rows, so it is a separate component rendered BELOW the
 * weekly hours rather than sharing this tab's Save button. That separation is
 * right and it put the feature below the fold: an owner setting their hours has
 * no reason to scroll past the thing they came for, so they never learned a
 * closure could be entered at all.
 *
 * The link is a discoverability affordance, which is exactly the kind of thing
 * that disappears in a refactor without anything failing — nothing throws when a
 * prop stops being passed. So what these pin is that it appears when there IS
 * somewhere to go, that it does NOT when there is not, and that pressing it
 * calls the handler rather than submitting the form around it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

const COPY: Record<string, string> = {
  'scheduling.availability.working_days': 'Working days:',
  'scheduling.availability.jump_to_timeoff': 'Closed on a particular date? Set time off',
  'scheduling.day.sunday': 'Sunday',
  'scheduling.day.monday': 'Monday',
  'scheduling.day.tuesday': 'Tuesday',
  'scheduling.day.wednesday': 'Wednesday',
  'scheduling.day.thursday': 'Thursday',
  'scheduling.day.friday': 'Friday',
  'scheduling.day.saturday': 'Saturday',
};

let mockIsRTL = false;

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    get isRTL() {
      return mockIsRTL;
    },
    language: mockIsRTL ? 'he' : 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

import { AvailabilityEditor, DEFAULT_AVAILABILITY } from '../AvailabilityEditor';

const LINK = 'Closed on a particular date? Set time off';

beforeEach(() => {
  mockIsRTL = false;
});

describe('the link to time off', () => {
  it('is offered in the working-days row, where the week is decided', () => {
    render(
      <AvailabilityEditor
        availability={DEFAULT_AVAILABILITY}
        onChange={jest.fn()}
        onJumpToTimeOff={jest.fn()}
      />
    );

    const link = screen.getByRole('button', { name: LINK });
    expect(link).toBeInTheDocument();

    /*
     * In the SAME row as the day chips, not stranded under them. The row is
     * what an owner is looking at when they think "…except the 14th"; a link
     * below the chips is just a second thing below the fold.
     */
    const days = screen.getByText('Working days:');
    expect(days.parentElement).toContainElement(link);
  });

  /*
   * No handler, no link. The editor does not know it has a sibling — it is used
   * in one place today, and a link rendered unconditionally would point at
   * nothing the moment it is used anywhere else.
   */
  it('is absent when there is nowhere to go', () => {
    render(<AvailabilityEditor availability={DEFAULT_AVAILABILITY} onChange={jest.fn()} />);

    expect(screen.queryByRole('button', { name: LINK })).not.toBeInTheDocument();
    // The row itself still renders, so this is the link missing, not the editor.
    expect(screen.getByText('Working days:')).toBeInTheDocument();
  });

  it('calls the handler when pressed, and changes no availability', () => {
    const onJumpToTimeOff = jest.fn();
    const onChange = jest.fn();

    render(
      <AvailabilityEditor
        availability={DEFAULT_AVAILABILITY}
        onChange={onChange}
        onJumpToTimeOff={onJumpToTimeOff}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: LINK }));

    expect(onJumpToTimeOff).toHaveBeenCalledTimes(1);
    // Pressing it must not toggle a day: it sits among seven buttons that do.
    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * `type="button"`, because this lives among day toggles inside a dialog that
   * has a Save button. A default-type button inside a form submits it, which
   * here would save the availability as a side effect of asking to look at
   * something else.
   */
  it('is a plain button, so it cannot submit the surrounding form', () => {
    render(
      <AvailabilityEditor
        availability={DEFAULT_AVAILABILITY}
        onChange={jest.fn()}
        onJumpToTimeOff={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: LINK })).toHaveAttribute('type', 'button');
  });

  /*
   * Positioned with a LOGICAL property. `ml-auto` pins to the physical left,
   * which in Hebrew is the start of the row — the link would land on top of the
   * "Working days:" label instead of at the far end. `ms-auto` follows the
   * direction.
   */
  it('positions itself with a logical margin, so Hebrew puts it at the right end', () => {
    render(
      <AvailabilityEditor
        availability={DEFAULT_AVAILABILITY}
        onChange={jest.fn()}
        onJumpToTimeOff={jest.fn()}
      />
    );

    const link = screen.getByRole('button', { name: LINK });
    expect(link.className).toContain('ms-auto');
    expect(link.className).not.toMatch(/\bml-auto\b/);
  });

  it('still appears in Hebrew', () => {
    mockIsRTL = true;

    render(
      <AvailabilityEditor
        availability={DEFAULT_AVAILABILITY}
        onChange={jest.fn()}
        onJumpToTimeOff={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: LINK })).toBeInTheDocument();
  });
});
