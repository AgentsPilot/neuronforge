/**
 * Quick test to verify AWS Textract connection
 */
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';

async function testTextract() {
  console.log('Testing AWS Textract connection...\n');

  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  console.log('Configuration:');
  console.log(`  Region: ${region}`);
  console.log(`  Access Key: ${accessKeyId?.substring(0, 8)}...`);
  console.log(`  Secret Key: ${secretAccessKey ? '***configured***' : 'MISSING'}`);
  console.log('');

  if (!accessKeyId || !secretAccessKey) {
    console.error('ERROR: AWS credentials not configured');
    process.exit(1);
  }

  const client = new TextractClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // Create a minimal test image (1x1 white PNG)
  const minimalPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  try {
    console.log('Sending test request to Textract...');

    const command = new DetectDocumentTextCommand({
      Document: {
        Bytes: minimalPng,
      },
    });

    const response = await client.send(command);
    console.log('\n✅ SUCCESS! Textract is working.');
    console.log(`   Blocks returned: ${response.Blocks?.length || 0}`);

  } catch (error: any) {
    console.log('\n❌ ERROR:');
    console.log(`   Name: ${error.name}`);
    console.log(`   Message: ${error.message}`);
    console.log(`   Code: ${error.$metadata?.httpStatusCode || 'N/A'}`);

    if (error.name === 'SubscriptionRequiredException') {
      console.log('\n📋 FIX: Your AWS account needs Textract activated.');
      console.log('   1. Go to: https://us-east-1.console.aws.amazon.com/textract/home');
      console.log('   2. Click "Try Amazon Textract" or "Get Started"');
      console.log('   3. Run any demo analysis to activate the service');
      console.log('   4. Re-run this test');
    } else if (error.name === 'InvalidSignatureException' || error.name === 'UnrecognizedClientException') {
      console.log('\n📋 FIX: Check your AWS credentials in .env.local');
    } else if (error.name === 'AccessDeniedException') {
      console.log('\n📋 FIX: IAM user needs textract:DetectDocumentText permission');
    }
  }
}

testTextract();
