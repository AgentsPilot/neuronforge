# V6 AI Processing Decision Training

**Date**: 2026-01-05
**Status**: ✅ Complete
**Priority**: Critical - Prevents AI over-use and performance issues

## Problem Statement

The V6 semantic plan generator had **no explicit guidance** on when to use `ai_processing`, leading to:

1. **Inconsistent decisions**: LLM sometimes used AI for simple keyword matching
2. **Performance issues**: Unnecessary AI calls slow down workflows
3. **Cost inefficiency**: AI operations are expensive compared to filters
4. **Type confusion**: LLM couldn't distinguish semantic vs. deterministic operations

## Root Cause

**Single implicit example** in [semantic-plan-system.md](../lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md):

```json
{
  "understanding": {
    "ai_processing": [{
      "type": "extract",
      "instruction": "Extract expense data from PDF receipt attachments"
    }]
  }
}
```

**No explicit rules** like:
- When to use `ai_processing` vs. `filtering`
- When to use `ai_processing` vs. `grouping`
- What qualifies as "semantic understanding"
- Cost/performance trade-offs

## Solution: Explicit AI Processing Training

Added comprehensive **Section 6: When to Use AI Processing** ([semantic-plan-system.md:162-279](../lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md#L162-L279)) with:

### 1. Clear Use Cases (✅ YES)

```markdown
1. Unstructured Data Extraction
   - PDFs, images, scanned documents
   - OCR + semantic understanding

2. Semantic Classification
   - Sentiment analysis
   - Intent detection
   - Meaning-based categorization

3. Natural Language Transformation
   - Summarization
   - Tone adjustment
   - Description generation

4. Complex Field Extraction
   - Entity extraction from text
   - Natural language date parsing
   - Context-based inference
```

### 2. Clear Anti-Patterns (❌ NO)

```markdown
1. Keyword/Text Matching → Use filtering
   - Contains, starts with, ends with

2. Exact Field Comparisons → Use filtering
   - Equals, greater than, less than

3. Data Grouping/Sorting → Use grouping or partitions
   - Group by field value

4. Output Formatting → Use rendering
   - Column selection/ordering

5. Deduplication → Use filtering or runtime
   - Duplicate detection
```

### 3. Decision Tree

```
User wants to...
├─ Extract data from PDFs/images/unstructured docs?
│  └─ ✅ YES → ai_processing (type: "extract")
│
├─ Classify/categorize content by meaning (not keywords)?
│  └─ ✅ YES → ai_processing (type: "classify")
│
├─ Summarize or transform natural language?
│  └─ ✅ YES → ai_processing (type: "transform")
│
├─ Find specific keywords/phrases in text?
│  └─ ❌ NO → filtering (operator: "contains")
│
├─ Filter by field value comparison (equals, >, <)?
│  └─ ❌ NO → filtering (operator: "equals", "gt", "lt")
│
├─ Group or partition data by field?
│  └─ ❌ NO → grouping or partitions
│
└─ Format or render output?
   └─ ❌ NO → rendering
```

### 4. Concrete Examples

**Example 1: Keyword Matching (NOT AI)**
```
User: "Find Gmail complaint emails (keyword: angry)"
❌ WRONG: ai_processing with instruction "Find emails with complaint keywords"
✅ CORRECT: filtering.conditions = [{"field": "subject", "operator": "contains", "value": "angry"}]
```

**Example 2: PDF Extraction (YES AI)**
```
User: "Extract expense data from PDF receipt attachments"
✅ CORRECT: ai_processing = [{"type": "extract", "instruction": "Extract structured expense data from PDF receipts"}]
❌ WRONG: filtering or rendering (PDFs are unstructured, need AI to parse)
```

**Example 3: Sentiment Classification (YES AI)**
```
User: "Classify customer feedback as positive or negative"
✅ CORRECT: ai_processing = [{"type": "classify", "instruction": "Classify feedback sentiment as positive/negative/neutral"}]
❌ WRONG: filtering with keyword lists (sentiment requires semantic understanding)
```

**Example 4: Numeric Filtering (NOT AI)**
```
User: "Filter leads where stage equals 4"
❌ WRONG: ai_processing with instruction "Select high-quality leads"
✅ CORRECT: filtering.conditions = [{"field": "stage", "operator": "equals", "value": 4}]
```

### 5. Cost Reminder

```markdown
**Remember**: AI processing is expensive and slow. Only use it when
**semantic understanding** is truly required. Most workflows can be
handled with deterministic operations (filtering, grouping, rendering).
```

## Impact

### Before Training

**User**: "Scan Gmail for complaint emails (keyword: angry)"

**LLM Might Generate**:
```json
{
  "understanding": {
    "ai_processing": [{
      "type": "classify",
      "instruction": "Identify complaint emails with angry tone"
    }]
  }
}
```

**Result**: Unnecessary AI call, slow performance, high cost

### After Training

**User**: "Scan Gmail for complaint emails (keyword: angry)"

**LLM Should Generate**:
```json
{
  "understanding": {
    "filtering": {
      "conditions": [
        {"field": "subject", "operator": "contains", "value": "angry"},
        {"field": "subject", "operator": "contains", "value": "complaint"}
      ]
    }
  }
}
```

**Result**: Deterministic filter, fast, cheap, correct

## Files Changed

### [semantic-plan-system.md](../lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md)

**Lines**: 162-279 (new section, +118 lines)

**Changes**:
- Added "### 6. When to Use AI Processing"
- 4 use cases for AI processing
- 5 anti-patterns (when NOT to use AI)
- Decision tree flowchart
- 4 concrete examples (2 correct, 2 incorrect)
- Cost/performance reminder

## Testing

### Test Case 1: Keyword Matching

**Input**: "Find Gmail complaint emails (keyword: angry)"

**Expected Semantic Plan**:
```json
{
  "understanding": {
    "data_sources": [
      {"type": "api", "source": "google_mail", "location": "gmail"}
    ],
    "filtering": {
      "conditions": [
        {"field": "subject", "operator": "contains", "value": "angry"}
      ]
    }
  }
}
```

**Should NOT have**: `ai_processing` field

### Test Case 2: PDF Extraction

**Input**: "Extract expense data from PDF receipt attachments"

**Expected Semantic Plan**:
```json
{
  "understanding": {
    "data_sources": [
      {"type": "api", "source": "google_mail", "location": "gmail"}
    ],
    "ai_processing": [{
      "type": "extract",
      "instruction": "Extract structured expense data from PDF receipts",
      "input_description": "PDF attachments from emails",
      "output_description": "Expense data with vendor, amount, date, category"
    }]
  }
}
```

**Should NOT have**: `filtering` for extraction logic

### Test Case 3: Sentiment Classification

**Input**: "Classify customer feedback as positive or negative"

**Expected Semantic Plan**:
```json
{
  "understanding": {
    "ai_processing": [{
      "type": "classify",
      "instruction": "Classify feedback sentiment as positive/negative/neutral",
      "input_description": "Customer feedback text",
      "output_description": "Sentiment category field"
    }]
  }
}
```

**Should NOT use**: Keyword-based filtering

### Test Case 4: Numeric Filtering

**Input**: "Filter leads where stage equals 4"

**Expected Semantic Plan**:
```json
{
  "understanding": {
    "filtering": {
      "conditions": [
        {"field": "stage", "operator": "equals", "value": 4}
      ]
    }
  }
}
```

**Should NOT have**: `ai_processing` for numeric comparison

## Related Issues

This training addresses the following architectural gaps:

1. **Semantic Plan → IR Mapping**: Ensures `ai_operations` is only populated when truly needed
2. **DeclarativeCompiler Optimization**: Reduces fallback to LLM compiler by using deterministic filters
3. **Runtime Performance**: Eliminates unnecessary AI calls during workflow execution
4. **Cost Efficiency**: Prevents expensive AI operations for simple tasks

## Next Steps

1. ✅ **Deploy**: Changes are live in semantic-plan-system.md
2. 🔄 **Test**: Generate Gmail complaint workflow and verify no `ai_processing` in semantic plan
3. 📊 **Monitor**: Track `ai_operations` usage rate (should decrease)
4. 🎯 **Benchmark**: Compare performance/cost before and after training

## Success Metrics

- **Semantic Plan Accuracy**: 95%+ correct `ai_processing` vs. `filtering` decisions
- **AI Operations Rate**: <10% of workflows should use `ai_operations`
- **Performance**: Average workflow generation time reduced by 30%
- **Cost**: Average AI API costs reduced by 40%

## Conclusion

The V6 pipeline now has **explicit, comprehensive training** on when to use AI processing. This prevents:
- ❌ Keyword matching as AI operations
- ❌ Numeric filtering as AI operations
- ❌ Grouping/sorting as AI operations
- ❌ Deduplication as AI operations

And ensures AI is only used for:
- ✅ Unstructured data extraction
- ✅ Semantic classification
- ✅ Natural language transformation
- ✅ Complex entity extraction

The system is now ready for production testing with the Gmail complaint workflow.
