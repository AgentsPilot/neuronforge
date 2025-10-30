/**
 * Create a system admin user for audit trail logging
 * This user will be used for all system-level audit events
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function createSystemAdminUser() {
  console.log('\n🔧 Creating System Admin User for Audit Trail\n');
  console.log('='.repeat(80));

  const SYSTEM_ADMIN_EMAIL = 'system-admin@neuronforge.internal';
  const SYSTEM_ADMIN_PASSWORD = crypto.randomUUID(); // Random password, won't be used

  try {
    // Check if system admin already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const systemAdmin = existingUsers?.users.find(u => u.email === SYSTEM_ADMIN_EMAIL);

    if (systemAdmin) {
      console.log('✅ System admin user already exists!');
      console.log(`   User ID: ${systemAdmin.id}`);
      console.log(`   Email: ${systemAdmin.email}`);
      console.log(`   Created: ${systemAdmin.created_at}`);

      // Test if we can use this user_id in audit_trail
      console.log('\n🧪 Testing audit trail insert with system admin user_id...\n');

      const { data, error } = await supabase
        .from('audit_trail')
        .insert({
          action: 'TEST_SYSTEM_ADMIN_USER',
          entity_type: 'test',
          severity: 'info',
          user_id: systemAdmin.id,
          details: { test: 'Using system admin user_id' }
        })
        .select();

      if (error) {
        console.log('❌ FAILED:', error.message);
        console.log('   This means the issue is NOT about user existence.');
      } else {
        console.log('✅ SUCCESS! System admin user_id works for audit logs!');
        console.log('   Log created:', data[0].id);

        // Clean up test log
        await supabase.from('audit_trail').delete().eq('action', 'TEST_SYSTEM_ADMIN_USER');
      }

      console.log('\n📝 Add this to your .env.local:');
      console.log(`SYSTEM_ADMIN_USER_ID=${systemAdmin.id}`);

      return systemAdmin.id;
    }

    // Create system admin user
    console.log('Creating new system admin user...\n');

    const { data, error } = await supabase.auth.admin.createUser({
      email: SYSTEM_ADMIN_EMAIL,
      password: SYSTEM_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'system_admin',
        full_name: 'System Administrator',
        is_system_user: true,
        description: 'Internal system user for audit trail and system operations'
      }
    });

    if (error) {
      console.error('❌ Failed to create system admin:', error);
      throw error;
    }

    console.log('✅ System admin user created successfully!');
    console.log(`   User ID: ${data.user?.id}`);
    console.log(`   Email: ${data.user?.email}`);

    // Test audit trail insert
    console.log('\n🧪 Testing audit trail insert with new system admin user_id...\n');

    const { data: testLog, error: testError } = await supabase
      .from('audit_trail')
      .insert({
        action: 'SYSTEM_ADMIN_USER_CREATED',
        entity_type: 'system',
        entity_id: data.user?.id,
        severity: 'info',
        user_id: data.user?.id,
        details: {
          email: SYSTEM_ADMIN_EMAIL,
          purpose: 'System-level audit logging'
        }
      })
      .select();

    if (testError) {
      console.log('❌ FAILED to create audit log:', testError.message);
      console.log('   This means the issue persists even with a real user.');
    } else {
      console.log('✅ SUCCESS! Audit log created with system admin user_id!');
      console.log('   Log ID:', testLog[0].id);
    }

    console.log('\n📝 Add this to your .env.local:');
    console.log(`SYSTEM_ADMIN_USER_ID=${data.user?.id}`);

    console.log('\n✅ Setup complete!\n');

    return data.user?.id;

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

createSystemAdminUser().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
