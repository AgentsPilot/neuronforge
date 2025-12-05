# Memory Configuration Parameters Audit Report

## Executive Summary
Complete audit of all 22 memory configuration parameters across the NeuronForge codebase. Verification of definitions, database loading, and actual usage in execution code.

---

## 1. INJECTION CONFIGURATION (5 Parameters)

### Parameter 1: max_tokens
- **Database Key**: `memory_injection_max_tokens`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:20)
- **Loaded from Database**: YES (MemoryConfigService.getInjectionConfig:84-93)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemoryInjector.ts:107 - logs max_tokens from config
  - **Location 2**: lib/memory/MemoryInjector.ts:385 - read as maxTokens fallback
  - **Location 3**: lib/memory/MemoryInjector.ts:447 - logs token allocation
  - **Usage**: Enforces token budget for memory injection into prompts
- **Status**: FULLY USED

### Parameter 2: min_recent_runs
- **Database Key**: `memory_injection_min_recent_runs`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:21)
- **Loaded from Database**: YES (MemoryConfigService.getInjectionConfig:89)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemoryInjector.ts:386 - read as minRecentRuns fallback
  - **Location 2**: lib/memory/MemoryInjector.ts:413 - ensures minimum runs are always included
  - **Location 3**: lib/memory/MemoryInjector.ts:436 - protects minimum runs from truncation
- **Usage**: Guarantees minimum recent runs included in memory context
- **Status**: FULLY USED

### Parameter 3: max_recent_runs
- **Database Key**: `memory_injection_max_recent_runs`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:22)
- **Loaded from Database**: YES (MemoryConfigService.getInjectionConfig:90)
- **Actually Used**: YES
  - **Location**: lib/memory/MemoryInjector.ts:76 - fetches recent runs with this limit
- **Usage**: Limits number of recent runs fetched from database
- **Status**: FULLY USED

### Parameter 4: semantic_search_limit
- **Database Key**: `memory_injection_semantic_search_limit`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:23)
- **Loaded from Database**: YES (MemoryConfigService.getInjectionConfig:91)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemoryInjector.ts:83 - checks if > 0 to enable semantic search
  - **Location 2**: lib/memory/MemoryInjector.ts:88 - passed to getSemanticMemories
  - **Location 3**: lib/memory/MemoryInjector.ts:302 - limits search results
- **Usage**: Controls number of semantically relevant memories to return
- **Status**: FULLY USED

### Parameter 5: semantic_threshold
- **Database Key**: `memory_injection_semantic_threshold`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:24)
- **Loaded from Database**: YES (MemoryConfigService.getInjectionConfig:92)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemoryInjector.ts:89 - passed to getSemanticMemories
  - **Location 2**: lib/memory/MemoryInjector.ts:301 - converts to distance threshold for pgvector
  - **Location 3**: lib/memory/MemoryInjector.ts:332 - filters results by confidence
- **Usage**: Sets minimum similarity score for semantic search results
- **Status**: FULLY USED

---

## 2. SUMMARIZATION CONFIGURATION (4 Parameters)

### Parameter 6: model
- **Database Key**: `memory_summarization_model`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:7)
- **Loaded from Database**: YES (MemoryConfigService.getSummarizationConfig:60-65)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemorySummarizer.ts:134 - logs model name
  - **Location 2**: lib/memory/MemorySummarizer.ts:138 - passed to OpenAI API
  - **Location 3**: lib/memory/MemorySummarizer.ts:156,160 - used for cost calculation
- **Usage**: Selects LLM model for memory summarization
- **Status**: FULLY USED

### Parameter 7: temperature
- **Database Key**: `memory_summarization_temperature`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:8)
- **Loaded from Database**: YES (MemoryConfigService.getSummarizationConfig:62)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemorySummarizer.ts:140 - passed to OpenAI completion API
  - **Location 2**: lib/memory/MemorySummarizer.ts:177 - logged in analytics metadata
- **Usage**: Controls randomness/creativity of LLM responses during summarization
- **Status**: FULLY USED

