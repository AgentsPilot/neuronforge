/**
 * The business shape, resolved against the database.
 *
 * Separate from `businessShape.ts` for one reason: the rules there are pure, and
 * the settings dialog resolves them in the BROWSER from the services it has
 * already loaded. Putting a `supabaseServer` import in that module would drag
 * the service-role key into a client bundle.
 *
 * Everything here is the same rules with the rows fetched.
 *
 * @module lib/business-os/businessShape.server
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import {
  capabilityKeysFromShape,
  shapeFromServices,
  SHAPE_OWNED_CAPABILITIES,
  type BusinessShape,
} from '@/lib/business-os/businessShape';

const logger = createLogger({ module: 'BusinessShapeServer' });

/**
 * What this business is, from its services and its presence answer.
 *
 * Two reads, in parallel — the catalogue is the shape, and the profile carries
 * the one preference the catalogue cannot express.
 */
export async function resolveBusinessShape(userId: string): Promise<BusinessShape> {
  const [servicesResult, profileResult] = await Promise.all([
    schedulingServiceRepository.listAll(userId),
    businessProfileRepository.findByUserId(userId),
  ]);

  if (servicesResult.error) {
    logger.warn({ err: servicesResult.error, userId }, 'Could not read services for business shape');
  }

  const profile = profileResult.data as
    | { online_presence_mode?: string | null; payment_mode?: string | null; collection_method?: string | null }
    | null;

  return shapeFromServices(servicesResult.data || [], {
    online_presence_mode: profile?.online_presence_mode ?? null,
    payment_mode: profile?.payment_mode ?? null,
    collection_method: profile?.collection_method ?? null,
  });
}

/** What a stored `user_capabilities` row still has to say for itself. */
export interface StoredCapability {
  key: string;
  configuration: unknown;
}

/**
 * Every capability key this account has, and the rows behind the stored half.
 *
 * A UNION of two things, and the split is the whole point:
 *
 *   the shape owns  crm, scheduling, payments, website, reports, insights —
 *                   questions the catalogue answers, so a stored row may not
 *                   override them in either direction.
 *   the rows own    everything else — channel insights, integrations,
 *                   campaigns. Nothing in the services says whether somebody
 *                   asked for their Instagram account to be connected, so that
 *                   answer stays where it was written.
 *
 * ONE ROUND TRIP. The rows are fetched ALONGSIDE the shape rather than after
 * it: nothing in this query depends on the answer to that one, and reading them
 * in sequence put a needless ~70ms in front of every navigation — this is what
 * the tab bar waits on, on every page.
 *
 * The rows travel back with the keys for the same reason. `/api/capabilities`
 * needs each capability's `configuration`, and fetching it separately meant the
 * same table was read twice in one request.
 *
 * A failed read of the rows is not fatal: the derived half is what the
 * navigation is gated on, and losing an integrations flag is a smaller harm
 * than a 500 that costs the reader every tab.
 */
export async function resolveCapabilities(
  userId: string
): Promise<{ keys: string[]; stored: StoredCapability[] }> {
  const [shape, rowsResult] = await Promise.all([
    resolveBusinessShape(userId),
    supabaseServer
      .from('user_capabilities')
      .select('configuration, capabilities ( capability_key )')
      .eq('user_id', userId)
      .eq('is_active', true),
  ]);

  const keys = new Set(capabilityKeysFromShape(shape));

  if (rowsResult.error) {
    logger.warn(
      { err: rowsResult.error, userId },
      'Could not read stored capabilities; using derived only'
    );
    return { keys: Array.from(keys), stored: [] };
  }

  const owned = new Set<string>(SHAPE_OWNED_CAPABILITIES);
  const stored: StoredCapability[] = [];

  (rowsResult.data || []).forEach((row: any) => {
    const key = row?.capabilities?.capability_key;
    if (!key) return;
    stored.push({ key, configuration: row.configuration ?? null });
    if (!owned.has(key)) keys.add(key);
  });

  return { keys: Array.from(keys), stored };
}

/** The keys alone, for the callers that gate on them and nothing more. */
export async function resolveCapabilityKeys(userId: string): Promise<string[]> {
  return (await resolveCapabilities(userId)).keys;
}
