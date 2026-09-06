import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { supabaseServer } from '../lib/supabaseServer';

async function addTestBookings() {
  console.log('Adding test bookings for current week...\n');

  // Get the first user from business_profiles
  const { data: profile, error: profileError } = await supabaseServer
    .from('business_profiles')
    .select('user_id')
    .limit(1)
    .single();

  if (profileError || !profile) {
    console.error('Error: No user found in business_profiles');
    return;
  }

  const userId = profile.user_id;
  console.log(`User ID: ${userId}\n`);

  // Get a service
  const { data: service, error: serviceError } = await supabaseServer
    .from('scheduling_services')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (serviceError || !service) {
    console.error('Error: No active service found');
    return;
  }

  console.log(`Service ID: ${service.id}\n`);

  // Get a contact
  const { data: contact, error: contactError } = await supabaseServer
    .from('crm_contacts')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const contactId = contact?.id || null;
  console.log(`Contact ID: ${contactId || 'None'}\n`);

  // Create test bookings for this week
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const testBookings = [
    {
      user_id: userId,
      service_id: service.id,
      contact_id: contactId,
      client_first_name: 'Test',
      client_last_name: 'User 1',
      client_email: 'test1@example.com',
      start_time: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000).toISOString(), // Tomorrow at 10:00 UTC
      end_time: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000 + 11 * 60 * 60 * 1000).toISOString(),   // Tomorrow at 11:00 UTC
      status: 'confirmed',
      payment_status: 'pending'
    },
    {
      user_id: userId,
      service_id: service.id,
      contact_id: contactId,
      client_first_name: 'Test',
      client_last_name: 'User 2',
      client_email: 'test2@example.com',
      start_time: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000).toISOString(), // Day after tomorrow at 14:00 UTC
      end_time: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000 + 15 * 60 * 60 * 1000).toISOString(),   // Day after tomorrow at 15:00 UTC
      status: 'confirmed',
      payment_status: 'pending'
    },
    {
      user_id: userId,
      service_id: service.id,
      contact_id: contactId,
      client_first_name: 'Test',
      client_last_name: 'User 3',
      client_email: 'test3@example.com',
      start_time: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000 + 16 * 60 * 60 * 1000).toISOString(), // +3 days at 16:00 UTC
      end_time: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000 + 17 * 60 * 60 * 1000).toISOString(),   // +3 days at 17:00 UTC
      status: 'confirmed',
      payment_status: 'pending'
    }
  ];

  console.log('Inserting test bookings:\n');
  testBookings.forEach((booking, i) => {
    console.log(`${i + 1}. ${booking.client_first_name} ${booking.client_last_name}`);
    console.log(`   Start: ${booking.start_time}`);
    console.log(`   End: ${booking.end_time}`);
    console.log(`   Status: ${booking.status}\n`);
  });

  const { data, error } = await supabaseServer
    .from('scheduling_bookings')
    .insert(testBookings)
    .select();

  if (error) {
    console.error('Error inserting bookings:', error);
    return;
  }

  console.log(`✅ Successfully created ${data.length} test bookings!\n`);
  console.log('IDs:', data.map(b => b.id));
}

addTestBookings()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
