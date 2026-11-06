/**
 * @jest-environment jsdom
 */

/**
 * The admin "Data export" box after MX-5 (export redesign, workplan §4.8,
 * T-U1, T-U2, T-U13; SA-Q6, SA-Q10): a purpose line and "Send export to
 * owner…". The box makes NO request when it mounts (workplan E-20): the send
 * dialog reads only when the admin opens it.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataExportBlock } from '../components/DataExportBlock';
import { DATA_EXPORT_COPY } from '../dataExportCopy';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const URL = `/api/admin/users/${ACCOUNT}/export-sends`;

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { state: 'closed', modules: [], sends: [], nextSendAt: null } }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('the Data export box (MX-5)', () => {
  it('T-U1: keeps its three test ids, its heading, the purpose line and the opener; the placeholder is gone', () => {
    render(<DataExportBlock accountId={ACCOUNT} />);
    expect(screen.getByTestId('drawer-box-export')).toBeTruthy();
    expect(screen.getByTestId('drawer-section-export')).toBeTruthy();
    expect(screen.getByTestId('data-export-block')).toBeTruthy();
    expect(screen.getByText('Data export')).toBeTruthy();
    expect(screen.getByTestId('data-export-purpose').textContent).toBe(
      'Send the owner their own data, by email to their login address. You never see the files.'
    );
    expect(screen.getByTestId('data-export-send-open').textContent).toBe('Send export to owner…');
    expect(screen.queryByTestId('data-export-placeholder')).toBeNull();
    expect(Object.keys(DATA_EXPORT_COPY)).not.toContain('placeholder');
  });

  it('T-U2: no request on mount; one GET of the export-sends route, no-store, when the dialog opens', async () => {
    render(<DataExportBlock accountId={ACCOUNT} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('data-export-send-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('data-export-send-open'));
    await waitFor(() => expect(screen.getByTestId('data-export-send-state').textContent).toBe(DATA_EXPORT_COPY.closed));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('T-U13: focus returns to the opener on close', async () => {
    render(<DataExportBlock accountId={ACCOUNT} />);
    const opener = screen.getByTestId('data-export-send-open');
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByTestId('data-export-send-state')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('data-export-send-close'));
    });
    await waitFor(() => expect(screen.queryByTestId('data-export-send-dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
