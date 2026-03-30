# Notion OAuth "invalid_client" Error - Diagnosis

## Error Details

```
Token exchange failed: 401
{"error":"invalid_client","request_id":"15945588-1703-4c91-9210-b59a1243e447"}
```

## What's Happening

1. ✅ User successfully authorizes in Notion OAuth popup
2. ✅ Authorization code is returned to callback
3. ❌ Token exchange request fails with "invalid_client"
4. ❌ Connection not saved to database

## Root Cause

The "invalid_client" error during token exchange happens when Notion rejects the client credentials. Based on [Notion's OAuth documentation](https://developers.notion.com/reference/create-a-token), this typically means:

1. **Redirect URI Mismatch** (Most Common) - The redirect_uri in the token exchange request doesn't EXACTLY match what's registered in your Notion integration settings
2. **Incorrect Credentials** - Client ID or Secret is wrong
3. **Integration Type** - OAuth integration must be set to "Public" (not "Internal")
4. **Revoked Integration** - The integration has been disabled or deleted

## Our Configuration

Based on testing, our implementation is sending:

```
POST https://api.notion.com/v1/oauth/token
Headers:
  Content-Type: application/x-www-form-urlencoded
  Accept: application/json
  Authorization: Basic <base64(client_id:client_secret)>

Body:
  grant_type=authorization_code
  code=<authorization_code>
  redirect_uri=http://localhost:3000/oauth/callback/notion
```

✅ Credentials are loading correctly from .env.local
✅ Basic Auth header is properly encoded
✅ Request format matches Notion documentation
✅ Code logic is correct (uses_basic_auth: true)

## What to Check in Notion Integration Settings

Go to https://www.notion.so/my-integrations and verify:

### 1. Redirect URIs (CRITICAL!)

The Notion integration must have this **exact** redirect URI:
```
http://localhost:3000/oauth/callback/notion
```

**Important**:
- Must match EXACTLY (case-sensitive)
- Include the full protocol (`http://` not `https://` for localhost)
- Include the port number (`:3000`)
- No trailing slash
- If testing on a deployed URL, use that URL instead

### 2. Integration Type

- Must be set to **"Public"** (not "Internal")
- Public integrations support OAuth 2.0
- Internal integrations use a different authentication method

### 3. Client Credentials

Verify that:
- The Client ID in Notion matches: `322d872b-594c-81a5-b996-0...`
- The Client Secret in Notion matches: `secret_mv8MO86S1VEvC...`
- Credentials haven't been regenerated (which would invalidate old ones)

### 4. Integration Status

- Integration should be "Active" (not archived or deleted)
- Not in a suspended or restricted state

## How to Fix

1. **Go to Notion Integration Settings**
   - Visit https://www.notion.so/my-integrations
   - Find your OAuth integration (or create a new one)

2. **Configure OAuth Settings**
   - Set Type: **Public**
   - Add Redirect URI: `http://localhost:3000/oauth/callback/notion`
   - For production, add: `https://your-domain.com/oauth/callback/notion`

3. **Copy Fresh Credentials**
   - Copy the Client ID
   - Copy the Client Secret (or generate new if needed)
   - Update `.env.local` file:
     ```
     NOTION_CLIENT_ID=<your-client-id>
     NOTION_CLIENT_SECRET=<your-client-secret>
     ```

4. **Restart Dev Server**
   ```bash
   # Stop the server (Ctrl+C)
   npm run dev
   ```

5. **Test Connection Again**
   - Try connecting Notion from the UI
   - Check server logs for success

## Testing Commands

Run these to verify configuration:

```bash
# Test credentials are loading
npx tsx scripts/test-notion-credentials.ts

# Check token exchange configuration
npx tsx scripts/test-notion-token-exchange.ts
```

## Expected Success

Once fixed, you should see in server logs:

```
{"level":30,"msg":"Tokens received successfully"}
{"level":30,"msg":"User profile fetched successfully"}
{"level":30,"msg":"Saving connection"}
{"level":30,"msg":"Connection saved successfully"}
```

## Sources

- [Notion OAuth Token Exchange Documentation](https://developers.notion.com/reference/create-a-token)
- [Notion OAuth Authorization](https://developers.notion.com/docs/authorization)
- [OAuth Status Codes](https://developers.notion.com/reference/status-codes)
