/**
 * Saving an address from a form, without disturbing anybody else's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE: ONE USE NEVER CHANGES ANOTHER.
 *
 * The profile and the invoice can point at the same entry — that is what makes
 * "the address I already gave you" offerable in both places. But editing it
 * from one of them must NOT rewrite the other. A business correcting its public
 * address has not asked for its billing address to change, and an invoice is a
 * document about money: it keeps the address it was set up with until somebody
 * deliberately changes it there.
 *
 * So saving branches on one question — is anything ELSE pointing at this entry?
 *
 *   SHARED      fork. A new entry is written and only THIS use is repointed.
 *               The other use keeps the row it had, untouched.
 *
 *   NOT SHARED  correct it in place. Nothing else can notice, and forking here
 *               would leave an orphan behind every typo — a book that fills up
 *               with near-duplicates is the two-copies problem again, wearing a
 *               different shape.
 *
 * Either way the business ends up with an entry holding exactly what was typed,
 * and the other use ends up exactly as it was.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import {
  businessAddressRepository,
  sameParts,
  type BusinessAddress,
} from '@/lib/repositories/BusinessAddressRepository';
import { hasAddressContent, type StructuredAddress } from '@/lib/geo/address';

const logger = createLogger({ module: 'addressBook' });

/** Which pointer is being written. */
export type AddressUse = 'profile' | 'invoice';

export interface SaveAddressOutcome {
  /** The entry this use now points at. */
  address: BusinessAddress;
  /**
   * Always false now, and kept so callers need no change.
   *
   * Saving used to fork a shared entry so one use could not alter another. It
   * no longer does — see the reasoning in `saveAddressForUse`. Diverging is an
   * explicit "add a new address" instead.
   */
  forked: boolean;
}

/**
 * Put what the form holds into the book, and point this use at it.
 *
 * @param addressId The entry the form started from, where it had one. Null when
 *   the owner typed a fresh address or the business had none.
 */
export async function saveAddressForUse(params: {
  userId: string;
  use: AddressUse;
  parts: StructuredAddress;
  addressId?: string | null;
}): Promise<{ data: SaveAddressOutcome | null; error: Error | null }> {
  const { userId, use, parts, addressId = null } = params;

  if (!hasAddressContent(parts)) {
    return { data: null, error: new Error('An address needs a street, a city or a country') };
  }

  const pointers = await businessProfileRepository.getAddressPointers(userId);
  if (pointers.error) return { data: null, error: pointers.error };

  const current = use === 'profile' ? pointers.data?.address_id : pointers.data?.invoice_address_id;

  /*
   * The entry being corrected: the one the owner opened with the pencil, or
   * failing that the one this form already points at. A form that started on
   * entry A and then had the owner CHOOSE entry B is not editing A at all — it
   * is selecting B, and `findOrCreate` below handles that without touching
   * either.
   */
  const editing = addressId ?? current ?? null;

  let entry: BusinessAddress | null = null;

  if (editing) {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * CORRECTED IN PLACE, even when another use points at it too.
     *
     * This used to FORK a shared entry, so that correcting the profile's
     * address could not change the invoice's. That was right while the two were
     * separate records that merely looked alike. It became wrong the moment the
     * book worked: an owner who picks ONE address for both uses — the outcome
     * this table exists to make possible — then got a near-duplicate on every
     * save, the profile moving to a new entry and the invoice left on the old
     * one. "When editing again it created new address."
     *
     * An entry means one address. Correcting it corrects it everywhere it is
     * used, which is what a saved address IS. Wanting the invoice to go
     * somewhere else is still available and is now explicit — "add a new
     * address" — rather than a side effect of fixing a typo.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const existing = await businessAddressRepository.findById(editing, userId);
    if (existing.error) return { data: null, error: existing.error };

    if (existing.data) {
      if (sameParts(existing.data.parts, parts)) {
        // Unchanged: no write, so `updated_at` does not move and nothing reads
        // as an edit.
        entry = existing.data;
      } else {
        const updated = await businessAddressRepository.update(editing, userId, { parts });
        if (updated.error) return { data: null, error: updated.error };
        entry = updated.data;
        logger.info({ userId, use, addressId: editing }, 'Address corrected in place');
      }
    }
  }

  /*
   * Nothing to correct — a new address, or a form that pointed at an entry that
   * has since been deleted. `findOrCreate` hands back the entry the business
   * already has for this address where one exists, so choosing the address the
   * other use holds points both at ONE row rather than writing a second copy.
   */
  if (!entry) {
    const found = await businessAddressRepository.findOrCreate(userId, parts);
    if (found.error || !found.data) {
      return { data: null, error: found.error ?? new Error('Could not save the address') };
    }
    entry = found.data;
  }

  /*
   * Every use pointing at this entry gets the refreshed copy, not just this one.
   *
   * `address_parts` and `invoice_address` are what the invoice PDF and the
   * public pages render. Correcting the entry and refreshing only the form that
   * did it would leave the other use rendering the old address from a stale
   * copy — the exact drift the book was added to end.
   */
  const alsoPointingHere: AddressUse[] = [];
  if (pointers.data?.address_id === entry.id && use !== 'profile') alsoPointingHere.push('profile');
  if (pointers.data?.invoice_address_id === entry.id && use !== 'invoice') alsoPointingHere.push('invoice');

  for (const other of alsoPointingHere) {
    const synced = await businessProfileRepository.setAddressPointer(userId, other, entry.id, parts);
    if (synced.error) return { data: null, error: synced.error };
  }

  const pointed = await businessProfileRepository.setAddressPointer(userId, use, entry.id, parts);
  if (pointed.error) return { data: null, error: pointed.error };

  return {
    data: { address: entry, forked: false },
    error: null,
  };
}

