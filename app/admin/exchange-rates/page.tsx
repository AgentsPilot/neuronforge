'use client';

// Exchange rates admin page (Admin Exchange Rates slice 1a). A maintained,
// manual admin tool again: BD-55 (2026-10-19) amends BD-34 / BD-36 for this page
// only. No figure on the platform is converted with these rates (D-5, BD-12).
// Reached by typing its URL only, never linked (D-6; G-2, G-4 and the sidebar
// UNLISTED entry pin that). The admin layout gates it (`requireAdminPage`);
// every read and write goes through /api/admin/exchange-rates. A client
// component, like every render entry point under app/admin (authz guard R8).

import { ExchangeRatesView } from './components/ExchangeRatesView';

export default function ExchangeRatesPage() {
  return <ExchangeRatesView />;
}
