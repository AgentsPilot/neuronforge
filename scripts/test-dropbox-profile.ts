// Test Dropbox profile fetch
// Run with: npx tsx scripts/test-dropbox-profile.ts

async function testDropboxProfile() {
  // You need to paste a valid Dropbox access token here
  const accessToken = 'PASTE_YOUR_ACCESS_TOKEN_HERE';

  console.log('Testing Dropbox profile fetch...\n');

  // Test 1: POST with null body
  console.log('Test 1: POST with JSON null body');
  try {
    const response1 = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(null)
    });

    console.log('Status:', response1.status);
    if (response1.ok) {
      const data = await response1.json();
      console.log('Success! Profile:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response1.text();
      console.log('Error:', errorText);
    }
  } catch (error: any) {
    console.log('Exception:', error.message);
  }

  console.log('\n---\n');

  // Test 2: POST with no body
  console.log('Test 2: POST with no body');
  try {
    const response2 = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log('Status:', response2.status);
    if (response2.ok) {
      const data = await response2.json();
      console.log('Success! Profile:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response2.text();
      console.log('Error:', errorText);
    }
  } catch (error: any) {
    console.log('Exception:', error.message);
  }
}

testDropboxProfile();
