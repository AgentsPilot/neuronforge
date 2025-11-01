import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function createSystemAdmin() {
  console.log('🔧 Setting up system admin user...\n');

  const email = 'admin@agentspilot.ai';
  const password = crypto.randomUUID(); // Random password, won't be used for login

  try {
    // Check if system admin already exists
    const { data: existingUser, error: checkError } = await supabase.auth.admin.listUsers();

    if (checkError) {
      console.error('❌ Error checking existing users:', checkError);
      process.exit(1);
    }

    const existing = existingUser.users.find(u => u.email === email);

    if (existing) {
      console.log('✅ System admin user already exists');
      console.log(`   User ID: ${existing.id}`);
      console.log(`   Email: ${existing.email}`);
      console.log(`\n📋 Add this to your .env.local file:`);
      console.log(`SYSTEM_ADMIN_USER_ID=${existing.id}`);
      return existing.id;
    }

    // Create system admin user
    console.log(`Creating system admin user: ${email}`);

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'System Admin',
        role: 'system',
        is_system_user: true,
        description: 'System user for automated audit trail entries',
      },
    });

    if (createError) {
      console.error('❌ Error creating system admin:', createError);
      process.exit(1);
    }

    console.log('✅ System admin user created successfully!');
    console.log(`   User ID: ${newUser.user.id}`);
    console.log(`   Email: ${newUser.user.email}`);

    // Also create entry in public.users table if it exists
    const { error: publicUserError } = await supabase
      .from('users')
      .insert({
        id: newUser.user.id,
        email: newUser.user.email,
        full_name: 'System Admin',
        role: 'system',
      })
      .select()
      .single();

    if (publicUserError && publicUserError.code !== '23505') {
      // Ignore duplicate key errors
      console.warn('⚠️  Warning: Could not create entry in public.users:', publicUserError.message);
    } else if (!publicUserError) {
      console.log('✅ Entry created in public.users table');
    }

    console.log(`\n📋 Add this to your .env.local file:`);
    console.log(`SYSTEM_ADMIN_USER_ID=${newUser.user.id}`);

    return newUser.user.id;
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

createSystemAdmin()
  .then((userId) => {
    console.log('\n✅ Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Add SYSTEM_ADMIN_USER_ID to your .env.local');
    console.log('2. Restart your development server');
    console.log('3. Run the backfill script if you want to update existing NULL user_id logs');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
