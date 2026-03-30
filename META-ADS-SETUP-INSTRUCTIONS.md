# Meta Ads Plugin Setup Instructions

## Overview
This guide will help you set up the Meta Ads plugin to manage Facebook and Instagram advertising campaigns programmatically.

## Prerequisites
- A Facebook Business Account
- An Ad Account in Meta Business Suite
- Admin access to your Facebook Business Manager

## Step 1: Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **"My Apps"** in the top right
3. Click **"Create App"**
4. Select **"Business"** as the app type
5. Fill in the app details:
   - **App Name**: `YourCompany NeuronForge Integration` (or your preferred name)
   - **Contact Email**: Your business email
   - **Business Account**: Select your business account
6. Click **"Create App"**

## Step 2: Configure App Settings

1. In your app dashboard, go to **Settings → Basic**
2. Note down:
   - **App ID** (this is your `META_ADS_CLIENT_ID`)
   - **App Secret** (click "Show" - this is your `META_ADS_CLIENT_SECRET`)
3. Add your **App Domains**:
   - For local development: `localhost`
   - For production: `yourdomain.com`
4. Scroll to **"Privacy Policy URL"** and **"Terms of Service URL"**:
   - Add your company's URLs (required for app review later)

## Step 3: Add Marketing API Product

1. In the left sidebar, click **"Add Products"**
2. Find **"Marketing API"** and click **"Set Up"**
3. The Marketing API will be added to your app

## Step 4: Configure OAuth Settings

1. Go to **Settings → Advanced**
2. Under **"OAuth Settings"**, add your redirect URI:
   ```
   https://yourdomain.com/oauth/callback/meta-ads
   ```
   For local development:
   ```
   http://localhost:3000/oauth/callback/meta-ads
   ```

3. Scroll down to **"Valid OAuth Redirect URIs"** and add the same URL(s)

## Step 5: Get Standard Access (Development Mode → Live)

**Important**: Your app starts in Development Mode with limited access.

### For Testing (Development Mode):
- You can test with your own ad account
- Add test users under **Roles → Test Users**
- Limited to 5 ad accounts

### For Production (Standard Access):
1. Go to **App Review → Permissions and Features**
2. Request **Standard Access** for:
   - `ads_management` (Create and manage ads)
   - `ads_read` (Read ad performance data)
   - `business_management` (Access business assets)

3. You'll need to provide:
   - **Use Case**: Explain how you'll use the API
   - **Screen Recording**: Show your app using the API
   - **Privacy Policy**: Link to your privacy policy

4. Submit for review (typically takes 1-2 weeks)

## Step 6: Add Environment Variables

Add these to your `.env.local` file:

```bash
# Meta Ads API Credentials
META_ADS_CLIENT_ID=your_app_id_here
META_ADS_CLIENT_SECRET=your_app_secret_here

# Make sure your app URL is set
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

For local development:
```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Step 7: Find Your Ad Account ID

You'll need your Ad Account ID to use the API:

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Click **"All Tools"** → **"Ads Manager"**
3. In the URL bar, you'll see: `act_123456789`
4. Your Ad Account ID format is: `act_123456789`

**Note**: Keep the `act_` prefix when using the plugin!

## Step 8: Connect in NeuronForge

1. Open NeuronForge
2. Go to **Settings** → **Connected Apps** or click the **Plugins** button in the footer
3. Find **"Meta Ads"** in the plugin list
4. Click **"Connect"**
5. You'll be redirected to Facebook to authorize the app
6. Grant the requested permissions:
   - `ads_management`
   - `ads_read`
   - `business_management`
7. You'll be redirected back to NeuronForge with a success message

## Step 9: Test the Connection

Try creating a simple workflow:

```
Get my Meta Ads campaigns
├─ Ad Account ID: act_123456789
└─ Status: ACTIVE
```

This should return your active campaigns!

## API Permissions Explained

- **`ads_management`**: Create, edit, delete campaigns, ad sets, and ads
- **`ads_read`**: Read campaign performance, insights, and metrics
- **`business_management`**: Access business assets like ad accounts and pages

## Common Issues

### Issue: "Invalid OAuth 2.0 Access Token"
**Solution**: Reconnect the plugin. Tokens expire every 60 days.

### Issue: "Application does not have permission for this action"
**Solution**:
1. Make sure your app is approved for Standard Access
2. Check that you requested the correct permissions (`ads_management`, `ads_read`)
3. Verify the user connecting has admin access to the ad account

### Issue: "Invalid ad account ID"
**Solution**: Make sure you're using the format `act_123456789` (with the `act_` prefix)

### Issue: "This app is in Development Mode"
**Solution**:
- For testing: Add yourself as a test user or admin
- For production: Submit your app for Standard Access review

### Issue: "Rate limit exceeded"
**Solution**: Meta has API rate limits. Wait a few minutes and try again.

## Testing with Test Ad Accounts

For development, you can create test ad accounts:

1. Go to **Business Settings** → **Ad Accounts**
2. Click **"Add"** → **"Create a Test Ad Account"**
3. Test accounts have fake money and won't charge real ads
4. Use these for testing your workflows

## Important Notes

1. **Tokens Expire**: Meta access tokens expire after 60 days. NeuronForge will prompt you to reconnect.

2. **Ad Account Access**: Make sure your Facebook user has admin access to the ad accounts you want to manage.

3. **Production Use**: For production use with client ad accounts, you'll need:
   - Business verification
   - App review approval
   - Client authorization for their ad accounts

4. **API Versioning**: The plugin uses Meta Marketing API v19.0. Meta updates the API quarterly.

5. **Budget Units**: All budgets are in **cents** (e.g., 5000 = $50.00 USD)

## Available Operations

### Tier 1: Insights & Reporting
- Get campaigns, ad sets, ads
- Get campaign/ad set/ad insights (metrics, performance data)

### Tier 2: Campaign Management
- Create campaigns
- Update campaigns (pause/resume, adjust budgets)
- Get ad account info

### Tier 3: Ad Set Operations
- Create ad sets (targeting, budgets, schedules)
- Update ad sets

### Tier 4: Creative & Ads
- Upload images
- Create ad creatives
- Create ads

### Tier 5: Audience Management
- Create custom audiences
- Get audiences

## Example Workflows

### 1. Daily Performance Report
```
Get active campaigns → Get campaign insights (last 7 days) → Filter by spend > $100 → Export to Google Sheets
```

### 2. Budget Optimization
```
Get all ad sets → Get ad set insights → Sort by CPA → Increase budget on top performers → Decrease budget on low performers
```

### 3. Campaign Health Check
```
Get campaigns → Filter by status ACTIVE → Get insights → Filter by CPA > $10 → Send Slack alert
```

## Need Help?

- [Meta Marketing API Documentation](https://developers.facebook.com/docs/marketing-api)
- [Meta Business Help Center](https://www.facebook.com/business/help)
- [API Status Page](https://developers.facebook.com/status/)

## Security Best Practices

1. **Never share your App Secret**: Treat it like a password
2. **Use environment variables**: Don't commit credentials to git
3. **Rotate tokens regularly**: Disconnect and reconnect every 60 days
4. **Limit permissions**: Only request the scopes you need
5. **Monitor API usage**: Check for unusual activity in Meta Business Suite

---

**Ready to automate your Meta Ads!** 🚀

For questions or issues, please check the [Meta for Developers Community](https://developers.facebook.com/community/).
