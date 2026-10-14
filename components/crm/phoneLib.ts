/**
 * Everything a phone field needs from `react-phone-number-input`: the owner
 * side's fields and the public website contact form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOADED ON DEMAND, NEVER IMPORTED STATICALLY (PERF-2, BR-2)
 *
 * The phone library and its metadata are about 50 kB gzipped. On owner pages
 * the field only appears inside surfaces that open on click (the contact
 * modal, the contact drawer's details section, the booking modal), so this
 * module is fetched after the page has painted, through `usePhoneLib`
 * (`components/crm/usePhoneLib.ts`), rather than shipped with the page.
 *
 * The public contact-form block (`components/website/blocks/ContactFormBlock`)
 * reads it the same way (BR-2): the page paints without the library and the
 * phone row shows `PublicPhoneFieldPlaceholder` until it arrives. That is why
 * this owner-side folder also re-exports `isValidPhoneNumber` and the website's
 * `WebsiteCountrySelect`: ONE module holder and ONE download for both sides,
 * not a second public barrel that a page rendering both would fetch twice. The
 * `components/crm → components/website` import direction is deliberate (SA,
 * BR-2 workplan review).
 *
 * Import it ONLY through `usePhoneLib` / `loadPhoneLib`. A single static
 * `import … from '@/components/crm/phoneLib'` puts the whole library back into
 * that page's first download; `components/crm/__tests__/phoneLibLazy.guard.test.ts`
 * fails if one appears.
 *
 * The CSS (`react-phone-number-input/style.css`) is deliberately NOT here. It
 * stays a static import in each component, so the stylesheet keeps its place
 * in the cascade and the field looks exactly as before. CSS is not First Load
 * JS, so it costs this slice nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export { default as PhoneInput, isValidPhoneNumber } from 'react-phone-number-input';
export { default as phoneCountryLabelsEn } from 'react-phone-number-input/locale/en';
export { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
export { applyCountryToPhone, phoneFieldCountry, phoneFieldValue } from '@/components/crm/phoneField';
export { WebsiteCountrySelect } from '@/components/website/blocks/WebsiteCountrySelect';
