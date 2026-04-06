# Phase 0: Plugin Registry Enhancement Proposal

**Date:** 2026-02-24
**Status:** PROPOSAL - Awaiting User Approval
**Goal:** Make Phase 0 (Plugin Registry) bulletproof before moving to Phase 1 (Intent Schema)

---

## Executive Summary

**Current State:** Plugin Registry is 75% complete
- ✅ HAVE: PluginManagerV2, 11 plugin JSON schemas, type system, output schemas
- ❌ MISSING: Capability tags, idempotency flags, field-level semantic hints

**Problem:** Without capability metadata, Phase 2 (Capability Binding) cannot work deterministically. The binding layer needs to map generic intents (e.g., "search for items in storage domain") to specific plugin operations (e.g., `google-drive.search_files`) WITHOUT hardcoding plugin names.

**Solution:** Enhance all 11 plugin schemas with:
1. **Capability tags** - Generic operation categories ("search", "list", "create", "upload", "send", "read")
2. **Domain hints** - Semantic context ("email", "storage", "spreadsheet", "calendar")
3. **Idempotency flags** - Safe vs. non-idempotent operations + suggested alternatives
4. **Field semantic hints** - Output field meanings for better data flow understanding

**Outcome:** Phase 0 becomes single source of truth for:
- What capabilities exist in the system (deterministic enumeration)
- Which plugin operations provide those capabilities (deterministic binding)
- Which operations are safe to retry (idempotency guarantees)
- What data shapes operations produce (type-safe data flow)

---

## Current Plugin Schema Structure (Analysis)

### Plugin-Level Metadata
```json
{
  "plugin": {
    "name": "google-drive",
    "version": "1.0.0",
    "description": "Access, search, read, upload, and manage files and folders in Google Drive",
    "context": "Use for accessing Google Drive files, searching documents...",
    "icon": "<Calendar className='w-5 h-5 text-blue-600'/>",
    "category": "productivity",  // ← EXISTS: Good for UI grouping
    "isPopular": true,
    "auth_config": { ... }
  }
}
```

**Analysis:**
- ✅ `category` exists (productivity, communication, etc.) - Good for UI
- ❌ No `domain` field - Needed for semantic binding (email vs storage vs spreadsheet)
- ❌ No `capabilities` list - Needed for capability enumeration

### Action-Level Metadata
```json
{
  "actions": {
    "list_files": {
      "description": "List files and folders in Google Drive with optional filtering",
      "usage_context": "When user wants to browse their Drive contents...",
      "parameters": { ... },
      "rules": {
        "limits": { ... },
        "confirmations": { ... }
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "files": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string", "description": "Unique file ID" },
                "name": { "type": "string", "description": "File or folder name" }
                // ... more fields
              }
            }
          }
        }
      },
      "output_guidance": { ... }
    }
  }
}
```

**Analysis:**
- ✅ `output_schema` exists with detailed type info
- ❌ No `capabilities` array on action
- ❌ No `idempotency` metadata
- ❌ No semantic hints on output fields (which fields are IDs? which are searchable?)

### Special Case: Idempotent Operation Already Exists!
```json
{
  "get_or_create_folder": {
    "description": "Get existing folder by name or create if it doesn't exist (prevents duplicates)",
    "usage_context": "Use this instead of create_folder when you want idempotent folder creation. Perfect for recurring workflows to avoid creating duplicate folders on each run.",
    // ...
    "output_schema": {
      "properties": {
        "created": { "type": "boolean", "description": "True if folder was newly created, false if it already existed" }
      }
    }
  }
}
```

**Key Insight:** `get_or_create_folder` is ALREADY the idempotent version of `create_folder`. The plugin schemas already have idempotent alternatives, they're just not tagged as such!

---

## Capability Taxonomy Design

### Core Capabilities (Generic Operations)

Based on analysis of existing 11 plugins (gmail, drive, sheets, calendar, slack, notion, airtable, github, linear, stripe, sendgrid):

