# 🔌 Plugin Generation Workflow for Claude Code

**Purpose**: This document guides Claude Code through an interactive plugin generation process for the NeuronForge platform.

**How to use**: Ask Claude Code to read this file, then say "Generate a plugin" or "Add actions to a plugin".

---

## 🎯 Overview

This workflow supports two scenarios:
1. **NEW PLUGIN**: Creating a complete plugin from scratch (definition + executor + registration)
2. **EXTEND PLUGIN**: Adding new actions to an existing plugin

You (Claude Code) will:
- Ask the user questions
- Perform web searches to gather API information
- Present recommendations
- Generate all necessary files
- Validate the generated code
- Update environment variable templates

---

## 📋 Step-by-Step Workflow

### **STEP 1: Gather Initial Information**

Ask the user:

```
🔌 Plugin Generation Assistant

Which plugin would you like to work with?
(e.g., "notion", "trello", "asana", "discord")

Plugin name: _______
```

Store the plugin name as `pluginName` (lowercase, hyphenated).

---

### **STEP 2: Check if Plugin Already Exists**

Check if the plugin already exists by looking for:
- `lib/plugins/definitions/{pluginName}-plugin-v2.json`

**If plugin EXISTS**:
```
✅ Found existing plugin: {pluginName}

Current actions:
- action_1
- action_2
- action_3

Would you like to:
1. Add new actions to this plugin
2. Start from scratch (will overwrite existing)

Your choice (1 or 2): _______
```

**If user chooses 1**: Set `mode = "extend"`, skip to STEP 4 (skip OAuth research).

**If user chooses 2**: Set `mode = "new"`, continue to STEP 3.

**If plugin DOES NOT exist**:
```
🆕 Creating new plugin: {pluginName}

Proceeding with full plugin generation...
```

Set `mode = "new"`, continue to STEP 3.

---

### **STEP 3: Research OAuth Configuration** (Skip if `mode = "extend"`)

Perform web searches to gather OAuth information:

**Search Query 1**: `"{pluginName} OAuth 2.0 authentication setup guide"`

**Search Query 2**: `"{pluginName} API OAuth scopes required"`

**Search Query 3**: `"{pluginName} OAuth redirect URI configuration"`

**Analyze the results and extract**:
- OAuth provider URLs (auth_url, token_url, refresh_url)
- Required scopes
- OAuth flow type (OAuth2 standard, OAuth2 Google-style, or other)

**Compare to existing implementations**:
- Review `lib/plugins/definitions/slack-plugin-v2.json` (OAuth2 standard)
- Review `lib/plugins/definitions/google-mail-plugin-v2.json` (OAuth2 Google)
- Review `lib/plugins/definitions/hubspot-plugin-v2.json` (OAuth2 HubSpot)

**Present findings to user**:

```
📊 OAuth Configuration Research Results

Provider: {pluginName}
API Documentation: {url}

OAuth Flow Type:
✓ Standard OAuth 2.0 (similar to Slack)
  OR
✓ Google-style OAuth 2.0
  OR
⚠️ Custom OAuth flow (may require adapter)

Auth URLs:
- Authorization: {auth_url}
- Token Exchange: {token_url}
- Token Refresh: {refresh_url}
- User Profile: {profile_url}

Required Scopes:
- scope1
- scope2
- scope3

Compatibility with existing system:
✅ Fully compatible / ⚠️ Requires custom adapter / ❌ Not compatible

Proceed with this OAuth configuration? (yes/no): _______
```

Wait for user confirmation before proceeding.

---

### **STEP 4: Research Available Actions**

Perform web searches to discover available API endpoints:

**Search Query 1**: `"{pluginName} API endpoints documentation"`

**Search Query 2**: `"{pluginName} REST API reference methods"`

**Search Query 3**: `"{pluginName} API most commonly used endpoints"`

**Analyze the results and extract**:
- All available API endpoints/methods
- Categories (e.g., messages, users, files, etc.)
- Parameters for each endpoint
- Common use cases

**If `mode = "extend"`**: Load existing actions from JSON and exclude them from recommendations.

**Categorize actions** by functionality:
```
📚 Available API Actions for {pluginName}

CATEGORY: Communication
1. send_message - Send a message to a channel/user
2. read_messages - Read message history
3. update_message - Edit an existing message
4. delete_message - Delete a message

CATEGORY: Users
5. get_user_info - Get user profile details
6. list_users - List all users in workspace
7. search_users - Search for users by name/email

CATEGORY: Files
8. upload_file - Upload a file
9. download_file - Download a file
10. list_files - List files in workspace

... (continue for all discovered actions)

TOTAL DISCOVERED: {count} actions
```

**Present to user**:

```
🎯 Action Selection

I found {count} possible actions for {pluginName}.

Please select which actions you want to implement.
Type the action numbers separated by commas (e.g., "1,3,5,7")

Your selection: _______
```

