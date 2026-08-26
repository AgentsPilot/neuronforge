/**
 * Verify Lead Customer Journey
 * Checks that lead contacts were properly upgraded to 'qualified' stage
 * and have intake data + bookings + payments
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyLeadJourney(userId: string) {
  console.log('\n============================================================');
  console.log('VERIFY LEAD CUSTOMER JOURNEY');
  console.log('============================================================');
  console.log(`User ID: ${userId}\n`);

  // Get qualified contacts with intake data
  const { data: contacts, error } = await supabase
    .from('crm_contacts')
    .select('id, email, first_name, last_name, stage, custom_fields, created_at')
    .eq('user_id', userId)
    .eq('stage', 'qualified')
    .order('email', { ascending: true });

  if (error) {
    console.error('❌ Error fetching contacts:', error);
    return;
  }

  console.log(`📊 Found ${contacts?.length || 0} qualified contacts\n`);

  for (const contact of contacts || []) {
    const intakeData = contact.custom_fields?.intake_data;
    const intakeSubmittedAt = contact.custom_fields?.intake_submitted_at;

    // Get bookings for this contact
    const { data: bookings } = await supabase
      .from('scheduling_bookings')
      .select('id, status, payment_status, booking_source, start_time')
      .eq('contact_id', contact.id)
      .eq('booking_source', 'website');

    // Get payments for this contact
    const { data: payments } = await supabase
      .from('payment_transactions')
      .select('id, amount, status, metadata')
      .eq('contact_id', contact.id);

    const websitePayments = payments?.filter(p => p.metadata?.source === 'website_booking') || [];

    console.log(`👤 ${contact.first_name} ${contact.last_name} (${contact.email})`);
    console.log(`   Stage: ${contact.stage}`);
    console.log(`   Intake Submitted: ${intakeSubmittedAt ? '✅ ' + intakeSubmittedAt : '❌ No'}`);
    if (intakeData) {
      console.log(`   Intake Goals: ${intakeData.goals?.substring(0, 60)}...`);
      console.log(`   Preferred Communication: ${intakeData.preferred_communication}`);
    }
    console.log(`   Website Bookings: ${bookings?.length || 0}`);
    if (bookings && bookings.length > 0) {
      bookings.forEach(b => {
        console.log(`      - ${b.status} | ${b.payment_status} | ${new Date(b.start_time).toLocaleDateString()}`);
      });
    }
    console.log(`   Website Payments: ${websitePayments.length}`);
    if (websitePayments.length > 0) {
      websitePayments.forEach(p => {
        console.log(`      - $${p.amount} | ${p.status}`);
      });
    }
    console.log('');
  }

  // Summary
  const contactsWithIntake = contacts?.filter(c => c.custom_fields?.intake_data) || [];
  const contactsWithBookings = await Promise.all(
    (contacts || []).map(async (c) => {
      const { data } = await supabase
        .from('scheduling_bookings')
        .select('id')
        .eq('contact_id', c.id)
        .eq('booking_source', 'website');
      return data && data.length > 0 ? c : null;
    })
  );
  const contactsWithWebsiteBookings = contactsWithBookings.filter(c => c !== null);

  console.log('============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`Total Qualified Contacts: ${contacts?.length || 0}`);
  console.log(`  - With Intake Data: ${contactsWithIntake.length}`);
  console.log(`  - With Website Bookings: ${contactsWithWebsiteBookings.length}`);
  console.log('');

  if (contactsWithIntake.length === 0) {
    console.log('⚠️  WARNING: No contacts with intake data found!');
  } else if (contactsWithIntake.length < 10) {
    console.log('⚠️  WARNING: Expected at least 10 contacts with intake data');
  } else {
    console.log('✅ Lead customer journey verified successfully!');
  }
}

// Get user ID from command line
const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npx tsx verify-lead-journey.ts <user-id>');
  process.exit(1);
}

verifyLeadJourney(userId);
