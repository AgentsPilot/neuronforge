// Check the third upgrade invoice
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkInvoice() {
  const invoiceId = 'in_1SQcpq56GTXD0wwiiwigCUlf';

  console.log('🔍 Fetching invoice:', invoiceId);
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['lines.data', 'subscription']
  });

  console.log('\n📋 Invoice Summary:');
  console.log('  Status:', invoice.status);
  console.log('  Amount due:', invoice.amount_due, 'cents = $' + (invoice.amount_due / 100));
  console.log('  Amount paid:', invoice.amount_paid, 'cents = $' + (invoice.amount_paid / 100));
  console.log('  Total:', invoice.total, 'cents = $' + (invoice.total / 100));
  console.log('  Subtotal:', invoice.subtotal, 'cents = $' + (invoice.subtotal / 100));

  console.log('\n📦 Line Items:');
  invoice.lines.data.forEach((line, i) => {
    console.log(`\nItem ${i + 1}:`);
    console.log('  Description:', line.description);
    console.log('  Amount:', line.amount, 'cents = $' + (line.amount / 100));
    console.log('  Period:', {
      start: new Date(line.period.start * 1000).toISOString(),
      end: new Date(line.period.end * 1000).toISOString()
    });
  });

  console.log('\n💡 Analysis:');
  const lineTotal = invoice.lines.data.reduce((sum, line) => sum + line.amount, 0);
  console.log('  Sum of line items:', lineTotal, 'cents = $' + (lineTotal / 100));
  console.log('  Why amount_paid is $0:', lineTotal < 0 ? 'Net negative - Stripe shows as $0' : 'Unknown');
}

checkInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
