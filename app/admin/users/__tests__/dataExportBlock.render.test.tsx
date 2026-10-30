/**
 * @jest-environment jsdom
 */

/**
 * The admin "Data export" box after MX-3.1 (export redesign, workplan §8;
 * BQ-E6.1-1 answered 2026-10-27): the admin ZIP is gone until MX-5, and the
 * box shows one line. It makes no request.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { DataExportBlock } from '../components/DataExportBlock';
import { DATA_EXPORT_COPY } from '../dataExportCopy';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('the Data export box (MX-3.1 placeholder)', () => {
  it('shows its heading and the one placeholder line, in its box', () => {
    render(<DataExportBlock accountId={ACCOUNT} />);
    const box = screen.getByTestId('drawer-box-export');
    expect(box).toBeTruthy();
    expect(screen.getByTestId('drawer-section-export')).toBeTruthy();
    expect(screen.getByText('Data export')).toBeTruthy();
    expect(screen.getByTestId('data-export-placeholder').textContent).toBe("Admin export is coming back as 'Send export to owner'.");
    expect(DATA_EXPORT_COPY.placeholder).toBe("Admin export is coming back as 'Send export to owner'.");
  });

  it('makes no request and offers no button', () => {
    render(<DataExportBlock accountId={ACCOUNT} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
