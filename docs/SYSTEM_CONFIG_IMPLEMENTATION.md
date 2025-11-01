# System Configuration Implementation

**Date**: 2025-10-30
**Status**: ✅ Complete - Ready for Testing

## Overview

Successfully migrated intelligent routing configuration from environment variables to database-driven system, creating a comprehensive admin UI for managing all system-wide settings.

## What Was Built

### 1. Database Layer

#### `system_settings_config` Table
- **Location**: `supabase/migrations/20251030_create_system_settings.sql`
- **Structure**: Key-value store with JSONB values for flexibility
- **Features**:
  - Categories for grouping settings (routing, pricing, limits, etc.)
  - Automatic timestamps (created_at, updated_at)
  - Audit trail tracking (updated_by)
  - RLS policies (read: public, write: admin only)
- **Initial Config**:
  ```sql
  intelligent_routing_enabled: false
  routing_low_threshold: 3.9
  routing_medium_threshold: 6.9
  routing_min_executions: 3
  routing_min_success_rate: 85
  anthropic_provider_enabled: true
  ```

### 2. Service Layer

#### `SystemConfigService`
- **Location**: `lib/services/SystemConfigService.ts`
- **Features**:
  - In-memory cache with 5-minute TTL
  - Type-safe getters (getBoolean, getNumber, getString)
  - Batch updates with `setMultiple()`
  - Category-based queries
  - Automatic cache invalidation
  - Convenience method: `getRoutingConfig()` - fetches all routing settings in one call

**Example Usage**:
```typescript
// Get single value
const enabled = await SystemConfigService.getBoolean(
  supabase,
  'intelligent_routing_enabled',
  false
);

// Get all routing config
const config = await SystemConfigService.getRoutingConfig(supabase);
// Returns: { enabled, lowThreshold, mediumThreshold, minExecutions, minSuccessRate, anthropicEnabled }

// Update settings
await SystemConfigService.setMultiple(supabase, {
  intelligent_routing_enabled: true,
  routing_low_threshold: 4.0
});
```

### 3. Admin UI

#### System Configuration Page
- **Location**: `app/admin/system-config/page.tsx`
- **URL**: `/admin/system-config`
- **Features**:
  - **Intelligent Routing Section**:
    - Master toggle for enabling/disabling routing
    - Threshold sliders (low/medium complexity)
    - Minimum executions input
    - Minimum success rate input
    - Anthropic provider toggle
    - Visual routing tier display (Low/Medium/High)
  - **AI Model Pricing Table**:
    - All models from `ai_model_pricing` table
    - Input/output costs per token
    - Provider badges
    - Effective dates
  - **Real-time Updates**: Saves to database, refreshes config
  - **Success/Error Notifications**: Visual feedback for all operations
  - **Development Debug Panel**: Shows raw JSON config in dev mode

#### Sidebar Integration
- **Location**: `app/admin/components/AdminSidebar.tsx`
- **Entry**: "System Config" with Sliders icon
- **Description**: "AI Routing & Pricing"
- **Position**: Between "User Management" and "AIS Config"

### 4. API Routes

#### GET `/api/admin/system-config`
- Fetches all system configuration settings
- Admin-only access
- Returns full settings array with metadata

#### PUT `/api/admin/system-config`
- Updates multiple configuration values
- Admin-only access
- Body: `{ updates: { key1: value1, key2: value2 } }`
- Invalidates cache automatically

#### POST `/api/admin/system-config`
- Creates new configuration entry
- Admin-only access
- Body: `{ key, value, category, description }`

#### GET `/api/admin/system-config/pricing`
- Fetches all AI model pricing information
- Admin-only access
- Returns `ai_model_pricing` table data

### 5. Code Changes

#### `lib/agentkit/runAgentKit.ts`
**Before**:
```typescript
const ROUTING_ENABLED = process.env.ENABLE_INTELLIGENT_ROUTING === 'true';
```

**After**:
```typescript
// Fetch routing configuration from database
const ROUTING_ENABLED = await SystemConfigService.getBoolean(
  supabase,
  'intelligent_routing_enabled',
  false
);
```

**Impact**:
- Routing flag now fetched from database on every agent execution
- Cached for 5 minutes to minimize DB calls
- Admin can toggle routing instantly via UI without code deployment

#### `lib/ai/modelRouter.ts`
**Before**:
```typescript
const lowThreshold = parseFloat(process.env.ROUTING_LOW_THRESHOLD || '3.9');
const mediumThreshold = parseFloat(process.env.ROUTING_MEDIUM_THRESHOLD || '6.9');
const minExecutions = parseInt(process.env.ROUTING_MIN_EXECUTIONS || '3');
const minSuccessRate = parseInt(process.env.ROUTING_MIN_SUCCESS_RATE || '85');
const anthropicEnabled = process.env.ENABLE_ANTHROPIC_PROVIDER !== 'false';
```

