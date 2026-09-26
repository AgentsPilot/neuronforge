/**
 * @jest-environment jsdom
 *
 * What an admin reads on the Archiving screen (Slice 1): P-1 to P-7.
 *
 * The assertions are about what would mislead if it were wrong: the counts and
 * cutoffs, the dropdown switching without a refetch, the disabled Archive
 * button, and "Not available yet" where a zero would be a guess.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ArchivingPage from '../page';
import type { ArchiveRunSummary, ArchivingOverview } from '@/lib/archiving/types';

// Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
// Stubbed locally rather than in a global setup file (workplan §5.5).
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

function run(overrides: Partial<ArchiveRunSummary> = {}): ArchiveRunSummary {
  return {
    id: 'run-1',
    source: 'audit_trail',
    status: 'succeeded',
    retentionDays: 365,
    cutoff: '2025-09-26T12:00:00.000Z',
    rowsArchived: 4321,
    batches: 5,
    startedBy: 'aaaaaaaa-1111-4111-8111-111111111111',
    startedByLabel: 'ops@example.com',
    startedAt: '2026-09-26T11:00:00.000Z',
    lastBatchAt: '2026-09-26T11:00:40.000Z',
    finishedAt: '2026-09-26T11:00:41.000Z',
    errorCode: null,
    isStale: false,
    ...overrides,
  };
}

function overview(
  overrides: Partial<ArchivingOverview['sources'][number]> = {},
  runs: ArchiveRunSummary[] = []
): ArchivingOverview {
  return {
    generatedAt: '2026-09-26T12:00:00.000Z',
    runsEnabled: false,
    runs,
    sources: [
      {
        key: 'audit_trail',
        label: 'Audit trail',
        totalRows: 12345,
        oldestRecordAt: '2024-03-01T08:00:00.000Z',
        options: [
          { retentionDays: 365, cutoff: '2025-09-26T12:00:00.000Z', eligibleRows: 1111 },
          { retentionDays: 180, cutoff: '2026-03-30T12:00:00.000Z', eligibleRows: 2222 },
          { retentionDays: 90, cutoff: '2026-06-28T12:00:00.000Z', eligibleRows: 3333 },
        ],
        archivedTotal: 0,
        latestCutoff: null,
        lastRun: null,
        ...overrides,
      },
    ],
  };
}

function stubFetch(data: ArchivingOverview) {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function renderPage(data: ArchivingOverview = overview()) {
  const fetchMock = stubFetch(data);
  render(<ArchivingPage />);
  await waitFor(() => expect(screen.getByTestId('source-audit_trail')).toBeInTheDocument());
  return fetchMock;
}

describe('P-1: the counts', () => {
  it('shows rows now, the oldest record in UTC, and the 365-day eligible count and cutoff', async () => {
    await renderPage();

    expect(screen.getByTestId('total-rows')).toHaveTextContent('12,345');
    expect(screen.getByTestId('oldest-record')).toHaveTextContent('2024-03-01 08:00 UTC');
    expect(screen.getByTestId('eligible-rows')).toHaveTextContent('1,111');
    expect(screen.getByTestId('eligible-cutoff')).toHaveTextContent(
      'Records created before 2025-09-26 12:00 UTC would be archived'
    );
  });

  it('reads only the overview route', async () => {
    const fetchMock = await renderPage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/archiving']);
  });
});

describe('P-2 / P-3: the retention dropdown', () => {
  it('P-2: is labelled, starts at 365 days, and offers exactly three options', async () => {
    await renderPage();

    const trigger = screen.getByRole('combobox', { name: 'Keep records live for' });
    expect(trigger).toHaveTextContent('365 days');

    await userEvent.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['365 days', '180 days', '90 days']);
  });

  it('P-2: has no free-text entry anywhere', async () => {
    await renderPage();
    expect(
      document.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea')
    ).toHaveLength(0);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('P-3: switching to 180 then 90 shows each count and cutoff, with no refetch', async () => {
    const fetchMock = await renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Keep records live for' }));
    await user.click(await screen.findByRole('option', { name: '180 days' }));

    expect(screen.getByTestId('eligible-rows')).toHaveTextContent('2,222');
    expect(screen.getByTestId('eligible-cutoff')).toHaveTextContent('2026-03-30 12:00 UTC');

    await user.click(screen.getByRole('combobox', { name: 'Keep records live for' }));
    await user.click(await screen.findByRole('option', { name: '90 days' }));

    expect(screen.getByTestId('eligible-rows')).toHaveTextContent('3,333');
    expect(screen.getByTestId('eligible-cutoff')).toHaveTextContent('2026-06-28 12:00 UTC');
    expect(screen.getByRole('combobox', { name: 'Keep records live for' })).toHaveTextContent('90 days');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('P-4: the Archive button', () => {
  it('is disabled and described by "Not switched on yet"', async () => {
    await renderPage();

    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Not switched on yet');
  });
});

// Slice 2a replaces Slice 1's P-5 ("Not available yet"): these values are now
// read from M1's tables, so a 0 or "No runs yet" is measured, not guessed.
describe('G-1: before any run, the archive side says so plainly', () => {
  it('shows a measured 0 archived, "none yet" for the cutoff, and "No runs yet" twice', async () => {
    await renderPage();

    expect(screen.getByTestId('archived-total')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('archived-before')).toHaveTextContent('Archived before: none yet');
    expect(screen.getByTestId('last-run')).toHaveTextContent('No runs yet');
    expect(screen.getByTestId('run-history-panel')).toHaveTextContent('No runs yet');
    expect(within(screen.getByTestId('run-history-panel')).queryByRole('table')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Not available yet/i);
  });
});

describe('G-2: after runs, the archive side shows what happened', () => {
  const runs = [
    run({ id: 'run-3', status: 'running', isStale: true, finishedAt: null, startedAt: '2026-09-26T11:50:00.000Z', rowsArchived: 1000, batches: 1 }),
    run({ id: 'run-2', status: 'failed', errorCode: 'batch_failed', startedByLabel: 'Admin bbbbbbbb' }),
    run({ id: 'run-1' }),
  ];

  async function renderWithRuns() {
    await renderPage(
      overview(
        { archivedTotal: 4321, latestCutoff: '2025-09-26T12:00:00.000Z', lastRun: runs[0] },
        runs
      )
    );
  }

  it('shows the archived total and the latest fully-archived cutoff in UTC', async () => {
    await renderWithRuns();
    expect(screen.getByTestId('archived-total')).toHaveTextContent('4,321');
    expect(screen.getByTestId('archived-before')).toHaveTextContent(
      'Everything before 2025-09-26 12:00 UTC is archived'
    );
  });

  it('shows the last run with its status as words', async () => {
    await renderWithRuns();
    const last = screen.getByTestId('last-run');
    expect(last).toHaveTextContent('Stalled');
    expect(last).toHaveTextContent('2026-09-26 11:50 UTC');
    expect(last).toHaveTextContent('1,000 rows');
  });

  it('lists every run newest first, with a text status badge (not colour alone)', async () => {
    await renderWithRuns();
    const table = within(screen.getByTestId('run-history-panel')).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);

    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['run-run-3', 'run-run-2', 'run-run-1']);
    // Scoped to the table: the last-run card shows run-3's badge as well.
    expect(within(table).getByTestId('run-status-run-3')).toHaveTextContent('Stalled');
    expect(within(table).getByTestId('run-status-run-2')).toHaveTextContent('Failed');
    expect(within(table).getByTestId('run-status-run-1')).toHaveTextContent('Succeeded');
    expect(rows[1]).toHaveTextContent('batch_failed');
    expect(rows[1]).toHaveTextContent('Admin bbbbbbbb');
    expect(rows[2]).toHaveTextContent('ops@example.com');
    expect(rows[2]).toHaveTextContent('365 days');
    expect(rows[2]).toHaveTextContent('4,321');
  });

  it('a live running run reads Running, and a partial run reads Partial', async () => {
    await renderPage(
      overview({}, [
        run({ id: 'live', status: 'running', isStale: false, finishedAt: null }),
        run({ id: 'part', status: 'partial' }),
      ])
    );
    expect(screen.getByTestId('run-status-live')).toHaveTextContent('Running');
    expect(screen.getByTestId('run-status-part')).toHaveTextContent('Partial');
  });

  it('still offers no way to start or continue a run in Slice 2a', async () => {
    await renderWithRuns();
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
  });
});

describe('P-6: when the overview cannot be read', () => {
  it('shows the route message and a retry, and no counts', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'Could not read the archiving overview' }),
    })) as unknown as typeof fetch;

    render(<ArchivingPage />);

    const error = await screen.findByTestId('page-error');
    expect(error).toHaveTextContent('Could not read the archiving overview');
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByTestId('source-audit_trail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('total-rows')).not.toBeInTheDocument();
  });

  it('a non-JSON error page (an HTML 504) shows the friendly text, not the parser message', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 504,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
      },
    })) as unknown as typeof fetch;

    render(<ArchivingPage />);

    const error = await screen.findByTestId('page-error');
    expect(error).toHaveTextContent('Could not read the archiving overview');
    expect(error).not.toHaveTextContent(/Unexpected token|not valid JSON/);
  });

  it('retrying reads again and shows the counts once it succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: 'Nope' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: overview() }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ArchivingPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByTestId('total-rows')).toHaveTextContent('12,345'));
    expect(screen.queryByTestId('page-error')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('P-7: an empty table', () => {
  it('says "No records" for the oldest and 0 eligible for every option', async () => {
    await renderPage(
      overview({
        totalRows: 0,
        oldestRecordAt: null,
        options: [
          { retentionDays: 365, cutoff: '2025-09-26T12:00:00.000Z', eligibleRows: 0 },
          { retentionDays: 180, cutoff: '2026-03-30T12:00:00.000Z', eligibleRows: 0 },
          { retentionDays: 90, cutoff: '2026-06-28T12:00:00.000Z', eligibleRows: 0 },
        ],
      })
    );
    const user = userEvent.setup();

    expect(screen.getByTestId('total-rows')).toHaveTextContent('0');
    expect(screen.getByTestId('oldest-record')).toHaveTextContent('No records');
    expect(screen.getByTestId('eligible-rows')).toHaveTextContent('0');

    for (const label of ['180 days', '90 days']) {
      await user.click(screen.getByRole('combobox', { name: 'Keep records live for' }));
      await user.click(await screen.findByRole('option', { name: label }));
      expect(screen.getByTestId('eligible-rows')).toHaveTextContent('0');
    }
  });
});
