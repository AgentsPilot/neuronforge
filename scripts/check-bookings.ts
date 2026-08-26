import { supabaseServer } from '../lib/supabaseServer';

async function checkBookings() {
  // Query for bookings around 14:30 UTC on 2026-08-07
  const { data: bookings, error } = await supabaseServer
    .from('scheduling_bookings')
    .select('*')
    .gte('start_time', '2026-08-07T14:00:00.000Z')
    .lte('start_time', '2026-08-07T15:00:00.000Z')
    .neq('status', 'cancelled')
    .neq('status', 'no_show');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== Bookings between 14:00-15:00 UTC on 2026-08-07 ===');
  console.log(`Found ${bookings?.length || 0} bookings:\n`);

  bookings?.forEach((booking, index) => {
    console.log(`${index + 1}. Booking ID: ${booking.id}`);
    console.log(`   Client: ${booking.client_first_name} ${booking.client_last_name || ''}`);
    console.log(`   Start: ${booking.start_time}`);
    console.log(`   End: ${booking.end_time}`);
    console.log(`   Status: ${booking.status}`);
    console.log('');
  });
}

checkBookings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
