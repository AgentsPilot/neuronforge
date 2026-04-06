// Simulate what the LLM would receive

const workflowContext = "Scan the user's Gmail Inbox for the last 7 days, identify complaint emails via case-insensitive keyword matching";

const trends = {
  metric_value_recent: 0,
  metric_value_historical: 0.04,
  empty_result_rate: 1.0,
  volume_change_7d: 0,
  duration_change_7d: -0.1
};

const detectedPatterns = [
  {
    insight_type: 'data_unavailable',
    severity: 'critical',
    confidence_score: 0.95,
    execution_ids: ['id1', 'id2'],
    pattern_data: { empty_result_rate: 1.0 }
  }
];

console.log('SIMULATED LLM PROMPT PREVIEW:\n');
console.log('Workflow: ' + workflowContext);
console.log('Metric value: ' + trends.metric_value_recent);
console.log('Empty result rate: ' + (trends.empty_result_rate * 100) + '%');
console.log('Technical pattern: ' + detectedPatterns[0].insight_type + ' (' + detectedPatterns[0].severity + ')');

console.log('\nSITUATION ANALYSIS WOULD SAY:');
console.log('- Tracking complaints: YES');
console.log('- Finding 0 items: YES');
console.log('- Has data_unavailable pattern: YES');
console.log('- Interpretation: HEALTHY STATE + FALSE ALARM');

console.log('\nEXPECTED LLM OUTPUT:');
console.log('Option 1: {"insights": []} - No insight needed, healthy state');
console.log('Option 2: Low severity celebratory insight about no complaints');

console.log('\nACTUAL OUTPUT: {"insights": []} - LLM chose option 1');

console.log('\nQUESTION: Should we FORCE at least one insight?');
console.log('- Pro: User sees something in UI, confirms system is working');
console.log('- Con: Creates noise when nothing actionable to report');
