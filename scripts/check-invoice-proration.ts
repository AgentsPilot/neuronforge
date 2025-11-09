// Check if an invoice has proration and calculate credits
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkInvoice() {
  const invoiceId = 'in_1SQc1F56GTXD0wwipaDWJPKq'; // The second upgrade invoice

  console.log('🔍 Fetching invoice:', invoiceId);
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['lines.data']
  });

  console.log('\n📋 Invoice Details:');
  console.log('Amount paid:', invoice.amount_paid, 'cents = $' + (invoice.amount_paid / 100));
  console.log('Status:', invoice.status);
  console.log('Subscription:', invoice.subscription);

  console.log('\n📦 Line Items:');
  invoice.lines.data.forEach((line, i) => {
    console.log(`\nItem ${i + 1}:`);
    console.log('  Description:', line.description);
    console.log('  Amount:', line.amount, 'cents');
    console.log('  Proration:', line.proration);
    console.log('  Period:', {
      start: line.period?.start ? new Date(line.period.start * 1000).toISOString() : 'N/A',
      end: line.period?.end ? new Date(line.period.end * 1000).toISOString() : 'N/A'
    });
  });

  // Check if this is a prorated invoice
  const hasProration = invoice.lines.data.some(line => line.proration === true);
  console.log('\n🔄 Has Proration:', hasProration);

  if (hasProration) {
    const amountPaidUsd = invoice.amount_paid / 100;
    const pilotCreditCostUsd = 0.00048;
    const pilotCredits = Math.floor(amountPaidUsd / pilotCreditCostUsd);
    const tokens = pilotCredits * 10;

    console.log('\n💰 Prorated Credit Calculation:');
    console.log('  Amount paid: $' + amountPaidUsd.toFixed(2));
    console.log('  Pilot Credit cost: $' + pilotCreditCostUsd);
    console.log('  Pilot Credits: ' + pilotCredits.toLocaleString());
    console.log('  Tokens: ' + tokens.toLocaleString());
  }

  // Check metadata
  console.log('\n📝 Invoice Metadata:', invoice.metadata);
  console.log('Payment Intent:', invoice.payment_intent);
}

checkInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
