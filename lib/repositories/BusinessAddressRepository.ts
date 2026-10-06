// lib/repositories/BusinessAddressRepository.ts
//
// The business's address book — the addresses it has saved, one row each.
//
// Schema: supabase/migrations/20261036_business_addresses_book.sql
//
// ── WHY A BOOK AND NOT TWO COLUMNS ───────────────────────────────────────────
// A business used to have exactly two addresses because it had exactly two
// columns: `business_profiles.address_parts` and `.invoice_address`. They drift
// — the same street saved twice, a state added to one of them — and nothing can
// say which was edited last, because both sit in one row behind one
// `updated_at`. Here an address has identity, so the profile and an invoice can
// point at the SAME row and follow it when it is corrected, or at different
// rows deliberately.
//
// ── THE OLD COLUMNS ARE STILL THE ONES THAT RENDER ───────────────────────────
// Seventeen files read `address_parts` / `invoice_address` — the invoice PDF,
// the public booking and contact pages, the privacy policy, Stripe Connect.
// They keep reading them. `BusinessProfileRepository` writes the copy alongside
// the pointer; this repository owns the book itself.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ──────────
// The table grants to `service_role` only — no client reaches it directly. That
// makes `.eq('user_id', userId)` on EVERY query the whole of the tenant
// isolation here (CLAUDE.md rule 4), including on writes addressed by `id`:
// an id alone is a caller-supplied value, and a row belonging to someone else
// must not be readable, updatable or deletable through it.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { StructuredAddress } from '@/lib/geo/address';

const logger = createLogger({ module: 'BusinessAddressRepository' });

export interface BusinessAddress {
  id: string;
  user_id: string;
  parts: StructuredAddress;
  /** The owner's own name for it. Null until they give one. */
  label: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessAddressResult<T> {
  data: T | null;
  error: Error | null;
}

/** Everything the book needs; `id` and the timestamps come from the database. */
const COLUMNS = 'id, user_id, parts, label, is_default, created_at, updated_at';

export class BusinessAddressRepository {
  constructor(private readonly supabase: SupabaseClient = defaultSupabase) {}

  /**
   * The book, default first and newest after.
   *
   * The default leads because it is the one a form with no address of its own
   * should offer, and a list whose first row is not the one about to be chosen
   * reads as arbitrary.
   */
  async list(userId: string): Promise<BusinessAddressResult<BusinessAddress[]>> {
    try {
      const { data, error } = await this.supabase
        .from('business_addresses')
        .select(COLUMNS)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        logger.error({ err: error, userId }, 'Failed to list the address book');
        return { data: null, error: new Error(error.message) };
      }

      return { data: (data ?? []) as BusinessAddress[], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Unexpected error listing the address book');
      return { data: null, error: error as Error };
    }
  }

