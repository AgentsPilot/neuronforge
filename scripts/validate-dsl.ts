/**
 * DSL Validation Script
 *
 * Validates that the generated DSL from the expense workflow test
 * conforms to the PILOT DSL schema and is ready for execution.
 */

// Sample DSL from the user's expense workflow test
const generatedDSL = [
  {
    "step_id": "fetch_emails_1",
    "type": "action",
    "plugin": "gmail",
    "operation": "fetch_emails",
    "config": {
      "query": "has:attachment"
    },
    "output_variable": "emails"
  },
  {
    "step_id": "filter_1",
    "type": "transform",
    "operation": "filter",
    "input": "{{emails}}",
    "config": {
      "field": "subject",
      "operator": "contains",
      "value": "expenses"
    },
    "output_variable": "filtered_1"
  },
  {
    "step_id": "filter_2",
    "type": "transform",
    "operation": "filter",
    "input": "{{filtered_1}}",
    "config": {
      "field": "subject",
      "operator": "contains",
      "value": "receipt"
    },
    "output_variable": "filtered_2"
  },
  {
    "step_id": "filter_3",
    "type": "transform",
    "operation": "filter",
    "input": "{{filtered_2}}",
    "config": {
      "field": "date",
      "operator": "within_last_days",
      "value": 7
    },
    "output_variable": "filtered_emails"
  },
  {
    "step_id": "extract_pdfs_1",
    "type": "transform",
    "operation": "map",
    "input": "{{filtered_emails}}",
    "config": {
      "extract": "attachments",
      "filter": {
        "field": "type",
        "operator": "equals",
        "value": "application/pdf"
      }
    },
    "output_variable": "pdf_attachments"
  },
  {
    "step_id": "scatter_1",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{pdf_attachments}}",
      "itemVariable": "pdf",
      "maxConcurrency": 3,
      "actions": [
        {
          "step_id": "ai_extract_1",
          "type": "ai_processing",
          "operation": "extract",
          "config": {
            "instruction": "Extract expense line items from this PDF receipt including vendor, amount, date, and expense type",
            "context": "{{pdf}}",
            "output_schema": {
              "type": "object",
              "fields": [
                { "name": "date", "type": "string", "required": true },
                { "name": "vendor", "type": "string", "required": true },
                { "name": "amount", "type": "string", "required": true },
                { "name": "expense_type", "type": "string", "required": true }
              ]
            },
            "constraints": {
              "max_tokens": 500,
              "temperature": 0.3,
              "model_preference": "balanced"
            }
          },
          "output_variable": "extracted_expense"
        }
      ]
    },
    "gather": {
      "operation": "collect",
      "outputKey": "all_expenses"
    },
    "output_variable": "gathered_expenses"
  },
  {
    "step_id": "render_table_1",
    "type": "transform",
    "operation": "map",
    "input": "{{gathered_expenses}}",
    "config": {
      "type": "email_embedded_table",
      "columns_in_order": ["date", "vendor", "amount", "expense_type"],
      "empty_message": "No expenses found"
    },
    "output_variable": "rendered_table"
  },
  {
    "step_id": "send_email_1",
    "type": "action",
    "plugin": "gmail",
    "operation": "send_email",
    "config": {
      "to": "offir.omer@gmail.com",
      "subject": "Expense Report Summary",
      "body": "{{rendered_table}}"
    },
    "output_variable": "email_sent"
  }
];