**Parse user input**: Convert "1,3,5,7" → list of selected action objects.

Store as `selectedActions[]`.

---

### **STEP 5: Generate Action Specifications**

For each selected action, use web search to get detailed specifications:

**Search Query**: `"{pluginName} API {action_name} endpoint parameters"`

**Extract for each action**:
- HTTP method (GET, POST, PUT, DELETE)
- Endpoint URL
- Required parameters
- Optional parameters
- Response format
- Rate limits
- Common errors

**Create detailed spec** for each action:

```typescript
{
  action_name: "send_message",
  description: "Send a message to a channel",
  http_method: "POST",
  endpoint: "/api/v1/messages",
  required_params: ["channel_id", "message_text"],
  optional_params: ["thread_id", "attachments"],
  response_format: { message_id, timestamp },
  rate_limit: "100 requests per minute",
  common_errors: ["channel_not_found", "rate_limited", "auth_failed"]
}
```

---

### **STEP 6: Confirm Generation Plan**

Present the complete generation plan to the user:

```
📋 Generation Plan Summary

Plugin: {pluginName}
Mode: {NEW PLUGIN | EXTEND EXISTING PLUGIN}

Files to be generated/modified:
{mode === "new" ? "✨" : "📝"} lib/plugins/definitions/{pluginName}-plugin-v2.json
{mode === "new" ? "✨" : "📝"} lib/server/{pluginName}-plugin-executor.ts
{mode === "new" ? "✨" : "⚠️"} lib/server/plugin-executer-v2.ts (add to registry)
✨ app/test-plugins-v2/{pluginName}-test.ts
{mode === "new" ? "✨" : "📝"} .env.example (environment variables)

Actions to implement:
{selectedActions.map((a, i) => `${i+1}. ${a.name} - ${a.description}`).join('\n')}

OAuth Configuration: {mode === "new" ? "✅ Will be configured" : "⏭️ Skipped (existing)"}

Estimated generation time: ~30 seconds

Proceed with generation? (yes/no): _______
```

Wait for user confirmation.

---

### **STEP 7: Generate Plugin Definition JSON**

**If `mode = "new"`**: Generate complete JSON from scratch.

**If `mode = "extend"`**: Read existing JSON, add new actions, preserve existing actions.

**File**: `lib/plugins/definitions/{pluginName}-plugin-v2.json`

**Structure**:
```json
{
  "plugin": {
    "name": "{pluginName}",
    "version": "1.0.0",
    "description": "{description from research}",
    "context": "{usage context from research}",
    "icon": "<Icon className='w-5 h-5 text-{color}-600'/>",
    "category": "{category}",
    "isPopular": false,
    "auth_config": {
      "auth_type": "oauth2",
      "client_id": "${PLUGIN_NAME_CLIENT_ID}",
      "client_secret": "${PLUGIN_NAME_CLIENT_SECRET}",
      "redirect_uri": "${NEXT_PUBLIC_APP_URL}/oauth/callback/{pluginName}",
      "auth_url": "{from research}",
      "token_url": "{from research}",
      "refresh_url": "{from research}",
      "profile_url": "{from research}",
      "required_scopes": [/* from research */]
    }
  },
  "actions": {
    /* Generate each selected action with full JSON Schema */
  }
}
```

**For each action in `selectedActions`**, generate:
```json
"action_name": {
  "description": "{description}",
  "usage_context": "{when to use this action}",
  "parameters": {
    "type": "object",
    "required": [/* required params */],
    "properties": {
      /* Generate JSON Schema for each parameter */
    }
  },
  "rules": {
    "limits": {
      /* Generate validation rules based on API docs */
    },
    "confirmations": {
      /* Generate confirmation rules for destructive actions */
    }
  },
  "output_guidance": {
    "success_message": "{action completed successfully}",
    "common_errors": {
      /* Map common errors from API docs */
    }
  }
}
```

**Write the file** using the Write tool.

Log: `✅ Generated: lib/plugins/definitions/{pluginName}-plugin-v2.json`

---

### **STEP 8: Generate Plugin Executor Class**

**If `mode = "new"`**: Generate complete executor from scratch.

**If `mode = "extend"`**: Read existing executor, add new action methods, preserve existing methods.

**File**: `lib/server/{pluginName}-plugin-executor.ts`

