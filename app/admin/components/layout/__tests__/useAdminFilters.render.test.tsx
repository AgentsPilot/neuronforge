/**
 * @jest-environment jsdom
 */

/**
 * The URL filter state hook (Admin Layout Standard C-7, U-1 to U-10, SA M-1).
 *
 * A harness renders the hook with a mocked `useSearchParams` over a mutable
 * string. Writes go through the real jsdom `history.replaceState` (spied), so
 * `window.location` follows them; `useSearchParams` does NOT follow them unless
 * a test sets `mockSearch` itself, which is how a test plays Next's echo or an
 * outside navigation.
 */

import React, { useEffect } from 'react';
import { act, render } from '@testing-library/react';

let mockSearch: string | null = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => (mockSearch === null ? null : new URLSearchParams(mockSearch)),
}));

import { textFilter, useAdminFilters, type AdminFilterSpec, type AdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { windowFilter, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

interface Filters {
  window: AdminWindowValue;
  account: string;
  severity: string;
  search: string;
}

const SPEC: AdminFilterSpec<Filters> = {
  window: windowFilter({ defaultValue: { kind: 'none' }, aliases: { date_from: 'from', date_to: 'to' } }),
  account: textFilter({ key: 'account', defaultValue: '', aliases: ['user_id'] }),
  severity: textFilter({ key: 'severity', defaultValue: 'all', isValid: (raw) => ['info', 'warning', 'critical'].includes(raw) }),
  search: textFilter({ key: 'search', defaultValue: '', pageOnly: true }),
};

let api: AdminFilters<Filters>;
let effectRuns = 0;

function Harness() {
  api = useAdminFilters(SPEC);
  const { filters } = api;
  useEffect(() => {
    effectRuns += 1;
  }, [filters]);
  return null;
}

const PATH = '/admin/x';
let replaceSpy: jest.SpyInstance;
let pushSpy: jest.SpyInstance;

/**
 * Sets the address bar and what `useSearchParams` answers, as on arrival. The
 * entry carries a state like Next's own (`__NA`), so a write that passed the
 * current state along instead of null would be caught.
 */
function arrive(query: string, hash = '') {
  window.history.replaceState({ __NA: true }, '', `${PATH}${query ? `?${query}` : ''}${hash}`);
  mockSearch = query;
}

beforeEach(() => {
  effectRuns = 0;
  arrive('');
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  pushSpy = jest.spyOn(window.history, 'pushState');
});

afterEach(() => {
  replaceSpy.mockRestore();
  pushSpy.mockRestore();
});

describe('reading and writing', () => {
  it('a clean URL gives the defaults and writes nothing (U-3)', () => {
    render(<Harness />);
    expect(api.filters).toEqual({ window: { kind: 'none' }, account: '', severity: 'all', search: '' });
    expect(api.isDefault).toBe(true);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('setFilters writes by replaceState with null as the state (SA M-1), never pushState, keeping tab and the hash', () => {
    arrive('tab=activity', '#top');
    replaceSpy.mockClear();
    const lengthBefore = window.history.length;
    render(<Harness />);
    expect(replaceSpy).not.toHaveBeenCalled();

    act(() => api.setFilters({ severity: 'critical', window: { kind: 'preset', preset: '7d' } }));

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0][0]).toBeNull();
    expect(replaceSpy.mock.calls[0][1]).toBe('');
    expect(replaceSpy.mock.calls[0][2]).toBe(`${PATH}?tab=activity&range=7d&severity=critical#top`);
    expect(window.location.search).toBe('?tab=activity&range=7d&severity=critical');
    expect(window.location.hash).toBe('#top');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);
  });

  it('reads the legacy names and rewrites them to the canonical ones on mount (U-9)', () => {
    arrive('user_id=abc&date_from=2026-09-25T10%3A30');
    replaceSpy.mockClear();
    render(<Harness />);
    expect(api.filters.account).toBe('abc');
    expect(api.filters.window).toEqual({ kind: 'linked', from: '2026-09-25T10:30', to: null });
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `${PATH}?range=custom&from=2026-09-25T10%3A30&account=abc`);
  });

  it('the canonical key wins when both it and its alias are present', () => {
    arrive('user_id=old&account=new&date_from=2026-09-01&from=2026-09-10');
    render(<Harness />);
    expect(api.filters.account).toBe('new');
    expect(api.filters.window).toEqual({ kind: 'custom', from: '2026-09-10', to: null });
    expect(window.location.search).toBe('?range=custom&from=2026-09-10&account=new');
  });

  it('a page-only field is read from a link, never written, and stripped from the address bar', () => {
    arrive('search=group-1&severity=info');
    render(<Harness />);
    expect(api.filters.search).toBe('group-1');
    expect(window.location.search).toBe('?severity=info');

    act(() => api.setFilters({ search: 'typed' }));
    expect(api.filters.search).toBe('typed');
    expect(window.location.search).toBe('?severity=info');
  });

  it('invalid values are ignored and stripped (U-4)', () => {
    arrive('severity=catastrophic&range=bogus&tab=x');
    render(<Harness />);
    expect(api.filters.severity).toBe('all');
    expect(api.filters.window).toEqual({ kind: 'none' });
    expect(window.location.search).toBe('?tab=x');
  });

  it('clear puts every field back to its default and keeps the unrelated key', () => {
    arrive('tab=x&severity=info&search=abc&range=30d');
    render(<Harness />);
    expect(api.isDefault).toBe(false);
    act(() => api.clear());
    expect(api.filters).toEqual({ window: { kind: 'none' }, account: '', severity: 'all', search: '' });
    expect(api.isDefault).toBe(true);
    expect(window.location.search).toBe('?tab=x');
  });

  it('outside the App Router (useSearchParams is null): defaults, and nothing is written', () => {
    window.history.replaceState(null, '', `${PATH}?severity=info`);
    mockSearch = null;
    replaceSpy.mockClear();
    render(<Harness />);
    expect(api.filters.severity).toBe('all');
    act(() => api.setFilters({ severity: 'critical' }));
    expect(api.filters.severity).toBe('critical');
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('identity (the F-28 mount pin depends on it)', () => {
  it('filters keep their identity across rerenders: the [filters] effect runs once', () => {
    arrive('user_id=abc&severity=info');
    const { rerender } = render(<Harness />);
    const first = api.filters;
    rerender(<Harness />);
    rerender(<Harness />);
    expect(api.filters).toBe(first);
    expect(effectRuns).toBe(1);
  });

  it('setFilters with equal values returns the same object and writes nothing', () => {
    arrive('severity=info&range=7d');
    render(<Harness />);
    const first = api.filters;
    replaceSpy.mockClear();
    act(() => api.setFilters({ severity: 'info', window: { kind: 'preset', preset: '7d' } }));
    expect(api.filters).toBe(first);
    expect(effectRuns).toBe(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('re-reading the URL (SA M-1: one last-known string)', () => {
  it('our own write echoed back by useSearchParams is not re-parsed', () => {
    const { rerender } = render(<Harness />);
    act(() => api.setFilters({ severity: 'info' }));
    const afterWrite = api.filters;
    const runs = effectRuns;

    // Next syncs useSearchParams to what the hook just wrote.
    mockSearch = 'severity=info';
    rerender(<Harness />);
    expect(api.filters).toBe(afterWrite);
    expect(effectRuns).toBe(runs);
  });

  it('jsdom never echoing (useSearchParams stuck on the arrival string) is not a change either', () => {
    arrive('severity=info');
    const { rerender } = render(<Harness />);
    act(() => api.setFilters({ severity: 'critical' }));
    rerender(<Harness />);
    expect(api.filters.severity).toBe('critical');
  });

  it('an outside change re-parses', () => {
    const { rerender } = render(<Harness />);
    act(() => api.setFilters({ severity: 'info' }));

    arrive('severity=warning&range=today');
    rerender(<Harness />);
    expect(api.filters.severity).toBe('warning');
    expect(api.filters.window).toEqual({ kind: 'preset', preset: 'today' });
  });

  it('Back after a reset returns to the earlier written view (re-parsed, not mistaken for an echo)', () => {
    const { rerender } = render(<Harness />);
    act(() => api.setFilters({ severity: 'info' }));
    mockSearch = 'severity=info'; // Next's echo of our write
    rerender(<Harness />);

    // The sidebar link to the clean page: an outside change.
    arrive('');
    rerender(<Harness />);
    expect(api.filters.severity).toBe('all');

    // Back: the string equals an earlier WRITTEN value, and must still be re-read.
    arrive('severity=info');
    rerender(<Harness />);
    expect(api.filters.severity).toBe('info');
  });

  it('an outside change re-parses every field, page-only included: search goes to its default', () => {
    arrive('search=group-1');
    const { rerender } = render(<Harness />);
    expect(api.filters.search).toBe('group-1');

    arrive('severity=info');
    rerender(<Harness />);
    expect(api.filters.search).toBe('');
    expect(api.filters.severity).toBe('info');
  });

  it('an outside change that changes nothing keeps the same object', () => {
    arrive('severity=info');
    const { rerender } = render(<Harness />);
    const first = api.filters;
    arrive('severity=info&tab=x');
    rerender(<Harness />);
    expect(api.filters).toBe(first);
    expect(effectRuns).toBe(1);
  });
});

describe('QA E-1 (L-1d): an outside change that parses to the current state still cleans the address bar', () => {
  it('junk from the defaults: the same object, no extra [filters] run, and the bar is cleaned by replaceState(null, ...)', () => {
    const { rerender } = render(<Harness />);
    const first = api.filters;

    arrive('severity=catastrophic&range=bogus');
    replaceSpy.mockClear();
    rerender(<Harness />);

    expect(api.filters).toBe(first);
    expect(effectRuns).toBe(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, '', PATH);
    expect(window.location.search).toBe('');
  });

  it('the alias of the applied account: the same object, and the bar goes back to the canonical name', () => {
    arrive('account=abc');
    const { rerender } = render(<Harness />);
    const first = api.filters;
    expect(first.account).toBe('abc');

    arrive('user_id=abc');
    replaceSpy.mockClear();
    rerender(<Harness />);

    expect(api.filters).toBe(first);
    expect(effectRuns).toBe(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?account=abc');
  });

  it('an outside change that DOES alter the state writes exactly once, not twice (SA M-3)', () => {
    const { rerender } = render(<Harness />);

    arrive('severity=warning&user_id=abc');
    replaceSpy.mockClear();
    rerender(<Harness />);

    expect(api.filters.severity).toBe('warning');
    expect(api.filters.account).toBe('abc');
    expect(effectRuns).toBe(2);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?account=abc&severity=warning');
  });

  it('mount: a clean URL writes nothing and runs the [filters] effect once; an alias is rewritten exactly once (SA M-3)', () => {
    replaceSpy.mockClear();
    const { unmount } = render(<Harness />);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(effectRuns).toBe(1);
    unmount();

    effectRuns = 0;
    arrive('user_id=abc');
    replaceSpy.mockClear();
    render(<Harness />);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(effectRuns).toBe(1);
  });

  it("Next's echo of our own write still causes no extra replaceState", () => {
    const { rerender } = render(<Harness />);
    act(() => api.setFilters({ severity: 'info' }));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const afterWrite = api.filters;

    mockSearch = 'severity=info';
    rerender(<Harness />);
    rerender(<Harness />);

    expect(api.filters).toBe(afterWrite);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hrefFor (L-2a: the same-page filter tile link)', () => {
  it('is empty for a patch that leaves every field at its default', () => {
    arrive('severity=info');
    render(<Harness />);
    expect(api.hrefFor({ severity: 'all' })).toBe('');
  });

  it('drops an alias present in the URL and writes the canonical key, keeping tab', () => {
    arrive('tab=x&user_id=abc');
    render(<Harness />);
    expect(api.hrefFor({ severity: 'info' })).toBe('?tab=x&account=abc&severity=info');
  });

  it('omits page-only and default values, in spec order', () => {
    arrive('search=abc&range=7d');
    render(<Harness />);
    expect(api.hrefFor({ severity: 'critical', account: '' })).toBe('?range=7d&severity=critical');
    expect(api.hrefFor({ window: { kind: 'none' } })).toBe('');
  });

  it('writes no history and changes no state', () => {
    arrive('severity=info');
    render(<Harness />);
    const first = api.filters;
    replaceSpy.mockClear();
    const href = api.hrefFor({ severity: 'critical', account: 'abc' });
    expect(href).toBe('?account=abc&severity=critical');
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(api.filters).toBe(first);
    expect(window.location.search).toBe('?severity=info');
  });
});

describe('active (L-9, F-113: two tabs on one page own the same keys)', () => {
  let activeApi: AdminFilters<Filters>;
  let activeEffectRuns = 0;

  function ActiveHarness({ active }: { active?: boolean }) {
    // Inline options on purpose: a new object every render must not matter (SA S-2).
    activeApi = useAdminFilters(SPEC, active === undefined ? undefined : { active });
    const { filters } = activeApi;
    useEffect(() => {
      activeEffectRuns += 1;
    }, [filters]);
    return null;
  }

  const DEFAULTS = { window: { kind: 'none' }, account: '', severity: 'all', search: '' };

  beforeEach(() => {
    activeEffectRuns = 0;
  });

  it('A-1: an inactive mount takes the defaults, writes nothing, and hrefFor still answers', () => {
    arrive('range=7d&account=X');
    replaceSpy.mockClear();
    render(<ActiveHarness active={false} />);
    expect(activeApi.filters).toEqual(DEFAULTS);
    expect(activeApi.isDefault).toBe(true);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?range=7d&account=X');
    expect(activeApi.hrefFor({ severity: 'info' })).toBe('?severity=info');
  });

  it('A-2: inactive, an incoming change is not parsed (same object, no [filters] run) and nothing is written', () => {
    arrive('severity=info');
    const { rerender } = render(<ActiveHarness active />);
    rerender(<ActiveHarness active={false} />);
    const first = activeApi.filters;
    replaceSpy.mockClear();

    arrive('severity=warning&range=today&user_id=abc');
    replaceSpy.mockClear();
    rerender(<ActiveHarness active={false} />);
    rerender(<ActiveHarness active={false} />);

    expect(activeApi.filters).toBe(first);
    expect(activeApi.filters.severity).toBe('info');
    expect(activeEffectRuns).toBe(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('A-3: activation when the address bar already equals the projection: no write, no re-parse', () => {
    arrive('tab=x');
    const { rerender } = render(<ActiveHarness active={false} />);
    const first = activeApi.filters;
    replaceSpy.mockClear();
    rerender(<ActiveHarness active />);
    expect(activeApi.filters).toBe(first);
    expect(activeEffectRuns).toBe(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('A-4: activation when the address bar lacks the projection: exactly one write, the unrelated key kept', () => {
    arrive('tab=x&range=7d');
    const { rerender } = render(<ActiveHarness active />);
    rerender(<ActiveHarness active={false} />);
    // The page took the keys while the tab was hidden.
    arrive('tab=x');
    rerender(<ActiveHarness active={false} />);
    replaceSpy.mockClear();

    rerender(<ActiveHarness active />);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `${PATH}?tab=x&range=7d`);
    expect(activeApi.filters.window).toEqual({ kind: 'preset', preset: '7d' });
  });

  it('A-5: activation adopts the stale incoming string without parsing it; its echo is then no outside change', () => {
    // The previous tab's string, still in useSearchParams and the address bar.
    arrive('range=90d&severity=info');
    const { rerender } = render(<ActiveHarness active={false} />);
    const first = activeApi.filters;
    replaceSpy.mockClear();

    rerender(<ActiveHarness active />);
    // Not parsed: the tab keeps its own (default) state, and the bar is corrected to it once.
    expect(activeApi.filters).toBe(first);
    expect(activeApi.filters.severity).toBe('all');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, '', PATH);

    // Next's echo of that write, then the same string again: nothing.
    mockSearch = '';
    rerender(<ActiveHarness active />);
    rerender(<ActiveHarness active />);
    expect(activeApi.filters).toBe(first);
    expect(activeEffectRuns).toBe(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('A-6: active again after activation, an outside change re-parses and our own echo does not', () => {
    arrive('tab=x');
    const { rerender } = render(<ActiveHarness active={false} />);
    rerender(<ActiveHarness active />);

    arrive('tab=x&severity=warning');
    rerender(<ActiveHarness active />);
    expect(activeApi.filters.severity).toBe('warning');

    act(() => activeApi.setFilters({ severity: 'critical' }));
    const afterWrite = activeApi.filters;
    const runs = activeEffectRuns;
    replaceSpy.mockClear();
    mockSearch = 'tab=x&severity=critical';
    rerender(<ActiveHarness active />);
    expect(activeApi.filters).toBe(afterWrite);
    expect(activeEffectRuns).toBe(runs);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('A-7: setFilters while inactive changes the state and writes nothing; activation writes it once', () => {
    arrive('tab=x');
    const { rerender } = render(<ActiveHarness active={false} />);
    replaceSpy.mockClear();
    act(() => activeApi.setFilters({ severity: 'critical' }));
    expect(activeApi.filters.severity).toBe('critical');
    expect(replaceSpy).not.toHaveBeenCalled();

    rerender(<ActiveHarness active />);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `${PATH}?tab=x&severity=critical`);
    rerender(<ActiveHarness active />);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('A-8: becoming inactive writes nothing and changes nothing', () => {
    arrive('tab=x&range=7d&severity=info');
    const { rerender } = render(<ActiveHarness active />);
    const first = activeApi.filters;
    replaceSpy.mockClear();
    rerender(<ActiveHarness active={false} />);
    expect(activeApi.filters).toBe(first);
    expect(activeEffectRuns).toBe(1);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=x&range=7d&severity=info');
  });

  it.each([
    ['omitted', undefined],
    ['true', true],
  ])('A-9: active %s behaves as today (mount rewrite, write, outside change, echo)', (_name, active) => {
    arrive('user_id=abc&tab=x');
    replaceSpy.mockClear();
    const { rerender } = render(<ActiveHarness active={active} />);
    expect(activeApi.filters.account).toBe('abc');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `${PATH}?tab=x&account=abc`);

    act(() => activeApi.setFilters({ severity: 'info' }));
    expect(window.location.search).toBe('?tab=x&account=abc&severity=info');
    const afterWrite = activeApi.filters;
    mockSearch = 'tab=x&account=abc&severity=info';
    rerender(<ActiveHarness active={active} />);
    expect(activeApi.filters).toBe(afterWrite);

    expect(replaceSpy).toHaveBeenCalledTimes(2);

    // An outside change that is already its own projection: re-parsed, nothing written.
    arrive('severity=warning');
    replaceSpy.mockClear();
    rerender(<ActiveHarness active={active} />);
    expect(activeApi.filters.severity).toBe('warning');
    expect(activeApi.filters.account).toBe('');
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