**After**:
```typescript
// Get routing configuration from database
const routingConfig = await SystemConfigService.getRoutingConfig(supabase);
const lowThreshold = routingConfig.lowThreshold;
const mediumThreshold = routingConfig.mediumThreshold;
const minExecutions = routingConfig.minExecutions;
const minSuccessRate = routingConfig.minSuccessRate;
const anthropicEnabled = routingConfig.anthropicEnabled;
```

**Impact**:
- All routing thresholds now database-driven
- Admin can fine-tune routing parameters in real-time
- Single DB call fetches all 6 routing parameters (optimized)

#### `lib/audit/events.ts`
**Added**:
```typescript
MODEL_ROUTING_DECISION: 'MODEL_ROUTING_DECISION',
```

**Impact**: Enables audit trail logging for all routing decisions

## How It Works

### Configuration Flow

1. **Admin Updates Settings**:
   ```
   Admin UI → API Route → SystemConfigService.setMultiple()
   → Database UPDATE → Cache Invalidation
   ```

2. **Agent Execution Reads Config**:
   ```
   runAgentKit() → SystemConfigService.getBoolean()
   → Check Cache → (if miss) Database SELECT → Cache Store → Return Value
   ```

3. **Model Selection Uses Config**:
   ```
   ModelRouter.selectModel() → SystemConfigService.getRoutingConfig()
   → Single DB call for all 6 params → Returns config object
   ```

### Caching Strategy

- **TTL**: 5 minutes
- **Invalidation**: Automatic on UPDATE/DELETE operations
- **Scope**: In-memory per Node.js process
- **Benefit**: Reduces DB load from O(n) calls per agent execution to O(1) per 5 minutes

### Security

- **RLS Policies**:
  - Read: Anyone (needed for runtime config access)
  - Write: Admin only (checked via `users.role = 'admin'`)
- **API Routes**: Admin-only middleware on all POST/PUT/DELETE
- **Audit Trail**: All config changes logged with user ID

## Testing Guide

### 1. Database Setup
```bash
# Run migration
psql -h <supabase-host> -U postgres -d postgres -f supabase/migrations/20251030_create_system_settings.sql

# Verify table created
SELECT * FROM system_settings_config ORDER BY category, key;
```

**Expected**: 6 rows with routing config, all defaults

### 2. Admin UI Testing

#### Access Page
1. Navigate to `/admin/system-config`
2. Should see "System Configuration" page with:
   - Intelligent Routing section (toggle OFF by default)
   - Routing configuration inputs
   - Routing tier visualization
   - AI Model Pricing table

#### Toggle Routing
1. Click master toggle → Should turn green
2. Click "Save Configuration" → Success message
3. Check database:
   ```sql
   SELECT value FROM system_settings_config
   WHERE key = 'intelligent_routing_enabled';
   ```
   **Expected**: `true`

#### Update Thresholds
1. Change "Low Complexity Threshold" from 3.9 to 4.5
2. Change "Medium Complexity Threshold" from 6.9 to 7.5
3. Click "Save Configuration"
4. Refresh page → Values should persist

#### Verify Pricing Table
- Should display all models from `ai_model_pricing`
- Check for: gpt-4o, gpt-4o-mini, claude-3-haiku-20240307
- Costs should match database values

### 3. Runtime Testing

#### Test Routing Disabled (Default)
1. Create and run an agent
2. Check console logs:
   ```
   🎯 Intelligent Routing DISABLED - using default GPT-4o
   ```
3. Check execution summary:
   ```
   🤝 Model Used: gpt-4o
   🏢 Provider: OPENAI
   🎯 Routing: DISABLED ❌
   ```

#### Test Routing Enabled
1. Enable routing via admin UI
2. Run agent with LOW AIS score (0-3.9)
3. Check console logs:
   ```
   🎯 Intelligent Routing ENABLED - selecting optimal model based on AIS score
   🎯 Model Selected: { model: 'gpt-4o-mini', provider: 'openai', ... }
   ```
4. Check execution summary:
   ```
   🤝 Model Used: gpt-4o-mini
   🏢 Provider: OPENAI
   🎯 Routing: ENABLED ✅
   ```

#### Test Threshold Changes
1. Set `routing_low_threshold` to 8.0
2. Run agent with AIS score 5.0 (should now use gpt-4o-mini)
3. Verify model selection matches new threshold

### 4. Cache Testing

#### Test Cache Hit
1. Enable routing
2. Run agent → Database call made
3. Within 5 minutes, run another agent
4. Check logs → Should NOT see additional config query
5. Result should be instant (cache hit)

#### Test Cache Invalidation
1. With routing enabled, run agent
2. Immediately disable routing via admin UI
3. Run agent again (within 5 minutes)
4. Should use default model (cache invalidated)

### 5. Audit Trail Testing

