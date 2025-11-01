# Agent Intensity Tracking System

## Overview
The Agent Intensity system tracks computational complexity of agents to enable dynamic pricing based on actual resource usage. Each agent receives a complexity score (0-10) that translates to a pricing multiplier (1.0x-2.0x).

## Architecture

### Database Schema
- **agents.intensity_score**: Denormalized score for fast lookups
- **agents.last_intensity_update**: Timestamp of last calculation
- **agent_intensity_metrics**: Comprehensive metrics table with 30+ fields
- **Auto-sync trigger**: Automatically updates agents table when metrics change

### Scoring Components (Weighted Average)
1. **Token Complexity (35%)** - Token volume, efficiency, peak usage, I/O ratio
2. **Execution Complexity (25%)** - Iterations, duration, failure rate, retries
3. **Plugin Complexity (25%)** - Plugin count, orchestration overhead, call frequency
4. **Workflow Complexity (15%)** - Steps, branches, loops, parallel executions

### Pricing Formula
```
pricing_multiplier = 1.0 + (intensity_score / 10)
```
- Minimum: 1.0x (score: 0)
- Maximum: 2.0x (score: 10)
- Default: 1.5x (score: 5.0)

## Files Created

### Database
- `/supabase/migrations/20250128_add_agent_intensity.sql` - Complete schema with triggers, functions, views

### Backend
- `/lib/types/intensity.ts` - TypeScript types and constants
- `/lib/services/AgentIntensityService.ts` - Calculation engine and service methods
- `/app/api/agents/[id]/intensity/route.ts` - API endpoint for fetching intensity data

### Frontend
- `/components/agents/AgentIntensityCard.tsx` - UI card component with collapsible details

### Scripts
- `/scripts/backfill-agent-intensity.ts` - Initialize metrics for existing agents
- Package script: `npm run backfill:intensity`

### Integration
- `/app/api/run-agent/route.ts` - Automatic tracking on agent execution (both AgentKit and legacy paths)
- `/app/(protected)/agents/[id]/page.tsx` - Added "Complexity Analysis" section to agent details

## Usage

### Automatic Tracking
Intensity metrics are automatically updated after every agent execution. No manual intervention required.

### View Intensity Score
1. Navigate to any agent's details page
2. Scroll to "Complexity Analysis" section
3. Click to expand and see detailed breakdown

### API Access
```typescript
GET /api/agents/{agent_id}/intensity

Response:
{
  overall_score: 7.2,
  pricing_multiplier: 1.72,
  components: {
    token_complexity: { score: 8.1, weight: 0.35, weighted_score: 2.835 },
    execution_complexity: { score: 6.5, weight: 0.25, weighted_score: 1.625 },
    plugin_complexity: { score: 7.8, weight: 0.25, weighted_score: 1.95 },
    workflow_complexity: { score: 5.3, weight: 0.15, weighted_score: 0.795 }
  },
  details: {
    token_stats: { avg_tokens_per_run: 3421, peak_tokens: 5832, ... },
    execution_stats: { total_executions: 47, success_rate: 93.6, ... },
    plugin_stats: { unique_plugins: 3, avg_plugins_per_run: 2.1, ... },
    workflow_stats: { workflow_steps: 5, branches: 2, loops: 1, ... }
  }
}
```

### Programmatic Access
```typescript
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

// Get intensity breakdown
const breakdown = await AgentIntensityService.getIntensityBreakdown(agentId);

// Get just the metrics
const metrics = await AgentIntensityService.getMetrics(agentId);

// Initialize for new agent
await AgentIntensityService.initializeMetrics(agentId, userId);
```

## Database Views

### agent_intensity_distribution
Analytics view showing distribution across intensity ranges:
```sql
SELECT * FROM agent_intensity_distribution;
```

### top_complex_agents
Top 100 most complex agents:
```sql
SELECT * FROM top_complex_agents;
```

## Scoring Ranges

| Range | Score | Multiplier | Description |
|-------|-------|------------|-------------|
| **Low** | 0-3 | 1.0x-1.3x | Simple agents with minimal resource usage |
| **Medium** | 3-6 | 1.3x-1.6x | Standard agents with moderate complexity |
| **High** | 6-10 | 1.6x-2.0x | Complex agents with heavy resource usage |

## Calibration

Default normalization ranges for each component can be adjusted in `AgentIntensityService.ts`:

```typescript
// Token volume: 0-5000 tokens maps to 0-10 score
const tokenVolumeScore = this.normalizeToScale(
  metrics.avg_tokens_per_run || 0,
  0,    // min input
  5000, // max input
  0,    // min output
  10    // max output
);
```

Adjust these ranges based on observed usage patterns in production.

## Status

✅ **Deployed** - System is live and tracking all agent executions

### Completed
- Database schema with triggers and functions
- Service layer with calculation engine
- API endpoints
- UI components integrated into agent details page
- Automatic tracking on execution
- Backfill script for existing agents

### Pending
- Credit system integration (deducting credits with intensity multiplier)
- Production calibration after collecting real-world data
- Admin dashboard for monitoring intensity distribution

## Monitoring

Check system health:
```sql
-- Count agents with metrics
SELECT COUNT(*) FROM agent_intensity_metrics;

-- Average intensity score
SELECT AVG(intensity_score) FROM agent_intensity_metrics;

-- Distribution by range
SELECT * FROM agent_intensity_distribution;

-- Agents needing recalculation (not updated in 7 days)
SELECT a.agent_name, m.last_calculated_at, m.intensity_score
FROM agents a
JOIN agent_intensity_metrics m ON a.id = m.agent_id
WHERE m.last_calculated_at < NOW() - INTERVAL '7 days'
  AND a.status = 'active';
```

## Future Enhancements

1. **ML-based scoring**: Use machine learning to predict intensity before execution
2. **Cost forecasting**: Show estimated credit cost before running agent
3. **Optimization suggestions**: Recommend ways to reduce agent complexity
4. **Historical trends**: Track how agent complexity evolves over time
5. **Comparative analysis**: Compare agent efficiency across similar use cases