### Parameter 8: max_tokens (Summarization)
- **Database Key**: `memory_summarization_max_tokens`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:9)
- **Loaded from Database**: YES (MemoryConfigService.getSummarizationConfig:63)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemorySummarizer.ts:141 - passed to OpenAI API
  - **Location 2**: lib/memory/MemorySummarizer.ts:177 - logged in analytics metadata
- **Usage**: Limits output token length for summarization responses
- **Status**: FULLY USED

### Parameter 9: async
- **Database Key**: `memory_summarization_async`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:10)
- **Loaded from Database**: YES (MemoryConfigService.getSummarizationConfig:64)
- **Actually Used**: NO (UNUSED - FOUND NO IMPLEMENTATION)
  - **Configuration location**: App saves this to database (app/api/admin/memory-config/route.ts:159)
  - **Admin UI**: Checkbox exists (app/admin/memory-config/page.tsx)
  - **Usage in Code**: NO code checks or uses this parameter
  - **Current Behavior**: Summarization is ALWAYS async via fire-and-forget in MemoryEnhancedExecution.ts:140
- **Status**: NOT USED - Parameter is configured but ignored

---

## 3. EMBEDDING CONFIGURATION (3 Parameters)

### Parameter 10: model
- **Database Key**: `memory_embedding_model`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:14)
- **Loaded from Database**: YES (MemoryConfigService.getEmbeddingConfig:74-78)
- **Actually Used**: YES
  - **Location 1**: lib/memory/MemoryInjector.ts:291 - passed to OpenAI embeddings API
  - **Location 2**: lib/memory/MemorySummarizer.ts:630 - passed to OpenAI embeddings API
  - **Location 3**: lib/memory/MemorySummarizer.ts:670 - passed to OpenAI embeddings API
- **Usage**: Selects embedding model for memory vectorization
- **Status**: FULLY USED

### Parameter 11: batch_size
- **Database Key**: `memory_embedding_batch_size`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:16)
- **Loaded from Database**: YES (MemoryConfigService.getEmbeddingConfig:77)
- **Actually Used**: NO (UNUSED - FOUND NO IMPLEMENTATION)
  - **Configuration location**: App saves to database (app/api/admin/memory-config/route.ts:163)
  - **Admin UI**: Input field exists (app/admin/memory-config/page.tsx:36)
  - **Usage in Code**: Parameter is loaded but NEVER referenced in any code
  - **Note**: Would be used for batch embedding of multiple items, but implementation only does single embeddings
- **Status**: NOT USED - Parameter is configured but ignored

### Parameter 12: dimensions
- **Database Key**: `memory_embedding_dimensions`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:15)
- **Loaded from Database**: YES (MemoryConfigService.getEmbeddingConfig:76)
- **Actually Used**: NO (UNUSED - FOUND NO IMPLEMENTATION)
  - **Configuration location**: App saves to database (app/api/admin/memory-config/route.ts:164)
  - **Admin UI**: Input field with detailed help text (app/admin/memory-config/page.tsx:37)
  - **Usage in Code**: Parameter is loaded but NEVER used in embeddings or database queries
  - **Note**: Should be validated against embedding model output but no code does this
- **Status**: NOT USED - Parameter is configured but ignored

---

## 4. IMPORTANCE SCORING (6 Parameters)

### Parameter 13: base_score
- **Database Key**: `memory_importance_base_score`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:35)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:117)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:418 - initialized as base score
- **Usage**: Starting point for importance score calculation
- **Status**: FULLY USED

### Parameter 14: error_bonus
- **Database Key**: `memory_importance_error_bonus`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:36)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:118)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:422 - added when execution failed
- **Usage**: Bonus points for error/failure memories (higher importance for learning from failures)
- **Status**: FULLY USED

### Parameter 15: pattern_bonus
- **Database Key**: `memory_importance_pattern_bonus`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:37)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:119)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:427 - added for recurring error patterns
- **Usage**: Bonus for memories with detected patterns
- **Status**: FULLY USED

