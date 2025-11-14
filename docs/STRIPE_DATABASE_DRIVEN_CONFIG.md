# Stripe Integration: Database-Driven Configuration

## ✅ All Configuration is Database-Driven

This document confirms that the Stripe billing integration is **fully database-driven** with no business logic hardcoded.

---

## Database-Driven Parameters

### 1. **Pilot Credit Pricing** ✅ Database-Driven
**Table**: `ais_system_config`
**Keys**:
- `pilot_credit_cost_usd` (default: 0.00048)
- `tokens_per_pilot_credit` (default: 10)

**Used in**:
- [lib/stripe/StripeService.ts:112-120](lib/stripe/StripeService.ts#L112-L120)

```typescript
// Fetches from database on every checkout
const { data: configData } = await supabase
  .from('ais_system_config')
  .select('config_key, config_value')
  .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

const pricePerCredit = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
```

**Admin Can Change**:
```sql
UPDATE ais_system_config
SET config_value = '0.00050'  -- Change from $0.00048 to $0.00050
WHERE config_key = 'pilot_credit_cost_usd';
```

---

### 2. **Grace Period (Payment Failure)** ✅ Database-Driven
**Table**: `ais_system_config` (system default) OR `user_subscriptions` (per-user)
**Key**: `payment_grace_period_days` (default: 3)

**Used in**:
- [app/api/stripe/webhook/route.ts:165-176](app/api/stripe/webhook/route.ts#L165-L176)

```typescript
// Fetch grace period from system config if not set per-user
let gracePeriodDays = userSub?.grace_period_days;

if (!gracePeriodDays) {
  const { data: configData } = await supabaseAdmin
    .from('ais_system_config')
    .select('config_value')
    .eq('config_key', 'payment_grace_period_days')
    .maybeSingle();

  gracePeriodDays = configData ? parseInt(configData.config_value) : 3;
}
```

**Priority Order**:
1. User-specific: `user_subscriptions.grace_period_days`
2. System default: `ais_system_config.payment_grace_period_days`
3. Hardcoded fallback: 3 days (only if both are null)

**Admin Can Change**:
```sql
-- System-wide default
UPDATE ais_system_config
SET config_value = '5'
WHERE config_key = 'payment_grace_period_days';

-- Or per-user override
UPDATE user_subscriptions
SET grace_period_days = 7
WHERE user_id = 'specific-user-id';
```

---

### 3. **Boost Pack Pricing** ✅ Database-Driven
**Table**: `boost_packs`
**Columns**: `credits_amount`, `bonus_credits`, `price_usd`

**Used in**:
- [lib/stripe/StripeService.ts:186-191](lib/stripe/StripeService.ts#L186-L191)

```typescript
// Get boost pack details from database
const { data: boostPack } = await supabase
  .from('boost_packs')
  .select('*')
  .eq('id', boostPackId)
  .single();

// Use database values for checkout
const totalCredits = boostPack.credits_amount + (boostPack.bonus_credits || 0);
```

**Admin Can Change**:
```sql
-- Update boost pack pricing
UPDATE boost_packs
SET price_usd = 25.00, bonus_credits = 7000
WHERE pack_key = 'boost_100k';
```

---

### 4. **Credit Allocation on Payment** ✅ Dynamic from Invoice
**Source**: Stripe Invoice metadata
**Key**: `invoice.metadata.credits`

**Flow**:
1. User purchases X Pilot Credits
2. Checkout session stores credits in metadata
3. Stripe invoice created with credits in metadata
4. Webhook reads from invoice: `parseInt(invoice.metadata?.credits || '0')`
5. Credits added to user balance

**No hardcoded credit amounts!**

---

## Appropriately Hardcoded Values

These are **business logic constants** that should NOT be configurable:

### Status Values (Database Schema)
```typescript
status: 'active'          // Valid status from user_subscriptions
status: 'past_due'        // Valid status from user_subscriptions
status: 'canceled'        // Valid status from user_subscriptions
status: 'paid'            // Valid invoice status
```

### Transaction Types (Database Schema)
```typescript
transaction_type: 'allocation'           // Credit transactions table enum
activity_type: 'subscription_renewal'   // Credit transactions table enum
activity_type: 'boost_pack_purchase'    // Credit transactions table enum
event_type: 'renewal_success'           // Billing events table enum
event_type: 'renewal_failed'            // Billing events table enum
event_type: 'subscription_canceled'     // Billing events table enum
```

### Technical Constants
```typescript
payment_retry_count: 0    // Reset counter after successful payment
agents_paused: false      // Resume agents after successful payment
/ 100                     // Convert Stripe cents to dollars
* 1000                    // Convert Unix timestamp to milliseconds
```

**Why these are hardcoded**: They are part of the database schema and application logic, not business configuration.

---

## Configuration Management

### Via Database (Recommended)
```sql
-- View all billing configuration
SELECT * FROM ais_system_config
WHERE category = 'billing'
ORDER BY config_key;

-- Update pricing
UPDATE ais_system_config
SET config_value = '0.00055'
WHERE config_key = 'pilot_credit_cost_usd';

-- Update grace period
UPDATE ais_system_config
SET config_value = '5'
WHERE config_key = 'payment_grace_period_days';
```

### Via Admin UI (Future)
The admin UI at `/admin/system-config` allows changing these values without SQL access.

---

## Validation

### Test Database-Driven Pricing

```typescript
// Test script to verify pricing is from database
const { data } = await supabase
  .from('ais_system_config')
  .select('config_key, config_value')
  .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

console.log('Current pricing:', data);
// Should show: pilot_credit_cost_usd = 0.00048
```

### Test Database-Driven Grace Period

```typescript
// Test script to verify grace period is from database
const { data } = await supabase
  .from('ais_system_config')
  .select('config_key, config_value')
  .eq('config_key', 'payment_grace_period_days')
  .single();

console.log('Grace period:', data?.config_value || '3 (fallback)');
```

---

## Summary

| Configuration | Source | Fallback | Configurable By Admin |
|--------------|--------|----------|----------------------|
| Pilot Credit Price | `ais_system_config.pilot_credit_cost_usd` | 0.00048 | ✅ Yes |
| Tokens per Credit | `ais_system_config.tokens_per_pilot_credit` | 10 | ✅ Yes |
| Grace Period (System) | `ais_system_config.payment_grace_period_days` | 3 | ✅ Yes |
| Grace Period (User) | `user_subscriptions.grace_period_days` | System default | ✅ Yes |
| Boost Pack Pricing | `boost_packs` table | N/A | ✅ Yes |
| Status Values | Business logic | N/A | ❌ No (schema) |
| Transaction Types | Business logic | N/A | ❌ No (schema) |

**Result**: ✅ **100% of business configuration is database-driven**

---

## Required Database Setup

To enable all database-driven configuration, add this to `ais_system_config`:

```sql
-- Add grace period configuration
INSERT INTO ais_system_config (
  config_key,
  config_value,
  description,
  category,
  unit
) VALUES (
  'payment_grace_period_days',
  '3',
  'Number of days to wait before pausing agents after a failed payment',
  'billing',
  'days'
)
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value;
```

The other required configs (`pilot_credit_cost_usd`, `tokens_per_pilot_credit`) should already exist from the AIS system setup.

---

**Status**: ✅ All billing configuration is database-driven
**Last Updated**: 2025-01-05
