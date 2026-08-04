/**
 * Seed Insight Test Data
 *
 * Seeds business tables (payment_invoices, scheduling_bookings, crm_contacts)
 * with test data that will trigger the insight detectors naturally.
 *
 * Usage: npx ts-node scripts/seed-insight-test-data.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('🌱 Seeding insight test data...\n');

  // Get the first user to seed data for - try multiple tables
  let userId: string | null = null;
  let userEmail: string | null = null;

  // Try payment_invoices first (we know this has data)
  const { data: invoiceUsers } = await supabase
    .from('payment_invoices')
    .select('user_id')
    .limit(1);

  if (invoiceUsers && invoiceUsers.length > 0) {
    userId = invoiceUsers[0].user_id;
  }

  // Try scheduling_bookings
  if (!userId) {
    const { data: bookingUsers } = await supabase
      .from('scheduling_bookings')
      .select('user_id')
      .limit(1);
    if (bookingUsers && bookingUsers.length > 0) {
      userId = bookingUsers[0].user_id;
    }
  }

  // Try crm_contacts
  if (!userId) {
    const { data: crmUsers } = await supabase
      .from('crm_contacts')
      .select('user_id')
      .limit(1);
    if (crmUsers && crmUsers.length > 0) {
      userId = crmUsers[0].user_id;
    }
  }

  // Try profiles
  if (!userId) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .limit(1);
    if (profiles && profiles.length > 0) {
      userId = profiles[0].id;
      userEmail = profiles[0].email;
    }
  }

  if (!userId) {
    console.error('No users found. Please create a user first.');
    process.exit(1);
  }

  console.log(`📧 Seeding data for user: ${userEmail || userId}\n`);

  // 1. Create overdue invoices (triggers cash_ar_overdue detector)
  console.log('💰 Creating overdue invoices...');
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 14); // 14 days ago

  const invoices = [
    {
      user_id: userId,
      amount: 500,
      status: 'sent',
      invoice_number: `TEST-INV-${Date.now()}-001`,
      due_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days overdue
      created_at: overdueDate.toISOString(),
    },
    {
      user_id: userId,
      amount: 1200,
      status: 'sent',
      invoice_number: `TEST-INV-${Date.now()}-002`,
      due_date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days overdue
      created_at: overdueDate.toISOString(),
    },
    {
      user_id: userId,
      amount: 750,
      status: 'overdue',
      invoice_number: `TEST-INV-${Date.now()}-003`,
      due_date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days overdue
      created_at: overdueDate.toISOString(),
    },
  ];

  const { data: createdInvoices, error: invoiceError } = await supabase
    .from('payment_invoices')
    .insert(invoices)
    .select();

  if (invoiceError) {
    console.error('Error creating invoices:', invoiceError.message);
  } else {
    console.log(`  ✅ Created ${createdInvoices?.length || 0} overdue invoices ($2,450 total)`);
  }

  // 2. Create stalled CRM enquiries (triggers sales_stalled detector)
  console.log('\n📞 Creating stalled CRM enquiries...');
  const stalledDate = new Date();
  stalledDate.setDate(stalledDate.getDate() - 3); // 3 days ago

  const contacts = [
    {
      user_id: userId,
      first_name: 'Sarah',
      last_name: 'Johnson',
      email: 'sarah.j@example.com',
      phone: '+1234567890',
      stage: 'enquiry',
      source: 'website',
      created_at: stalledDate.toISOString(),
      updated_at: stalledDate.toISOString(),
    },
    {
      user_id: userId,
      first_name: 'Michael',
      last_name: 'Chen',
      email: 'mchen@example.com',
      phone: '+1234567891',
      stage: 'enquiry',
      source: 'referral',
      created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
      updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const { data: createdContacts, error: contactError } = await supabase
    .from('crm_contacts')
    .insert(contacts)
    .select();

  if (contactError) {
    console.error('Error creating contacts:', contactError.message);
  } else {
    console.log(`  ✅ Created ${createdContacts?.length || 0} stalled enquiries (48h+ no reply)`);

    // Create activities to show no recent replies
    if (createdContacts && createdContacts.length > 0) {
      const activities = createdContacts.map(contact => ({
        user_id: userId,
        contact_id: contact.id,
        activity_type: 'note',
        title: 'New enquiry from website',
        description: 'Customer enquiry received - awaiting response',
        auto_logged: true,
        source_capability: 'manual',
        activity_date: contact.created_at,
      }));

      const { error: activityError } = await supabase
        .from('crm_activities')
        .insert(activities);

      if (activityError) {
        console.error('Error creating activities:', activityError.message);
      } else {
        console.log(`  ✅ Created ${activities.length} activity records`);
      }
    }
  }

  // 3. Create bookings with no-shows (triggers ret_no_show_spike detector)
  console.log('\n📅 Creating bookings with no-shows...');

  // First, get or create a service
  let serviceId: string | null = null;
  const { data: existingServices } = await supabase
    .from('scheduling_services')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  if (existingServices && existingServices.length > 0) {
    serviceId = existingServices[0].id;
  } else {
    const { data: newService, error: serviceError } = await supabase
      .from('scheduling_services')
      .insert({
        user_id: userId,
        name: 'Test Service',
        duration: 60,
        price: 100,
        is_active: true,
      })
      .select()
      .single();

    if (serviceError) {
      console.error('Error creating service:', serviceError.message);
    } else {
      serviceId = newService.id;
    }
  }

  if (serviceId) {
    const now = new Date();
    const bookings = [
      // Completed bookings (baseline)
      ...Array.from({ length: 8 }, (_, i) => ({
        user_id: userId,
        service_id: serviceId,
        client_first_name: `Client ${i + 1}`,
        client_email: `client${i + 1}@example.com`,
        start_time: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        status: 'completed',
      })),
      // No-shows (spike)
      ...Array.from({ length: 4 }, (_, i) => ({
        user_id: userId,
        service_id: serviceId,
        client_first_name: `NoShow ${i + 1}`,
        client_email: `noshow${i + 1}@example.com`,
        start_time: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        status: 'no_show',
      })),
    ];

    const { data: createdBookings, error: bookingError } = await supabase
      .from('scheduling_bookings')
      .insert(bookings)
      .select();

    if (bookingError) {
      console.error('Error creating bookings:', bookingError.message);
    } else {
      console.log(`  ✅ Created ${createdBookings?.length || 0} bookings (4 no-shows = 33% no-show rate)`);
    }
  }

  console.log('\n✨ Test data seeded successfully!');
  console.log('\n📊 Expected detector triggers:');
  console.log('  • cash_ar_overdue: 3 invoices, $2,450 overdue');
  console.log('  • sales_stalled: 2 enquiries with no reply in 48h+');
  console.log('  • ret_no_show_spike: 33% no-show rate (likely above baseline)');
  console.log('\n🔄 Now run the detection cron:');
  console.log('  curl http://localhost:3000/api/cron/insight-detect');
}

main().catch(console.error);
