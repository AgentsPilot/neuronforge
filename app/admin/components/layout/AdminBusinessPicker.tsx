'use client';

/**
 * The filter bar's business picker (Admin Layout Standard C-6, §5.5 parts 3
 * and 7), generalised by L-1e from `app/admin/audit-trail/BusinessAccountPicker.tsx`.
 * That original stays, unedited, for Activity and Finance until their own
 * slices; L-8 deletes it (R-11). The picker contract test covers both (RC-7).
 *
 * The list comes from the EXISTING `GET /api/admin/business-os/llm-usage/businesses`
 * (admin-gated, repository-backed, logs neither the search text nor the names),
 * reused over HTTP and never imported: a fetch is an HTTP contract, an import is
 * module coupling. The fields read are therefore re-declared below, and the
 * route's `platformAccountIds` is ignored on purpose (a platform account has
 * ordinary rows and filtering to it is legitimate).
 *
 * This is the shared folder's only fetching file (guard rule L-1e F-1): every
 * other shared part leaves reads to the page.
 *
 * No fetch on mount (RC-6): the list is read only while it is open, `open`
 * starts false, and `selectedAccountId` never triggers a read (no name lookup
 * for an inbound id).
 *
 * Privacy (AC-B13): a business name never reaches a log line, and neither does
 * the search text (a search IS usually a business name). The only log is a
 * rejected fetch, with `{ err }` alone.
 *
 * L-4a (user request 2026-10-11): the picker renders no standing note of its
 * own. A note about it is the filter bar's `help` line under the whole bar; the
 * page owns that line's id and passes it here as `describedBy` (SA Q-5). An
 * in-column note made this column taller than its neighbours and broke the
 * bar's one control row.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Search } from 'lucide-react';

import { clientLogger } from '@/lib/logger/client';
import type { AdminActiveChip } from './AdminFilterBar';
import { ADMIN_FIELD_LABEL } from './DatePresets';
import { formatShortId } from './adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from './readAdminResponse';

// A client file logs through the client logger (F-56).
const logger = clientLogger.child({ module: 'AdminBusinessPicker' });

/** The reused endpoint. Asserted to exist by the picker contract test (a single-quoted literal, which it reads). */
export const BUSINESS_SEARCH_PATH = '/api/admin/business-os/llm-usage/businesses';

/** The server's own `SEARCH_MAX_CHARS`; typing past it would only earn a 400. */
const SEARCH_MAX_CHARS = 100;

const SEARCH_DEBOUNCE_MS = 300;

/** A full account id, so a pasted one can be offered as a choice. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `ADMIN_FIELD_CONTROL` tokens written out, minus its `px-3`, plus the
 * icon's left padding (S-9: `px-3` and `pl-8` on one element would rely on CSS
 * order). A test asserts every other token of the constant is here, so the two
 * cannot drift.
 */
const INPUT_CLASS =
  'w-full rounded-lg border border-slate-600 bg-slate-900/50 pl-8 pr-3 py-1.5 text-sm text-white placeholder-slate-400 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

/** Only the fields this picker reads, re-declared rather than imported (see the header). */
interface BusinessOption {
  userId: string;
  companyName: string | null;
}

/** A row in the dropdown: a business, or the "use this pasted id" affordance. */
type PickerOption = (BusinessOption & { kind: 'business' }) | { kind: 'pasted'; userId: string };

export interface AdminBusinessPickerProps {
  /** '' when every business is shown. Marks the current row only. */
  selectedAccountId: string;
  /** name is the picked company name, or null (an unnamed business, or a pasted id). */
  onSelect: (accountId: string, name: string | null) => void;
  /** Visible label. Default "Business". */
  label?: string;
  /** The input's id. Default from useId(). The listbox and option ids always come from useId(). */
  id?: string;
  /** Default "Filter by business name…". */
  placeholder?: string;
  /**
   * Id of an element the PAGE owns and renders (normally the filter bar's
   * `help` line), put on the input's `aria-describedby`. The picker renders no
   * note itself; an id with no matching element is a page bug. Default none.
   */
  describedBy?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the body defensively. This is JSON from another surface's route, not a
 * compile-time value, so a shape change degrades to "no businesses" rather than
 * throwing inside a render.
 */
function readBusinesses(body: Readonly<Record<string, unknown>>): {
  businesses: BusinessOption[];
  limit: number | null;
} {
  const data = isRecord(body.data) ? body.data : {};
  const rows: unknown[] = Array.isArray(data.businesses) ? data.businesses : [];
  const businesses: BusinessOption[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.userId !== 'string' || row.userId.length === 0) continue;
    const name = row.companyName;
    businesses.push({ userId: row.userId, companyName: typeof name === 'string' && name.trim() ? name : null });
  }
  return { businesses, limit: typeof data.limit === 'number' ? data.limit : null };
}

