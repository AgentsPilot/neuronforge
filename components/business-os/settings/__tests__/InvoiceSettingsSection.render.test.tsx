/**
 * @jest-environment jsdom
 *
 * Invoice settings: picking an address from the autocomplete fills the form.
 *
 * Regression: the pick handler called `setAddressPicked(false)`, a setter that
 * was never declared. It threw a ReferenceError before `setSettings` ran, so a
 * picked address never reached the fields. The business profile's handler,
 * which this one mirrors, has no such state — the call was simply stray.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', isRTL: false, t: (key: string) => key }),
}));

// The real one needs a Places API key; this stands in for "the owner picked a suggestion".
jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: ({ onSelect }: { onSelect: (a: Record<string, string>) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({ line1: '1 Picked Street', city: 'Springfield', postal_code: '12345', country: 'US' })
      }
    >
      pick-address
    </button>
  ),
}));

// An empty address book: nothing saved, so the fields are shown.
jest.mock('@/components/ui/SavedAddressPicker', () => ({ SavedAddressPicker: () => null }));
jest.mock('@/components/payments/StripeConnectStatus', () => ({ StripeConnectStatus: () => null }));

import { InvoiceSettingsSection } from '@/components/business-os/settings/InvoiceSettingsSection';

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { invoice_address: {} } }),
    } as Response)
  ) as unknown as typeof fetch;
});

it('applies a picked autocomplete address to the invoice address fields', async () => {
  const user = userEvent.setup();
  render(<InvoiceSettingsSection chrome={false} userId="user-1" showProcessor={false} />);

  await user.click(await screen.findByRole('button', { name: 'pick-address' }));

  expect(screen.getByPlaceholderText('settings.invoice.address_line1')).toHaveValue('1 Picked Street');
  expect(screen.getByDisplayValue('Springfield')).toBeInTheDocument();
});

it('still shows the form when loading the settings fails', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
  render(<InvoiceSettingsSection chrome={false} userId="user-1" showProcessor={false} />);

  expect(await screen.findByPlaceholderText('settings.invoice.address_line1')).toHaveValue('');
});
