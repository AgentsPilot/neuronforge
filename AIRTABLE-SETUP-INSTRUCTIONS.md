# Airtable Plugin OAuth Setup Guide

## Overview

This guide walks you through setting up OAuth for the Airtable plugin in NeuronForge.

---

## Step 1: Create Airtable Account

1. Go to [airtable.com](https://airtable.com)
2. Click **Sign up for free**
3. Create account with email or Google

---

## Step 2: Create an OAuth Integration

1. **Go to Developer Hub**
   - Visit [airtable.com/create/oauth](https://airtable.com/create/oauth)
   - OR: Click your profile → **Developer hub** → **Create new OAuth integration**

2. **Fill in Integration Details**:
   - **Integration name**: `NeuronForge` (or your app name)
   - **Integration description**: `Workflow automation platform connecting to Airtable`
   - **Integration logo**: Upload your logo (optional)

3. **Configure OAuth Settings**:

   **a) Redirect URLs**:
   ```
   http://localhost:3000/oauth/callback/airtable
   https://yourdomain.com/oauth/callback/airtable
   ```

   ⚠️ **Important**:
   - Add BOTH localhost (for dev) and production URL
   - Must match exactly (trailing slash matters)
   - Use your actual domain for production

   **b) Select Scopes** (CRITICAL - Must Check All 4 Boxes):

   **⚠️ THIS IS THE MOST COMMON ERROR POINT ⚠️**

   In the **"Scopes"** section of the OAuth integration form, you MUST check these boxes:

   - ✅ **data.records:read** - "Read records from bases"
   - ✅ **data.records:write** - "Create and edit records in bases"
   - ✅ **schema.bases:read** - "See the structure of a base and its tables"
   - ✅ **user.email:read** - "See the email address of the user"

   **Screenshot location**: Look for "Scopes" heading with checkboxes below it

   ⚠️ **If you forget to check these boxes, you'll get an "invalid_scope" error!**

4. **Save Integration**
   - Click **Create OAuth integration** button at the bottom

---

## Step 3: Get OAuth Credentials

After creating the integration:

1. You'll see your **OAuth integration details**:
   ```
   Client ID: oauXXXXXXXXXXXXXXXX
   Client Secret: [Click "Show" to reveal]
   ```

2. **Copy these values** - you'll need them in Step 4

⚠️ **Security Notes**:
- Never commit `Client Secret` to git
- Store in `.env.local` (already gitignored)
- Regenerate secret if accidentally exposed

---

## Step 4: Configure Environment Variables

1. **Open your project's `.env.local` file** (create if doesn't exist):

   ```bash
   # Airtable OAuth Configuration
   AIRTABLE_CLIENT_ID=oauXXXXXXXXXXXXXXXX
   AIRTABLE_CLIENT_SECRET=your_client_secret_here
   ```

2. **Replace placeholders**:
   - `AIRTABLE_CLIENT_ID`: Paste your Client ID from Step 3
   - `AIRTABLE_CLIENT_SECRET`: Paste your Client Secret from Step 3

3. **Verify `NEXT_PUBLIC_APP_URL` is set**:
   ```bash
   # Already in your .env.local (required for OAuth redirect)
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Save the file**

---

## Step 5: Restart Development Server

The OAuth credentials are loaded at server startup:

```bash
# Stop your dev server (Ctrl+C)

