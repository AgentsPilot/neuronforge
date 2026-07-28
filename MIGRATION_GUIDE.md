# Migration Guide: Apply Onboarding-v2 Database Tables

## Quick Start

Apply these 4 migrations in order via Supabase Dashboard SQL Editor:

**Dashboard SQL Editor:** https://supabase.com/dashboard/project/jgccgkyhpwirgknnceoh/sql/new

---

## Migration 1: Business Profiles

**File:** `supabase/migrations/20260721_create_business_profiles.sql`

1. Open the SQL editor
2. Copy the entire contents of the file
3. Paste and click "Run"
4. ✅ Should see: "Success. No rows returned"

---

## Migration 2: Onboarding Conversations

**File:** `supabase/migrations/20260721_create_onboarding_conversations.sql`

1. Copy the entire contents
2. Paste in SQL editor
3. Click "Run"
4. ✅ Should see: "Success. No rows returned"

---

## Migration 3: Website Tables (FIXED VERSION)

**File:** `supabase/migrations/20260721_create_website_tables_fixed.sql` ⭐

**IMPORTANT:** Use the FIXED version (not the original `20260721_create_website_tables.sql`)

1. Copy the entire contents of the **FIXED** file
2. Paste in SQL editor
3. Click "Run"
4. ✅ Should see: "Success. No rows returned"

---

## Migration 4: CRM Tables

**File:** `supabase/migrations/20260721_create_crm_tables.sql`

1. Copy the entire contents
2. Paste in SQL editor
3. Click "Run"
4. ✅ Should see: "Success. No rows returned"

---

## Verify Migrations Applied

After running all 4 migrations, verify the tables exist:

```sql
-- Run this query to see all new tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'business_profiles',
    'onboarding_conversations',
    'website_pages',
    'website_blocks',
    'website_templates',
    'crm_contacts',
    'crm_activities',
    'crm_pipeline_stages'
  )
ORDER BY table_name;
```

**Expected result:** 8 tables

---

## What These Tables Do

| Table | Purpose |
|-------|---------|
| `business_profiles` | Stores user's business info (vertical, services, tools, onboarding status) |
| `onboarding_conversations` | Chat history during onboarding |
| `website_templates` | Pre-built templates (therapist, coach, consultant) |
| `website_pages` | User's website pages |
| `website_blocks` | Block content for pages (hero, services, CTA, etc.) |
| `crm_contacts` | Contact database |
| `crm_activities` | Activity log (calls, emails, bookings, payments) |
| `crm_pipeline_stages` | Pipeline configuration by vertical |

---

## After Migrations Complete

Once all migrations are applied:

1. **Restart your Next.js dev server** (to clear any cached errors)
   ```bash
   # Stop the server (Ctrl+C)
   npm run dev
   ```

2. **Test the flow:**
   - Log out of your account
   - Log back in
   - You should be redirected to `/onboarding-v2` 🎉

3. **Upload a test bio:**
   - Create a file `test-bio.txt` with:
     ```
     I'm a therapist in Los Angeles specializing in trauma therapy.
     I see about 20 clients per week and use Google Calendar and Stripe.
     My website is therapypractice.com.
     ```
   - Upload it in onboarding-v2
   - See the profile preview
   - Click "Build Everything!"

---

## Troubleshooting

### Error: "relation already exists"

If you see this error, it means you already ran that migration. Safe to ignore and continue to the next one.

### Error: "permission denied"

Make sure you're using the Service Role key in the SQL editor (should be selected by default in Supabase Dashboard).

### Error: "relation does not exist"

You skipped a migration or ran them out of order. Start from Migration 1 again.

### Middleware still not redirecting

1. Check that all 4 migrations completed successfully
2. Restart your dev server
3. Clear your browser cookies for localhost
4. Log out and log back in

---

## Files Reference

```
supabase/migrations/
├── 20260721_create_business_profiles.sql           ✅ Use this
├── 20260721_create_onboarding_conversations.sql    ✅ Use this
├── 20260721_create_website_tables.sql              ❌ SKIP (has bug)
├── 20260721_create_website_tables_fixed.sql        ✅ Use this instead
└── 20260721_create_crm_tables.sql                  ✅ Use this
```

---

## Next Steps After Migrations

After completing migrations and testing onboarding:

1. **Phase 2: Build CRM UI** (Kanban pipeline view)
2. **Phase 3: Build Scheduling capability**
3. **Phase 4: Build Payments capability**
4. **Phase 5: Dashboard redesign** (V2 capability cards)

Current status: **Phase 1 Complete** ✅ (Database + Onboarding UI + API)
