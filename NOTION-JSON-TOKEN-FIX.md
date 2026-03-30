# Notion OAuth JSON Token Exchange Fix

## Problem Identified

The `invalid_client` error was caused by using the wrong Content-Type for Notion's token exchange request.

### What Was Wrong

**Our implementation:**
```typescript
headers: {
  'Content-Type': 'application/x-www-form-urlencoded',  // ❌ WRONG
  'Authorization': 'Basic ...'
}
body: new URLSearchParams(tokenParams)  // URL-encoded format
```

**Notion expects:**
```typescript
headers: {
  'Content-Type': 'application/json',  // ✅ CORRECT
  'Authorization': 'Basic ...'
}
body: JSON.stringify(tokenParams)  // JSON format
```

## Root Cause

According to [Notion's OAuth documentation](https://developers.notion.com/reference/create-a-token), the token endpoint expects:
- `Content-Type: application/json`
- JSON body with `grant_type`, `code`, and `redirect_uri`

Most OAuth providers use `application/x-www-form-urlencoded`, but Notion is different.

## Solution Implemented

### 1. Added `token_format` flag to plugin config

Updated [notion-plugin-v2.json](lib/plugins/definitions/notion-plugin-v2.json:22):
```json
"auth_config": {
  "auth_type": "oauth2",
  ...
  "uses_basic_auth": true,
  "token_format": "json",  // NEW: Tells system to use JSON format
  "profile_headers": {
    "Notion-Version": "2022-06-28"
  }
}
```

### 2. Updated token exchange logic

Modified [user-plugin-connections.ts](lib/server/user-plugin-connections.ts:310-345) to:
- Check for `token_format === 'json'` flag
- Use JSON.stringify() instead of URLSearchParams when JSON format is required
- Set appropriate Content-Type header

```typescript
// Determine format based on auth config
const useJsonFormat = (authConfig as any).token_format === 'json';

const headers: Record<string, string> = {
  'Content-Type': useJsonFormat ? 'application/json' : 'application/x-www-form-urlencoded',
  'Accept': 'application/json',
};

// Prepare body in correct format
const body = useJsonFormat
  ? JSON.stringify(tokenParams)
  : new URLSearchParams(tokenParams);
```

## Benefits

1. **Generic Solution**: Any plugin can specify `token_format: "json"` if needed
2. **Backward Compatible**: Existing plugins continue to use URL-encoded format (default)
3. **Schema-Driven**: No hardcoding - follows plugin configuration pattern
4. **Follows Best Practices**: Matches how we handle other provider-specific requirements

## Expected Behavior

When connecting to Notion now:

1. ✅ OAuth authorization completes
2. ✅ Token exchange uses JSON format with Basic Auth
3. ✅ Access token received successfully
4. ✅ Profile fetch includes Notion-Version header
5. ✅ Connection saved to plugin_connections table
6. ✅ Notion appears in Footer UI

## Testing

Restart your dev server and try connecting to Notion again:

```bash
npm run dev
```

Then click "Connect" for Notion in the UI. You should see:

**Server logs:**
```
{"level":30,"msg":"Token exchange request format","useJsonFormat":true}
{"level":30,"msg":"Tokens received successfully"}
{"level":30,"msg":"User profile fetched successfully"}
{"level":30,"msg":"Connection saved successfully"}
```

**UI:**
- Popup shows "Authorization Successful!"
- Notion appears in Footer with connected plugins
- Entry exists in plugin_connections table

## Sources

- [Notion OAuth Create Token Documentation](https://developers.notion.com/reference/create-a-token)
- [Notion Authorization Guide](https://developers.notion.com/docs/authorization)
