/**
 * Quick script to check the agent workflow JSON in the database
 *
 * Usage:
 * 1. Go to your Supabase SQL Editor
 * 2. Run this query:
 *
 * SELECT
 *   id,
 *   name,
 *   workflow_definition->'workflow' as workflow_steps
 * FROM agents
 * WHERE name ILIKE '%expense%'
 * ORDER BY created_at DESC
 * LIMIT 1;
 *
 * 3. Copy the workflow_steps JSON and paste it below
 * 4. Run: node check-agent-workflow.js
 */

const workflowJson = {
  // PASTE YOUR WORKFLOW JSON HERE
};

console.log('=== WORKFLOW ANALYSIS ===\n');

// Check each step
const steps = Object.entries(workflowJson);
console.log(`Total steps: ${steps.length}\n`);

steps.forEach(([stepId, step]) => {
  console.log(`Step: ${stepId}`);
  console.log(`  Type: ${step.type}`);

  if (step.type === 'scatter_gather') {
    console.log(`  Scatter input: ${step.scatter?.input}`);
    console.log(`  ❌ PROBLEM: Should be {{step1.data.emails}} not {{step1.emails}}`);
  }

  if (step.type === 'transform') {
    console.log(`  Transform input: ${step.input}`);
    if (step.input?.includes('.data.')) {
      console.log(`  ✅ Looks correct`);
    } else {
      console.log(`  ❌ PROBLEM: Missing .data accessor`);
    }
  }

  if (step.executeIf) {
    console.log(`  ⚠️  Has executeIf condition: ${JSON.stringify(step.executeIf)}`);
  }

  console.log('');
});

console.log('\n=== VARIABLE REFERENCE CHECKS ===\n');

// Check for common issues
const jsonStr = JSON.stringify(workflowJson);
const issues = [];

// Check for missing .data
const stepRefs = jsonStr.match(/\{\{step\d+\.[^}]+\}\}/g) || [];
stepRefs.forEach(ref => {
  if (!ref.includes('.data.') && !ref.includes('.data}}')) {
    issues.push(`❌ Missing .data in: ${ref}`);
  }
});

if (issues.length === 0) {
  console.log('✅ No obvious variable reference issues found');
} else {
  issues.forEach(issue => console.log(issue));
}
