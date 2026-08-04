# Stripe Plugin - User Documentation

> **Last Updated**: 2026-08-01

## Overview

The Stripe plugin allows you to accept payments, manage subscriptions, and process refunds directly through your AgentPilot automations. Connect your own Stripe account to start collecting payments from clients automatically.

---

## Connection Options

### Option 1: Create New Stripe Account (Recommended for New Users)

Perfect if you don't have a Stripe account yet. We'll help you create one.

**Steps:**
1. Go to **Settings → Connections**
2. Find **Stripe** and click **Connect**
3. Select **"Create New Account"**
4. Choose your country and business type
5. Complete Stripe's onboarding (identity verification, bank details)
6. You're connected! 🎉

**What you'll need:**
- Government-issued ID
- Bank account details
- Business information (if applicable)

### Option 2: Connect Existing Stripe Account

Already have Stripe? Connect in seconds.

**Steps:**
1. Go to **Settings → Connections**
2. Find **Stripe** and click **Connect**
3. Select **"Connect Existing Account"**
4. Log in to your Stripe account
5. Authorize AgentPilot access
6. Connected! ✅

---

## Available Actions

### Payment Collection

#### `create_checkout_session`
Create a hosted payment page where customers can complete their purchase.

**Parameters:**
- `amount` (required) - Amount in smallest currency unit (e.g., cents for USD)
- `currency` (required) - Three-letter ISO code (e.g., "usd", "eur")
- `customer_email` (optional) - Pre-fill customer email
- `success_url` (required) - Where to redirect after payment
- `cancel_url` (optional) - Where to redirect if canceled

**Returns:** Checkout URL to send to customer

**Example Use Cases:**
- "Send payment link to new leads from HubSpot"
- "Create invoice for consultation bookings"
- "Collect deposits for appointments"

#### `create_payment_intent`
Create a direct payment intent for custom payment flows.

**Parameters:**
- `amount` (required) - Amount in cents
- `currency` (required) - Currency code
- `customer_id` (optional) - Existing Stripe customer ID
- `payment_method` (optional) - Saved payment method ID

**Returns:** Payment intent ID and client secret

#### `charge_saved_method`
Charge a customer's saved payment method.

**Parameters:**
- `customer_id` (required) - Stripe customer ID
- `payment_method_id` (required) - Payment method to charge
- `amount` (required) - Amount in cents
- `currency` (required) - Currency code

**Returns:** Charge confirmation and receipt URL

---

### Refunds & Disputes

#### `refund_payment`
Process a full refund for a payment.

**Parameters:**
- `payment_intent_id` (required) - ID of payment to refund
- `reason` (optional) - Reason: "duplicate", "fraudulent", "requested_by_customer"

**Returns:** Refund ID and status

**Example:** "Refund payment if customer cancels within 24 hours"

#### `refund_partial`
Process a partial refund.

**Parameters:**
- `payment_intent_id` (required) - ID of payment to refund
- `amount` (required) - Amount to refund in cents
- `reason` (optional) - Refund reason

**Returns:** Partial refund confirmation

---

### Subscription Management

#### `create_subscription`
Create a recurring subscription for a customer.

**Parameters:**
- `customer_id` (required) - Stripe customer ID
- `price_id` (required) - Stripe price ID for recurring plan
- `trial_days` (optional) - Free trial period in days

**Returns:** Subscription ID and status

**Example:** "Subscribe new customers to monthly plan after trial"

#### `update_subscription`
Modify an existing subscription.

**Parameters:**
- `subscription_id` (required) - Subscription to update
- `new_price_id` (optional) - Change to different plan
- `cancel_at_period_end` (optional) - Schedule cancellation

**Returns:** Updated subscription details

#### `cancel_subscription`
Cancel a subscription immediately or at period end.

**Parameters:**
- `subscription_id` (required) - Subscription to cancel
- `immediate` (optional) - Cancel now vs. at period end (default: false)

**Returns:** Cancellation confirmation

#### `list_subscriptions`
Get all active subscriptions.

**Parameters:**
- `customer_id` (optional) - Filter by customer
- `status` (optional) - Filter by status: "active", "canceled", "past_due"
- `limit` (optional) - Max results (default: 50)

**Returns:** Array of subscriptions

---

### Customer Management

#### `create_customer`
Add a new customer to your Stripe account.

**Parameters:**
- `email` (required) - Customer email
- `name` (optional) - Customer name
- `phone` (optional) - Phone number
- `metadata` (optional) - Custom key-value data

**Returns:** Customer ID

**Example:** "Create Stripe customer when lead converts in CRM"

#### `get_customer`
Retrieve customer details.

**Parameters:**
- `customer_id` (required) - Stripe customer ID

**Returns:** Customer data including payment methods and subscriptions

#### `list_customers`
Get your customer list.

**Parameters:**
- `email` (optional) - Filter by email
- `limit` (optional) - Max results (default: 50)

