# Salesforce OAuth Setup Instructions

## Step-by-Step Guide to Get Salesforce API Credentials

### Prerequisites
- Salesforce account (any edition: Developer, Professional, Enterprise, or Unlimited)
- Admin access to your Salesforce org

### Step 1: Create a Salesforce Developer Account (if needed)
If you don't have a Salesforce account:
1. Go to https://developer.salesforce.com/signup
2. Fill in your details
3. Click "Sign me up"
4. Check your email and verify your account
5. You'll get a free Developer Edition org

### Step 2: Access Salesforce Setup
1. Log in to your Salesforce org at https://login.salesforce.com
2. Click the **gear icon** (⚙️) in the top-right corner
3. Click **Setup**

### Step 3: Create a Connected App
1. In Setup, use the **Quick Find** box (top-left search)
2. Type **"App Manager"** and select it
3. Click **"New Connected App"** button (top-right)

### Step 4: Fill in Basic Information
**Connected App Name:**
```
NeuronForge
```
(or use your app name)

**API Name:**
```
NeuronForge
```
(auto-filled from the name above)

**Contact Email:**
```
your-email@example.com
```

### Step 5: Enable OAuth Settings
1. Check ✅ **"Enable OAuth Settings"**

2. **Callback URL** (add BOTH for dev and production):
   ```
   http://localhost:3000/oauth/callback/salesforce
   https://your-domain.com/oauth/callback/salesforce
   ```
   Replace `your-domain.com` with your actual production domain.

3. **Selected OAuth Scopes** - Add these scopes (use the arrow to move from Available to Selected):
   - ✅ **Access and manage your data (api)**
   - ✅ **Perform requests on your behalf at any time (refresh_token, offline_access)**
   - ✅ **Full access (full)**

4. **Additional Settings**:
   - ☐ Leave "Require Secret for Web Server Flow" checked (default)
   - ☐ Leave "Require Secret for Refresh Token Flow" checked (default)
   - ☐ Leave "Enable Authorization Code and Credentials Flow" unchecked

### Step 6: Save and Wait
1. Click **"Save"** at the bottom
2. Click **"Continue"** on the warning popup
3. ⏳ **IMPORTANT**: Wait 2-10 minutes for the app to propagate across Salesforce servers
   - You might see "Remote site settings error" initially - this is normal
   - Salesforce needs time to register your app globally

### Step 7: Get Your Credentials
1. After saving, you'll see the Connected App details page
2. Click **"Manage Consumer Details"** button
3. You may need to verify your identity (check email for verification code)
4. Copy these two values:

   **Consumer Key** (Client ID):
   ```
   Long string like: 3MVG9_XbMLGRfhH7g...
   ```

   **Consumer Secret** (Client Secret):
   ```
   Long string like: 1234567890123456789...
   ```

### Step 8: Add to Environment Variables
1. Open your `.env.local` file in the project root
2. Add these lines:

```env
SALESFORCE_CLIENT_ID=your_consumer_key_here
SALESFORCE_CLIENT_SECRET=your_consumer_secret_here
```

Replace the values with your actual Consumer Key and Consumer Secret.

### Step 9: Restart Your Development Server
```bash
# Stop your dev server (Ctrl+C)
# Restart it
npm run dev
```

### Step 10: Test the Connection
1. Go to your app (http://localhost:3000)
2. Click the **plugins button** (⚡) in the footer
3. Find **"Salesforce"** in the list
4. Click **"Connect"**
5. You'll be redirected to Salesforce login
6. Enter your Salesforce credentials
7. Click **"Allow"** to grant permissions
8. You should be redirected back and see Salesforce as connected!

---

## Troubleshooting

### Error: "redirect_uri_mismatch"
**Problem**: The callback URL doesn't match.

**Solution**:
- Double-check the callback URL in your Connected App matches exactly
- For localhost: `http://localhost:3000/oauth/callback/salesforce`
- No trailing slash
- Use http (not https) for localhost

### Error: "invalid_client_id"
**Problem**: Consumer Key is incorrect or app not propagated yet.

**Solution**:
- Wait 5-10 minutes after creating the app
- Verify you copied the entire Consumer Key
- Check for extra spaces in .env.local

### Error: "invalid_client"
**Problem**: Consumer Secret is incorrect.

**Solution**:
- Regenerate the Consumer Secret in Salesforce
- Copy the new secret to .env.local
- Restart your dev server

### Can't Find "App Manager"
**Problem**: Different Salesforce navigation.

**Solution**:
- Setup → Platform Tools → Apps → App Manager
- OR use Quick Find box and type "App Manager"

### "Insufficient Privileges"
**Problem**: Your user doesn't have permission to create Connected Apps.

**Solution**:
- You need System Administrator permission
- Contact your Salesforce admin
- OR use a Salesforce Developer Edition (you're automatically admin)

---

## Production Deployment Checklist

When deploying to production:

1. ✅ Add production callback URL to Connected App:
   ```
   https://your-production-domain.com/oauth/callback/salesforce
   ```

2. ✅ Set environment variables in production:
   ```env
   SALESFORCE_CLIENT_ID=your_consumer_key
   SALESFORCE_CLIENT_SECRET=your_consumer_secret
   NEXT_PUBLIC_APP_URL=https://your-production-domain.com
   ```

3. ✅ Test OAuth flow in production

4. ✅ Monitor API usage in Salesforce Setup → System Overview

---

## Useful Salesforce Links

- **Developer Edition Signup**: https://developer.salesforce.com/signup
- **Login**: https://login.salesforce.com
- **Sandbox Login**: https://test.salesforce.com (for sandbox orgs)
- **API Documentation**: https://developer.salesforce.com/docs/apis
- **Connected Apps Guide**: https://help.salesforce.com/s/articleView?id=sf.connected_app_overview.htm

---

## Security Notes

⚠️ **Never commit .env.local to git**
- It's already in .gitignore
- Consumer Secret is sensitive - treat like a password

⚠️ **Rotate secrets if exposed**
- In Setup → App Manager → Your App → Edit
- Click "Regenerate" next to Consumer Secret

⚠️ **Use different Connected Apps for dev/staging/production**
- Better security isolation
- Easier to revoke if needed

---

## What Gets Access?

When users connect Salesforce, your app gets:
- ✅ Read/write access to all Salesforce objects (Leads, Accounts, Contacts, etc.)
- ✅ Ability to create, update, query records
- ✅ Access remains until user disconnects or token expires
- ✅ Refresh tokens allow long-term access

Users can revoke access anytime:
- Salesforce Setup → Connected Apps OAuth Usage
- Your app settings → Disconnect

---

## Next Steps After Setup

Once connected, you can use these actions:
- **Leads**: Create, query, update leads
- **Accounts**: Create and search companies
- **Contacts**: Add people to accounts
- **Opportunities**: Track sales pipeline

Test with the sandbox agent or create a custom workflow!
