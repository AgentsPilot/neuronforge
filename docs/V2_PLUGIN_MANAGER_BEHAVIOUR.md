# V2 Plugin Manager Behaviour

This document explains the Plugin Manager V2 architecture, its singleton pattern, the UserPluginConnections class, and how to define plugin JSON files for LLM agents.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [PluginManagerV2 Class](#pluginmanagerv2-class)
3. [UserPluginConnections Class](#userpluginconnections-class)
4. [Plugin Definition JSON Schema](#plugin-definition-json-schema)
5. [Usage Examples](#usage-examples)
6. [Best Practices](#best-practices)

---

## Architecture Overview

The V2 Plugin system consists of three main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Routes / Agents                       │
│                    (Consumers of Plugin System)                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PluginManagerV2                             │
│  - Singleton (cached in globalThis)                             │
│  - Loads plugin definitions from JSON files                     │
│  - Validates actions and parameters                             │
│  - Generates LLM context                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UserPluginConnections                         │
│  - Singleton (cached in globalThis)                             │
│  - Manages OAuth connections in Supabase                        │
│  - Handles token refresh                                        │
│  - Tracks connection status                                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Plugin Definition JSON Files                  │
│  - Located in: lib/plugins/definitions/                         │
│  - Define plugin metadata, auth, actions, rules                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## PluginManagerV2 Class

**Location:** `lib/server/plugin-manager-v2.ts`

### Singleton Pattern

The PluginManagerV2 uses a **globalThis-cached singleton** pattern to ensure:
- Single instance across all API routes and serverless functions
- Survives Next.js hot reloads in development mode
- Prevents race conditions during initialization

```typescript
// Uses globalThis to persist across module reloads
const globalForPluginManager = globalThis as unknown as {
  pluginManagerInstance: PluginManagerV2 | null;
  pluginManagerInitPromise: Promise<PluginManagerV2> | null;
};

// Always use getInstance() - NEVER instantiate directly
const pluginManager = await PluginManagerV2.getInstance();
```

### Key Methods

#### Getting the Instance
```typescript
// Always use this - it handles caching and initialization
const pluginManager = await PluginManagerV2.getInstance();
```

#### Getting Connected Plugins (Fast - No Token Refresh)
Use for UI display, status checks, listing connected services:
```typescript
const connectedPlugins = await pluginManager.getConnectedPlugins(userId);
// Returns: Record<string, ActionablePlugin>
```

#### Getting Executable Plugins (Slow - With Token Refresh)
Use before actual plugin execution to ensure valid tokens:
```typescript
const executablePlugins = await pluginManager.getExecutablePlugins(userId);
// Returns: Record<string, ActionablePlugin> (only plugins with valid tokens)
```

#### Getting Disconnected Plugins
```typescript
const disconnectedPlugins = await pluginManager.getDisconnectedPlugins(userId);
// Returns plugins available but not connected by the user
```

#### Getting Plugin Definitions
```typescript
const pluginDef = pluginManager.getPluginDefinition('google-mail');
const actionDef = pluginManager.getActionDefinition('google-mail', 'send_email');
```

#### Validating Action Parameters
```typescript
const validation = pluginManager.validateActionParameters(
  'google-mail',
  'send_email',
  { recipients: { to: ['user@example.com'] }, content: { subject: 'Hello' } }
);
// Returns: { valid: boolean, errors: string[], confirmations_required: string[], blocked: boolean }
```

#### Generating LLM Context
```typescript
// Full context with connected and available plugins
const llmContext = await pluginManager.generateLLMContext(userId);

// Skinny context for specific plugins only
const skinnyContext = await pluginManager.generateSkinnyLLMContextByPluginName(
  userId,
  ['google-mail', 'slack'],
  true,  // includeRules
  true   // includeOutputGuidance
);
```

### Plugin Types

1. **OAuth Plugins** - Require user authentication (Gmail, Slack, HubSpot, etc.)
2. **System Plugins** - No OAuth required, available to all users (ChatGPT Research)

System plugins are identified by `isSystem: true` in the plugin definition.

---

## UserPluginConnections Class

**Location:** `lib/server/user-plugin-connections.ts`

Manages the database layer for plugin connections stored in Supabase.

### Singleton Pattern

Like `PluginManagerV2`, this class uses `globalThis` to persist across Next.js hot reloads:

```typescript
// Uses globalThis to persist across module reloads
const globalForUserConnections = globalThis as unknown as {
  userConnectionsInstance: UserPluginConnections | null;
};

// Always use getInstance() - NEVER instantiate directly
const userConnections = UserPluginConnections.getInstance();
```

### Key Methods

#### Getting Connections
```typescript
// All active plugins (including expired tokens)
const allActive = await userConnections.getAllActivePlugins(userId);

// Only valid connections (expired filtered out)
const validConnections = await userConnections.getConnectedPlugins(userId);

// Connection status for specific plugin
const status = await userConnections.getConnectionStatus(userId, 'google-mail');
```

#### Token Management
```typescript
// Check if token is valid
const isValid = userConnections.isTokenValid(connection.expires_at);

// Check if token should be refreshed (proactive refresh)
const shouldRefresh = userConnections.shouldRefreshToken(connection.expires_at, 5); // 5 min buffer

// Refresh a token
const refreshedConnection = await userConnections.refreshToken(connection, authConfig);
```

#### OAuth Flow
```typescript
// Handle OAuth callback
const connection = await userConnections.handleOAuthCallback(code, state, authConfig, request);

// Disconnect plugin
const success = await userConnections.disconnectPlugin(userId, pluginKey, request);
```

### Database Schema
Connections are stored in the `plugin_connections` table:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Foreign key to users |
| plugin_key | string | Plugin identifier (e.g., 'google-mail') |
| plugin_name | string | Display name |
| access_token | string | OAuth access token |
| refresh_token | string | OAuth refresh token |
| expires_at | timestamp | Token expiration |
| scope | string | OAuth scopes granted |
| status | string | 'active', 'disconnected', 'expired' |
| profile_data | jsonb | User profile from OAuth provider |

---

## Plugin Definition JSON Schema

**Location:** `lib/plugins/definitions/<plugin-name>-plugin-v2.json`

### Complete Schema

```json
{
  "plugin": {
    "name": "plugin-key",
    "version": "1.0.0",
    "description": "Human-readable description for LLMs",
    "context": "When to use this plugin - guidance for LLM decision making",
    "icon": "<IconComponent />",
    "category": "communication|productivity|ai_research|...",
    "label": "Display Name",
    "displayName": "Display Name",
    "isPopular": true,
    "isSystem": false,
    "auth_config": {
      "auth_type": "oauth2_google|oauth2_microsoft|oauth2|platform_key",
      "client_id": "${ENV_VAR_NAME}",
      "client_secret": "${ENV_VAR_SECRET}",
      "redirect_uri": "${NEXT_PUBLIC_APP_URL}/oauth/callback/plugin-key",
      "auth_url": "https://provider.com/oauth/authorize",
      "token_url": "https://provider.com/oauth/token",
      "refresh_url": "https://provider.com/oauth/token",
      "profile_url": "https://api.provider.com/userinfo",
      "requires_pkce": false,
      "required_scopes": ["scope1", "scope2"]
    }
  },
  "actions": {
    "action_name": {
      "description": "What this action does",
      "usage_context": "When LLM should use this action",
      "parameters": {
        "type": "object",
        "required": ["param1"],
        "properties": {
          "param1": {
            "type": "string",
            "description": "Parameter description"
          }
        }
      },
      "rules": {
        "limits": {
          "rule_name": {
            "condition": "expression > value",
            "action": "block",
            "message": "Error message to show"
          }
        },
        "confirmations": {
          "rule_name": {
            "condition": "expression == value",
            "action": "confirm",
            "message": "Confirmation message with {variables}"
          }
        }
      },
      "output_guidance": {
        "success_message": "Action completed with {variable}",
        "common_errors": {
          "error_key": "Human-readable error explanation and resolution"
        }
      }
    }
  }
}
```

### Environment Variable Substitution

Plugin definitions support environment variable substitution using `${VAR_NAME}` syntax:

```json
{
  "client_id": "${GOOGLE_CLIENT_ID}",
  "client_secret": "${GOOGLE_CLIENT_SECRET}",
  "redirect_uri": "${NEXT_PUBLIC_APP_URL}/oauth/callback/google-mail"
}
```

### OAuth Plugin Example (Google Mail)

```json
{
  "plugin": {
    "name": "google-mail",
    "version": "1.0.0",
    "description": "Send, read, and manage Gmail emails",
    "context": "Use for all Gmail email-related tasks",
    "category": "communication",
    "isPopular": true,
    "auth_config": {
      "auth_type": "oauth2_google",
      "client_id": "${GOOGLE_CLIENT_ID}",
      "client_secret": "${GOOGLE_CLIENT_SECRET}",
      "redirect_uri": "${NEXT_PUBLIC_APP_URL}/oauth/callback/google-mail",
      "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
      "token_url": "https://oauth2.googleapis.com/token",
      "refresh_url": "https://oauth2.googleapis.com/token",
      "profile_url": "https://www.googleapis.com/oauth2/v2/userinfo",
      "required_scopes": [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send"
      ]
    }
  },
  "actions": {
    "send_email": {
      "description": "Compose and send an email message",
      "usage_context": "When user wants to send a new message via Gmail",
      "parameters": {
        "type": "object",
        "required": ["recipients", "content"],
        "properties": {
          "recipients": {
            "type": "object",
            "required": ["to"],
            "properties": {
              "to": {
                "type": "array",
                "items": { "type": "string", "format": "email" },
                "description": "Primary recipients"
              }
            }
          },
          "content": {
            "type": "object",
            "required": ["subject"],
            "properties": {
              "subject": { "type": "string", "maxLength": 200 },
              "body": { "type": "string" }
            }
          }
        }
      },
      "rules": {
        "limits": {
          "max_recipients": {
            "condition": "total_recipients > 50",
            "action": "block",
            "message": "Cannot send to more than 50 recipients"
          }
        },
        "confirmations": {
          "large_group": {
            "condition": "total_recipients > 10",
            "action": "confirm",
            "message": "Send email to {total_recipients} recipients?"
          }
        }
      },
      "output_guidance": {
        "success_message": "Email sent to {recipient_count} recipients",
        "common_errors": {
          "auth_failed": "Gmail connection expired. Reconnect in Settings.",
          "quota_exceeded": "Daily sending limit reached."
        }
      }
    }
  }
}
```

### System Plugin Example (No OAuth)

```json
{
  "plugin": {
    "name": "chatgpt-research",
    "version": "1.0.0",
    "description": "AI-powered web research using ChatGPT",
    "context": "Use for researching topics with web search",
    "category": "ai_research",
    "isSystem": true,
    "auth_config": {
      "auth_type": "platform_key",
      "client_id": "platform",
      "client_secret": "platform",
      "redirect_uri": "",
      "auth_url": "",
      "token_url": "",
      "refresh_url": "",
      "profile_url": "",
      "required_scopes": []
    }
  },
  "actions": {
    "research_topic": {
      "description": "Research a topic using web search and AI",
      "usage_context": "When user wants comprehensive research",
      "parameters": {
        "type": "object",
        "required": ["topic"],
        "properties": {
          "topic": {
            "type": "string",
            "minLength": 3,
            "maxLength": 500
          },
          "depth": {
            "type": "string",
            "enum": ["quick", "standard", "comprehensive"],
            "default": "standard"
          }
        }
      },
      "rules": {},
      "output_guidance": {
        "success_message": "Research completed with {source_count} sources",
        "common_errors": {
          "api_error": "Web search failed. Try again."
        }
      }
    }
  }
}
```

---

## Usage Examples

### In an API Route

```typescript
// app/api/agent/route.ts
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

export async function POST(request: Request) {
  const { userId, action, pluginKey, params } = await request.json();

  // Get singleton instance (cached across requests)
  const pluginManager = await PluginManagerV2.getInstance();

  // Get executable plugins (ensures valid tokens)
  const executablePlugins = await pluginManager.getExecutablePlugins(userId);

  // Check if plugin is available
  if (!executablePlugins[pluginKey]) {
    return Response.json({ error: 'Plugin not connected or token expired' }, { status: 401 });
  }

  // Validate parameters before execution
  const validation = pluginManager.validateActionParameters(pluginKey, action, params);
  if (!validation.valid) {
    return Response.json({ errors: validation.errors }, { status: 400 });
  }

  // Execute action...
}
```

### Generating Context for LLM

```typescript
const pluginManager = await PluginManagerV2.getInstance();

// For agent prompts - include all connected plugins
const context = await pluginManager.generateLLMContext(userId);

// For focused prompts - only specific plugins
const focusedContext = await pluginManager.generateSkinnyLLMContextByPluginName(
  userId,
  ['google-mail', 'google-calendar'],
  true,  // include rules
  true   // include output guidance
);

// Use in system prompt
const systemPrompt = `
You have access to the following plugins:
${JSON.stringify(context.connected_plugins, null, 2)}

Plugins available but not connected:
${JSON.stringify(context.available_plugins, null, 2)}
`;
```

---

## Best Practices

### 1. Always Use getInstance()
Never instantiate PluginManagerV2 directly. Always use the async singleton factory:
```typescript
// Good
const pm = await PluginManagerV2.getInstance();

// Bad - don't do this
const pm = new PluginManagerV2(userConnections);
```

### 2. Choose the Right Method for the Use Case

| Use Case | Method |
|----------|--------|
| Display connected plugins in UI | `getConnectedPlugins()` |
| Before executing a plugin action | `getExecutablePlugins()` |
| Show available plugins to connect | `getDisconnectedPlugins()` |
| Get all active (including expired) | `getAllActivePluginKeys()` |

### 3. Handle Token Expiration Gracefully
```typescript
try {
  const result = await executePluginAction(plugin, action, params);
} catch (error) {
  if (error.code === 'TOKEN_EXPIRED') {
    // Token refresh failed - redirect user to reconnect
    return { error: 'Please reconnect your plugin in Settings' };
  }
}
```

### 4. Plugin Definition Best Practices

- **Description**: Write for LLMs - clear, concise, action-oriented
- **Context**: Explain WHEN to use this plugin, not just what it does
- **Rules**: Define sensible limits to prevent abuse
- **Output Guidance**: Provide human-readable error messages

### 5. Adding a New Plugin

1. Create JSON definition in `lib/plugins/definitions/<name>-plugin-v2.json`
2. Add filename to `corePluginFiles` array in `plugin-manager-v2.ts`
3. Create executor in `lib/plugins/executors/<name>-plugin-executor.ts`
4. Add OAuth callback route if needed: `app/oauth/callback/<name>/route.ts`
5. Add required environment variables

---

## File Locations

| Component | Location |
|-----------|----------|
| PluginManagerV2 | `lib/server/plugin-manager-v2.ts` |
| UserPluginConnections | `lib/server/user-plugin-connections.ts` |
| Plugin Definitions | `lib/plugins/definitions/*.json` |
| Plugin Executors | `lib/plugins/executors/*.ts` |
| Plugin Types | `lib/types/plugin-types.ts` |
| OAuth Callbacks | `app/oauth/callback/*/route.ts` |
