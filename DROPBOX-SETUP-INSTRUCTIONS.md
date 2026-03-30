# Dropbox Plugin OAuth Setup Guide

## Overview

This guide walks you through setting up OAuth for the Dropbox plugin in NeuronForge.

**⚠️ Important**: There are TWO ways to connect Dropbox:
1. **Generated Access Token** (Quick test - expires, not for production)
2. **OAuth 2.0 App** (Recommended - persistent, secure)

This guide covers **OAuth 2.0 setup**. If you only see a "Generated access token" in your app settings, you need to create a new app following these steps.

---

## Understanding Dropbox App Types

When you create a Dropbox app, you'll see different options:

### App Console Location

After creating an app, the **Settings** tab shows:
- **App key**: Your OAuth client ID (visible immediately)
- **App secret**: Your OAuth client secret (click "Show" to reveal)
- **Generated access token**: A test token (⚠️ NOT for OAuth - this expires!)

**What you need**: App key + App secret (NOT the generated access token)

---

## Step 1: Create Dropbox Account

1. Go to [dropbox.com](https://www.dropbox.com)
2. Sign up for a free account or sign in if you already have one

---

## Step 2: Create a Dropbox App

1. **Go to Dropbox App Console**:
   - Visit [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
   - Click **Create app** button

2. **Choose API**:
   - Select **Scoped access** (recommended, uses modern Dropbox API v2)

3. **Choose Access Type**:
   - Select **Full Dropbox** - Access to all files and folders
   - OR **App folder** - Access only to a specific app folder (more restrictive)
   - 💡 **Recommendation**: Choose **Full Dropbox** for NeuronForge to work with all your files

4. **Name Your App**:
   - App name: `NeuronForge` (or your custom name)
   - ⚠️ **Note**: App name must be unique across all Dropbox apps

5. **Click "Create app"**

---

## Step 3: Configure OAuth Settings

1. **Go to "Settings" Tab**:
   - You'll land on the Settings tab automatically

2. **Add Redirect URIs**:

   Scroll to **OAuth 2** section and find **Redirect URIs**:

   Add these URLs:
   ```
   http://localhost:3000/oauth/callback/dropbox
   https://yourdomain.com/oauth/callback/dropbox
   ```

   ⚠️ **Important**:
   - Click **Add** button after entering each URL
   - Add BOTH localhost (for dev) and production URL
   - Must match exactly (no trailing slash)
   - Use your actual domain for production

3. **Copy Your App Credentials**:

   In the **OAuth 2** section, you'll see:
   ```
   App key: abc123xyz...
   App secret: [Click "Show" to reveal]
   ```

   **Copy both values** - you'll need them in Step 4

---

## Step 4: Configure Permissions

**⚠️ CRITICAL STEP - Dropbox Uses PKCE and Scopes are Implicit**

Dropbox OAuth 2 with PKCE doesn't require explicit scope selection during app creation. Scopes are determined by the app's permission type:

1. **Go to "Permissions" Tab**:
   - Click on the **Permissions** tab in your app settings

2. **Review Granted Permissions**:

   For **Full Dropbox** access, your app automatically has these permissions:
   - ✅ `files.metadata.write` - Create, modify, delete file metadata
   - ✅ `files.metadata.read` - View file and folder metadata
   - ✅ `files.content.write` - Create, upload, modify file content
   - ✅ `files.content.read` - Download and read file content
   - ✅ `sharing.write` - Create and manage shared links

3. **Enable Required Permissions** (if using granular scopes):

   If you want to customize permissions, check these boxes:
   - ✅ **files.metadata.write**
   - ✅ **files.metadata.read**
   - ✅ **files.content.write**
   - ✅ **files.content.read**
   - ✅ **sharing.write** (for creating shared links)

4. **Click "Submit"** at the bottom if you made changes

---

## Step 5: Configure Environment Variables

1. **Open your project's `.env.local` file**:

   ```bash
   # Dropbox OAuth Configuration
   DROPBOX_APP_KEY=abc123xyz...
   DROPBOX_APP_SECRET=your_app_secret_here
   ```

2. **Replace placeholders**:
   - `DROPBOX_APP_KEY`: Paste your **App key** from Step 3
   - `DROPBOX_APP_SECRET`: Paste your **App secret** from Step 3

3. **Verify `NEXT_PUBLIC_APP_URL` is set**:
   ```bash
   # Already in your .env.local (required for OAuth redirect)
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Save the file**

---

## Step 6: Restart Development Server

```bash
# Stop your dev server (Ctrl+C)

# Restart it
npm run dev
```

---

## Step 7: Test OAuth Connection

1. **Go to Dashboard**: `/v2/dashboard`

2. **Click Footer Plugin Management**:
   - Click **+ Connect Plugin** or plugin icon area

3. **Select Dropbox**:
   - Find **Dropbox** in the plugin list
   - Click **Connect**

4. **OAuth Flow**:
   - Popup opens to `dropbox.com/oauth2/authorize`
   - Dropbox asks: "Allow NeuronForge to access your Dropbox?"
   - Grant permissions

5. **Success Indicators**:
   - ✅ Popup shows "Authorization Successful!"
   - ✅ Popup auto-closes after 500ms
   - ✅ Footer shows Dropbox icon in connected plugins
   - ✅ Console logs: `[OAuth Callback] Sending postMessage to parent window`

---

## Troubleshooting

### Issue 1: "Invalid App Key"

**Cause**: App key doesn't match Dropbox app

**Fix**:
1. Verify `DROPBOX_APP_KEY` in `.env.local` matches Dropbox App Console
2. Check for typos (app key is alphanumeric)
3. Restart dev server after changing `.env.local`

---

### Issue 2: "Redirect URI Mismatch"

**Error Message**:
```
redirect_uri_mismatch: The redirect URI provided does not match any redirect URIs registered for your app
```

**Cause**: OAuth redirect URL doesn't match configured URLs

**Fix**:
1. Go to Dropbox App Console → Your app → **Settings** tab
2. Scroll to **OAuth 2** → **Redirect URIs**
3. Ensure you have:
   ```
   http://localhost:3000/oauth/callback/dropbox
   ```
4. Click **Add** after entering the URL
5. Try connecting again

---

### Issue 3: "Invalid Client Secret"

**Cause**: App secret incorrect or regenerated

**Fix**:
1. In Dropbox App Console, go to **Settings** tab
2. Find **App secret** in **OAuth 2** section
3. Click **Show** to reveal the secret
4. If needed, click **Generate** to create a new secret
5. Update `DROPBOX_APP_SECRET` in `.env.local`
6. Restart dev server

---

### Issue 4: "Forbidden - Access Denied"

**Cause**: App doesn't have required permissions

**Fix**:
1. Go to **Permissions** tab in Dropbox App Console
2. Ensure these permissions are enabled:
   - `files.metadata.write`
   - `files.metadata.read`
   - `files.content.write`
   - `files.content.read`
   - `sharing.write`
3. Click **Submit** to save changes
4. **IMPORTANT**: You must re-authorize the app
5. Disconnect and reconnect Dropbox in NeuronForge

---

### Issue 5: "Popup Closes Immediately"

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
[OAuth Callback] Plugin: dropbox
[OAuth Callback] Target origin: http://localhost:3000
[OAuth Callback] postMessage sent successfully
[OAuth Callback] Closing window now
```

---

### Issue 6: "App Not Published" Warning

**Warning**: Dropbox may show "This app is in development mode"

**This is Normal**:
- Development mode apps work fine for testing
- Limited to your account and up to 500 users
- To remove warning: Submit app for Production Status review
- **Not required** for personal use or internal tools

**To Apply for Production**:
1. Go to **Settings** tab → **Status** section
2. Click **Apply for Production**
3. Fill out questionnaire about your app
4. Dropbox reviews (1-2 weeks)

---

## Available Actions (After OAuth Connection)

### ✅ File Operations:
- `list_files` - List files and folders
- `search_files` - Search by name or content
- `download_file` - Download file content
- `upload_file` - Upload files
- `get_file_metadata` - Get file details

### ✅ Folder Operations:
- `create_folder` - Create new folders
- `get_or_create_folder` - Idempotent folder creation

### ✅ File Management:
- `delete_file` - Delete files/folders
- `move_file` - Move files between folders
- `copy_file` - Copy files/folders

### ✅ Sharing:
- `create_shared_link` - Generate sharing links

---

## Dropbox API Features

### PKCE (Proof Key for Code Exchange)

Dropbox requires **PKCE** for OAuth 2.0, which provides enhanced security:
- No client secret sent in authorization request
- Code verifier/challenge prevents authorization code interception
- More secure than traditional OAuth 2.0

NeuronForge automatically handles PKCE - you don't need to configure anything!

### Scopes

Dropbox doesn't use explicit scopes in OAuth URL. Instead:
- Permissions are tied to your app's **Permission Type** (Full Dropbox vs App Folder)
- Granular permissions are set in **Permissions** tab
- Users see all granted permissions during authorization

### Path Format

Dropbox uses specific path conventions:
- **Root folder**: Empty string `""` or `"/"`
- **Subfolders**: Leading slash required (e.g., `"/Documents"`)
- **Files**: Full path including filename (e.g., `"/Documents/report.pdf"`)
- **Case-sensitive**: Paths are case-sensitive

---

## Dropbox API Rate Limits

- **API calls**: No hard limit, but throttling applies
- **Batch operations**: Recommended to batch file operations
- **Upload limits**:
  - Regular upload: 150 MB per file
  - Upload sessions: Unlimited file size (in chunks)
- **Download limits**: No hard limit

**Best Practices**:
- Implement retry logic with exponential backoff
- Use batch endpoints when available
- Cache file metadata to reduce API calls

---

## Production Deployment

When deploying to production:

1. **Update Redirect URL in Dropbox**:
   - Go to App Console → Your app → **Settings** tab
   - Add production URL to **Redirect URIs**:
     ```
     https://yourdomain.com/oauth/callback/dropbox
     ```
   - Click **Add**

2. **Set Production Environment Variables**:
   ```bash
   # In your hosting platform (Vercel, Netlify, etc.)
   DROPBOX_APP_KEY=abc123xyz...
   DROPBOX_APP_SECRET=your_app_secret_here
   NEXT_PUBLIC_APP_URL=https://yourdomain.com
   ```

3. **Consider Production Status**:
   - Development mode works for up to 500 users
   - Apply for Production Status if you need more users
   - Production apps get verified badge

4. **Test OAuth Flow on Production**:
   - Use production URL to test connection
   - Verify redirect works correctly

---

## Security Best Practices

1. ✅ Never commit `.env.local` to git (already in `.gitignore`)
2. ✅ Use different Dropbox apps for dev/staging/production
3. ✅ Regularly rotate app secret (every 90 days)
4. ✅ Monitor OAuth logs for suspicious activity
5. ✅ Use minimum required permissions (App Folder if possible)
6. ✅ Enable two-factor authentication on your Dropbox account

---

## Differences from Google Drive

| Feature | Dropbox | Google Drive |
|---------|---------|--------------|
| **OAuth Flow** | PKCE required | Standard OAuth 2.0 |
| **Scopes** | Permission-based | Explicit scopes |
| **Path Format** | `/folder/file.txt` | File ID-based |
| **Folder Access** | Full path or App Folder | Hierarchical IDs |
| **API Style** | RESTful JSON | Google API format |
| **Rate Limits** | Soft throttling | Hard quota limits |

---

## Additional Resources

- **Dropbox API Docs**: [dropbox.com/developers/documentation](https://www.dropbox.com/developers/documentation)
- **OAuth Guide**: [dropbox.com/developers/reference/oauth-guide](https://www.dropbox.com/developers/reference/oauth-guide)
- **App Console**: [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
- **API Explorer**: [dropbox.com/developers/api-explorer](https://www.dropbox.com/developers/api-explorer)

---

## Next Steps

After successful OAuth connection:

1. **Test basic actions**: Try `list_files` and `get_file_metadata`
2. **Test file uploads**: Upload a test file with `upload_file`
3. **Create workflows**: Combine Dropbox with other plugins
4. **Monitor API usage**: Check App Console for usage stats

---

**Need Help?**

If you encounter issues not covered here:
1. Check browser console for detailed error logs
2. Check server logs for OAuth callback errors
3. Verify all environment variables are set correctly
4. Test with Dropbox API Explorer to rule out account issues
