'use client';

/**
 * Pick the account the audit trail is filtered to, by business name.
 *
 * WHY THIS EXISTS: `app/api/admin/audit-trail/route.ts` applies
 * `.eq('user_id', accountId)` at the DATABASE level, so the account filter is
 * complete — but the page could only ever CLEAR it. The only way to SET it was
 * to arrive with a GUID in the URL, which means an operator who wants
 * "everything Acme Dental did" needed the UUID first. This closes that.
 *
 * NOT the free-text Search box, deliberately: that one filters a window of rows
 * in memory (route.ts:144-173), so a business name typed there would return
 * partial results that look complete. This sets `user_id`, which the route turns
 * into a predicate.
 *
 * ── The list comes from an EXISTING endpoint ────────────────────────────────
 * `GET /api/admin/business-os/llm-usage/businesses` already returns exactly
 * `{ userId, companyName }`, admin-gated through AdminAccessService, backed by
 * `businessProfileRepository.searchForAdmin`, and logs neither the search text
 * nor the names. Reused over HTTP rather than reimplemented, because a sibling
 * route would call the same repository method and get the same rows: the 50-row
 * limit is `BUSINESS_SEARCH_MAX_LIMIT` inside the repository, which clamps
 * whatever limit a caller passes, so a new endpoint could not return more.
 *
 * What is NOT done is IMPORT from `lib/business-os/**`: a fetch is an HTTP
 * contract, an import is module coupling, and the audit surface depending on
 * `lib/business-os/usage` was rejected in review. The three fields this screen
 * reads are therefore re-declared below instead of importing
 * `BusinessListResponse`, and a static guard
 * (`__tests__/businessPicker.contract.test.ts`) keeps both halves honest: no
 * such import, and the route still exists and still maps these field names.
 *
 * The response also carries `platformAccountIds`. It is ignored here on purpose:
 * the LLM usage tab warns before one is selected because platform rows are
 * checked differently there, whereas the platform account has ordinary audit
 * rows and filtering to them is a legitimate thing for an operator to do.
 *
 * ── Privacy (AC-B13) ───────────────────────────────────────────────────────
 * A business name never reaches a log line, and neither does the search text —
 * a search IS usually a business name. The only log here is a fetch failure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AdminAuditBusinessPicker' });

/** The reused endpoint. Asserted to exist by the contract guard. */
export const BUSINESS_SEARCH_PATH = '/api/admin/business-os/llm-usage/businesses';

/** The server's own `SEARCH_MAX_CHARS`; typing past it would only earn a 400. */
const SEARCH_MAX_CHARS = 100;

const SEARCH_DEBOUNCE_MS = 300;

/** A full account id, so a pasted one can be offered as a choice. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only the fields this screen reads, re-declared rather than imported from
 * `lib/business-os/usage/llmUsageReportTypes` (see the header).
 */
interface BusinessOption {
  userId: string;
  companyName: string | null;
}

/** A row in the dropdown: a business, or the "use this pasted id" affordance. */
type PickerOption = (BusinessOption & { kind: 'business' }) | { kind: 'pasted'; userId: string };

interface BusinessAccountPickerProps {
  /** '' when every account is shown. Only used to mark the current row. */
  selectedAccountId: string;
  onSelect: (accountId: string) => void;
}

/**
 * Read the response defensively. This is JSON from another surface's route, not
 * a compile-time value, so a shape change must degrade to "no businesses" rather
 * than throw inside a render.
 */
