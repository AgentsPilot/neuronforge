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
import type { ArchivingOverview } from '@/lib/archiving/types';

// Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
// Stubbed locally rather than in a global setup file (workplan §5.5).
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

function overview(overrides: Partial<ArchivingOverview['sources'][number]> = {}): ArchivingOverview {
  return {
    generatedAt: '2026-09-26T12:00:00.000Z',
    runsEnabled: false,
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

describe('P-5: what does not exist yet says so', () => {
  it('shows "Not available yet" for the archived total, last run and run history', async () => {
    await renderPage();

    expect(screen.getByTestId('archived-total')).toHaveTextContent('Not available yet');
    expect(screen.getByTestId('last-run')).toHaveTextContent('Not available yet');
    expect(screen.getByTestId('run-history-panel')).toHaveTextContent('Not available yet');
  });

  it('never claims "No runs yet" or an archived zero, and draws no history table', async () => {
    await renderPage();

    expect(document.body).not.toHaveTextContent(/No runs yet/i);
    expect(screen.getByTestId('archived-total')).not.toHaveTextContent(/^0$/);
    expect(within(screen.getByTestId('run-history-panel')).queryByRole('table')).not.toBeInTheDocument();
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
