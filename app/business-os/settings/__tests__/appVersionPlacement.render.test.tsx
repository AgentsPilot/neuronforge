/**
 * @jest-environment jsdom
 *
 * Where the version line sits (app version stamp R19; SA-C-1, Done-when "the
 * version line shows in Settings and admin"). The real AppVersionLine renders,
 * against a stubbed fetch; everything else on the pages is stubbed as in the
 * other render tests. Every value is made up.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({ DownloadMyDataButton: () => null }));
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
jest.mock('@/components/business-os/purge/DangerZonePanel', () => ({ ErasureRequestContent: () => null, ErasureDialogBody: () => null }));
jest.mock('@/components/ui/AvatarUpload', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: jest.fn() }));

jest.mock('@/app/admin/components/AdminSidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/admin/components/AdminHeader', () => ({ __esModule: true, default: () => null }));

import BusinessOSSettingsPage from '@/app/business-os/settings/page';
import AdminChrome from '@/app/admin/components/AdminChrome';

const VERSION = { success: true, data: { environment: 'staging', commit: 'abcdef0', builtAt: '2026-01-02T03:04:05.000Z' } };
const LINE = 'Staging · abcdef0 · built 2026-01-02 03:04 UTC';

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const body = String(input) === '/api/version' ? VERSION : { success: true, data: {} };
    // jsdom has no Response: a minimal answer object is enough for every reader here.
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

describe('R19 version line placement', () => {
  it('Settings: shown once, below the two-column grid, not inside it (SA-C-1)', async () => {
    render(<BusinessOSSettingsPage />);
    const line = await screen.findByTestId('app-version-line');
    expect(line).toHaveTextContent(LINE);
    expect(screen.getAllByTestId('app-version-line')).toHaveLength(1);
    const parent = line.parentElement as HTMLElement;
    expect(parent.className).not.toMatch(/\bgrid\b/);
    const grid = Array.from(parent.children).find((child) => /\bgrid-cols-1\b/.test(child.className));
    expect(grid).toBeDefined();
    expect(grid!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Admin: shown once, under the page content inside <main>', async () => {
    render(
      <AdminChrome adminName="Fixture Admin">
        <div data-testid="admin-page">page</div>
      </AdminChrome>
    );
    const line = await screen.findByTestId('app-version-line');
    expect(line).toHaveTextContent(LINE);
    expect(line.closest('main')).not.toBeNull();
    expect(screen.getByTestId('admin-page').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
