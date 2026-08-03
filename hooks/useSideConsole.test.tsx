/**
 * @jest-environment jsdom
 *
 * Unit test for the FR8 side-console hook: append, retention cap, clear, userId
 * labeling, and defensive redaction at capture time.
 */

import { renderHook, act } from '@testing-library/react';
import { useSideConsole } from './useSideConsole';
import { REDACTED } from '@/lib/plugins/tester/redaction';

function baseEntry(overrides: Partial<Parameters<ReturnType<typeof useSideConsole>['append']>[0]> = {}) {
  return {
    userId: 'u1',
    plugin: 'google-drive',
    action: 'list_files',
    request: { max_results: 10 },
    response: { files: [] },
    outcome: 'success' as const,
    durationMs: 12,
    ...overrides,
  };
}

describe('useSideConsole', () => {
  it('appends entries newest-first with generated id/timestamp', () => {
    const { result } = renderHook(() => useSideConsole());
    act(() => result.current.append(baseEntry({ action: 'a1' })));
    act(() => result.current.append(baseEntry({ action: 'a2' })));

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].action).toBe('a2'); // newest first
    expect(result.current.entries[0].id).toBeTruthy();
    expect(result.current.entries[0].timestamp).toBeTruthy();
  });

  it('bounds to the retention cap', () => {
    const { result } = renderHook(() => useSideConsole(3));
    act(() => {
      for (let i = 0; i < 5; i++) result.current.append(baseEntry({ action: `a${i}` }));
    });
    expect(result.current.entries).toHaveLength(3);
    expect(result.current.entries[0].action).toBe('a4');
  });

  it('clear empties the console', () => {
    const { result } = renderHook(() => useSideConsole());
    act(() => result.current.append(baseEntry()));
    act(() => result.current.clear());
    expect(result.current.entries).toHaveLength(0);
  });

  it('records the active userId on each entry', () => {
    const { result } = renderHook(() => useSideConsole());
    act(() => result.current.append(baseEntry({ userId: 'user-A' })));
    act(() => result.current.append(baseEntry({ userId: 'user-B' })));
    expect(result.current.entries.map((e) => e.userId)).toEqual(['user-B', 'user-A']);
  });

  it('redacts credential-shaped data at capture time', () => {
    const { result } = renderHook(() => useSideConsole());
    act(() =>
      result.current.append(
        baseEntry({
          request: { access_token: 'ya29.secret', file_id: 'f1' },
          response: { headers: { authorization: 'Bearer x' } },
        })
      )
    );
    const entry = result.current.entries[0];
    expect((entry.request as Record<string, unknown>).access_token).toBe(REDACTED);
    expect((entry.request as Record<string, unknown>).file_id).toBe('f1');
    expect((entry.response as { headers: Record<string, unknown> }).headers.authorization).toBe(REDACTED);
  });
});
