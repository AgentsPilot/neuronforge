/**
 * @jest-environment jsdom
 *
 * Choosing WHO a calendar booking is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The panel opened on a search box, and a full-width "Add new client" button
 * switched it to a form. The only way back was a small underlined link reading
 * "Search existing client" — weaker than the button that got you there, and
 * pushed up the panel by the form it sat above. An owner who pressed Add by
 * mistake had to notice a link to undo it.
 *
 * Two pills now, always on screen. These hold the property that made it a
 * defect: whichever mode you are in, leaving it is the same gesture as
 * entering it, and both are visible at once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const COPY: Record<string, string> = {
  'scheduling.booking.client_info': 'Client Information',
  'scheduling.booking.client_existing': 'A client you have',
  'scheduling.booking.client_new': 'Someone new',
  'scheduling.booking.client_new_hint': 'They are added to your clients when you save.',
  'scheduling.booking.search_client_placeholder': 'Search existing clients...',
  'scheduling.booking.search_existing_client': 'Search existing client',
  'scheduling.booking.add_new_client': 'Add New Client',
  'scheduling.booking.first_name': 'First name',
  'scheduling.booking.new_booking': 'New Booking',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

jest.mock('@/components/crm/SearchableCountrySelect', () => ({
  SearchableCountrySelect: () => <div data-testid="country" />,
}));

import { SchedulingBookingModal } from '../SchedulingBookingModal';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

/** One bookable service, so the picker has something to resolve. */
const SERVICE = {
  id: 'svc-1',
  service_name: 'Individual Therapy Session',
  duration_minutes: 50,
  buffer_minutes: 15,
  price: 300,
  currency: 'ILS',
  status: 'active',
  is_active: true,
  is_scheduled: true,
  sale_mode: 'direct',
  collection: 'invoice',
} as unknown as SchedulingService;

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function openNewBooking() {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, services: [], contacts: [], data: {} }),
    } as Response)
  ) as unknown as typeof fetch;

  render(
    <SchedulingBookingModal
      services={[SERVICE]}
      isOpen
      onClose={jest.fn()}
      onBookingUpdated={jest.fn()}
    />
  );
  await settle();
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('the client question', () => {
  it('offers both kinds at once, rather than a default and an escape', async () => {
    await openNewBooking();

    expect(screen.getByText('Client Information')).toBeInTheDocument();
    expect(screen.getByText('A client you have')).toBeInTheDocument();
    expect(screen.getByText('Someone new')).toBeInTheDocument();
  });

  it('starts on the client you already have, and says which it is', async () => {
    await openNewBooking();

    expect(screen.getByRole('button', { name: 'A client you have' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByPlaceholderText('Search existing clients...')).toBeInTheDocument();
  });

  it('switches to the form, and back, with the same gesture', async () => {
    await openNewBooking();

    fireEvent.click(screen.getByText('Someone new'));

    // The form is asked for, the search is gone, and the pill says so.
    expect(screen.queryByPlaceholderText('Search existing clients...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Someone new' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/added to your clients when you save/)).toBeInTheDocument();

    // And the way back is the pill that is still on screen — not a link below
    // the form that put it there.
    fireEvent.click(screen.getByText('A client you have'));
    expect(screen.getByPlaceholderText('Search existing clients...')).toBeInTheDocument();
  });

  it('no longer offers the weaker routes it used to', async () => {
    await openNewBooking();

    // The full-width button and the underlined link were the two halves of the
    // uneven pair. Asserted, so neither comes back alongside the pills.
    expect(screen.queryByText('Add New Client')).not.toBeInTheDocument();
    expect(screen.queryByText('Search existing client')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Someone new'));
    expect(screen.queryByText('Search existing client')).not.toBeInTheDocument();
  });
});
