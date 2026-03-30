# LinkedIn Plugin OAuth Setup Guide

## Overview

This guide walks you through setting up OAuth for the LinkedIn plugin in NeuronForge.

---

## Step 1: Create LinkedIn Developer Account

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Sign in with your LinkedIn account
3. Click **Create app** button

---

## Step 2: Create a LinkedIn App

1. **Fill in Application Details**:

   - **App name**: `NeuronForge` (or your app name)
   - **LinkedIn Page**: Select your company page or create a personal page
     - If you don't have a company page, click **Create a LinkedIn Page**
     - Choose **Company** type and create a simple page
   - **App logo**: Upload your logo (optional, minimum 300x300px)
   - **Legal agreement**: Check the box to agree to LinkedIn API Terms of Use

2. **Click "Create app"**

---

## Step 3: Configure OAuth Settings

1. **Go to "Auth" Tab**:
   - Click on the **Auth** tab in your app settings

2. **Add Redirect URLs**:

   Scroll to **OAuth 2.0 settings** section and add:

   ```
   http://localhost:3000/oauth/callback/linkedin
   https://yourdomain.com/oauth/callback/linkedin
   ```

   ⚠️ **Important**:
   - Add BOTH localhost (for dev) and production URL
   - Click **Update** button after adding each URL
   - Must match exactly (no trailing slash)

3. **Copy Your Credentials**:

   You'll see:
   ```
   Client ID: 77xxxxxxxxxxxxx
   Client Secret: [Click "Show" to reveal]
   ```

   **Copy both values** - you'll need them in Step 4

---

## Step 4: Request API Access Products

**⚠️ CRITICAL STEP - Don't Skip This!**

LinkedIn requires you to request access to specific API products. Without this, OAuth will fail.

1. **Go to "Products" Tab**:
   - Click on the **Products** tab in your app settings

2. **Request Access to Required Products**:

   You need to request access to:

   - ✅ **Sign In with LinkedIn using OpenID Connect**
     - Status should show "Requested" or "Approved"
     - This is usually **auto-approved instantly**
     - Provides: `openid`, `profile`, `email` scopes

   - ✅ **Share on LinkedIn** (if you want posting capability)
     - Status may show "In Review"
     - Provides: `w_member_social` scope
     - May take 1-2 weeks for approval
     - Click **Request access** and fill out the form

3. **Wait for Approval**:
   - **OpenID Connect**: Usually instant ✅
   - **Share on LinkedIn**: May take 1-14 days (manual review)

---

## Step 5: Verify Scopes

After product approval, verify available scopes:

1. **Go to "Auth" Tab** → **OAuth 2.0 scopes** section

2. **You should see**:
   - ✅ `openid` - OpenID Connect authentication
   - ✅ `profile` - Read user's basic profile
   - ✅ `email` - Read user's email address
   - ✅ `w_member_social` - Create posts (only if "Share on LinkedIn" approved)

---

## Step 6: Configure Environment Variables

1. **Open your project's `.env.local` file**:

   ```bash
   # LinkedIn OAuth Configuration
   LINKEDIN_CLIENT_ID=77xxxxxxxxxxxxx
   LINKEDIN_CLIENT_SECRET=your_client_secret_here
   ```

2. **Replace placeholders**:
   - `LINKEDIN_CLIENT_ID`: Paste your Client ID from Step 3
   - `LINKEDIN_CLIENT_SECRET`: Paste your Client Secret from Step 3

3. **Verify `NEXT_PUBLIC_APP_URL` is set**:
   ```bash
   # Already in your .env.local (required for OAuth redirect)
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Save the file**

---

## Step 7: Restart Development Server

```bash
# Stop your dev server (Ctrl+C)