function readBusinesses(payload: unknown): { businesses: BusinessOption[]; limit: number | null } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON boundary; every field is checked below
  const data = (payload as any)?.data;
  const rows = Array.isArray(data?.businesses) ? data.businesses : [];
  const businesses = rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    .filter((row: any) => typeof row?.userId === 'string' && row.userId.length > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    .map((row: any) => ({
      userId: row.userId as string,
      companyName: typeof row.companyName === 'string' && row.companyName.trim() ? row.companyName : null,
    }));
  return { businesses, limit: typeof data?.limit === 'number' ? data.limit : null };
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export function BusinessAccountPicker({ selectedAccountId, onSelect }: BusinessAccountPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = query.trim();
  const pastedId = UUID_PATTERN.test(term) ? term.toLowerCase() : null;

  const load = useCallback(async (search: string, signal: AbortSignal) => {
    setLoading(true);
    try {
      const qs = search ? `?${new URLSearchParams({ search }).toString()}` : '';
      const response = await fetch(`${BUSINESS_SEARCH_PATH}${qs}`, {
        method: 'GET',
        // Same as the endpoint's other caller: the route uses this id for its
        // own log line, so a server log can be tied back to one click. Guarded
        // because `crypto.randomUUID` is not present in every test environment,
        // and the route falls back to generating its own.
        headers: typeof crypto?.randomUUID === 'function' ? { 'x-correlation-id': crypto.randomUUID() } : {},
        signal,
      });
      const payload = await response.json();

      if (!response.ok || payload?.success !== true) {
        setBusinesses([]);
        // The route's own message is a fixed string (never the input), so it is
        // safe to show; it is the only way an operator learns about a 403.
        setError(typeof payload?.error === 'string' ? payload.error : 'Could not load businesses');
        return;
      }

      const { businesses: rows, limit: cap } = readBusinesses(payload);
      setBusinesses(rows);
      setLimit(cap);
      setError(null);
      setHighlight(0);
    } catch (err) {
      if (signal.aborted) return;
      setBusinesses([]);
      setError('Could not load businesses');
      // No search text and no names: a search is usually a business name (AC-B13).
      logger.error({ err }, 'Business list for the audit account filter failed');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  // Only once the field is in use: an admin who never opens the picker should
  // not cost a business-profiles read on every audit-trail page view.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void load(term, controller.signal), term ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term, load]);

  const options = useMemo<PickerOption[]>(() => {
    const rows: PickerOption[] = businesses.map((business) => ({ ...business, kind: 'business' as const }));
    // A pasted id first: it is an exact instruction, not a guess.
    return pastedId ? [{ kind: 'pasted', userId: pastedId }, ...rows] : rows;
  }, [businesses, pastedId]);

  const choose = (accountId: string) => {
    onSelect(accountId);
    // The chip above the filters (which names the account once rows load) is the
    // single indicator of what is active, so the box goes back to being a search
    // box rather than echoing the choice in a second place.
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      setHighlight((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + options.length) % options.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      const option = options[highlight];
      if (option) {
        event.preventDefault();
        choose(option.userId);
      }
    }
  };

  const truncated = limit !== null && businesses.length >= limit;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // Closing on blur, but not when focus merely moved inside the picker.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="audit-business-picker" className="block text-sm font-medium text-slate-300 mb-2">
        Account
      </label>
      <div className="relative">
        <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          id="audit-business-picker"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="audit-business-options"
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={SEARCH_MAX_CHARS}
          data-testid="business-picker-input"
          placeholder="Filter by business name…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Said out loud rather than left to be discovered: the list is
          `business_profiles`, so an account with no profile row — every
          agent-platform account — cannot be found by name here, however long the
          operator types. Pasting its id is the way in, and the deep link the
          Businesses panel uses still works unchanged. */}
      <p className="mt-2 text-xs text-slate-500" data-testid="business-picker-hint">
        Only accounts with a business profile can be found by name. Paste a full account id to filter by any other
        account.
      </p>

      {open && (
        <div
          id="audit-business-options"
          role="listbox"
          aria-label="Businesses"
          data-testid="business-picker-options"
          className="absolute z-20 left-0 right-0 top-[4.6rem] max-h-64 overflow-auto bg-slate-900 border border-slate-600 rounded-lg shadow-xl"
        >
          {error && (
            <p role="alert" className="px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {!error && loading && options.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-400">Loading…</p>
          )}

          {!error && !loading && options.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-400" data-testid="business-picker-empty">
              No business matches that name.
            </p>
          )}

          {options.map((option, index) => {
            const selected = option.userId === selectedAccountId;
            const highlighted = index === highlight;
            return (
              <button
                key={`${option.kind}-${option.userId}`}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={option.kind === 'pasted' ? 'business-picker-pasted' : 'business-picker-option'}
                // preventDefault keeps focus in the input, so the container's
                // onBlur cannot close the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option.userId)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  highlighted ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800'
                } ${selected ? 'font-semibold' : ''}`}
              >
                {option.kind === 'pasted' ? (
                  <span className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-slate-400" />
                    Use this account id
                    <span className="text-slate-400 font-mono text-xs">{shortId(option.userId)}</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-between gap-2">
                    {/* A business that has not named itself is shown as unnamed
                        and stays selectable: `company_name` is nullable, and
                        printing the id in the name's place would be the same
                        mistake the account chip was just fixed for. */}
                    <span className={`truncate ${option.companyName ? '' : 'italic text-slate-400'}`}>
                      {option.companyName ?? 'Unnamed business'}
                    </span>
                    <span className="text-slate-500 font-mono text-xs shrink-0" title={option.userId}>
                      {shortId(option.userId)}
                    </span>
                  </span>
                )}
              </button>
            );
          })}

          {truncated && (
            <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-700" data-testid="business-picker-truncated">
              First {limit} matches only — type more of the name to narrow it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