**Returns:** Array of customers

#### `list_payment_methods`
Get saved payment methods for a customer.

**Parameters:**
- `customer_id` (required) - Customer to query
- `type` (optional) - Filter by type: "card", "us_bank_account"

**Returns:** Array of payment methods (cards, bank accounts)

---

### Payment Status

#### `get_payment`
Retrieve payment details and status.

**Parameters:**
- `payment_intent_id` (required) - Payment to retrieve

**Returns:** Payment status, amount, customer info, receipt URL

**Example:** "Check if payment succeeded before fulfilling order"

---

## Automation Examples

### Example 1: Lead to Payment Flow
**Scenario:** New lead submits form → Send payment link

**Agent Prompt:**
*"When a new contact is created in HubSpot with lifecycle stage 'SQL', create a $500 checkout session and email them the payment link"*

**What happens:**
1. HubSpot webhook detects new contact
2. Agent fetches contact email
3. Stripe creates checkout session ($500 USD)
4. Agent emails payment URL to customer
5. Customer completes payment
6. Agent updates HubSpot deal stage

---

### Example 2: Subscription Signup
**Scenario:** Trial expired → Convert to paid subscription

**Agent Prompt:**
*"When a trial user reaches day 14, create a monthly subscription for $29/month and send confirmation email"*

**What happens:**
1. Agent detects trial end date
2. Creates Stripe customer (if new)
3. Subscribes to monthly plan
4. Sends welcome email with subscription details

---

### Example 3: Automated Refunds
**Scenario:** Cancellation policy automation

**Agent Prompt:**
*"If a booking is canceled more than 48 hours before the appointment, process a full refund automatically"*

**What happens:**
1. Calendar detects cancellation
2. Agent checks cancellation date vs. appointment date
3. If >48 hours: Process full Stripe refund
4. If <48 hours: Send "no refund" notification
5. Update booking status

---

## Security & Compliance

### Data Protection
- Your Stripe account credentials are **encrypted** in our database
- We use **OAuth 2.0** for secure authorization
- Tokens are **never** exposed to the browser or logs

### Account Isolation
- Each user's Stripe account is completely isolated
- Agents can **only** access your own Stripe account
- No cross-user access possible

### Webhook Security
- All Stripe webhooks use **signature verification**
- Invalid signatures are rejected automatically

### Audit Trail
- All payment operations are logged for compliance
- Includes: timestamp, user, action, amount, customer
- SOC2 compliant audit logging

---

## Troubleshooting

### "Connection failed" Error
**Cause:** OAuth authorization was canceled or timed out
**Fix:** Try connecting again and complete the authorization

### "Insufficient permissions" Error
**Cause:** Your Stripe account doesn't have required permissions
**Fix:** Log into Stripe Dashboard → Settings → Connect → Verify permissions

### "Payment requires authentication" Error
**Cause:** Customer's bank requires 3D Secure verification
**Fix:** Use `create_checkout_session` instead of `create_payment_intent` (handles auth automatically)

### "Account onboarding incomplete" Error
**Cause:** Express account setup not finished
**Fix:** Go to Settings → Connections → Stripe → Click "Continue Setup"

---

## Pricing

**AgentPilot Fees:** No additional fees from AgentPilot

**Stripe Fees:** Standard Stripe pricing applies:
- 2.9% + $0.30 per successful card charge (US)
- Varies by country and payment method
- See [Stripe Pricing](https://stripe.com/pricing) for details

---

## Support

### Getting Help
- **Documentation:** [Stripe Docs](https://stripe.com/docs)
- **AgentPilot Support:** Settings → Help → Contact Support
- **Stripe Support:** [Stripe Support](https://support.stripe.com)

### Common Resources
- [Test card numbers](https://stripe.com/docs/testing)
- [Webhook testing](https://stripe.com/docs/webhooks/test)
- [Dashboard overview](https://stripe.com/docs/dashboard)

---

## FAQ

**Q: Do I need a business to use Stripe?**
A: No, you can create an individual Express account for freelancing/consulting.

**Q: Can I use test mode?**
A: Yes, connect a Stripe test account separately for sandbox testing.

**Q: How do payouts work?**
A: Stripe deposits funds to your bank account automatically (typically 2 business days).

**Q: Can I accept international payments?**
A: Yes, Stripe supports 135+ currencies and international cards.

**Q: What about subscriptions with trials?**
A: Use `create_subscription` with `trial_days` parameter.

**Q: Can I customize the checkout page?**
A: Limited customization via Stripe Dashboard → Settings → Branding.

---

## Limits & Rate Limits

**Stripe API Rate Limits:**
- 100 requests per second (rolling window)
- AgentPilot automatically handles retries

**Recommended Limits:**
- Max checkout sessions per automation: 100/hour
- Max refunds per automation: 50/hour
- Refund confirmations required for amounts >$1,000

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-01 | Initial release | Stripe plugin with 14 actions, dual connection flow |
