# Audit Trail Coverage Analysis

## Current Status

This document analyzes all admin operations and system actions to ensure complete audit trail coverage with the system admin user (`admin@agentspilot.ai`).

## Admin Operations

### ✅ Already Audited (Partial - AIS Operations)

**File**: `/app/api/admin/ais-config/route.ts`
**UI**: `/app/admin/ais-config/page.tsx`

1. **AIS Normalization Refresh** (API Line 259-326, UI Line 120-158)
   - Event: `AIS_NORMALIZATION_REFRESH_STARTED`
   - Event: `AIS_NORMALIZATION_REFRESH_COMPLETED`
   - Current user_id: `null` (Line 270, 295)
   - **Action**: Manual refresh via admin UI (user-initiated)
   - **Needs**: Pass real user ID from session

2. **AIS Mode Switch** (API Line 217-256, UI Line 84-118)
   - No audit logging currently
   - **Action**: User switches between best_practice/dynamic mode
   - **Needs**: Add audit event with user ID

3. **AIS Threshold Update** (API Line 329-350, UI Line 160-190)
   - No audit logging currently
   - **Action**: User updates minimum executions threshold
   - **Needs**: Add audit event with user ID

### ❌ Missing Audit (Reward Config)

**File**: `/app/api/admin/reward-config/route.ts`
**UI**: `/app/admin/reward-config/page.tsx`

1. **Update Reward Config** (API Line 48-84, UI Line 73-100)
   - No audit logging
   - **Action**: User updates reward configuration (credits, cooldown, limits)
   - **Needs**: Add audit event for reward updates with user ID

2. **Create Reward Config** (API Line 86-113, UI Line 102-128)
   - No audit logging
   - **Action**: User creates new reward configuration
   - **Needs**: Add audit event for reward creation with user ID

3. **Delete Reward Config** (API Line 115-140, UI Line 130-158)
   - No audit logging
   - **Action**: User deletes reward configuration
   - **Needs**: Add audit event for reward deletion with user ID

4. **Toggle Reward Active Status** (API Line 53-84, UI Line 160-185)
   - No audit logging
   - **Action**: User enables/disables reward
   - **Needs**: Add audit event for status toggle with user ID

### ❌ Missing Audit (System Config - Routing)

**File**: `/app/api/admin/system-config/route.ts`
**UI**: `/app/admin/system-config/page.tsx`

1. **Update Routing Configuration** (API PUT handler, UI Line 157-204)
   - No audit logging
   - **Action**: User updates intelligent routing settings (thresholds, enabled flag, Anthropic toggle)
   - **Needs**: Add audit event for routing config updates with user ID

### ❌ Missing Audit (Pricing Config)

**File**: `/app/api/admin/system-config/pricing/route.ts`
**UI**: `/app/admin/system-config/page.tsx`

1. **Update AI Model Pricing** (API Line 50-104, UI Line 218-261)
   - No audit logging
   - **Action**: User manually edits model pricing
   - **Needs**: Add audit event for pricing updates with user ID

2. **Create AI Model Pricing** (API Line 110-158)
   - No audit logging
   - **Action**: User creates new model pricing entry
   - **Needs**: Add audit event for pricing creation with user ID

3. **Delete AI Model Pricing** (API Line 164-204)
   - No audit logging
   - **Action**: User deletes model pricing entry
   - **Needs**: Add audit event for pricing deletion with user ID

4. **Sync Pricing from External Source** (UI Line 263-297)
   - No audit logging
   - **Action**: User triggers pricing sync from external API
   - **Needs**: Add audit event for pricing sync with user ID

### Other Admin Operations (Need Review)

Files that may need audit logging:
- `/app/api/admin/users/[id]/terminate/route.ts` - User termination
- `/app/api/admin/users/route.ts` - User management
- `/app/api/admin/system-config/route.ts` - System configuration (GET/PUT)
- `/app/api/admin/system-config/pricing/sync/route.ts` - Pricing sync POST handler

## System Actions (Automated)

