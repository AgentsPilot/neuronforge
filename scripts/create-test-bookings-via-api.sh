#!/bin/bash

# This script creates test bookings via the API for the current week
# Run this to populate the calendar with visible bookings

echo "Creating test bookings for current week via API..."
echo ""

# You need to be logged in and get your session cookie from the browser
# Open DevTools -> Application -> Cookies -> Copy the value of sb-access-token

echo "⚠️  This script requires authentication."
echo "Please run the migration instead or create bookings manually through the UI."
echo ""
echo "Alternative: Apply the migration file directly:"
echo "  supabase/migrations/20260807_add_current_week_bookings.sql"
