/**
 * Address autocomplete, on Google's CURRENT Places API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT THE WIDGET EVERY TUTORIAL SHOWS.
 *
 * `google.maps.places.Autocomplete` and `AutocompleteService` were deprecated on
 * 1 March 2025 and are closed to new projects. Code written against them looks
 * right, loads, and then returns nothing on a key issued since. This uses
 * `AutocompleteSuggestion`, which is the replacement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SESSION TOKENS ARE NOT OPTIONAL.
 *
 * Google bills autocomplete per SESSION: every keystroke that shares a token,
 * plus the one details lookup at the end, counts once. Without a token each
 * keystroke is billed as its own session — typing an address becomes twenty
 * charges instead of one. The token is minted when typing starts and discarded
 * the moment a place is chosen; reusing it afterwards would be billed again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSENT KEY IS A SUPPORTED STATE.
 *
 * `isPlacesConfigured()` is false until somebody sets the key, and every surface
 * is expected to check it and fall back to the manual fields. The address form
 * worked before this existed and has to keep working: autocomplete is a
 * convenience on top, never the only way to enter an address.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/geo/placesAutocomplete
 */

import type { StructuredAddress } from './address';

/**
 * The browser-side key.
 *
 * `NEXT_PUBLIC_` because the Maps JS API runs in the page — it is visible to
 * anyone who opens devtools, which is normal and expected for this API. The
 * protection is an HTTP-referrer restriction on the key in Google Cloud, NOT
 * secrecy. An unrestricted key on a public page is somebody else's Maps bill.
 */
const PLACES_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** Whether autocomplete can run at all. False is normal and handled. */
export function isPlacesConfigured(): boolean {
  return PLACES_KEY.trim().length > 0;
}

export interface AddressSuggestion {
  /** Opaque — hand it straight back to `resolveSuggestion`. */
  id: string;
  /** The line a human reads in the list. */
  text: string;
}

interface PlacesLibrary {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{
      suggestions: Array<{
        placePrediction?: {
          placeId: string;
          text?: { toString(): string };
          toPlace(): PlaceHandle;
        };
      }>;
    }>;
  };
  AutocompleteSessionToken: new () => object;
  /** Details by place id — the correct way to resolve a chosen suggestion. */
  Place: new (options: { id: string }) => PlaceHandle;
}

interface PlaceHandle {
  fetchFields(request: { fields: string[]; sessionToken?: object }): Promise<unknown>;
  addressComponents?: Array<{
    longText?: string | null;
    shortText?: string | null;
    types: string[];
  }>;
}

let loader: Promise<PlacesLibrary> | null = null;

/** Where the loader hands control back. Global because Google calls it by name. */
const READY_CALLBACK = '__agentpilotPlacesReady';

