import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectLogs() {
  const { data } = await supabase
    .from('audit_trail')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n📋 Sample Audit Logs:\n');
  console.log('='.repeat(100));

  data?.forEach((log, i) => {
    console.log(`\n${i + 1}. ${log.action} (${log.created_at})`);
    console.log('   Entity:', log.entity_type, '-', log.resource_name);
    console.log('   Severity:', log.severity);

    if (log.details) {
      console.log('   Details keys:', Object.keys(log.details).join(', '));
    }

    if (log.changes) {
      console.log('   Changes keys:', Object.keys(log.changes).join(', '));
    }

    console.log('\n   Full structure:');
    console.log('   ' + JSON.stringify(log, null, 2).split('\n').join('\n   ').substring(0, 800));
    console.log('\n' + '-'.repeat(100));
  });

  process.exit(0);
}

inspectLogs();
