// Check existing transaction types
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTransactionTypes() {
  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('transaction_type')
      .limit(100);

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    const uniqueTypes = [...new Set(data?.map(t => t.transaction_type) || [])];
    console.log('\n📋 Existing Transaction Types:');
    uniqueTypes.forEach(type => console.log(`  - ${type}`));

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkTransactionTypes().then(() => process.exit(0));
