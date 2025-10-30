import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  logRewardConfigCreated,
  logRewardConfigUpdated,
  logRewardConfigDeleted,
  logRewardConfigToggled
} from '@/lib/audit/admin-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Fetch all reward configurations
    const { data: rewards, error } = await supabase
      .from('reward_config')
      .select('*')
      .order('reward_key');

    if (error) {
      console.error('Error fetching reward config:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Fetch default credits from pricing_config
    const { data: defaultCreditsData } = await supabase
      .from('pricing_config')
      .select('config_value')
      .eq('config_key', 'default_reward_credits')
      .single();

    const defaultCredits = defaultCreditsData?.config_value || 100;

    return NextResponse.json({
      success: true,
      rewards: rewards || [],
      defaultCredits
    });
  } catch (error: any) {
    console.error('Exception in GET /api/admin/reward-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, rewardId, updates } = body;

    if (action === 'update') {
      if (!rewardId || !updates) {
        return NextResponse.json(
          { success: false, error: 'Missing rewardId or updates' },
          { status: 400 }
        );
      }

      // Get old reward data before updating
      const { data: oldReward } = await supabase
        .from('reward_config')
        .select('*')
        .eq('id', rewardId)
        .single();

      // Update the reward configuration
      const { data, error } = await supabase
        .from('reward_config')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', rewardId)
        .select()
        .single();

      if (error) {
        console.error('Error updating reward config:', error);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      // Log the update - special handling for toggle vs full update
      if (oldReward && updates.is_active !== undefined && Object.keys(updates).length === 1) {
        // This is just a toggle action
        await logRewardConfigToggled(
          null, // TODO: Get real user ID from session
          rewardId,
          data.reward_name,
          oldReward.is_active,
          updates.is_active
        );
      } else {
        // This is a full update
        await logRewardConfigUpdated(
          null, // TODO: Get real user ID from session
          rewardId,
          data.reward_name,
          {
            before: oldReward,
            after: data
          }
        );
      }

      return NextResponse.json({
        success: true,
        reward: data
      });
    }

    if (action === 'create') {
      if (!updates) {
        return NextResponse.json(
          { success: false, error: 'Missing reward data' },
          { status: 400 }
        );
      }

      // Create new reward configuration
      const { data, error } = await supabase
        .from('reward_config')
        .insert(updates)
        .select()
        .single();

      if (error) {
        console.error('Error creating reward config:', error);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      // Log the creation
      await logRewardConfigCreated(
        null, // TODO: Get real user ID from session
        {
          id: data.id,
          reward_key: data.reward_key,
          reward_name: data.reward_name,
          credits_amount: data.credits_amount,
          is_active: data.is_active
        }
      );

      return NextResponse.json({
        success: true,
        reward: data
      });
    }

    if (action === 'delete') {
      if (!rewardId) {
        return NextResponse.json(
          { success: false, error: 'Missing rewardId' },
          { status: 400 }
        );
      }

      // Get reward data before deleting
      const { data: rewardToDelete } = await supabase
        .from('reward_config')
        .select('*')
        .eq('id', rewardId)
        .single();

      // Delete the reward configuration
      const { error } = await supabase
        .from('reward_config')
        .delete()
        .eq('id', rewardId);

      if (error) {
        console.error('Error deleting reward config:', error);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      // Log the deletion
      if (rewardToDelete) {
        await logRewardConfigDeleted(
          null, // TODO: Get real user ID from session
          rewardId,
          rewardToDelete.reward_name,
          rewardToDelete
        );
      }

      return NextResponse.json({
        success: true
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Exception in POST /api/admin/reward-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
