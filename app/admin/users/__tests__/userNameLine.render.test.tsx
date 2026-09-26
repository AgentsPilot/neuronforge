/**
 * @jest-environment jsdom
 */

/**
 * The person part of a Businesses row (admin reorganisation slice 4, U-3,
 * SA C-16): red "No name" with an accessible "needs attention", the
 * Active/Inactive badge beside the name, the verified tick beside the email.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { UserNameLine, activeBadgeClass } from '../components/UserNameLine';
import { ACTIVE_BADGE_MODE, countLabels, hasPersonName, toStatusFilter } from '../userName';

const GREEN = /\b(?:bg|text|border)-(?:green|emerald)-/;

function renderLine(props: Partial<React.ComponentProps<typeof UserNameLine>> = {}) {
  return render(
    <UserNameLine fullName="Dana Cohen" email="dana@example.com" emailConfirmed isActive {...props} />
  );
}

describe('hasPersonName', () => {
  it.each([[null], [undefined], [''], ['   '], ['\t\n']])('%j is no name', (value) => {
    expect(hasPersonName(value)).toBe(false);
  });
  it.each([['Dana'], [' Dana ']])('%j is a name', (value) => {
    expect(hasPersonName(value)).toBe(true);
  });
});

describe('a named row', () => {
  it('shows the name (row-user on the text only) and the status badge beside it', () => {
    renderLine();
    expect(screen.getByTestId('row-user').textContent).toBe('Dana Cohen');
    const nameLine = screen.getByTestId('row-name-line');
    expect(within(nameLine).getByTestId('row-activity').textContent).toBe('Active');
    expect(screen.queryByTestId('row-no-name')).toBeNull();
  });

  it('trims a padded name', () => {
    renderLine({ fullName: '  Dana  ' });
    expect(screen.getByTestId('row-user').textContent).toBe('Dana');
  });
});

describe.each([[null], [''], ['   ']])('a row with no name (%j)', (fullName) => {
  it('shows a visible red "No name" and announces "needs attention"', () => {
    renderLine({ fullName });
    const noName = screen.getByTestId('row-no-name');
    expect(noName.className).toMatch(/text-red-/);
    expect(screen.getByTestId('row-user').textContent).toBe('No name');
    // The accessible text is in the same container; the icon is hidden (C-16).
    expect(noName.textContent).toBe('No name — needs attention');
    expect(noName.querySelector('.sr-only')?.textContent).toBe(' — needs attention');
    expect(noName.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Not title-only, and not role="img" beside visible text.
    expect(noName.getAttribute('title')).toBeNull();
    expect(noName.querySelector('[role="img"]')).toBeNull();
  });

  it('the no-name mark itself carries no green', () => {
    renderLine({ fullName });
    expect(screen.getByTestId('row-no-name').outerHTML).not.toMatch(GREEN);
  });
});

describe('the email line', () => {
  it('carries the verified tick, with an accessible name, on every row', () => {
    renderLine({ fullName: null });
    const email = screen.getByTestId('row-email');
    expect(email.textContent).toContain('dana@example.com');
    const tick = within(email).getByTestId('row-email-verified');
    expect(tick.querySelector('.sr-only')?.textContent).toBe('Email verified');
    expect(tick.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // The name line never carries the tick.
    expect(within(screen.getByTestId('row-name-line')).queryByTestId('row-email-verified')).toBeNull();
  });

  it('shows no tick when the email is not verified', () => {
    renderLine({ emailConfirmed: false });
    expect(screen.queryByTestId('row-email-verified')).toBeNull();
  });
});

describe('the Active badge colour switch (U-7: neutral, never green)', () => {
  it('Inactive is never green', () => {
    for (const mode of ['green', 'neutral', 'neutral-on-no-name'] as const) {
      expect(activeBadgeClass(false, true, mode)).not.toMatch(GREEN);
      expect(activeBadgeClass(false, false, mode)).not.toMatch(GREEN);
    }
  });

  it("(c) 'green': Active is green on every row", () => {
    expect(activeBadgeClass(true, true, 'green')).toMatch(GREEN);
    expect(activeBadgeClass(true, false, 'green')).toMatch(GREEN);
  });

  it("(a) 'neutral': Active is never green", () => {
    expect(activeBadgeClass(true, true, 'neutral')).not.toMatch(GREEN);
    expect(activeBadgeClass(true, false, 'neutral')).not.toMatch(GREEN);
  });

  it("(b) 'neutral-on-no-name': green only where there is a name", () => {
    expect(activeBadgeClass(true, true, 'neutral-on-no-name')).toMatch(GREEN);
    expect(activeBadgeClass(true, false, 'neutral-on-no-name')).not.toMatch(GREEN);
  });

  it('the rendered badge follows the mode prop', () => {
    renderLine({ fullName: null, activeBadgeMode: 'neutral-on-no-name' });
    expect(screen.getByTestId('row-activity').className).not.toMatch(GREEN);
  });

  it("the active value is 'neutral' (U-7)", () => {
    expect(ACTIVE_BADGE_MODE).toBe('neutral');
  });

  it('with the default mode, the Active badge is not green on a named or a no-name row', () => {
    for (const fullName of ['Dana Cohen', null]) {
      const { unmount } = renderLine({ fullName });
      expect(screen.getByTestId('row-activity').textContent).toBe('Active');
      expect(screen.getByTestId('row-activity').className).not.toMatch(GREEN);
      unmount();
    }
  });

  it('the email-verified tick stays green (U-7), by the email, not the name', () => {
    renderLine({ fullName: null });
    const tick = screen.getByTestId('row-email-verified');
    expect(tick.innerHTML).toMatch(/text-green-/);
    expect(within(screen.getByTestId('row-name-line')).queryByTestId('row-email-verified')).toBeNull();
  });

  it('a no-name row: red "No name" beside a neutral badge, nothing green on the name line', () => {
    renderLine({ fullName: '  ' });
    expect(screen.getByTestId('row-no-name').className).toMatch(/text-red-/);
    expect(screen.getByTestId('row-name-line').innerHTML).not.toMatch(GREEN);
  });
});

describe('list labels', () => {
  it('toStatusFilter narrows without a cast; anything unknown is "all"', () => {
    expect(toStatusFilter('active')).toBe('active');
    expect(toStatusFilter('inactive')).toBe('inactive');
    expect(toStatusFilter('all')).toBe('all');
    expect(toStatusFilter('bogus')).toBe('all');
  });

  it('"total" only under All users; "shown" otherwise', () => {
    expect(countLabels('all')).toEqual({ card: 'All users', pill: 'total' });
    expect(countLabels('active')).toEqual({ card: 'Users shown (active)', pill: 'shown' });
    expect(countLabels('inactive')).toEqual({ card: 'Users shown (inactive)', pill: 'shown' });
  });
});