```typescript
export const CORE_CAPABILITIES = {
  // Data Retrieval
  'search': 'Find items matching criteria',
  'list': 'Enumerate items in a collection',
  'read': 'Get content/details of a specific item',
  'get': 'Retrieve metadata about a specific item',

  // Data Modification
  'create': 'Create new item',
  'update': 'Modify existing item',
  'delete': 'Remove item',
  'upload': 'Store file/content',

  // Communication
  'send': 'Send message/notification',
  'reply': 'Respond to existing message',

  // Organization
  'filter': 'Apply predicate to collection',
  'sort': 'Order items by criteria',
  'aggregate': 'Combine/summarize data',

  // Sharing & Permissions
  'share': 'Grant access to item',
  'unshare': 'Revoke access',

  // Utilities
  'convert': 'Transform format/type',
  'export': 'Extract data for external use'
} as const;
```

### Domain Taxonomy (Semantic Context)

```typescript
export const DOMAIN_TAXONOMY = {
  // Communication Domains
  'email': 'Email messaging systems',
  'chat': 'Real-time messaging platforms',
  'notification': 'Alert/notification systems',

  // Data Storage Domains
  'storage': 'File/document storage',
  'database': 'Structured data storage',
  'spreadsheet': 'Tabular data systems',

  // Productivity Domains
  'calendar': 'Scheduling/event management',
  'task': 'Work/project tracking',
  'document': 'Document editing systems',

  // Development Domains
  'code': 'Source code management',
  'issue': 'Bug/issue tracking',

  // Business Domains
  'payment': 'Financial transactions',
  'crm': 'Customer relationship management'
} as const;
```

### Idempotency Strategies

```typescript
export const IDEMPOTENCY_STRATEGIES = {
  'idempotent': 'Operation can be safely retried (GET, search, list)',
  'conditional_idempotent': 'Idempotent if specific conditions met (get_or_create)',
  'non_idempotent': 'Operation has side effects on retry (POST, create, send)',
  'destructive': 'Operation cannot be undone (delete, permanent actions)'
} as const;
```

---

## Enhanced Plugin Schema Format

### Proposed Schema Additions

#### Plugin-Level Enhancements
```json
{
  "plugin": {
    "name": "google-drive",
    "version": "1.0.0",
    "description": "...",
    "category": "productivity",

    // NEW: Add domain hints
    "domains": ["storage", "document"],

    // NEW: List all capabilities this plugin provides
    "provided_capabilities": [
      "search", "list", "read", "get",
      "create", "upload", "share", "delete"
    ]
  }
}
```

