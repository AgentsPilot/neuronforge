# Boost Pack Purchase Flow

Complete documentation of what happens when a user clicks "Buy Now" on a boost pack.

## Overview

Boost packs are **one-time credit purchases** (not subscriptions) that allow users to instantly add credits to their account. They are calculated dynamically based on the minimum subscription amount.

## Boost Pack Structure

Currently, there are 3 boost packs displayed in the UI:

1. **Quick Boost** (⚡)
   - Credits: 0.5× min subscription amount (~10,400 credits ≈ $5)
   - No bonus
   - Icon: Sparkles (blue/cyan gradient)

2. **Power Boost** (🚀)
   - Credits: 1× min subscription amount (~20,800 credits ≈ $10)
   - Bonus: +10% extra credits
   - Icon: Rocket (purple/pink gradient)
   - Badge: "POPULAR"

3. **Mega Boost** (💎)
   - Credits: 2× min subscription amount (~41,600 credits ≈ $20)
   - Bonus: +15% extra credits
   - Icon: Crown (orange/red gradient)
   - Badge: "BEST VALUE"

## User Journey

### Step 1: User Clicks "Buy Now"

**Location**: [BillingSettings.tsx:1123](../components/settings/BillingSettings.tsx#L1123)

```tsx
<button
  onClick={() => handlePurchaseBoostPack(pack.id)}
  disabled={purchaseLoading}
  className={`px-3 py-1 bg-gradient-to-r ${pack.gradient} text-white text-[10px] font-semibold rounded-md hover:shadow-md transition-all disabled:opacity-50 whitespace-nowrap`}
>
  {purchaseLoading ? 'Processing...' : 'Buy Now'}
</button>
```

**What happens**:
- `handlePurchaseBoostPack(pack.id)` is called with boost pack ID (e.g., `'boost-small'`, `'boost-medium'`, `'boost-large'`)
- `purchaseLoading` state is set to `true`, disabling all purchase buttons

### Step 2: Create Stripe Checkout Session

**Location**: [BillingSettings.tsx:435-465](../components/settings/BillingSettings.tsx#L435-L465)

```tsx
const handlePurchaseBoostPack = async (boostPackId: string) => {
  try {
    setPurchaseLoading(true);

    const response = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchaseType: 'boost_pack',
        boostPackId
      })
    });

    const data = await response.json();

    if (data.error) {
      alert(data.error);
      setPurchaseLoading(false);
      return;
    }

    // Initialize Stripe embedded checkout
    if (stripePromiseRef.current && embeddedCheckoutRef.current) {
      const stripe = await stripePromiseRef.current;
      const checkout = await stripe!.initEmbeddedCheckout({
        clientSecret: data.clientSecret
      });

      checkout.mount(embeddedCheckoutRef.current);
      setShowEmbeddedCheckout(true);
    }

  } catch (error: any) {
    alert(`Error: ${error.message}`);
    setPurchaseLoading(false);
  }
};
```

**What happens**:
1. POST request to `/api/stripe/create-checkout` with:
   - `purchaseType: 'boost_pack'`
   - `boostPackId`: The pack identifier
2. API returns `sessionId` and `clientSecret`
3. Stripe embedded checkout is initialized and mounted
4. Checkout modal is shown to user

### Step 3: API Route Processes Request

**Location**: [app/api/stripe/create-checkout/route.ts:123-164](../app/api/stripe/create-checkout/route.ts#L123-L164)

```typescript
if (purchaseType === 'boost_pack') {
  // One-time boost pack purchase
  if (!boostPackId) {
    return NextResponse.json(
      { error: 'Boost pack ID is required' },
      { status: 400 }
    );
  }

  session = await stripeService.createBoostPackCheckout({
    supabase,
    userId: user.id,
    email: user.email!,
    name: userName,
    boostPackId,
    successUrl,
    cancelUrl
  });

  // AUDIT TRAIL: Log boost pack checkout initiated
  await fetch(`${baseUrl}/api/audit/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': user.id
    },
    body: JSON.stringify({
      action: 'BOOST_PACK_CHECKOUT_INITIATED',
      entityType: 'boost_pack',
      entityId: boostPackId,
      userId: user.id,
      resourceName: 'Boost Pack Purchase',
      details: {
        boost_pack_id: boostPackId,
        session_id: session.id,
        timestamp: new Date().toISOString()
      },
      severity: 'info',
      complianceFlags: ['SOC2', 'FINANCIAL']
    })
  });
}
```

**What happens**:
1. Authenticates user via Supabase
2. Validates `purchaseType` and `boostPackId`
3. Gets user profile for name
4. Calls `stripeService.createBoostPackCheckout()`
5. Logs audit trail event
6. Returns `sessionId` and `clientSecret`

### Step 4: Stripe Service Creates Checkout

**Location**: [lib/stripe/StripeService.ts:186-259](../lib/stripe/StripeService.ts#L186-L259)

```typescript
async createBoostPackCheckout(params: {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  name?: string;
  boostPackId: string;
  successUrl: string;
  cancelUrl: string;
  currency?: string;
}): Promise<Stripe.Checkout.Session> {
  // Get boost pack details from database
  const { data: boostPack, error } = await supabase
    .from('boost_packs')
    .select('*')
    .eq('id', boostPackId)
    .single();

  if (error || !boostPack) {
    throw new Error('Boost pack not found');
  }

  // Get or create Stripe customer
  const customerId = await this.getOrCreateCustomer(supabase, userId, email, name);

  // Calculate total credits (base + bonus)
  const totalCredits = boostPack.credits_amount + (boostPack.bonus_credits || 0);

  // Create checkout session for one-time payment
  const session = await this.stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment', // ONE-TIME PAYMENT, not subscription
    line_items: [
      {
        price_data: {
          currency: stripeCurrency,
          unit_amount: Math.round(boostPack.price_usd * 100), // Convert to cents
          product_data: {
            name: boostPack.pack_name,
            description: `${totalCredits.toLocaleString()} Pilot Credits${boostPack.bonus_credits ? ` (includes ${boostPack.bonus_credits.toLocaleString()} bonus)` : ''}`,
            metadata: {
              boost_pack_id: boostPackId,
              credits: totalCredits.toString(),
              bonus_credits: (boostPack.bonus_credits || 0).toString()
            }
          }
        },
        quantity: 1
      }
    ],
    ui_mode: 'embedded', // Enable embedded checkout
    return_url: successUrl,
    metadata: {
      user_id: userId,
      boost_pack_id: boostPackId,
      credits: totalCredits.toString(),
      purchase_type: 'boost_pack'
    }
  });

  return session;
}
```

**What happens**:
1. Queries `boost_packs` table for pack details
2. Gets or creates Stripe customer for user
3. Calculates total credits (base + bonus)
4. Creates Stripe checkout session with:
   - Mode: `'payment'` (one-time, not recurring)
   - Price from boost pack
   - Metadata: user_id, boost_pack_id, credits, purchase_type
   - UI mode: `'embedded'` for in-page checkout
5. Returns session object

### Step 5: User Completes Payment in Stripe

User enters payment details in the embedded Stripe checkout modal and completes payment.

**What Stripe does**:
1. Processes payment
2. If successful, sends `checkout.session.completed` webhook event to your server
3. Stripe marks the checkout session as complete

### Step 6: Webhook Receives Event

**Location**: [app/api/stripe/webhook/route.ts:244-327](../app/api/stripe/webhook/route.ts#L244-L327)

```typescript
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('🎉 [Webhook] Processing checkout.session.completed:', session.id);

  const userId = session.metadata?.user_id;
  const purchaseType = session.metadata?.purchase_type;

  if (!userId) {
    console.error('❌ [Webhook] No user_id in session metadata');
    return;
  }

  if (session.mode === 'payment' && purchaseType === 'boost_pack') {
    // One-time boost pack purchase
    const pilotCredits = parseInt(session.metadata?.credits || '0');
    const boostPackId = session.metadata?.boost_pack_id;

    // Convert Pilot Credits to tokens for storage (fetched from database)
    const credits = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

    console.log(`💰 Converting ${pilotCredits} Pilot Credits → ${credits} tokens`);

    // Get current balance
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single();

    const currentBalance = userSub?.balance || 0;
    const currentTotalEarned = userSub?.total_earned || 0;
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    // Update balance
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned
      })
      .eq('user_id', userId);

    // Create credit transaction
    await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: credits,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'allocation',
        activity_type: 'boost_pack_purchase',
        description: `Boost pack purchase: ${credits.toLocaleString()} credits`,
        metadata: {
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
          boost_pack_id: boostPackId,
          amount_paid_cents: session.amount_total
        }
      });

    // Record boost pack purchase
    if (boostPackId) {
      await supabaseAdmin
        .from('boost_pack_purchases')
        .insert({
          user_id: userId,
          boost_pack_id: boostPackId,
          credits_purchased: credits,
          bonus_credits: 0, // Bonus already included in credits
          amount_paid_cents: session.amount_total || 0,
          currency: session.currency || 'usd',
          stripe_payment_intent_id: session.payment_intent as string,
          credits_applied: true,
          applied_at: new Date().toISOString()
        });
    }

    console.log('✅ [Webhook] Boost pack processed:', {
      userId,
      credits,
      newBalance
    });
  }
}
```

**What happens**:
1. Extracts metadata from session:
   - `user_id`: Who made the purchase
   - `purchase_type`: Confirms it's a boost pack
   - `credits`: Total Pilot Credits to award
   - `boost_pack_id`: Which pack was purchased
2. Converts Pilot Credits to tokens (internal storage format)
3. Gets user's current balance from `user_subscriptions`
4. Updates user balance:
   - Adds credits to `balance`
   - Adds credits to `total_earned`
5. Creates transaction record in `credit_transactions`:
   - Type: `'allocation'`
   - Activity: `'boost_pack_purchase'`
   - Records before/after balance
   - Stores Stripe payment details
6. Records purchase in `boost_pack_purchases` table:
   - Links to user and boost pack
   - Records amount paid
   - Marks credits as applied
7. Logs success

### Step 7: User Sees Confirmation

After webhook processes:
1. Stripe checkout modal closes automatically
2. User is redirected to success URL: `/settings?tab=billing&success=true`
3. Page shows success message
4. Updated balance displays in stat cards:
   - **Available to Use**: Shows new balance
   - **Bonus & Rewards**: Shows earned credits (if applicable)

## Database Tables Used

### `boost_packs`
Stores boost pack definitions (if using database-driven packs):
```sql
- id (uuid)
- pack_name (text): e.g., "Quick Boost"
- credits_amount (integer): Base credits
- bonus_credits (integer): Bonus credits
- price_usd (numeric): Price in USD
- created_at (timestamp)
```

**Note**: Currently, boost packs are **generated dynamically** in the UI based on `minSubscriptionUsd`, not from this table. The webhook still references it for compatibility.

### `user_subscriptions`
Updated with new balance:
```sql
- user_id (uuid)
- balance (integer): Updated with new credits
- total_earned (integer): Increased by credits
- stripe_customer_id (text): Used to associate payment
```

### `credit_transactions`
Records the credit allocation:
```sql
- user_id (uuid)
- credits_delta (integer): Credits added
- balance_before (integer)
- balance_after (integer)
- transaction_type ('allocation')
- activity_type ('boost_pack_purchase')
- description (text)
- metadata (jsonb): Stripe details
- created_at (timestamp)
```

### `boost_pack_purchases`
Records the purchase:
```sql
- user_id (uuid)
- boost_pack_id (text): e.g., 'boost-medium'
- credits_purchased (integer)
- bonus_credits (integer)
- amount_paid_cents (integer)
- currency (text)
- stripe_payment_intent_id (text)
- credits_applied (boolean)
- applied_at (timestamp)
- created_at (timestamp)
```

## Stripe Objects Created

### Checkout Session
```json
{
  "id": "cs_test_...",
  "mode": "payment",
  "ui_mode": "embedded",
  "customer": "cus_...",
  "amount_total": 1000,
  "currency": "usd",
  "payment_status": "paid",
  "metadata": {
    "user_id": "...",
    "boost_pack_id": "boost-medium",
    "credits": "22880",
    "purchase_type": "boost_pack"
  }
}
```

### Payment Intent
Created automatically by Stripe for the payment:
```json
{
  "id": "pi_...",
  "amount": 1000,
  "currency": "usd",
  "status": "succeeded",
  "payment_method": "pm_..."
}
```

## Key Differences: Boost Packs vs Subscriptions

| Feature | Boost Packs | Subscriptions |
|---------|-------------|---------------|
| **Stripe Mode** | `payment` (one-time) | `subscription` (recurring) |
| **Webhook Event** | `checkout.session.completed` | `invoice.paid` (monthly) |
| **Credit Allocation** | Immediate on purchase | Monthly on renewal |
| **Cancellation** | N/A (one-time) | Can cancel anytime |
| **Activity Type** | `boost_pack_purchase` | `subscription_renewal` |
| **Transaction Type** | `allocation` | `allocation` |

## Current Issue: Dynamic vs Database Packs

**Current Implementation**:
- Boost packs are generated dynamically in UI based on `minCredits`
- Pack IDs are simple strings: `'boost-small'`, `'boost-medium'`, `'boost-large'`
- No `boost_packs` table entries exist

**Problem**:
- `StripeService.createBoostPackCheckout()` tries to query `boost_packs` table
- Will fail if no entries exist

**Solutions**:

### Option 1: Create Database Entries (Recommended)
Create a script to populate `boost_packs` table with the 3 standard packs:

```typescript
// scripts/initialize-boost-packs.ts
const minCredits = 20833; // From min subscription
const pricePerCredit = 0.00048;

