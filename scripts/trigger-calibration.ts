import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  console.log('Triggering calibration for agent:', agentId);

  const response = await fetch(`http://localhost:3000/api/v2/calibrate/batch?agentId=${agentId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      maxIterations: 10
    })
  });

  if (!response.ok) {
    console.error('Calibration failed:', response.status, response.statusText);
    const text = await response.text();
    console.error('Response:', text);
    return;
  }

  const result = await response.json();
  console.log('\n=== Calibration Result ===');
  console.log('Status:', result.status);
  console.log('Session ID:', result.sessionId);
  console.log('Total iterations:', result.totalIterations);
  console.log('Fixes applied:', result.fixesApplied);
  console.log('Final status:', result.finalStatus);

  if (result.issuesFound && result.issuesFound.length > 0) {
    console.log('\n=== Issues Found ===');
    result.issuesFound.forEach((issue: any, index: number) => {
      console.log(`\n${index + 1}. ${issue.title || issue.type}`);
      console.log('   Auto-repair:', issue.autoRepairAvailable);
      if (issue.autoRepairProposal) {
        console.log('   Proposal:', issue.autoRepairProposal.type);
        console.log('   Confidence:', issue.autoRepairProposal.confidence);
      }
    });
  }
}

main().catch(console.error);
