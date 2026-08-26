# Apply Service Revenue Migration

This guide walks you through applying the database changes to enable "Revenue by Service" tracking in the Cash Flow dashboard.

## What This Migration Does

1. Adds `service_id` column to `payment_invoices` table
2. Adds `service_id` column to `payment_transactions` table
3. Adds `total_amount` column to `scheduling_bookings` table
4. Backfills existing completed bookings with service prices
5. Creates indexes for efficient querying

## Steps to Apply

### Option 1: Supabase Dashboard (Recommended)

1. **Go to your Supabase project dashboard**
   - Navigate to: [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Copy and paste the migration SQL**
   - Open: `supabase/migrations/20260809_add_service_id_to_payments.sql`
   - Copy all contents
   - Paste into the SQL Editor

4. **Run the migration**
   - Click "Run" button (or press Cmd/Ctrl + Enter)
   - Wait for completion (should take < 5 seconds)
   - Verify you see "Success" message

5. **Apply seed data (optional - for testing)**
   - Open a new query in SQL Editor
   - Copy contents of: `supabase/migrations/20260804_seed_business_data_for_insights.sql`
   - Click "Run"
   - This will create test data with service connections

### Option 2: Supabase CLI (if linked)

```bash
# If you have Supabase CLI linked to your project
npx supabase db push
```

## Verification

After applying the migration, verify the changes:

```sql
-- Check that service_id column exists on payment_invoices
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payment_invoices'
  AND column_name = 'service_id';

-- Check that service_id column exists on payment_transactions
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payment_transactions'
  AND column_name = 'service_id';

-- Check that total_amount column exists on scheduling_bookings
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'scheduling_bookings'
  AND column_name = 'total_amount';

-- Check backfilled data (if you have existing bookings)
SELECT COUNT(*) as bookings_with_amount
FROM scheduling_bookings
WHERE total_amount IS NOT NULL
  AND status = 'completed';
```

## What Changes in the App

After this migration, the Cash Flow dashboard will show:

### Revenue by Service Section
- Displays top 6 services by revenue
- Shows revenue amount and booking count for each service
- Uses color-coded bars for visual breakdown
- Example:
  ```
  ייעוץ עסקי:      ₪11,250  (58%)  25 bookings
  קואצינג אישי:    ₪6,500   (33%)  10 bookings
  סדנה קבוצתית:    ₪1,750   (9%)   7 bookings
  ```

### Updated Data Tracking
- Payment transactions now linked to services
- Invoices now linked to services
- Completed bookings store revenue amounts
- Better revenue analytics by service type

## Files Modified

1. **New Migration:**
   - `supabase/migrations/20260809_add_service_id_to_payments.sql`

2. **Updated Seed Data:**
   - `supabase/migrations/20260804_seed_business_data_for_insights.sql`
   - Now includes service_id for all payments and invoices
   - Bookings include total_amount matching service prices

3. **Frontend Components (Already Created):**
   - `components/business-os/reports/RevenueByServicesSection.tsx`
   - `app/business-os/reports/page.tsx` (updated layout)

4. **API Route (Already Updated):**
   - `app/api/business-os/stats/route.ts` (includes service revenue query)

## Troubleshooting

### Error: column "service_id" already exists
This means the migration was already applied. You can skip it.

### Error: relation "scheduling_services" does not exist
You need to run earlier migrations first. Make sure your database has the `scheduling_services` table.

### No data showing in Revenue by Service
1. Make sure you have completed bookings with service_id set
2. Run the seed data migration to populate test data
3. Check that bookings have `total_amount` values

### Backfill didn't work
If existing bookings don't have `total_amount`, run this SQL manually:

```sql
UPDATE scheduling_bookings sb
SET total_amount = ss.price
FROM scheduling_services ss
WHERE sb.service_id = ss.id
  AND sb.total_amount IS NULL
  AND sb.status = 'completed';
```

## Next Steps

After applying the migration:

1. ✅ Refresh your Cash Flow dashboard
2. ✅ Check the "Revenue by Service" section appears
3. ✅ Verify data is displaying correctly
4. ✅ Create new bookings/payments and verify they track service_id

## Rollback (if needed)

If you need to remove the changes:

```sql
-- Remove columns (WARNING: This deletes data!)
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS service_id;
ALTER TABLE payment_transactions DROP COLUMN IF EXISTS service_id;
ALTER TABLE scheduling_bookings DROP COLUMN IF EXISTS total_amount;

-- Drop indexes
DROP INDEX IF EXISTS idx_payment_invoices_service_id;
DROP INDEX IF EXISTS idx_payment_transactions_service_id;
```
