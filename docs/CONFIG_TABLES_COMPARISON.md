# Configuration Tables Analysis

## Current State: TWO Configuration Tables

### 1. `ais_system_config` Table

**Purpose**: AIS (Agent Intensity System) configuration
**Used By**: Real AIS system for calculating agent complexity scores
**Access**: Via `AISConfigService.getSystemConfig()`

**Known Config Keys**:
```
pilot_credit_cost_usd = 0.00048
min_subscription_usd = 10.00
[... other AIS-specific settings ...]
```

**Where Used**:
- `lib/services/AISConfigService.ts` - Get/set AIS config
- `lib/services/AgentIntensityService.ts` - Read pilot credit cost
- `lib/services/CreditService.ts` - Read pricing values

**Schema**:
```sql
CREATE TABLE ais_system_config (
  config_key TEXT PRIMARY KEY,
  config_value NUMERIC NOT NULL,
  description TEXT,
  category TEXT  -- Added in migration
);
```

---

### 2. `pricing_config` Table

**Purpose**: General pricing configuration
**Used By**: Calculator via RPC function `get_pricing_config()`
**Access**: Via PostgreSQL RPC function

**Known Config Keys** (from RPC function):
```
base_credits_per_run
plugin_overhead_per_run
system_overhead_per_run
runs_per_agent_per_month = 15
credit_cost_usd = 0.00048
minimum_monthly_cost_usd = 10.00
agent_creation_cost = 800
execution_step_multiplier = 1.3
ais_tiers (JSONB)
execution_steps_by_plugins (JSONB)
default_reward_credits = 100
```

**Where Used**:
- `app/api/pricing/config/route.ts` - Calls `get_pricing_config()` RPC
- `app/api/admin/reward-config/route.ts` - Reads default reward credits
- `components/billing/PilotCreditCalculator.tsx` - Fetches pricing for calculator

**Schema** (inferred from usage):
```sql
CREATE TABLE pricing_config (
  config_key TEXT PRIMARY KEY,
  config_value NUMERIC,  -- Or could be JSONB for complex values
  description TEXT,
  -- possibly other columns...
);
```

---

## The Problem: Duplication & Confusion

### Duplicated Values

Both tables store similar values:
- `pilot_credit_cost_usd` (ais_system_config) = `credit_cost_usd` (pricing_config)
- `min_subscription_usd` (ais_system_config) = `minimum_monthly_cost_usd` (pricing_config)

This creates **synchronization issues**:
- Which table is the source of truth?
- If we update one, do we update both?
- What happens if they get out of sync?

### Different Access Patterns

- **ais_system_config**: Direct table access via AISConfigService
- **pricing_config**: RPC function access via `get_pricing_config()`

### Missing Definition

The `get_pricing_config()` RPC function is referenced but we don't have its definition in the codebase. It likely:
1. Reads from `pricing_config` table
2. Transforms/formats the data
3. Returns a structured object

---

## Recommended Solution: CONSOLIDATE

### Option 1: Use ONLY `ais_system_config` (RECOMMENDED)

**Benefits**:
- Single source of truth
- Consistent access pattern
- Easier to maintain
- Already has category support

**Migration Steps**:
1. Copy all `pricing_config` values to `ais_system_config`
2. Update `/api/pricing/config` to read from `ais_system_config`
3. Remove `get_pricing_config()` RPC function
4. Drop `pricing_config` table
5. Update all code to use `AISConfigService`

**Example**:
```typescript
// OLD: RPC function
const { data } = await supabase.rpc('get_pricing_config').single();

// NEW: Direct access
const config = await AISConfigService.getAllSystemConfig(supabase);
```

### Option 2: Use ONLY `pricing_config`

**Benefits**:
- Calculator already uses it
- RPC function can enforce validation
- Can return complex objects (JSONB)

**Drawbacks**:
- Need to move AIS values to pricing_config
- More complex to manage
- RPC function is a black box

---

## My Recommendation: Consolidate into `ais_system_config`

### Why?

1. **Already has AIS data**: The AIS ranges and thresholds are already there
2. **Service layer exists**: `AISConfigService` provides clean API
3. **Category support**: Can organize configs by category
4. **Type safety**: Can add TypeScript types for config keys
5. **Audit friendly**: Easier to track changes in one place

### Implementation

```typescript
// Single config service for everything
class SystemConfigService {
  static async get(key: string, fallback: number): Promise<number> {
    // Read from ais_system_config
  }

  static async getAll(): Promise<Record<string, number>> {
    // Read all from ais_system_config
  }

  static async getPricingConfig(): Promise<PricingConfig> {
    const all = await this.getAll();
    return {
      runsPerAgentPerMonth: all.runs_per_agent_per_month,
      creditCostUsd: all.pilot_credit_cost_usd,
      minimumMonthlyCostUsd: all.min_subscription_usd,
      // ... transform to structured object
    };
  }

  static async set(key: string, value: number): Promise<void> {
    // Update ais_system_config with audit logging
  }
}
```

### Migration SQL

```sql
-- 1. Ensure ais_system_config has all pricing values
INSERT INTO ais_system_config (config_key, config_value, description, category)
SELECT config_key, config_value, description, 'pricing'
FROM pricing_config
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value;

-- 2. Verify no data loss
-- SELECT COUNT(*) FROM pricing_config;  -- Should match imported count

-- 3. Drop the RPC function
DROP FUNCTION IF EXISTS get_pricing_config();

-- 4. Drop the old table (after backing up!)
-- DROP TABLE pricing_config;  -- Only after successful migration
```

---

## Action Plan

1. ✅ **Analyze** both tables (DONE)
2. **Decide**: Use only `ais_system_config`
3. **Migrate**: Copy pricing_config → ais_system_config
4. **Update API**: Change `/api/pricing/config` to use AISConfigService
5. **Update Calculator**: Fetch from new endpoint
6. **Test**: Verify calculator still works
7. **Cleanup**: Remove RPC function and old table

---

## Questions to Answer

1. **Does `get_pricing_config()` RPC exist in database?**
   - Need to check Supabase directly
   - Or find the SQL definition

2. **What's in `pricing_config` table right now?**
   - Need to query the database
   - Compare with `ais_system_config`

3. **Are there any other references to `pricing_config`?**
   - Need comprehensive codebase search
   - Check migrations, seeds, docs

4. **Should we keep RPC for backward compatibility?**
   - If calculator is in production
   - Gradual migration might be safer
