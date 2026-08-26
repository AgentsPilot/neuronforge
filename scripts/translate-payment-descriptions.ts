/**
 * Translate English payment descriptions to Hebrew
 * Run this script to update test/mockup payment data
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function translatePaymentDescriptions() {
  console.log('Fetching payment transactions...');

  // Fetch all payments
  const { data: payments, error } = await supabase
    .from('payment_transactions')
    .select('id, description, payment_method')
    .not('description', 'is', null);

  if (error) {
    console.error('Error fetching payments:', error);
    return;
  }

  console.log(`Found ${payments.length} payment transactions`);

  const hebrewRegex = /[\u0590-\u05FF]/;
  const descriptionsToUpdate = payments.filter(p => !hebrewRegex.test(p.description));

  console.log(`${descriptionsToUpdate.length} payment descriptions need translation`);

  let descUpdated = 0;
  let methodUpdated = 0;

  // Update descriptions
  for (const payment of descriptionsToUpdate) {
    const desc = payment.description.toLowerCase();
    let hebrewDesc = payment.description;

    // Translate common patterns
    if (desc.includes('failed payment') || desc.includes('payment failed')) {
      hebrewDesc = 'תשלום שנכשל';
    } else if (desc.includes('failed charge')) {
      hebrewDesc = 'חיוב שנכשל';
    } else if (desc.includes('service payment') || desc.includes('payment for service')) {
      hebrewDesc = 'תשלום עבור שירות';
    } else if (desc.includes('booking payment')) {
      hebrewDesc = 'תשלום עבור הזמנה';
    } else if (desc.includes('session payment')) {
      hebrewDesc = 'תשלום עבור פגישה';
    } else if (desc.includes('consultation')) {
      hebrewDesc = 'תשלום עבור ייעוץ עסקי';
    } else if (desc.includes('coaching')) {
      hebrewDesc = 'תשלום עבור קואצינג';
    } else if (desc.includes('workshop')) {
      hebrewDesc = 'תשלום עבור סדנה';
    } else if (desc.includes('refund')) {
      hebrewDesc = 'תשלום שהוחזר';
    } else if (desc.includes('pending')) {
      hebrewDesc = 'ממתין לאישור';
    } else if (desc.includes('awaiting')) {
      hebrewDesc = 'ממתין להעברה';
    } else if (desc.includes('payment')) {
      hebrewDesc = 'תשלום';
    }

    if (hebrewDesc !== payment.description) {
      const { error: updateError } = await supabase
        .from('payment_transactions')
        .update({ description: hebrewDesc })
        .eq('id', payment.id);

      if (updateError) {
        console.error(`Error updating payment ${payment.id}:`, updateError);
      } else {
        console.log(`Description updated: "${payment.description}" → "${hebrewDesc}"`);
        descUpdated++;
      }
    }
  }

  // Update payment methods
  const paymentMethodMap: Record<string, string> = {
    'card': 'כרטיס אשראי',
    'credit_card': 'כרטיס אשראי',
    'debit_card': 'כרטיס חיוב',
    'bank_transfer': 'העברה בנקאית',
    'wire_transfer': 'העברה בנקאית',
    'bit': 'ביט',
    'paypal': 'פייפאל',
    'cash': 'מזומן',
    'check': 'צ\'ק',
    'cheque': 'צ\'ק'
  };

  for (const payment of payments) {
    const method = payment.payment_method?.toLowerCase();
    if (method && paymentMethodMap[method]) {
      const hebrewMethod = paymentMethodMap[method];

      const { error: updateError } = await supabase
        .from('payment_transactions')
        .update({ payment_method: hebrewMethod })
        .eq('id', payment.id);

      if (updateError) {
        console.error(`Error updating payment method for ${payment.id}:`, updateError);
      } else {
        console.log(`Payment method updated: "${payment.payment_method}" → "${hebrewMethod}"`);
        methodUpdated++;
      }
    }
  }

  console.log(`\nUpdated ${descUpdated} payment descriptions to Hebrew`);
  console.log(`Updated ${methodUpdated} payment methods to Hebrew`);
}

translatePaymentDescriptions()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
