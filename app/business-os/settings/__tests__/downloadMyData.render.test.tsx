/**
 * @jest-environment jsdom
 *
 * Entry point E1 (data export DE-9, workplan §3.7 / §6.1): the Business OS
 * settings Security list renders exactly ONE shared "Download my data"
 * control, in the `row` variant, and the page has no export message of its
 * own (its banner keeps every other settings message).
 *
 * The control is mocked as a marker (its own suite covers every outcome); the
 * page's drawers, sections and hooks are stubbed so only the page's own
 * markup is under test.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockControl = jest.fn((props: { variant: string }) => <div data-testid="download-my-data" data-variant={props.variant} />);
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: (props: { variant: string }) => mockControl(props),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/business-os/settings',
}));
jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com', identities: [], app_metadata: {} } }),
}));
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    isRTL: false,
    language: 'en',
    setLanguage: jest.fn(),
    currencyCode: 'USD',
    setCurrency: jest.fn(),
    availableCurrencies: { USD: { symbol: '$' } },
    timezone: 'UTC',
    timeZoneOptions: (o: Intl.DateTimeFormatOptions = {}) => ({ ...o, timeZone: 'UTC' }),
  }),
  useOptionalLanguage: () => undefined,
  useBusinessTimezone: () => ({ timezone: 'UTC', timeZoneOptions: (o: Intl.DateTimeFormatOptions = {}) => ({ ...o, timeZone: 'UTC' }) }),
}));
jest.mock('@/components/business-os/ConfigurationDialogProvider', () => ({
  useConfigurationDialog: () => ({ openConfiguration: jest.fn(), isConfigurationOpen: false }),
}));
jest.mock('@/components/business-os/settings/PlanSection', () => ({ PlanSection: () => null }));
jest.mock('@/components/business-os/settings/SettingsDrawer', () => ({ SettingsDrawer: () => null }));
jest.mock('@/components/business-os/settings/ChangePasswordDrawer', () => ({ ChangePasswordDrawer: () => null }));
jest.mock('@/components/business-os/settings/InviteFriendsSection', () => ({ InviteFriendsSection: () => null }));
jest.mock('@/components/business-os/settings/MarketingConsentDrawer', () => ({ MarketingConsentDrawer: () => null }));
jest.mock('@/components/business-os/settings/marketingDrawerReads', () => ({ startMarketingDrawerReads: jest.fn() }));
jest.mock('@/components/business-os/settings/planDrawerReads', () => ({ startPlanDrawerRead: jest.fn() }));
jest.mock('@/components/business-os/settings/useDrawerPrefetch', () => ({
  DRAWER_PREFETCH_MAX_AGE_MS: 60_000,
  useDrawerPrefetch: () => ({ warm: jest.fn(), take: jest.fn() }),
}));
jest.mock('@/components/business-os/settings/useLinkOpenedDrawer', () => ({
  useLinkOpenedDrawer: () => ({ open: false, openFromRow: jest.fn(), openFromLink: jest.fn(), onOpenChange: jest.fn() }),
}));
jest.mock('@/components/business-os/purge/DangerZonePanel', () => ({ ErasureRequestContent: () => null }));
jest.mock('@/components/ui/AvatarUpload', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: jest.fn() }));

import BusinessOSSettingsPage from '@/app/business-os/settings/page';

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

describe('E1 /business-os/settings: one "Download my data" row', () => {
  it('renders exactly one shared control, the row variant, and no export message of its own', async () => {
    const { container } = render(<BusinessOSSettingsPage />);
    await waitFor(() => expect(screen.getAllByTestId('download-my-data')).toHaveLength(1));
    expect(screen.getByTestId('download-my-data')).toHaveAttribute('data-variant', 'row');
    expect(container.textContent).not.toMatch(/settings\.security\.export_/);
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
  });
});
