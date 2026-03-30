import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find the most recent calibration execution
  const execution = await prisma.agentExecution.findFirst({
    where: {
      batchCalibrationMode: true,
    },
    orderBy: {
      startedAt: 'desc'
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
        }
      }
    }
  });

  if (!execution) {
    console.log('No calibration executions found');
    return;
  }

  console.log('\n=== LATEST CALIBRATION EXECUTION ===');
  console.log('ID:', execution.id);
  console.log('Agent:', execution.agent.name);
  console.log('Status:', execution.status);
  console.log('Started:', execution.startedAt);
  console.log('Completed:', execution.completedAt);
  console.log('Calibration Mode:', execution.batchCalibrationMode);

  // Parse the trace to see step outputs
  const trace = execution.trace as any;

  if (trace?.steps) {
    console.log('\n=== STEP EXECUTION SUMMARY ===');
    for (const step of trace.steps) {
      console.log(`\nStep: ${step.stepId} (${step.action})`);
      console.log(`Status: ${step.status}`);

      if (step.output) {
        const output = step.output;

        // For step6 (document-extractor), show extracted data
        if (step.stepId === 'step6' || step.action === 'deterministic_extract') {
          console.log('Output type:', typeof output);

          if (Array.isArray(output)) {
            console.log(`Extracted ${output.length} items`);
            if (output.length > 0) {
              console.log('First item:', JSON.stringify(output[0], null, 2).substring(0, 500));
            }
          } else if (output && typeof output === 'object') {
            console.log('Output keys:', Object.keys(output));
            if (output.items && Array.isArray(output.items)) {
              console.log(`Items count: ${output.items.length}`);
              if (output.items.length > 0) {
                console.log('First item:', JSON.stringify(output.items[0], null, 2).substring(0, 500));
              }
            }
          }
        }

        // For step11 (filter), show filter results
        if (step.stepId === 'step11' || step.action === 'filter') {
          console.log('Filter output:', JSON.stringify(output, null, 2).substring(0, 500));
        }

        // For final steps, show what was produced
        if (step.stepId === 'step15' || step.stepId === 'step16') {
          console.log('Output:', JSON.stringify(output, null, 2).substring(0, 500));
        }
      }

      if (step.error) {
        console.log('ERROR:', step.error);
      }
    }
  }

  // Check for collected issues
  if (trace?.collectedIssues && trace.collectedIssues.length > 0) {
    console.log('\n=== COLLECTED ISSUES ===');
    console.log(`Total issues: ${trace.collectedIssues.length}`);
    for (const issue of trace.collectedIssues) {
      console.log(`\n- ${issue.category}: ${issue.message}`);
      console.log(`  Affected steps: ${issue.affectedSteps?.map((s: any) => s.stepId).join(', ')}`);
    }
  }

  // Check final result
  if (execution.result) {
    console.log('\n=== FINAL RESULT ===');
    const result = execution.result as any;
    console.log(JSON.stringify(result, null, 2).substring(0, 1000));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
