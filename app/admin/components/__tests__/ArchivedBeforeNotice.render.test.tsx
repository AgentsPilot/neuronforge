/**
 * @jest-environment jsdom
 *
 * The "Entries before <date> are archived" notice (FR-12, C-6, AC-16).
 * Workplan §5.3, N-1 to N-4.
 *
 * What would mislead if it were wrong: a notice with no successful run behind
 * it, a local-time date for a UTC cutoff, or an audit screen that breaks
 * because the archiving read failed.
 */

import '@testing-library/jest-dom';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, waitFor } from '@testing-library/react';

import { ArchivedBeforeNotice } from '../ArchivedBeforeNotice';

function overview(latestCutoff: string | null) {
  return {
    success: true,
    data: { generatedAt: 'x', runsEnabled: true, runs: [], sources: [{ key: 'audit_trail', latestCutoff }] },
  };
}

function mockFetch(impl: () => Promise<unknown>): jest.Mock {
  const fetchMock = jest.fn(impl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

describe('ArchivedBeforeNotice', () => {
  it('N-1: shows the UTC date of the latest succeeded cutoff, as a note', async () => {
    const fetchMock = mockFetch(ok(overview('2025-09-27T23:30:00.000Z')));

    render(<ArchivedBeforeNotice />);

    expect(await screen.findByRole('note')).toHaveTextContent('Entries before 2025-09-27 are archived.');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/archiving');
  });

  it('N-2: renders nothing when nothing has been archived yet', async () => {
    const fetchMock = mockFetch(ok(overview(null)));

    const { container } = render(<ArchivedBeforeNotice />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it.each<[string, () => Promise<unknown>]>([
    ['a 500', async () => ({ ok: false, status: 500, json: async () => ({ success: false }) })],
    ['a network error', async () => Promise.reject(new Error('offline'))],
  ])('N-3: renders nothing, and does not throw, on %s', async (_label, impl) => {
    const fetchMock = mockFetch(impl);

    const { container } = render(<ArchivedBeforeNotice />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('N-4: where it is used, and what it reads', () => {
  const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');

  it('both admin audit screens render it', () => {
    expect(read('app', 'admin', 'audit-trail', 'page.tsx')).toMatch(/<ArchivedBeforeNotice\b/);
    expect(read('app', 'admin', 'users', 'page.tsx')).toMatch(/<ArchivedBeforeNotice\b/);
  });

  it('the hook fetches only the archiving overview (no parked audit route, no new route)', () => {
    const hook = read('hooks', 'useLatestArchiveCutoff.ts');
    const urls = [...hook.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls).toEqual(['ARCHIVING_OVERVIEW_URL']);
    expect(hook).toMatch(/ARCHIVING_OVERVIEW_URL = '\/api\/admin\/archiving';/);
  });
});
