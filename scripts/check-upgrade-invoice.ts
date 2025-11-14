// Check the upgrade invoice details
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkInvoice() {
  const invoiceId = 'in_1SQcek56GTXD0wwi5Ph4s502'; // Latest upgrade invoice

  console.log('🔍 Fetching invoice:', invoiceId);
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['lines.data']
  });

  console.log('\n📋 Invoice Summary:');
  console.log('  Invoice ID:', invoice.id);
  console.log('  Status:', invoice.status);
  console.log('  Amount due:', invoice.amount_due, 'cents = $' + (invoice.amount_due / 100));
  console.log('  Amount paid:', invoice.amount_paid, 'cents = $' + (invoice.amount_paid / 100));
  console.log('  Total:', invoice.total, 'cents = $' + (invoice.total / 100));

  console.log('\n📦 Line Items:');
  let totalLineItems = 0;
  invoice.lines.data.forEach((line, i) => {
    console.log(`\nItem ${i + 1}:`);
    console.log('  Description:', line.description);
    console.log('  Amount:', line.amount, 'cents = $' + (line.amount / 100));
    console.log('  Proration:', line.proration);
    totalLineItems += line.amount;
  });

  console.log('\n📊 Calculation:');
  console.log('  Sum of line items:', totalLineItems, 'cents = $' + (totalLineItems / 100));
  console.log('  Invoice total:', invoice.total, 'cents = $' + (invoice.total / 100));
  console.log('  ✅ Match:', totalLineItems === invoice.total);

  console.log('\n💰 Customer View:');
  console.log('  What customer sees in invoice:', invoice.hosted_invoice_url);
  console.log('  Amount customer paid: $' + (invoice.amount_paid / 100));
}

checkInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