**Template**:
```typescript
// lib/server/{pluginName}-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = '{pluginName}';

export class {PluginName}PluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = '{base_url_from_research}';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      /* Generate case for each selected action */
      case 'action_name':
        return await this.actionName(connection, parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /* Generate private method for each action */
  private async actionName(connection: any, parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Executing {actionName}');

    // Extract parameters
    const { param1, param2 } = parameters;

    // Build request
    const requestBody = {
      /* Based on API spec from research */
    };

    // Make API call
    const response = await fetch(`${this.apiBaseUrl}{endpoint}`, {
      method: '{HTTP_METHOD}',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        /* Add any plugin-specific headers */
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, '{actionName}');

    // Return formatted result
    return {
      /* Map API response to consistent format */
    };
  }

  // Optional: Override error mapping
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    /* Generate error mappings based on API docs */
    return null;
  }

  // Optional: Override connection test
  protected async performConnectionTest(connection: any): Promise<any> {
    /* Generate test API call */
    return { status: 'connected' };
  }
}
```

**Write the file** using the Write tool.

Log: `✅ Generated: lib/server/{pluginName}-plugin-executor.ts`

---

### **STEP 9: Register Plugin in Registries**

**If `mode = "new"`**: Add to both registries.

**If `mode = "extend"`**: Skip (already registered).

#### **9a. Register in Plugin Manager**

**File**: `lib/server/plugin-manager-v2.ts`

**Read the file**, then add to `corePluginFiles` array:

```typescript
const corePluginFiles = [
  'google-mail-plugin-v2.json',
  // ... existing plugins
  '{pluginName}-plugin-v2.json',
  // Add other plugin files here as you create them
];
```

**Use Edit tool** to update the file.

Log: `✅ Updated: lib/server/plugin-manager-v2.ts`

#### **9b. Register in Plugin Executor**

**File**: `lib/server/plugin-executer-v2.ts`

**Read the file**, then:

1. Add import at top:
```typescript
import { {PluginName}PluginExecutor } from './{pluginName}-plugin-executor';
```

2. Add to registry object:
```typescript
private static executorRegistry: Record<string, PluginExecutorConstructor> = {
  // ... existing plugins
  '{pluginName}': {PluginName}PluginExecutor,
};
```

**Use Edit tool** to update the file.

Log: `✅ Updated: lib/server/plugin-executer-v2.ts`

#### **9c. Add Plugin to UI Plugin List**

**File**: `lib/plugins/pluginList.tsx`

**Read the file**, then add the plugin entry to the `pluginList` array:

```typescript
{
  pluginKey: '{pluginName}',
  name: '{Plugin Display Name}',
  description: '{Short one-line description}',
  detailedDescription: '{Detailed multi-line description of capabilities}',
  icon: <{IconName} className="w-5 h-5 text-{color}-600" />,
  category: '{category}', // communication, productivity, crm, marketing, project, finance, integration, or ai
  isPopular: true, // or false
},
```

**Note**: Choose appropriate category based on plugin purpose:
- `communication`: Email, messaging, chat (Gmail, Slack, WhatsApp, LinkedIn)
- `productivity`: Documents, storage, notes (Google Drive, Sheets, Docs, Notion)
- `crm`: Customer relationship management (HubSpot, Salesforce)
- `marketing`: Advertising, campaigns (Google Ads, Meta Ads)
- `project`: Task/project management (ClickUp)
- `finance`: Billing, payments (QuickBooks, Stripe)
- `integration`: Workflow automation platforms
- `ai`: AI tools and research (ChatGPT)

**Use Edit tool** to update the file.

Log: `✅ Updated: lib/plugins/pluginList.tsx`

---

### **STEP 10: Add Parameter Templates to Test Page**

**File**: `app/test-plugins-v2/page.tsx`

**Read the file**, then add parameter templates for each action to the `PARAMETER_TEMPLATES` object:

```typescript
const PARAMETER_TEMPLATES = {
  // ... existing plugins
  "{pluginName}": {
    "{action1_name}": {
      // Sample parameters for action 1 based on action definition
      // Example: "param1": "sample_value"
    },
    "{action2_name}": {
      // Sample parameters for action 2
    },
    // ... add all selected actions
  }
};
```

**Example for LinkedIn**:
```typescript
"linkedin": {
  "get_profile": {
    "projection": "(id,firstName,lastName,profilePicture(displayImage~:playableStreams))"
  },
  "get_user_info": {},
  "create_post": {
    "text": "Excited to share my latest project! This is a test post created via the LinkedIn API. #automation #innovation",
    "visibility": "PUBLIC",
    "media_url": "https://example.com/article",
    "media_title": "Check out this article",
    "media_description": "An interesting article about API automation"
  },
  "get_posts": {
    "count": 10,
    "sort_by": "LAST_MODIFIED"
  },
  // ... other actions
}
```

**Instructions**:
- For each selected action, create realistic sample parameters
- Use the action's parameter definitions from the plugin JSON as a guide
- Include all required parameters
- Provide sensible default values for testing (e.g., IDs, text content, limits)
- Empty object `{}` for actions with no required parameters

**Use Edit tool** to update the file.

Log: `✅ Updated: app/test-plugins-v2/page.tsx`

---

### **STEP 11: Update Environment Variables Template**