const boostPacks = [
  {
    id: 'boost-small',
    pack_name: 'Quick Boost',
    credits_amount: Math.round(minCredits * 0.5),
    bonus_credits: 0,
    price_usd: Math.round(minCredits * 0.5) * pricePerCredit,
    is_active: true
  },
  {
    id: 'boost-medium',
    pack_name: 'Power Boost',
    credits_amount: minCredits,
    bonus_credits: Math.round(minCredits * 0.1),
    price_usd: minCredits * pricePerCredit,
    is_active: true
  },
  {
    id: 'boost-large',
    pack_name: 'Mega Boost',
    credits_amount: Math.round(minCredits * 2),
    bonus_credits: Math.round(minCredits * 2 * 0.15),
    price_usd: Math.round(minCredits * 2) * pricePerCredit,
    is_active: true
  }
];
```

### Option 2: Pass Pack Details Directly
Modify the flow to pass pack details instead of ID:

```typescript
// In handlePurchaseBoostPack
body: JSON.stringify({
  purchaseType: 'boost_pack',
  boostPack: {
    id: pack.id,
    name: pack.name,
    credits: totalCredits,
    price: price
  }
})
```

Then update `StripeService` to accept pack object instead of querying database.

## Testing the Flow

### Test in Development (Stripe Test Mode):

1. **Setup**:
   - Use test card: `4242 4242 4242 4242`
   - Any future expiry date
   - Any CVC

2. **Test Quick Boost**:
   ```bash
   # Click "Buy Now" on Quick Boost
   # Complete checkout with test card
   # Check webhook logs in terminal
   # Verify balance updated in UI
   ```

3. **Verify in Stripe Dashboard**:
   - Go to Payments → View payment
   - Check metadata contains: user_id, credits, boost_pack_id
   - Verify amount matches pack price

4. **Verify in Database**:
   ```sql
   -- Check balance updated
   SELECT balance, total_earned FROM user_subscriptions WHERE user_id = '...';

   -- Check transaction created
   SELECT * FROM credit_transactions
   WHERE activity_type = 'boost_pack_purchase'
   ORDER BY created_at DESC LIMIT 1;

   -- Check purchase recorded
   SELECT * FROM boost_pack_purchases
   ORDER BY created_at DESC LIMIT 1;
   ```

## Audit Trail

Every boost pack purchase is logged:

1. **Checkout Initiated**: `BOOST_PACK_CHECKOUT_INITIATED`
2. **Payment Completed**: Recorded in `credit_transactions`
3. **Purchase Recorded**: `boost_pack_purchases` table

Compliance flags: `['SOC2', 'FINANCIAL']`

## Error Handling

### Common Errors:

1. **No boost_packs entry**:
   - Error: "Boost pack not found"
   - Solution: Create database entry or pass pack details

2. **Authentication failed**:
   - Error: "Unauthorized"
   - Solution: User must be logged in

3. **Webhook signature invalid**:
   - Error: "Webhook signature verification failed"
   - Solution: Check `STRIPE_WEBHOOK_SECRET` env var

4. **Duplicate purchase**:
   - Currently allowed (users can buy multiple times)
   - Could add rate limiting if needed

## Summary

The boost pack purchase flow is a **one-time payment** that:
1. Creates a Stripe checkout session in `payment` mode
2. Shows embedded Stripe checkout to user
3. Processes payment via Stripe
4. Receives webhook event when payment succeeds
5. Immediately credits user's account
6. Records transaction in database
7. Shows success message to user

The entire process takes 5-10 seconds and credits are available immediately after payment confirmation.