# Restart it
npm run dev
```

---

## Step 6: Test OAuth Connection

1. **Go to Dashboard**:
   - Navigate to `/v2/dashboard`

2. **Click Footer Middle Section**:
   - Hover over plugin icons area
   - Click **+ Connect Plugin** or plugin management UI

3. **Select Airtable**:
   - Find **Airtable** in the plugin list
   - Click **Connect**

4. **OAuth Flow**:
   - Popup opens to `airtable.com/oauth2/v1/authorize`
   - You'll see: "NeuronForge wants to access your Airtable account"
   - Grant permissions for the 4 scopes

5. **Success Indicators**:
   - ✅ Popup shows "Authorization Successful!"
   - ✅ Popup auto-closes after 500ms
   - ✅ Footer shows Airtable icon in connected plugins
   - ✅ Console logs: `[OAuth Callback] Sending postMessage to parent window`

---

## Troubleshooting

### Issue 1: "invalid_scope" Error (MOST COMMON)

**Error Message**:
```
invalid_scope: Your OAuth application requested the scope "data.records:read data.records:write schema.bases:read user.email:read" which your application does not have access to
```

**Cause**: You didn't check the scope checkboxes when creating the OAuth integration

**Fix**:
1. Go to [Airtable Developer Hub](https://airtable.com/create/oauth)
2. Click on your OAuth integration name
3. Click **Edit** button
4. Scroll to **"Scopes"** section
5. **Check ALL 4 boxes**:
   - ✅ data.records:read
   - ✅ data.records:write
   - ✅ schema.bases:read
   - ✅ user.email:read
6. Click **Save changes**
7. Try connecting again in NeuronForge

---

### Issue 2: "Invalid Client ID"

**Cause**: Client ID doesn't match Airtable records

**Fix**:
1. Verify `AIRTABLE_CLIENT_ID` in `.env.local` matches Airtable Developer Hub
2. Check for typos (should start with `oau`)
3. Restart dev server after changing `.env.local`

---

### Issue 2: "Invalid Client ID"

**Cause**: Client ID doesn't match Airtable records

**Fix**:
1. Verify `AIRTABLE_CLIENT_ID` in `.env.local` matches Airtable Developer Hub
2. Check for typos (should start with `oau`)
3. Restart dev server after changing `.env.local`

---

### Issue 3: "Redirect URI Mismatch"

**Cause**: OAuth redirect URL doesn't match configured URLs

**Fix**:
1. Go to Airtable Developer Hub → Your integration → Edit
2. Check **Redirect URLs** section
3. Must include:
   ```
   http://localhost:3000/oauth/callback/airtable
   ```
4. Ensure exact match (no trailing slash, correct protocol)
5. Click **Save changes**

---

### Issue 3: "Invalid Client Secret"

**Cause**: Client secret incorrect or expired

**Fix**:
1. In Airtable Developer Hub, click **Regenerate client secret**
2. Copy new secret immediately
3. Update `AIRTABLE_CLIENT_SECRET` in `.env.local`
4. Restart dev server

---

### Issue 4: Popup Closes Immediately

**Cause**: OAuth callback not communicating with parent window

**Fix**:
1. Check browser console for errors
2. Verify `NEXT_PUBLIC_APP_URL` matches current domain
3. Check popup blocker settings
4. Try different browser (Chrome/Firefox)

**Debug logs to check**:
```javascript
// In browser console when popup opens:
[OAuth Callback] Sending postMessage to parent window
[OAuth Callback] Plugin: airtable
[OAuth Callback] Target origin: http://localhost:3000
[OAuth Callback] postMessage sent successfully
[OAuth Callback] Closing window now
```

If you see `No window.opener found!`:
- Browser popup blocker is active
- Window opened in new tab instead of popup
- Try disabling extensions temporarily

---

### Issue 5: "Plugin configuration not found"

**Cause**: Plugin definition not loaded by PluginManagerV2

**Fix**:
1. Verify file exists: `/lib/plugins/definitions/airtable-plugin-v2.json`
2. Check it's registered in `/lib/server/plugin-manager-v2.ts` (line 25)
3. Restart dev server to reload plugin definitions

---

### Issue 6: OAuth works but plugin doesn't appear in footer

**Cause**: Footer state not refreshing after connection

**Fix**:
1. Check Footer.tsx calls `refreshPlugins()` after OAuth (line 282, 335)
2. Hard refresh page (Cmd+Shift+R / Ctrl+Shift+R)
3. Check browser console for errors
4. Verify connection saved in database:
   ```sql
   SELECT * FROM user_plugin_connections
   WHERE plugin_key = 'airtable'
   ORDER BY connected_at DESC LIMIT 1;
   ```

---

## Verify Connection

Once connected, you can test the plugin:

1. **Check UserProvider Context**:
   - Footer should show Airtable icon with tooltip
   - Icon should be colored (not grayed out)

2. **Test Plugin Actions**:
   ```javascript
   // Create a simple workflow that uses Airtable
   // Example: List all bases
   {
     "plugin": "airtable",
     "action": "list_bases",
     "parameters": {}
   }
   ```

3. **Check Available Actions**:
   The Airtable plugin supports 8 actions:
   - `list_bases` - List all bases you have access to
   - `list_tables` - List tables in a base
   - `list_records` - Get records from a table
   - `get_record` - Get single record by ID
   - `create_records` - Create new records
   - `update_records` - Update existing records
   - `upload_attachment` - Upload file to attachment field
   - `get_attachment_urls` - Get URLs for attachments

---

## Production Deployment

When deploying to production:

1. **Update Redirect URL in Airtable**:
   - Go to Developer Hub → Your integration → Edit
   - Add production URL:
     ```
     https://yourdomain.com/oauth/callback/airtable
     ```

2. **Set Production Environment Variables**:
   ```bash
   # In your hosting platform (Vercel, Netlify, etc.)
   AIRTABLE_CLIENT_ID=oauXXXXXXXXXXXXXXXX
   AIRTABLE_CLIENT_SECRET=your_client_secret_here
   NEXT_PUBLIC_APP_URL=https://yourdomain.com
   ```

3. **Test OAuth Flow on Production**:
   - Use production URL to test connection
   - Verify redirect works correctly

---

## Security Best Practices

1. ✅ Never commit `.env.local` to git (already in `.gitignore`)
2. ✅ Use different OAuth apps for dev/staging/production
3. ✅ Rotate client secret periodically
4. ✅ Monitor OAuth logs for suspicious activity
5. ✅ Limit scopes to minimum required permissions

---

## Additional Resources

- **Airtable OAuth Docs**: [airtable.com/developers/web/api/oauth-reference](https://airtable.com/developers/web/api/oauth-reference)
- **Airtable API Reference**: [airtable.com/developers/web/api/introduction](https://airtable.com/developers/web/api/introduction)
- **Developer Hub**: [airtable.com/create/oauth](https://airtable.com/create/oauth)

---

## Next Steps

After successful OAuth connection:

1. **Create your first workflow** using Airtable actions
2. **Test different actions** (list bases, create records, etc.)
3. **Check execution logs** in WorkflowPilot for any issues
4. **Build complex workflows** combining Airtable with other plugins

---

**Need Help?**

If you encounter issues not covered here:
1. Check browser console for detailed error logs
2. Check server logs for OAuth callback errors
3. Verify all environment variables are set correctly
4. Test with a fresh Airtable account to rule out permission issues
