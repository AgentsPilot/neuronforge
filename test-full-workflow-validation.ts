/**
 * Test WorkflowPostValidator with the actual generated workflow
 */

import { WorkflowPostValidator } from './lib/agentkit/v6/compiler/WorkflowPostValidator.ts';

// The actual workflow that was generated
const workflow = {
  workflow: [
    {
      "id": "step4",
      "name": "Extract existing Gmail message link/id column values from UrgentEmails sheet",
      "type": "transform",
      "operation": "map",
      "dependencies": ["step2"],
      "input": "{{step2.data.values}}",
      "config": {
        "expression": "item.slice(1).map(row => row[4] ?? '')"
      }
    },
    {
      "id": "step5",
      "name": "Deduplicate",
      "type": "scatter_gather",
      "dependencies": ["step3", "step4"],
      "scatter": {
        "input": "{{step3}}",
        "itemVariable": "email",
        "steps": [
          {
            "id": "step6",
            "type": "transform",
            "operation": "filter",
            "input": "{{step4.data}}",
            "config": { "condition": "item !== email.id" }
          }
        ]
      },
      "gather": { "operation": "collect" }
    },
    {
      "id": "step8",
      "type": "transform",
      "operation": "map",
      "dependencies": ["step5"],
      "input": "{{step5}}",
      "config": {
        "expression": "item.map(result => result && result.length ? result[0] : null).filter(x => x !== null)"
      }
    },
    {
      "id": "step9",
      "type": "transform",
      "operation": "map",
      "dependencies": ["step8"],
      "input": "{{step8}}",
      "config": {
        "expression": "item.map(email => [email.from ?? '', email.subject ?? ''])"
      }
    }
  ]
};

const validator = new WorkflowPostValidator({});

console.log('Testing full workflow validation...\n');

const result = validator.validate(workflow as any, false);

console.log('Validation Result:');
console.log('  Valid:', result.valid);
console.log('  Issues found:', result.issues.length);
console.log('\nIssues by step:');

const issuesByStep: Record<string, any[]> = {};
result.issues.forEach(issue => {
  if (!issuesByStep[issue.stepId]) {
    issuesByStep[issue.stepId] = [];
  }
  issuesByStep[issue.stepId].push(issue);
});

Object.entries(issuesByStep).forEach(([stepId, issues]) => {
  console.log(`\n${stepId}:`);
  issues.forEach(issue => {
    console.log(`  - ${issue.code} (${issue.severity})`);
    console.log(`    ${issue.message}`);
  });
});

console.log('\n\n✅ Expected: INVALID_MAP_LOGIC errors for steps 4, 8, and 9');
console.log('   All three use item.map() which is wrong - item is a single element!');