/**
 * Validation Checks
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalSteps: number;
    stepTypes: Record<string, number>;
    hasLoops: boolean;
    hasAI: boolean;
    variableFlow: string[];
  };
}

function validateDSL(dsl: any[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stepTypes: Record<string, number> = {};
  const variableFlow: string[] = [];
  let hasLoops = false;
  let hasAI = false;

  console.log('='.repeat(80));
  console.log('DSL VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log();

  // Check each step
  dsl.forEach((step, index) => {
    console.log(`\n--- Step ${index + 1}: ${step.step_id} ---`);
    console.log(`Type: ${step.type}`);

    // Required fields check
    if (!step.step_id) {
      errors.push(`Step ${index + 1}: Missing step_id`);
    }
    if (!step.type) {
      errors.push(`Step ${index + 1}: Missing type`);
    }

    // Track step types
    stepTypes[step.type] = (stepTypes[step.type] || 0) + 1;

    // Check for loops
    if (step.type === 'scatter_gather' || step.type === 'loop') {
      hasLoops = true;
      console.log(`✓ Loop detected: ${step.type}`);

      // Validate scatter_gather structure
      if (step.type === 'scatter_gather') {
        if (!step.scatter) {
          errors.push(`${step.step_id}: scatter_gather missing 'scatter' config`);
        } else {
          if (!step.scatter.input) {
            errors.push(`${step.step_id}: scatter.input is required`);
          }
          if (!step.scatter.actions || step.scatter.actions.length === 0) {
            errors.push(`${step.step_id}: scatter.actions is required and must have at least one action`);
          } else {
            console.log(`  - Scattering over: ${step.scatter.input}`);
            console.log(`  - Actions in loop: ${step.scatter.actions.length}`);
            console.log(`  - Item variable: ${step.scatter.itemVariable || 'item'}`);
            console.log(`  - Max concurrency: ${step.scatter.maxConcurrency || 'unlimited'}`);
          }
        }

        if (!step.gather) {
          errors.push(`${step.step_id}: scatter_gather missing 'gather' config`);
        } else if (!step.gather.operation) {
          errors.push(`${step.step_id}: gather.operation is required`);
        }
      }
    }

    // Check for AI operations
    if (step.type === 'ai_processing') {
      hasAI = true;
      console.log(`✓ AI operation detected`);

      if (!step.config || !step.config.instruction) {
        errors.push(`${step.step_id}: ai_processing requires config.instruction`);
      }
      if (!step.config || !step.config.output_schema) {
        errors.push(`${step.step_id}: ai_processing requires config.output_schema`);
      }
    }

    // Check for nested AI in scatter-gather
    if (step.type === 'scatter_gather' && step.scatter?.actions) {
      step.scatter.actions.forEach((action: any, i: number) => {
        if (action.type === 'ai_processing') {
          hasAI = true;
          console.log(`✓ Nested AI operation in loop action ${i + 1}`);

          if (!action.config || !action.config.instruction) {
            errors.push(`${step.step_id}.actions[${i}]: ai_processing requires config.instruction`);
          }
        }
      });
    }

    // Track variable flow
    if (step.output_variable) {
      variableFlow.push(`${step.step_id} → ${step.output_variable}`);
      console.log(`Output: {{${step.output_variable}}}`);
    }

    // Check variable references
    const stepStr = JSON.stringify(step);
    const varRefs = stepStr.match(/\{\{[^}]+\}\}/g) || [];
    if (varRefs.length > 0) {
      console.log(`Input variables: ${varRefs.join(', ')}`);
    }

    // Type-specific validations
    if (step.type === 'action') {
      if (!step.plugin) {
        errors.push(`${step.step_id}: action step requires 'plugin' field`);
      }
      if (!step.operation) {
        errors.push(`${step.step_id}: action step requires 'operation' field`);
      }
      console.log(`Plugin: ${step.plugin}, Operation: ${step.operation}`);
    }

    if (step.type === 'transform') {
      if (!step.operation) {
        errors.push(`${step.step_id}: transform step requires 'operation' field`);
      }
      if (!step.input) {
        warnings.push(`${step.step_id}: transform step should have 'input' field`);
      }
      console.log(`Transform operation: ${step.operation}`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log('✓ Step Types:');
  Object.entries(stepTypes).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log();

  console.log('✓ Variable Flow:');
  variableFlow.forEach(flow => {
    console.log(`  ${flow}`);
  });
  console.log();

  console.log('✓ Architecture Features:');
  console.log(`  - Has Loops: ${hasLoops ? '✓ YES' : '✗ NO'}`);
  console.log(`  - Has AI Processing: ${hasAI ? '✓ YES' : '✗ NO'}`);
  console.log(`  - Total Steps: ${dsl.length}`);
  console.log();

  if (errors.length > 0) {
    console.log('❌ ERRORS:');
    errors.forEach(err => console.log(`  - ${err}`));
    console.log();
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:');
    warnings.forEach(warn => console.log(`  - ${warn}`));
    console.log();
  }

  const valid = errors.length === 0;
  if (valid) {
    console.log('✅ DSL VALIDATION PASSED');
    console.log('   The workflow is ready for execution!');
  } else {
    console.log('❌ DSL VALIDATION FAILED');
    console.log(`   Found ${errors.length} error(s) that must be fixed`);
  }
  console.log();
  console.log('='.repeat(80));

  return {
    valid,
    errors,
    warnings,
    stats: {
      totalSteps: dsl.length,
      stepTypes,
      hasLoops,
      hasAI,
      variableFlow
    }
  };
}

// Run validation
const result = validateDSL(generatedDSL);

// Exit with appropriate code
process.exit(result.valid ? 0 : 1);