/**
 * Load the Maps JS API once, however many fields ask for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO LOADING PATHS, AND THE LIBRARY LIVES IN A DIFFERENT PLACE IN EACH.
 *
 * Google has a bootstrap loader that defines `google.maps.importLibrary`, and a
 * classic one — what `?libraries=places` gives you — that attaches the library
 * straight to `google.maps.places` and never defines `importLibrary` at all.
 *
 * The first version of this called `importLibrary` unconditionally and threw
 * `window.google.maps.importLibrary is not a function` the moment the script
 * landed, because asking for `libraries=places` had selected the other path.
 * So both are handled, `importLibrary` first where it exists.
 *
 * `callback` is required whenever `loading=async` is set; without it Google
 * warns in the console and the ready moment is left to `onload`, which can fire
 * before the library is attached.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function loadPlaces(language: string): Promise<PlacesLibrary> {
  if (loader) return loader;

  loader = new Promise<PlacesLibrary>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Places is browser-only'));
      return;
    }

    const w = window as unknown as Record<string, unknown> & {
      google?: {
        maps?: {
          importLibrary?: (name: string) => Promise<unknown>;
          places?: unknown;
        };
      };
    };

    /** Whichever path loaded, find the places library or say it is not there. */
    const resolveLibrary = () => {
      const maps = w.google?.maps;
      if (!maps) {
        loader = null;
        reject(new Error('Maps did not load'));
        return;
      }

      if (typeof maps.importLibrary === 'function') {
        maps
          .importLibrary('places')
          .then(lib => resolve(lib as PlacesLibrary))
          .catch(err => {
            loader = null;
            reject(err);
          });
        return;
      }

      // Classic path: `libraries=places` put it here and defined no importLibrary.
      if (maps.places) {
        resolve(maps.places as PlacesLibrary);
        return;
      }

      loader = null;
      reject(new Error('Places library unavailable'));
    };

    // Already on the page — another field loaded it first.
    if (w.google?.maps) {
      resolveLibrary();
      return;
    }

    w[READY_CALLBACK] = resolveLibrary;

    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(PLACES_KEY)}` +
      '&libraries=places' +
      '&v=weekly' +
      '&loading=async' +
      `&language=${encodeURIComponent(language)}` +
      `&callback=${READY_CALLBACK}`;
    script.async = true;
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      loader = null;
      reject(new Error('Places failed to load'));
    };
    document.head.appendChild(script);
  });

  return loader;
}

/** One billing session: minted on first keystroke, dropped once a place is taken. */
let sessionToken: object | null = null;

/**
 * Suggestions for what has been typed so far.
 *
 * Returns an empty list for anything too short to be worth a billed request, and
 * for every failure. A dead network must leave the owner typing into the manual
 * fields, not staring at an error on a settings page.
 */
export async function fetchAddressSuggestions(
  input: string,
  options: { language?: string; country?: string | null } = {}
): Promise<AddressSuggestion[]> {
  const query = input.trim();
  if (!isPlacesConfigured() || query.length < 3) return [];

  try {
    const places = await loadPlaces(options.language || 'en');

    if (!sessionToken) sessionToken = new places.AutocompleteSessionToken();

    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      sessionToken,
      language: options.language || 'en',
      /*
       * Biased to the country already chosen, when there is one. A business in
       * Israel typing "Herzl" wants a street in Israel, not one in Buenos Aires
       * — and the bias is a hint, so an owner entering a foreign address still
       * finds it.
       */
      ...(options.country ? { includedRegionCodes: [options.country] } : {}),
    });

    return suggestions
      .map(s => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map(p => ({ id: p.placeId, text: p.text?.toString() ?? '' }))
      .filter(s => s.text.length > 0);
  } catch {
    return [];
  }
}

/** Google's component types, mapped to the fields this platform stores. */
export function addressFromComponents(
  components: Array<{ longText?: string | null; shortText?: string | null; types: string[] }>
): StructuredAddress {
  const find = (type: string) => components.find(c => c.types.includes(type));

  const streetNumber = find('street_number')?.longText ?? '';
  const route = find('route')?.longText ?? '';

  /*
   * `locality` is the city almost everywhere. `postal_town` is the exception
   * that matters — in the UK, Google returns the town there and leaves locality
   * empty, so a London address would otherwise arrive with no city at all.
   */
  const city =
    find('locality')?.longText ??
    find('postal_town')?.longText ??
    find('administrative_area_level_2')?.longText ??
    '';

  return {
    // "12 Herzl St" — number first, which is how most of the world writes it and
    // how Google orders the components regardless of local convention.
    line1: [streetNumber, route].filter(Boolean).join(' ').trim(),
    line2: find('subpremise')?.longText ?? '',
    city,
    /*
     * SHORT text for the state: Google returns "CA" alongside "California", and
     * short is what `lib-address` lists as the subdivision code — so the value
     * lands already matching an option in the state dropdown.
     */
    state: find('administrative_area_level_1')?.shortText ?? '',
    postal_code: find('postal_code')?.longText ?? '',
    // Also short: the ISO-3166 alpha-2 code this platform stores for a country.
    country: find('country')?.shortText ?? '',
  };
}

/**
 * Turn a chosen suggestion into a filled-in address.
 *
 * This is the billed "details" call, and it closes the session — the token is
 * dropped straight after so the next address typed starts a new one.
 */
export async function resolveSuggestion(
  suggestionId: string,
  language = 'en'
): Promise<StructuredAddress | null> {
  if (!isPlacesConfigured()) return null;

  try {
    const places = await loadPlaces(language);

    /*
     * BY ID, not by searching for the id.
     *
     * This re-ran autocomplete with the place id as the query text, which
     * matches nothing — picking a suggestion would have filled in the wrong
     * address or none at all. `new Place({ id })` is what the id is for.
     *
     * The session token rides along on `fetchFields`: it is what ties this
     * billed details call to the keystrokes that led to it, so the pair counts
     * as one session instead of two charges.
     */
    const place = new places.Place({ id: suggestionId });
    await place.fetchFields({
      fields: ['addressComponents'],
      ...(sessionToken ? { sessionToken } : {}),
    });

    if (!place.addressComponents) return null;

    const address = addressFromComponents(place.addressComponents);

    /*
     * DROP THE ADMINISTRATIVE AREA WHERE THE COUNTRY HAS NONE.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Google returns `administrative_area_level_1` for almost every address,
     * whether or not that country writes it down. A Tel Aviv address comes back
     * with "מחוז תל אביב" — a real district, which no Israeli address includes.
     *
     * Kept, it would be invisible AND printed: the state field does not render
     * for Israel, so nobody could see or clear it, while `formatAddressLines`
     * would put it on the invoice and the public page. An address silently
     * gaining a line its country does not use is worse than one missing a field.
     *
     * Checked against the same metadata the form uses to decide whether to show
     * the field at all, so the two can never disagree.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (address.state) {
      const { addressRulesFor } = await import('./addressFormat');
      const rules = await addressRulesFor(address.country);
      if (!rules.adminLabel) address.state = '';
    }

    return address;
  } catch {
    return null;
  } finally {
    // The session ends with the details call, billed or not. Holding the token
    // would fold the next address the owner types into a session already paid.
    sessionToken = null;
  }
}
