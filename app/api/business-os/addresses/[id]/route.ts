/**
 * PATCH  /api/business-os/addresses/[id] — edit or rename a saved address
 * DELETE /api/business-os/addresses/[id] — remove it from the book
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDITING HERE PROPAGATES, AND THAT IS DELIBERATE.
 *
 * Saving the address on a FORM forks when the entry is shared, because editing
 * the profile's address says nothing about the invoices. Editing the ENTRY says
 * the saved address itself is wrong — and a record corrected once being
 * corrected everywhere is the reason the book exists. The list tells the owner
 * which uses an entry has before they edit it, so it is informed rather than
 * silent. The rule lives in `lib/business-os/addressBook.ts`.
 *
 * Deleting never blanks an address a business is currently showing: the
 * pointers are `ON DELETE SET NULL` and the rendered copies stay. The entry
 * stops being OFFERED; nothing goes dark.
 *
 * ONLY THIS USER'S OWN, on both verbs. The repository scopes every query by
 * `user_id`, which is the whole of the isolation on a service-role table — an
 * id from the URL is a caller-supplied value and reaches nothing by itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { updateBookEntry, deleteBookEntry } from '@/lib/business-os/addressBook';
import { formatAddressOneLine, type StructuredAddress } from '@/lib/geo/address';
import type { CountryLocale } from '@/lib/geo/countries';

const logger = createLogger({ module: 'BusinessAddressAPI' });

const AddressPartsSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  postal_code: z.string().max(32).optional(),
  // ISO 3166-1 alpha-2. `addressRulesFor` returns UNKNOWN for anything that is
  // not exactly two characters, and an UNKNOWN country removes the State field
  // and strips a stored state.
  country: z.string().length(2).optional().or(z.literal('')),
});

const PatchSchema = z
  .object({
    address: AddressPartsSchema.optional(),
    label: z.string().max(120).nullable().optional(),
  })
  .refine(body => body.address !== undefined || body.label !== undefined, {
    message: 'Nothing to change',
  });

const UUID = z.string().uuid();

function localeFrom(request: NextRequest): CountryLocale {
  const requested = new URL(request.url).searchParams.get('locale');
  return requested === 'he' || requested === 'es' ? requested : 'en';
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!UUID.safeParse(params.id).success) {
      return NextResponse.json({ success: false, error: 'Address not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid address', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await updateBookEntry({
      userId: user.id,
      addressId: params.id,
      parts: parsed.data.address as StructuredAddress | undefined,
      label: parsed.data.label,
    });

    if (result.error || !result.data) {
      // "Not found" covers an id belonging to someone else, which is the same
      // answer as absent and says nothing about whether it exists.
      const missing = result.error?.message === 'Address not found';
      if (!missing) {
        requestLogger.error({ err: result.error, userId: user.id }, 'Failed to edit an address');
      }
      return NextResponse.json(
        { success: false, error: missing ? 'Address not found' : 'Failed to save the address' },
        { status: missing ? 404 : 500 }
      );
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
        },
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error editing an address');
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

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!UUID.safeParse(params.id).success) {
      return NextResponse.json({ success: false, error: 'Address not found' }, { status: 404 });
    }

    const result = await deleteBookEntry({ userId: user.id, addressId: params.id });

    if (result.error) {
      const missing = result.error.message === 'Address not found';
      if (!missing) {
        requestLogger.error({ err: result.error, userId: user.id }, 'Failed to delete an address');
      }
      return NextResponse.json(
        { success: false, error: missing ? 'Address not found' : 'Failed to delete the address' },
        { status: missing ? 404 : 500 }
      );
    }

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error deleting an address');
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
