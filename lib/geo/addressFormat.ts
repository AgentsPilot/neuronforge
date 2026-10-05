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
 * DYNAMICALLY IMPORTED. `lib-address` carries the metadata for every country on
 * earth; putting it in the main bundle would charge every page load for data a
 * settings form needs once. Loaded on demand, the cost falls where it is used.
 *
 * Throws for nothing. An unregistered country code, a failed chunk, malformed
 * data — all resolve to `UNKNOWN`, which renders a plain address with no state
 * field. A missing field is a far smaller problem on a settings screen than an
 * exception that stops the owner saving their address at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function addressRulesFor(
  country: string | null | undefined
): Promise<CountryAddressRules> {
  if (!country || country.trim().length !== 2) return UNKNOWN;

  const code = country.trim().toUpperCase();

  try {
    const lib = await import('lib-address');

    if (!lib.isValidCountryCode(code)) return UNKNOWN;

    const data = lib.getCountryData(code) as {
      state_name_type?: string;
      zip_name_type?: string;
    };
    const fields = lib.getCountryFields(code) as Record<string, string | undefined>;

    const subdivisions = (lib.getCountrySubdivisions(code) ?? []) as Array<{
      value: string;
      label: string;
    }>;

    return {
      // `fields.state` is absent entirely for a country with no such concept —
      // Israel, the United Kingdom, Germany. That absence is the gate.
      adminLabel: fields.state ? data.state_name_type || 'province' : null,
      adminRequired: fields.state === 'required',
      postalLabel: data.zip_name_type || 'postal',
      hasPostalCode: Boolean(fields.zip),
      regions: subdivisions.map(s => ({ code: s.value, name: s.label })),
    };
  } catch {
    return UNKNOWN;
  }
}
