/**
 * GET  /api/business-os/addresses   — the business's address book
 * POST /api/business-os/addresses   — add one, or return the one already saved
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * A business types its address into this product up to four times — the profile,
 * the invoice settings, the marketing postal address, and the Stripe Connect
 * wizard — and until now no screen could see what another one held. The owner's
 * words: "we have 2-3 places where the user defines the address; if it is set up
 * in one place, let the user pick it."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NOW SERVES A BOOK, NOT TWO SLOTS.
 *
 * This used to read `business_profiles.address_parts` and `.invoice_address` and
 * return them as two entries named after the columns they came from — so the UI
 * listed storage locations ("Billing address") rather than addresses, could only
 * ever offer two, and had no way to say that both uses were the SAME address.
 *
 * `business_addresses` (20261036) gives an address identity. An entry here is a
 * row the owner can name, set as default, and point both the profile and an
 * invoice at — so correcting it once corrects both. `source` is kept on each
 * entry, derived from which pointer references it, because the screens still
 * want to say "this is the one your invoices use".
 *
 * ONLY THIS USER'S OWN, on every verb. The repository scopes every query by
 * `user_id`, which is the whole of the isolation on a service-role table.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { businessAddressRepository } from '@/lib/repositories/BusinessAddressRepository';
import {
  formatAddressOneLine,
  hasAddressContent,
  type StructuredAddress,
} from '@/lib/geo/address';
import type { CountryLocale } from '@/lib/geo/countries';

const logger = createLogger({ module: 'BusinessAddressesAPI' });

/**
 * What a saved address is being used for, where it is used for anything.
 *
 * No longer where it is STORED — every entry lives in the same table now. This
 * says which pointer references it, so a screen can mark the entry its invoices
 * go out with. An address used by neither carries none, which is ordinary: it
 * is simply one the business has saved.
 */
export type AddressSource = 'profile' | 'invoice';

export interface KnownAddress {
  id: string;
  /** The address as one line, for the option's label. */
  label: string;
  /** The owner's own name for it, where they have given one. */
  name: string | null;
  address: StructuredAddress;
  isDefault: boolean;
  /** Empty when nothing points at it yet. */
  usedBy: AddressSource[];
}

const AddressPartsSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  postal_code: z.string().max(32).optional(),
  // ISO 3166-1 alpha-2, chosen from a list and never typed — `addressRulesFor`
  // returns UNKNOWN for anything that is not exactly two characters, and an
  // UNKNOWN country silently removes the State field and strips a stored state.
  country: z.string().length(2).optional().or(z.literal('')),
});

const CreateAddressSchema = z.object({
  address: AddressPartsSchema,
  label: z.string().max(120).nullable().optional(),
  makeDefault: z.boolean().optional(),
});

/** The locale decides how the country reads — ישראל on a Hebrew screen. */
function localeFrom(request: NextRequest): CountryLocale {
  const requested = new URL(request.url).searchParams.get('locale');
  return requested === 'he' || requested === 'es' ? requested : 'en';
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const locale = localeFrom(request);

    const [book, pointers] = await Promise.all([
      businessAddressRepository.list(user.id),
      businessProfileRepository.getAddressPointers(user.id),
    ]);

    if (book.error) {
      requestLogger.error({ err: book.error, userId: user.id }, 'Failed to read the address book');
      return NextResponse.json({ success: false, error: 'Failed to read addresses' }, { status: 500 });
    }

    const addressId = pointers.data?.address_id ?? null;
    const invoiceAddressId = pointers.data?.invoice_address_id ?? null;

    const addresses: KnownAddress[] = [];

    for (const row of book.data ?? []) {
      /*
       * Only addresses with something in them, by the same predicate the public
       * pages use to decide whether to draw an address at all. An empty entry
       * is worse than no picker: it offers the owner their own blank form.
       */
      if (!hasAddressContent(row.parts)) continue;

      const label = formatAddressOneLine(row.parts, locale);
      // No renderable line means nothing a person could choose between.
      if (!label) continue;

      const usedBy: AddressSource[] = [];
      if (row.id === addressId) usedBy.push('profile');
      if (row.id === invoiceAddressId) usedBy.push('invoice');

      addresses.push({
        id: row.id,
        label,
        name: row.label,
        address: row.parts,
        isDefault: row.is_default,
        usedBy,
      });
    }

    requestLogger.info({ userId: user.id, count: addresses.length }, 'Address book read');

    return NextResponse.json({ success: true, data: { addresses } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error reading the address book');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Add an address to the book.
 *
 * Returns the EXISTING entry when the business already has this address — the
 * invoice form offering the profile's address is the commonest path through
 * here, and writing a second row for it would recreate the two-copies problem
 * the book exists to remove.
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = CreateAddressSchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid address', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const parts = parsed.data.address as StructuredAddress;

    if (!hasAddressContent(parts)) {
      return NextResponse.json(
        { success: false, error: 'An address needs a street, a city or a country' },
        { status: 400 }
      );
    }

    const result = await businessAddressRepository.findOrCreate(user.id, parts, {
      label: parsed.data.label ?? null,
      makeDefault: parsed.data.makeDefault,
    });

    if (result.error || !result.data) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to add an address');
      return NextResponse.json({ success: false, error: 'Failed to save the address' }, { status: 500 });
    }

    const locale = localeFrom(request);

    return NextResponse.json({
      success: true,
      data: {
        address: {
          id: result.data.id,
          label: formatAddressOneLine(result.data.parts, locale),
          name: result.data.label,
          address: result.data.parts,
          isDefault: result.data.is_default,
          usedBy: [],
        } satisfies KnownAddress,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error adding an address');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
