# V4 Scenario 3: Data Enrichment and Sync Pipeline

## Test Objectives

This scenario tests:
1. **Multiple data sources** (Google Sheets + HubSpot + LinkedIn)
2. **Data transformation pipeline** (fetch → enrich → validate → sync)
3. **Nested loops** (loop over contacts → loop over their deals)
4. **Complex error handling** (validation failures, API errors, fallback strategies)
5. **Conditional data updates** (update only if changed)

---

## Test Prompt

```
I have a Google Sheet with customer contact information (columns: email, company, status).

For each contact in the sheet:
1. Look up the contact in HubSpot by email
2. If contact exists in HubSpot:
   - Research their company on LinkedIn to get latest company info (size, industry, description)
   - Compare the LinkedIn data with HubSpot data
   - If company data differs:
     - Update HubSpot contact with new company info
     - For each deal associated with this contact:
       - If deal is in "negotiation" or "proposal" stage:
         - Add a note about the company change
         - Send Slack notification to #sales-alerts
       - Otherwise:
         - Just log the change in Google Sheet "company_updates" tab
   - If company data matches:
     - Mark as "verified" in Google Sheet
3. If contact not found in HubSpot:
   - Create new HubSpot contact with LinkedIn-enriched data
   - Create a "prospecting" deal
   - Send welcome email via Gmail

Google Sheet ID: 1XYZ789abc
Slack channel: #sales-alerts
```

---

## Expected Behavior

### Pattern Detection Expected:

1. **Loop Pattern**: "For each contact" should create scatter-gather
2. **Lookup Pattern**: "contact exists in HubSpot" should use `is_not_null`
3. **Comparison Pattern**: "company data differs" should use `not_equal` or custom comparison
4. **Nested Loop**: "For each deal associated with this contact" should create nested scatter-gather
5. **Classification Pattern**: "deal is in 'negotiation' or 'proposal' stage" should check deal stage
6. **Else Branch**: "If contact not found" should create else_steps

### Expected Workflow Structure:

```
1. Read contacts from Google Sheet (google-sheets.read_range)
2. For each contact:                                          ← Loop Level 1
   3. Look up contact in HubSpot (hubspot.search_contacts)
   4. If contact_found:                                       ← Conditional Level 1
      5. Research company on LinkedIn (chatgpt-research)
      6. Compare LinkedIn vs HubSpot data (ai_processing)
      7. If data_differs:                                     ← Conditional Level 2
         8. Update HubSpot contact (hubspot.update_contact)
         9. Get contact deals (hubspot.get_contact_deals)
         10. For each deal:                                   ← Loop Level 2 (nested)
            11. If deal_stage_negotiation_or_proposal:        ← Conditional Level 3
               12. Add note (hubspot.create_contact_note)
               13. Send Slack alert (slack.send_message)
            14. Otherwise:                                    ← Else Level 3
               15. Log to Google Sheet (google-sheets.append_rows)
      16. If data_matches:                                    ← Sibling Conditional Level 2
         17. Update Google Sheet status (google-sheets.update_cell)
   18. Otherwise:                                             ← Else Level 1
      19. Create HubSpot contact (hubspot.create_contact)
      20. Create prospecting deal (hubspot.create_deal)
      21. Send welcome email (google-mail.send_email)
```

**Total Expected Steps**: ~21 steps (1 top-level, 20 nested)

**Expected Nesting Depth**: 4 levels (Loop → Conditional → Loop → Conditional)

---

## Key Test Cases

### 1. Nested Loops
- **Outer loop**: "For each contact"
- **Inner loop**: "For each deal associated with this contact"
- **Challenge**: Inner loop variable must not conflict with outer loop variable

### 2. Sibling Conditionals with Else
- **Pattern**: "If data_differs" vs "If data_matches"
- **Challenge**: Both should be treated as separate conditionals, not if-else

### 3. Complex Condition
- **Pattern**: "deal is in 'negotiation' or 'proposal' stage"
- **Challenge**: Should detect as compound condition or multiple checks

### 4. Data Comparison
- **Pattern**: "Compare LinkedIn vs HubSpot data"
- **Challenge**: Should use AI processing for semantic comparison

### 5. Action Dependency Chain
- **Pattern**: Update → Get deals → Loop → Conditional → Action
- **Challenge**: Each step must reference correct parent data

