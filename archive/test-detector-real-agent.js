// Test HardcodeDetector V2 with real agent data

const realAgentSteps = [
  {
    "id": "step1",
    "name": "Fetch Gmail messages for user offir.omer@gmail.com, limited to Inbox, within the last 7 days Data",
    "type": "action",
    "action": "search_emails",
    "params": {
      "query": "in:inbox newer_than:7d",
      "folder": "inbox",
      "max_results": 10,
      "content_level": "snippet",
      "include_attachments": false
    },
    "plugin": "google-mail"
  },
  {
    "id": "step2",
    "name": "Read Google Sheet used as destination and also as the deduplication reference set (existing rows)",
    "type": "action",
    "action": "read_range",
    "params": {
      "range": "UrgentEmails",
      "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
      "major_dimension": "ROWS",
      "include_formula_values": false
    },
    "plugin": "google-sheets"
  },
  {
    "id": "step3",
    "name": "Convert Rows to Objects",
    "type": "transform",
    "input": "{{step2.data.values}}",
    "config": {},
    "on_error": {
      "action": "continue",
      "log_error": true
    },
    "operation": "rows_to_objects"
  },
  {
    "id": "step8",
    "name": "Filter Group 1",
    "type": "transform",
    "input": "{{step7.data}}",
    "config": {
      "condition": {
        "conditions": [
          {
            "field": "snippet",
            "value": "complaint",
            "operator": "contains",
            "conditionType": "simple"
          },
          {
            "field": "snippet",
            "value": "refund",
            "operator": "contains",
            "conditionType": "simple"
          },
          {
            "field": "snippet",
            "value": "angry",
            "operator": "contains",
            "conditionType": "simple"
          },
          {
            "field": "snippet",
            "value": "not working",
            "operator": "contains",
            "conditionType": "simple"
          }
        ],
        "conditionType": "complex_or"
      }
    },
    "on_error": {
      "action": "continue",
      "log_error": true
    },
    "operation": "filter"
  },
  {
    "id": "step10",
    "name": "Send Summary via google-sheets",
    "type": "action",
    "action": "append_rows",
    "params": {
      "range": "UrgentEmails",
      "values": "{{step9.data}}",
      "input_option": "USER_ENTERED",
      "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
      "insert_data_option": "INSERT_ROWS"
    },
    "plugin": "google-sheets"
  }
];

console.log('=== Testing HardcodeDetector V2 with Real Agent ===\n');

console.log('📋 Agent Structure:');
console.log('  - Step 1: Gmail search with query');
console.log('  - Step 2: Read Google Sheets (spreadsheet_id + range)');
console.log('  - Step 3-7: Transform operations');
console.log('  - Step 8: Filter with 4 conditions (complaint, refund, angry, not working)');
console.log('  - Step 10: Append to Google Sheets (same spreadsheet_id)');

console.log('\n✅ EXPECTED DETECTIONS (user-configurable values):');
console.log('  1. step1.params.query = "in:inbox newer_than:7d"');
console.log('  2. step1.params.folder = "inbox"');
console.log('  3. step1.params.max_results = 10');
console.log('  4. step1.params.content_level = "snippet"');
console.log('  5. step2.params.spreadsheet_id = "1pM8Wb..." (also in step10)');
console.log('  6. step2.params.range = "UrgentEmails"');
console.log('  7. step2.params.major_dimension = "ROWS"');
console.log('  8. step8.config.condition.conditions[0].value = "complaint"');
console.log('  9. step8.config.condition.conditions[1].value = "refund"');
console.log(' 10. step8.config.condition.conditions[2].value = "angry"');
console.log(' 11. step8.config.condition.conditions[3].value = "not working"');
console.log(' 12. step10.params.range = "UrgentEmails"');
console.log(' 13. step10.params.input_option = "USER_ENTERED"');
console.log(' 14. step10.params.insert_data_option = "INSERT_ROWS"');

console.log('\n✗ SHOULD NOT DETECT (workflow structure):');
console.log('  - step1.type = "action"');
console.log('  - step1.action = "search_emails"');
console.log('  - step1.plugin = "google-mail"');
console.log('  - step1.params.include_attachments = false (boolean)');
console.log('  - step2.action = "read_range"');
console.log('  - step2.plugin = "google-sheets"');
console.log('  - step2.params.include_formula_values = false (boolean)');
console.log('  - step3.operation = "rows_to_objects"');
console.log('  - step3.on_error.action = "continue"');
console.log('  - step3.on_error.log_error = true (boolean)');
console.log('  - step8.operation = "filter"');
console.log('  - step8.config.condition.conditions[0].field = "snippet" (field name)');
console.log('  - step8.config.condition.conditions[0].operator = "contains" (operator)');
console.log('  - step8.config.condition.conditions[0].conditionType = "simple" (type)');
console.log('  - step8.config.condition.conditionType = "complex_or" (type)');
console.log('  - step10.action = "append_rows"');
console.log('  - step10.plugin = "google-sheets"');

console.log('\n📊 Expected Results:');
console.log('  - Total detected: ~14 values');
console.log('  - Resource IDs: 1 (spreadsheet_id used in 2 steps)');
console.log('  - Configuration: ~9 (query, folder, max_results, ranges, options)');
console.log('  - Business Logic: 4 (complaint, refund, angry, "not working")');

console.log('\n🧪 Detection Logic:');
console.log('  ✓ Values in .params.* → DETECTED');
console.log('  ✓ Values in .config.condition.conditions[].value → DETECTED');
console.log('  ✗ Booleans → SKIPPED');
console.log('  ✗ .operation, .action, .plugin, .type → SKIPPED');
console.log('  ✗ .field, .operator, .conditionType → SKIPPED');
console.log('  ✗ .on_error.* → SKIPPED');
console.log('  ✗ Template variables {{ }} → SKIPPED');

console.log('\n📝 Key Test Cases:');
console.log('  1. spreadsheet_id appears in step2 AND step10 → Should be marked "critical" priority');
console.log('  2. Filter values in nested array → Should be detected');
console.log('  3. "not working" (two words) → Should be detected as single value');
console.log('  4. Booleans (include_attachments, include_formula_values) → Should be skipped');
console.log('  5. Template variables ({{step2.data}}) → Should be skipped');

console.log('\n💡 Why This Works:');
console.log('  - NO hardcoded list of parameters');
console.log('  - NO hardcoded keywords');
console.log('  - ONLY structural rules:');
console.log('    1. Is it in .params? → User configurable');
console.log('    2. Is it in .config.condition.*.value? → Business logic');
console.log('    3. Everything else → Skip');

console.log('\n🚀 To run actual test, use TypeScript:');
console.log('  import { HardcodeDetector } from "./lib/pilot/shadow/HardcodeDetector"');
console.log('  const detector = new HardcodeDetector()');
console.log('  const result = detector.detect(realAgentSteps)');
console.log('  console.log(JSON.stringify(result, null, 2))');
