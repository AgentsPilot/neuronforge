/**
 * Give every instalment service the `payment_plans` row the client is shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPAIRS
 *
 * "Is this service paid in instalments" had two answers, and the Services
 * settings wrote only one of them:
 *
 *   `scheduling_services.payment_type` + `installment_count`
 *       what the SERVER trusts — read by `website/payment-intent`,
 *       `website/checkout` and `booking/finalize`
 *
 *   a row in `payment_plans`
 *       what the CLIENT is shown — read by the public booking dialog, the
 *       contact drawer and `PaymentReminderService`
 *
 * So a service configured as instalments had a server that knew it was a plan
 * and a dialog that did not. The dialog quoted the full price, the payment step
 * charged the full price, and because `finalize` correctly defers a plan's money
 * to the webhook, nothing was recorded at all — leaving a booking marked paid
 * with no transaction and a refund dialog offering zero.
 *
 * `lib/payments/syncServicePaymentPlan.ts` closes it going forward, on every
 * service save. This brings the existing ones over.
 *
 * WHAT IT DOES, PER SERVICE
 *
 *   instalments, no active plan row     CREATES one
 *   instalments, one active plan row    LEFT ALONE. It is already correct, or
 *                                       it is deliberately different and that
 *                                       is the owner's to change in the UI.
 *   instalments, several active rows    LEFT ALONE and reported. Which one is
 *                                       right is a business decision, not this
 *                                       script's — see below.
 *   not instalments                     LEFT ALONE. Deactivating a stale row is
 *                                       the save path's job, where a person is
 *                                       present; doing it in bulk here could
 *                                       switch off a plan whose subscription is
 *                                       still charging a client.
 *
 * WHY SEVERAL IS REPORTED RATHER THAN RESOLVED: one live service was found
 * carrying two active plans that disagreed — 2000 ILS as 3×600 and 8500 ILS as
 * 2×4250. The public dialog silently quotes the OLDEST. Picking for the owner
 * would either change what a client is charged or hide the conflict; both are
 * worse than saying so.
 *
 * SAFE BY DEFAULT: prints what it would do and changes nothing. Pass --apply.
 *
 *   npx tsx scripts/backfill-service-payment-plans.ts
 *   npx tsx scripts/backfill-service-payment-plans.ts --user <uuid>
 *   npx tsx scripts/backfill-service-payment-plans.ts --apply
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { isInstallmentPlan } from '../lib/payments/PaymentPlanService';
import { planPhases } from '../lib/payments/planSchedule';
import { fromMinorUnits } from '../lib/payments/refundMath';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const userArgIndex = args.indexOf('--user');
const userId = userArgIndex >= 0 ? args[userArgIndex + 1] : null;

interface ServiceRow {
  id: string;
  user_id: string;
  service_name: string | null;
  price: number | null;
  currency: string | null;
  payment_type: string | null;
  installment_count: number | null;
  installment_frequency: string | null;
}

interface PlanRow {
  id: string;
  service_id: string | null;
  created_at: string;
  total_amount: number | null;
  installment_count: number | null;
  installment_amount: number | null;
}

async function main() {
  let servicesQuery = db
    .from('scheduling_services')
    .select('id, user_id, service_name, price, currency, payment_type, installment_count, installment_frequency')
    .eq('payment_type', 'installments');

  if (userId) servicesQuery = servicesQuery.eq('user_id', userId);

  const { data: services, error } = await servicesQuery;

  if (error) {
    console.error('Could not read the services:', error.message);
    process.exit(1);
  }

  const plans = await db
    .from('payment_plans')
    .select('id, service_id, created_at, total_amount, installment_count, installment_amount')
    .eq('is_active', true)
    .not('service_id', 'is', null);

  if (plans.error) {
    console.error('Could not read the payment plans:', plans.error.message);
    process.exit(1);
  }

  const byService = new Map<string, PlanRow[]>();
  for (const plan of (plans.data ?? []) as PlanRow[]) {
    const key = plan.service_id as string;
    byService.set(key, [...(byService.get(key) ?? []), plan]);
  }

  const rows = (services ?? []) as ServiceRow[];
  console.log(
    `${rows.length} service(s) configured as instalments${userId ? ` for ${userId}` : ' across all accounts'}\n`
  );

  let created = 0;
  let alreadyFine = 0;
  const conflicted: string[] = [];
  const skipped: string[] = [];

  for (const service of rows) {
    const label = `${service.id.slice(0, 8)} ${service.service_name ?? '(unnamed)'}`;

    // The same predicate the server uses, so this cannot disagree with it about
    // what counts as a plan.
    if (!isInstallmentPlan(service)) {
      skipped.push(`${label} — configured as instalments but not a plan (count ≤ 1, or no price)`);
      continue;
    }

    const existing = byService.get(service.id) ?? [];

    if (existing.length > 1) {
      const detail = existing
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(p => `${p.id.slice(0, 8)}=${p.total_amount} as ${p.installment_count}×${p.installment_amount}`)
        .join(', ');
      conflicted.push(`${label} — ${existing.length} active plans: ${detail}`);
      continue;
    }

    if (existing.length === 1) {
      alreadyFine++;
      continue;
    }

    const total = Number(service.price);
    const count = service.installment_count ?? 1;
    const currency = (service.currency || 'USD').toUpperCase();
    const frequency = service.installment_frequency || 'monthly';
    // One period, with the remainder on the last — the same split Stripe's
    // prices are built from, so the quote and the charge agree.
    const installmentAmount = fromMinorUnits(planPhases(total, currency, count)[0].amountMinor, currency);

    console.log(
      `  ${apply ? 'CREATE' : 'would create'}  ${label}\n` +
        `            ${total} ${currency} as ${count} × ${installmentAmount} ${frequency}`
    );

    if (apply) {
      const insert = await db.from('payment_plans').insert({
        user_id: service.user_id,
        service_id: service.id,
        name: service.service_name || 'Payment plan',
        total_amount: total,
        currency,
        supported_currencies: [currency],
        installment_count: count,
        installment_amount: installmentAmount,
        installment_frequency: frequency,
        allowed_processors: ['stripe', 'paypal', 'square', 'manual'],
        is_active: true,
      });

      if (insert.error) {
        console.error(`            FAILED: ${insert.error.message}`);
        continue;
      }
    }

    created++;
  }

  console.log(`\n${apply ? 'Created' : 'Would create'}: ${created}`);
  console.log(`Already had a plan:  ${alreadyFine}`);

  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const line of skipped) console.log(`  ${line}`);
  }

  if (conflicted.length) {
    console.log(`\nNEEDS A DECISION (${conflicted.length}) — left untouched:`);
    for (const line of conflicted) console.log(`  ${line}`);
    console.log(
      '\n  The public dialog quotes the OLDEST of these. Deactivate the wrong one\n' +
        '  in the Services settings; this script will not choose what a client is charged.'
    );
  }

  if (!apply) console.log('\nNothing was changed. Re-run with --apply.');
}

void main();
