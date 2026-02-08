// Test the ExecutionResultsBuilder logic with the actual final_output data

const finalOutput = {
  "step1": {
    "emails": {
      "type": "array",
      "count": 10,
      "sample_keys": ["id", "thread_id", "subject", "from", "to"]
    },
    "searched_at": "2026-02-03T04:45:37.801Z",
    "total_found": 10,
    "search_query": "in:inbox newer_than:7d in:inbox",
    "total_available": 201
  },
  "step2": {
    "range": "UrgentEmails1!A1:BE1366",
    "values": {
      "type": "array",
      "count": 4,
      "sample_keys": ["0", "1", "2", "3", "4"]
    },
    "row_count": 4,
    "column_count": 5,
    "retrieved_at": "2026-02-03T04:45:38.852Z",
    "major_dimension": "ROWS"
  },
  "step10": {
    "values": {
      "type": "array",
      "count": 0,
      "sample_keys": []
    },
    "sheet_name": "UrgentEmails1",
    "appended_at": "2026-02-03T04:45:44.224Z",
    "table_range": "UrgentEmails1!A1:E4",
    "appended_rows": 0,
    "updated_range": "UrgentEmails1!A5",
    "appended_cells": 0,
    "appended_columns": 0
  }
};

const executionTrace = {
  stepExecutions: [
    {
      stepId: 'step1',
      plugin: 'google-mail',
      action: 'search_emails',
      metadata: { stepName: 'Fetch Gmail messages', success: true }
    },
    {
      stepId: 'step2',
      plugin: 'google-sheets',
      action: 'read_range',
      metadata: { stepName: 'Read existing emails', success: true }
    },
    {
      stepId: 'step10',
      plugin: 'google-sheets',
      action: 'append_rows',
      metadata: { stepName: 'Append to spreadsheet', success: true }
    }
  ]
};

// Simulate the analyzeStepOutput logic
function analyzeStepOutput(stepId, plugin, action, stepName, stepOutput, success) {
  let dataType = 'unknown';
  let itemCount = 0;
  let sampleKeys = undefined;

  if (stepOutput && typeof stepOutput === 'object') {
    // Look for arrays with count metadata
    const arrayFields = Object.values(stepOutput).filter(
      v => v && v.type === 'array' && typeof v.count === 'number'
    );

    if (arrayFields.length > 0) {
      // Sum up all array counts
      itemCount = arrayFields.reduce((sum, field) => sum + field.count, 0);
      dataType = 'array';

      // Get sample keys from first array field
      const firstArray = arrayFields[0];
      if (firstArray.sample_keys && Array.isArray(firstArray.sample_keys)) {
        sampleKeys = firstArray.sample_keys.slice(0, 5);
      }
    } else if (stepOutput.count !== undefined) {
      itemCount = stepOutput.count || 0;
      dataType = 'object';
    }
  }

  return {
    stepId,
    stepName,
    plugin,
    action,
    itemCount,
    dataType,
    sampleKeys,
    status: success ? 'success' : 'error',
  };
}

// Build execution results
const items = [];
let totalItems = 0;

for (const stepExec of executionTrace.stepExecutions) {
  const stepId = stepExec.stepId;
  const stepOutput = finalOutput[stepId];

  if (!stepOutput) continue;

  const item = analyzeStepOutput(
    stepId,
    stepExec.plugin,
    stepExec.action,
    stepExec.metadata?.stepName || stepId,
    stepOutput,
    stepExec.metadata?.success !== false
  );

  items.push(item);
  totalItems += item.itemCount;
}

// Generate summary
const successfulSteps = items.filter(i => i.status === 'success').length;
const totalSteps = items.length;
const summary = totalItems === 0
  ? `Completed ${successfulSteps}/${totalSteps} steps`
  : `Processed ${totalItems} items across ${successfulSteps}/${totalSteps} steps`;

const executionResults = {
  summary,
  items,
  totalItems,
  totalSteps,
  metadata: {
    executionTime: 4433,
    stepsCompleted: 10,
    tokensUsed: 1200,
  },
};

console.log('📊 Execution Results:');
console.log(JSON.stringify(executionResults, null, 2));

console.log('\n\n✅ Verification:');
console.log(`Summary: "${executionResults.summary}"`);
console.log(`Total Items: ${executionResults.totalItems}`);
console.log(`Total Steps: ${executionResults.totalSteps}`);

console.log('\n📋 Items Breakdown:');
executionResults.items.forEach((item, i) => {
  console.log(`  ${i + 1}. ${item.stepName}`);
  console.log(`     Plugin: ${item.plugin}, Action: ${item.action}`);
  console.log(`     Items: ${item.itemCount}, Type: ${item.dataType}`);
  console.log(`     Sample Keys: ${item.sampleKeys?.join(', ') || 'N/A'}`);
  console.log('');
});