#### Action-Level Enhancements
```json
{
  "actions": {
    "list_files": {
      "description": "List files and folders in Google Drive with optional filtering",
      "usage_context": "...",

      // NEW: Capability metadata
      "capabilities": ["list", "search"],
      "domain": "storage",

      // NEW: Idempotency metadata
      "idempotency": {
        "strategy": "idempotent",
        "safe_to_retry": true,
        "has_side_effects": false
      },

      "parameters": { ... },
      "rules": { ... },
      "output_schema": {
        "type": "object",
        "properties": {
          "files": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique file ID",
                  // NEW: Semantic hints
                  "x-semantic-role": "identifier",
                  "x-searchable": false,
                  "x-unique": true
                },
                "name": {
                  "type": "string",
                  "description": "File or folder name",
                  "x-semantic-role": "display_name",
                  "x-searchable": true
                },
                "mimeType": {
                  "type": "string",
                  "description": "MIME type of the file",
                  "x-semantic-role": "type_classifier"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

#### Idempotent Operation Tagging
```json
{
  "create_folder": {
    "description": "Create a new folder in Google Drive",
    "capabilities": ["create"],
    "domain": "storage",

    // NEW: Mark as non-idempotent with recommended alternative
    "idempotency": {
      "strategy": "non_idempotent",
      "safe_to_retry": false,
      "has_side_effects": true,
      "failure_on_retry": "Creates duplicate folder on each run",
      "idempotent_alternative": "get_or_create_folder",  // ← Links to better option
      "when_to_use_alternative": "For recurring workflows or when duplicate prevention is important"
    }
  },

  "get_or_create_folder": {
    "description": "Get existing folder by name or create if it doesn't exist (prevents duplicates)",
    "capabilities": ["create", "get"],
    "domain": "storage",

    // NEW: Mark as conditionally idempotent
    "idempotency": {
      "strategy": "conditional_idempotent",
      "safe_to_retry": true,
      "has_side_effects": true,  // Creates if doesn't exist
      "idempotency_condition": "If folder with same name exists in parent, returns existing; otherwise creates new",
      "output_indicates_action": "created",  // ← Field name that shows if created or found
      "preferred_for_recurring_workflows": true
    }
  }
}
```

---

## Complete Example: google-drive.search_files (Fully Enhanced)

```json
{
  "search_files": {
    "description": "Search for files and folders using Google Drive's query syntax",
    "usage_context": "When user wants to find specific files by name, content, type, or other criteria",

    "capabilities": ["search", "filter"],
    "domain": "storage",

    "idempotency": {
      "strategy": "idempotent",
      "safe_to_retry": true,
      "has_side_effects": false,
      "note": "Read-only operation, safe for repeated calls"
    },

    "parameters": {
      "type": "object",
      "required": ["query"],
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query (supports Drive operators like 'name contains', 'mimeType =', 'fullText contains', etc.)"
        },
        "max_results": {
          "type": "number",
          "minimum": 1,
          "maximum": 100,
          "default": 20,
          "description": "Maximum number of files to return"
        },
        "search_scope": {
          "type": "string",
          "enum": ["all", "owned_by_me", "shared_with_me", "starred"],
          "default": "all",
          "description": "Scope of the search"
        },
        "file_types": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["document", "spreadsheet", "presentation", "pdf", "image", "video", "folder"]
          },
          "description": "Filter search by specific file types"
        }
      }
    },

    "rules": {
      "limits": {
        "max_results": {
          "condition": "max_results > 100",
          "action": "block",
          "message": "Cannot search for more than 100 files at once."
        }
      }
    },

    "output_schema": {
      "type": "object",
      "properties": {
        "files": {
          "type": "array",
          "description": "List of matching files and folders",
          "x-semantic-role": "result_collection",
          "x-iterable": true,
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "description": "Unique file ID",
                "x-semantic-role": "identifier",
                "x-unique": true,
                "x-required-for-operations": ["get_file_metadata", "read_file_content", "share_file"]
              },
              "name": {
                "type": "string",
                "description": "File or folder name",
                "x-semantic-role": "display_name",
                "x-searchable": true,
                "x-human-readable": true
              },
              "mimeType": {
                "type": "string",
                "description": "MIME type of the file",
                "x-semantic-role": "type_classifier",
                "x-used-for-filtering": true
              },
              "size": {
                "type": "string",
                "description": "File size in bytes",
                "x-semantic-role": "metric",
                "x-numeric": true
              },
              "modifiedTime": {
                "type": "string",
                "description": "Last modification timestamp (ISO 8601)",
                "x-semantic-role": "timestamp",
                "x-temporal": true,
                "x-used-for-sorting": true
              },
              "webViewLink": {
                "type": "string",
                "description": "URL to view the file",
                "x-semantic-role": "external_reference",
                "x-url": true,
                "x-human-actionable": true
              }
            }
          }
        },
        "file_count": {
          "type": "integer",
          "description": "Number of files found",
          "x-semantic-role": "count_metric"
        },
        "search_query": {
          "type": "string",
          "description": "The search query that was executed",
          "x-semantic-role": "operation_context"
        },
        "has_more": {
          "type": "boolean",
          "description": "Whether more results are available",
          "x-semantic-role": "pagination_indicator",
          "x-suggests-pagination": true
        }
      }
    },

    "output_guidance": {
      "success_description": "Found matching files",
      "sample_output": { ... },
      "common_errors": { ... }
    }
  }
}
```

---

## Migration Plan: Enhance All 11 Plugins

### Phase 0 Enhancement Stages

**Stage 1: Core Plugins (Critical Path) - 3 plugins**
1. `google-mail-plugin-v2.json` - Email domain
2. `google-drive-plugin-v2.json` - Storage domain
3. `google-sheets-plugin-v2.json` - Spreadsheet domain

**Stage 2: Productivity Plugins - 3 plugins**
4. `google-calendar-plugin-v2.json` - Calendar domain
5. `slack-plugin-v2.json` - Chat domain
6. `notion-plugin-v2.json` - Document/database domain

**Stage 3: Development & Business Plugins - 5 plugins**
7. `airtable-plugin-v2.json` - Database domain
8. `github-plugin-v2.json` - Code domain
9. `linear-plugin-v2.json` - Issue domain
10. `stripe-plugin-v2.json` - Payment domain
11. `sendgrid-plugin-v2.json` - Email/notification domain

### Enhancement Checklist (Per Plugin)

For EACH plugin, add:

- [ ] **Plugin-level metadata**:
  - [ ] `domains: string[]` - Semantic domains this plugin operates in
  - [ ] `provided_capabilities: string[]` - All capabilities provided

- [ ] **Action-level metadata** (for EACH action):
  - [ ] `capabilities: string[]` - What operations this action performs
  - [ ] `domain: string` - Semantic domain context
  - [ ] `idempotency` object:
    - [ ] `strategy` - idempotent | conditional_idempotent | non_idempotent | destructive
    - [ ] `safe_to_retry: boolean`
    - [ ] `has_side_effects: boolean`
    - [ ] `idempotent_alternative?: string` - Link to safer version (if exists)
    - [ ] `failure_on_retry?: string` - What goes wrong on retry (if non-idempotent)

- [ ] **Output schema enhancements** (for key fields):
  - [ ] `x-semantic-role` - identifier | display_name | type_classifier | timestamp | metric | external_reference
  - [ ] `x-unique: boolean` - Is this field unique?
  - [ ] `x-searchable: boolean` - Can this field be searched?
  - [ ] `x-iterable: boolean` - Is this an array for looping? (on parent object)
  - [ ] `x-required-for-operations: string[]` - Which operations need this field?

---

## Validation: How This Solves Phase 2 (Capability Binding)

### Before Enhancement (Current State)

**Intent from LLM:**
```json
{
  "operation": "search for PDF files in storage",
  "domain": "storage",
  "capability": "search"
}
```

**Capability Binding Problem:**
- ❌ No way to know which plugins provide "search" capability
- ❌ No way to filter by "storage" domain
- ❌ Must hardcode: "if domain=storage, use google-drive.search_files"
- ❌ Violates "No Hardcoding" principle from CLAUDE.md

### After Enhancement (Bulletproof Phase 0)

**Query Plugin Registry:**
```typescript
pluginManager.getOperationsByCapability('search', { domain: 'storage' })
```

**Deterministic Result:**
```json
[
  {
    "plugin_key": "google-drive",
    "action": "search_files",
    "capabilities": ["search", "filter"],
    "domain": "storage",
    "match_score": 1.0
  },
  {
    "plugin_key": "google-drive",
    "action": "list_files",
    "capabilities": ["list", "search"],  // ← Also has search
    "domain": "storage",
    "match_score": 0.8  // ← Lower score (list is primary)
  }
]
```

**Binding Decision:**
- ✅ Use `google-drive.search_files` (highest match score)
- ✅ No hardcoding - data-driven selection
- ✅ Extensible - add new storage plugins, binding still works

---

## Implementation Tasks

### Task 1: Create Enhanced Type Definitions (30 min)

**File:** `/lib/agentkit/v6/plugin-registry/capability-types.ts`

```typescript
export const CORE_CAPABILITIES = { ... } as const;
export const DOMAIN_TAXONOMY = { ... } as const;
export const IDEMPOTENCY_STRATEGIES = { ... } as const;