# Restart it
npm run dev
```

---

## Step 8: Test OAuth Connection

1. **Go to Dashboard**: `/v2/dashboard`

2. **Click Footer Plugin Management**:
   - Click **+ Connect Plugin** or plugin icon area

3. **Select LinkedIn**:
   - Find **LinkedIn** in the plugin list
   - Click **Connect**

4. **OAuth Flow**:
   - Popup opens to `linkedin.com/oauth/v2/authorization`
   - LinkedIn asks: "Allow NeuronForge to access your profile?"
   - Grant permissions

5. **Success Indicators**:
   - ✅ Popup shows "Authorization Successful!"
   - ✅ Popup auto-closes after 500ms
   - ✅ Footer shows LinkedIn icon in connected plugins

---

## Troubleshooting

### Issue 1: "invalid_scope" Error

**Error Message**:
```
invalid_scope: Scope 'w_member_social' is not authorized for your application
```

**Cause**: "Share on LinkedIn" product not approved yet

**Fix**:
1. LinkedIn's **Share on LinkedIn** product requires manual approval
2. **Option A - Wait for Approval**:
   - Check "Products" tab for approval status
   - Can take 1-14 days
3. **Option B - Use Without Posting** (immediate):
   - You can still connect with limited scopes: `openid`, `profile`, `email`
   - Actions available: `get_profile`, `get_user_info`
   - Posting will work once "Share on LinkedIn" is approved

**Temporary Workaround**:
Edit `linkedin-plugin-v2.json` to only use approved scopes:
```json
"required_scopes": [
  "openid",
  "profile",
  "email"
  // Remove "w_member_social" until approved
]
```

---

### Issue 2: "Invalid Client ID"

**Cause**: Client ID doesn't match LinkedIn app

**Fix**:
1. Verify `LINKEDIN_CLIENT_ID` in `.env.local` matches LinkedIn Developer Portal
2. Check for typos (should be all numbers)
3. Restart dev server after changing `.env.local`

---

### Issue 3: "Redirect URI Mismatch"

**Error Message**:
```
redirect_uri_mismatch: The redirect_uri does not match the registered redirect URIs
```

**Cause**: OAuth redirect URL doesn't match configured URLs

**Fix**:
1. Go to LinkedIn Developers → Your app → **Auth** tab
2. Scroll to **OAuth 2.0 settings** → **Redirect URLs**
3. Ensure you have:
   ```
   http://localhost:3000/oauth/callback/linkedin
   ```
4. Click **Update** after adding
5. Try connecting again

---

### Issue 4: "Invalid Client Secret"

**Cause**: Client secret incorrect or regenerated

**Fix**:
1. In LinkedIn Developer Portal, go to **Auth** tab
2. Click **Regenerate secret** if needed
3. Copy new secret immediately (shown only once)
4. Update `LINKEDIN_CLIENT_SECRET` in `.env.local`
5. Restart dev server

---

### Issue 5: "unauthorized_scope_error"

**Error Message**:
```
unauthorized_scope_error: You are not authorized to use the scope: w_member_social
```

**Cause**: Your LinkedIn app doesn't have "Share on LinkedIn" product approved

**Fix**:
1. Go to **Products** tab in LinkedIn Developer Portal
2. Check status of **Share on LinkedIn**:
   - **Not Requested**: Click "Request access" and fill out form
   - **In Review**: Wait for approval (1-14 days)
   - **Approved**: Scopes should work now

**While Waiting**:
- Use basic profile scopes only (`openid`, `profile`, `email`)
- Actions like `get_profile` and `get_user_info` will work
- Posting actions require approval

---

### Issue 6: "App Not Verified" Warning

**Warning**: LinkedIn may show "This app has not been verified by LinkedIn"

**This is Normal**:
- LinkedIn shows this for apps not in their verified partner program
- Users can still click "Continue" to authorize
- Does not affect functionality
- To remove: Apply for LinkedIn Partner Program (not required)

---

### Issue 7: Company Page Required During Setup

**Issue**: Can't create app without a LinkedIn company page

**Fix**:
1. Click **Create a LinkedIn Page**
2. Select **Company**
3. Fill in minimal details:
   - Company name: Your name or business
   - Website: Your domain or localhost
   - Industry: Select any relevant option
4. Click **Create page**
5. Return to app creation and select the new page

---

## Available Actions (After OAuth Connection)

### ✅ Available Immediately (with OpenID Connect):
- `get_profile` - Get user's LinkedIn profile
- `get_user_info` - Get email, name, picture via OpenID

### 🔒 Requires "Share on LinkedIn" Approval:
- `create_post` - Create LinkedIn posts
- `get_posts` - Retrieve user's posts

### 🔒 Requires LinkedIn Partner Program:
- `get_connections` - Access user's network
- `search_organizations` - Search companies
- `get_organization_posts` - Get company posts (if admin)

---

## LinkedIn API Scopes Explained

| Scope | Product Required | Approval Time | Capabilities |
|-------|-----------------|---------------|--------------|
| `openid` | OpenID Connect | Instant ✅ | Authentication |
| `profile` | OpenID Connect | Instant ✅ | Read profile data |
| `email` | OpenID Connect | Instant ✅ | Read email address |
| `w_member_social` | Share on LinkedIn | 1-14 days 🔒 | Create posts, share content |
| `r_organization_social` | Partner Program | Manual review 🔒 | Read org posts (admin only) |

---

## Production Deployment

When deploying to production:

1. **Update Redirect URL in LinkedIn**:
   - Go to Developer Portal → Your app → **Auth** tab
   - Add production URL:
     ```
     https://yourdomain.com/oauth/callback/linkedin
     ```
   - Click **Update**

2. **Set Production Environment Variables**:
   ```bash
   # In your hosting platform (Vercel, Netlify, etc.)
   LINKEDIN_CLIENT_ID=77xxxxxxxxxxxxx
   LINKEDIN_CLIENT_SECRET=your_client_secret_here
   NEXT_PUBLIC_APP_URL=https://yourdomain.com
   ```

3. **Test OAuth Flow on Production**:
   - Use production URL to test connection
   - Verify redirect works correctly

---

## Security Best Practices

1. ✅ Never commit `.env.local` to git (already in `.gitignore`)
2. ✅ Use different LinkedIn apps for dev/staging/production
3. ✅ Rotate client secret periodically
4. ✅ Monitor OAuth logs for suspicious activity
5. ✅ Only request scopes you actually need

---

## LinkedIn API Rate Limits

- **Profile endpoints**: 100 requests per user per day
- **Posting endpoints**: Varies by user (typically 150 posts/day)
- **Organization endpoints**: 1000 requests per app per day

**Tips**:
- Cache profile data to reduce API calls
- Implement retry logic with exponential backoff
- Monitor rate limit headers in responses

---

## Additional Resources

- **LinkedIn API Docs**: [docs.microsoft.com/linkedin](https://docs.microsoft.com/en-us/linkedin/)
- **OAuth 2.0 Guide**: [linkedin.com/developers/tools/oauth](https://www.linkedin.com/developers/tools/oauth)
- **Developer Portal**: [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
- **Product Access**: [linkedin.com/developers/apps/YOUR_APP_ID/products](https://www.linkedin.com/developers/apps/)

---

## Next Steps

After successful OAuth connection:

1. **Test basic actions**: Try `get_profile` and `get_user_info`
2. **Request "Share on LinkedIn"**: Apply for posting capabilities
3. **Build workflows**: Combine LinkedIn with other plugins
4. **Monitor rate limits**: Check usage in LinkedIn Developer Portal

---

**Need Help?**

If you encounter issues not covered here:
1. Check browser console for detailed error logs
2. Check server logs for OAuth callback errors
3. Verify all environment variables are set correctly
4. Check LinkedIn Developer Portal for product approval status