### Parameter 16: user_feedback_bonus
- **Database Key**: `memory_importance_user_feedback_bonus`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:38)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:120)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:438 - added when user provided feedback
- **Usage**: Bonus for memories with explicit user feedback
- **Status**: FULLY USED

### Parameter 17: first_run_bonus
- **Database Key**: `memory_importance_first_run_bonus`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:39)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:121)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:454 - added for first run (run_number === 1)
- **Usage**: Bonus for initial agent run memories
- **Status**: FULLY USED

### Parameter 18: milestone_bonus
- **Database Key**: `memory_importance_milestone_bonus`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:40)
- **Loaded from Database**: YES (MemoryConfigService.getImportanceConfig:122)
- **Actually Used**: YES
  - **Location**: lib/memory/MemorySummarizer.ts:457 - added for milestone runs (every 10th)
- **Usage**: Bonus for milestone run memories (every 10th run)
- **Status**: FULLY USED

---

## 5. RETENTION CONFIGURATION (4 Parameters)

### Parameter 19: run_memories_days
- **Database Key**: `memory_retention_run_memories_days`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:28)
- **Loaded from Database**: YES (MemoryConfigService.getRetentionConfig:103)
- **Actually Used**: YES
  - **Location**: scripts/memory-maintenance.ts:42 - used in cleanup script to calculate cutoff date
  - **Purpose**: Determines how many days to keep run memories before deletion
- **Usage**: Cleanup script deletes memories older than this threshold
- **Status**: FULLY USED

### Parameter 20: low_importance_days
- **Database Key**: `memory_retention_low_importance_days`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:29)
- **Loaded from Database**: YES (MemoryConfigService.getRetentionConfig:104)
- **Actually Used**: YES
  - **Location**: scripts/memory-maintenance.ts:45 - used to calculate cutoff for low-importance memories
  - **Purpose**: Determines how many days to keep low-importance memories
- **Usage**: Cleanup script deletes low-importance memories (score <= 3) older than this date
- **Status**: FULLY USED

### Parameter 21: consolidation_threshold
- **Database Key**: `memory_retention_consolidation_threshold`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:30)
- **Loaded from Database**: YES (MemoryConfigService.getRetentionConfig:105)
- **Actually Used**: YES
  - **Location**: scripts/memory-maintenance.ts:137 - threshold for consolidation (minimum number of memories)
  - **Purpose**: Only consolidate agents with memories >= this count
- **Usage**: Consolidation script filters agents having at least this many memories
- **Status**: FULLY USED

### Parameter 22: consolidation_frequency_days
- **Database Key**: `memory_retention_consolidation_frequency_days`
- **Defined in Types**: YES (lib/memory/MemoryConfigService.ts:31)
- **Loaded from Database**: YES (MemoryConfigService.getRetentionConfig:106)
- **Actually Used**: NO (UNUSED - FOUND NO IMPLEMENTATION)
  - **Configuration location**: App saves to database (app/api/admin/memory-config/route.ts:178)
  - **Admin UI**: Input field exists (app/admin/memory-config/page.tsx:51)
  - **Usage in Code**: Parameter is loaded but NOT used anywhere
  - **Note**: Would be used by a scheduler (cron) to determine consolidation frequency, but there's no such scheduler implementation
- **Status**: NOT USED - Parameter is configured but ignored

---

## Summary Table