export type Capability = keyof typeof CORE_CAPABILITIES;
export type Domain = keyof typeof DOMAIN_TAXONOMY;
export type IdempotencyStrategy = keyof typeof IDEMPOTENCY_STRATEGIES;

export interface IdempotencyMetadata {
  strategy: IdempotencyStrategy;
  safe_to_retry: boolean;
  has_side_effects: boolean;
  idempotent_alternative?: string;
  failure_on_retry?: string;
  idempotency_condition?: string;
  output_indicates_action?: string;
  preferred_for_recurring_workflows?: boolean;
}

export interface ActionCapabilityMetadata {
  capabilities: Capability[];
  domain: Domain;
  idempotency: IdempotencyMetadata;
}

export interface SemanticFieldHints {
  'x-semantic-role'?: 'identifier' | 'display_name' | 'type_classifier' | 'timestamp' | 'metric' | 'external_reference' | 'operation_context' | 'result_collection' | 'count_metric' | 'pagination_indicator';
  'x-unique'?: boolean;
  'x-searchable'?: boolean;
  'x-iterable'?: boolean;
  'x-required-for-operations'?: string[];
  'x-human-readable'?: boolean;
  'x-human-actionable'?: boolean;
  'x-numeric'?: boolean;
  'x-temporal'?: boolean;
  'x-url'?: boolean;
  'x-used-for-filtering'?: boolean;
  'x-used-for-sorting'?: boolean;
  'x-suggests-pagination'?: boolean;
}
```

### Task 2: Enhance PluginManagerV2 with Capability Queries (1 hour)

**File:** `/lib/server/plugin-manager-v2.ts`

Add methods:
```typescript
class PluginManagerV2 {
  // Existing methods...

