# Trigger Verification - Phase 3

> **Created:** 2026-07-22
> **Purpose:** Verify cross-capability integration triggers are working correctly

## Overview

Phase 3 includes database triggers that automatically create CRM activities when payment or email events occur. This document provides verification steps and expected behavior.

---

## Payment → CRM Triggers

### 1. Payment Activity Logging

**Trigger:** `log_payment_activity_trigger`
**Location:** `/supabase/migrations/20260722_create_payment_tables.sql` (lines 328-332)
**Function:** `log_payment_activity()` (lines 287-326)

**When it fires:**
- `AFTER INSERT OR UPDATE OF status ON payment_transactions`
- Only when status changes to 'succeeded'
- Only if `contact_id` is not NULL

**What it does:**
- Creates a CRM activity with:
  - `activity_type`: 'payment'
  - `title`: 'Payment Received: $[amount]'
  - `description`: Payment description or 'Payment processed successfully'
  - `auto_logged`: true
  - `source_capability`: 'payments'
  - `source_entity_id`: payment transaction ID
  - `activity_date`: payment paid_at timestamp

**Verification Steps:**

```sql
-- Step 1: Create a test contact
INSERT INTO crm_contacts (user_id, first_name, last_name, email, stage)
VALUES (
  'YOUR_USER_ID',
  'Test',
  'Contact',
  'test@example.com',
  'client'
) RETURNING id;
-- Note the contact_id returned

-- Step 2: Create a succeeded payment
INSERT INTO payment_transactions (
  user_id,
  contact_id,
  amount,
  currency,
  status,
  description,
  paid_at
) VALUES (
  'YOUR_USER_ID',
  'CONTACT_ID_FROM_STEP_1',
  150.00,
  'USD',
  'succeeded',
  'Therapy session',
  now()
);

-- Step 3: Verify activity was created
SELECT *
FROM crm_activities
WHERE contact_id = 'CONTACT_ID_FROM_STEP_1'
  AND activity_type = 'payment'
  AND auto_logged = true
ORDER BY created_at DESC
LIMIT 1;

-- Expected result:
-- title: 'Payment Received: $150'
-- description: 'Therapy session'
-- source_capability: 'payments'
-- auto_logged: true
```

**Expected Behavior:**
- ✅ Activity created immediately after payment insert
- ✅ Activity NOT created if status is 'pending'
- ✅ Activity NOT created if contact_id is NULL
- ✅ Activity created on status update from 'pending' → 'succeeded'

---

### 2. Invoice Auto-Update on Payment

**Trigger:** `update_invoice_on_payment_trigger`
**Location:** `/supabase/migrations/20260722_create_payment_tables.sql` (lines 353-357)
**Function:** `update_invoice_on_payment()` (lines 337-351)

**When it fires:**
- `AFTER INSERT OR UPDATE OF status ON payment_transactions`
- Only when status changes to 'succeeded'
- Only if `invoice_id` is not NULL

**What it does:**
- Updates the linked invoice:
  - Sets `status` = 'paid'
  - Sets `paid_at` = payment's `paid_at` timestamp

**Verification Steps:**

```sql
-- Step 1: Create a test invoice
INSERT INTO payment_invoices (
  user_id,
  invoice_number,
  amount,
  currency,
  status
) VALUES (
  'YOUR_USER_ID',
  'INV-TEST-001',
  200.00,
  'USD',
  'sent'
) RETURNING id;
-- Note the invoice_id returned

-- Step 2: Create a succeeded payment linked to the invoice
INSERT INTO payment_transactions (
  user_id,
  invoice_id,
  amount,
  currency,
  status,
  paid_at
) VALUES (
  'YOUR_USER_ID',
  'INVOICE_ID_FROM_STEP_1',
  200.00,
  'USD',
  'succeeded',
  now()
);

-- Step 3: Verify invoice was updated
SELECT status, paid_at
FROM payment_invoices
WHERE id = 'INVOICE_ID_FROM_STEP_1';

-- Expected result:
-- status: 'paid'
-- paid_at: (timestamp matching payment)
```

