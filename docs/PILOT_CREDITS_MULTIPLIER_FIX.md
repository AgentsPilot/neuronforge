# Pilot Credits Multiplier Bug Fix

## Issue

When purchasing 1,000 Pilot Credits in the calculator, Stripe showed 10,000 Pilot Credits (10x more).

## Root Cause

The `customCredits` state variable in `BillingSettings.tsx` stores **tokens** (not Pilot Credits), but the API expects **Pilot Credits**.

### The Bug Flow

1. User moves slider to 1,000 Pilot Credits
2. Component stores: `customCredits = 10,000` (tokens = 1,000 * 10)
3. Display shows: `formatCredits(10,000)` = 10,000/10 = **1,000 Pilot Credits** ✓
4. API receives: `pilotCredits: 10,000` (component sends tokens directly)
5. API thinks: 10,000 Pilot Credits (not tokens!)
6. Stripe shows: **10,000 Pilot Credits** ✗
7. Stripe creates: Subscription for 10,000 Pilot Credits ($4.80) instead of 1,000 ($0.48)

### Why This Happened

Line 511-515 in `BillingSettings.tsx`:
```typescript
const formatCredits = (tokens: number) => {
  // Convert tokens to Pilot Credits (1 Pilot Credit = 10 tokens)
  const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
  return new Intl.NumberFormat().format(pilotCredits);
};
```

The display correctly divides by 10, but the API calls were sending the raw `customCredits` value (which is in tokens) without converting to Pilot Credits.

## Solution

Convert tokens to Pilot Credits before sending to API in both:
1. New subscription creation
2. Subscription update

### Files Modified

**File**: `components/settings/BillingSettings.tsx`

**Changes**:

#### 1. Update Subscription Handler (Line 265-268)
```typescript
// Convert tokens to Pilot Credits before sending to API
const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit);

console.log('🔄 Updating existing subscription to:', pilotCreditsToSend, 'Pilot Credits (from', customCredits, 'tokens)');
```

#### 2. New Subscription Handler (Line 296-303)
```typescript
// Convert tokens to Pilot Credits before sending to API
const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit);

console.log('🛒 Starting new subscription with:', {
  purchaseType: 'custom_credits',
  pilotCredits: pilotCreditsToSend,
  tokensInState: customCredits
});
```

#### 3. Alert Message (Line 294)
```typescript
alert(`Subscription updated! Your new amount of ${pilotCreditsToSend.toLocaleString()} Pilot Credits/month will take effect on your next billing date.`);
```

## Testing

### Before Fix
- User selects: 1,000 Pilot Credits
- Stripe creates: 10,000 Pilot Credits ($4.80/month)
- Balance awarded: 100,000 tokens (10,000 Pilot Credits)

### After Fix
- User selects: 1,000 Pilot Credits
- Stripe creates: 1,000 Pilot Credits ($0.48/month)
- Balance awarded: 10,000 tokens (1,000 Pilot Credits)

### Verification

1. Clean database:
   ```bash
   npx ts-node scripts/reset-stripe-subscription.ts
   ```

2. Create subscription:
   - Go to http://localhost:3000/settings?tab=billing
   - Move slider to 1,000 Pilot Credits
   - Click "Start Subscription"
   - Complete payment

3. Verify in Stripe Dashboard:
   - Should show: **1,000 Pilot Credits** ($0.48/month)
   - NOT: 10,000 Pilot Credits

4. Verify in database:
   ```bash
   npx ts-node scripts/check-subscription-details.ts
   ```

   Expected:
   ```
   Balance: 1,050 Pilot Credits
     - 50 (reward)
     + 1,000 (subscription)
   ```

## Architecture Note

### State Storage Pattern

The component stores credits as **tokens** in state (`customCredits`):
- **Why**: Consistent with database storage (everything is tokens internally)
- **Display**: Uses `formatCredits()` to divide by 10 for user-facing display
- **API Calls**: MUST convert to Pilot Credits before sending

### Conversion Flow

```
User Input (Slider)
     ↓
customCredits (TOKENS)
     ↓
Display: formatCredits() → Divide by 10 → Pilot Credits shown to user
     ↓
API Call: Divide by 10 → Send as Pilot Credits
     ↓
Backend: Multiply by 10 → Store as tokens in database
```

## Prevention

To prevent similar issues in the future:

1. **Always convert before API calls**: When sending `customCredits` to any API, convert to Pilot Credits first
2. **Add type safety**: Consider creating a type-safe wrapper:
   ```typescript
   type Tokens = number & { __brand: 'tokens' };
   type PilotCredits = number & { __brand: 'pilotCredits' };
   ```
3. **Console logging**: Added logs showing both tokens and Pilot Credits values for debugging

## Related Files

- [components/settings/BillingSettings.tsx](components/settings/BillingSettings.tsx) - Fixed
- [app/api/stripe/create-checkout/route.ts](app/api/stripe/create-checkout/route.ts) - Expects Pilot Credits ✓
- [app/api/stripe/update-subscription/route.ts](app/api/stripe/update-subscription/route.ts) - Expects Pilot Credits ✓
- [lib/stripe/StripeService.ts](lib/stripe/StripeService.ts) - Uses Pilot Credits for Stripe ✓

## Status

✅ **FIXED** - Ready to test with clean database
