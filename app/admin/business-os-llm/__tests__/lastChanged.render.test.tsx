/**
 * @jest-environment jsdom
 *
 * S2-T7, S2-T7b, S2-T7c — FR-14's three states, which are three different
 * facts and must never read as each other.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { LastChangedLine } from '../components/LastChangedLine';
import { formatInstant } from '../format';

const AT = '2026-09-21T10:14:08.000Z';

describe('S2-T7: the three states render differently', () => {
  it('an id we resolved shows the admin’s email and the time', () => {
    render(<LastChangedLine lastChangedBy={{ kind: 'admin', at: AT, email: 'a@b.com' }} />);
    expect(screen.getByTestId('last-changed')).toHaveTextContent(
      'Last changed by a@b.com at 2026-09-21 10:14 UTC'
    );
  });

  it('an id we could NOT resolve shows the raw id, visibly labelled — never "unknown"', () => {
    render(
      <LastChangedLine lastChangedBy={{ kind: 'unresolved', at: AT, userId: 'abc-123' }} />
    );
    const line = screen.getByTestId('last-changed');
    expect(line).toHaveTextContent('abc-123');
    expect(line).toHaveTextContent('matches no active admin account');
    expect(line).not.toHaveTextContent(/unknown|nobody/i);
  });

  it('a row with no actor says so — and is distinguishable from having no row at all', () => {
    const { container } = render(
      <LastChangedLine lastChangedBy={{ kind: 'not_recorded', at: AT }} />
    );
    expect(screen.getByTestId('last-changed')).toHaveTextContent(
      'Last changed at 2026-09-21 10:14 UTC — actor not recorded'
    );

    // "No row" renders NOTHING here; the card prints the FR-7 line instead.
    const noRow = render(<LastChangedLine lastChangedBy={{ kind: 'no_row' }} />);
    expect(noRow.container.textContent).toBe('');
    expect(container.textContent).not.toBe('');
  });
});

describe('S2-T7b: the "actor not recorded" copy promises nothing that is not there', () => {
  /*
   * All eight seeded rows carry `updated_by = null`, so this is the state
   * EVERY card renders on day one — and those rows predate the audit helpers,
   * so the trail holds nothing for them either. Sending the reader to an empty
   * drawer is worse than saying nothing.
   */
  it('does not point the reader at the audit trail', () => {
    render(<LastChangedLine lastChangedBy={{ kind: 'not_recorded', at: AT }} />);
    expect(screen.getByTestId('last-changed')).not.toHaveTextContent(/audit trail/i);
  });

  it('does not claim the change came from the command line', () => {
    // Once slice 3's unattributed-save fallback exists, a SCREEN save can land
    // in this state too. The copy may say a command-line change carries no
    // name; it may not say this change was one.
    const { container } = render(
      <LastChangedLine lastChangedBy={{ kind: 'not_recorded', at: AT }} />
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/A change made before this screen existed, or from the command line/);
    expect(text).not.toMatch(/was made (from|with) the command line/i);
    expect(text).not.toMatch(/break.?glass/i);
  });
});

describe('S2-T7c (QA DEF-6): a missing timestamp is never rendered as a date', () => {
  it('formatInstant refuses to turn null into the epoch', () => {
    expect(formatInstant(null)).toBeNull();
    expect(formatInstant(undefined)).toBeNull();
    // The bug this exists to stop: `new Date(null)` is 1970-01-01, which would
    // render as a confident, wrong fact.
    expect(new Date(null as unknown as number).toISOString()).toContain('1970');
  });

  it.each([
    ['admin', { kind: 'admin', at: null, email: 'a@b.com' }],
    ['unresolved', { kind: 'unresolved', at: null, userId: 'abc-123' }],
    ['not_recorded', { kind: 'not_recorded', at: null }],
  ] as const)('the %s state with no timestamp says so, and shows no 1970', (_name, state) => {
    render(<LastChangedLine lastChangedBy={state} />);
    const line = screen.getByTestId('last-changed');
    expect(line).toHaveTextContent('(time not recorded)');
    expect(line).not.toHaveTextContent(/1970|Invalid Date|null/);
  });
});
