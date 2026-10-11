/**
 * @jest-environment jsdom
 */

/**
 * The shared business picker (Admin Layout Standard C-6, L-1e; §5.5 parts 3
 * and 7; RC-6; F-56; F-70; SA workplan review M-1, M-2, M-4).
 *
 * Two pickers on one page, so the generated ids are proved distinct (F-70):
 * no admin page shows two yet, so this is the only proof (SA S-4). Asserts with
 * `toBeTruthy()` / `toBeNull()` because jest-dom is not configured here.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const loggerCalls: unknown[][] = [];
jest.mock('@/lib/logger/client', () => ({
  clientLogger: {
    child: () => ({
      info: (...args: unknown[]) => loggerCalls.push(args),
      warn: (...args: unknown[]) => loggerCalls.push(args),
      error: (...args: unknown[]) => loggerCalls.push(args),
      debug: (...args: unknown[]) => loggerCalls.push(args),
    }),
  },
}));

import {
  AdminBusinessPicker,
  BUSINESS_SEARCH_PATH,
  businessFilterChip,
} from '@/app/admin/components/layout/AdminBusinessPicker';
import { ADMIN_FIELD_CONTROL } from '@/app/admin/components/layout/AdminFilterBar';
import { formatShortId } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';

const ACME = '99999999-9999-4999-8999-999999999999';
const UNNAMED = '22222222-2222-4222-8222-222222222222';
const PASTED = '33333333-3333-4333-8333-333333333333';

interface BusinessRow {
  userId: string;
  companyName: string | null;
}

const BUSINESSES: BusinessRow[] = [
  { userId: ACME, companyName: 'Acme Dental' },
  { userId: UNNAMED, companyName: null },
];

type Reply =
  | { kind: 'list'; businesses?: BusinessRow[]; limit?: number }
  | { kind: 'status'; status: number; body: unknown }
  | { kind: 'html' }
  | { kind: 'reject' };

function okList(businesses: BusinessRow[] = BUSINESSES, limit = 50) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { businesses, limit, platformAccountIds: [] } }),
  };
}

/** A fetch stub that answers every business-list call with `reply`. */
function mockFetch(reply: Reply = { kind: 'list' }): jest.Mock {
  const fetchMock = jest.fn(async () => {
    if (reply.kind === 'reject') throw new Error('network down');
    if (reply.kind === 'html') {
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      };
    }
    if (reply.kind === 'status') return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
    return okList(reply.businesses, reply.limit);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const urls = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((call: unknown[]) => String(call[0]));

function Harness(props: { selected?: string; onSelect?: jest.Mock; onOther?: jest.Mock; describedBy?: string }) {
  return (
    <div>
      <AdminBusinessPicker
        selectedAccountId={props.selected ?? ''}
        onSelect={props.onSelect ?? jest.fn()}
        describedBy={props.describedBy}
      />
      <AdminBusinessPicker
        selectedAccountId=""
        onSelect={props.onOther ?? jest.fn()}
        label="Other business"
        placeholder="Find another business"
      />
    </div>
  );
}

const first = () => screen.getByLabelText('Business') as HTMLInputElement;
const second = () => screen.getByLabelText('Other business') as HTMLInputElement;

async function openFirst(fetchMock: jest.Mock): Promise<HTMLInputElement> {
  const input = first();
  fireEvent.focus(input);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return input;
}

beforeEach(() => {
  jest.clearAllMocks();
  loggerCalls.length = 0;
});

describe('no read until the picker is used (RC-6)', () => {
  it('makes no request on mount, even with a selected id; focus makes exactly one', async () => {
    const fetchMock = mockFetch();
    render(<Harness selected={ACME} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.focus(first());
    await screen.findByText('Acme Dental');
    expect(urls(fetchMock)).toEqual([BUSINESS_SEARCH_PATH]);
  });

  it('sends the x-correlation-id header when the platform can make one', async () => {
    const original = globalThis.crypto;
    const fakeCrypto = { randomUUID: () => 'corr-1' };
    Object.defineProperty(globalThis, 'crypto', { value: fakeCrypto, configurable: true });
    try {
      const fetchMock = mockFetch();
      render(<Harness />);
      await openFirst(fetchMock);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('GET');
      expect(init.headers).toEqual({ 'x-correlation-id': 'corr-1' });
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('ids, label and props (F-70, M-4)', () => {
  it('gives the two pickers distinct generated ids, each label resolving its own input', async () => {
    const fetchMock = mockFetch();
    render(<Harness describedBy="page-note" />);
    expect(first()).not.toBe(second());
    expect(first().id).not.toBe(second().id);
    expect(first().id).not.toContain('audit-business');

    fireEvent.focus(first());
    await screen.findByText('Acme Dental');
    fireEvent.focus(second());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('listbox')).toHaveLength(2));

    const [listA, listB] = screen.getAllByRole('listbox');
    expect(listA.id).not.toBe(listB.id);
    for (const [input, list] of [[first(), listA], [second(), listB]] as const) {
      const controlled = document.getElementById(input.getAttribute('aria-controls') ?? '');
      expect(controlled).toBe(list);
      // It belongs to its own picker: the same wrapper holds both.
      expect(input.closest('.relative')?.contains(controlled)).toBe(true);
    }
  });

  it('defaults the label to "Business" and the placeholder; takes a custom label and placeholder', () => {
    mockFetch();
    render(<Harness />);
    expect(first().getAttribute('placeholder')).toBe('Filter by business name…');
    expect(second().getAttribute('placeholder')).toBe('Find another business');
    expect(screen.getByText('Business').tagName).toBe('LABEL');
    expect(screen.getByText('Other business').tagName).toBe('LABEL');
  });

  it('the id prop overrides the input id only', async () => {
    const fetchMock = mockFetch();
    render(<AdminBusinessPicker selectedAccountId="" onSelect={jest.fn()} id="my-picker" describedBy="note-id" />);
    const input = screen.getByLabelText('Business');
    expect(input.id).toBe('my-picker');
    fireEvent.focus(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const listbox = await screen.findByRole('listbox');
    expect(listbox.id).not.toBe('my-picker');
    expect(listbox.id).not.toContain('my-picker');
    // L-4a: `hint` became `describedBy` (SA Q-5); the page-owned id is used as given.
    expect(input.getAttribute('aria-describedby')).toBe('note-id');
  });

  it('no aria-describedby by default', () => {
    mockFetch();
    render(<Harness />);
    expect(first().getAttribute('aria-describedby')).toBeNull();
  });

  it('puts the given describedBy id on its own input only, and renders no note itself', () => {
    mockFetch();
    const { container } = render(<Harness describedBy="page-note" />);
    expect(first().getAttribute('aria-describedby')).toBe('page-note');
    expect(second().getAttribute('aria-describedby')).toBeNull();
    // The page owns the described element (the filter bar's help line); the picker renders none.
    expect(container.querySelector('#page-note')).toBeNull();
    expect(screen.queryByTestId('business-picker-hint')).toBeNull();
  });

  it('keeps the combobox attributes and the listbox name', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = first();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('maxLength')).toBe('100');
    await openFirst(fetchMock);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Businesses' })).toBeTruthy();
  });
});

describe('styles', () => {
  it('carries every ADMIN_FIELD_CONTROL token except px-3, with the purple focus ring', () => {
    mockFetch();
    render(<Harness />);
    const classes = first().className.split(/\s+/);
    for (const token of ADMIN_FIELD_CONTROL.split(/\s+/).filter((t) => t && t !== 'px-3')) {
      expect({ token, present: classes.includes(token) }).toEqual({ token, present: true });
    }
    expect(classes).toContain('focus-visible:ring-purple-500');
    expect(classes).toContain('pl-8');
    expect(classes).not.toContain('px-3');
    expect(first().className).not.toMatch(/ring-blue|(?<![\w-])focus:ring/);
  });
});

describe('searching', () => {
  it('sends the typed text as the search term', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = await openFirst(fetchMock);
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() => expect(urls(fetchMock)).toContain(`${BUSINESS_SEARCH_PATH}?search=acme`));
  });

  it('says so when nothing matches', async () => {
    const fetchMock = mockFetch({ kind: 'list', businesses: [] });
    render(<Harness />);
    await openFirst(fetchMock);
    expect((await screen.findByTestId('business-picker-empty')).textContent).toBe('No business matches that name.');
  });

  it('admits the cap when the list comes back full', async () => {
    const fetchMock = mockFetch({ kind: 'list', limit: 2 });
    render(<Harness />);
    await openFirst(fetchMock);
    expect((await screen.findByTestId('business-picker-truncated')).textContent).toContain('First 2 matches only');
  });
});

describe('choosing', () => {
  it('passes the picked name, clears the box and closes the list', async () => {
    const onSelect = jest.fn();
    const fetchMock = mockFetch();
    render(<Harness onSelect={onSelect} />);
    const input = await openFirst(fetchMock);
    fireEvent.change(input, { target: { value: 'ac' } });
    fireEvent.click(await screen.findByText('Acme Dental'));
    expect(onSelect).toHaveBeenCalledWith(ACME, 'Acme Dental');
    expect(input.value).toBe('');
    expect(screen.queryByTestId('business-picker-options')).toBeNull();
  });

  it('passes null for an unnamed business', async () => {
    const onSelect = jest.fn();
    const fetchMock = mockFetch();
    render(<Harness onSelect={onSelect} />);
    await openFirst(fetchMock);
    fireEvent.click(await screen.findByText('Unnamed business'));
    expect(onSelect).toHaveBeenCalledWith(UNNAMED, null);
  });

  it('offers a pasted full id first and passes null for it; a partial id is not offered', async () => {
    const onSelect = jest.fn();
    const fetchMock = mockFetch({ kind: 'list', businesses: [] });
    render(<Harness onSelect={onSelect} />);
    const input = await openFirst(fetchMock);

    fireEvent.change(input, { target: { value: PASTED.slice(0, 20) } });
    await waitFor(() => expect(screen.queryByTestId('business-picker-empty')).toBeTruthy());
    expect(screen.queryByTestId('business-picker-pasted')).toBeNull();

    fireEvent.change(input, { target: { value: PASTED } });
    const pasted = await screen.findByTestId('business-picker-pasted');
    expect(pasted.textContent).toContain(formatShortId(PASTED));
    fireEvent.click(pasted);
    expect(onSelect).toHaveBeenCalledWith(PASTED, null);
  });

  it('marks every option tabIndex -1, so focus stays on the combobox (M-2)', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    await openFirst(fetchMock);
    await screen.findByText('Acme Dental');
    const options = screen.getAllByTestId('business-picker-option');
    expect(options).toHaveLength(2);
    for (const option of options) expect(option.getAttribute('tabindex')).toBe('-1');
  });
});

describe('keyboard (A-3, M-2)', () => {
  it('ArrowDown and ArrowUp wrap, Enter picks the highlighted option', async () => {
    const onSelect = jest.fn();
    const fetchMock = mockFetch();
    render(<Harness onSelect={onSelect} />);
    const input = await openFirst(fetchMock);
    await screen.findByText('Acme Dental');

    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 0 -> 1 (wraps)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 1 -> 0 (wraps)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0 -> 1
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(UNNAMED, null);
  });

  it('Enter picks nothing once Escape has closed the list; with the list open it still picks (QA-1)', async () => {
    const onSelect = jest.fn();
    const fetchMock = mockFetch();
    render(<Harness onSelect={onSelect} />);
    const input = await openFirst(fetchMock);
    await screen.findByText('Acme Dental');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('business-picker-options')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowDown' }); // reopens; highlight 0 -> 1
    await screen.findByTestId('business-picker-options');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('aria-activedescendant names the highlighted option inside its own listbox, and is absent when closed', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = first();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    await openFirst(fetchMock);
    await screen.findByText('Acme Dental');
    const listbox = within(input.closest('.relative') as HTMLElement).getByRole('listbox');

    const named = () => document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(named()?.textContent).toContain('Acme Dental');
    expect(listbox.contains(named())).toBe(true);
    expect(named()?.getAttribute('role')).toBe('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(named()?.textContent).toContain('Unnamed business');
    expect(listbox.contains(named())).toBe(true);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('omits aria-activedescendant when the highlighted option no longer exists', async () => {
    const fetchMock = mockFetch({ kind: 'list', businesses: [] });
    render(<Harness />);
    const input = await openFirst(fetchMock);
    // The pasted row is the only option; highlight it, then remove it by editing the text.
    fireEvent.change(input, { target: { value: PASTED } });
    await screen.findByTestId('business-picker-pasted');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.change(input, { target: { value: PASTED.slice(0, 30) } });
    await waitFor(() => expect(screen.queryByTestId('business-picker-pasted')).toBeNull());
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('aria-controls resolves only while the list is open', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = first();
    const controlled = () => document.getElementById(input.getAttribute('aria-controls') ?? '');
    expect(controlled()).toBeNull();
    await openFirst(fetchMock);
    expect(controlled()?.getAttribute('role')).toBe('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(controlled()).toBeNull();
  });

  it('Escape closes the list and focus stays in the field', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = first();
    act(() => input.focus());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId('business-picker-options')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('business-picker-options')).toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

describe('leaving the field (M-2)', () => {
  it('focus moving out of the picker (Tab) closes the list; moving inside it does not', async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    const input = await openFirst(fetchMock);
    const option = (await screen.findAllByTestId('business-picker-option'))[0];

    fireEvent.blur(input, { relatedTarget: option });
    expect(screen.queryByTestId('business-picker-options')).toBeTruthy();

    fireEvent.blur(input, { relatedTarget: second() });
    expect(screen.queryByTestId('business-picker-options')).toBeNull();
  });
});

describe('when the list cannot be read (§5.10)', () => {
  it('shows the route’s own refusal', async () => {
    const fetchMock = mockFetch({ kind: 'status', status: 403, body: { success: false, error: 'Forbidden' } });
    render(<Harness />);
    await openFirst(fetchMock);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Forbidden'));
    expect(loggerCalls).toEqual([]);
  });

  it('shows the fixed copy for an unreadable body, never a parser message', async () => {
    const fetchMock = mockFetch({ kind: 'html' });
    render(<Harness />);
    await openFirst(fetchMock);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Could not read the business list. Try again in a moment.'),
    );
    expect(screen.getByRole('alert').textContent).not.toContain('Unexpected token');
  });

  it('shows the network sentence for a rejected fetch and logs one line with no term and no name', async () => {
    const fetchMock = mockFetch({ kind: 'reject' });
    render(<Harness />);
    const input = await openFirst(fetchMock);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(ADMIN_NETWORK_ERROR));
    expect(loggerCalls).toHaveLength(1);

    fireEvent.change(input, { target: { value: 'acme dental' } });
    await waitFor(() => expect(urls(fetchMock)).toContain(`${BUSINESS_SEARCH_PATH}?search=acme+dental`));
    await waitFor(() => expect(loggerCalls).toHaveLength(2));
    expect(screen.getByRole('alert').textContent).toBe(ADMIN_NETWORK_ERROR);

    // One line per failed read, each `{ err }` and the fixed message only.
    for (const call of loggerCalls) {
      expect(Object.keys(call[0] as object)).toEqual(['err']);
      expect(call[1]).toBe('Business list for the business picker failed');
    }
    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain('acme');
    expect(logged).not.toContain('Acme Dental');
  });

  it('a superseded request shows no alert, and the next result is shown (SA M-1)', async () => {
    let call = 0;
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        const signal = init?.signal;
        // The body read rejects with an AbortError once the request is aborted,
        // as a browser does when a superseded fetch is cancelled.
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }),
        };
      }
      return okList([{ userId: ACME, companyName: 'Acme Dental' }]);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;

    render(<Harness />);
    const input = await openFirst(fetchMock);
    // Typing supersedes the first read: the effect's cleanup aborts it.
    fireEvent.change(input, { target: { value: 'acme' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('alert')).toBeNull();

    expect(await screen.findByText('Acme Dental')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('businessFilterChip (§5.5 part 7)', () => {
  it('names the business, keeps the full id on hover and says "Remove business"', () => {
    const onRemove = jest.fn();
    const chip = businessFilterChip({ accountId: ACME, name: 'Acme Dental', onRemove });
    expect(chip).toEqual({
      key: 'account',
      label: 'Business: Acme Dental',
      title: ACME,
      testId: 'business-filter-chip',
      removeLabel: 'Remove business',
      onRemove,
    });
  });

  it('falls back to the short id when there is no name', () => {
    expect(businessFilterChip({ accountId: ACME, name: null, onRemove: jest.fn() }).label).toBe(
      `Business: ${formatShortId(ACME)}`,
    );
    expect(businessFilterChip({ accountId: ACME, name: '  ', onRemove: jest.fn() }).label).toBe(
      `Business: ${formatShortId(ACME)}`,
    );
  });
});
