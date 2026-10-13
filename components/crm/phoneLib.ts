/**
 * Everything an owner-side phone field needs from `react-phone-number-input`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOADED ON DEMAND, NEVER IMPORTED STATICALLY (PERF-2)
 *
 * The phone library and its metadata are about 50 kB gzipped. On owner pages
 * the field only appears inside surfaces that open on click (the contact
 * modal, the contact drawer's details section, the booking modal), so this
 * module is fetched after the page has painted, through `usePhoneLib`
 * (`components/crm/usePhoneLib.ts`), rather than shipped with the page.
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

export { default as PhoneInput } from 'react-phone-number-input';
export { default as phoneCountryLabelsEn } from 'react-phone-number-input/locale/en';
export { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
export { applyCountryToPhone, phoneFieldCountry, phoneFieldValue } from '@/components/crm/phoneField';
