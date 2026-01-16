# V6 Comprehensive Workflow Pattern Catalog

**Created:** 2026-01-06
**Purpose:** Catalog all real-world business workflow patterns to ensure DeclarativeCompiler covers 95%+ of use cases

## Executive Summary

- **Total patterns found:** 23 distinct patterns
- **By complexity:** Simple (8), Medium (10), Complex (5)
- **Coverage assessment:** 70-75% currently supported, gaps identified in time-window dedup, multi-destination, and approval workflows

## Pattern Categories

| Category | Count | Examples |
|----------|-------|----------|
| Linear | 6 | Simple fetch → deliver workflows |
| Filtered | 13 | Keyword matching, comparison filters |
| Deduplicated | 1 | ID-based cross-system dedup |
| Grouped | 5 | Per-rep, per-assignee delivery |
| Looped | 9 | Per-item processing, batch operations |
| Conditional | 2 | If-then-else, comparison branching |
| AI-Enhanced | 11 | Sentiment, classification, extraction |
| Multi-Stage | 6 | Sequential transforms, joins |
| Cross-System | 3 | Multi-source workflows |

## All Patterns (Detailed)

### Pattern 1: Gmail Expense PDF Extraction with Summary
- **File:** `example-expense-declarative-ir.json`
- **Complexity:** Complex
- **Use Case:** Extract structured expense data from Gmail PDF attachments and email a summary table
- **Key Operations:** Filter emails → Loop per PDF → AI Extract fields → Normalize → Aggregate → Render table → Email
- **Critical Features:**
  - Multi-line item extraction (multiple rows per receipt)
  - Field validation with "need review" markers
  - PDF attachment processing
  - Summary metrics in delivery

### Pattern 2: Gmail Complaints to Google Sheets with Deduplication
- **File:** `scripts/gmail-complaints-prompt.json`
- **Complexity:** Medium
- **Use Case:** Log complaint emails to Google Sheets, avoiding duplicates based on Gmail message ID
- **Key Operations:** Fetch Gmail → Filter keywords → Lookup existing sheet → Cross-reference IDs → Append new only
- **Critical Features:**
  - ID-based deduplication across systems
  - Case-insensitive keyword filtering
  - Silent append (no notifications)

### Pattern 3: Sales Leads Per-Group Delivery
- **File:** `test-enhanced-prompt-leads.json`
- **Complexity:** Medium
- **Use Case:** Email each salesperson their high-qualified leads in a table
- **Key Operations:** Read sheet → Filter stage=4 → Partition by sales person → Render per-group table → Email each
- **Critical Features:**
  - Per-group scatter-gather pattern
  - Dynamic recipient from data column
  - Handles missing sales person values
  - Zero-result edge case handling

### Pattern 4-23: [Additional patterns cataloged in exploration agent output]

## Priority Gaps to Address

### Critical (Must Fix)

1. **Time-Window Deduplication** ⚠️
   - Current: Only ID-based deduplication
   - Needed: "Skip if processed in last 24 hours"
   - Business Impact: HIGH - prevents duplicate alerts/notifications
   - Implementation: Add timestamp comparison in FilterResolver

2. **Multi-Destination Delivery** ⚠️
   - Current: Single destination per workflow
   - Needed: Parallel email + Slack + Sheet writes
   - Business Impact: HIGH - common requirement
   - Implementation: Create parallel delivery steps in DeliveryResolver

3. **Multi-Field Deduplication** ⚠️
   - Current: Single field ID checking
   - Needed: Composite key deduplication (email+date)
   - Business Impact: MEDIUM - more robust dedup
   - Implementation: Extend DeduplicateResolver to support arrays

4. **Edge Case Handling Standardization** ⚠️
   - Current: Inconsistent zero-result handling
   - Needed: Every workflow should handle empty data
   - Business Impact: MEDIUM - better UX
   - Implementation: Auto-inject conditional checks

### Important (Should Fix)

5. **Complex Conditional Branching**
   - Only 2 simple conditional examples
   - Need nested if-then-else support
   - Implementation: Add ConditionalBranchingRule enhancements

6. **Incremental Processing**
   - No "process only new records" patterns
   - Need checkpoint/resume logic
   - Implementation: Add checkpoint tracking in DataSourceResolver

