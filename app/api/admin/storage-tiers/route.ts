// API route for managing storage tiers (admin only)
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StorageTiersAdminAPI' });
export async function GET() {
  // No request object on this handler, so the correlation id is generated
  // rather than propagated.
  const requestLogger = logger.child({ correlationId: crypto.randomUUID() });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: configs, error } = await supabaseAdmin
      .from('ais_system_config')
      .select('config_key, config_value, description, updated_at')
      .like('config_key', 'storage_tokens_%')
      .order('config_key', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data: configs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const body = await request.json();
    const { minTokens, storageMB } = body;

    if (!minTokens || !storageMB) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const configKey = `storage_tokens_${minTokens}`;

    const { error } = await supabaseAdmin
      .from('ais_system_config')
      .insert({
        config_key: configKey,
        config_value: storageMB.toString(),
        category: 'storage',
        description: `Storage quota (MB) for ${minTokens.toLocaleString()}+ LLM tokens`,
      });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const body = await request.json();
    const { configKey, storageMB } = body;

    if (!configKey || !storageMB) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('ais_system_config')
      .update({
        config_value: storageMB.toString(),
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
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

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
