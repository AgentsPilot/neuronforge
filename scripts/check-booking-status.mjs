/**
 * What does a booking row actually hold?
 *
 * Read-only. `scheduling_bookings.status` is NOT NULL DEFAULT 'confirmed' with
 * values confirmed/cancelled/completed/no_show; `payment_status` is the one
 * that defaults to 'pending'. If the UI shows "Awaiting payment" for a free
 * service, this says which column is carrying the value.
 *
 *   node scripts/check-booking-status.mjs <bookingId>
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const id = process.argv[2];

if (!id) {
  console.error('Usage: node scripts/check-booking-status.mjs <bookingId>');
  process.exit(1);
}

const { data: booking, error } = await db
  .from('scheduling_bookings')
  .select('*')
  .eq('id', id)
  .maybeSingle();

if (error) { console.error('Read failed:', error.message); process.exit(1); }
if (!booking) { console.error('No such booking'); process.exit(1); }

console.log('BOOKING');
console.log('  status          :', JSON.stringify(booking.status), '  <- confirmed | cancelled | completed | no_show');
console.log('  payment_status  :', JSON.stringify(booking.payment_status), '  <- pending | paid | refunded');
console.log('  price-ish cols  :', Object.keys(booking).filter(k => /price|amount|total|paid/i.test(k)).map(k => `${k}=${booking[k]}`).join(', ') || '(none)');

if (booking.service_id) {
  const { data: service } = await db
    .from('scheduling_services')
    .select('service_name, price, currency, collection, sale_mode')
    .eq('id', booking.service_id)
    .maybeSingle();

  console.log('\nSERVICE');
  console.log('  name       :', service?.service_name);
  console.log('  price      :', service?.price, service?.currency ?? '');
  console.log('  collection :', JSON.stringify(service?.collection), '  <- null means nothing to collect');
  console.log('  sale_mode  :', JSON.stringify(service?.sale_mode));

  const free = !service?.price || Number(service.price) === 0;
  console.log('\nVERDICT');
  console.log('  free service            :', free);
  console.log('  shows "Awaiting payment":', booking.status === 'pending' || booking.payment_status === 'pending');
  if (free && booking.payment_status === 'pending') {
    console.log('  → payment_status sits at its DEFAULT because there is nothing to pay.');
  }
}