**Expected Behavior:**
- ✅ Invoice updated immediately after payment succeeds
- ✅ Invoice NOT updated if payment status is 'pending' or 'failed'
- ✅ Invoice NOT updated if invoice_id is NULL

---

## Email → CRM Trigger

### 3. Email Send Activity Logging

**Trigger:** `log_email_activity_trigger`
**Location:** `/supabase/migrations/20260722_create_email_automation_tables.sql` (lines 410-414)
**Function:** `log_email_activity()` (lines 363-408)

**When it fires:**
- `AFTER INSERT OR UPDATE OF status ON email_sends`
- Only when status changes to 'sent'

**What it does:**
- Creates a CRM activity with:
  - `activity_type`: 'email'
  - `title`: 'Email Sent: [subject]'
  - `description`: Identifies source (sequence, campaign, or manual)
  - `auto_logged`: true
  - `source_capability`: 'email_automation'
  - `source_entity_id`: email send ID
  - `activity_date`: email sent_at timestamp

**Verification Steps:**

```sql
-- Step 1: Create a test contact (if not already created)
INSERT INTO crm_contacts (user_id, first_name, last_name, email, stage)
VALUES (
  'YOUR_USER_ID',
  'Email',
  'Test',
  'emailtest@example.com',
  'lead'
) RETURNING id;
-- Note the contact_id returned

-- Step 2: Create an email sequence
INSERT INTO email_sequences (
  user_id,
  name,
  trigger_type,
  is_active
) VALUES (
  'YOUR_USER_ID',
  'Test Welcome Sequence',
  'manual',
  true
) RETURNING id;
-- Note the sequence_id returned

-- Step 3: Create a sent email
INSERT INTO email_sends (
  user_id,
  contact_id,
  sequence_id,
  subject,
  body_html,
  to_email,
  status,
  sent_at
) VALUES (
  'YOUR_USER_ID',
  'CONTACT_ID_FROM_STEP_1',
  'SEQUENCE_ID_FROM_STEP_2',
  'Welcome to our practice!',
  '<p>Welcome!</p>',
  'emailtest@example.com',
  'sent',
  now()
);

-- Step 4: Verify activity was created
SELECT *
FROM crm_activities
WHERE contact_id = 'CONTACT_ID_FROM_STEP_1'
  AND activity_type = 'email'
  AND auto_logged = true
ORDER BY created_at DESC
LIMIT 1;

-- Expected result:
-- title: 'Email Sent: Welcome to our practice!'
-- description: 'Automated email from sequence'
-- source_capability: 'email_automation'
-- auto_logged: true
```

**Expected Behavior:**
- ✅ Activity created immediately after email send insert with status='sent'
- ✅ Activity NOT created if status is 'pending'
- ✅ Description shows 'Automated email from sequence' if sequence_id exists
- ✅ Description shows 'Campaign email' if campaign_id exists
- ✅ Description shows 'Manual email' if neither sequence_id nor campaign_id exist
- ✅ Activity created on status update from 'pending' → 'sent'

---

## Verification Checklist

Use this checklist to confirm all triggers are working:

### Payment Triggers

- [ ] **Payment → CRM Activity**
  - [ ] Activity created when payment inserted with status='succeeded'
  - [ ] Activity created when payment updated from 'pending' to 'succeeded'
  - [ ] Activity NOT created when payment has no contact_id
  - [ ] Activity NOT created when status is 'pending' or 'failed'
  - [ ] Activity title includes amount: "Payment Received: $[amount]"
  - [ ] Activity is marked as auto_logged=true
  - [ ] Activity source_capability='payments'

- [ ] **Payment → Invoice Update**
  - [ ] Invoice status updated to 'paid' when payment succeeds
  - [ ] Invoice paid_at timestamp matches payment paid_at
  - [ ] Invoice NOT updated when payment status is not 'succeeded'
  - [ ] Invoice NOT updated when payment has no invoice_id

### Email Triggers

