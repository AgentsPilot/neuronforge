/**
 * @jest-environment jsdom
 *
 * ConnectionGatePanel — per-plugin Connect (disconnected) vs Refresh token (expired),
 * the sequential "Refresh all tokens" button + progress label, and disabled states.
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ConnectionGatePanel } from '../ConnectionGatePanel';
import type { ConnectionGateResult } from '@/lib/plugins/tester/tester-types';

function gate(overrides: Partial<ConnectionGateResult> = {}): ConnectionGateResult {
  return {
    enabled: false,
    userIdRequired: false,
    perPlugin: [
      { key: 'google-drive', connected: true, expired: false },
      { key: 'google-sheets', connected: false, expired: true }, // expired → refresh
      { key: 'google-docs', connected: false, expired: false }, // disconnected → connect
      { key: 'google-mail', connected: true, expired: false },
      { key: 'google-calendar', connected: true, expired: false },
    ],
    missing: ['google-sheets', 'google-docs'],
    expired: ['google-sheets'],
    ...overrides,
  };
}

describe('ConnectionGatePanel — refresh & connect actions', () => {
  it('offers BOTH Refresh token and Reconnect (OAuth) on an expired plugin, and Connect on a disconnected one', () => {
    render(
      <ConnectionGatePanel gate={gate()} onConnect={jest.fn()} onRefresh={jest.fn()} onRefreshAll={jest.fn()} />
    );
    // Expired plugin → primary Refresh + OAuth escape hatch.
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect (OAuth)' })).toBeInTheDocument();
    // Disconnected plugin → Connect.
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('fires onRefresh with the expired plugin key', () => {
    const onRefresh = jest.fn();
    render(<ConnectionGatePanel gate={gate()} onConnect={jest.fn()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh token' }));
    expect(onRefresh).toHaveBeenCalledWith('google-sheets');
  });

  it('Reconnect (OAuth) on an expired plugin triggers the full-OAuth connect path — the dead-token escape hatch', () => {
    const onConnect = jest.fn();
    render(<ConnectionGatePanel gate={gate()} onConnect={onConnect} onRefresh={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect (OAuth)' }));
    expect(onConnect).toHaveBeenCalledWith('google-sheets');
  });

  it('fires onConnect with the disconnected plugin key via Connect', () => {
    const onConnect = jest.fn();
    render(<ConnectionGatePanel gate={gate()} onConnect={onConnect} onRefresh={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('google-docs');
  });

  it('shows "Refresh all tokens" only when ≥1 required plugin is expired', () => {
    const { rerender } = render(<ConnectionGatePanel gate={gate()} onRefreshAll={jest.fn()} />);
    expect(screen.getByTestId('refresh-all-tokens')).toHaveTextContent('Refresh all tokens (1)');

    rerender(
      <ConnectionGatePanel
        gate={gate({ expired: [], perPlugin: gate().perPlugin.map((p) => ({ ...p, expired: false })) })}
        onRefreshAll={jest.fn()}
      />
    );
    expect(screen.queryByTestId('refresh-all-tokens')).not.toBeInTheDocument();
  });

  it('fires onRefreshAll when the button is clicked', () => {
    const onRefreshAll = jest.fn();
    render(<ConnectionGatePanel gate={gate()} onRefreshAll={onRefreshAll} />);
    fireEvent.click(screen.getByTestId('refresh-all-tokens'));
    expect(onRefreshAll).toHaveBeenCalledTimes(1);
  });

  it('renders live progress on the refresh-all button', () => {
    render(
      <ConnectionGatePanel
        gate={gate()}
        pluginLabels={{ 'google-sheets': 'Google Sheets' }}
        onRefreshAll={jest.fn()}
        refreshAllProgress={{ current: 2, total: 3, key: 'google-sheets' }}
      />
    );
    expect(screen.getByTestId('refresh-all-tokens')).toHaveTextContent('Refreshing Google Sheets… (2/3)');
  });

  it('disables connect/refresh buttons while an operation is in flight', () => {
    render(
      <ConnectionGatePanel gate={gate()} onConnect={jest.fn()} onRefresh={jest.fn()} onRefreshAll={jest.fn()} connectDisabled />
    );
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reconnect (OAuth)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByTestId('refresh-all-tokens')).toBeDisabled();
  });

  it('no plugin state is a dead-end: connected has no action, expired has Refresh+Reconnect, disconnected has Connect', () => {
    render(<ConnectionGatePanel gate={gate()} onConnect={jest.fn()} onRefresh={jest.fn()} />);
    // connected plugins expose no action button; expired/disconnected always have a path.
    expect(screen.getAllByRole('button', { name: 'Refresh token' })).toHaveLength(1); // 1 expired
    expect(screen.getAllByRole('button', { name: 'Reconnect (OAuth)' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(1); // 1 disconnected
  });
});
