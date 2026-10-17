/**
 * The address a customer writes to when they want their business erased, or
 * when their data is too large for the on-screen "Download my data".
 *
 * ⚠️ **TEMP-ERASURE-CONTACT — this is a personal address, used as an interim
 * unblock. It must be replaced with a real support mailbox.**
 *
 * `meiribarak@gmail.com` is the product owner's own email. It is here because
 * no support account exists yet and the alternative was shipping a Danger Zone
 * whose only action pointed nowhere. **Barak owns the swap**, before or shortly
 * after launch.
 *
 * Three things make this worth replacing rather than forgetting:
 *
 *   1. **It is rendered to every customer**, on all three settings surfaces
 *      (`/business-os/settings`, `/v2/settings`, `/settings`): the Danger zone's
 *      "Contact us" and, since data export DE-9, the "too large, contact
 *      support" message of "Download my data". This is not an internal config
 *      value — it is customer-visible copy, so swapping it is a product
 *      decision rather than a config tidy.
 *   2. **It is a personal inbox.** Erasure requests are a compliance channel;
 *      routing them to one person's Gmail means they are unmonitored whenever
 *      that person is not reading it, and there is no record that they arrived.
 *   3. **It replaced a deliberately fake address.** The previous placeholder was
 *      `TODO-ERASURE-CONTACT@example.invalid`, chosen so it could never ship
 *      unnoticed. A real, plausible address loses that property — which is
 *      exactly why the marker below exists.
 *
 * **To find it: `grep -rn "TEMP-ERASURE-CONTACT"`.** The marker lives in this
 * comment rather than inside the address, so the address stays valid while the
 * reminder stays greppable. Tracked as an open item (N2) in
 * docs/workplans/business-os-business-data-purge.md.
 *
 * Defined here and ONLY here: the single swap point (data export DE-9, BC-3,
 * SA C-3). It moved out of `components/business-os/purge/DangerZonePanel.tsx`
 * unchanged, so the Danger zone and the "Download my data" control both read
 * it without one importing the other. Pure: no imports, safe in any bundle.
 * The pin is `components/business-os/purge/__tests__/DangerZonePanel.test.ts`.
 */
export const PLACEHOLDER_ERASURE_CONTACT = 'meiribarak@gmail.com';
