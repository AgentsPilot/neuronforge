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

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [GET] Fetching reward configs with settings...');
    console.log('🔍 [GET] Request URL:', request.url);
    console.log('🔍 [GET] Timestamp:', new Date().toISOString());

    // Force fresh data by using maybeSingle() and explicit ordering
    // This prevents Supabase client-side caching
    const { data: rewards, error } = await supabase
      .from('reward_config')
      .select(`
        *,
        reward_settings!reward_settings_reward_config_id_fkey (
          id,
          min_executions,
          min_success_rate,
          require_description,
          min_description_length,
          min_agent_age_hours,
          max_shares_per_month,
          max_total_shares,
          custom_settings,
          updated_at
        )
      `)
      .order('reward_key');

    if (error) {
      console.error('Error fetching reward config:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log('🔍 [GET] Raw rewards data:', JSON.stringify(rewards, null, 2));

    // Flatten the settings into the reward object for easier access
    const rewardsWithSettings = rewards?.map(reward => {
      console.log(`🔍 [GET] Processing reward ${reward.reward_key}:`, {
        has_reward_settings: !!reward.reward_settings,
        reward_settings_type: Array.isArray(reward.reward_settings) ? 'array' : typeof reward.reward_settings,
        reward_settings_length: Array.isArray(reward.reward_settings) ? reward.reward_settings.length : 'N/A',
        reward_settings_value: reward.reward_settings
      });

      // Handle both object (from foreign key join) and array (from old query style)
      let settings = null;
      if (reward.reward_settings) {
        if (Array.isArray(reward.reward_settings)) {
          // Old style - array of settings
          settings = reward.reward_settings.length > 0 ? reward.reward_settings[0] : null;
        } else if (typeof reward.reward_settings === 'object') {
          // New style - single object from foreign key join
          settings = reward.reward_settings;
        }
      }

      return {
        ...reward,
        settings
      };
    }) || [];

    console.log('🔍 [GET] Rewards with flattened settings:', JSON.stringify(rewardsWithSettings, null, 2));

    // Fetch default credits from pricing_config
    const { data: defaultCreditsData } = await supabase
      .from('pricing_config')
      .select('config_value')
      .eq('config_key', 'default_reward_credits')
      .single();

    const defaultCredits = defaultCreditsData?.config_value || 100;

    return NextResponse.json({
      success: true,
      rewards: rewardsWithSettings,
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
    const { action, rewardId, updates, settings } = body;

    if (action === 'updateSettings') {
      console.log('🔧 [API] updateSettings action received');
      console.log('🔧 [API] rewardId:', rewardId);
      console.log('🔧 [API] settings:', settings);

      if (!rewardId || !settings) {
        return NextResponse.json(
          { success: false, error: 'Missing rewardId or settings' },
          { status: 400 }
        );
      }

      // Check if settings row exists
      const { data: existingSettings, error: checkError } = await supabase
        .from('reward_settings')
        .select('id')
        .eq('reward_config_id', rewardId)
        .single();

      console.log('🔧 [API] Existing settings check:', { existingSettings, checkError });

      let result;
      if (existingSettings) {
        // Update existing settings
        console.log('🔧 [API] Updating existing settings with:', {
          ...settings,
          updated_at: new Date().toISOString()
        });

        const { data, error } = await supabase
          .from('reward_settings')
          .update({
            ...settings,
            updated_at: new Date().toISOString()
          })
          .eq('reward_config_id', rewardId)
          .select()
          .single();

        console.log('🔧 [API] Update result:', { data, error });

        if (error) {
          console.error('❌ [API] Error updating reward settings:', error);
          return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
          );
        }
        result = data;
      } else {
        // Insert new settings
        console.log('🔧 [API] Inserting new settings');

        const { data, error } = await supabase
          .from('reward_settings')
          .insert({
            reward_config_id: rewardId,
            ...settings
          })
          .select()
          .single();

        console.log('🔧 [API] Insert result:', { data, error });

        if (error) {
          console.error('❌ [API] Error creating reward settings:', error);
          return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
          );
        }
        result = data;
      }

      console.log('✅ [API] Returning success with result:', result);

      // Verify the settings were actually saved by querying them back
      const { data: verifySettings, error: verifyError } = await supabase
        .from('reward_settings')
        .select('*')
        .eq('reward_config_id', rewardId)
        .single();

      console.log('🔍 [API] Verification query - settings in DB:', { verifySettings, verifyError });

      return NextResponse.json({
        success: true,
        settings: result
      });
    }

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
