/**
 * Seed the admin_users allow-list from the ADMIN_EMAILS env var.
 *
 * ADMIN_EMAILS is a comma/semicolon/whitespace-separated list of admin emails, e.g.
 *   ADMIN_EMAILS=meiribarak@gmail.com,ops@example.com
 *
 * For each email this script:
 *   1. Resolves the auth.users id (if the person already has an account).
 *   2. Upserts a row into admin_users (idempotent on email; re-activates soft-revoked rows).
 *
 * Emails without an account yet are still seeded (user_id = null) and get bound to a
 * user_id automatically on the admin's first authenticated admin check (self-heal).
 *
 * Run:  npx tsx scripts/seed-admin-users.ts
 *
 * NOTE: uses an inline service-role client (not the repository) because dotenv must be
 * configured before the Supabase client is created — mirrors the other scripts/ files.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || '';
  return Array.from(
    new Set(
      raw
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

/** Build an email -> user_id map from auth.users (paginated). */
async function buildEmailToUserId(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email) map.set(u.email.trim().toLowerCase(), u.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return map;
}

async function main() {
  const emails = parseAdminEmails();
  console.log('='.repeat(70));
  console.log('SEEDING admin_users FROM ADMIN_EMAILS');
  console.log('='.repeat(70));

  if (emails.length === 0) {
    console.warn('\nADMIN_EMAILS is empty — nothing to seed.');
    console.warn('Set ADMIN_EMAILS in .env.local, e.g. ADMIN_EMAILS=you@example.com\n');
    return;
  }

  console.log(`\nAdmin emails (${emails.length}): ${emails.join(', ')}\n`);

  const emailToUserId = await buildEmailToUserId();

  for (const email of emails) {
    const userId = emailToUserId.get(email) ?? null;

    const { error } = await supabase
      .from('admin_users')
      .upsert(
        { email, user_id: userId, is_active: true, notes: 'Seeded from ADMIN_EMAILS' },
        { onConflict: 'email' }
      );

    if (error) {
      console.log(`  ❌ ${email} — ${error.message}`);
    } else {
      console.log(`  ✅ ${email} ${userId ? `(bound to ${userId})` : '(no account yet — will bind on first login)'}`);
    }
  }

  console.log('\nDone. admin_users is now the source of truth for AdminAccessService.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
