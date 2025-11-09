// scripts/retry-webhook.ts
// Manually trigger webhook by calling the API with invoice data

async function retryWebhook() {
  const invoiceId = 'in_1SQFLY56GTXD0wwicooEjXNO';

  console.log('🔄 Retrying webhook for invoice:', invoiceId);
  console.log('⚠️  Make sure your dev server is running on http://localhost:3000\n');

  const response = await fetch('http://localhost:3000/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'test_signature'
    },
    body: JSON.stringify({
      type: 'invoice.paid',
      data: {
        object: {
          id: invoiceId,
          object: 'invoice',
          subscription: 'sub_1SQFLa56GTXD0wwiwdS9QqmU',
          customer: 'cus_xxxxx',
          amount_paid: 480,
          currency: 'usd',
          status: 'paid',
          metadata: {},
          lines: {
            data: [
              {
                period: {
                  start: Math.floor(Date.now() / 1000),
                  end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                }
              }
            ]
          }
        }
      }
    })
  });

  if (response.ok) {
    console.log('✅ Webhook triggered successfully');
    const data = await response.json();
    console.log('Response:', data);
  } else {
    console.error('❌ Webhook failed');
    console.error('Status:', response.status);
    const text = await response.text();
    console.error('Response:', text);
  }

  console.log('\n📝 Verify with: npx ts-node scripts/check-subscription-details.ts');
}

retryWebhook().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
