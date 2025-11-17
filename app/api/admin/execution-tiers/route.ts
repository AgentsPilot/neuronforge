// API route for managing execution tiers (admin only)
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data: configs, error } = await supabaseAdmin
      .from('ais_system_config')
      .select('config_key, config_value, description, updated_at')
      .like('config_key', 'executions_tokens_%')
      .order('config_key', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data: configs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { minTokens, executionsQuota } = body;

    if (!minTokens || executionsQuota === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const configKey = `executions_tokens_${minTokens}`;
    const configValue = executionsQuota.toLowerCase() === 'unlimited' ? 'null' : executionsQuota;

    const { error } = await supabaseAdmin
      .from('ais_system_config')
      .insert({
        config_key: configKey,
        config_value: configValue,
        category: 'executions',
        description: `Execution quota for ${minTokens.toLocaleString()}+ pilot tokens`,
      });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { configKey, executionsQuota } = body;

    if (!configKey || executionsQuota === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const configValue = executionsQuota.toLowerCase() === 'unlimited' ? 'null' : executionsQuota;

    const { error } = await supabaseAdmin
      .from('ais_system_config')
      .update({
        config_value: configValue,
        updated_at: new Date().toISOString(),
      })
      .eq('config_key', configKey);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const configKey = searchParams.get('configKey');

    if (!configKey) {
      return NextResponse.json(
        { error: 'Missing configKey parameter' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('ais_system_config')
      .delete()
      .eq('config_key', configKey);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
