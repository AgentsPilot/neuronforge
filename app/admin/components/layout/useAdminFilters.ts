/**
 * The admin URL filter state hook (Admin Layout Standard C-7, §5.6 U-1 to U-10).
 *
 * The address bar is a projection of the filter state: the first state is
 * parsed synchronously from the URL (so a page's first read already sees an
 * inbound link's filters, with no extra render and no extra request), and every
 * later change is written back by `window.history.replaceState(null, '', url)`.
 * Never `pushState` (no Back entries) and never `router.replace`.
 *
 * Why `null` as the first argument (SA M-1): Next 14.2 patches `replaceState`.
 * With a state that already carries Next's own keys it takes its "internal
 * call" branch and never syncs `useSearchParams`; with `null` it copies its keys
 * onto the entry itself and syncs `useSearchParams` to the URL written here (the
 * documented native-History usage). That echo must not be re-parsed, and an
 * outside change (a sidebar link, Back) must be. One `lastKnown` string decides:
 * it is set from the first `useSearchParams` string, just before each write, and
 * on each re-read, and the URL is re-parsed only when the incoming string
 * differs from it.
 *
 * `active` (L-9a, F-113: two tabs on one page that own the same keys). Default
 * `true`, which is exactly the behaviour above. A page that keeps a hidden tab
 * mounted passes `active: false` for it, and that tab's hook then neither
 * re-reads nor writes: the address bar describes the visible tab only, and the
 * page owns the keys while the tab is hidden. An inactive MOUNT takes the
 * defaults without parsing (a tab mounted by a click renders once with the
 * previous tab's `useSearchParams` string, because Next delivers the page's
 * own write in a later transition render). On becoming active the incoming
 * string is adopted as `lastKnown` WITHOUT parsing (the tab's own state wins;
 * the page has just written it), and the projection is written once only if
 * the address bar lacks it. Becoming inactive does nothing.
 *
 * This is the only file in the shared folder allowed to write history (S-6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export interface AdminFilterField<V> {
  /** Canonical URL keys this field owns (U-5). */
  keys: readonly string[];
  /** Legacy key → canonical key. Read forever, never written (U-9). The canonical key wins when both are present. */
  aliases?: Readonly<Record<string, string>>;
  defaultValue: V;
  /** `get` returns a canonical key's non-empty value after aliasing, or null. Undefined = absent or invalid → default (U-4). */
  parse: (get: (key: string) => string | null) => V | undefined;
  /** Canonical keys → values. Never called for the default (U-3) or for a page-only field. */
  serialise: (value: V) => Readonly<Record<string, string>>;
  /** SA-R-8 / D-6: held in state, read from an inbound link, never written. */
  pageOnly?: boolean;
  /** Default: Object.is. */
  equals?: (a: V, b: V) => boolean;
}

export type AdminFilterSpec<S> = { readonly [K in keyof S]: AdminFilterField<S[K]> };

export interface AdminFilters<S> {
  /** Identity-stable: a new object only when a value changed. */
  filters: S;
  /** Applies at once; the URL is then written by replace. */
  setFilters: (patch: Partial<S>) => void;
  /** Every field to its default, page-only included. */
  clear: () => void;
  /** Every field at its default (drives Clear's disabled state). */
  isDefault: boolean;
  /**
   * The search string the URL WOULD have after `setFilters(patch)`: '' or
   * '?a=b' (L-2a, the same-page filter tile's real link). The same projection
   * as the write (U-3 defaults omitted, aliases dropped, unrelated keys such as
   * `tab` kept). No pathname: the page prepends its own, so the hook needs no
   * `usePathname`. Writes nothing and changes no state.
   */
  hrefFor: (patch: Partial<S>) => string;
}

/** Search-params shape this hook reads: Next's ReadonlyURLSearchParams or a plain URLSearchParams. */
interface ParamsLike {
  get: (key: string) => string | null;
}

