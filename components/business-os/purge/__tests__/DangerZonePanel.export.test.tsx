/**
 * @jest-environment jsdom
 *
 * The Danger zone's export (data export DE-9, workplan §3.7 E2 / §6.1; SA DE-9
 * C-8; DE-1 QA E4 before it).
 *
 * Since DE-9 the Danger zone has no export logic of its own: it renders the one
 * shared "Download my data" control, which owns the request, the copy and the
 * notice (its own suite covers every outcome). Pinned here: exactly one shared
 * control, in the `button` variant, beside the "Contact us" mailto; no link to
 * any export route and no export message of the panel's own. Rendered without
 * a LanguageProvider, as on /v2/settings.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const mockControl = jest.fn((props: { variant: string }) => <div data-testid="download-my-data" data-variant={props.variant} />);
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: (props: { variant: string }) => mockControl(props),
}));

import { ErasureRequestContent, DangerZonePanel } from '@/components/business-os/purge/DangerZonePanel';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

beforeEach(() => mockControl.mockClear());

describe('Danger zone export (DE-9)', () => {
  it('renders exactly one shared control, the button variant', () => {
    render(<ErasureRequestContent />);
    const controls = screen.getAllByTestId('download-my-data');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('data-variant', 'button');
  });

  it('keeps the "Contact us" mailto to the one support contact, as a sibling of the control', () => {
    render(<ErasureRequestContent />);
    const contact = screen.getByRole('link', { name: 'Contact us' });
    expect(contact).toHaveAttribute('href', `mailto:${PLACEHOLDER_ERASURE_CONTACT}`);
    expect(contact.contains(screen.getByTestId('download-my-data'))).toBe(false);
  });

  it('has no export link, no export button and no export message of its own', () => {
    const { container } = render(<ErasureRequestContent />);
    expect(container.querySelector('a[href*="data-export"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    expect(container.textContent).not.toMatch(/Data exported successfully|Failed to export data/);
    // C-8: no flex-row-reverse wrapper around the control.
    expect(screen.getByTestId('download-my-data').closest('.flex-row-reverse')).toBeNull();
  });

  it('the boxed panel shows the control once it is opened', () => {
    render(<DangerZonePanel />);
    expect(screen.queryByTestId('download-my-data')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getAllByTestId('download-my-data')).toHaveLength(1);
  });
});
