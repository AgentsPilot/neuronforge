/**
 * Which parts an address has, country by country — from Google's own metadata.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS USED TO BE A TABLE I WROTE, AND THAT WAS A MISTAKE.
 *
 * The question — does an address in this country carry a state, and what is it
 * called — has an authoritative answer: Google's libaddressinput metadata, the
 * same data Chrome and Android use to lay out an address form. I looked for a
 * package wrapping it by guessing five exact names, found none, and wrote a
 * 28-country table by hand instead.
 *
 * A real search finds several maintained wrappers. `lib-address` is one, and it
 * carries all 252 countries: 80 of them have a state field against the 28 I had
 * listed, and twelve distinct names for it against my eight — `island`,
 * `parish`, `oblast` and `do_si` were simply missing, and some of what I had
 * guessed was wrong.
 *
 * So nothing here is authored any more. Every answer below comes from the data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LABEL IS STILL A KEY, NOT A WORD.
 *
 * `state_name_type` gives 'state' | 'province' | 'prefecture' | 'county' | … —
 * an identifier, not a translation. The form renders in three languages, so the
 * interface translates it. Printing the raw value would put "prefecture" in
 * Latin script on a Hebrew form.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/geo/addressFormat
 */

export interface RegionOption {
  /** The subdivision code, which is what gets stored. */
  code: string;
  name: string;
}

import { ADDRESS_LABELS } from './adminLabels.generated';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'addressFormat' });

export interface CountryAddressRules {
  /** The noun for the administrative area, or null where the country has none. */
  adminLabel: string | null;
  /** True when an address here must carry one. */
  adminRequired: boolean;
  /** 'postal' | 'zip' | 'eircode' | 'pin' — the noun for the postcode. */
  postalLabel: string;
  /** True when a postcode is used here at all. */
  hasPostalCode: boolean;
  /** The real subdivisions, where the data has them. */
  regions: RegionOption[];
}

/** Nothing known about this country: show the plain fields, hide the rest. */
const UNKNOWN: CountryAddressRules = {
  adminLabel: null,
  adminRequired: false,
  postalLabel: 'postal',
  hasPostalCode: true,
  regions: [],
};

/**
 * Everything the form needs to lay itself out for a country.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT READS `lib-address/lite` AND NOT `lib-address`
 *
 * The full package ships two builds and its `exports` map chooses: `"import"`
 * registers all 253 countries, `"browser"` registers NONE and expects the app
 * to do it. Nothing did, so in a browser `getCountryData('US')` threw, this
 * returned `UNKNOWN`, and `adminLabel: null` did two things at once — the State
 * field never rendered on the settings forms, and `resolveSuggestion` DELETED
 * the state Google had returned, because the rule that strips an administrative
 * area for countries without one fired for every country.
 *
 * Registering per country in the browser does not work either: `./countries/*`
 * is exported but `./countries` is not, so a dynamic import cannot build its
 * context. And asking a route for it — which this did for one revision — makes
 * a form unable to draw a field until a round trip succeeds, which is a worse
 * failure than the one it replaced.
 *
 * `lib-address/lite` bundles every country for the browser in 52KB and carries
 * the SHAPE of an address: which fields exist, which are required, and the
 * subdivisions. The only thing it lacks is what each country CALLS its
 * administrative area, and those names are static — extracted once into
 * `adminLabels.generated.ts` by `scripts/generate-address-labels.ts`.
 *
 * So one code path answers on the server and in the browser, from data that is
 * always present. No entry-point conditions, no network, no empty registry.
 *
 * Throws for nothing. An unregistered country code or malformed data resolves
 * to `UNKNOWN`, which renders a plain address with no state field. A missing
 * field is a far smaller problem on a settings screen than an exception that
 * stops the owner saving their address at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function addressRulesFor(
  country: string | null | undefined
): Promise<CountryAddressRules> {
  if (!country || country.trim().length !== 2) return UNKNOWN;

  const code = country.trim().toUpperCase();

  try {
    const lib = await import('lib-address/lite');

    const fields = lib.getCountryFields(code) as Record<string, string | undefined> | null;
    if (!fields) return UNKNOWN;

    const data = lib.getCountryData(code) as {
      sub_regions?: Array<{ key: string; name: string }>;
    } | null;

    const names = ADDRESS_LABELS[code] ?? {};

    return {
      /*
       * `fields.state` is absent entirely for a country with no such concept —
       * Israel, the United Kingdom, Germany. That absence is the gate, and the
       * name is only ever a label for a field this has already allowed.
       *
       * `'province'` is the fallback for a country that has the field and whose
       * name we do not carry: a generic word beats no field at all.
       */
      adminLabel: fields.state ? names.admin || 'province' : null,
      adminRequired: fields.state === 'required',
      postalLabel: names.postal || 'postal',
      hasPostalCode: Boolean(fields.zip),
      regions: (data?.sub_regions ?? []).map(region => ({
        code: region.key,
        name: region.name,
      })),
    };
  } catch (err) {
    /*
     * SAY SO. This used to be a bare `catch { return UNKNOWN; }`.
     *
     * UNKNOWN means `adminLabel: null`, and every caller reads that as "this
     * country has no state" — `AdminAreaField` renders nothing, and
     * `resolveSuggestion` DELETES the state off an address it is saving. So a
     * single failure here does not degrade: it silently removes a field from
     * the form and a line from the stored address, for every country at once,
     * and looks exactly like the correct behaviour for Israel.
     *
     * That is precisely the shape of the bug this module's header records
     * ("`lib-address`'s browser build registers no countries, so `adminLabel`
     * was null for every country on earth") — and it was invisible because
     * nothing was ever logged. Whatever goes wrong next should leave a trace.
     *
     * Still returns UNKNOWN: a form that cannot read its metadata must not
     * crash. The difference is that it now says why.
     */
    logger.error({ err, country: code }, 'Could not read address rules; treating the country as having no state');
    return UNKNOWN;
  }
}
