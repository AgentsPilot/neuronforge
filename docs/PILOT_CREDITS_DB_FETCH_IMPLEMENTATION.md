# Pilot Credits Database Fetch Implementation

## Overview

All Pilot Credit to LLM token conversions now fetch the conversion rate from the database (`ais_system_config` table) instead of using hardcoded values. This allows dynamic adjustment of the conversion rate without code changes.

## Database Configuration

### Table: `ais_system_config`

```sql
config_key: 'tokens_per_pilot_credit'
config_value: '10'  -- Current: 1 Pilot Credit = 10 LLM tokens
category: 'pricing'
description: 'Number of LLM tokens that 1 Pilot Credit represents'
```

### Future Flexibility

The admin can change this value in the database:
- Current: `tokens_per_pilot_credit = 10`
- Future: `tokens_per_pilot_credit = 1000` (1 Pilot Credit = 1,000 LLM tokens)

## Core Utility Functions

### Location: `lib/utils/pricingConfig.ts`

#### 1. `getPricingConfig(supabase, forceRefresh?)`
Fetches pricing configuration from database with caching (5-minute TTL).

```typescript
const config = await getPricingConfig(supabase);
// Returns: { pilot_credit_cost_usd: 0.00048, tokens_per_pilot_credit: 10 }
```

#### 2. `pilotCreditsToTokens(credits, supabase)`
Converts Pilot Credits → Tokens using database config.

```typescript
const tokens = await pilotCreditsToTokens(1000, supabase);
// 1,000 Pilot Credits → 10,000 tokens (with current config)
```

#### 3. `tokensToPilotCredits(tokens, supabase)`
Converts Tokens → Pilot Credits using database config.

```typescript
const credits = await tokensToPilotCredits(10000, supabase);
// 10,000 tokens → 1,000 Pilot Credits (with current config)
```

## Implementation Status

### ✅ Fully Implemented (Database Fetch)

| File | Function | Usage |
|------|----------|-------|
| **app/api/stripe/webhook/route.ts** | `handleInvoicePaid()` | Converts Stripe Pilot Credits → tokens for storage |
| **app/api/stripe/webhook/route.ts** | `handleCheckoutCompleted()` | Converts Stripe Pilot Credits → tokens for storage |
| **lib/services/CreditService.ts** | `initializeUser()` | Converts trial Pilot Credits → tokens |
| **lib/services/CreditService.ts** | `chargeForExecution()` | Converts LLM tokens → Pilot Credits |
| **lib/services/CreditService.ts** | `chargeForCreation()` | Converts LLM tokens → Pilot Credits |
| **lib/services/AgentIntensityService.ts** | Token calculations | Uses `tokensToPilotCredits()` |
| **components/settings/BillingSettings.tsx** | `formatCredits()` | Uses `pricingConfig.tokens_per_pilot_credit` from database |

### ⚠️ Uses Default Parameter (Backward Compatible)

| File | Function | Default Value | Notes |
|------|----------|---------------|-------|
| **lib/utils/analyticsHelpers.ts** | `formatPilotCredits()` | `tokensPerCredit = 10` | Pass value from `getPricingConfig()` |
| **lib/utils/currencyHelpers.ts** | `creditsToTokens()` | `tokensPerCredit = 10` | Optional parameter |
| **lib/utils/currencyHelpers.ts** | `tokensToCredits()` | `tokensPerCredit = 10` | Optional parameter |

## Usage Examples

### Example 1: Stripe Webhook (Payment Processing)

```typescript
// app/api/stripe/webhook/route.ts
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const pilotCredits = parseInt(invoice.metadata?.credits || '0');

  // Fetch conversion rate from database
  const tokens = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

  // Store tokens in database
  await supabaseAdmin
    .from('user_subscriptions')
    .update({ balance: currentBalance + tokens })
    .eq('user_id', userId);
}
```

### Example 2: Credit Service (User Initialization)

```typescript
// lib/services/CreditService.ts
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';

async initializeUser(userId: string) {
  const trialPilotCredits = 1000;

  // Fetch conversion rate from database
  const trialTokens = await pilotCreditsToTokens(trialPilotCredits, this.supabase);

  // Store tokens in database
  await this.supabase
    .from('user_subscriptions')
    .insert({ user_id: userId, balance: trialTokens });
}
```

