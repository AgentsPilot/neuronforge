// app/api/admin/user-emails/route.ts
// Lightweight endpoint to fetch user emails by user IDs for admin pages

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

// Mark as dynamic since it uses request.url
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { userIds } = await request.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: 'userIds array is required' },
        { status: 400 }
      );
    }

    // Fetch all users from auth using admin API
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      console.error('Error fetching auth users:', authError);
      return NextResponse.json(
        { error: 'Failed to fetch user emails', details: authError.message },
        { status: 500 }
      );
    }

    // Filter to only the requested user IDs and map to email
    const userEmailMap: Record<string, string> = {};

    authData.users.forEach(user => {
      if (userIds.includes(user.id)) {
        userEmailMap[user.id] = user.email || 'N/A';
      }
    });

    return NextResponse.json({
      success: true,
      data: userEmailMap,
    });

  } catch (error) {
    console.error('Admin user-emails API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
