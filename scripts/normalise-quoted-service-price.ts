/**
 * Clear the stale price off services that are sold BY QUOTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WRONG WITH A ZERO HERE
 *
 * `scheduling_services.price` answers "what is this service's amount". A quoted
 * service has no answer: the amount is settled in the proposal, per job, which
 * is why the editor replaces the whole price block with `scheduling.modal.
 * quote_note` the moment `sale_mode` is `proposal`, and why saving one writes
 * `price: null` (`SchedulingServicesList`, since 51183ff2).
 *
 * The editor is explicit that the two empties are different answers:
 *
 *     ''   the price is not set yet. The question is open.
 *     '0'  nothing is charged, DELIBERATELY. It is not a question.
 *
 * A quoted service holding `0` is neither. It is a row written before the
 * null-on-save rule existed, and it reads to every later check as "this service
 * is free on purpose".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 *
 * `priceIsFree` hides the sale-shape chips — "they pay by card", "you send an
 * invoice", "you quote first" — on a service deliberately priced at nothing,
 * because there is no amount for the first two to describe. It reads the price
 * field without asking whether the field means anything in this mode, so a
 * quoted service carrying a stale `0` loses the group too.
 *
 * That is a one-way door, and the comment above that gate warns against this
 * exact outcome in as many words: the owner can no longer see that the service
 * is sold by quote, and has no control left to move it to card or invoice.
 * Reported on `הצעת מחיר לשיפוץ`, whose sibling quoted service `חבילת טיפולים`
 * shows its chips correctly for no reason other than holding `null`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REPORTS FIRST AND WRITES ONLY WHEN TOLD
 *
 *   npx tsx scripts/normalise-quoted-service-price.ts
 *   npx tsx scripts/normalise-quoted-service-price.ts --apply
 *   npx tsx scripts/normalise-quoted-service-price.ts --user <uuid> --apply
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ONLY EVER CLEARS A ZERO
 *
 * A quoted service holding a NON-zero price is reported and skipped. Nothing
 * should be able to write one — the field is not editable in this mode — so its
 * presence means something happened that this script does not understand, and a
 * figure somebody typed is not ours to drop on an assumption. A zero carries no
 * information, which is the whole reason it is safe to clear.
 *
 * This fixes the ROWS. It does not fix the rule that misreads them: anything
 * that writes a quoted service's price as 0 again puts the chips back behind
 * the same gate.
 */

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const apply = process.argv.includes('--apply');
const userFlag = process.argv.indexOf('--user');
const userId = userFlag > -1 ? process.argv[userFlag + 1] : null;

interface ServiceRow {
  id: string;
  user_id: string;
  service_name: string | null;
  sale_mode: string | null;
  price: number | null;
  currency: string | null;
  is_active: boolean | null;
}

async function main() {
  let query = sb
    .from('scheduling_services')
    .select('id, user_id, service_name, sale_mode, price, currency, is_active')
    .eq('sale_mode', 'proposal')
    .not('price', 'is', null)
    .order('user_id');

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;

  if (error) {
    console.error('Could not read the services:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as ServiceRow[];

  if (rows.length === 0) {
    console.log(
      userId
        ? 'No quoted service on that account carries a price. Nothing to do.'
        : 'No quoted service anywhere carries a price. Nothing to do.'
    );
    return;
  }

  const clearable = rows.filter(row => Number(row.price) === 0);
  const priced = rows.filter(row => Number(row.price) !== 0);

  console.log(`Quoted services carrying a price: ${rows.length}\n`);

  for (const row of clearable) {
    console.log(
      `  CLEAR  ${row.service_name ?? '(unnamed)'}  price=${row.price} ${row.currency ?? ''}` +
        `  active=${row.is_active}\n         id=${row.id}  owner=${row.user_id}`
    );
  }

  for (const row of priced) {
    console.log(
      `  SKIP   ${row.service_name ?? '(unnamed)'}  price=${row.price} ${row.currency ?? ''}` +
        `  — not zero, so it is not ours to drop\n         id=${row.id}  owner=${row.user_id}`
    );
  }

  if (clearable.length === 0) {
    console.log('\nNothing clearable. Every one of them holds a real figure.');
    return;
  }

  if (!apply) {
    console.log(`\nNothing was changed. Re-run with --apply to clear ${clearable.length}.`);
    return;
  }

  /* One row at a time: the list above is what the operator approved, and a
     filtered bulk update could match something written since they read it. */
  let cleared = 0;

  for (const row of clearable) {
    const { error: updateError } = await sb
      .from('scheduling_services')
      .update({ price: null })
      .eq('id', row.id)
      .eq('sale_mode', 'proposal')
      .eq('price', 0);

    if (updateError) {
      console.error(`  FAILED ${row.service_name}: ${updateError.message}`);
      continue;
    }

    cleared += 1;
  }

  console.log(`\nCleared ${cleared} of ${clearable.length}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