### Example 3: Consumption (Agent Execution)

```typescript
// lib/services/CreditService.ts
import { tokensToPilotCredits } from '@/lib/utils/pricingConfig';

async chargeForExecution(userId: string, llmTokensUsed: number) {
  // Fetch conversion rate from database
  const pilotCredits = await tokensToPilotCredits(llmTokensUsed, this.supabase);

  // Deduct from balance (stored as tokens in database)
  const tokensToDeduct = await pilotCreditsToTokens(pilotCredits, this.supabase);
  const newBalance = currentBalance - tokensToDeduct;
}
```

### Example 4: Display (UI Components)

```typescript
// components/settings/BillingSettings.tsx
import { getPricingConfig } from '@/lib/utils/pricingConfig';

const [pricingConfig, setPricingConfig] = useState({ tokens_per_pilot_credit: 10 });

useEffect(() => {
  fetchBillingData();
}, []);

const fetchBillingData = async () => {
  const config = await getPricingConfig(supabase);
  setPricingConfig(config);
};

const formatCredits = (tokens: number) => {
  // Uses fetched config value
  const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
  return new Intl.NumberFormat().format(pilotCredits);
};
```

## Caching Strategy

### Cache Configuration
- **TTL**: 5 minutes
- **Location**: In-memory (per server instance)
- **Invalidation**: Call `clearPricingCache()` after updating config

### When to Clear Cache

```typescript
import { clearPricingCache } from '@/lib/utils/pricingConfig';

// After admin updates pricing config in database
await supabase
  .from('ais_system_config')
  .update({ config_value: '1000' })
  .eq('config_key', 'tokens_per_pilot_credit');

// Clear cache to force reload
clearPricingCache();
```

## Testing

### Verify Current Configuration

```typescript
import { getPricingConfig } from '@/lib/utils/pricingConfig';

const config = await getPricingConfig(supabase);
console.log('Tokens per Pilot Credit:', config.tokens_per_pilot_credit);
// Current: 10
```

### Test Conversion

```typescript
import { pilotCreditsToTokens, tokensToPilotCredits } from '@/lib/utils/pricingConfig';

// Purchase: 1,000 Pilot Credits
const tokens = await pilotCreditsToTokens(1000, supabase);
console.log('Storage:', tokens, 'tokens'); // 10,000 tokens

// Consumption: 1,234 LLM tokens used
const credits = await tokensToPilotCredits(1234, supabase);
console.log('Deduct:', credits, 'Pilot Credits'); // 124 Pilot Credits
```

## Migration Path

### Changing Conversion Rate

1. **Update database:**
   ```sql
   UPDATE ais_system_config
   SET config_value = '1000'
   WHERE config_key = 'tokens_per_pilot_credit';
   ```

2. **Clear cache (optional, or wait 5 minutes):**
   ```typescript
   clearPricingCache();
   ```

3. **New behavior:**
   - 1 Pilot Credit = 1,000 LLM tokens
   - All conversions automatically use new rate
   - No code changes required

### Backward Compatibility

All helper functions with default parameters will continue working:
```typescript
// Still works with default
formatPilotCredits(10000); // Uses default: 10

// Can pass custom value
formatPilotCredits(10000, 1000); // Uses 1000 tokens per credit
```

## Best Practices

1. ✅ **Always use utility functions** - Never hardcode conversion rates
2. ✅ **Fetch config once** - Use caching to avoid repeated database queries
3. ✅ **Pass config down** - Fetch at top level, pass to child components
4. ✅ **Clear cache on update** - Call `clearPricingCache()` after admin changes
5. ❌ **Never hardcode `/ 10` or `* 10`** - Always use utility functions

## Summary

All critical conversion points now fetch from the database:
- ✅ Stripe webhooks (payment processing)
- ✅ Credit service (initialization, charging)
- ✅ Billing UI (display)
- ✅ Agent intensity calculations

The system is now fully flexible and can be adjusted by changing a single database value without any code deployments.
