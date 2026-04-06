// Quick script to fix step 10's hardcoded range value
// Run with: node fix-step10-range.js

const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

async function fixStep10() {
  try {
    const response = await fetch(`http://localhost:3000/api/agents/${agentId}/fix-hardcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        stepId: 'step10',
        path: 'range',
        newValue: 'UrgentEmails1'
      })
    });

    const result = await response.json();
    console.log('Response status:', response.status);
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ Step 10 updated successfully! Now retry the calibration.');
    } else {
      console.error('\n❌ Failed to update step 10:', result.error);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

fixStep10();
