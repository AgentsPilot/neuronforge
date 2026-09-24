/**
 * resend-webhook-smoke — prove the Resend webhook works before trusting it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The webhook is the one endpoint nobody can exercise by using the product:
 * it is called by Resend, signed with a secret, and its failure mode is silence
 * — `opened_at` simply stays null and no screen says why. The three things that
 * break it are indistinguishable from the outside: a wrong secret, a clock more
 * than five minutes out, and a message id matching no row.
 *
 * This sends a correctly signed event at a running server and prints which of
 * those it hit, so the setup can be confirmed on a laptop rather than by
 * deploying and waiting to see whether numbers appear.
 *
 * It writes nothing of its own: the event it sends names a message id, and if
 * no `email_sends` row carries that id the route answers 200 and records
 * nothing. That is the default, and it still proves the signature path.
 *
 * USAGE
 *   npm run resend:smoke                       against localhost:3000
 *   npm run resend:smoke -- --url https://…    against a deployed host
 *   npm run resend:smoke -- --id <message-id>  use a real provider_message_id
 *   npm run resend:smoke -- --type email.clicked
 *
 * Reads RESEND_WEBHOOK_SECRET from the environment — the same value the server
 * reads, so a mismatch here is a mismatch there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHmac, randomUUID } from 'crypto';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET is not set. Add it to .env.local first.');
    process.exit(1);
  }

  const base = arg('url', 'http://localhost:3000').replace(/\/$/, '');
  const url = `${base}/api/webhooks/resend`;
  const type = arg('type', 'email.opened');
  const messageId = arg('id', `smoke-${randomUUID()}`);

  const body = JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: messageId },
  });

  /*
   * Signed exactly as Svix signs: `id.timestamp.body`, HMAC-SHA256 with the
   * secret decoded from base64 after its `whsec_` prefix, result base64, sent
   * as `v1,<signature>`. Any deviation here and the test would prove nothing
   * about the real thing.
   */
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  console.log(`POST ${url}`);
  console.log(`     ${type}  email_id=${messageId}\n`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
      body,
    });
  } catch (err) {
    console.error(`Could not reach ${url} — is the server running?`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const text = await response.text();
  console.log(`${response.status}  ${text}\n`);

  // What each answer means, so the result needs no interpreting.
  if (response.status === 401) {
    console.log('REJECTED. Either the secret here differs from the server\'s, or');
    console.log('the clock is more than 300 seconds out. Check both.');
  } else if (response.status === 500) {
    console.log('SIGNATURE OK, write failed. The route is reachable and trusted;');
    console.log('the database rejected the update. Check the server log.');
  } else if (text.includes('unknown message id')) {
    console.log('SIGNATURE OK. No email_sends row carries that message id, which');
    console.log('is expected with a made-up one — pass --id <provider_message_id>');
    console.log('from a real row to see the write land.');
  } else if (text.includes('already recorded')) {
    console.log('SIGNATURE OK. The row matched but this event added nothing new.');
  } else if (response.ok) {
    console.log('RECORDED. Signature verified and the row was updated.');
  }
}

main();
