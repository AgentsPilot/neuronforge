/**
 * The address a customer writes to when they want their business erased, or
 * when their data is too large for the on-screen "Download my data".
 *
 * `support@agentspilot.ai` is the official AgentPilot support mailbox, set by
 * the user on 2026-10-26. It replaced the product owner's personal Gmail, which
 * had been an interim unblock (the TEMP-ERASURE-CONTACT marker, open item N2 in
 * docs/workplans/business-os-business-data-purge.md, is now closed).
 *
 * It is rendered to every customer: the Danger zone's "Contact us" on all three
 * settings surfaces (`/business-os/settings`, `/v2/settings`, `/settings`), the
 * "too large, contact support" message of "Download my data", and the delete
 * drawer and its confirmation email. Changing it is a product decision, not a
 * config tidy.
 *
 * Defined here and ONLY here: the single swap point (data export DE-9, BC-3,
 * SA C-3). The name is kept so the importers and pins need no change. Pure: no
 * imports, safe in any bundle. The pin is
 * `components/business-os/purge/__tests__/DangerZonePanel.test.ts`.
 */
export const PLACEHOLDER_ERASURE_CONTACT = 'support@agentspilot.ai';
