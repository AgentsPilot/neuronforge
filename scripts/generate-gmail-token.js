// scripts/generate-gmail-token.js
// Run this once to get your Gmail refresh token

const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID = '921980058947-60n3cm2uso92kbn4n97a51gg4ufkc3pu.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:8080'; // Simple localhost redirect

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Step 1: Get authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
  prompt: 'consent' // Forces refresh token
});

console.log('🚀 Gmail OAuth Setup');
console.log('==================');
console.log('1. Open this URL in your browser:');
console.log(authUrl);
console.log('\n2. Grant permissions');
console.log('3. You\'ll be redirected to localhost:8080 with a code in the URL');
console.log('4. Copy the code from the URL and paste it below:\n');
console.log('The URL will look like: http://localhost:8080?code=YOUR_CODE_HERE');
console.log('Just copy the code part after "code=" \n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter the authorization code: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('\n✅ Success! Here are your tokens:');
    console.log('================================');
    console.log('Add these to your .env.local:');
    console.log('');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('');
    console.log('Your contact form will now send emails! 🎉');
    
  } catch (error) {
    console.error('❌ Error getting tokens:', error);
  }
  
  rl.close();
});