function fieldsOf<S>(spec: AdminFilterSpec<S>): Array<[keyof S, AdminFilterField<S[keyof S]>]> {
  return (Object.keys(spec) as Array<keyof S>).map((key) => [key, spec[key] as AdminFilterField<S[keyof S]>]);
}

function equalsFor<V>(field: AdminFilterField<V>): (a: V, b: V) => boolean {
  return field.equals ?? Object.is;
}

/** U-9: the canonical key's non-empty value, else the first non-empty alias mapped to it. */
function getterFor<V>(field: AdminFilterField<V>, params: ParamsLike): (key: string) => string | null {
  return (key) => {
    const canonical = params.get(key);
    if (canonical) return canonical;
    for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
      if (target !== key) continue;
      const value = params.get(legacy);
      if (value) return value;
    }
    return null;
  };
}

function defaultsOf<S>(spec: AdminFilterSpec<S>): S {
  const out = {} as S;
  for (const [key, field] of fieldsOf(spec)) out[key] = field.defaultValue;
  return out;
}

function parseAll<S>(spec: AdminFilterSpec<S>, params: ParamsLike | null): S {
  const out = defaultsOf(spec);
  if (!params) return out;
  for (const [key, field] of fieldsOf(spec)) {
    const parsed = field.parse(getterFor(field, params));
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

/** `next`, but keeping `prev` (and each of its values) wherever nothing changed, so identity holds. */
function mergeKeepingIdentity<S>(spec: AdminFilterSpec<S>, prev: S, next: Partial<S>): S {
  let changed = false;
  const merged = { ...prev };
  for (const [key, field] of fieldsOf(spec)) {
    if (!(key in next)) continue;
    const value = next[key] as S[keyof S];
    if (!equalsFor(field)(prev[key], value)) {
      merged[key] = value;
      changed = true;
    }
  }
  return changed ? merged : prev;
}

/**
 * The search string the state projects onto `current`: every key and alias the
 * spec owns is removed, everything else keeps its order (e.g. `tab`), then each
 * non-default, non-page-only field is appended in spec order.
 */
function projectSearch<S>(spec: AdminFilterSpec<S>, filters: S, current: string): string {
  const params = new URLSearchParams(current);
  for (const [, field] of fieldsOf(spec)) {
    for (const key of field.keys) params.delete(key);
    for (const legacy of Object.keys(field.aliases ?? {})) params.delete(legacy);
  }
  for (const [key, field] of fieldsOf(spec)) {
    if (field.pageOnly) continue;
    if (equalsFor(field)(filters[key], field.defaultValue)) continue;
    for (const [name, value] of Object.entries(field.serialise(filters[key]))) params.append(name, value);
  }
  return params.toString();
}

/**
 * `spec` must be a module-level constant: the hook relies on its identity being
 * stable, and an inline spec would re-run `setFilters` and both effects on every render.
 */
export function useAdminFilters<S extends object>(
  spec: AdminFilterSpec<S>,
  /** L-9a (F-113): `active` false while the page shows another tab owning the same keys. Default true. */
  options?: { active?: boolean },
): AdminFilters<S> {
  // Read once as a primitive (SA S-2): an inline `{ active }` is a new object
  // every render, so only the boolean may sit in effect dependencies.
  const active = options?.active ?? true;
  // Null outside the App Router (e.g. a unit test): every field takes its default and nothing is written.
  const searchParams = useSearchParams();
  const incoming = searchParams ? searchParams.toString() : null;

  // An inactive mount does not parse: its string may be the previous tab's (see the header).
  const [filters, setState] = useState<S>(() => (active ? parseAll(spec, searchParams) : defaultsOf(spec)));
  const lastKnown = useRef<string | null>(incoming);
  // Counts outside changes; see the write effect's dependencies (QA E-1).
  const [rereads, setRereads] = useState(0);
  // The previous `active`, so the re-read effect can tell the false-to-true edge.
  const wasActive = useRef(active);

  // Re-read only on an outside change (SA M-1): our own write was recorded in
  // lastKnown just before it happened, so its echo is skipped. Every field is
  // re-parsed, page-only included, so opening a URL reproduces its view.
  // Declared BEFORE the write effect (SA S-2): on activation the incoming
  // string is adopted here first, then the write effect runs in the same commit.
  useEffect(() => {
    const activated = active && !wasActive.current;
    wasActive.current = active;
    // Inactive: the string is neither parsed nor recorded (the page owns the keys).
    if (!active) return;
    if (activated) {
      // Adopt without parsing: the tab's own state wins over what it sees now.
      lastKnown.current = incoming;
      return;
    }
    if (incoming === null || incoming === lastKnown.current) return;
    lastKnown.current = incoming;
    const next = parseAll(spec, new URLSearchParams(incoming));
    setState((prev) => mergeKeepingIdentity(spec, prev, next));
    setRereads((n) => n + 1);
  }, [incoming, spec, active]);

  // Write the projection (U-2). One path covers the mount rewrite of aliases,
  // the clean-up of invalid values and page-only keys, and every later change.
  // `active` is a dependency so the activation edge writes once when needed.
  const hasRouter = searchParams !== null;
  useEffect(() => {
    if (!hasRouter || !active) return;
    const { pathname, search, hash } = window.location;
    const nextSearch = projectSearch(spec, filters, search);
    const url = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`;
    if (url === `${pathname}${search}${hash}`) return;
    lastKnown.current = nextSearch;
    window.history.replaceState(null, '', url);
    // `rereads` is read nowhere in the body, and it is NOT unused (QA E-1). An
    // outside change that parses to the current state (junk such as
    // `severity=catastrophic`, or `user_id=X` while `account=X` is applied)
    // keeps `filters` identical, so without this dependency the projection
    // would never run again and the address bar would keep the junk or the
    // alias. The re-read effect bumps it in the same batch as its `setState`,
    // so an outside change that DOES alter the state still runs this effect
    // once, and the mount and Next's echo of our own write never bump it.
  }, [filters, spec, hasRouter, rereads, active]);

  const setFilters = useCallback(
    (patch: Partial<S>) => setState((prev) => mergeKeepingIdentity(spec, prev, patch)),
    [spec],
  );

  const clear = useCallback(() => setState((prev) => mergeKeepingIdentity(spec, prev, defaultsOf(spec))), [spec]);

  const isDefault = useMemo(
    () => fieldsOf(spec).every(([key, field]) => equalsFor(field)(filters[key], field.defaultValue)),
    [filters, spec],
  );

  // From the state and the `useSearchParams` string, never `window.location`,
  // so the server render and the client render agree (no hydration mismatch).
  const hrefFor = useCallback(
    (patch: Partial<S>) => {
      const search = projectSearch(spec, mergeKeepingIdentity(spec, filters, patch), incoming ?? '');
      return search ? `?${search}` : '';
    },
    [filters, incoming, spec],
  );

  return { filters, setFilters, clear, isDefault, hrefFor };
}

/** One string param: empty means absent; `isValid` false means ignored (U-4). */
export function textFilter(options: {
  key: string;
  defaultValue: string;
  aliases?: readonly string[];
  isValid?: (raw: string) => boolean;
  pageOnly?: boolean;
}): AdminFilterField<string> {
  const { key, defaultValue, isValid, pageOnly } = options;
  const aliases: Record<string, string> = {};
  for (const legacy of options.aliases ?? []) aliases[legacy] = key;
  return {
    keys: [key],
    aliases,
    defaultValue,
    pageOnly,
    parse: (get) => {
      const raw = get(key);
      if (raw === null) return undefined;
      if (isValid && !isValid(raw)) return undefined;
      return raw;
    },
    serialise: (value) => (value === '' ? {} : { [key]: value }),
  };
}