- [ ] **Email Send → CRM Activity**
  - [ ] Activity created when email inserted with status='sent'
  - [ ] Activity created when email updated from 'pending' to 'sent'
  - [ ] Activity title includes subject: "Email Sent: [subject]"
  - [ ] Activity description shows correct source (sequence/campaign/manual)
  - [ ] Activity is marked as auto_logged=true
  - [ ] Activity source_capability='email_automation'
  - [ ] Activity created for all three sources: sequence, campaign, manual

---

## Testing in Development

### Quick Test Script

```sql
-- Test all triggers in one script (replace YOUR_USER_ID with actual user UUID)

BEGIN;

-- Create test contact
INSERT INTO crm_contacts (user_id, first_name, last_name, email, stage)
VALUES ('YOUR_USER_ID', 'Trigger', 'Test', 'triggertest@example.com', 'client')
RETURNING id;
-- Copy the contact_id and paste below

-- Create test invoice
INSERT INTO payment_invoices (user_id, invoice_number, amount, currency, status)
VALUES ('YOUR_USER_ID', 'INV-TRIGGER-TEST', 100.00, 'USD', 'sent')
RETURNING id;
-- Copy the invoice_id and paste below

-- Test 1: Payment → CRM Activity (with contact)
INSERT INTO payment_transactions (
  user_id, contact_id, amount, currency, status, description, paid_at
) VALUES (
  'YOUR_USER_ID', 'CONTACT_ID_HERE', 100.00, 'USD', 'succeeded', 'Trigger test payment', now()
);

-- Test 2: Payment → Invoice Update
INSERT INTO payment_transactions (
  user_id, invoice_id, amount, currency, status, paid_at
) VALUES (
  'YOUR_USER_ID', 'INVOICE_ID_HERE', 100.00, 'USD', 'succeeded', now()
);

-- Test 3: Email Send → CRM Activity
INSERT INTO email_sequences (user_id, name, trigger_type, is_active)
VALUES ('YOUR_USER_ID', 'Trigger Test Sequence', 'manual', true)
RETURNING id;
-- Copy the sequence_id and paste below

INSERT INTO email_sends (
  user_id, contact_id, sequence_id, subject, body_html, to_email, status, sent_at
) VALUES (
  'YOUR_USER_ID', 'CONTACT_ID_HERE', 'SEQUENCE_ID_HERE',
  'Trigger Test Email', '<p>Test</p>', 'triggertest@example.com', 'sent', now()
);

-- Verify all triggers fired
SELECT
  activity_type,
  title,
  description,
  source_capability,
  auto_logged
FROM crm_activities
WHERE contact_id = 'CONTACT_ID_HERE'
ORDER BY created_at DESC;

-- Expected: 2 activities (1 payment, 1 email)

SELECT status, paid_at
FROM payment_invoices
WHERE id = 'INVOICE_ID_HERE';

-- Expected: status='paid', paid_at not null

ROLLBACK; -- Clean up test data
```

---

## Production Verification

Once deployed to production:

1. **Monitor CRM activity logs** after the first real payment/email
2. **Check for auto_logged=true entries** in the CRM activities table
3. **Verify source_capability** matches the originating capability
4. **Confirm no duplicate activities** are created for the same event

---

## Troubleshooting

### Trigger Not Firing

**Problem:** Activity not created when payment/email status changes

**Possible Causes:**
1. Trigger was not created during migration
2. RLS policies preventing insert into crm_activities
3. Foreign key constraint violation (contact doesn't exist)

**Debugging:**
```sql
-- Check if trigger exists
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgrelid = 'payment_transactions'::regclass
  AND tgname LIKE 'log_%';

-- Check if function exists
SELECT proname, prosrc
FROM pg_proc
WHERE proname LIKE 'log_%activity';

-- Check RLS policies on crm_activities
SELECT tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'crm_activities';
```

### Duplicate Activities

**Problem:** Multiple activities created for same payment/email

**Possible Causes:**
1. Trigger fires on both INSERT and UPDATE
2. Status changes multiple times

**Solution:** Trigger includes check `(OLD IS NULL OR OLD.status != 'sent')` to prevent duplicates on subsequent updates

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-22 | Created | Initial trigger verification documentation for Phase 3 |