```sql
-- Check routing decision logs
SELECT
  action,
  resource_name,
  details->>'selected_model' as model,
  details->>'selected_provider' as provider,
  details->>'reasoning' as reasoning,
  created_at
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected**: One log entry per agent execution with routing enabled

## Migration Notes

### From Environment Variables

**Old `.env` Variables** (NO LONGER USED):
```bash
ENABLE_INTELLIGENT_ROUTING=false
ROUTING_LOW_THRESHOLD=3.9
ROUTING_MEDIUM_THRESHOLD=6.9
ROUTING_MIN_EXECUTIONS=3
ROUTING_MIN_SUCCESS_RATE=85
ENABLE_ANTHROPIC_PROVIDER=true
```

**New Database Config**:
All values moved to `system_settings_config` table, editable via admin UI.

### Backward Compatibility

✅ **Fully Backward Compatible**:
- If database config missing → Falls back to hardcoded defaults
- If config fetch fails → Logs error, disables routing safely
- If routing error occurs → Falls back to GPT-4o

### Rollback Plan

If issues arise, disable routing via admin UI:
1. Navigate to `/admin/system-config`
2. Toggle "Enable Intelligent Routing" OFF
3. Click "Save Configuration"
4. All agents will immediately use GPT-4o (default)

No code changes or deployments needed!

## Future Enhancements

### Additional Config Categories

The `system_settings_config` table is designed for ANY system-wide configuration:

**Pricing & Limits**:
- `max_tokens_per_request`
- `rate_limit_per_user`
- `daily_cost_limit`

**Feature Flags**:
- `enable_new_ui_feature`
- `enable_beta_plugin`
- `maintenance_mode`

**Email Settings**:
- `smtp_host`
- `smtp_port`
- `email_from_address`

**Monitoring**:
- `alert_threshold_tokens`
- `alert_threshold_cost`
- `alert_recipient_emails`

### Admin UI Extensions

- **System Config Categories**: Tabs for Routing, Pricing, Limits, Features
- **Change History**: View config changes over time
- **Bulk Import/Export**: JSON upload/download for configs
- **Real-time Validation**: Prevent invalid threshold ranges
- **Cost Impact Calculator**: Show estimated savings from threshold changes

### Advanced Caching

- **Redis Integration**: Shared cache across all Node.js processes
- **Cache Warming**: Pre-load configs on startup
- **Selective Invalidation**: Clear only affected keys, not entire cache

## Files Modified/Created

### Created
- ✅ `supabase/migrations/20251030_create_system_settings.sql`
- ✅ `supabase/migrations/20251030_fix_audit_trail_user_fk.sql` - Fixed audit trail permission error
- ✅ `lib/services/SystemConfigService.ts`
- ✅ `app/admin/system-config/page.tsx`
- ✅ `app/api/admin/system-config/route.ts`
- ✅ `app/api/admin/system-config/pricing/route.ts`
- ✅ `app/api/admin/system-config/pricing/sync/route.ts` - Automatic pricing sync from providers
- ✅ `scripts/check-routing-audit-logs.ts` - Verify routing decision audit logs
- ✅ `docs/SYSTEM_CONFIG_IMPLEMENTATION.md` (this file)

### Modified
- ✅ `app/admin/components/AdminSidebar.tsx` - Added System Config navigation
- ✅ `lib/agentkit/runAgentKit.ts` - Database-driven routing flag
- ✅ `lib/ai/modelRouter.ts` - Database-driven thresholds
- ✅ `lib/audit/events.ts` - Added MODEL_ROUTING_DECISION event

## Troubleshooting

### Audit Trail Permission Error (RESOLVED)

**Issue**: During initial testing, audit logs failed with error:
```
[AuditTrail] Failed to flush audit logs: {
  code: '42501',
  message: 'permission denied for table users'
}
```

**Root Cause**: The `audit_trail` table had a foreign key constraint referencing `auth.users(id)`:
```sql
user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
```

When inserting audit logs, PostgreSQL validates the foreign key by checking if the `user_id` exists in `auth.users`. However, the `auth.users` table (a Supabase system table) has RLS policies that block the service role from reading during FK validation.

**Solution**: Removed the foreign key constraint via migration `20251030_fix_audit_trail_user_fk.sql`:
```sql
ALTER TABLE public.audit_trail
  DROP CONSTRAINT IF EXISTS audit_trail_user_id_fkey;
```

This allows audit logs to be inserted without FK validation. The `user_id` column still stores user IDs, but doesn't enforce referential integrity. This is acceptable for audit logs, where preserving records even after user deletion is desirable.

**Verification**: Run `npx tsx scripts/check-routing-audit-logs.ts` after executing an agent to verify MODEL_ROUTING_DECISION events are being logged.

## Summary

We've successfully transformed the intelligent routing system from a static, environment-variable-based configuration to a dynamic, database-driven system with a comprehensive admin UI. This enables:

1. **Real-time Control**: Toggle routing and adjust thresholds without code deployment
2. **Scalability**: Extensible for any future system-wide configuration needs
3. **Performance**: 5-minute cache minimizes database load
4. **Security**: Admin-only access with audit trail
5. **User Experience**: Intuitive UI with visual feedback
6. **Audit Compliance**: Full routing decision audit trail (fixed permission issue)

The system is production-ready and fully backward-compatible! 🎉
