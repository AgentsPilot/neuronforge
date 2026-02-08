require('dotenv').config({ path: '.env.local' });

// Simple test to see what the situation analysis would say
const workflowContext = "Scan the user's Gmail Inbox for the last 7 days, identify complaint emails via case-insensitive keyword matching, and append new (deduplicated) complaint records into a specific Google Sheet tab with a fixed column order.";

const trends = {
  metric_value_recent: 0,
  metric_value_historical: 0.04,
  volume_change_7d: 0,
  empty_result_rate: 1.0
};

const contextLower = workflowContext.toLowerCase();

const trackingUndesirable =
  contextLower.includes('complaint') ||
  contextLower.includes('error') ||
  contextLower.includes('issue');

console.log('SITUATION ANALYSIS:\n');
console.log('Workflow context: ' + workflowContext.substring(0, 100) + '...');
console.log('Tracking undesirable: ' + trackingUndesirable);
console.log('Metric value recent: ' + trends.metric_value_recent);
console.log('Metric value historical: ' + trends.metric_value_historical);
console.log('Empty result rate: ' + (trends.empty_result_rate * 100) + '%');
console.log('\nINTERPRETATION:');

if (trackingUndesirable && trends.metric_value_recent <= 1) {
  console.log('HEALTHY STATE: Tracking complaints, finding ' + trends.metric_value_recent + ' items');
  console.log('Since tracking UNDESIRABLE things, zero is EXCELLENT news');
  console.log('Recommendation: Generate ZERO insights (or celebratory low-severity)');
} else {
  console.log('Would generate standard insight');
}
