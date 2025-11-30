// /app/api/user/api-keys/route.ts
// User API key management with security audit logging

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  // Format: nf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 chars)
  const prefix = 'nf_live_';
  const randomPart = randomBytes(16).toString('hex'); // 32 hex chars
  return prefix + randomPart;
}

/**
 * Hash API key for storage (first 8 chars visible for identification)
 */
function hashApiKey(apiKey: string): { hash: string; preview: string } {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const preview = apiKey.substring(0, 15) + '...' + apiKey.substring(apiKey.length - 4);
  return { hash, preview };
}

/**
 * GET /api/user/api-keys - List all API keys for the user
 */
export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create service role client for database access
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch user's API keys
    const { data: apiKeys, error } = await serviceSupabase
      .from('user_api_keys')
      .select('id, name, key_preview, created_at, last_used_at, expires_at, is_active')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch API keys:', error);
      return NextResponse.json(
        { error: 'Failed to fetch API keys', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      apiKeys: apiKeys || [],
    });

  } catch (error: any) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json(
      { error: 'Failed to fetch API keys', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/api-keys - Create a new API key
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, expiresInDays } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key name is required' },
        { status: 400 }
      );
    }

    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🔑 [API KEY] User ${user.id} creating new API key: ${name}`);

    // Generate API key
    const apiKey = generateApiKey();
    const { hash, preview } = hashApiKey(apiKey);

    // Calculate expiration
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    // Create service role client for database access
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Store API key
    const { data: keyData, error: insertError } = await serviceSupabase
      .from('user_api_keys')
      .insert({
        user_id: user.id,
        name: name.trim(),
        key_hash: hash,
        key_preview: preview,
        expires_at: expiresAt?.toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id, name, key_preview, created_at, expires_at')
      .single();

    if (insertError) {
      console.error('Failed to create API key:', insertError);
      return NextResponse.json(
        { error: 'Failed to create API key', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(`✅ [API KEY] API key created: ${keyData.id}`);

    // AUDIT TRAIL: Log API key creation
    try {
      await auditLog({
        action: AUDIT_EVENTS.SETTINGS_API_KEY_CREATED,
        entityType: 'api_key',
        entityId: keyData.id,
        userId: user.id,
        resourceName: name,
        details: {
          key_id: keyData.id,
          key_name: name,
          key_preview: preview,
          expires_at: expiresAt?.toISOString() || 'never',
          created_at: new Date().toISOString(),
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'warning', // Security-sensitive operation
        complianceFlags: ['SOC2'],
      });
      console.log('✅ API key creation audited');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'API key created successfully. Make sure to copy it now - you won\'t be able to see it again!',
      apiKey: apiKey, // Only shown once
      keyData: {
        id: keyData.id,
        name: keyData.name,
        key_preview: keyData.key_preview,
        created_at: keyData.created_at,
        expires_at: keyData.expires_at,
      },
    });

  } catch (error: any) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      { error: 'Failed to create API key', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/api-keys - Revoke an API key
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const keyId = searchParams.get('id');

    if (!keyId) {
      return NextResponse.json(
        { error: 'API key ID is required' },
        { status: 400 }
      );
    }

    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🔑 [API KEY] User ${user.id} revoking API key: ${keyId}`);

    // Create service role client for database access
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch key details before deletion (for audit)
    const { data: keyData, error: fetchError } = await serviceSupabase
      .from('user_api_keys')
      .select('id, name, key_preview')
      .eq('id', keyId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !keyData) {
      return NextResponse.json(
        { error: 'API key not found or access denied' },
        { status: 404 }
      );
    }

    // Soft delete: mark as inactive instead of hard delete
    const { error: updateError } = await serviceSupabase
      .from('user_api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', keyId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Failed to revoke API key:', updateError);
      return NextResponse.json(
        { error: 'Failed to revoke API key', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`✅ [API KEY] API key revoked: ${keyId}`);

    // AUDIT TRAIL: Log API key revocation
    try {
      await auditLog({
        action: AUDIT_EVENTS.SETTINGS_API_KEY_REVOKED,
        entityType: 'api_key',
        entityId: keyId,
        userId: user.id,
        resourceName: keyData.name,
        details: {
          key_id: keyId,
          key_name: keyData.name,
          key_preview: keyData.key_preview,
          revoked_at: new Date().toISOString(),
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'warning', // Security-sensitive operation
        complianceFlags: ['SOC2'],
      });
      console.log('✅ API key revocation audited');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'API key revoked successfully',
    });

  } catch (error: any) {
    console.error('Error revoking API key:', error);
    return NextResponse.json(
      { error: 'Failed to revoke API key', message: error.message },
      { status: 500 }
    );
  }
}
