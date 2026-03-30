# Notion OAuth Fix - Complete

## Problem
Notion OAuth was completing successfully but connection was not being saved to the database or showing in the footer UI.

## Root Cause
The Notion API requires a `Notion-Version` header when fetching user profile information. Without this header, the profile fetch was failing, which prevented `savePluginConnection()` from being called.

## Solution
Updated the OAuth profile fetching logic to support plugin-specific headers through the `profile_headers` configuration field.

### Files Modified

1. **`/lib/server/user-plugin-connections.ts`**
   - Line 367: Changed `fetchUserProfile()` call to pass full `authConfig` object
   - Lines 858-897: Updated `fetchUserProfile()` method to:
     - Accept `authConfig: PluginAuthConfig` instead of individual parameters
     - Extract and merge `profile_headers` from authConfig into fetch headers
     - Log when plugin-specific headers are added

### How It Works

The fix replicates the Google Drive pattern:

**Google Drive approach:**
- Uses special `auth_type: "oauth2_google"`
- Gets custom handling in switch case

**Notion approach:**
- Uses generic `auth_type: "oauth2"` with `profile_url` provided
- Adds `profile_headers: { "Notion-Version": "2022-06-28" }` in plugin definition
- Headers are automatically merged into profile fetch request

### Code Changes

```typescript
// Before (hardcoded headers)
const response = await fetch(profileUrl, {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
  },
});

// After (supports plugin-specific headers)
const headers: Record<string, string> = {
  'Authorization': `Bearer ${accessToken}`,
  'Accept': 'application/json',
};

if ((authConfig as any).profile_headers) {
  Object.assign(headers, (authConfig as any).profile_headers);
  logger.debug({ profileHeaders: (authConfig as any).profile_headers }, 'Adding plugin-specific headers to profile fetch');
}

const response = await fetch(profileUrl, { headers });
```

## Benefits

1. **Generic Solution**: Works for ANY plugin that needs custom headers, not just Notion
2. **No Hardcoding**: Follows the platform principle of being schema-driven
3. **Follows Existing Patterns**: Replicates how Google Drive handles auth-type specific logic
4. **Backward Compatible**: Existing plugins without `profile_headers` continue to work

## Expected Behavior

When a user connects to Notion:
1. OAuth authorization completes successfully ✅
2. Token exchange succeeds (using Basic Auth) ✅
3. Profile fetch includes `Notion-Version: 2022-06-28` header ✅ (NEW)
4. Connection saved to `plugin_connections` table ✅ (FIXED)
5. Notion appears in Footer UI with connected plugins ✅ (FIXED)

## Testing

Run the verification script:
```bash
npx tsx scripts/verify-notion-profile-headers.ts
```

All checks should pass with ✅.

## Status

✅ **COMPLETE** - Ready for testing in the UI
