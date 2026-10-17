/**
 * @jest-environment jsdom
 *
 * Entry points E3 (/settings, SecurityTab) and E4 (/v2/settings,
 * SecurityTabV2) (data export DE-9, workplan §3.7 / §6.1; BC-1 a). Each
 * renders exactly ONE shared "Download my data" control (the `button`
 * variant) and no export message of its own; the old gradient "Export Data"
 * button is gone. Both screens are in the parked agent-platform app, so this
 * render test and QA's source review replace a manual click-through.
 *
 * The control and the Danger zone are mocked as markers (each has its own
 * suite), so a count of one is the card's control alone.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

const mockControl = jest.fn((props: { variant: string }) => <div data-testid="download-my-data" data-variant={props.variant} />);
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: (props: { variant: string }) => mockControl(props),
}));
jest.mock('@/components/business-os/purge/DangerZonePanel', () => ({ DangerZonePanel: () => <div data-testid="danger-zone" /> }));
jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com', identities: [], app_metadata: {} } }),
}));
jest.mock('@/lib/client/change-password', () => ({ changePassword: jest.fn() }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: null } })) } } }));

import SecurityTab from '@/components/settings/SecurityTab';
import SecurityTabV2 from '@/components/v2/settings/SecurityTabV2';

beforeEach(() => mockControl.mockClear());

describe.each([
  ['E3 /settings SecurityTab', SecurityTab],
  ['E4 /v2/settings SecurityTabV2', SecurityTabV2],
] as const)('%s', (_name, Screen) => {
  it('renders exactly one shared control, the button variant, under a "Download my data" card', () => {
    render(<Screen />);
    const controls = screen.getAllByTestId('download-my-data');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('data-variant', 'button');
    expect(screen.getByRole('heading', { name: 'Download my data' })).toBeInTheDocument();
    expect(screen.getByTestId('danger-zone')).toBeInTheDocument();
  });

  it('has no export button or export message of its own', () => {
    const { container } = render(<Screen />);
    expect(screen.queryByRole('button', { name: /export data/i })).toBeNull();
    expect(container.textContent).not.toMatch(/Export Account Data|Data exported successfully|Failed to export data|in JSON format/);
  });
});
