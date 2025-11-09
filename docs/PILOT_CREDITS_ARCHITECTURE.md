# Pilot Credits Architecture

## Overview

This document defines the complete architecture for Pilot Credits vs LLM Tokens in NeuronForge.

## Core Principle

**Pilot Credits** are the user-facing currency. Behind the scenes, we convert to **LLM tokens** for consumption calculations.

## Conversion Rate

```
1 Pilot Credit = 10 LLM Tokens
```

This is stored in `ais_system_config`:
- `tokens_per_pilot_credit`: 10
- `pilot_credit_cost_usd`: 0.00048

## Architecture Layers

### 1. User-Facing Layer (UI)
**Always display Pilot Credits**

- Stripe checkout: "1,000 Pilot Credits"
- Balance display: "1,050 Pilot Credits"
- Transaction history: "+1,000 Pilot Credits"
- Invoices: "1,000 Pilot Credits allocated"

### 2. Storage Layer (Database)
**Always store as tokens**

```sql
-- user_subscriptions table
balance: 10500          -- tokens (= 1,050 Pilot Credits)
total_earned: 10500     -- tokens
total_spent: 0          -- tokens

-- credit_transactions table
credits_delta: 10000    -- tokens (= 1,000 Pilot Credits)
balance_before: 500     -- tokens
balance_after: 10500    -- tokens
```

### 3. Stripe Layer
**Store Pilot Credits in metadata**

```javascript
// Stripe price metadata
metadata: {
  credits: "1000",  // Pilot Credits
  user_id: "..."
}

// Stripe session metadata
metadata: {
  credits: "1000",  // Pilot Credits
  user_id: "..."
}
```

### 4. Webhook Layer
**Convert Pilot Credits → Tokens**

```typescript
// When webhook receives payment
const pilotCredits = parseInt(invoice.metadata?.credits || '0');
const tokens = pilotCredits * 10;

// Store tokens in database
balance: currentBalance + tokens
```

### 5. Consumption Layer
**Use tokens for LLM calculations**

```typescript
// When agent runs
const llmTokensUsed = 1234;  // From LLM API
const pilotCredits = await tokensToPilotCredits(llmTokensUsed, supabase);
// pilotCredits = Math.ceil(1234 / 10) = 124 Pilot Credits

// Deduct tokens from balance
newBalance = currentBalance - (pilotCredits * 10);
```

## Implementation Checklist

### ✅ Completed

1. **BillingSettings.tsx**
   - `formatCredits()` divides tokens by 10 to display Pilot Credits
   - Balance, total_earned, total_spent all converted for display

2. **Stripe Webhook** (`app/api/stripe/webhook/route.ts`)
   - `handleInvoicePaid()`: Converts Pilot Credits → tokens
   - `handleCheckoutCompleted()`: Converts Pilot Credits → tokens

3. **CreditService.ts**
   - `initializeUser()`: Stores trial as tokens (1,000 Pilot Credits = 10,000 tokens)
   - `chargeForExecution()`: Uses `tokensToPilotCredits()` for conversion
   - `chargeForCreation()`: Uses `tokensToPilotCredits()` for conversion

4. **StripeService.ts**
   - Keeps Pilot Credits in Stripe metadata (user-facing)
   - Webhook handles conversion to tokens

### 🔄 Database State (Fixed)

Current correct state for test user:
```
Balance: 10,500 tokens = 1,050 Pilot Credits
  - 500 tokens (50 Pilot Credits) from initial reward
  - 10,000 tokens (1,000 Pilot Credits) from Stripe purchase

Transactions:
1. reward_credit: +500 tokens (+50 Pilot Credits)
2. boost_pack_purchase: +10,000 tokens (+1,000 Pilot Credits)
```

## Key Functions

### Display (UI → User)
```typescript
const formatCredits = (tokens: number) => {
  const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
  return new Intl.NumberFormat().format(pilotCredits);
};
```

### Purchase (User → Database)
```typescript
// Webhook receives Pilot Credits
const pilotCredits = parseInt(metadata.credits);
const tokens = pilotCredits * tokensPerPilotCredit;
// Store tokens in database
```

### Consumption (LLM → Database)
```typescript
// LLM API returns tokens used
const llmTokensUsed = response.usage.total_tokens;
const pilotCredits = await tokensToPilotCredits(llmTokensUsed, supabase);
// Deduct: pilotCredits * tokensPerPilotCredit from balance
```

## Testing

### Test Purchase Flow
1. User sees: "Purchase 1,000 Pilot Credits for $0.48"
2. Stripe metadata: `credits: "1000"` (Pilot Credits)
3. Webhook converts: 1,000 × 10 = 10,000 tokens
4. Database stores: 10,000 tokens
5. UI displays: 1,000 Pilot Credits (10,000 ÷ 10)

### Test Consumption Flow
1. Agent uses 1,234 LLM tokens
2. Convert: Math.ceil(1,234 ÷ 10) = 124 Pilot Credits
3. Deduct: 124 × 10 = 1,240 tokens from balance
4. UI shows: -124 Pilot Credits

## Migration Notes

If you need to convert existing data:

**From Pilot Credits to Tokens (multiply by 10):**
```typescript
balance = balance * 10
credits_delta = credits_delta * 10
```

**From Tokens to Pilot Credits (divide by 10):**
```typescript
balance = Math.floor(balance / 10)
credits_delta = Math.floor(credits_delta / 10)
```

## Why This Architecture?

1. **User-friendly**: Users see simple "Pilot Credits" everywhere
2. **Accurate billing**: LLM tokens map directly to costs
3. **Flexible**: Can adjust conversion rate in config
4. **Scalable**: Handles different LLM providers with different token costs
5. **Transparent**: Metadata preserves both Pilot Credits and tokens

## Important Rules

1. ❌ **NEVER** store Pilot Credits in balance columns
2. ✅ **ALWAYS** store tokens in balance columns
3. ✅ **ALWAYS** display Pilot Credits to users
4. ✅ **ALWAYS** use `tokensToPilotCredits()` for LLM consumption
5. ✅ **ALWAYS** convert Pilot Credits → tokens in webhooks
6. ❌ **NEVER** mix Pilot Credits and tokens without conversion

## Future Enhancements

1. Fetch `tokens_per_pilot_credit` from database in webhooks
2. Support multiple LLM providers with different token costs
3. Add admin panel to adjust conversion rate
4. Add audit trail for all conversions