export function AdminBusinessPicker({
  selectedAccountId,
  onSelect,
  label = 'Business',
  id,
  placeholder = 'Filter by business name…',
  describedBy,
}: AdminBusinessPickerProps) {
  // F-70: generated ids, so two pickers on one page never share one.
  const base = useId();
  const inputId = id ?? `${base}-input`;
  const listboxId = `${base}-options`;
  const optionId = (index: number) => `${base}-option-${index}`;

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
        // The route uses this id for its own log line, so a server log can be
        // tied back to one click. Guarded because `crypto.randomUUID` is not in
        // every test environment; the route then generates its own.
        headers: typeof crypto?.randomUUID === 'function' ? { 'x-correlation-id': crypto.randomUUID() } : {},
        signal,
      });
      const result = await readAdminResponse(response, { what: 'the business list', pick: readBusinesses });

      // SA M-1: the body read swallows an AbortError (it returns "no readable
      // body"), so a superseded request would otherwise surface as a failure
      // and show its error on the next open. A superseded request changes nothing.
      if (signal.aborted) return;

      if (!result.ok) {
        setBusinesses([]);
        // The route's own message is a fixed string (never the input), so it is
        // safe to show; it is the only way an admin learns about a 403.
        setError(result.message);
        return;
      }

      setBusinesses(result.data.businesses);
      setLimit(result.data.limit);
      setError(null);
      setHighlight(0);
    } catch (err) {
      if (signal.aborted) return;
      setBusinesses([]);
      setError(ADMIN_NETWORK_ERROR);
      // No search text and no names: a search is usually a business name (AC-B13).
      logger.error({ err }, 'Business list for the business picker failed');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  // Only once the field is in use (RC-6): an admin who never opens the picker
  // costs no business-profiles read.
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

  const choose = (option: PickerOption) => {
    onSelect(option.userId, option.kind === 'business' ? option.companyName : null);
    // The active chip is the single indicator of what is applied, so the box
    // goes back to being a search box rather than echoing the choice.
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // A-3: the list closes and focus stays in the field.
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
    // QA-1: only while the list is open. After Escape the options are still in
    // state, so a bare Enter would otherwise pick a business the admin cannot see.
    if (event.key === 'Enter' && open) {
      const option = options[highlight];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    }
  };

  const truncated = limit !== null && businesses.length >= limit;
  // SA M-2: `highlight` is not reset when the options shrink without a read
  // (the pasted-id row comes and goes with the text), so name an option only
  // when it exists.
  const activeDescendant = open && options[highlight] ? optionId(highlight) : undefined;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // Closing on blur, but not when focus merely moved inside the picker.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={inputId} className={ADMIN_FIELD_LABEL}>
        {label}
      </label>
      {/* The dropdown is anchored to this box with `top-full`, so a change to
          the label or the input's padding cannot make it land on the input. */}
      <div className="relative">
        <Building2 className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-describedby={describedBy}
          autoComplete="off"
          maxLength={SEARCH_MAX_CHARS}
          data-testid="business-picker-input"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={INPUT_CLASS}
        />

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Businesses"
            data-testid="business-picker-options"
            className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-auto bg-slate-900 border border-slate-600 rounded-lg shadow-xl"
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
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  // SA M-2: DOM focus stays on the combobox (the pattern
                  // aria-activedescendant assumes), and Tab leaves the field.
                  tabIndex={-1}
                  data-testid={option.kind === 'pasted' ? 'business-picker-pasted' : 'business-picker-option'}
                  // preventDefault keeps focus in the input, so the container's
                  // onBlur cannot close the list before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(option)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    highlighted ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800'
                  } ${selected ? 'font-semibold' : ''}`}
                >
                  {option.kind === 'pasted' ? (
                    <span className="flex items-center gap-2">
                      <Search className="w-3.5 h-3.5 text-slate-400" />
                      Use this account id
                      <span className="text-slate-400 font-mono text-xs">{formatShortId(option.userId)}</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-between gap-2">
                      {/* An unnamed business stays selectable and is shown as
                          unnamed: `company_name` is nullable, and printing the
                          id in the name's place would mislead. */}
                      <span className={`truncate ${option.companyName ? '' : 'italic text-slate-400'}`}>
                        {option.companyName ?? 'Unnamed business'}
                      </span>
                      <span className="text-slate-500 font-mono text-xs shrink-0" title={option.userId}>
                        {formatShortId(option.userId)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}

            {truncated && (
              <p className="px-3 py-2 text-xs text-slate-400 border-t border-slate-700" data-testid="business-picker-truncated">
                First {limit} matches only — type more of the name to narrow it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The bar's active chip for the business filter (§5.5 part 7): "Business: {name}",
 * or the short id when no name is known; the full id on hover; X "Remove business".
 */
export function businessFilterChip(args: {
  accountId: string;
  name: string | null;
  onRemove: () => void;
}): AdminActiveChip {
  const { accountId, name, onRemove } = args;
  const shown = name && name.trim() ? name : formatShortId(accountId);
  return {
    key: 'account',
    label: `Business: ${shown}`,
    title: accountId,
    testId: 'business-filter-chip',
    removeLabel: 'Remove business',
    onRemove,
  };
}
