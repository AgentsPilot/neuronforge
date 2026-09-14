/**
 * GET /api/capabilities — what this account has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DERIVED, NOT STORED.
 *
 * This used to be a straight read of `user_capabilities`, and the rows were not
 * worth reading. `scheduling` was granted for having any service at all, so a
 * shop selling downloads got an availability calendar and a booking widget; a
 * sweep in `CapabilityActivationService` then added every capability whose
 * `verticals` list was empty to every account, overriding whatever the
 * onboarding chat had decided; and nothing anywhere could ever switch one off.
 *
 * Six of them are now answered from the business's own catalogue — see
 * `lib/business-os/businessShape` for what each one means and why. The rest are
 * still read from the rows, because nothing in a service list can say whether
 * somebody asked for their Instagram account to be connected.
 *
 * The RESPONSE SHAPE is unchanged on purpose: the provider, the nav bar, the
 * dashboard cards and the CRM drawer all read `enabledKeys`, and none of them
 * had to be touched.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveCapabilities } from '@/lib/business-os/businessShape.server';

const logger = createLogger({ module: 'CapabilitiesAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Resolving user capabilities');

    /*
     * 2. What the business's own shape says it has, and the rows behind it.
     *
     * Both come back from one call because they come from one round trip. This
     * route used to read `user_capabilities` a second time for the
     * configuration blobs — the same table the resolver had just read — which
     * is two of the five queries this endpoint was making. The tab bar waits on
     * this request on every page, so those queries were visible.
     */
    const { keys: enabledKeys, stored } = await resolveCapabilities(user.id);

    /*
     * 3. The display metadata, and only for the keys that survived.
     *
     * Names, icons and colours are still rows — they are the capability's
     * presentation, not the decision about whether the account has it. A key
     * with no row is simply not described; it stays in `enabledKeys`, which is
     * what every gate in the product actually reads.
     */
    const { data: catalogue, error: catalogueError } = await supabaseServer
      .from('capabilities')
      .select('capability_key, name_en, name_es, name_he, icon, color, category')
      .in('capability_key', enabledKeys);

    if (catalogueError) {
      requestLogger.warn(
        { err: catalogueError, userId: user.id },
        'Could not read capability metadata; returning keys only'
      );
    }

    // Whatever the account configured for a capability travels with it, exactly
    // as before — the shape decides IF, the row still decides HOW.
    const configurationByKey = new Map<string, unknown>(
      stored.map(row => [row.key, row.configuration])
    );

    const capabilities = (catalogue || []).map((cap: any) => ({
      key: cap.capability_key,
      name_en: cap.name_en,
      name_es: cap.name_es,
      name_he: cap.name_he,
      icon: cap.icon,
      color: cap.color,
      category: cap.category,
      configuration: configurationByKey.get(cap.capability_key) ?? null,
    }));

    requestLogger.info(
      { userId: user.id, enabledCount: enabledKeys.length, enabledKeys },
      'User capabilities resolved'
    );

    // 4. Return success
    return NextResponse.json({
      success: true,
      capabilities,
      enabledKeys
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
