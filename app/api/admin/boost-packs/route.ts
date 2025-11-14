// app/api/admin/boost-packs/route.ts
// Admin API for managing boost packs

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Fetch all boost packs
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from('boost_packs')
      .select('*')
      .order('price_usd', { ascending: true });

    if (error) {
      console.error('[BoostPacks] Error fetching boost packs:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('[BoostPacks] Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Unexpected error occurred'
    }, { status: 500 });
  }
}

// POST - Create new boost pack
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      pack_key,
      pack_name,
      display_name,
      description,
      price_usd,
      bonus_percentage,
      credits_amount,
      bonus_credits,
      badge_text,
      is_active
    } = body;

    // Validate required fields
    if (!pack_key || !pack_name || !display_name || !description) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields'
      }, { status: 400 });
    }

    // Insert boost pack
    const { data, error } = await supabaseAdmin
      .from('boost_packs')
      .insert({
        pack_key,
        pack_name,
        display_name,
        description,
        price_usd,
        bonus_percentage,
        credits_amount,
        bonus_credits,
        badge_text,
        is_active
      })
      .select()
      .single();

    if (error) {
      console.error('[BoostPacks] Error creating boost pack:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    console.log(`[BoostPacks] Created boost pack: ${pack_name} (${pack_key})`);

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('[BoostPacks] Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Unexpected error occurred'
    }, { status: 500 });
  }
}

// PUT - Update boost pack
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      id,
      pack_key,
      pack_name,
      display_name,
      description,
      price_usd,
      bonus_percentage,
      credits_amount,
      bonus_credits,
      badge_text,
      is_active
    } = body;

    // Validate required fields
    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'Missing boost pack ID'
      }, { status: 400 });
    }

    // Update boost pack
    const { data, error } = await supabaseAdmin
      .from('boost_packs')
      .update({
        pack_key,
        pack_name,
        display_name,
        description,
        price_usd,
        bonus_percentage,
        credits_amount,
        bonus_credits,
        badge_text,
        is_active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[BoostPacks] Error updating boost pack:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    console.log(`[BoostPacks] Updated boost pack: ${pack_name} (${pack_key})`);

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('[BoostPacks] Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Unexpected error occurred'
    }, { status: 500 });
  }
}

// DELETE - Delete boost pack
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'Missing boost pack ID'
      }, { status: 400 });
    }

    // Delete boost pack
    const { error } = await supabaseAdmin
      .from('boost_packs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[BoostPacks] Error deleting boost pack:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    console.log(`[BoostPacks] Deleted boost pack: ${id}`);

    return NextResponse.json({
      success: true
    });

  } catch (error: any) {
    console.error('[BoostPacks] Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Unexpected error occurred'
    }, { status: 500 });
  }
}