| Category | Parameter | DB Key | Defined | Loaded | Used | Status |
|----------|-----------|--------|---------|--------|------|--------|
| **Injection** | max_tokens | memory_injection_max_tokens | YES | YES | YES | FULLY USED |
| | min_recent_runs | memory_injection_min_recent_runs | YES | YES | YES | FULLY USED |
| | max_recent_runs | memory_injection_max_recent_runs | YES | YES | YES | FULLY USED |
| | semantic_search_limit | memory_injection_semantic_search_limit | YES | YES | YES | FULLY USED |
| | semantic_threshold | memory_injection_semantic_threshold | YES | YES | YES | FULLY USED |
| **Summarization** | model | memory_summarization_model | YES | YES | YES | FULLY USED |
| | temperature | memory_summarization_temperature | YES | YES | YES | FULLY USED |
| | max_tokens | memory_summarization_max_tokens | YES | YES | YES | FULLY USED |
| | async | memory_summarization_async | YES | YES | NO | **UNUSED** |
| **Embedding** | model | memory_embedding_model | YES | YES | YES | FULLY USED |
| | batch_size | memory_embedding_batch_size | YES | YES | NO | **UNUSED** |
| | dimensions | memory_embedding_dimensions | YES | YES | NO | **UNUSED** |
| **Importance** | base_score | memory_importance_base_score | YES | YES | YES | FULLY USED |
| | error_bonus | memory_importance_error_bonus | YES | YES | YES | FULLY USED |
| | pattern_bonus | memory_importance_pattern_bonus | YES | YES | YES | FULLY USED |
| | user_feedback_bonus | memory_importance_user_feedback_bonus | YES | YES | YES | FULLY USED |
| | first_run_bonus | memory_importance_first_run_bonus | YES | YES | YES | FULLY USED |
| | milestone_bonus | memory_importance_milestone_bonus | YES | YES | YES | FULLY USED |
| **Retention** | run_memories_days | memory_retention_run_memories_days | YES | YES | YES | FULLY USED |
| | low_importance_days | memory_retention_low_importance_days | YES | YES | YES | FULLY USED |
| | consolidation_threshold | memory_retention_consolidation_threshold | YES | YES | YES | FULLY USED |
| | consolidation_frequency_days | memory_retention_consolidation_frequency_days | YES | YES | NO | **UNUSED** |

---

## Unused Parameters Analysis

### 1. memory_summarization_async
- **Configuration exists**: YES (admin UI + database storage)
- **Why not used**: Implementation always runs async in fire-and-forget pattern (MemoryEnhancedExecution.ts:140)
- **Recommendation**: Either remove the parameter or implement conditional async/sync behavior based on this flag

### 2. memory_embedding_batch_size
- **Configuration exists**: YES (admin UI + database storage)
- **Why not used**: Embedding calls use single items, no batch implementation
- **Recommendation**: Implement batch embedding for performance optimization, or remove parameter

### 3. memory_embedding_dimensions
- **Configuration exists**: YES (admin UI + database storage)
- **Why not used**: No validation or usage in code; should match embedding model output size
- **Recommendation**: Add validation to ensure dimensions match the selected embedding model, or remove parameter

### 4. memory_retention_consolidation_frequency_days
- **Configuration exists**: YES (admin UI + database storage)
- **Why not used**: No scheduler implementation; cleanup is manual script
- **Recommendation**: Either implement a scheduled job that uses this parameter, or remove it

---

## Load Chain Verification

**Path from Database to Usage (for USED parameters):**
1. MemoryConfigService.getXxxConfig() - loads from `system_settings_config` table
2. MemoryInjector/MemorySummarizer - calls getXxxConfig()
3. Uses parameters in execution logic

**Missing implementation chain (for UNUSED parameters):**
- Parameter exists in database but is never read after initial load
- No code path uses the parameter value after loading

---

## Key Findings

1. **18 out of 22 parameters (81.8%) are actually used** in the execution code
2. **4 parameters (18.2%) are configured but never used**:
   - async (summarization)
   - batch_size (embedding)
   - dimensions (embedding)
   - consolidation_frequency_days (retention)
3. **All parameters are properly defined** in interfaces and types
4. **All parameters are successfully loaded** from the database
5. **Admin UI allows configuration** of all 22 parameters
6. **The unused parameters may represent planned features** not yet implemented or deprecated

---

## Recommendations

1. **Review unused parameters**: Determine if they should be implemented or removed
2. **Add parameter validation**: Ensure dimensions matches embedding model output size
3. **Implement batch embedding**: For performance, implement the batch_size parameter
4. **Add scheduler support**: Implement scheduled consolidation using consolidation_frequency_days
5. **Document intended behavior**: Clarify if async parameter was meant to control sync/async mode or if it's obsolete