  /** One address, scoped to its owner so an id alone cannot reach another. */
  async findById(id: string, userId: string): Promise<BusinessAddressResult<BusinessAddress | null>> {
    try {
      const { data, error } = await this.supabase
        .from('business_addresses')
        .select(COLUMNS)
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        logger.error({ err: error, id, userId }, 'Failed to read an address');
        return { data: null, error: new Error(error.message) };
      }

      return { data: (data as BusinessAddress) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Unexpected error reading an address');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Add an address, or return the one that is already this address.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * IDEMPOTENT ON THE ADDRESS ITSELF, and that is the point of the book.
   *
   * The commonest path is an owner choosing in the invoice form the address
   * they already entered on the profile. Writing a second row for it would
   * recreate the two-copies problem this table exists to remove — and the two
   * copies would then drift the moment either is corrected.
   *
   * Compared on the six parts, trimmed and case-folded, the same rule the
   * backfill and the picker use. Deliberately NOT tolerant of a missing part:
   * an address with a state and the same address without one are two entries,
   * because one of them is wrong and merging them would silently pick a winner.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async findOrCreate(
    userId: string,
    parts: StructuredAddress,
    options: { label?: string | null; makeDefault?: boolean } = {}
  ): Promise<BusinessAddressResult<BusinessAddress>> {
    try {
      const existing = await this.list(userId);
      if (existing.error) return { data: null, error: existing.error };

      const match = (existing.data ?? []).find(row => sameParts(row.parts, parts));
      if (match) {
        if (options.makeDefault && !match.is_default) {
          const promoted = await this.setDefault(match.id, userId);
          if (promoted.error) return { data: null, error: promoted.error };
          return { data: promoted.data, error: null };
        }
        return { data: match, error: null };
      }

      /*
       * The first address a business saves becomes its default without being
       * asked. Anything else leaves a book whose only entry is not the one
       * offered, which is indistinguishable from a bug.
       */
      const isFirst = (existing.data ?? []).length === 0;

      const { data, error } = await this.supabase
        .from('business_addresses')
        .insert({
          user_id: userId,
          parts,
          label: options.label ?? null,
          is_default: isFirst,
        })
        .select(COLUMNS)
        .single();

      if (error) {
        logger.error({ err: error, userId }, 'Failed to add an address to the book');
        return { data: null, error: new Error(error.message) };
      }

      const created = data as BusinessAddress;
      logger.info({ userId, addressId: created.id, isDefault: created.is_default }, 'Address added to the book');

      // Asked for as the default, and not the first: promote it as its own step,
      // which clears the previous default under the partial unique index.
      if (options.makeDefault && !created.is_default) {
        return this.setDefault(created.id, userId);
      }

      return { data: created, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Unexpected error adding an address');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Change what an address says.
   *
   * Every use pointing at it follows, which is the behaviour the book exists
   * for — correcting a missing state once fixes the profile and the invoice
   * together. Callers that hold a denormalised copy must refresh it; see
   * `BusinessProfileRepository`.
   */
  async update(
    id: string,
    userId: string,
    changes: { parts?: StructuredAddress; label?: string | null }
  ): Promise<BusinessAddressResult<BusinessAddress>> {
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (changes.parts !== undefined) patch.parts = changes.parts;
      if (changes.label !== undefined) patch.label = changes.label;

      const { data, error } = await this.supabase
        .from('business_addresses')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId)
        .select(COLUMNS)
        .maybeSingle();

      if (error) {
        logger.error({ err: error, id, userId }, 'Failed to update an address');
        return { data: null, error: new Error(error.message) };
      }

      // No row means it is not this owner's, which is the same answer as absent.
      if (!data) return { data: null, error: new Error('Address not found') };

      logger.info({ userId, addressId: id }, 'Address updated');
      return { data: data as BusinessAddress, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Unexpected error updating an address');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Make one address the default, clearing whichever held it.
   *
   * Two writes, and the order matters: `business_addresses_one_default_idx` is
   * a partial UNIQUE index, so setting the new default before clearing the old
   * one is rejected by the database rather than quietly producing two.
   */
  async setDefault(id: string, userId: string): Promise<BusinessAddressResult<BusinessAddress>> {
    try {
      const { error: clearError } = await this.supabase
        .from('business_addresses')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_default', true)
        .neq('id', id);

      if (clearError) {
        logger.error({ err: clearError, id, userId }, 'Failed to clear the previous default address');
        return { data: null, error: new Error(clearError.message) };
      }

      const { data, error } = await this.supabase
        .from('business_addresses')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select(COLUMNS)
        .maybeSingle();

      if (error) {
        logger.error({ err: error, id, userId }, 'Failed to set the default address');
        return { data: null, error: new Error(error.message) };
      }

      if (!data) return { data: null, error: new Error('Address not found') };

      logger.info({ userId, addressId: id }, 'Default address set');
      return { data: data as BusinessAddress, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Unexpected error setting the default address');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Remove an address from the book.
   *
   * The pointers are `ON DELETE SET NULL`, so a profile or invoice still
   * showing this address keeps its denormalised copy and simply stops saying
   * which entry it came from. Deleting the address a business is currently
   * showing its clients must not blank that address.
   */
  async delete(id: string, userId: string): Promise<BusinessAddressResult<{ deleted: boolean }>> {
    try {
      const { error } = await this.supabase
        .from('business_addresses')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        logger.error({ err: error, id, userId }, 'Failed to delete an address');
        return { data: null, error: new Error(error.message) };
      }

      logger.info({ userId, addressId: id }, 'Address removed from the book');
      return { data: { deleted: true }, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Unexpected error deleting an address');
      return { data: null, error: error as Error };
    }
  }
}

/**
 * Are these the same address?
 *
 * The six parts, trimmed and case-folded — the same comparison the migration's
 * backfill and `SavedAddressPicker` make, so the three cannot disagree about
 * what counts as a duplicate.
 */
export function sameParts(
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

  return keys.every(
    key => (a[key] ?? '').trim().toLowerCase() === (b[key] ?? '').trim().toLowerCase()
  );
}

export const businessAddressRepository = new BusinessAddressRepository();
