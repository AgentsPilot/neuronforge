# How to Get Meta Ads API Keys - Step-by-Step

## Step 1: Create a Meta Developer Account

1. Go to **https://developers.facebook.com/**
2. Click **"Get Started"** in the top right
3. Log in with your Facebook account
4. Complete the developer registration (accept terms)

## Step 2: Create a New App

1. Click **"My Apps"** in the top navigation
2. Click **"Create App"** button
3. Select **"Business"** as the use case
4. Click **"Next"**

## Step 3: Fill in App Details

1. **Display Name**: `My Company Ads Automation` (or your preferred name)
2. **App Contact Email**: Your business email address
3. **Business Account**:
   - If you have one, select it from dropdown
   - If not, click **"Create a Business Account"** and follow the prompts
4. Click **"Create App"**

## Step 4: Get Your App ID and App Secret

1. You'll be redirected to your app dashboard
2. On the left sidebar, click **"Settings"** → **"Basic"**
3. You'll see:
   - **App ID**: This is your `META_ADS_CLIENT_ID`
   - **App Secret**: Click **"Show"** button, then copy it - this is your `META_ADS_CLIENT_SECRET`

**⚠️ IMPORTANT**: Keep your App Secret private! Treat it like a password.

## Step 5: Add Marketing API Product

1. In the left sidebar, click **"Add Products"** (or use the dashboard)
2. Scroll to find **"Marketing API"**
3. Click **"Set Up"** button next to Marketing API
4. The product will be added to your app

## Step 6: Configure App Domain & Platform

1. Go back to **Settings → Basic**
2. Scroll to **"App Domains"**
3. Add your domain (without `http://` or `https://`):
   - For production: `yourdomain.com`
   - For local testing: `localhost`
4. Scroll down to **"Add Platform"**
5. Click **"Website"**
6. Enter your site URL:
   - For production: `https://yourdomain.com`
   - For local testing: `http://localhost:3000`
7. Click **"Save Changes"**

## Step 7: Set OAuth Redirect URI

1. In the left sidebar, click **"Use Cases"** (or **"App Review"** in some versions)
2. Find **"Login with Facebook"** or go to **Settings → Advanced**
3. Scroll to **"OAuth Settings"**
4. Under **"Valid OAuth Redirect URIs"**, add:

```
http://localhost:3000/oauth/callback/meta-ads
```

For production, add:
```
https://yourdomain.com/oauth/callback/meta-ads
```

5. Click **"Save Changes"**

## Step 8: Add Required Permissions (Important!)

1. In the left sidebar, click **"App Review"** → **"Permissions and Features"**
2. Find and request these permissions:
   - **`ads_management`** - Click "Get Advanced Access"
   - **`ads_read`** - Click "Get Advanced Access"
   - **`business_management`** - Click "Get Advanced Access"

**Note**: For development/testing, you start with "Standard Access" which works fine. For production with many users, you'll need "Advanced Access" (requires app review).

## Step 9: Make App Live (Important!)

1. In the top of the dashboard, you'll see a toggle: **"App Mode: Development"**
2. Click the toggle to switch to **"Live"**
3. Confirm the switch

**⚠️ Important**: In Development mode, only you and test users can use the app. In Live mode, anyone can connect (but you still have permission limits until you get Advanced Access approved).

## Step 10: Find Your Ad Account ID

You'll need this when creating workflows:

1. Go to **https://business.facebook.com/**
2. Click **"All Tools"** in the left sidebar
3. Under **"Advertise"**, click **"Ads Manager"**
4. Look at the URL in your browser - it will look like:
   ```
   https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789&...
   ```
5. Your Ad Account ID is: **`act_123456789`** (keep the `act_` prefix!)

## Step 11: Add to Your .env File

Create or edit `.env.local` in your project root:

```bash
# Meta Ads API Credentials
META_ADS_CLIENT_ID=your_app_id_here
META_ADS_CLIENT_SECRET=your_app_secret_here

# Your app URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**For production**, change to:
```bash
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

## Step 12: Restart Your Server

After adding the environment variables:

```bash
# Stop the server (Ctrl+C)
# Then restart
npm run dev
```

## Step 13: Connect in Your App

1. Open your app at `http://localhost:3000`
2. Click the **Plugins** button in the footer
3. Find **"Meta Ads"** in the list
4. Click **"Connect"**
5. You'll be redirected to Facebook
6. Click **"Continue"** to authorize
7. You'll be redirected back with a success message!

## Testing Your Connection

Try this simple workflow to verify it works:

1. Create a new workflow
2. Add: "Get my Meta Ads campaigns"
3. Parameters:
   - **Ad Account ID**: `act_123456789` (use your actual ID from Step 10)
   - **Status**: ACTIVE
4. Run the workflow

You should see your active campaigns! 🎉

## Common Issues

### "Invalid OAuth 2.0 Access Token"
- Make sure your App Secret is correct in `.env.local`
- Restart your server after adding environment variables

### "Application does not have permission for this action"
- Make sure you added Marketing API product (Step 5)
- Check you requested ads_management and ads_read permissions (Step 8)

### "Invalid Client ID"
- Double-check your App ID in `.env.local`
- Make sure there are no extra spaces

### "Redirect URI mismatch"
- Verify the OAuth Redirect URI in Facebook matches exactly: `http://localhost:3000/oauth/callback/meta-ads`
- Include the protocol (`http://` or `https://`)

### "This app is in Development Mode"
- Switch app to Live mode (Step 9)
- Or add yourself as a test user in **Roles → Test Users**

## Quick Reference

**Where to find what:**
- **App ID & Secret**: Settings → Basic
- **OAuth Redirect**: Settings → Advanced → OAuth Settings (or Use Cases)
- **Permissions**: App Review → Permissions and Features
- **Ad Account ID**: Business Suite → Ads Manager → URL bar
- **Switch to Live**: Top of dashboard toggle

## Your Final Config

After following all steps, you should have:

✅ Meta Developer Account
✅ Business App created
✅ Marketing API product added
✅ App ID (CLIENT_ID) copied
✅ App Secret (CLIENT_SECRET) copied
✅ OAuth redirect URI configured
✅ Permissions requested (ads_management, ads_read)
✅ App switched to Live mode
✅ Ad Account ID found
✅ Environment variables added
✅ Server restarted

**You're ready to automate your Meta Ads!** 🚀

---

**Need help?** Check the official docs:
- https://developers.facebook.com/docs/marketing-api/get-started
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens
