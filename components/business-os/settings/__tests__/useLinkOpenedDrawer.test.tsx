/**
 * @jest-environment jsdom
 */

/**
 * `useLinkOpenedDrawer` (settings drawer review C-3, SA-2; SA S-1 code review
 * finding 2; S-2 workplan).
 *
 * The pair S-1 wrote inline for the plan drawer, now shared by the plan and
 * password drawers. The router is a recording stand-in, so "never pushes" and
 * "replaces exactly once" are calls that did or did not happen.
 */

import fs from 'fs';
import path from 'path';
import { act, renderHook } from '@testing-library/react';

const replace = jest.fn();
const push = jest.fn();
let currentQuery = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/business-os/settings',
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

import { useLinkOpenedDrawer } from '@/components/business-os/settings/useLinkOpenedDrawer';

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  currentQuery = 'section=password&checkout=cs_test_x&tab=foo';
});

describe('useLinkOpenedDrawer', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    expect(result.current.open).toBe(false);
  });

  it('opened from the row: open and close never touch the address', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromRow());
    expect(result.current.open).toBe(true);
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('opened by the link: closing replaces once, without scrolling, removing only `section`', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromLink());
    expect(result.current.open).toBe(true);
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/business-os/settings?checkout=cs_test_x&tab=foo', { scroll: false });
    expect(push).not.toHaveBeenCalled();
  });

  it('with `section` the only parameter, closing leaves the bare path', () => {
    currentQuery = 'section=plan';
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromLink());
    act(() => result.current.onOpenChange(false));
    expect(replace).toHaveBeenCalledWith('/business-os/settings', { scroll: false });
  });

  it('the link flag is used once: a later row open and close does not replace again', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromLink());
    act(() => result.current.onOpenChange(false));
    act(() => result.current.openFromRow());
    act(() => result.current.onOpenChange(false));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('a link arriving while the drawer is already open from the row still marks it (SA Q-2 / W-3)', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromRow());
    act(() => result.current.openFromLink());
    act(() => result.current.onOpenChange(false));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('an open request never replaces, even when link-opened', () => {
    const { result } = renderHook(() => useLinkOpenedDrawer());
    act(() => result.current.openFromLink());
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('the openers keep their identity across renders, so an effect can depend on them', () => {
    const { result, rerender } = renderHook(() => useLinkOpenedDrawer());
    const { openFromRow, openFromLink } = result.current;
    act(() => result.current.openFromRow());
    rerender();
    expect(result.current.openFromRow).toBe(openFromRow);
    expect(result.current.openFromLink).toBe(openFromLink);
  });

  it('two drawers keep separate flags', () => {
    const { result: plan } = renderHook(() => useLinkOpenedDrawer());
    const { result: password } = renderHook(() => useLinkOpenedDrawer());
    act(() => plan.current.openFromLink());
    act(() => password.current.openFromRow());
    act(() => password.current.onOpenChange(false));
    expect(replace).not.toHaveBeenCalled();
    act(() => plan.current.onOpenChange(false));
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('source: replace only (C-3)', () => {
  const source = fs
    .readFileSync(path.join(process.cwd(), 'components/business-os/settings/useLinkOpenedDrawer.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('never pushes and never hand-edits history', () => {
    expect(source).not.toMatch(/router\.push\(/);
    expect(source).not.toMatch(/\bpush\(/);
    expect(source).not.toContain('window.history');
  });

  it('never writes `checkout`', () => {
    expect(source).not.toMatch(/\.set\(\s*'checkout'/);
    expect(source).not.toMatch(/\.delete\(\s*'checkout'/);
  });
});
