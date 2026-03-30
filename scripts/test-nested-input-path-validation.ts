import { WorkflowValidator } from '../lib/pilot/WorkflowValidator';

// Simulate a workflow with nested input path
const workflow = [
  {
    id: 'step1',
    step_id: 'step1',
    type: 'action',
    output_variable: 'matching_emails',
    output_schema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subject: { type: 'string' },
              labels: {
                type: 'array',
                items: { type: 'string' }
              },
              attachments: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    filename: { type: 'string' },
                    mimeType: { type: 'string' },
                    size: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  {
    id: 'step2',
    step_id: 'step2',
    type: 'transform',
    operation: 'flatten',
    input: '{{matching_emails.emails}}', // Already drills down to emails array
    description: 'Extract all PDF attachments from each email',
    config: {
      type: 'flatten',
      field: 'emails.attachments', // WRONG - should just be "attachments"
      depth: 1
    }
  }
];

console.log('=== Testing Nested Input Path Resolution ===\n');

const validator = new WorkflowValidator();
const issues = validator.validateFlattenFields(workflow);

console.log(`Found ${issues.length} issue(s):\n`);

if (issues.length > 0) {
  issues.forEach((issue, i) => {
    console.log(`Issue ${i + 1}:`);
    console.log(`  Step: ${issue.stepId}`);
    console.log(`  Current field: "${issue.currentField}"`);
    console.log(`  Suggested field: "${issue.suggestedField}"`);
    console.log(`  Confidence: ${issue.confidence}`);
    console.log(`  Upstream step: ${issue.upstreamStep}`);
    console.log(`  Reason: ${issue.reason}`);
    console.log();
  });

  // Check if the suggestion is correct
  const firstIssue = issues[0];
  if (firstIssue.suggestedField === 'attachments') {
    console.log('✅ VALIDATION WORKING - Correctly suggests "attachments" (not "emails.attachments")');
    console.log('   The validator properly resolved {{matching_emails.emails}} to the email items schema');
  } else {
    console.log(`❌ VALIDATION FAILED - Suggested "${firstIssue.suggestedField}" instead of "attachments"`);
    console.log('   The validator did not properly resolve the nested input path');
  }
} else {
  console.log('❌ NO ISSUES DETECTED - Validator should have flagged "emails.attachments" as incorrect');
}