---

## Success Criteria

### ✅ Pass if:
1. Outer loop variable: `contact`
2. Inner loop variable: `deal` (not conflicting with `contact`)
3. Step 4 condition uses `is_not_null` (lookup pattern)
4. Step 7 condition references step6 AI comparison result
5. Step 11 condition checks deal stage (could be `contains` or `equals`)
6. Else branches at steps 14 and 18 working correctly
7. Step 9 references step8 (update contact) for deal lookup
8. Step 12-13 reference `{{deal}}` loop variable
9. All HubSpot actions resolved correctly
10. Zero ambiguities

### ⚠️ Warning if:
1. Inner loop variable conflicts with outer loop
2. Data comparison not using AI processing
3. Nested loop references wrong parent data
4. Parameter values hardcoded incorrectly

### ❌ Fail if:
1. Nested loops not detected
2. Ambiguities for HubSpot actions
3. Loop variable preservation broken
4. Invalid PILOT_DSL_SCHEMA structure

---

## Expected Patterns Detected

1. **Scatter-gather (outer)**: `contact` loop variable
2. **Lookup pattern**: "contact exists in HubSpot" → `is_not_null`
3. **AI comparison**: "Compare LinkedIn vs HubSpot data"
4. **Scatter-gather (nested)**: `deal` loop variable
5. **Stage check**: "deal is in 'negotiation' or 'proposal' stage"
6. **Else branches**: 2 else branches (steps 14, 18)

---

## Additional Test Metrics

| Metric | Expected Value |
|--------|---------------|
| **Total Steps** | ~21 |
| **Top-level Steps** | 1 |
| **Nested Steps** | ~20 |
| **Loops** | 2 (1 outer, 1 nested) |
| **Conditionals** | 4 |
| **Else Branches** | 2 |
| **Max Nesting Depth** | 4 levels |
| **HubSpot Actions** | 7 (search, update, get_deals, create_note, create_contact, create_deal) |
| **AI Processing Steps** | 1 (comparison) |
| **Ambiguities** | 0 |
| **Warnings** | 0 |

---

## Plugin Actions Required

### HubSpot (7 actions):
- `search_contacts` ✅
- `update_contact` ⚠️ (needs to be added)
- `get_contact_deals` ✅
- `create_contact_note` ✅
- `create_contact` ✅
- `create_deal` ✅

### Google Sheets (3 actions):
- `read_range` ✅
- `append_rows` ✅
- `update_cell` ⚠️ (needs to be added)

### Google Mail (1 action):
- `send_email` ⚠️ (needs to be checked)

### Slack (1 action):
- `send_message` ✅

### ChatGPT Research (1 action):
- Default research action ✅

---

## Notes

**Missing Actions** (may cause ambiguities):
1. `hubspot.update_contact` - Need to add this action
2. `google-sheets.update_cell` - Need to check if exists

If these actions are missing, the test will validate:
- How the V4 generator handles ambiguities for missing write actions
- Whether it suggests correct alternatives
- Stage 3 repair loop capability (future)

---

## Running the Test

1. Ensure HubSpot plugin has all required actions
2. Submit the test prompt via agent creation form
3. Capture console output
4. Analyze:
   - Step count and structure
   - Nested loop variable handling
   - Conditional pattern detection
   - Ambiguity count
   - Token usage
   - Latency

---

## What This Tests Beyond Scenarios 1 & 2

| Feature | Scenario 1 | Scenario 2 | Scenario 3 |
|---------|-----------|-----------|-----------|
| AI Batching | N/A | ✅ | ✅ |
| Nested Loops | ❌ | ❌ | ✅ NEW |
| Loop Variable Conflicts | N/A | N/A | ✅ NEW |
| Sibling Conditionals | ✅ | ✅ | ✅ |
| Else Branches | ❌ | ✅ | ✅ (multiple) |
| Lookup Pattern | ⚠️ | ✅ | ✅ |
| Data Comparison | ❌ | ❌ | ✅ NEW |
| Action Dependency Chain | ✅ | ✅ | ✅ (deeper) |
| Update Actions | ❌ | ❌ | ✅ NEW |

---

This scenario is the most complex test case, validating nested loops, multiple else branches, and data comparison patterns.
