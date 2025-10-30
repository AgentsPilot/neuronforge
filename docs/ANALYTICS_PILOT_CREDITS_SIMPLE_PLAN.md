# Analytics - Pilot Credits Display Update

## GOOD NEWS! ✅

**Cost calculation is ALREADY using the database-backed pricing system!**

- ✅ `/lib/ai/pricing.ts` - Loads from `ai_model_pricing` table
- ✅ OpenAIProvider uses `calculateCostSync()`
- ✅ AnthropicProvider uses `calculateCostSync()`
- ✅ Cost is correctly calculated based on actual model used

**So the analytics costs ARE accurate with intelligent routing!**

---

## What We Need to Fix

### Only Issue: Display Pilot Credits Instead of Raw Tokens

Currently shows:
```
Total Tokens: 100,000
```

Should show:
```
Total Pilot Credits: 10,000
```

**Formula**: `Pilot Credits = tokens ÷ 10`

---

## Implementation Plan

### Step 1: Update Helper Function

**File**: `/lib/utils/analyticsHelpers.ts`

```typescript
// Add new function
export const formatPilotCredits = (tokens: number | null | undefined): string => {
  if (tokens == null || typeof tokens !== 'number' || isNaN(tokens)) return '0';

  const pilotCredits = Math.round(tokens / 10); // 10 tokens = 1 Pilot Credit

  if (pilotCredits === 0) return '0';
  if (pilotCredits < 1000) return Math.floor(pilotCredits).toLocaleString();
  if (pilotCredits < 1000000) return `${(pilotCredits / 1000).toFixed(1)}K`;
  return `${(pilotCredits / 1000000).toFixed(1)}M`;
};

// Keep backward compatibility
/** @deprecated Use formatPilotCredits instead */
export const formatTokens = formatPilotCredits;
```

### Step 2: Update Analytics Views

**File**: `/components/analytics/AnalyticsView.tsx`

Changes needed:
1. Import: `formatPilotCredits` instead of `formatTokens`
2. Update all labels: "Tokens" → "Pilot Credits"
3. Update all formatting calls

**File**: `/components/analytics/MetricsCards.tsx`

Changes needed:
1. Update card label: "Total Tokens" → "Total Pilot Credits"
2. Use `formatPilotCredits()`

### Step 3: Update Admin Analytics

**File**: `/app/admin/analytics/page.tsx`

Changes needed:
1. Update column headers: "Tokens" → "Pilot Credits"
2. Update display formatting
3. Update tooltip/description text

---

## Files to Update

### Core Helper:
- ✅ `/lib/utils/analyticsHelpers.ts` - Add formatPilotCredits()

### UI Components:
- ⏳ `/components/analytics/AnalyticsView.tsx` - Update all tabs
- ⏳ `/components/analytics/MetricsCards.tsx` - Update overview cards
- ⏳ `/app/admin/analytics/page.tsx` - Update admin view

---

## Testing Checklist

- [ ] Overview tab shows "Pilot Credits" with correct values
- [ ] Insights tab shows "Pilot Credits"
- [ ] Activities tab shows "Pilot Credits"
- [ ] Agents tab shows "Pilot Credits"
- [ ] Admin analytics shows "Pilot Credits"
- [ ] Verify conversion: 10,000 tokens = 1,000 Pilot Credits
- [ ] Cost calculation remains unchanged and accurate

---

## Example Changes

### Before:
```
Total Tokens: 100,000
Average per request: 1,234 tokens
```

### After:
```
Total Pilot Credits: 10,000
Average per request: 123 Pilot Credits
```

---

## Notes

- **No cost calculation changes needed** - already using database pricing
- **Only UI changes** - display layer update
- **Backward compatible** - keeps formatTokens as alias
- **Simple conversion** - divide by 10, round to nearest integer
