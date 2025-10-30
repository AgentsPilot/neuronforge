import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  logAIPricingCreated,
  logAIPricingUpdated,
  logAIPricingDeleted
} from '@/lib/audit/admin-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/admin/system-config/pricing
 * Fetch all AI model pricing information
 */
export async function GET() {
  try {
    // Fetch all AI model pricing
    const { data: pricing, error: pricingError } = await supabase
      .from('ai_model_pricing')
      .select('*')
      .order('provider', { ascending: true })
      .order('model_name', { ascending: true });

    if (pricingError) {
      console.error('[API] Pricing query error:', pricingError);
      throw pricingError;
    }

    console.log('[API] Fetched pricing models:', pricing?.length || 0);

    return NextResponse.json({
      success: true,
      data: pricing || []
    });

  } catch (error) {
    console.error('[API] Error fetching pricing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch pricing information'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/system-config/pricing
 * Update AI model pricing
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, input_cost_per_token, output_cost_per_token } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: id' },
        { status: 400 }
      );
    }

    if (input_cost_per_token === undefined && output_cost_per_token === undefined) {
      return NextResponse.json(
        { success: false, error: 'At least one cost field must be provided' },
        { status: 400 }
      );
    }

    // Get old pricing before updating
    const { data: oldPricing } = await supabase
      .from('ai_model_pricing')
      .select('*')
      .eq('id', id)
      .single();

    // Update pricing
    const updates: any = {};
    if (input_cost_per_token !== undefined) updates.input_cost_per_token = input_cost_per_token;
    if (output_cost_per_token !== undefined) updates.output_cost_per_token = output_cost_per_token;

    const { data, error } = await supabase
      .from('ai_model_pricing')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[API] Pricing update error:', error);
      throw error;
    }

    console.log('[API] Updated pricing for model:', data.model_name);

    // Log the update
    await logAIPricingUpdated(
      null, // TODO: Get real user ID from session
      id,
      data.model_name,
      {
        before: oldPricing,
        after: data
      }
    );

    return NextResponse.json({
      success: true,
      data: data,
      message: 'Pricing updated successfully'
    });

  } catch (error) {
    console.error('[API] Error updating pricing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update pricing'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/system-config/pricing
 * Create new AI model pricing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, model_name, input_cost_per_token, output_cost_per_token, effective_date } = body;

    if (!provider || !model_name || input_cost_per_token === undefined || output_cost_per_token === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: provider, model_name, input_cost_per_token, output_cost_per_token' },
        { status: 400 }
      );
    }

    // Create new pricing
    const { data, error } = await supabase
      .from('ai_model_pricing')
      .insert({
        provider,
        model_name,
        input_cost_per_token,
        output_cost_per_token,
        effective_date: effective_date || new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Pricing create error:', error);
      throw error;
    }

    console.log('[API] Created pricing for model:', data.model_name);

    // Log the creation
    await logAIPricingCreated(
      null, // TODO: Get real user ID from session
      {
        id: data.id,
        provider: data.provider,
        model_name: data.model_name,
        input_cost_per_token: data.input_cost_per_token,
        output_cost_per_token: data.output_cost_per_token
      }
    );

    return NextResponse.json({
      success: true,
      data: data,
      message: 'Pricing created successfully'
    });

  } catch (error) {
    console.error('[API] Error creating pricing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create pricing'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/system-config/pricing
 * Delete AI model pricing
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: id' },
        { status: 400 }
      );
    }

    // Get pricing data before deleting
    const { data: pricingToDelete } = await supabase
      .from('ai_model_pricing')
      .select('*')
      .eq('id', id)
      .single();

    // Delete pricing
    const { error } = await supabase
      .from('ai_model_pricing')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[API] Pricing delete error:', error);
      throw error;
    }

    console.log('[API] Deleted pricing with id:', id);

    // Log the deletion
    if (pricingToDelete) {
      await logAIPricingDeleted(
        null, // TODO: Get real user ID from session
        id,
        pricingToDelete.model_name,
        pricingToDelete
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Pricing deleted successfully'
    });

  } catch (error) {
    console.error('[API] Error deleting pricing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pricing'
      },
      { status: 500 }
    );
  }
}