**File**: `.env.example`

**Read the file**, then append:

```bash
# {PluginName} Plugin
{PLUGIN_NAME_CLIENT_ID}=your_{pluginName}_client_id_here
{PLUGIN_NAME_CLIENT_SECRET}=your_{pluginName}_client_secret_here
```

**Use Edit tool** to update the file.

**Also prompt user**:
```
📝 Environment Variables Required

Add these to your .env.local file:

{PLUGIN_NAME_CLIENT_ID}=your_client_id_here
{PLUGIN_NAME_CLIENT_SECRET}=your_client_secret_here

To get these credentials:
1. Go to: {oauth_provider_developer_portal_url}
2. Create a new OAuth application
3. Set redirect URI: {NEXT_PUBLIC_APP_URL}/oauth/callback/{pluginName}
4. Copy Client ID and Client Secret
5. Add to .env.local

⚠️ Don't forget to restart your dev server after adding!
```

Log: `✅ Updated: .env.example`

---

### **STEP 12: Validation**

Run syntax validation on generated files:

**Validate JSON**:
```bash
node -e "JSON.parse(require('fs').readFileSync('lib/plugins/definitions/{pluginName}-plugin-v2.json', 'utf8'))"
```

**Validate TypeScript** (if tsc available):
```bash
npx tsc --noEmit lib/server/{pluginName}-plugin-executor.ts
```

**Check results**:
```
🔍 Validation Results

Plugin Definition JSON: ✅ Valid | ❌ Syntax Error
Plugin Executor TypeScript: ✅ Valid | ❌ Syntax Error
Registry Update: ✅ Verified | ⚠️ Manual check needed
Test File: ✅ Generated

{If errors, display them here}
```

---

### **STEP 13: Summary & Next Steps**

Present final summary:

```
✅ Plugin Generation Complete!

Generated Files:
✅ lib/plugins/definitions/{pluginName}-plugin-v2.json
✅ lib/server/{pluginName}-plugin-executor.ts
{mode === "new" ? "✅" : "⏭️"} lib/server/plugin-executer-v2.ts (registered)
✅ app/test-plugins-v2/{pluginName}-test.ts
✅ .env.example (updated)

Plugin: {pluginName}
Actions: {selectedActions.length}
Mode: {mode === "new" ? "New Plugin" : "Extended Existing Plugin"}

📋 Next Steps:

1. ⚙️ Configure OAuth:
   - Go to {oauth_provider_url}
   - Create OAuth app
   - Add credentials to .env.local

2. 🔄 Restart dev server:
   npm run dev

3. 🧪 Test the plugin:
   node app/test-plugins-v2/{pluginName}-test.ts

4. 🎨 UI Testing:
   - Navigate to Settings → Connected Apps
   - Connect {pluginName}
   - Create an agent that uses {pluginName}

5. 📝 Documentation (optional):
   - Add plugin to README
   - Document action examples

Need help with any of these steps? Just ask!
```

---

## 🎛️ Special Handling

### **Error Cases**

**If web search fails**:
```
⚠️ Web search failed for {query}

Would you like to:
1. Retry the search
2. Manually provide the information
3. Skip this step and use placeholder values

Your choice: _______
```

**If OAuth is incompatible**:
```
⚠️ {pluginName} uses a custom OAuth flow that differs from our existing patterns.

This may require:
- Custom OAuth handler in lib/server/
- Additional OAuth callback logic
- Modified auth_config structure

Would you like to:
1. Proceed with best-effort implementation (may need manual fixes)
2. Cancel and research implementation approach first

Your choice: _______
```

### **Mode: Extend Plugin**

When extending an existing plugin:
1. Read existing JSON and TypeScript files
2. Parse existing actions
3. Show existing actions in recommendations (marked as "Already implemented")
4. Merge new actions with existing ones
5. Preserve all existing action code
6. Add new action methods to executor class
7. Maintain consistent coding style

---

## 📚 Reference Examples

Use these as templates when generating:

**OAuth Config Examples**:
- Standard OAuth2: `lib/plugins/definitions/slack-plugin-v2.json`
- Google OAuth2: `lib/plugins/definitions/google-mail-plugin-v2.json`
- HubSpot OAuth2: `lib/plugins/definitions/hubspot-plugin-v2.json`

**Executor Examples**:
- Simple REST API: `lib/server/slack-plugin-executor.ts`
- Google API: `lib/server/gmail-plugin-executor.ts`
- Complex API: `lib/server/hubspot-plugin-executor.ts`

**Base Class Reference**:
- `lib/server/base-plugin-executor.ts`

---

## 🚀 Activation Command

When the user says:
- "Generate a plugin"
- "Create a new plugin"
- "Add actions to a plugin"
- "Generate {plugin_name} plugin"

→ Start this workflow from STEP 1.

---

**End of Workflow**