  /**
   * Get all operations that provide a specific capability
   */
  getOperationsByCapability(
    capability: Capability,
    filters?: { domain?: Domain }
  ): Array<{
    plugin_key: string;
    action: string;
    capabilities: Capability[];
    domain: Domain;
    match_score: number;
  }> {
    // Scan all plugins, filter by capability + domain
    // Return sorted by match_score (primary capability = 1.0, secondary = 0.8)
  }

  /**
   * Get idempotent alternative for an operation
   */
  getIdempotentAlternative(plugin_key: string, action: string): string | null {
    const actionDef = this.getActionDefinition(plugin_key, action);
    return actionDef?.idempotency?.idempotent_alternative || null;
  }

  /**
   * Check if operation is safe to retry
   */
  isSafeToRetry(plugin_key: string, action: string): boolean {
    const actionDef = this.getActionDefinition(plugin_key, action);
    return actionDef?.idempotency?.safe_to_retry ?? false;
  }

  /**
   * Get all domains provided by the plugin registry
   */
  getAllDomains(): Domain[] {
    const domains = new Set<Domain>();
    for (const plugin of this.plugins.values()) {
      if (plugin.plugin.domains) {
        plugin.plugin.domains.forEach(d => domains.add(d));
      }
    }
    return Array.from(domains);
  }

