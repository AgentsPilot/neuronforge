# Quick Start: Get Stripe API Keys in 5 Minutes

> **Goal**: Get your Stripe test API keys and connect the plugin

---

## Step 1: Create Stripe Account (2 minutes)

1. Go to: **https://dashboard.stripe.com/register**
2. Enter your email and password
3. Click **"Create account"**
4. **Skip** business details (for testing)
5. You'll land on Dashboard in **Test Mode** ✅

---

## Step 2: Get API Keys (1 minute)

1. In Stripe Dashboard, click **"Developers"** (left sidebar)
2. Click **"API keys"**
3. Make sure **"Test mode"** toggle is ON (top-right)
4. Copy these two keys:

   **Secret Key** (starts with `sk_test_...`):
   - Click "Reveal test key token"
   - Copy entire key

   **Publishable Key** (starts with `pk_test_...`):
   - Click "Reveal test key"
   - Copy entire key

---

## Step 3: Get OAuth Client ID (2 minutes)

Required for OAuth (connecting existing Stripe accounts).

1. Click **"Connect"** in left sidebar
2. If prompted, click **"Get started with Connect"** → **"Continue"**
3. Click **"Settings"** (top-right of Connect page)
4. Under **"OAuth settings"**:
   - Click **"Add redirect URI"**
   - Add: `http://localhost:3000/oauth/callback/stripe`
   - Click **"Save changes"**
5. Find **"Client ID"** (starts with `ca_...`)
6. Copy the Client ID

---

## Step 4: Update .env.local (30 seconds)

Open `.env.local` in your project and update these lines:

```bash
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_CLIENT_ID=ca_YOUR_CLIENT_ID_HERE
```

**Example:**
```bash
STRIPE_SECRET_KEY=sk_test_51ABC123...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51ABC123...
STRIPE_CLIENT_ID=ca_ABC123xyz...
```

---

## Step 5: Restart Dev Server

```bash
# Stop your server (Ctrl+C)
npm run dev
```

---

## Step 6: Test It Works

1. Go to `http://localhost:3000`
2. Log in to AgentPilot
3. Go to **Settings → Connections**
4. Find **Stripe** plugin
5. Click **"Connect"**
6. You should see OAuth popup open ✅

---

## That's It! 🎉

You now have:
- ✅ Stripe test account
- ✅ API keys configured
- ✅ OAuth Client ID set up
- ✅ Plugin ready to connect

---

## Next Steps

### Test Payment Creation

Create an agent with this prompt:
```
Create a checkout session for $50 with success URL http://localhost:3000/success
```

Expected output:
```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/c/pay/..."
  }
}
```

### Test Cards

When testing payments, use:
- **Card Number**: `4242 4242 4242 4242`
- **Expiry**: Any future date (e.g., `12/34`)
- **CVC**: Any 3 digits (e.g., `123`)

---

## Troubleshooting

**"OAuth credentials not configured"**
→ Check `STRIPE_CLIENT_ID` is set in `.env.local`

**"Stripe account not found"**
→ Complete the connection flow first

**Plugin not appearing**
→ Restart your dev server

---

## Full Documentation

- **Complete Setup**: [STRIPE_CONNECT_SETUP_GUIDE.md](./STRIPE_CONNECT_SETUP_GUIDE.md)
- **User Guide**: [stripe-plugin.md](./plugins/stripe-plugin.md)
- **Implementation**: [STRIPE_PLUGIN_IMPLEMENTATION_SUMMARY.md](./STRIPE_PLUGIN_IMPLEMENTATION_SUMMARY.md)