7. **Error Recovery**
   - No retry or partial failure examples
   - Need graceful degradation patterns
   - Implementation: Add error handling in ExecutionContext

### Nice to Have

8. **Approval Workflows** - Human-in-the-loop patterns
9. **Webhook Response** - Event-driven patterns
10. **Data Enrichment** - External lookup patterns

## Compiler Rule Priority Matrix

Based on pattern frequency analysis:

| Rule | Pattern Count | Priority | Status |
|------|---------------|----------|--------|
| LinearTransformDeliveryRule | 6 | P0 | ✅ Exists |
| TabularGroupedDeliveryRule | 5 | P0 | ✅ Exists |
| APIDataSourceWithLoopsRule | 9 | P0 | ✅ Exists |
| MultiStageTransformRule | 6 | P1 | ⚠️ Partial |
| ConditionalBranchingRule | 2 | P1 | ⚠️ Basic only |
| TimeWindowDeduplicationRule | 0 | P1 | ❌ Missing |
| MultiDestinationDeliveryRule | 0 | P1 | ❌ Missing |
| IncrementalProcessingRule | 0 | P2 | ❌ Missing |
| ApprovalWorkflowRule | 0 | P3 | ❌ Missing |

## Testing Strategy

### Phase 4 Test Coverage Goals

1. **Pattern Test Suite** (23 tests)
   - One test per cataloged pattern
   - Validate IR → DSL compilation
   - Assert correct step count, types, variable references

2. **Edge Case Suite** (15+ tests)
   - Empty data sources
   - Zero results after filter
   - Missing columns
   - Invalid filter values
   - Null handling

3. **Determinism Suite** (5+ tests)
   - Run same IR 100 times
   - Verify byte-identical output
   - Test with different plugin orders
   - Test with varying data sizes

4. **Performance Suite** (10+ tests)
   - Compilation time < 100ms target
   - Measure across pattern complexity levels
   - Benchmark vs LLM approach

## Implementation Roadmap

### Phase 2: Core Fixes (1 day)
- Fix variable reference format
- Fix scatter-gather output structure
- Add error handling
- Fix filter operators

### Phase 3: Pattern Support (2 days)
- Implement time-window deduplication
- Implement multi-destination delivery
- Implement multi-field deduplication
- Enhance conditional branching
- Add incremental processing support

### Phase 4: Testing (1.5 days)
- Create 23 pattern tests
- Create 15 edge case tests
- Create 5 determinism tests
- Create 10 performance benchmarks

### Phase 5: Enhanced Rules (1 day)
- Add TimeWindowDeduplicationRule
- Add MultiDestinationDeliveryRule
- Enhance ConditionalBranchingRule
- Add IncrementalProcessingRule

## Pattern Usage Statistics

From codebase analysis:

- **Most Common:** Filtered linear workflows (13 instances)
- **Second Most Common:** AI-enhanced processing (11 instances)
- **Third Most Common:** Looped per-item processing (9 instances)
- **Least Common:** Pure linear (6 instances)
- **Complex Multi-Stage:** 6 instances (join, aggregate, sequential transforms)

## Recommendations for DeclarativeCompiler

1. **Prioritize filtered workflows** - Most common pattern, must be bulletproof
2. **Robust AI operation support** - 11 patterns use AI, critical for business value
3. **Time-window deduplication** - High-impact gap, common business need
4. **Multi-destination delivery** - Frequently requested, currently unsupported
5. **Comprehensive edge case handling** - Zero results, empty data, missing fields must all be handled gracefully

## Success Metrics

To achieve 95%+ coverage goal:

- ✅ Support all 23 cataloged patterns
- ✅ Add 3 critical missing patterns (time-window dedup, multi-destination, multi-field dedup)
- ✅ 70+ comprehensive tests passing
- ✅ <100ms compilation for 95% of patterns
- ✅ 100% deterministic (same IR → same output)
- ✅ Zero silent failures

## References

- Pattern extraction from: test files, docs, examples, scripts
- Analysis date: 2026-01-06
- Total files analyzed: 50+
- Total lines of workflow code reviewed: ~15,000
