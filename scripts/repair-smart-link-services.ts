/**
 * Un-freeze booking links written before links followed the catalogue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPAIRS
 *
 * A smart link used to enumerate its services into its own URL
 * (`?services=a,b,c`) and into `metadata.serviceIds`. That list is as old as the
 * link: a service added afterwards can never appear on it, and services deleted
 * since sit in the URL for ever. One live link pinned five ids — two of them
 * services that no longer existed — while the newest service was not on it at
 * all. It was named "5 services" and served three.
 *
 * Links are written as EXCLUSIONS now (`?exclude=`), so anything new is on the
 * link by default. This brings the old ones over.
 *
 * WHAT IT DOES, PER LINK
 *
 *   one service pinned      LEFT ALONE. A one-service link is a promotion, and
 *                           it is meant to stay that one service.
 *   several pinned          becomes a follow-the-catalogue link: the pin is
 *                           removed from the URL and `serviceIds` cleared.
 *   nothing pinned          already follows the catalogue. Left alone.
 *
 * WHY SEVERAL BECOMES "ALL" rather than "all except the unpinned ones":
 * the two cannot be told apart. A link listing four of a business's five
 * services may have meant "these four" or may have meant "everything", and on
 * the day it was made those looked identical. Since the rule the owner asked
 * for is that a link must offer what the business sells, the repair resolves
 * the ambiguity that way — and any link that really is meant to be narrower can
 * be narrowed again in the wizard, where it will now be stored as an exclusion
 * and stay true.
 *
 * SAFE BY DEFAULT: prints what it would do and changes nothing. Pass --apply.
 *
 *   npx tsx scripts/repair-smart-link-services.ts --user <uuid>
 *   npx tsx scripts/repair-smart-link-services.ts --user <uuid> --apply
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const userId = args[args.indexOf('--user') + 1];

interface SmartLinkRow {
  id: string;
  name: string | null;
  destination_url: string;
  destination_type: string | null;
  metadata: { serviceIds?: string[]; excludedServiceIds?: string[] } | null;
}

/** Strip the frozen list out of a URL, leaving every other parameter alone. */
function unpin(destinationUrl: string): string {
  try {
    const url = new URL(destinationUrl);
    url.searchParams.delete('services');
    return url.toString();
  } catch {
    // Not a parseable URL — leave it exactly as it is rather than guess.
    return destinationUrl;
  }
}

async function main() {
  if (!userId) {
    console.error('Usage: --user <uuid> [--apply]');
    process.exit(1);
  }

  const { data: links, error } = await db
    .from('smart_links')
    .select('id, name, destination_url, destination_type, metadata')
    .eq('user_id', userId)
    .eq('destination_type', 'booking');

  if (error) {
    console.error('Could not read the links:', error.message);
    process.exit(1);
  }

  const { data: services } = await db
    .from('scheduling_services')
    .select('id, service_name')
    .eq('user_id', userId)
    .eq('is_active', true);

  const live = new Map((services ?? []).map(s => [s.id as string, s.service_name as string]));
  console.log(`${live.size} active service(s), ${links?.length ?? 0} booking link(s)\n`);

  for (const link of (links ?? []) as SmartLinkRow[]) {
    const pinned = link.metadata?.serviceIds ?? [];
    const inUrl = link.destination_url.includes('services=');

    if (pinned.length <= 1 && !inUrl) {
      console.log(`· ${link.name ?? link.id}: already follows the catalogue — untouched`);
      continue;
    }
    if (pinned.length === 1) {
      console.log(`· ${link.name ?? link.id}: a one-service promotion link — untouched`);
      continue;
    }

    const dead = pinned.filter(id => !live.has(id));
    const missing = [...live.keys()].filter(id => !pinned.includes(id));

    console.log(`· ${link.name ?? link.id}`);
    console.log(`    pins ${pinned.length}, of which ${dead.length} no longer exist`);
    if (missing.length) {
      console.log(
        `    NOT offering: ${missing.map(id => live.get(id)).join(', ')} — added after the link was made`
      );
    }
    console.log(`    → will follow every service`);

    if (!apply) continue;

    const { error: updateError } = await db
      .from('smart_links')
      .update({
        destination_url: unpin(link.destination_url),
        metadata: { ...(link.metadata ?? {}), serviceIds: [], excludedServiceIds: [] },
      })
      .eq('id', link.id)
      .eq('user_id', userId);

    console.log(updateError ? `    FAILED: ${updateError.message}` : '    repaired');
  }

  console.log(apply ? '\nDone.' : '\nDry run — nothing was changed. Pass --apply.');
}

void main();
