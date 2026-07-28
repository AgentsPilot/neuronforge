/**
 * Root Booking Page Redirect
 * This page handles direct access to /book without a subdomain
 * Redirects users to find the correct booking page
 */

import { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Booking',
  description: 'Book an appointment'
};

export default function BookingRootPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-6">
          <Calendar className="w-8 h-8 text-blue-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Booking Page Not Found
        </h1>

        <p className="text-gray-600 mb-8">
          This booking link appears to be incomplete. To book an appointment,
          please visit the business&apos;s website directly or use their complete booking link.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go to Homepage
        </Link>
      </div>
    </main>
  );
}
