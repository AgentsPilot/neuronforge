/**
 * Comprehensive Insight Test Data Seeder
 *
 * Creates complete, interrelated mock data across ALL business capabilities
 * to test all 27 insight detectors. Data spans 90 days with realistic scenarios.
 *
 * Features:
 * - Clear & Replace mode (deletes existing data first)
 * - 90 days of historical data
 * - Proper field usage (activity_date, viewed_at, device_type)
 * - Discount metadata for pricing detectors
 * - Stripe Connect payout blocked scenario
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-insight-test-data.ts [userId]
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

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(2);
const randomChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const uuid = () => crypto.randomUUID();

const daysAgo = (days: number, hoursOffset = 0) => {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  if (hoursOffset) {
    date.setHours(date.getHours() + hoursOffset);
  }
  return date;
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

const generateIpHash = () => {
  const chars = 'abcdef0123456789';
  let hash = '';
  for (let i = 0; i < 32; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
};

// ============================================================
// SAMPLE DATA ARRAYS
// ============================================================

const FIRST_NAMES = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'William', 'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia', 'Lucas', 'Harper', 'Henry', 'Evelyn', 'Alexander', 'Daniel', 'Emily', 'Michael', 'Sarah', 'David'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'White', 'Harris', 'Clark', 'Lewis'];

const LEAD_SOURCES = [
  { source: 'website_form', conversionRate: 0.60, count: 15 },
  { source: 'referral', conversionRate: 0.75, count: 12 },
  { source: 'facebook_ads', conversionRate: 0.20, count: 10 },  // Underperforming
  { source: 'google_ads', conversionRate: 0.50, count: 8 },
  { source: 'instagram', conversionRate: 0.15, count: 8 },      // Underperforming
  { source: 'walk_in', conversionRate: 0.80, count: 5 },
  { source: 'other', conversionRate: 0.40, count: 2 },
];

const ACTIVITY_TYPES = ['note', 'email', 'call', 'meeting', 'booking', 'payment'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const REFUND_REASONS = ['service_issue', 'dissatisfied', 'duplicate_charge', 'cancelled_booking', 'overcharge'];
const DISCOUNT_CODES = ['WELCOME10', 'SUMMER20', 'LOYALTY15', 'FLASH25', 'FRIEND10'];
const CANCELLATION_REASONS = ['Schedule conflict', 'Feeling unwell', 'Emergency', 'Changed mind', 'Found alternative'];

// ============================================================
// SERVICE DEFINITIONS
// ============================================================

const SERVICE_DEFINITIONS = [
  { name: 'Intro Session', duration: 30, price: 25, currency: 'USD', isIntro: true },
  { name: 'Basic Service', duration: 60, price: 80, currency: 'USD', isIntro: false },
  { name: 'Premium Treatment', duration: 90, price: 150, currency: 'USD', isIntro: false },
  { name: 'Package Deal', duration: 120, price: 200, currency: 'USD', isIntro: false },
  { name: 'Quick Consultation', duration: 15, price: 30, currency: 'USD', isIntro: false },  // Low performer
  { name: 'Specialty Session', duration: 75, price: 180, currency: 'USD', isIntro: false },
];

// ============================================================
// TABLES TO CLEAR (in FK-safe order)
// ============================================================

const TABLES_TO_CLEAR = [
  // Insight system (clear first)
  'owner_insight_history',
  'insight_automations',
  'insights',
  'business_health_summaries',
  'kernel_action_log',
  'kernel_executions',
  'derived_metrics',
  'business_events',

  // Source data (respect FK order - children first)
  'crm_activities',
  'crm_tasks',
  'payment_transactions',
  'payment_invoices',
  'saved_payment_methods',
  'payment_plan_installments',
  'scheduling_bookings',
  'website_page_views',
  'crm_contacts',
  'scheduling_services',
  'stripe_connect_accounts',
];

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

async function clearExistingData(userId: string) {
  console.log('\n🧹 Clearing existing data...');

  for (const table of TABLES_TO_CLEAR) {
    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId);

      if (error) {
        if (error.message.includes('does not exist') || error.code === '42P01') {
          console.log(`   ⏭️  ${table} - table does not exist (skipped)`);
        } else {
          console.log(`   ⚠️  ${table} - ${error.message}`);
        }
      } else {
        console.log(`   ✓ ${table} - cleared`);
      }
    } catch {
      console.log(`   ⏭️  ${table} - skipped`);
    }
  }
}

async function seedData(userId: string) {
  console.log('\n============================================================');
  console.log('COMPREHENSIVE INSIGHT TEST DATA SEEDER');
  console.log('============================================================');
  console.log(`User ID: ${userId}`);
  console.log(`Time Range: 90 days`);
  console.log(`Mode: Clear & Replace\n`);

  // Clear existing data first
  await clearExistingData(userId);

  // Track created IDs for relationships
  const contactIds: string[] = [];
  const serviceIds: string[] = [];
  const bookingIds: string[] = [];
  const invoiceIds: string[] = [];
  let subdomain = 'test-business';

  // Get existing website subdomain
  const { data: existingWebsite } = await supabase
    .from('websites')
    .select('subdomain')
    .eq('user_id', userId)
    .single();

  if (existingWebsite?.subdomain) {
    subdomain = existingWebsite.subdomain;
  }

  // ============================================================
  // 1. CREATE SCHEDULING SERVICES (6 services)
  // ============================================================
  console.log('\n💆 Creating scheduling services...');

  const services = SERVICE_DEFINITIONS.map((svc, idx) => ({
    id: uuid(),
    user_id: userId,
    service_name: svc.name,
    description: `Professional ${svc.name.toLowerCase()} service`,
    duration_minutes: svc.duration,
    price: svc.price,
    is_active: true,
    created_at: daysAgo(90).toISOString(),
    updated_at: daysAgo(idx).toISOString(),
  }));

  const { error: servicesError } = await supabase.from('scheduling_services').insert(services);
  if (servicesError) {
    console.error('   ❌ Error inserting services:', servicesError.message);
  } else {
    services.forEach(s => serviceIds.push(s.id));
    console.log(`   ✓ Created ${services.length} services`);
  }

  // Service ID mapping for specific scenarios
  const introServiceId = serviceIds[0];  // Intro Session
  const basicServiceId = serviceIds[1];  // Basic Service
  const premiumServiceId = serviceIds[2]; // Premium Treatment
  const lowPerformerServiceId = serviceIds[4]; // Quick Consultation

  // ============================================================
  // 2. CREATE CRM CONTACTS (60 contacts with cohorts)
  // ============================================================
  console.log('\n📇 Creating CRM contacts with cohorts...');

  const contacts: Array<{
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    stage: string;
    source: string;
    created_at: string;
    updated_at: string;
    cohort: string;
  }> = [];

  let contactIndex = 0;

  // Active Clients (20) - recent bookings, payments
  for (let i = 0; i < 20; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: 'client',
      source: randomChoice(LEAD_SOURCES.filter(s => s.conversionRate >= 0.5)).source,
      created_at: daysAgo(randomInt(30, 90)).toISOString(),
      updated_at: daysAgo(randomInt(0, 7)).toISOString(),
      cohort: 'active_client',
    });
    contactIndex++;
  }

  // Cold Leads (10) - no activity 10-25 days
  for (let i = 0; i < 10; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: 'lead',
      source: randomChoice(LEAD_SOURCES).source,
      created_at: daysAgo(randomInt(15, 30)).toISOString(),
      updated_at: daysAgo(randomInt(10, 25)).toISOString(),
      cohort: 'cold_lead',
    });
    contactIndex++;
  }

  // Stuck Pipeline (8) - same stage 14+ days, no activity
  for (let i = 0; i < 8; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    const stuckStage = randomChoice(['qualified', 'proposal_sent', 'negotiation']);
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: stuckStage,
      source: randomChoice(LEAD_SOURCES).source,
      created_at: daysAgo(randomInt(20, 45)).toISOString(),
      updated_at: daysAgo(randomInt(14, 30)).toISOString(),
      cohort: 'stuck_pipeline',
    });
    contactIndex++;
  }

  // Decaying Clients (10) - no activity 35-60 days
  for (let i = 0; i < 10; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: 'client',
      source: randomChoice(LEAD_SOURCES.filter(s => s.conversionRate >= 0.5)).source,
      created_at: daysAgo(randomInt(60, 90)).toISOString(),
      updated_at: daysAgo(randomInt(35, 60)).toISOString(),
      cohort: 'decaying_client',
    });
    contactIndex++;
  }

  // New Leads (7) - recent, varied sources
  for (let i = 0; i < 7; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: randomChoice(['lead', 'contacted']),
      source: randomChoice(LEAD_SOURCES).source,
      created_at: daysAgo(randomInt(0, 7)).toISOString(),
      updated_at: daysAgo(randomInt(0, 3)).toISOString(),
      cohort: 'new_lead',
    });
    contactIndex++;
  }

  // Past Clients (5) - historical
  for (let i = 0; i < 5; i++) {
    const firstName = FIRST_NAMES[contactIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[contactIndex % LAST_NAMES.length];
    contacts.push({
      id: uuid(),
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contactIndex}@example.com`,
      phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
      stage: 'past_client',
      source: randomChoice(LEAD_SOURCES).source,
      created_at: daysAgo(randomInt(60, 90)).toISOString(),
      updated_at: daysAgo(randomInt(30, 60)).toISOString(),
      cohort: 'past_client',
    });
    contactIndex++;
  }

  // Insert contacts (without cohort field - it's just for our tracking)
  const contactsToInsert = contacts.map(({ cohort, ...c }) => c);
  const { error: contactsError } = await supabase.from('crm_contacts').insert(contactsToInsert);
  if (contactsError) {
    console.error('   ❌ Error inserting contacts:', contactsError.message);
  } else {
    contacts.forEach(c => contactIds.push(c.id));
    console.log(`   ✓ Created ${contacts.length} contacts`);
    console.log(`      - Active clients: 20`);
    console.log(`      - Cold leads: 10`);
    console.log(`      - Stuck pipeline: 8`);
    console.log(`      - Decaying clients: 10`);
    console.log(`      - New leads: 7`);
    console.log(`      - Past clients: 5`);
  }

  // Create cohort lookup for activities
  const cohortMap = new Map<string, string>();
  contacts.forEach(c => cohortMap.set(c.id, c.cohort));

  // ============================================================
  // 3. CREATE CRM ACTIVITIES (150 activities with activity_date)
  // ============================================================
  console.log('\n📝 Creating CRM activities...');

  const activities: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    activity_type: string;
    title: string;
    description: string;
    auto_logged: boolean;
    source_capability: string | null;
    activity_date: string;
    created_at: string;
  }> = [];

  for (const contact of contacts) {
    const cohort = contact.cohort;

    if (cohort === 'active_client') {
      // Recent activities for active clients (3-5 per client)
      const activityCount = randomInt(3, 5);
      for (let j = 0; j < activityCount; j++) {
        const activityDaysAgo = randomInt(0, 7);
        activities.push({
          id: uuid(),
          user_id: userId,
          contact_id: contact.id,
          activity_type: randomChoice(ACTIVITY_TYPES),
          title: `Activity with ${contact.first_name}`,
          description: `Recent engagement activity`,
          auto_logged: j === 0,
          source_capability: j === 0 ? randomChoice(['scheduling', 'payments']) : null,
          activity_date: daysAgo(activityDaysAgo).toISOString(),
          created_at: daysAgo(activityDaysAgo).toISOString(),
        });
      }
    } else if (cohort === 'cold_lead') {
      // Last activity 10-25 days ago
      const activityDaysAgo = randomInt(10, 25);
      activities.push({
        id: uuid(),
        user_id: userId,
        contact_id: contact.id,
        activity_type: randomChoice(['email', 'call']),
        title: `Initial contact with ${contact.first_name}`,
        description: 'First outreach',
        auto_logged: false,
        source_capability: null,
        activity_date: daysAgo(activityDaysAgo).toISOString(),
        created_at: daysAgo(activityDaysAgo).toISOString(),
      });
    } else if (cohort === 'stuck_pipeline') {
      // Last activity 14-30 days ago (same as when they entered current stage)
      const activityDaysAgo = randomInt(14, 30);
      activities.push({
        id: uuid(),
        user_id: userId,
        contact_id: contact.id,
        activity_type: 'meeting',
        title: `Follow-up with ${contact.first_name}`,
        description: 'Proposal discussion',
        auto_logged: false,
        source_capability: null,
        activity_date: daysAgo(activityDaysAgo).toISOString(),
        created_at: daysAgo(activityDaysAgo).toISOString(),
      });
    } else if (cohort === 'decaying_client') {
      // Last activity 35-60 days ago
      const activityDaysAgo = randomInt(35, 60);
      activities.push({
        id: uuid(),
        user_id: userId,
        contact_id: contact.id,
        activity_type: 'booking',
        title: `Last session with ${contact.first_name}`,
        description: 'Previous appointment',
        auto_logged: true,
        source_capability: 'scheduling',
        activity_date: daysAgo(activityDaysAgo).toISOString(),
        created_at: daysAgo(activityDaysAgo).toISOString(),
      });
    } else if (cohort === 'new_lead') {
      // Recent activity
      const activityDaysAgo = randomInt(0, 3);
      activities.push({
        id: uuid(),
        user_id: userId,
        contact_id: contact.id,
        activity_type: 'email',
        title: `New inquiry from ${contact.first_name}`,
        description: 'Website form submission',
        auto_logged: true,
        source_capability: 'website',
        activity_date: daysAgo(activityDaysAgo).toISOString(),
        created_at: daysAgo(activityDaysAgo).toISOString(),
      });
    } else if (cohort === 'past_client') {
      // Historical activities
      const activityDaysAgo = randomInt(45, 90);
      activities.push({
        id: uuid(),
        user_id: userId,
        contact_id: contact.id,
        activity_type: 'payment',
        title: `Final payment from ${contact.first_name}`,
        description: 'Last transaction',
        auto_logged: true,
        source_capability: 'payments',
        activity_date: daysAgo(activityDaysAgo).toISOString(),
        created_at: daysAgo(activityDaysAgo).toISOString(),
      });
    }
  }

  const { error: activitiesError } = await supabase.from('crm_activities').insert(activities);
  if (activitiesError) {
    console.error('   ❌ Error inserting activities:', activitiesError.message);
  } else {
    console.log(`   ✓ Created ${activities.length} activities`);
  }

  // ============================================================
  // 4. CREATE CRM TASKS (25 tasks - overdue and upcoming)
  // ============================================================
  console.log('\n📋 Creating CRM tasks...');

  const tasks: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    due_date: string;
    completed_at: string | null;
    created_at: string;
  }> = [];

  // Overdue high-priority (4)
  for (let i = 0; i < 4; i++) {
    tasks.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      title: `Urgent follow-up ${i + 1}`,
      description: 'High priority task that is overdue',
      priority: randomChoice(['high', 'urgent']),
      status: 'pending',
      due_date: daysAgo(randomInt(3, 10)).toISOString(),
      completed_at: null,
      created_at: daysAgo(randomInt(10, 20)).toISOString(),
    });
  }

  // Overdue medium-priority (6)
  for (let i = 0; i < 6; i++) {
    tasks.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      title: `Follow-up task ${i + 1}`,
      description: 'Medium priority overdue task',
      priority: 'medium',
      status: 'pending',
      due_date: daysAgo(randomInt(1, 7)).toISOString(),
      completed_at: null,
      created_at: daysAgo(randomInt(7, 14)).toISOString(),
    });
  }

  // Completed recently (8)
  for (let i = 0; i < 8; i++) {
    const completedDaysAgo = randomInt(1, 5);
    tasks.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      title: `Completed task ${i + 1}`,
      description: 'Recently completed task',
      priority: 'medium',
      status: 'completed',
      due_date: daysAgo(completedDaysAgo + randomInt(0, 3)).toISOString(),
      completed_at: daysAgo(completedDaysAgo).toISOString(),
      created_at: daysAgo(completedDaysAgo + randomInt(3, 10)).toISOString(),
    });
  }

  // Upcoming (5)
  for (let i = 0; i < 5; i++) {
    const dueDays = -randomInt(1, 7); // Negative = future
    tasks.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      title: `Upcoming task ${i + 1}`,
      description: 'Scheduled for the future',
      priority: randomChoice(['low', 'medium']),
      status: 'pending',
      due_date: daysAgo(dueDays).toISOString(),
      completed_at: null,
      created_at: daysAgo(randomInt(1, 5)).toISOString(),
    });
  }

  // In progress (2)
  for (let i = 0; i < 2; i++) {
    tasks.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      title: `In progress task ${i + 1}`,
      description: 'Currently being worked on',
      priority: 'high',
      status: 'in_progress',
      due_date: daysAgo(-randomInt(0, 2)).toISOString(),
      completed_at: null,
      created_at: daysAgo(randomInt(2, 5)).toISOString(),
    });
  }

  const { error: tasksError } = await supabase.from('crm_tasks').insert(tasks);
  if (tasksError) {
    console.error('   ❌ Error inserting tasks:', tasksError.message);
  } else {
    console.log(`   ✓ Created ${tasks.length} tasks`);
    console.log(`      - Overdue high priority: 4`);
    console.log(`      - Overdue medium priority: 6`);
    console.log(`      - Completed recently: 8`);
    console.log(`      - Upcoming: 5`);
    console.log(`      - In progress: 2`);
  }

  // ============================================================
  // 5. CREATE SCHEDULING BOOKINGS (80 bookings)
  // ============================================================
  console.log('\n📅 Creating scheduling bookings...');

  const bookings: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    service_id: string;
    client_first_name: string;
    client_last_name: string;
    client_email: string;
    start_time: string;
    end_time: string;
    status: string;
    cancellation_reason: string | null;
    payment_status: string;
    payment_id?: string | null; // Added for Phase A - links booking to payment transaction
    booking_source: string;
    created_at: string;
    updated_at: string;
  }> = [];

  // Track emails for repeat booking analysis
  const emailBookingCounts = new Map<string, number>();
  const activeClientContacts = contacts.filter(c => c.cohort === 'active_client');

  // Completed successful (45)
  for (let i = 0; i < 45; i++) {
    const contact = randomChoice(activeClientContacts);
    const startTime = daysAgo(randomInt(1, 60));
    startTime.setHours(randomInt(9, 17), 0, 0, 0);
    const duration = randomChoice([30, 60, 90]);
    const serviceId = randomChoice([basicServiceId, premiumServiceId, serviceIds[3], serviceIds[5]]);

    emailBookingCounts.set(contact.email, (emailBookingCounts.get(contact.email) || 0) + 1);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: serviceId,
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + duration * 60 * 1000).toISOString(),
      status: 'completed',
      cancellation_reason: null,
      payment_status: 'paid',
      booking_source: randomChoice(['widget', 'manual']),
      created_at: daysAgo(randomInt(60, 90)).toISOString(),
      updated_at: startTime.toISOString(),
    });
  }

  // Confirmed upcoming (10)
  for (let i = 0; i < 10; i++) {
    const contact = randomChoice(activeClientContacts);
    const startTime = daysAgo(-randomInt(1, 14)); // Future
    startTime.setHours(randomInt(9, 17), 0, 0, 0);
    const duration = randomChoice([30, 60, 90]);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: randomChoice(serviceIds),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + duration * 60 * 1000).toISOString(),
      status: 'confirmed',
      cancellation_reason: null,
      payment_status: 'pending',
      booking_source: 'widget',
      created_at: daysAgo(randomInt(1, 7)).toISOString(),
      updated_at: daysAgo(0).toISOString(),
    });
  }

  // Cancelled - last minute (6) - within 24 hours - THIS WEEK
  for (let i = 0; i < 6; i++) {
    const contact = randomChoice(contacts);
    const startTime = daysAgo(randomInt(0, 6)); // This week
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: randomChoice(serviceIds),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'cancelled',
      cancellation_reason: randomChoice(CANCELLATION_REASONS),
      payment_status: 'refunded',
      booking_source: 'widget',
      created_at: new Date(startTime.getTime() - 12 * 60 * 60 * 1000).toISOString(), // Created 12 hours before
      updated_at: new Date(startTime.getTime() - 6 * 60 * 60 * 1000).toISOString(), // Cancelled 6 hours before
    });
  }

  // Cancelled - normal (8) - more than 24 hours notice
  // 2 last week, 6 this week to create spike
  for (let i = 0; i < 2; i++) {
    const contact = randomChoice(contacts);
    const startTime = daysAgo(randomInt(7, 13)); // Last week
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: randomChoice(serviceIds),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'cancelled',
      cancellation_reason: randomChoice(CANCELLATION_REASONS),
      payment_status: 'refunded',
      booking_source: 'widget',
      created_at: daysAgo(randomInt(14, 21)).toISOString(),
      updated_at: new Date(startTime.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    });
  }

  for (let i = 0; i < 6; i++) {
    const contact = randomChoice(contacts);
    const startTime = daysAgo(randomInt(0, 6)); // This week
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: randomChoice(serviceIds),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'cancelled',
      cancellation_reason: randomChoice(CANCELLATION_REASONS),
      payment_status: 'refunded',
      booking_source: 'widget',
      created_at: daysAgo(randomInt(7, 14)).toISOString(),
      updated_at: new Date(startTime.getTime() - 72 * 60 * 60 * 1000).toISOString(),
    });
  }

  // No-shows (6)
  for (let i = 0; i < 6; i++) {
    const contact = randomChoice(contacts);
    const startTime = daysAgo(randomInt(1, 14));
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: randomChoice(serviceIds),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'no_show',
      cancellation_reason: null,
      payment_status: 'pending',
      booking_source: 'widget',
      created_at: daysAgo(randomInt(14, 30)).toISOString(),
      updated_at: startTime.toISOString(),
    });
  }

  // Intro offer bookings (5) - using Intro Session service
  for (let i = 0; i < 5; i++) {
    const contact = contacts.find(c => c.cohort === 'new_lead') || randomChoice(contacts);
    const startTime = daysAgo(randomInt(7, 30));
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: introServiceId,
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 30 * 60 * 1000).toISOString(),
      status: 'completed',
      cancellation_reason: null,
      payment_status: 'paid',
      booking_source: 'widget',
      created_at: daysAgo(randomInt(30, 45)).toISOString(),
      updated_at: startTime.toISOString(),
    });
  }

  // Low performer service bookings (3)
  for (let i = 0; i < 3; i++) {
    const contact = randomChoice(contacts);
    const startTime = daysAgo(randomInt(1, 30));
    startTime.setHours(randomInt(9, 17), 0, 0, 0);

    bookings.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: lowPerformerServiceId,
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: new Date(startTime.getTime() + 15 * 60 * 1000).toISOString(),
      status: 'completed',
      cancellation_reason: null,
      payment_status: 'paid',
      booking_source: 'manual',
      created_at: daysAgo(randomInt(30, 60)).toISOString(),
      updated_at: startTime.toISOString(),
    });
  }

  // ============================================================
  // 5a. CREATE LEAD CUSTOMER JOURNEY (Booking → Payment → Intake)
  // ============================================================
  console.log('\n🎯 Creating lead customer journey (booking → payment → intake)...');

  // Temporary array to store journey payments (will be added to transactions array later)
  const journeyPayments: Array<any> = [];

  // Get lead contacts (both new and cold leads)
  const leadContacts = contacts.filter(c => c.cohort === 'new_lead' || c.cohort === 'cold_lead');
  const journeyCount = Math.min(10, leadContacts.length); // Create journey for 10 leads

  for (let i = 0; i < journeyCount; i++) {
    const contact = leadContacts[i];
    const service = randomChoice(services);
    const bookingDaysAgo = randomInt(1, 14);
    const startTime = daysAgo(bookingDaysAgo);
    startTime.setHours(randomInt(9, 17), 0, 0, 0);
    const endTime = new Date(startTime.getTime() + service.duration_minutes * 60 * 1000);

    // Step 1: Create booking (confirmed, paid)
    const booking = {
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      service_id: service.id,
      client_first_name: contact.first_name,
      client_last_name: contact.last_name,
      client_email: contact.email,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: 'confirmed',
      cancellation_reason: null,
      payment_status: 'paid',
      payment_id: null, // Will be set after payment transaction is created
      booking_source: 'website',
      created_at: daysAgo(bookingDaysAgo + 1).toISOString(),
      updated_at: daysAgo(bookingDaysAgo).toISOString(),
    };
    bookings.push(booking);

    // Step 2: Create payment transaction
    const payment = {
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      invoice_id: null,
      amount: service.price,
      currency: service.currency,
      status: 'succeeded',
      payment_method: 'card',
      description: `Payment for ${service.service_name}`,
      metadata: {
        booking_id: booking.id,
        service_id: service.id,
        source: 'website_booking'
      },
      failure_reason: null,
      refund_status: 'none',
      refunded_amount: 0,
      refund_reason: null,
      refunded_at: null,
      paid_at: daysAgo(bookingDaysAgo).toISOString(),
      created_at: daysAgo(bookingDaysAgo).toISOString(),
    };

    journeyPayments.push(payment);

    // Link booking to payment
    booking.payment_id = payment.id;

    // Step 3: Update contact with intake data in custom_fields
    const intakeData = {
      template: 'general',
      submitted_at: daysAgo(bookingDaysAgo - 1).toISOString(),
      goals: `Looking forward to working on my goals with ${service.service_name}`,
      preferred_communication: randomChoice(['email', 'phone', 'text']),
    };

    contact.custom_fields = {
      ...contact.custom_fields,
      intake_data: intakeData,
      intake_submitted_at: daysAgo(bookingDaysAgo - 1).toISOString(),
    };

    // Step 4: Upgrade contact from lead to qualified (they completed intake)
    contact.stage = 'qualified';
    contact.updated_at = daysAgo(bookingDaysAgo - 1).toISOString();

    // Add activity for intake submission
    activities.push({
      id: uuid(),
      user_id: userId,
      contact_id: contact.id,
      activity_type: 'note',
      title: 'Intake Form Completed',
      description: `${contact.first_name} completed the intake form for ${service.service_name}`,
      auto_logged: true,
      source_capability: 'website',
      activity_date: daysAgo(bookingDaysAgo - 1).toISOString(),
      created_at: daysAgo(bookingDaysAgo - 1).toISOString(),
    });
  }

  console.log(`   ✓ Created ${journeyCount} lead customer journeys`);
  console.log(`      - Leads upgraded to 'qualified' stage`);
  console.log(`      - Each with: booking + payment + intake form`);

  // Update contacts with intake data and upgraded stage
  for (let i = 0; i < journeyCount; i++) {
    const contact = leadContacts[i];
    const { error: contactUpdateError } = await supabase
      .from('crm_contacts')
      .update({
        custom_fields: contact.custom_fields,
        stage: contact.stage,
        updated_at: contact.updated_at,
      })
      .eq('id', contact.id);

    if (contactUpdateError) {
      console.error(`   ❌ Error updating contact ${contact.email}:`, contactUpdateError.message);
    }
  }
  console.log(`   ✓ Updated ${journeyCount} contacts with intake data and 'qualified' stage`);

  const { error: bookingsError } = await supabase.from('scheduling_bookings').insert(bookings);
  if (bookingsError) {
    console.error('   ❌ Error inserting bookings:', bookingsError.message);
  } else {
    bookings.forEach(b => bookingIds.push(b.id));
    console.log(`   ✓ Created ${bookings.length} bookings`);
    console.log(`      - Completed: 45`);
    console.log(`      - Confirmed upcoming: 10`);
    console.log(`      - Cancelled last-minute: 6`);
    console.log(`      - Cancelled normal: 8 (2 last week, 6 this week = spike)`);
    console.log(`      - No-shows: 6`);
    console.log(`      - Intro offers: 5`);
    console.log(`      - Low performer service: 3`);
    console.log(`      - Lead journey bookings: ${journeyCount}`);
  }

  // ============================================================
  // 6. CREATE PAYMENT INVOICES (35 invoices)
  // ============================================================
  console.log('\n💰 Creating payment invoices...');

  const invoices: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    service_id?: string; // Added for Phase A - links invoice to service
    invoice_number: string;
    amount: number;
    currency: string;
    status: string;
    line_items: { description: string; quantity: number; unit_price: number }[];
    due_date: string;
    sent_at: string | null;
    paid_at: string | null;
    created_at: string;
  }> = [];

  // Paid on time (18)
  for (let i = 0; i < 18; i++) {
    const paidDaysAgo = randomInt(1, 60);
    const amount = randomFloat(50, 300);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-PAID-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'paid',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(paidDaysAgo + 7).toISOString(),
      sent_at: daysAgo(paidDaysAgo + 14).toISOString(),
      paid_at: daysAgo(paidDaysAgo).toISOString(),
      created_at: daysAgo(paidDaysAgo + 14).toISOString(),
    });
  }

  // Overdue 7-30 days (5)
  for (let i = 0; i < 5; i++) {
    const daysOverdue = randomInt(7, 30);
    const amount = randomFloat(150, 500);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-OD-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'overdue',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(daysOverdue).toISOString(),
      sent_at: daysAgo(daysOverdue + 7).toISOString(),
      paid_at: null,
      created_at: daysAgo(daysOverdue + 7).toISOString(),
    });
  }

  // Aging 30-60 days (3)
  for (let i = 0; i < 3; i++) {
    const daysOverdue = randomInt(30, 60);
    const amount = randomFloat(200, 600);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-AG1-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'overdue',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(daysOverdue).toISOString(),
      sent_at: daysAgo(daysOverdue + 7).toISOString(),
      paid_at: null,
      created_at: daysAgo(daysOverdue + 7).toISOString(),
    });
  }

  // Aging 60-90 days (2)
  for (let i = 0; i < 2; i++) {
    const daysOverdue = randomInt(60, 90);
    const amount = randomFloat(300, 800);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-AG2-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'overdue',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(daysOverdue).toISOString(),
      sent_at: daysAgo(daysOverdue + 7).toISOString(),
      paid_at: null,
      created_at: daysAgo(daysOverdue + 7).toISOString(),
    });
  }

  // Aging 90+ days (2)
  for (let i = 0; i < 2; i++) {
    const daysOverdue = randomInt(90, 120);
    const amount = randomFloat(400, 1000);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-AG3-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'overdue',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(daysOverdue).toISOString(),
      sent_at: daysAgo(daysOverdue + 7).toISOString(),
      paid_at: null,
      created_at: daysAgo(daysOverdue + 7).toISOString(),
    });
  }

  // Draft (3)
  for (let i = 0; i < 3; i++) {
    const amount = randomFloat(100, 250);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-DRAFT-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'draft',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(-7).toISOString(), // Due in future
      sent_at: null,
      paid_at: null,
      created_at: daysAgo(randomInt(0, 3)).toISOString(),
    });
  }

  // Sent awaiting payment (2)
  for (let i = 0; i < 2; i++) {
    const amount = randomFloat(150, 350);
    invoices.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_number: `INV-SENT-${Date.now()}-${i}`,
      amount,
      currency: 'USD',
      status: 'sent',
      line_items: [{ description: 'Service', quantity: 1, unit_price: amount }],
      due_date: daysAgo(-3).toISOString(), // Due in future
      sent_at: daysAgo(randomInt(1, 5)).toISOString(),
      paid_at: null,
      created_at: daysAgo(randomInt(3, 7)).toISOString(),
    });
  }

  // ============================================================
  // 6a. ASSIGN service_id TO INVOICES (Phase A Quick Fix)
  // ============================================================
  // Build map of which services are actually booked
  const servicesWithBookings = new Map<string, number>();
  bookings.forEach(b => {
    const count = servicesWithBookings.get(b.service_id) || 0;
    servicesWithBookings.set(b.service_id, count + 1);
  });

  // Distribute invoices across booked services (round-robin)
  const bookedServiceIds = Array.from(servicesWithBookings.keys());
  const invoicesWithService = invoices.map((invoice, i) => {
    const service_id = bookedServiceIds[i % bookedServiceIds.length];

    // Find service details to update line_items
    const service = services.find(s => s.id === service_id);

    return {
      ...invoice,
      service_id,
      line_items: service ? [{
        description: service.service_name,
        quantity: 1,
        unit_price: invoice.amount
      }] : invoice.line_items
    };
  });

  const { error: invoicesError } = await supabase.from('payment_invoices').insert(invoicesWithService);
  if (invoicesError) {
    console.error('   ❌ Error inserting invoices:', invoicesError.message);
  } else {
    invoicesWithService.forEach(inv => invoiceIds.push(inv.id));
    console.log(`   ✓ Created ${invoicesWithService.length} invoices`);
    console.log(`      - Paid on time: 18`);
    console.log(`      - Overdue 7-30 days: 5`);
    console.log(`      - Aging 30-60 days: 3`);
    console.log(`      - Aging 60-90 days: 2`);
    console.log(`      - Aging 90+ days: 2`);
    console.log(`      - Draft: 3`);
    console.log(`      - Sent awaiting: 2`);
  }

  // ============================================================
  // 7. CREATE PAYMENT TRANSACTIONS (Phase A Quick Fix)
  // ============================================================
  // NEW APPROACH: Create transactions FROM bookings, not separately
  console.log('\n💳 Creating payment transactions...');

  const transactions: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    invoice_id: string | null;
    amount: number;
    currency: string;
    status: string;
    payment_method: string;
    description: string;
    metadata: Record<string, unknown>;
    failure_reason: string | null;
    refund_status: string;
    refunded_amount: number;
    refund_reason: string | null;
    refunded_at: string | null;
    paid_at: string | null;
    created_at: string;
  }> = [];

  // 7a. Create transactions for completed PAID bookings (auto-link to bookings)
  const completedPaidBookings = bookings.filter(
    b => b.status === 'completed' && b.payment_status === 'paid'
  );

  completedPaidBookings.forEach((booking, i) => {
    const service = services.find(s => s.id === booking.service_id);
    const hasDiscount = i < 8; // First 8 have discounts
    const serviceAmount = service?.price || 100;
    const discountAmount = hasDiscount ? randomFloat(10, 30) : 0;
    const finalAmount = serviceAmount - discountAmount;

    const metadata: Record<string, unknown> = {
      booking_id: booking.id,
      service_id: booking.service_id
    };
    if (hasDiscount) {
      metadata.discount_amount = discountAmount;
      metadata.discount_type = randomChoice(['percentage', 'fixed']);
      metadata.discount_code = randomChoice(DISCOUNT_CODES);
      metadata.original_amount = serviceAmount;
    }

    const transaction = {
      id: uuid(),
      user_id: userId,
      contact_id: booking.contact_id,
      invoice_id: null, // Will link some to invoices later
      amount: finalAmount,
      currency: service?.currency || 'USD',
      status: 'succeeded',
      payment_method: randomChoice(['card', 'bank_transfer']),
      description: `Payment for ${service?.service_name || 'service'}`,
      metadata,
      failure_reason: null,
      refund_status: 'none',
      refunded_amount: 0,
      refund_reason: null,
      refunded_at: null,
      paid_at: booking.start_time, // Paid on booking date
      created_at: booking.start_time,
    };

    transactions.push(transaction);

    // CRITICAL: Link booking back to transaction
    booking.payment_id = transaction.id;
  });

  // 7b. Standalone transactions (not linked to bookings)
  // Failed payments (5)
  const failureReasons = ['card_declined', 'insufficient_funds', 'expired_card', 'processing_error', 'invalid_card'];
  for (let i = 0; i < 5; i++) {
    transactions.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_id: null,
      amount: randomFloat(100, 400),
      currency: 'USD',
      status: 'failed',
      payment_method: 'card',
      description: 'Failed payment attempt',
      metadata: {},
      failure_reason: failureReasons[i % failureReasons.length],
      refund_status: 'none',
      refunded_amount: 0,
      refund_reason: null,
      refunded_at: null,
      paid_at: null,
      created_at: daysAgo(randomInt(0, 10)).toISOString(),
    });
  }

  // Pending (old) (3) - created 3+ days ago
  for (let i = 0; i < 3; i++) {
    transactions.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_id: null,
      amount: randomFloat(100, 300),
      currency: 'USD',
      status: 'pending',
      payment_method: 'bank_transfer',
      description: 'Pending bank transfer',
      metadata: {},
      failure_reason: null,
      refund_status: 'none',
      refunded_amount: 0,
      refund_reason: null,
      refunded_at: null,
      paid_at: null,
      created_at: daysAgo(randomInt(3, 7)).toISOString(),
    });
  }

  // Refunded - full (4)
  for (let i = 0; i < 4; i++) {
    const amount = randomFloat(50, 200);
    const refundedDaysAgo = randomInt(0, 14);
    transactions.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_id: null,
      amount,
      currency: 'USD',
      status: 'refunded',
      payment_method: 'card',
      description: 'Refunded payment',
      metadata: {},
      failure_reason: null,
      refund_status: 'full',
      refunded_amount: amount,
      refund_reason: randomChoice(REFUND_REASONS),
      refunded_at: daysAgo(refundedDaysAgo).toISOString(),
      paid_at: daysAgo(refundedDaysAgo + randomInt(7, 30)).toISOString(),
      created_at: daysAgo(refundedDaysAgo + randomInt(7, 30)).toISOString(),
    });
  }

  // Refunded - partial (2)
  for (let i = 0; i < 2; i++) {
    const amount = randomFloat(100, 300);
    const refundedAmount = randomFloat(20, amount * 0.5);
    const refundedDaysAgo = randomInt(0, 14);
    transactions.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      invoice_id: null,
      amount,
      currency: 'USD',
      status: 'succeeded', // Still succeeded, just partially refunded
      payment_method: 'card',
      description: 'Partially refunded payment',
      metadata: {},
      failure_reason: null,
      refund_status: 'partial',
      refunded_amount: refundedAmount,
      refund_reason: randomChoice(REFUND_REASONS),
      refunded_at: daysAgo(refundedDaysAgo).toISOString(),
      paid_at: daysAgo(refundedDaysAgo + randomInt(7, 30)).toISOString(),
      created_at: daysAgo(refundedDaysAgo + randomInt(7, 30)).toISOString(),
    });
  }

  // 7c. Add journey payments from lead customer journeys (Section 5a)
  console.log(`   ✓ Adding ${journeyPayments.length} payments from lead customer journeys`);
  transactions.push(...journeyPayments);

  const { error: transactionsError } = await supabase.from('payment_transactions').insert(transactions);
  if (transactionsError) {
    console.error('   ❌ Error inserting transactions:', transactionsError.message);
  } else {
    const linkedCount = completedPaidBookings.length;
    const standaloneCount = transactions.length - linkedCount;
    console.log(`   ✓ Created ${transactions.length} transactions`);
    console.log(`      - Linked to bookings: ${linkedCount}`);
    console.log(`      - Standalone (failed/pending/refunded): ${standaloneCount}`);
  }

  // 7c. Update bookings with payment_id links (Phase A Quick Fix)
  const bookingsWithPayments = bookings.filter(b => b.payment_id);
  if (bookingsWithPayments.length > 0) {
    for (const booking of bookingsWithPayments) {
      const { error: updateError } = await supabase
        .from('scheduling_bookings')
        .update({ payment_id: booking.payment_id })
        .eq('id', booking.id);

      if (updateError) {
        console.error(`   ⚠️  Failed to link booking ${booking.id} to payment`, updateError.message);
      }
    }
    console.log(`   ✓ Linked ${bookingsWithPayments.length} bookings to payments`);
  }

  // ============================================================
  // 8. CREATE SAVED PAYMENT METHODS (20 cards)
  // ============================================================
  console.log('\n💳 Creating saved payment methods...');

  const paymentMethods: Array<{
    id: string;
    user_id: string;
    contact_id: string;
    processor_type: string;
    processor_customer_id: string;
    processor_method_id: string;
    method_type: string;
    brand: string;
    last_four: string;
    expiry_month: number;
    expiry_year: number;
    is_default: boolean;
    is_valid: boolean;
    created_at: string;
  }> = [];

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  // Expiring this month (6)
  for (let i = 0; i < 6; i++) {
    paymentMethods.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      processor_type: 'stripe',
      processor_customer_id: `cus_mock_${uuid().slice(0, 8)}`,
      processor_method_id: `pm_mock_${uuid().slice(0, 8)}`,
      method_type: 'card',
      brand: randomChoice(['visa', 'mastercard', 'amex']),
      last_four: String(randomInt(1000, 9999)),
      expiry_month: currentMonth,
      expiry_year: currentYear,
      is_default: i === 0,
      is_valid: true,
      created_at: daysAgo(randomInt(30, 180)).toISOString(),
    });
  }

  // Expiring next month (3)
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextMonthYear = currentMonth === 12 ? currentYear + 1 : currentYear;
  for (let i = 0; i < 3; i++) {
    paymentMethods.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      processor_type: 'stripe',
      processor_customer_id: `cus_mock_${uuid().slice(0, 8)}`,
      processor_method_id: `pm_mock_${uuid().slice(0, 8)}`,
      method_type: 'card',
      brand: randomChoice(['visa', 'mastercard']),
      last_four: String(randomInt(1000, 9999)),
      expiry_month: nextMonth,
      expiry_year: nextMonthYear,
      is_default: false,
      is_valid: true,
      created_at: daysAgo(randomInt(30, 180)).toISOString(),
    });
  }

  // Valid cards (8)
  for (let i = 0; i < 8; i++) {
    paymentMethods.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      processor_type: 'stripe',
      processor_customer_id: `cus_mock_${uuid().slice(0, 8)}`,
      processor_method_id: `pm_mock_${uuid().slice(0, 8)}`,
      method_type: 'card',
      brand: randomChoice(['visa', 'mastercard', 'amex', 'discover']),
      last_four: String(randomInt(1000, 9999)),
      expiry_month: randomInt(1, 12),
      expiry_year: currentYear + randomInt(1, 3),
      is_default: false,
      is_valid: true,
      created_at: daysAgo(randomInt(30, 180)).toISOString(),
    });
  }

  // Expired cards (3)
  for (let i = 0; i < 3; i++) {
    const expMonth = randomInt(1, 12);
    const expYear = currentYear - randomInt(1, 2);
    paymentMethods.push({
      id: uuid(),
      user_id: userId,
      contact_id: randomChoice(contactIds),
      processor_type: 'stripe',
      processor_customer_id: `cus_mock_${uuid().slice(0, 8)}`,
      processor_method_id: `pm_mock_${uuid().slice(0, 8)}`,
      method_type: 'card',
      brand: randomChoice(['visa', 'mastercard']),
      last_four: String(randomInt(1000, 9999)),
      expiry_month: expMonth,
      expiry_year: expYear,
      is_default: false,
      is_valid: false, // Expired cards are invalid
      created_at: daysAgo(randomInt(180, 365)).toISOString(),
    });
  }

  const { error: paymentMethodsError } = await supabase.from('saved_payment_methods').insert(paymentMethods);
  if (paymentMethodsError) {
    console.error('   ❌ Error inserting payment methods:', paymentMethodsError.message);
  } else {
    console.log(`   ✓ Created ${paymentMethods.length} payment methods`);
    console.log(`      - Expiring this month: 6`);
    console.log(`      - Expiring next month: 3`);
    console.log(`      - Valid: 8`);
    console.log(`      - Expired: 3`);
  }

  // ============================================================
  // 9. CREATE WEBSITE PAGES AND PAGE VIEWS (500 page views)
  // ============================================================
  console.log('\n🌐 Creating website pages and page views...');

  // First, check for existing pages or create them
  const { data: existingPages } = await supabase
    .from('website_pages')
    .select('id, slug')
    .eq('user_id', userId);

  let pageIdMap: Map<string, string> = new Map();

  if (existingPages && existingPages.length > 0) {
    // Use existing pages
    existingPages.forEach(p => pageIdMap.set(p.slug, p.id));
    console.log(`   ℹ️  Using ${existingPages.length} existing website pages`);
  } else {
    // Create pages
    const pageSlugs = ['/', '/services', '/pricing', '/about', '/contact'];
    const pageDefinitions = pageSlugs.map((slug, idx) => ({
      id: uuid(),
      user_id: userId,
      page_type: slug === '/' ? 'homepage' : 'landing',
      slug,
      title: slug === '/' ? 'Home' : slug.slice(1).charAt(0).toUpperCase() + slug.slice(2),
      published: true,
      published_at: daysAgo(90).toISOString(),
      created_at: daysAgo(90).toISOString(),
      updated_at: daysAgo(idx).toISOString(),
    }));

    const { error: pagesError } = await supabase.from('website_pages').insert(pageDefinitions);
    if (pagesError) {
      console.error('   ❌ Error inserting pages:', pagesError.message);
      console.log('   ⏭️  Skipping page views (no pages available)');
    } else {
      pageDefinitions.forEach(p => pageIdMap.set(p.slug, p.id));
      console.log(`   ✓ Created ${pageDefinitions.length} website pages`);
    }
  }

  // Only create page views if we have pages
  if (pageIdMap.size > 0) {
    const pageViews: Array<{
      id: string;
      page_id: string;
      user_id: string;
      subdomain: string;
      ip_hash: string;
      device_type: string;
      referer: string | null;
      viewed_at: string;
    }> = [];

    const pageSlugs = ['/', '/services', '/pricing', '/about', '/contact'];
    const pageWeights = [0.40, 0.25, 0.15, 0.10, 0.10]; // Distribution

    const getWeightedPageId = () => {
      const rand = Math.random();
      let cumulative = 0;
      for (let i = 0; i < pageSlugs.length; i++) {
        cumulative += pageWeights[i];
        if (rand <= cumulative) {
          return pageIdMap.get(pageSlugs[i]) || pageIdMap.values().next().value;
        }
      }
      return pageIdMap.get('/') || pageIdMap.values().next().value;
    };

    const getContactPageId = () => pageIdMap.get('/contact') || pageIdMap.values().next().value;

    // Generate unique visitor IDs for realistic unique visitor counting
    const visitorPool: string[] = [];
    for (let i = 0; i < 200; i++) {
      visitorPool.push(generateIpHash());
    }

    // Current week - desktop (80)
    for (let i = 0; i < 80; i++) {
      const isContactPage = i < 4; // Contact page visits (for conversion tracking)
      pageViews.push({
        id: uuid(),
        page_id: isContactPage ? getContactPageId() : getWeightedPageId(),
        user_id: userId,
        subdomain,
        ip_hash: randomChoice(visitorPool.slice(0, 100)),
        device_type: 'desktop',
        referer: randomChoice(['https://google.com', 'direct', 'https://facebook.com', null]),
        viewed_at: daysAgo(randomInt(0, 6), randomInt(0, 23)).toISOString(),
      });
    }

    // Current week - mobile (60)
    for (let i = 0; i < 60; i++) {
      const isContactPage = i === 0;
      pageViews.push({
        id: uuid(),
        page_id: isContactPage ? getContactPageId() : getWeightedPageId(),
        user_id: userId,
        subdomain,
        ip_hash: randomChoice(visitorPool.slice(0, 100)),
        device_type: 'mobile',
        referer: randomChoice(['https://google.com', 'https://instagram.com', 'https://facebook.com', null]),
        viewed_at: daysAgo(randomInt(0, 6), randomInt(0, 23)).toISOString(),
      });
    }

    // Previous week - desktop (130) - baseline
    for (let i = 0; i < 130; i++) {
      const isContactPage = i < 7;
      pageViews.push({
        id: uuid(),
        page_id: isContactPage ? getContactPageId() : getWeightedPageId(),
        user_id: userId,
        subdomain,
        ip_hash: randomChoice(visitorPool.slice(100, 200)),
        device_type: 'desktop',
        referer: randomChoice(['https://google.com', 'direct', 'https://facebook.com', null]),
        viewed_at: daysAgo(randomInt(7, 13), randomInt(0, 23)).toISOString(),
      });
    }

    // Previous week - mobile (90)
    for (let i = 0; i < 90; i++) {
      const isContactPage = i < 5;
      pageViews.push({
        id: uuid(),
        page_id: isContactPage ? getContactPageId() : getWeightedPageId(),
        user_id: userId,
        subdomain,
        ip_hash: randomChoice(visitorPool.slice(100, 200)),
        device_type: 'mobile',
        referer: randomChoice(['https://google.com', 'https://instagram.com', 'https://facebook.com', null]),
        viewed_at: daysAgo(randomInt(7, 13), randomInt(0, 23)).toISOString(),
      });
    }

    // Older historical (140)
    for (let i = 0; i < 140; i++) {
      const isContactPage = i < 7;
      pageViews.push({
        id: uuid(),
        page_id: isContactPage ? getContactPageId() : getWeightedPageId(),
        user_id: userId,
        subdomain,
        ip_hash: randomChoice(visitorPool),
        device_type: randomChoice(['desktop', 'mobile', 'tablet']),
        referer: randomChoice(['https://google.com', 'direct', 'https://facebook.com', 'https://instagram.com', null]),
        viewed_at: daysAgo(randomInt(14, 30), randomInt(0, 23)).toISOString(),
      });
    }

    const { error: pageViewsError } = await supabase.from('website_page_views').insert(pageViews);
    if (pageViewsError) {
      console.error('   ❌ Error inserting page views:', pageViewsError.message);
    } else {
      console.log(`   ✓ Created ${pageViews.length} page views`);
      console.log(`      - This week desktop: 80`);
      console.log(`      - This week mobile: 60`);
      console.log(`      - Last week desktop: 130`);
      console.log(`      - Last week mobile: 90`);
      console.log(`      - Historical: 140`);
      console.log(`      - Traffic drop: ~36% (140 this week vs 220 last week)`);
    }
  }

  // ============================================================
  // 10. CREATE BUSINESS EVENTS (100 events)
  // ============================================================
  console.log('\n📊 Creating business events...');

  const businessEvents: Array<{
    id: string;
    user_id: string;
    event_type: string;
    category: string;
    entity_type: string;
    entity_id: string;
    source_capability: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }> = [];

  // Booking created events (30)
  for (let i = 0; i < 30; i++) {
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'booking_created',
      category: 'operations',
      entity_type: 'booking',
      entity_id: bookingIds[i % bookingIds.length] || uuid(),
      source_capability: 'scheduling',
      metadata: { source: randomChoice(['widget', 'manual']) },
      created_at: daysAgo(randomInt(0, 60)).toISOString(),
    });
  }

  // Booking completed events (25)
  for (let i = 0; i < 25; i++) {
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'booking_completed',
      category: 'operations',
      entity_type: 'booking',
      entity_id: bookingIds[i % bookingIds.length] || uuid(),
      source_capability: 'scheduling',
      metadata: {},
      created_at: daysAgo(randomInt(0, 30)).toISOString(),
    });
  }

  // Booking cancelled events (14)
  for (let i = 0; i < 14; i++) {
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'booking_cancelled',
      category: 'retention',
      entity_type: 'booking',
      entity_id: bookingIds[(45 + i) % bookingIds.length] || uuid(),
      source_capability: 'scheduling',
      metadata: { reason: randomChoice(CANCELLATION_REASONS) },
      created_at: daysAgo(randomInt(0, 14)).toISOString(),
    });
  }

  // Payment received events (20)
  for (let i = 0; i < 20; i++) {
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'payment_received',
      category: 'cash_flow',
      entity_type: 'payment',
      entity_id: uuid(),
      source_capability: 'payments',
      metadata: { amount: randomFloat(50, 300) },
      created_at: daysAgo(randomInt(0, 30)).toISOString(),
    });
  }

  // Enquiry received events (10) - for sales_stalled detector
  const enquiryIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const enquiryId = uuid();
    enquiryIds.push(enquiryId);
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'enquiry_received',
      category: 'conversion',
      entity_type: 'enquiry',
      entity_id: enquiryId,
      source_capability: 'website',
      metadata: { source: 'website_form' },
      created_at: hoursAgo(randomInt(24, 96)).toISOString(), // 24-96 hours ago
    });
  }

  // Enquiry replied events (6) - 4 stalled enquiries
  for (let i = 0; i < 6; i++) {
    businessEvents.push({
      id: uuid(),
      user_id: userId,
      event_type: 'enquiry_replied',
      category: 'conversion',
      entity_type: 'enquiry',
      entity_id: enquiryIds[i],
      source_capability: 'crm',
      metadata: {},
      created_at: hoursAgo(randomInt(1, 12)).toISOString(), // Replied within 12 hours
    });
  }

  const { error: eventsError } = await supabase.from('business_events').insert(businessEvents);
  if (eventsError) {
    console.error('   ❌ Error inserting business events:', eventsError.message);
  } else {
    console.log(`   ✓ Created ${businessEvents.length} business events`);
    console.log(`      - Booking created: 30`);
    console.log(`      - Booking completed: 25`);
    console.log(`      - Booking cancelled: 14`);
    console.log(`      - Payment received: 20`);
    console.log(`      - Enquiry received: 10`);
    console.log(`      - Enquiry replied: 6 (4 stalled)`);
  }

  // ============================================================
  // 11. CREATE DERIVED METRICS (baselines)
  // ============================================================
  console.log('\n📈 Creating derived metrics...');

  const derivedMetrics = [
    {
      id: uuid(),
      user_id: userId,
      metric_key: 'operations.calendar_utilization',
      period_type: 'weekly',
      period_start: daysAgo(7).toISOString(),
      period_end: daysAgo(0).toISOString(),
      value: 0.45, // 45% - below 50% threshold
      unit: 'percentage',
      sample_size: 35, // Number of booking slots analyzed
      computed_at: daysAgo(0).toISOString(),
    },
    {
      id: uuid(),
      user_id: userId,
      metric_key: 'retention.no_show_rate',
      period_type: 'monthly',
      period_start: daysAgo(30).toISOString(),
      period_end: daysAgo(0).toISOString(),
      value: 0.08, // 8% baseline
      unit: 'percentage',
      sample_size: 80, // Number of bookings
      computed_at: daysAgo(0).toISOString(),
    },
    {
      id: uuid(),
      user_id: userId,
      metric_key: 'retention.no_show_rate_stddev',
      period_type: 'monthly',
      period_start: daysAgo(90).toISOString(),
      period_end: daysAgo(0).toISOString(),
      value: 0.02, // 2% stddev
      unit: 'percentage',
      sample_size: 3, // 3 months of data
      std_deviation: 0.02,
      computed_at: daysAgo(0).toISOString(),
    },
    {
      id: uuid(),
      user_id: userId,
      metric_key: 'sales.avg_reply_time_hours',
      period_type: 'monthly',
      period_start: daysAgo(30).toISOString(),
      period_end: daysAgo(0).toISOString(),
      value: 4, // 4 hours baseline
      unit: 'hours',
      sample_size: 50, // Number of enquiries
      computed_at: daysAgo(0).toISOString(),
    },
    {
      id: uuid(),
      user_id: userId,
      metric_key: 'sales.avg_reply_time_stddev',
      period_type: 'monthly',
      period_start: daysAgo(90).toISOString(),
      period_end: daysAgo(0).toISOString(),
      value: 1.5, // 1.5 hours stddev
      unit: 'hours',
      sample_size: 3, // 3 months of data
      std_deviation: 1.5,
      computed_at: daysAgo(0).toISOString(),
    },
  ];

  const { error: metricsError } = await supabase.from('derived_metrics').insert(derivedMetrics);
  if (metricsError) {
    console.error('   ❌ Error inserting derived metrics:', metricsError.message);
  } else {
    console.log(`   ✓ Created ${derivedMetrics.length} derived metrics`);
  }

  // ============================================================
  // 12. CREATE STRIPE CONNECT ACCOUNT (payout blocked)
  // ============================================================
  console.log('\n🔗 Creating Stripe Connect account (payout blocked)...');

  const stripeAccount = {
    id: uuid(),
    user_id: userId,
    stripe_account_id: `acct_mock_blocked_${uuid().slice(0, 8)}`,
    stripe_account_type: 'express',
    charges_enabled: true, // Can accept payments
    payouts_enabled: false, // BLOCKED - triggers detector
    details_submitted: true,
    onboarding_completed: true,
    country: 'US',
    currency: 'USD',
    created_at: daysAgo(30).toISOString(),
    updated_at: daysAgo(0).toISOString(),
  };

  const { error: stripeError } = await supabase.from('stripe_connect_accounts').insert(stripeAccount);
  if (stripeError) {
    console.error('   ❌ Error inserting Stripe account:', stripeError.message);
  } else {
    console.log(`   ✓ Created Stripe Connect account (payouts BLOCKED)`);
  }

  // ============================================================
  // VALIDATION QUERIES (Phase A Quick Fix)
  // ============================================================
  console.log('\n🔍 Validating seed data relationships...\n');

  // Verify all bookings have valid service_id
  const { data: bookingsWithoutService } = await supabase
    .from('scheduling_bookings')
    .select('id')
    .eq('user_id', userId)
    .is('service_id', null);

  if (bookingsWithoutService && bookingsWithoutService.length > 0) {
    console.error(`❌ ${bookingsWithoutService.length} bookings missing service_id`);
  } else {
    console.log(`✅ All bookings have service_id`);
  }

  // Verify all paid bookings have payment_id
  const { data: paidWithoutPayment } = await supabase
    .from('scheduling_bookings')
    .select('id')
    .eq('user_id', userId)
    .eq('payment_status', 'paid')
    .is('payment_id', null);

  if (paidWithoutPayment && paidWithoutPayment.length > 0) {
    console.error(`❌ ${paidWithoutPayment.length} paid bookings missing payment_id`);
  } else {
    console.log(`✅ All paid bookings have payment_id`);
  }

  // Verify all invoices have service_id
  const { data: invoicesWithoutService } = await supabase
    .from('payment_invoices')
    .select('id')
    .eq('user_id', userId)
    .is('service_id', null);

  if (invoicesWithoutService && invoicesWithoutService.length > 0) {
    console.error(`❌ ${invoicesWithoutService.length} invoices missing service_id`);
  } else {
    console.log(`✅ All invoices have service_id`);
  }

  // Verify transaction links
  const { data: allTransactions } = await supabase
    .from('payment_transactions')
    .select('id, metadata')
    .eq('user_id', userId);

  const linkedTransactions = (allTransactions || []).filter(
    t => t.metadata && (t.metadata as Record<string, unknown>).booking_id
  );

  console.log(`✅ ${linkedTransactions.length}/${allTransactions?.length || 0} transactions linked to bookings`);

  console.log('\n✅ Phase A validation complete\n');

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n============================================================');
  console.log('SEED COMPLETE');
  console.log('============================================================');

  console.log('\n📊 Expected Detector Triggers:');
  console.log('\n  Cash Flow:');
  console.log('    • cash_ar_overdue: 5 invoices overdue 7-30 days');
  console.log('    • cash_ar_aging: 7 invoices in aging buckets (3 @ 30-60d, 2 @ 60-90d, 2 @ 90+d)');
  console.log('    • cash_cards_expiring: 6 cards expiring this month');
  console.log('    • cash_refund_pattern: 6 refunds (4 full + 2 partial)');
  console.log('    • cash_payment_issues: 5 failed + 3 pending payments');
  console.log('    • cash_payout_blocked: Stripe payouts disabled');

  console.log('\n  CRM/Conversion:');
  console.log('    • crm_cold_leads: 10 leads with no activity 10-25 days');
  console.log('    • crm_engagement_decay: 10 clients silent 35-60 days');
  console.log('    • conv_followup_overdue: 10 overdue tasks');
  console.log('    • conv_pipeline_stuck: 8 contacts stuck 14+ days');
  console.log('    • conv_source_underperform: facebook_ads (20%) + instagram (15%)');

  console.log('\n  Operations/Retention:');
  console.log('    • ret_cancellation_spike: 12 this week vs 2 last week');
  console.log('    • ret_repeat_booking_low: ~35% repeat rate');
  console.log('    • ret_no_show_spike: 6 no-shows');
  console.log('    • ops_last_minute_cancels: 6 cancelled <24h before');
  console.log('    • ops_service_performance: Quick Consultation only 3 bookings');
  console.log('    • ops_utilization_low: 45% utilization (baseline)');

  console.log('\n  Acquisition/Website:');
  console.log('    • acq_traffic_drop: ~36% decrease week-over-week');
  console.log('    • acq_low_conversion: ~3.5% overall (mobile 1.5%)');
  console.log('    • web_mobile_issues: Mobile 1.5% vs Desktop 5%');

  console.log('\n  Pricing:');
  console.log('    • pricing_discount_abuse: 8 transactions with discounts');
  console.log('    • pricing_intro_offer_stuck: 5 intro bookings, low conversion');

  console.log('\n  Sales:');
  console.log('    • sales_stalled: 4 enquiries without reply 48+ hours');

  console.log('\n🚀 Run insight detection:');
  console.log(`  DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/run-insight-detection.ts ${userId}`);
  console.log('');
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function main() {
  let userId = process.argv[2];

  if (!userId) {
    // Try to get an existing user
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (profiles?.[0]) {
      userId = profiles[0].id;
    } else {
      console.error('No users found. Please provide a userId as argument.');
      console.error('Usage: npx tsx scripts/seed-insight-test-data.ts <userId>');
      process.exit(1);
    }
  }

  await seedData(userId);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
