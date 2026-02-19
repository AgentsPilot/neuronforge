// app/api/admin/agent-generation-config/route.ts
// Admin API for managing agent generation configuration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/agent-generation-config
 *
 * Fetch agent generation configuration settings
 */
export async function GET() {
  try {
    // Fetch configuration from system_settings_config
    const { data: settings, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .like('key', 'agent_generation_%');

    if (error) {
      console.error('Error fetching agent generation config:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    // Fetch available models from ai_model_pricing
    const { data: models, error: modelsError } = await supabase
      .from('ai_model_pricing')
      .select('provider, model_name, input_cost_per_token, output_cost_per_token')
      .is('retired_date', null)
      .order('provider')
      .order('model_name');

    if (modelsError) {
      console.error('Error fetching models:', modelsError);
    }

    // Parse settings into structured config with defaults
    const config = {
      requirements: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.0
      },
      semantic: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        temperature: 0.3
      },
      formalization: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        temperature: 0.0
      }
    };

    // Override defaults with database values if they exist
    if (settings && settings.length > 0) {
      settings.forEach((setting) => {
        const { key, value } = setting;

        // Parse JSON values (model names are stored as JSON strings)
        let parsedValue;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If not JSON, use as-is (for numbers)
          parsedValue = isNaN(Number(value)) ? value : Number(value);
        }

        // Map database keys to config structure
        if (key === 'agent_generation_phase_requirements_provider') config.requirements.provider = parsedValue;
        if (key === 'agent_generation_phase_requirements_model') config.requirements.model = parsedValue;
        if (key === 'agent_generation_phase_requirements_temperature') config.requirements.temperature = Number(parsedValue);

        if (key === 'agent_generation_phase_semantic_provider') config.semantic.provider = parsedValue;
        if (key === 'agent_generation_phase_semantic_model') config.semantic.model = parsedValue;
        if (key === 'agent_generation_phase_semantic_temperature') config.semantic.temperature = Number(parsedValue);

        if (key === 'agent_generation_phase_formalization_provider') config.formalization.provider = parsedValue;
        if (key === 'agent_generation_phase_formalization_model') config.formalization.model = parsedValue;
        if (key === 'agent_generation_phase_formalization_temperature') config.formalization.temperature = Number(parsedValue);
      });
    }

    return NextResponse.json({
      success: true,
      config,
      available_models: models || []
    });
  } catch (error) {
    console.error('Error in agent-generation-config GET:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/agent-generation-config
 *
 * Update agent generation configuration settings
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { config } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Missing config in request body' },
        { status: 400 }
      );
    }

    // Prepare settings to update
    const settingsToUpdate = [
      // Phase 0: Requirements
      {
        key: 'agent_generation_phase_requirements_provider',
        value: JSON.stringify(config.requirements.provider),
        category: 'agent_generation',
        description: 'LLM provider for requirements extraction phase (openai or anthropic)'
      },
      {
        key: 'agent_generation_phase_requirements_model',
        value: JSON.stringify(config.requirements.model),
        category: 'agent_generation',
        description: 'LLM model for requirements extraction phase'
      },
      {
        key: 'agent_generation_phase_requirements_temperature',
        value: config.requirements.temperature.toString(),
        category: 'agent_generation',
        description: 'Temperature for requirements extraction (0.0 = deterministic)'
      },

      // Phase 1: Semantic
      {
        key: 'agent_generation_phase_semantic_provider',
        value: JSON.stringify(config.semantic.provider),
        category: 'agent_generation',
        description: 'LLM provider for semantic planning phase (openai or anthropic)'
      },
      {
        key: 'agent_generation_phase_semantic_model',
        value: JSON.stringify(config.semantic.model),
        category: 'agent_generation',
        description: 'LLM model for semantic planning phase'
      },
      {
        key: 'agent_generation_phase_semantic_temperature',
        value: config.semantic.temperature.toString(),
        category: 'agent_generation',
        description: 'Temperature for semantic planning (higher for reasoning)'
      },

      // Phase 3: Formalization
      {
        key: 'agent_generation_phase_formalization_provider',
        value: JSON.stringify(config.formalization.provider),
        category: 'agent_generation',
        description: 'LLM provider for IR formalization phase (openai or anthropic)'
      },
      {
        key: 'agent_generation_phase_formalization_model',
        value: JSON.stringify(config.formalization.model),
        category: 'agent_generation',
        description: 'LLM model for IR formalization phase'
      },
      {
        key: 'agent_generation_phase_formalization_temperature',
        value: config.formalization.temperature.toString(),
        category: 'agent_generation',
        description: 'Temperature for IR formalization (0.0 = mechanical precision)'
      }
    ];

    // Update each setting in database
    for (const setting of settingsToUpdate) {
      const { error } = await supabase
        .from('system_settings_config')
        .upsert(
          {
            key: setting.key,
            value: setting.value,
            category: setting.category,
            description: setting.description,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'key' }
        );

      if (error) {
        console.error(`Error updating ${setting.key}:`, error);
        return NextResponse.json(
          { success: false, error: `Failed to update ${setting.key}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('Error in agent-generation-config PUT:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
