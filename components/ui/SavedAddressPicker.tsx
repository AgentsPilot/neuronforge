'use client';

/**
 * The business's address book: pick one, or add a new one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED, AND WHY
 *
 * This used to offer "the other column". A business had exactly two addresses
 * because `business_profiles` had exactly two columns, so the list was named
 * after storage — "Billing address" — rather than after anything the owner had
 * saved and could recognise. It could only ever show one alternative, it
 * excluded the address the form was actually using, and nothing was selected,
 * so the screen said "use an address you already have" while the fields below
 * held a different one and neither was marked.
 *
 * `business_addresses` (20261036) gives an address identity. This lists the
 * book, marks the entry this form is using, and offers one way out: add a new
 * address. That is the whole control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIELDS ARE HIDDEN WHILE AN ENTRY IS SELECTED
 *
 * An address book is a list you choose from; the form is how you add to it. A
 * business with saved addresses picks one and never sees a text box. A business
 * with none sees the fields immediately, because there is nothing to pick and
 * offering an empty list would be offering it its own blank form.
 *
 * Editing is "add a new address" with the current one prefilled — which is also
 * what makes editing safe: saving writes a NEW entry whenever the one being
 * edited is shared with another use, so correcting the address on the profile
 * can never rewrite the address on an invoice. That rule lives in
 * `lib/business-os/addressBook.ts`; this component only has to make the choice
 * clear.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { hasAddressContent, type StructuredAddress } from '@/lib/geo/address';

/** What a saved address is used for, where it is used for anything. */
export type AddressUse = 'profile' | 'invoice';

export interface KnownAddress {
  id: string;
  /** The address as one line, as a person reads it. */
  label: string;
  /** The owner's own name for it, where they have given one. */
  name: string | null;
  address: StructuredAddress;
  isDefault: boolean;
  usedBy: AddressUse[];
}

/**
 * Do these two addresses say the same thing?
 *
 * Compared field by field rather than by reference, because the one in the form
 * is a copy made when it was picked. Blank and absent are the same answer: an
 * empty `line2` and no `line2` are both "there is no second line", and treating
 * them as different would unselect an entry the owner never touched.
 */
function sameAddress(
  a: StructuredAddress | null | undefined,
  b: StructuredAddress | null | undefined
): boolean {
  if (!a || !b) return false;

  const keys: Array<keyof StructuredAddress> = [
    'line1',
    'line2',
    'city',
    'state',
    'postal_code',
    'country',
  ];

  return keys.every(key => (a[key] ?? '').trim() === (b[key] ?? '').trim());
}

interface SavedAddressPickerProps {
  /** Which form this is, so the list can say "your invoices use this one". */
  use: AddressUse;
  /**
   * The entry this form is currently pointing at, where it has one.
   *
   * `null` means the fields hold an address that is not in the book — typed
   * before the book existed, or being added right now.
   */
  selectedId?: string | null;
  /**
   * `null` when the owner chooses to add a new address, an id when they pick
   * one. The caller decides what that means for its fields; see `onSelect`.
   */
  onSelectedChange?: (id: string | null, how: 'chosen' | 'derived') => void;
  /** Fill the form from a chosen entry. */
  onSelect: (address: StructuredAddress) => void;
  /** What the form currently holds, for recognising it in the list. */
  current?: StructuredAddress | null;
  locale: 'en' | 'he' | 'es';
  isRTL?: boolean;
  /** The reader's words. Keys live in `LanguageContext`. */
  t: (key: string) => string;
  /**
   * Reload trigger. Changing it refetches the book — a form that has just saved
   * a new address needs it to appear without a page reload.
   */
  refreshKey?: number;
  /**
   * Edit a saved address: open it in the fields for correcting.
   *
   * The caller fills its own form and clears the selection, so saving goes
   * through the same path as any other edit. Editing the ENTRY — as opposed to
   * the form — propagates to every use pointing at it, which is why the list
   * says what an entry is used for before the pencil is pressed.
   */
  onEdit?: (option: KnownAddress) => void;
}

