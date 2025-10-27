// app/api/check-user-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if environment variables are set
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing environment variables:', {
        hasUrl: !!process.env.SUPABASE_URL,
        hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Use service role to access auth.users table and profiles
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get all users from auth.users and find by email
    // Email is stored in auth.users, not in profiles table
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      console.error('Error listing users:', usersError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    // Find user by email (case-insensitive)
    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      // User doesn't exist in auth.users
      return NextResponse.json({
        exists: false,
        onboardingCompleted: null
      });
    }

    // User exists, now get their profile to check onboarding status
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('onboarding')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    // Return user exists with onboarding status
    // If no profile exists yet, onboarding is null (user confirmed email but didn't complete onboarding)
    return NextResponse.json({
      exists: true,
      onboardingCompleted: profile?.onboarding ?? null
    });

  } catch (error) {
    console.error('Error in check-user-status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
