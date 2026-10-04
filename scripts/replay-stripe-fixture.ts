/**
 * replay-stripe-fixture — signs a Business OS billing fixture locally and posts
 * it to a LOCAL dev server's Stripe webhook, for the plan payments P-1 demo
 * (workplan §11). Nothing is sent through Stripe, so production never receives
 * these events.
 *
 * Scenarios (built from `invoice-paid-unknown-price.json`, with a fresh
 * `evt_replay_<uuid>` id so the claim table never short-circuits it):
 *   hazard    `metadata.user_id` = --user and `credits: 5000` on the invoice:
 *             the shape the removed Pilot-Credit conversion would have credited.
 *             Expected: 200 and a `bos_billing_event_denied unknown_price` line.
 *   mismatch  `product: business_os_plan` on the invoice with an unknown price.
 *             Expected: 200 and an `error` line with `alert: true`.
 *
 * Refuses any target that is not localhost / 127.0.0.1. Uses the local
 * STRIPE_WEBHOOK_SECRET; never prints it.
 *
 * USAGE
 *   npx tsx scripts/replay-stripe-fixture.ts hazard --user <test-account-uuid> [--url http://localhost:3000] [--env .env.local]
 *   npx tsx scripts/replay-stripe-fixture.ts mismatch
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';

const FIXTURE = path.join(process.cwd(), 'lib/business-os/billing/__tests__/fixtures/stripe/invoice-paid-unknown-price.json');
const out = (line: string) => process.stdout.write(`${line}\n`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const scenario = process.argv[2];
  if (scenario !== 'hazard' && scenario !== 'mismatch') {
    out('usage: replay-stripe-fixture.ts <hazard|mismatch> [--user <uuid>] [--url http://localhost:3000]');
    process.exit(2);
  }

  loadEnv({ path: arg('--env') ?? '.env.local' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    out('STRIPE_WEBHOOK_SECRET is not set');
    process.exit(2);
  }

  const base = new URL(arg('--url') ?? 'http://localhost:3000');
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) {
    out(`Refusing to post to ${base.hostname}: local dev servers only.`);
    process.exit(2);
  }

  const user = arg('--user');
  if (scenario === 'hazard' && !user) {
    out('hazard needs --user <designated test account uuid>');
    process.exit(2);
  }

  const event = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown> & {
    data: { object: { metadata: Record<string, string> } };
  };
  delete event._fixture_source;
  event.id = `evt_replay_${crypto.randomUUID()}`;
  event.livemode = false;
  event.data.object.metadata =
    scenario === 'hazard' ? { user_id: user!, credits: '5000' } : { product: 'business_os_plan' };

  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });

  const res = await fetch(new URL('/api/stripe/webhook', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  out(`${scenario}: ${event.id} → HTTP ${res.status} ${await res.text()}`);
  out('Look for the bos_billing_event_denied line with this stripeEventId in the dev server log.');
}

main().catch((err: unknown) => {
  out(`replay failed: ${(err as Error).message}`);
  process.exit(1);
});
