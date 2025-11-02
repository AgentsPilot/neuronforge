# Memory System Integration Documentation

## Overview

The NeuronForge Memory System provides agents with context awareness by remembering past executions and learning from patterns. This system is fully integrated into the agent execution flow and operates transparently without requiring changes to existing agent code.

## How It Works

### 1. Memory Loading (Before Execution)

When an agent is executed via `runAgentKit()`, the system:

1. **Loads Memory Context** ([runAgentKit.ts:212-224](../lib/agentkit/runAgentKit.ts#L212-L224))
   - Fetches recent execution history (last 3-5 runs)
   - Loads user preferences from cross-agent memory
   - Retrieves semantically relevant patterns (when embeddings are available)
   - Enforces token budget (max 800 tokens by default)

2. **Injects Memory into Prompt** ([runAgentKit.ts:289](../lib/agentkit/runAgentKit.ts#L289))
   - Formats memory as human-readable prompt section
   - Positioned between plugin context and date/time context
   - Includes icons and structured formatting for clarity

### 2. Agent Execution

The agent receives an enhanced system prompt that includes:
- Original agent prompt
- Available plugins/functions
- **🧠 AGENT MEMORY CONTEXT** ← Memory injection point
- Current date/time
- Instructions

### 3. Memory Summarization (After Execution)

After successful execution, the system asynchronously:

1. **Triggers Background Summarization** ([runAgentKit.ts:465-476](../lib/agentkit/runAgentKit.ts#L465-L476))
   - Fire-and-forget pattern (doesn't block user response)
   - Passes execution result to summarization service

2. **Creates Memory Summary** ([summarizeExecutionAsync:686-735](../lib/agentkit/runAgentKit.ts#L686-L735))
   - Calls gpt-4o-mini to analyze execution
   - Compares with recent runs to detect patterns
   - Calculates importance score (1-10)
   - Saves to `run_memories` table

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Execution Flow                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │ runAgentKit()  │
                   └────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ModelRouter  │   │   Memory     │   │   Plugin     │
│   (AIS)      │   │  Injector    │   │   Context    │
└──────────────┘   └──────────────┘   └──────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │  Enhanced Prompt │
                  │  with Memory     │
                  └──────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  LLM Execution  │
                   └─────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ Return Response  │
                  └──────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ Memory Summarizer│← Async (background)
                  │ (gpt-4o-mini)    │
                  └──────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ Save to Database │
                  │ (run_memories)   │
                  └──────────────────┘
```

## Database Schema

### Core Tables

#### `run_memories`
Stores individual execution memories with LLM-generated summaries.

```sql
- id: uuid (primary key)
- agent_id: uuid (foreign key)
- user_id: uuid
- execution_id: string
- run_number: integer (sequential per agent)
- run_timestamp: timestamp

- summary: text (2-3 sentence summary)
- key_outcomes: jsonb (success, items_processed, errors, warnings)
- patterns_detected: jsonb (recurring_error, success_pattern, performance_issue)
- suggestions: jsonb (improve_prompt, adjust_schedule, optimize_config)
- user_feedback: text (optional)

- importance_score: integer (1-10)
- memory_type: string ('run')
- token_count: integer
- embedding: vector(1536) (for semantic search)

- model_used: string
- credits_consumed: integer
- execution_time_ms: integer
- ais_score: float
```

#### `memory_config`
Stores system-wide memory configuration (editable via Admin UI).

```sql
- config_key: string (primary key)
- config_value: jsonb
- description: text
- is_active: boolean
- updated_at: timestamp
```

#### `agent_memory_stats` (View)
Aggregated statistics per agent.

```sql
- agent_id: uuid
- total_memories: count
- avg_importance: float
- last_run_timestamp: timestamp
- success_rate: float
```

#### `user_memory`
Cross-agent user preferences and profile.

```sql
- user_id: uuid
- key: string
- value: jsonb
- memory_type: string ('preference', 'style', 'context')
- importance: integer (1-10)
```

## Configuration

All memory parameters are stored in the `memory_config` table and can be adjusted via the Admin UI at `/admin/system-config`.

### Summarization Config
```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "max_tokens": 500
}
```

### Injection Config
```json
{
  "max_tokens": 800,
  "max_recent_runs": 5,
  "min_recent_runs": 3,
  "semantic_threshold": 0.7,
  "semantic_search_limit": 3
}
```

### Importance Config
```json
{
  "base_score": 5,
  "error_bonus": 2,
  "pattern_bonus": 2,
  "user_feedback_bonus": 3,
  "first_run_bonus": 2,
  "milestone_bonus": 1
}
```

### Retention Config
```json
{
  "high_importance_days": 90,
  "medium_importance_days": 30,
  "low_importance_days": 7
}
```

### Embedding Config
```json
{
  "model": "text-embedding-3-small",
  "batch_size": 100
}
```

## API Endpoints

### Admin API: `/api/admin/memory-config`

**GET** - Fetch all memory configurations
```bash
curl http://localhost:3000/api/admin/memory-config
```

**POST** - Update configuration
```bash
curl -X POST http://localhost:3000/api/admin/memory-config \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "configKey": "injection",
    "configValue": {
      "max_tokens": 1000,
      "max_recent_runs": 7
    }
  }'
```

**POST** - Clear cache
```bash
curl -X POST http://localhost:3000/api/admin/memory-config \
  -H "Content-Type: application/json" \
  -d '{"action": "clearCache"}'
```

## Services

### MemoryInjector
Loads and formats memory context for injection.

**Location**: [lib/memory/MemoryInjector.ts](../lib/memory/MemoryInjector.ts)

**Key Methods**:
- `buildMemoryContext(agentId, userId, currentInput)` - Load memory within token budget
- `formatForPrompt(context)` - Format memory as prompt string
- `getNextRunNumber(agentId)` - Get sequential run number

### MemorySummarizer
Creates LLM-based memory summaries asynchronously.

**Location**: [lib/memory/MemorySummarizer.ts](../lib/memory/MemorySummarizer.ts)

**Key Methods**:
- `summarizeExecution(input)` - Create memory summary using gpt-4o-mini
- `generateEmbedding(memoryId)` - Generate vector embedding for semantic search

### MemoryConfigService
Manages memory system configuration with caching.

**Location**: [lib/memory/MemoryConfigService.ts](../lib/memory/MemoryConfigService.ts)

**Key Methods**:
- `getSummarizationConfig(supabase)` - Load summarization config
- `getInjectionConfig(supabase)` - Load injection config
- `updateConfig(supabase, key, value)` - Update configuration
- `clearCache()` - Clear cached configs

## Memory Prompt Format

When memory is injected, it appears in the system prompt like this:

```
--- 🧠 AGENT MEMORY CONTEXT ---

👤 USER PROFILE:
  • preferred_timezone: "America/Los_Angeles"
  • email_style: "concise"

📊 RECENT HISTORY:
  ✅ Run #12: Newsletter filtering reduced processing time 50%
      ✨ Success: Newsletter filtering effective
  ❌ Run #11: Gmail API rate limit error (429)
      ⚠️ Pattern: Weekend rate limiting (3 consecutive)
  ✅ Run #10: Milestone run - 10 executions completed

💡 LEARNED PATTERNS:
  • Weekend executions trigger rate limiting (confidence: 85%)
  • Newsletter filtering improves performance significantly

--- END MEMORY (347 tokens) ---

INSTRUCTIONS: Use memory context to inform your response. Reference past patterns when relevant.
```

## Performance Characteristics

### Token Budget Management
- **Hard Limit**: 800 tokens (configurable)
- **Priority Order**:
  1. User context (always included if available)
  2. Recent runs (minimum 3, then fill to budget)
  3. Semantic patterns (space permitting)

### Async Processing
- Memory summarization happens **after** user receives response
- Non-blocking: Failures don't affect execution result
- Typical summarization time: 1-2 seconds (gpt-4o-mini call)

### Caching
- Configuration cached in-memory (15 minutes TTL)
- Reduces database calls for frequently accessed configs
- Cache invalidation via Admin UI

## Testing

### Test Script
```bash
npx tsx scripts/test-memory-integration.ts
```

This script verifies:
- ✅ Database connectivity
- ✅ Memory configuration loading
- ✅ Memory context building
- ✅ Memory prompt formatting
- ✅ Run number tracking
- ✅ Existing memories retrieval

### Manual Testing
1. Create an agent via UI
2. Execute the agent multiple times with different inputs
3. Check `run_memories` table to see created memories
4. Execute again and verify memory is injected into prompt
5. Observe agent behavior improvement over multiple runs

### Query Recent Memories
```sql
SELECT
  run_number,
  summary,
  importance_score,
  run_timestamp
FROM run_memories
WHERE agent_id = 'your-agent-id'
ORDER BY run_number DESC
LIMIT 10;
```

## Integration Points

### Current Implementation
- ✅ Agent execution via `runAgentKit()` in [lib/agentkit/runAgentKit.ts](../lib/agentkit/runAgentKit.ts)
- ✅ Memory loaded before execution (lines 212-224)
- ✅ Memory injected into system prompt (line 289)
- ✅ Async summarization after execution (lines 465-476)

### Future Integration Points
- 🔮 Sandbox agent execution (when implemented)
- 🔮 Scheduled agent execution (when implemented)
- 🔮 Batch agent execution (when implemented)

## Future Enhancements

### Phase 2: Semantic Search (Planned)
- Generate embeddings for all memories using `text-embedding-3-small`
- Enable pgvector similarity search based on current input
- Surface relevant patterns from past executions

### Phase 3: Memory Consolidation (Planned)
- Periodic background job to consolidate old run memories
- Move recurring patterns to `agent_memory` table
- Automatic cleanup of low-importance old memories

### Phase 4: User-Facing Features (Planned)
- Memory dashboard showing agent learning progress
- Manual feedback system to boost importance
- Memory export and import for agent sharing

## Troubleshooting

### Issue: No memories are being created

**Check**:
1. Verify database migration has been run
2. Check console logs for summarization errors
3. Verify `OPENAI_API_KEY` is set in environment
4. Check `memory_config` table has active configuration

**Solution**:
```bash
# Run migration
npx supabase db push

# Test summarization
npx tsx scripts/test-memory-integration.ts
```

### Issue: Memory not appearing in agent prompts

**Check**:
1. Verify agent has existing memories in `run_memories` table
2. Check injection config `max_tokens` is not too low
3. Verify `MemoryInjector` logs show context loading

**Solution**:
```sql
-- Check for existing memories
SELECT COUNT(*) FROM run_memories WHERE agent_id = 'your-agent-id';

-- Adjust token budget
UPDATE memory_config
SET config_value = jsonb_set(config_value, '{max_tokens}', '1200')
WHERE config_key = 'injection';
```

### Issue: Summarization is slow or timing out

**Check**:
1. Verify OpenAI API is responding
2. Check gpt-4o-mini availability
3. Review `max_tokens` in summarization config

**Solution**:
```json
// Reduce max_tokens in summarization config
{
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "max_tokens": 300  // Reduced from 500
}
```

## Best Practices

1. **Start Small**: Begin with default token budgets and adjust based on agent performance
2. **Monitor Importance**: Regularly review importance scores to ensure quality
3. **Provide Feedback**: Use user feedback field to boost critical memories
4. **Clean Regularly**: Implement retention policy to remove old low-importance memories
5. **Test Patterns**: Execute agents multiple times to see pattern detection in action

## Related Documentation

- [Memory Config Service](../lib/memory/MemoryConfigService.ts)
- [Memory Injector](../lib/memory/MemoryInjector.ts)
- [Memory Summarizer](../lib/memory/MemorySummarizer.ts)
- [Database Migration](../supabase/migrations/YYYYMMDDHHMMSS_add_memory_system.sql)
- [Admin UI Integration](../app/admin/system-config/page.tsx)

## Support

For issues or questions about the memory system:
1. Check console logs for detailed error messages
2. Run the test script to verify system health
3. Review the Admin UI at `/admin/system-config`
4. Check database tables for data integrity

---

**Version**: 1.0.0
**Last Updated**: 2025-10-31
**Status**: ✅ Production Ready
