/**
 * @jest-environment jsdom
 *
 * What an admin reads on the Archiving screen: Slice 1 P-1 to P-7, Slice 2a
 * G-1 and G-2, Slice 2b G-3 to G-8 (the confirm dialog and Continue).
 *
 * The assertions are about what would mislead if it were wrong: the counts and
 * cutoffs, the dropdown switching without a refetch, what the confirm dialog
 * promises (including K-1 at 180 and 90 days), and that nothing is sent while
 * runs are switched off.
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

// Slice 2b replaces Slice 1's P-4 ("Archive is disabled"): Archive now opens
// the confirm dialog, and "Not switched on yet" moves to Confirm (SA Q-1).
describe('G-3 / G-4: the confirm dialog', () => {
  it('G-3: Archive opens it with the source, retention, cutoff and rows for the selected option; Escape closes it', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('Audit trail');
    expect(within(dialog).getByTestId('dialog-retention')).toHaveTextContent('365 days');
    expect(within(dialog).getByTestId('dialog-cutoff')).toHaveTextContent('2025-09-26 12:00 UTC');
    expect(within(dialog).getByTestId('dialog-rows')).toHaveTextContent('1,111');
    expect(dialog).toHaveTextContent("Archived records can't be viewed or restored from the product.");

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    [180, '2,222'],
    [90, '3,333'],
  ])('G-4 (AC-8): at %p days the owner-history sentence names that number', async (days, rows) => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId('retention-select'));
    await user.click(await screen.findByRole('option', { name: `${days} days` }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByTestId('dialog-rows')).toHaveTextContent(rows);
    expect(within(dialog).getByTestId('owner-history-warning')).toHaveTextContent(
      `Business owners will see only the last ${days} days of their own activity history from now on.`
    );
  });

  it('G-4 (AC-8): at 365 days there is no owner-history sentence', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('owner-history-warning')).not.toBeInTheDocument();
  });
});

describe('G-5: while runs are switched off', () => {
  it('Confirm and Continue are disabled and say so, and nothing is ever posted', async () => {
    const user = userEvent.setup();
    const fetchMock = await renderPage(overview({}, [run({ id: 'part', status: 'partial' })]));

    expect(screen.getByTestId('runs-off-badge')).toHaveTextContent('Runs off');
    const cont = screen.getByTestId('continue-part');
    expect(cont).toBeDisabled();
    expect(cont).toHaveAccessibleDescription('Not switched on yet');

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const confirm = within(await screen.findByRole('dialog')).getByTestId('confirm-archive');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription('Not switched on yet');
    await user.click(confirm);

    for (const call of fetchMock.mock.calls as unknown[][]) {
      expect(call).toEqual(['/api/admin/archiving']);
    }
  });
});

describe('runs switched on', () => {
  /** The overview for every GET; the run route answers with `postReply`. */
  function stubRoutes(data: ArchivingOverview, postReply: { ok: boolean; body: unknown }) {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: postReply.ok, json: async () => postReply.body }
        : { ok: true, json: async () => ({ success: true, data }) }
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  const enabled = (runs: ArchiveRunSummary[] = []) => ({ ...overview({}, runs), runsEnabled: true });
  const posts = (fetchMock: jest.Mock) =>
    fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST');

  it('G-6: Confirm posts exactly the start request, then reads the overview again', async () => {
    const user = userEvent.setup();
    const fetchMock = stubRoutes(enabled(), {
      ok: true,
      body: { success: true, data: { runId: 'r', outcome: 'succeeded', rowsArchived: 1111, batches: 2 } },
    });
    render(<ArchivingPage />);
    await screen.findByTestId('source-audit_trail');

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('confirm-archive'));

    await waitFor(() => expect(screen.getByTestId('run-notice')).toHaveTextContent('Done: 1,111 rows archived.'));
    const [[url, init]] = posts(fetchMock);
    expect(url).toBe('/api/admin/archiving/runs');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: 'start',
      source: 'audit_trail',
      retentionDays: 365,
    });
    expect(fetchMock.mock.calls.filter((call) => call[0] === '/api/admin/archiving')).toHaveLength(2);
  });

  it('G-7: Continue shows for partial, failed and stalled runs only, and posts the run id', async () => {
    const user = userEvent.setup();
    const fetchMock = stubRoutes(
      enabled([
        run({ id: 'part', status: 'partial' }),
        run({ id: 'fail', status: 'failed' }),
        run({ id: 'stalled', status: 'running', isStale: true }),
        run({ id: 'live', status: 'running', isStale: false }),
        run({ id: 'done', status: 'succeeded' }),
      ]),
      { ok: true, body: { success: true, data: { runId: 'part', outcome: 'partial', rowsArchived: 10, batches: 1 } } }
    );
    render(<ArchivingPage />);
    await screen.findByTestId('source-audit_trail');

    for (const id of ['part', 'fail', 'stalled']) expect(screen.getByTestId(`continue-${id}`)).toBeEnabled();
    for (const id of ['live', 'done']) expect(screen.queryByTestId(`continue-${id}`)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('continue-part'));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String((posts(fetchMock)[0][1] as RequestInit).body))).toEqual({ action: 'continue', runId: 'part' });
    await waitFor(() => expect(screen.getByTestId('run-notice')).toHaveTextContent('Paused after 10 rows'));
  });

  it.each([
    // The server refuses even if a stale page thought runs were on (QA's missing row).
    ['runs_not_enabled', 409, 'Archiving is not switched on yet.'],
    ['run_in_progress', 409, 'Another run is in progress.'],
    ['run_not_continuable', 409, "This run can't be continued."],
    ['archive_batch_failed', 500, 'A batch failed and nothing was lost. Press Continue to retry.'],
    ['run_unfinished', 500, 'The run stopped before it was recorded. You can continue it in about 5 minutes.'],
    // SA L-3: an unrecognised failure on Continue says "continued", not "started".
    ['Internal server error', 500, 'The run could not be continued.'],
  ])('G-8: %s on Continue reads as a plain sentence, never raw error text', async (code, _status, sentence) => {
    const user = userEvent.setup();
    stubRoutes(enabled([run({ id: 'part', status: 'partial' })]), { ok: false, body: { success: false, error: code } });
    render(<ArchivingPage />);
    await screen.findByTestId('source-audit_trail');

    await user.click(screen.getByTestId('continue-part'));

    // Exactly the sentence: the code itself never reaches the screen.
    expect((await screen.findByTestId('run-notice')).textContent).toBe(sentence);
  });

  it('G-8: an unrecognised failure on Confirm says the run could not be started', async () => {
    const user = userEvent.setup();
    stubRoutes(enabled(), { ok: false, body: { success: false, error: 'Internal server error' } });
    render(<ArchivingPage />);
    await screen.findByTestId('source-audit_trail');

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('confirm-archive'));

    expect((await screen.findByTestId('run-notice')).textContent).toBe('The run could not be started.');
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