export function SavedAddressPicker({
  use,
  selectedId = null,
  onSelectedChange,
  onSelect,
  current,
  locale,
  isRTL = false,
  t,
  refreshKey = 0,
  onEdit,
}: SavedAddressPickerProps) {
  const [options, setOptions] = useState<KnownAddress[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The entry being removed, so its row can say so instead of just vanishing. */
  const [removing, setRemoving] = useState<string | null>(null);
  /** Bumped locally after a delete, to refetch without the caller's help. */
  const [localVersion, setLocalVersion] = useState(0);
  /** The entry the confirm dialog is asking about. */
  const [confirming, setConfirming] = useState<KnownAddress | null>(null);

  /*
   * Deleting never blanks an address a business is currently showing: the
   * pointers are ON DELETE SET NULL and the rendered copy stays, so the entry
   * stops being OFFERED and nothing goes dark. The confirm is still worth it —
   * a list of near-identical addresses is exactly where the wrong row gets hit.
   *
   * THE PLATFORM'S DIALOG, not `window.confirm`. This was the only
   * `window.confirm` in the codebase: an OS-chrome box, in the browser's
   * language rather than the reader's, unstyled, and unable to show the address
   * it is about to remove — which is the one thing that matters when two rows
   * read "14 Venus Drive". Every other destructive action here uses the
   * `--v2-surface` modal; so does this now.
   */
  const remove = async (option: KnownAddress) => {
    setRemoving(option.id);
    setConfirming(null);
    try {
      const response = await fetch(`/api/business-os/addresses/${option.id}`, { method: 'DELETE' });
      if (response.ok) {
        // Clear the selection when the entry it pointed at has gone, so the
        // form does not claim to be using an address that no longer exists.
        if (selectedId === option.id) onSelectedChange?.(null, 'chosen');
        setLocalVersion(v => v + 1);
      }
    } finally {
      setRemoving(null);
    }
  };

  /*
   * The caller's latest choice, without making it a dependency of the fetch.
   * Reloading the book must not re-derive a selection over an answer the owner
   * has since given.
   */
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/business-os/addresses?locale=${encodeURIComponent(locale)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) return;

        const result = await response.json();
        if (cancelled || !result?.success) return;

        const book: KnownAddress[] = Array.isArray(result.data?.addresses)
          ? result.data.addresses
          : [];
        setOptions(book);

        /*
         * Which entry this form is already on, where the caller has not said.
         *
         * Read off the fields rather than stored, so a form whose address came
         * from the book opens with that entry marked instead of looking
         * hand-typed. An empty form takes the default — there is nothing to
         * lose, and a blank form beside an unselected list of saved addresses
         * is the state that sent owners back to retyping what they had already
         * given us.
         */
        if (selectedRef.current === null) {
          const held = currentRef.current;

          if (hasAddressContent(held)) {
            const match = book.find(option => sameAddress(option.address, held));
            if (match) onSelectedChange?.(match.id, 'derived');
          } else {
            const fallback = book.find(option => option.isDefault) ?? book[0];
            if (fallback) {
              onSelectedChange?.(fallback.id, 'derived');
              onSelect(fallback.address);
            }
          }
        }
      } catch {
        /*
         * A convenience that failed. The fields below are the whole form
         * without it, exactly as they were before this existed.
         */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locale, refreshKey, localVersion]);

  /*
   * Nothing at all until the book has been read.
   *
   * Not even the "add a new address" row: drawing it first and then having the
   * list appear above it makes a business that HAS addresses look briefly like
   * one that has none, which is the moment it would start typing.
   */
  if (!loaded) return null;

  // No book, no picker. The caller shows its fields, which is the right screen
  // for a business adding its first address.
  if (options.length === 0) return null;

  const rowStyle = (active: boolean) => ({
    border: `1px solid ${active ? 'var(--v2-primary)' : 'var(--v2-border)'}`,
    background: active ? 'color-mix(in srgb, var(--v2-primary) 8%, transparent)' : 'transparent',
    borderRadius: 'var(--v2-radius-button)',
  });

  return (
    <div
      className="space-y-2 p-3"
      style={{
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-card)',
        background: 'var(--v2-surface)',
      }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--v2-text-muted)' }}>
        {t('settings.address.book_title')}
      </p>

      {options.map(option => {
        const active = selectedId === option.id;

        /*
         * What this entry is used for, said only where it is NOT the thing you
         * are looking at. "Your invoices use this one" is worth knowing on the
         * profile screen; on the invoice screen it is a label saying "this is
         * the screen you are on".
         */
        const otherUse = option.usedBy.find(u => u !== use);

        return (
          <label
            key={option.id}
            className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-start transition-colors"
            style={rowStyle(active)}
          >
            <input
              type="radio"
              name={`saved-address-${use}`}
              checked={active}
              onChange={() => {
                onSelectedChange?.(option.id, 'chosen');
                onSelect(option.address);
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ accentColor: 'var(--v2-primary)' }}
            />

            <span className="min-w-0 flex-1">
              {/* The ADDRESS is the name. A business recognises where it is;
                  it does not recognise which column we kept it in. The owner's
                  own label, where they have given one, leads instead. */}
              <bdi
                className="block text-sm font-medium"
                style={{ color: 'var(--v2-text-primary)' }}
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                {option.name || option.label}
              </bdi>

              {option.name && (
                <bdi
                  className="mt-0.5 block text-xs"
                  style={{ color: 'var(--v2-text-muted)' }}
                  dir={isRTL ? 'rtl' : 'ltr'}
                >
                  {option.label}
                </bdi>
              )}

              {otherUse && (
                <span className="mt-1 block text-[11px]" style={{ color: 'var(--v2-text-muted)' }}>
                  {t(`settings.address.used_by.${otherUse}`)}
                </span>
              )}
            </span>

            {/*
              Edit and remove, on the row they act on.

              `type="button"` and `stopPropagation`: these sit INSIDE the
              `<label>` that selects the entry, so without both, pressing the
              pencil would also select the row and — inside a form — submit it.
              Choosing an address and correcting one are different intentions.
            */}
            <span className="ms-auto flex shrink-0 items-center gap-1">
              {active && (
                <Check className="h-3.5 w-3.5" style={{ color: 'var(--v2-primary)' }} aria-hidden />
              )}

              {onEdit && (
                <button
                  type="button"
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onEdit(option);
                  }}
                  className="rounded p-1 transition-colors hover:bg-[var(--v2-bg)]"
                  aria-label={t('settings.address.edit')}
                  title={t('settings.address.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--v2-text-muted)' }} />
                </button>
              )}

              <button
                type="button"
                disabled={removing === option.id}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setConfirming(option);
                }}
                className="rounded p-1 transition-colors hover:bg-[var(--v2-bg)] disabled:opacity-50"
                aria-label={t('settings.address.delete')}
                title={t('settings.address.delete')}
              >
                {removing === option.id ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    style={{ color: 'var(--v2-text-muted)' }}
                  />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--v2-text-muted)' }} />
                )}
              </button>
            </span>
          </label>
        );
      })}

      {/*
        The way out, said rather than implied.
        Without it the list reads as a closed set, and an owner whose address is
        none of these has no signal that adding one is still allowed. Choosing it
        is what reveals the fields.
      */}
      <label
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-start transition-colors"
        style={rowStyle(selectedId === null)}
      >
        <input
          type="radio"
          name={`saved-address-${use}`}
          checked={selectedId === null}
          onChange={() => onSelectedChange?.(null, 'chosen')}
          className="h-3.5 w-3.5 shrink-0"
          style={{ accentColor: 'var(--v2-primary)' }}
        />
        <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v2-text-muted)' }} aria-hidden />
        <span className="text-sm" style={{ color: 'var(--v2-text-primary)' }}>
          {t('settings.address.add_new')}
        </span>
      </label>

      {/*
        The platform's confirmation, in the platform's language and tokens —
        the same shape the services list uses to confirm a deletion.

        It NAMES THE ADDRESS, which `window.confirm` could not. Two entries in
        this book can read "14 Venus Drive, Closter" and differ only by a state,
        so a confirm that does not show which one is being removed is asking the
        owner to trust that they clicked the right bin.
      */}
      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 sm:p-6 max-w-sm w-full mx-4 shadow-xl"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                {t('settings.address.delete_title')}
              </h3>
            </div>

            <bdi
              className="mb-2 block text-sm font-medium text-[var(--v2-text-primary)]"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              {confirming.name || confirming.label}
            </bdi>

            <p className="mb-4 text-sm text-[var(--v2-text-secondary)]">
              {t('settings.address.delete_confirm')}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="flex-1 border border-[var(--v2-border)] bg-[var(--v2-bg)] px-4 py-2.5 text-sm font-medium text-[var(--v2-text-primary)] transition-all hover:bg-[var(--v2-surface-hover)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void remove(confirming)}
                className="flex-1 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-red-700"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {/* Its own word, not the row button's label. Two controls on
                    screen with the same accessible name is ambiguous to a
                    screen reader and reads as a repeated sentence to everyone
                    else — the dialog has already said what it is removing. */}
                {t('settings.address.delete_action')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