  /**
   * Get all capabilities provided by the plugin registry
   */
  getAllCapabilities(): Capability[] {
    const capabilities = new Set<Capability>();
    for (const plugin of this.plugins.values()) {
      if (plugin.plugin.provided_capabilities) {
        plugin.plugin.provided_capabilities.forEach(c => capabilities.add(c));
      }
    }
    return Array.from(capabilities);
  }
}
```

### Task 3: Enhance Stage 1 Plugins (4-6 hours)

Enhance 3 core plugins:
1. **google-drive-plugin-v2.json**
   - Add domains: ["storage", "document"]
   - Add capabilities to all 9 actions
   - Add idempotency metadata (mark create_folder vs get_or_create_folder)
   - Add semantic hints to output schemas

2. **google-mail-plugin-v2.json**
   - Add domains: ["email", "communication"]
   - Add capabilities (send, search, read)
   - Add idempotency (send_email = non_idempotent, search = idempotent)
   - Add semantic hints (message_id = identifier, subject = display_name)

3. **google-sheets-plugin-v2.json**
   - Add domains: ["spreadsheet", "database"]
   - Add capabilities (read, write, update, append)
   - Add idempotency metadata
   - Add semantic hints

### Task 4: Validate Enhancement with Test Cases (2 hours)

**Test Case 1: Capability Binding**
```typescript
// Query: "search for items in storage domain"
const operations = pluginManager.getOperationsByCapability('search', { domain: 'storage' });
expect(operations[0].plugin_key).toBe('google-drive');
expect(operations[0].action).toBe('search_files');
```

**Test Case 2: Idempotent Alternative Lookup**
```typescript
const alternative = pluginManager.getIdempotentAlternative('google-drive', 'create_folder');
expect(alternative).toBe('get_or_create_folder');
```

**Test Case 3: Retry Safety Check**
```typescript
expect(pluginManager.isSafeToRetry('google-mail', 'send_email')).toBe(false);
expect(pluginManager.isSafeToRetry('google-drive', 'search_files')).toBe(true);
```

### Task 5: Document Phase 0 Completion Criteria (30 min)

**File:** `/PHASE-0-COMPLETION-CHECKLIST.md`

Phase 0 is complete when:
- [ ] All 11 plugins have capability metadata
- [ ] PluginManagerV2 exposes capability query methods
- [ ] Test suite passes (capability binding, idempotency lookup, retry safety)
- [ ] Documentation updated (capability taxonomy, domain list)
- [ ] No hardcoded plugin names in Phase 1/2 code

---

## Success Metrics

**Quantitative:**
- ✅ 100% of actions have capability tags
- ✅ 100% of actions have idempotency metadata
- ✅ 100% coverage: capability query tests pass
- ✅ 0 hardcoded plugin names in binding logic

**Qualitative:**
- ✅ Plugin Registry is single source of truth for capabilities
- ✅ Capability binding is deterministic (no LLM guessing)
- ✅ Idempotency guarantees prevent duplicate operations
- ✅ Phase 0 is bulletproof and ready for Phase 1

---

## Timeline Estimate

**Total: 8-12 hours (1.5-2 working days)**

- Task 1: Type definitions - 30 min
- Task 2: PluginManagerV2 enhancements - 1 hour
- Task 3: Enhance Stage 1 plugins (3 plugins) - 4-6 hours
- Task 4: Test validation - 2 hours
- Task 5: Documentation - 30 min

**Remaining Stages (Stage 2+3):** 8 plugins × 1.5 hours = 12 hours (handled separately after Stage 1 validation)

---

## Approval Request

**Question for User:**

This proposal enhances the Plugin Registry to be the single source of truth for:
1. Capabilities (what operations exist)
2. Domains (semantic context)
3. Idempotency (safety guarantees)
4. Field semantics (data flow understanding)

**Does this approach align with your vision for Phase 0?**

Specifically:
- Is the capability taxonomy complete? Missing any key operations?
- Is the domain taxonomy correct? Should we add/remove domains?
- Should we proceed with Stage 1 (3 core plugins) first, or enhance all 11 at once?
- Any other metadata you want in Phase 0 before moving to Phase 1?

**Once approved, I will:**
1. Implement Task 1-2 (types + PluginManagerV2 methods)
2. Enhance the 3 Stage 1 plugins
3. Validate with test cases
4. Await your review before proceeding to Stage 2+3

---

**END OF PROPOSAL**
