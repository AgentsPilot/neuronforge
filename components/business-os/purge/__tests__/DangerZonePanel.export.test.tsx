/**
 * @jest-environment jsdom
 *
 * The Danger zone's "Export Data" control (DE-1, BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md
 * §3.8 / §6.4; QA E4).
 *
 * It used to be a plain `<a href="/api/user/data-export">`, so a signed-out
 * click saved the 401 JSON as "my data". It is now a button through the shared
 * fetch-and-blob helper, which returns a verdict. Pinned: no link to the route;
 * one helper call per click; busy while pending; the success or error message
 * in a polite status region. Rendered without a LanguageProvider, as on
 * /v2/settings, so the copy is FALLBACK_COPY (English).
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DownloadUserDataExportResult } from '@/lib/client/downloadUserDataExport';

const mockDownload = jest.fn<Promise<DownloadUserDataExportResult>, []>();
jest.mock('@/lib/client/downloadUserDataExport', () => ({
  downloadUserDataExport: () => mockDownload(),
}));

import { ErasureRequestContent } from '@/components/business-os/purge/DangerZonePanel';

const SUCCESS = 'Data exported successfully!';
const FAILURE = 'Failed to export data. Please try again.';

beforeEach(() => {
  mockDownload.mockReset();
});

describe('Danger zone export control', () => {
  it('is a button, and nothing links to the export route', () => {
    const { container } = render(<ErasureRequestContent />);
    expect(screen.getByRole('button', { name: 'Export Data' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/api/user/data-export"]')).toBeNull();
    expect(container.querySelector('a[href*="data-export"]')).toBeNull();
  });

  it('calls the helper once, is busy while pending, then shows the success message', async () => {
    let resolve: (value: DownloadUserDataExportResult) => void = () => undefined;
    mockDownload.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<ErasureRequestContent />);
    const button = screen.getByRole('button', { name: 'Export Data' });

    await userEvent.click(button);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    // A second click while pending does not start a second download.
    await userEvent.click(button);
    expect(mockDownload).toHaveBeenCalledTimes(1);

    resolve({ success: true, filename: 'agentpilot-data-export-2026-07-15.json' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SUCCESS));
    expect(button).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText(FAILURE)).toBeNull();
  });

  it('signed out (401): the error message, no success message (QA E4)', async () => {
    mockDownload.mockResolvedValue({ success: false, status: 401, code: 'unauthorized' });
    render(<ErasureRequestContent />);
    await userEvent.click(screen.getByRole('button', { name: 'Export Data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(FAILURE));
    expect(screen.queryByText(SUCCESS)).toBeNull();
  });

  it('a network failure: the error message', async () => {
    mockDownload.mockResolvedValue({ success: false, code: 'network' });
    render(<ErasureRequestContent />);
    await userEvent.click(screen.getByRole('button', { name: 'Export Data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(FAILURE));
  });

  it('a helper that throws still ends in the error message, never a success', async () => {
    mockDownload.mockRejectedValue(new Error('unexpected'));
    render(<ErasureRequestContent />);
    await userEvent.click(screen.getByRole('button', { name: 'Export Data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(FAILURE));
    expect(screen.getByRole('button', { name: 'Export Data' })).not.toBeDisabled();
  });
});
