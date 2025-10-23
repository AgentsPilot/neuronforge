// app/api/plugins/additional-config/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { AdditionalConfig } from '@/lib/types/plugin-additional-config';

const debug = process.env.NODE_ENV === 'development';

// POST /api/plugins/additional-config
// Save additional configuration data for a plugin connection
// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { userId, pluginKey, additionalData } = await request.json();

    if (debug) console.log(`DEBUG: API - Saving additional config for ${pluginKey}, user ${userId}`);

    // Validate required parameters
    if (!userId || !pluginKey || !additionalData) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get plugin definition to validate required fields
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginDefinition = pluginManager.getPluginDefinition(pluginKey);

    if (!pluginDefinition) {
      return NextResponse.json(
        { success: false, error: 'Plugin not found' },
        { status: 404 }
      );
    }

    const additionalConfig: AdditionalConfig | undefined = (pluginDefinition.plugin as any).additional_config;

    if (!additionalConfig?.enabled) {
      return NextResponse.json(
        { success: false, error: 'Plugin does not support additional configuration' },
        { status: 400 }
      );
    }

    // Validate required fields
    const requiredFields = additionalConfig.fields.filter(f => f.required);
    const missingFields = requiredFields.filter(f => !additionalData[f.key] || additionalData[f.key].trim() === '');

    if (missingFields.length > 0) {
      const fieldNames = missingFields.map(f => f.label).join(', ');
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${fieldNames}` },
        { status: 400 }
      );
    }

    // Save additional configuration
    const userConnections = UserPluginConnections.getInstance();
    const success = await userConnections.updateAdditionalConfig(userId, pluginKey, additionalData);

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Failed to save additional configuration' },
        { status: 500 }
      );
    }

    if (debug) console.log(`DEBUG: API - Additional config saved successfully for ${pluginKey}`);

    // Audit trail logging
    try {
      const { AuditTrail } = await import('@/lib/services/AuditTrailService');
      await AuditTrail.log({
        action: 'PLUGIN_PERMISSION_GRANTED',
        entityType: 'connection',
        resourceName: pluginKey,
        userId: userId,
        request: request,
        details: {
          plugin_key: pluginKey,
          additional_config_fields: Object.keys(additionalData),
          config_data: additionalData, // Store the actual config for audit purposes
        },
        severity: 'warning',
        complianceFlags: ['SOC2'],
      });
      if (debug) console.log(`DEBUG: Audit trail logged for ${pluginKey} additional config`);
    } catch (auditError) {
      console.error('DEBUG: Failed to log audit trail:', auditError);
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      data: additionalData
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error saving additional config:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save additional configuration' },
      { status: 500 }
    );
  }
}

// GET /api/plugins/additional-config?userId={userId}&pluginKey={pluginKey}
// Retrieve additional configuration data for a plugin connection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const pluginKey = searchParams.get('pluginKey');

    if (debug) console.log(`DEBUG: API - Getting additional config for ${pluginKey}, user ${userId}`);

    // Validate required parameters
    if (!userId || !pluginKey) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get additional configuration
    const userConnections = UserPluginConnections.getInstance();
    const additionalData = await userConnections.getAdditionalConfig(userId, pluginKey);

    if (debug) console.log(`DEBUG: API - Retrieved additional config:`, additionalData);

    return NextResponse.json({
      success: true,
      data: additionalData || {}
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error getting additional config:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to retrieve additional configuration' },
      { status: 500 }
    );
  }
}

// PUT /api/plugins/additional-config
// Update existing additional configuration data
export async function PUT(request: NextRequest) {
  try {
    const { userId, pluginKey, additionalData } = await request.json();

    if (debug) console.log(`DEBUG: API - Updating additional config for ${pluginKey}, user ${userId}`);

    // Validate required parameters
    if (!userId || !pluginKey || !additionalData) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get plugin definition to validate required fields
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginDefinition = pluginManager.getPluginDefinition(pluginKey);

    if (!pluginDefinition) {
      return NextResponse.json(
        { success: false, error: 'Plugin not found' },
        { status: 404 }
      );
    }

    const additionalConfig: AdditionalConfig | undefined = (pluginDefinition.plugin as any).additional_config;

    if (!additionalConfig?.enabled) {
      return NextResponse.json(
        { success: false, error: 'Plugin does not support additional configuration' },
        { status: 400 }
      );
    }

    // Validate required fields
    const requiredFields = additionalConfig.fields.filter(f => f.required);
    const missingFields = requiredFields.filter(f => !additionalData[f.key] || additionalData[f.key].trim() === '');

    if (missingFields.length > 0) {
      const fieldNames = missingFields.map(f => f.label).join(', ');
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${fieldNames}` },
        { status: 400 }
      );
    }

    // Update additional configuration
    const userConnections = UserPluginConnections.getInstance();
    const success = await userConnections.updateAdditionalConfig(userId, pluginKey, additionalData);

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Failed to update additional configuration' },
        { status: 500 }
      );
    }

    if (debug) console.log(`DEBUG: API - Additional config updated successfully for ${pluginKey}`);

    return NextResponse.json({
      success: true,
      data: additionalData
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error updating additional config:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update additional configuration' },
      { status: 500 }
    );
  }
}