### ✅ Already Audited

1. **Agent Execution** - Intelligent routing decisions
2. **AIS Score Calculations** - Initial and updates
3. **Token Usage Tracking** - Via usage tracker

### ❌ Missing Audit

1. **Background Jobs** - If any exist
2. **Scheduled Tasks** - If any exist
3. **Webhook Handlers** - If any exist

## Required Audit Events (To Add)

### In `/lib/audit/events.ts`

```typescript
// Admin Configuration Events
AIS_MODE_SWITCHED: 'ais:mode_switched',
AIS_THRESHOLD_UPDATED: 'ais:threshold_updated',
REWARD_CONFIG_CREATED: 'reward_config:created',
REWARD_CONFIG_UPDATED: 'reward_config:updated',
REWARD_CONFIG_DELETED: 'reward_config:deleted',
AI_PRICING_CREATED: 'ai_pricing:created',
AI_PRICING_UPDATED: 'ai_pricing:updated',
AI_PRICING_DELETED: 'ai_pricing:deleted',
```

## Implementation Plan

### Phase 1: System Admin User Setup
1. ✅ Create script to create system admin user
2. ⏳ Update AuditTrailService to use system admin as fallback
3. ⏳ Add SYSTEM_ADMIN_USER_ID to environment variables

### Phase 2: Add Missing Events
1. ⏳ Add new audit events to events.ts
2. ⏳ Create helper functions for admin config auditing
3. ⏳ Update all admin API routes with audit logging

### Phase 3: Update Existing Events
1. ⏳ Update AIS audit helpers to use system admin user ID
2. ⏳ Test all audit flows

### Phase 4: Backfill (Optional)
1. ⏳ Backfill existing NULL user_id logs with system admin ID

## User ID Assignment Strategy

### Regular User Actions
- Use actual user ID from auth session
- Examples: Creating agents, updating settings, running agents

### Admin Panel Actions (Done by User)
- Use actual user ID from auth session
- Examples: User manually refreshing AIS ranges, updating pricing

### System/Automated Actions
- Use system admin user ID
- Examples: Automatic AIS calculations, background jobs, scheduled tasks

### Admin Panel Actions (System-Initiated)
- Use system admin user ID
- Examples: Automatic range updates, system configuration changes

## How to Distinguish

When logging audit events:
```typescript
// User-initiated admin action
await auditLog({
  userId: session.user.id,  // Real user
  action: 'AIS_NORMALIZATION_REFRESH_STARTED',
  ...
});

// System-initiated action
await auditLog({
  userId: null,  // Will fallback to system admin
  action: 'AIS_SCORE_CALCULATED',
  ...
});
```

## Files to Update

1. ✅ `/scripts/create-system-admin.ts` - Create system admin
2. ⏳ `/lib/services/AuditTrailService.ts` - Add fallback logic
3. ⏳ `/lib/audit/events.ts` - Add new events
4. ⏳ `/lib/audit/ais-helpers.ts` - Already has userId parameter
5. ⏳ `/app/api/admin/ais-config/route.ts` - Get user from session
6. ⏳ `/app/api/admin/reward-config/route.ts` - Add audit logging
7. ⏳ `/app/api/admin/system-config/pricing/route.ts` - Add audit logging
8. ⏳ Create helper file: `/lib/audit/admin-helpers.ts` - Admin audit helpers

## Testing Checklist

- [ ] Create system admin user
- [ ] Test audit with real user ID
- [ ] Test audit with NULL user ID (should use system admin)
- [ ] Test AIS refresh (user-initiated)
- [ ] Test AIS mode switch
- [ ] Test reward config changes
- [ ] Test pricing changes
- [ ] Verify all audit logs appear in admin panel
- [ ] Verify system_action flag is set correctly

## Notes

- System admin email: `admin@agentspilot.ai`
- Environment variable: `SYSTEM_ADMIN_USER_ID`
- All NULL user_id values will automatically use system admin
- User-initiated actions should always pass the real user ID