/**
 * Edit an entry in the book itself, and carry the change to everything using it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ONE DOES PROPAGATE, AND THAT IS NOT A CONTRADICTION.
 *
 * `saveAddressForUse` forks, because editing the address on the profile form is
 * a statement about the PROFILE — the owner never mentioned their invoices, and
 * changing those too would be acting on something they did not ask about.
 *
 * Editing the entry in the book is the opposite statement: this saved address
 * is wrong, fix it. A record corrected once being corrected everywhere is the
 * reason the book exists, and forking here would leave the stale copy in place
 * on the very screen the owner came to correct. The list says which uses an
 * entry has before they edit it, so the change is informed rather than silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COPIES MOVE WITH IT, OR THE DRIFT COMES BACK
 *
 * `address_parts` and `invoice_address` are what the invoice PDF and the public
 * pages actually render. Updating the row without refreshing them would leave
 * the book saying one thing and every reader showing another — which is exactly
 * the failure this table was added to end, reintroduced by the feature meant to
 * fix it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function updateBookEntry(params: {
  userId: string;
  addressId: string;
  parts?: StructuredAddress;
  label?: string | null;
}): Promise<{ data: BusinessAddress | null; error: Error | null }> {
  const { userId, addressId, parts, label } = params;

  if (parts !== undefined && !hasAddressContent(parts)) {
    return { data: null, error: new Error('An address needs a street, a city or a country') };
  }

  const updated = await businessAddressRepository.update(addressId, userId, { parts, label });
  if (updated.error || !updated.data) {
    return { data: null, error: updated.error ?? new Error('Address not found') };
  }

  // Only the address itself can make a copy stale; renaming an entry changes
  // nothing any reader renders.
  if (parts !== undefined) {
    const pointers = await businessProfileRepository.getAddressPointers(userId);
    if (pointers.error) return { data: null, error: pointers.error };

    const uses: AddressUse[] = [];
    if (pointers.data?.address_id === addressId) uses.push('profile');
    if (pointers.data?.invoice_address_id === addressId) uses.push('invoice');

    for (const use of uses) {
      const synced = await businessProfileRepository.setAddressPointer(userId, use, addressId, parts);
      if (synced.error) return { data: null, error: synced.error };
    }

    logger.info({ userId, addressId, uses }, 'Address edited in the book; copies refreshed');
  }

  return { data: updated.data, error: null };
}

/**
 * Remove an entry from the book.
 *
 * The pointers are `ON DELETE SET NULL`, so a form still showing this address
 * keeps its copy and simply stops saying which entry it came from. Deleting the
 * address a business is currently showing its clients must not blank the
 * address on its booking page — the owner asked to tidy a list, not to go dark.
 *
 * They can still change it afterwards; it is just no longer offered.
 */
export async function deleteBookEntry(params: {
  userId: string;
  addressId: string;
}): Promise<{ data: { deleted: boolean } | null; error: Error | null }> {
  const { userId, addressId } = params;

  const existing = await businessAddressRepository.findById(addressId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Address not found') };

  const removed = await businessAddressRepository.delete(addressId, userId);
  if (removed.error) return { data: null, error: removed.error };

  /*
   * The book must not be left without a default, or the next empty form has
   * nothing to offer and sends the owner back to typing. Promotes whatever
   * remains; an empty book needs no default.
   */
  if (existing.data.is_default) {
    const rest = await businessAddressRepository.list(userId);
    if (rest.error) return { data: null, error: rest.error };

    const next = rest.data?.[0];
    if (next && !next.is_default) {
      const promoted = await businessAddressRepository.setDefault(next.id, userId);
      if (promoted.error) return { data: null, error: promoted.error };
      logger.info({ userId, addressId: next.id }, 'Default moved after the previous one was deleted');
    }
  }

  return { data: { deleted: true }, error: null };
}
