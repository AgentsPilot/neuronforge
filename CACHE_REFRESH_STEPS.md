# UI Cache Refresh Steps

## Issue
Database shows **correct values** (`time_saved_seconds = 300`), but UI still shows **$700**.

## Evidence
Query results show execution `494784cd-e467-460b-a1fc-735a991f540a`:
- ✅ `time_saved_seconds`: **300** (correct!)
- ✅ `manual_time_per_item_seconds`: **null** (correct for bulk workflow!)
- ✅ Agent config: `is_bulk_workflow: true`, `total_manual_time_seconds: 300`

**Problem**: Database is fixed, but UI is showing stale data from cache.

## Steps to Refresh UI

### 1. Hard Refresh Browser
**Shortcut**:
- Mac: `Cmd + Shift + R`
- Windows/Linux: `Ctrl + Shift + R`

This will bypass browser cache and fetch fresh data from the API.

### 2. Clear Browser Cache (if hard refresh doesn't work)
1. Open browser DevTools (F12)
2. Go to Application tab
3. Clear Storage → Clear site data
4. Refresh page

### 3. Check API Response (verify data is flowing correctly)
1. Open browser DevTools (F12)
2. Go to Network tab
3. Refresh the agent detail page
4. Find request to `/api/agents/955d35c3-32a3-4fb5-a922-1fb798f4a349/executions`
5. Check response → look for `logs.metrics.time_saved_seconds` should be **300**

### 4. Verify All UI Components After Refresh

Expected values after refresh:

| Component | Location | Expected Value |
|-----------|----------|---------------|
| **Latest Run Card** | "Value Saved This Run" | **$8.33** |
| **Latest Run Card** | "Time Saved" metric | **5m** (300 seconds) |
| **Performance Trends** | Stats aggregation | Updated totals |
| **Dashboard** | "Total Saved" | **~$641** (77 runs × $8.33) |
| **Business Insights** | "Cost Saved Per Week" | **~$58/week** (7 runs × $8.33) |

## Additional Data Available to Display

The execution object has rich data that could be shown:

### From `execution_metrics` table:
```json
{
  "total_items": 210,           // ← Could show "Items Processed"
  "duration_ms": 18156,         // ✅ Already shown
  "time_saved_seconds": 300,    // ✅ Already shown
  "failed_step_count": 0,       // ← Could show in progress section
  "step_metrics": [...]         // ← Detailed step breakdown available
}
```

### Potential UI Enhancements:
1. **Items Processed Badge**: Show `210 items` next to success badge
2. **Run Mode Indicator**: Show if it was calibration vs production run
3. **Step Success Rate**: `10/10 steps completed` (currently shows as progress bar)
4. **Provider/Model Info**: Show which AI provider was used (already in logs)

## Current Status

✅ **Database Fixed**: All execution_metrics rows now have correct `time_saved_seconds`
✅ **Code Fixed**: All components read from stored values
⏳ **UI Cache**: Needs browser refresh to show updated values

## If Refresh Still Shows $700

Check these potential issues:

1. **API Route Not Merging**: Check `/api/agents/[id]/executions` response in Network tab
2. **Request Deduplication**: Clear cache might be blocking fresh request
3. **Component State**: React might have cached the old value
4. **Server Cache**: Next.js might have cached API route response

**Debug Command**:
```bash
# Check what API is returning
curl http://localhost:3000/api/agents/955d35c3-32a3-4fb5-a922-1fb798f4a349/executions | jq '.[0].logs.metrics.time_saved_seconds'
```

Should return: `300`
